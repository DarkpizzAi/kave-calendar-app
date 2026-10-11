import { test, eq, throws } from "./run.js";
import { memStorage } from "./helpers.js";
import { createLocal } from "../js/local.js";

const ev = (id, at) => ({ id, updated: { at, by: "isa" } });

test("year cache round-trips", () => {
  const l = createLocal(memStorage());
  l.setYear("2026", { events: [ev("a", "1")], sha: "s", etag: "e" });
  eq(l.getYear("2026").sha, "s");
  eq(l.getYear("2025"), null);
});
test("queue coalesces edits to one event", () => {
  const l = createLocal(memStorage());
  l.enqueue("2026", ev("a", "1"));
  l.enqueue("2026", ev("a", "2"));
  eq(l.pendingFor("2026").map((e) => e.updated.at), ["2"]);
  eq(l.pendingYears(), ["2026"]);
});
test("dequeue keeps an edit made during the flush", () => {
  const l = createLocal(memStorage());
  l.enqueue("2026", ev("a", "1"));
  const flushed = l.pendingFor("2026");
  l.enqueue("2026", ev("a", "2"));
  l.dequeue("2026", flushed);
  eq(l.pendingFor("2026").map((e) => e.updated.at), ["2"]);
});
test("the queue survives a restart", () => {
  const s = memStorage();
  createLocal(s).enqueue("2027", ev("a", "1"));
  eq(createLocal(s).pendingYears(), ["2027"]);
});
test("review: a full storage fails the edit out loud; a full cache stays quiet", async () => {
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  const l = createLocal(full);
  await throws(() => l.enqueue("2026", ev("a", "1")), "storage is full");
  l.setYear("2026", { events: [], sha: null, etag: null });
});
test("corrupt storage starts empty instead of throwing", () => {
  const s = memStorage();
  s.setItem("compass.queue", "{not json");
  eq(createLocal(s).pendingYears(), []);
});
