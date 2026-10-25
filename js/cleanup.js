/* Compass: the pure side of "Calendar data clean-up" (spec section 5). No DOM,
   no storage: queue, outbox and log in, plain values out. The one effect is
   flushOutbox, and it takes the GitHub client as an argument so a test can
   hand it a fake.

   An answer is one small file per card line in cleanup-answers/, applied by the
   hourly sweep. The app never edits the event itself. Until the file reaches
   GitHub the answer waits in the outbox (Spoon's outbox pattern), so an answer
   given with no signal is sent later and never lost. */
"use strict";

const BASE = "calendar/data/compass";
export const QUEUE_PATH = `${BASE}/cleanup-queue.json`;
export const LOG_PATH = `${BASE}/cleanup-log.json`;
export const ANSWERS_DIR = `${BASE}/cleanup-answers`;
export const WINDOW_DAYS = 30;

const clean = (s) => String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]/g, "_");
export const answerKey = (a) => `${a.card}-${a.line}`;
export const answerPath = (a) => `${ANSWERS_DIR}/${clean(a.card)}-${clean(a.line)}.json`;

/* The same card and line answered twice keeps the newer answer. */
export function mergeOutbox(outbox, answer) {
  return [...outbox.filter((x) => answerKey(x) !== answerKey(answer)), answer];
}

/* Every question the queue still holds: [{card, line}]. */
export function queueLines(queue) {
  const out = [];
  ((queue && queue.cards) || []).forEach((c) => (c.lines || []).forEach((l) => out.push({ card: c.id, line: l.key })));
  return out;
}

const accepted = (a) => a.action === "accepted";

/* Keys ("card-line") of the multiple-choice answers given and not yet applied. */
export function answeredKeys(outbox, sent) {
  return new Set([...outbox, ...sent].filter(accepted).map(answerKey));
}

const dayNumber = (d) => { const p = d.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };

/* The three numbers of the section.
   to answer: queue lines with no answer in the outbox or sent.
   applying:  answers in the outbox, plus answers written whose line is still in the queue.
   done:      answers the sweep logged in the last 30 days. */
export function cleanupCounts({ queue, outbox, sent, log }, today) {
  const lines = queueLines(queue);
  const inQueue = new Set(lines.map((l) => `${l.card}-${l.line}`));
  const answered = answeredKeys(outbox, sent);
  const toAnswer = lines.filter((l) => !answered.has(`${l.card}-${l.line}`)).length;
  const waiting = new Set(outbox.map(answerKey));
  const written = sent.filter((a) => accepted(a) && inQueue.has(answerKey(a)) && !waiting.has(answerKey(a)));
  const applying = outbox.length + new Set(written.map(answerKey)).size;
  const done = (((log && log.answers) || [])).filter((a) => {
    const stamp = String(a.appliedAt || a.at || "").slice(0, 10);
    if (stamp.length !== 10) return false;
    const age = dayNumber(today) - dayNumber(stamp);
    return age >= 0 && age <= WINDOW_DAYS;
  }).length;
  return { toAnswer, applying, done };
}

/* Drop what no longer needs remembering: a written answer whose line has left
   the queue was applied; a written note for Claude is kept for a day, since
   nothing in the queue says when it was read. */
export function pruneSent(sent, queue, nowMs) {
  const inQueue = new Set(queueLines(queue).map((l) => `${l.card}-${l.line}`));
  return sent.filter((a) => (accepted(a) ? inQueue.has(answerKey(a)) : nowMs - Date.parse(a.at) < 86400000));
}

/* Send the outbox. Each answer is created with sha null; if the file already
   exists (the other phone answered first) the current sha is read and the
   file overwritten. Offline, unauthorised or rate limited stops the run and
   keeps the rest in the outbox; any other failure keeps just that answer.
   Returns {outbox: still waiting, sent: written now, error: kind or null}. */
export async function flushOutbox(gh, outbox) {
  const left = [...outbox], sent = [];
  let error = null;
  for (const a of outbox) {
    const path = answerPath(a);
    const msg = `cleanup answer (${a.by || "?"}): ${a.card} ${a.line}`;
    try {
      try {
        await gh.putFile(path, a, null, msg);
      } catch (e) {
        if (e.gh !== "conflict" && e.gh !== "http") throw e;
        const cur = await gh.getFile(path);
        await gh.putFile(path, a, cur.sha, msg);
      }
      sent.push(a);
      left.splice(left.indexOf(a), 1);
    } catch (e) {
      error = e.gh || "http";
      if (error === "offline" || error === "unauthorized" || error === "rateLimited") break;
    }
  }
  return { outbox: left, sent, error };
}
