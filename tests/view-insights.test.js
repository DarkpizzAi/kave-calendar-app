import { test, eq, ok } from "./run.js";
import { fakeGh } from "./helpers.js";
import { answerKey, answerPath, mergeOutbox, queueLines, answeredKeys, cleanupCounts, pruneSent, flushOutbox, ANSWERS_DIR } from "../js/cleanup.js";

const ans = (card, line, value = "isa", at = "2026-10-25T10:00:00Z") => ({ card, line, action: "accepted", value, by: "isa", at });
const note = (card, text, at = "2026-10-25T10:00:00Z") => ({ card, line: "all", action: "freetext", text, by: "hugo", at });
const queue = { cards: [
  { id: "cu_a", lines: [{ key: "going", options: ["isa", "hugo", "both"] }, { key: "paid", options: ["isa", "hugo", "both"] }] },
  { id: "cu_b", lines: [{ key: "going", options: ["isa", "hugo", "both"] }] },
] };

test("answerPath: one file per card line, in cleanup-answers", () => {
  eq(answerPath(ans("cu_a", "paid")), `${ANSWERS_DIR}/cu_a-paid.json`);
  eq(answerPath(note("cu_a", "x")), `${ANSWERS_DIR}/cu_a-all.json`);
  eq(answerPath(ans("../x", "a/b")), `${ANSWERS_DIR}/___x-a_b.json`);
});

test("mergeOutbox: the same card and line keeps the newer answer, others stay", () => {
  const a = ans("cu_a", "going", "isa"), b = ans("cu_a", "paid", "hugo"), c = ans("cu_a", "going", "both");
  const out = mergeOutbox(mergeOutbox([a], b), c);
  eq(out.map(answerKey), ["cu_a-paid", "cu_a-going"]);
  eq(out[1].value, "both");
});

test("queueLines lists every question of every card", () => {
  eq(queueLines(queue), [{ card: "cu_a", line: "going" }, { card: "cu_a", line: "paid" }, { card: "cu_b", line: "going" }]);
  eq(queueLines(null), []);
});

test("answeredKeys ignores free-text notes", () => {
  eq([...answeredKeys([ans("cu_a", "going")], [note("cu_b", "hi")])], ["cu_a-going"]);
});

test("cleanupCounts: to answer, applying, done", () => {
  const log = { answers: [
    { card: "x", line: "going", appliedAt: "2026-10-20T08:00:00Z" },   // in window
    { card: "y", line: "paid", at: "2026-09-25T08:00:00Z" },          // 30 days: in
    { card: "z", line: "paid", appliedAt: "2026-09-24T08:00:00Z" },   // 31 days: out
  ] };
  const c = cleanupCounts({ queue, outbox: [ans("cu_a", "going")], sent: [ans("cu_b", "going")], log }, "2026-10-25");
  eq(c, { toAnswer: 1, applying: 2, done: 2 });
});

test("cleanupCounts: a written answer whose line left the queue is not applying; an empty state is zeros", () => {
  const c = cleanupCounts({ queue, outbox: [], sent: [ans("cu_gone", "going")], log: null }, "2026-10-25");
  eq(c, { toAnswer: 3, applying: 0, done: 0 });
  eq(cleanupCounts({ queue: null, outbox: [], sent: [], log: null }, "2026-10-25"), { toAnswer: 0, applying: 0, done: 0 });
});

test("cleanupCounts: an answer both in the outbox and written counts once", () => {
  const a = ans("cu_a", "going");
  eq(cleanupCounts({ queue, outbox: [a], sent: [a], log: null }, "2026-10-25").applying, 1);
});

test("pruneSent: applied lines go, a note stays a day", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const kept = pruneSent([ans("cu_a", "going"), ans("cu_gone", "going"), note("cu_a", "new", "2026-10-25T06:00:00Z"), note("cu_a", "old", "2026-10-23T06:00:00Z")], queue, now);
  eq(kept.map((a) => a.card + "/" + a.line), ["cu_a/going", "cu_a/all"]);
  eq(kept[1].text, "new");
});

test("flushOutbox: creates each answer file with no sha and empties the outbox", async () => {
  const gh = fakeGh();
  const out = await flushOutbox(gh, [ans("cu_a", "going"), note("cu_a", "Hugo pays flights")]);
  eq(out.outbox, []);
  eq(out.sent.length, 2);
  eq(out.error, null);
  eq(gh.files[`${ANSWERS_DIR}/cu_a-going.json`].json.value, "isa");
  eq(gh.files[`${ANSWERS_DIR}/cu_a-all.json`].json.text, "Hugo pays flights");
});

test("flushOutbox: a file that already exists is overwritten (conflict, then get and put)", async () => {
  const path = `${ANSWERS_DIR}/cu_a-going.json`;
  const gh = fakeGh({ [path]: { json: ans("cu_a", "going", "hugo"), sha: "old", etag: "e" } });
  const out = await flushOutbox(gh, [ans("cu_a", "going", "both")]);
  eq(out.outbox, []);
  eq(gh.files[path].json.value, "both");
});

test("flushOutbox: offline keeps everything, in order, and reports it", async () => {
  const gh = { async putFile() { const e = new Error("offline"); e.gh = "offline"; throw e; }, async getFile() { throw new Error("unused"); } };
  const box = [ans("cu_a", "going"), ans("cu_b", "going")];
  const out = await flushOutbox(gh, box);
  eq(out.outbox, box);
  eq(out.sent, []);
  eq(out.error, "offline");
});

test("flushOutbox: one failing answer does not block the next", async () => {
  const gh = fakeGh();
  const real = gh.putFile;
  gh.putFile = async (path, v, sha, m) => {
    if (path.includes("cu_a-going")) { const e = new Error("boom"); e.gh = "notFound"; throw e; }
    return real(path, v, sha, m);
  };
  const out = await flushOutbox(gh, [ans("cu_a", "going"), ans("cu_b", "going")]);
  eq(out.outbox.map(answerKey), ["cu_a-going"]);
  eq(out.sent.map(answerKey), ["cu_b-going"]);
  ok(out.error === "notFound");
});
