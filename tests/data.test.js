import { test, eq, ok, throws } from "./run.js";
import { memStorage } from "./helpers.js";
import { createLocal } from "../js/local.js";
import { createData } from "../js/data.js";

/* A sync that never answers the network: data.js must show edits without it. */
const idleSync = () => ({ calls: 0, async loadYear() { this.calls++; }, async syncNow() { return { ok: true }; } });
const base = (id, start, extra = {}) => ({ id, title: id, owner: "shared", start, end: null, activities: [], deleted: false,
  updated: { at: "2026-01-01T00:00:00.000Z", by: "isa" }, ...extra });
function setup(me = "isa") {
  const local = createLocal(memStorage());
  let t = Date.parse("2026-09-24T10:00:00Z");
  const data = createData({ sync: idleSync(), local, now: () => new Date(t += 1000), me: () => me });
  return { local, data };
}

test("data: save refuses without who am I, and queues nothing", async () => {
  const { local, data } = setup("");
  await throws(() => data.save(null, base("a", "2026-10-01")));
  eq(local.pendingYears(), []);
});
test("data: a save shows at once and queues its year", () => {
  const { local, data } = setup();
  data.save(null, base("a", "2026-10-01"));
  eq(data.events().map((e) => e.id), ["a"]);
  eq(local.pendingYears(), ["2026"]);
  eq(data.events()[0].updated.by, "isa");
});
test("data: a year move shows one copy and queues both years", () => {
  const { local, data } = setup();
  const a = data.save(null, base("a", "2026-12-30"));
  data.save(a, { ...a, start: "2027-01-02" });
  eq(data.events().map((e) => e.start), ["2027-01-02"]);
  eq(local.pendingYears(), ["2026", "2027"]);
});
test("data: remove hides, undoRemove brings back", () => {
  const { data } = setup();
  const a = data.save(null, base("a", "2026-10-01"));
  const gone = data.remove(a);
  eq(data.events().length, 0);
  data.undoRemove(gone);
  eq(data.events().map((e) => e.id), ["a"]);
});
test("data: ensureYear shows the cache before the network answers", async () => {
  const { local, data } = setup();
  local.setYear("2026", { events: [base("c", "2026-05-05")], sha: "s", etag: "e" });
  let seen = null;
  data.subscribe(() => { if (seen === null) seen = data.events().map((e) => e.id); });
  await data.ensureYear("2026");
  eq(seen, ["c"]);
  ok(data.loadedYears().includes("2026"));
});
