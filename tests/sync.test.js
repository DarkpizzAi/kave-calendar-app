import { test, eq, throws } from "./run.js";
import { memStorage, fakeGh } from "./helpers.js";
import { createLocal } from "../js/local.js";
import { createSync, pathFor } from "../js/sync.js";

const ev = (id, at, extra = {}) => ({ id, title: id + at, updated: { at, by: "isa" }, deleted: false, ...extra });
const file = (events, n = 1) => ({ json: { schema: 1, year: 2026, events }, sha: "s" + n, etag: "e" + n });

test("loadYear reads and caches; a 304 costs nothing", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([ev("a", "1")]) });
  const local = createLocal(memStorage());
  const s = createSync({ gh, local });
  eq((await s.loadYear("2026")).map((e) => e.id), ["a"]);
  eq((await s.loadYear("2026")).map((e) => e.id), ["a"]);
  eq(local.getYear("2026").etag, "e1");
});
test("a missing year file is an empty year, not an error", async () => {
  const s = createSync({ gh: fakeGh({}), local: createLocal(memStorage()) });
  eq(await s.loadYear("2019"), []);
});
test("flush creates the file when it does not exist yet", async () => {
  const gh = fakeGh({});
  const local = createLocal(memStorage());
  local.enqueue("2026", ev("a", "1"));
  await createSync({ gh, local }).flushYear("2026");
  eq(gh.files[pathFor("2026")].json.events.map((e) => e.id), ["a"]);
  eq(local.pendingYears(), []);
});
test("a concurrent save from the other phone keeps both edits (Review Focus 4)", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([ev("a", "1")]) });
  const local = createLocal(memStorage());
  local.enqueue("2026", ev("b", "2"));
  gh.beforePut = async () => {
    gh.files[pathFor("2026")] = file([ev("a", "1"), ev("c", "3")], 9);
  };
  await createSync({ gh, local }).flushYear("2026");
  eq(gh.files[pathFor("2026")].json.events.map((e) => e.id), ["a", "b", "c"]);
});
test("a year move flushes both files; a failure keeps the queue (Review Focus 2)", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([ev("a", "1", { start: "2026-12-30" })]) });
  const local = createLocal(memStorage());
  local.enqueue("2027", ev("a", "2", { start: "2027-01-02" }));
  local.enqueue("2026", { id: "a", deleted: true, deletedAt: "2", movedTo: "2027", updated: { at: "2", by: "isa" } });
  const s = createSync({ gh, local });
  const realPut = gh.putFile;
  gh.putFile = async (p, v, sha) => { if (p === pathFor("2026")) { const e = new Error("offline"); e.gh = "offline"; throw e; } return realPut(p, v, sha); };
  const r = await s.syncNow(["2026", "2027"]);
  eq(r.ok, false);
  eq(local.pendingYears(), ["2026"]);
  gh.putFile = realPut;
  eq((await s.syncNow(["2026", "2027"])).ok, true);
  eq(local.pendingYears(), []);
});
test("the syncing latch clears after a throw", async () => {
  const gh = fakeGh({});
  gh.getFile = async () => { throw new Error("boom"); };
  const s = createSync({ gh, local: createLocal(memStorage()) });
  eq((await s.syncNow(["2026"])).ok, false);
  eq(s.syncing(), false);
});
test("gives up after three conflicts and keeps the queue", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([]) });
  const local = createLocal(memStorage());
  local.enqueue("2026", ev("a", "1"));
  gh.putFile = async () => { const e = new Error("conflict"); e.gh = "conflict"; e.status = 409; throw e; };
  await throws(() => createSync({ gh, local }).flushYear("2026"));
  eq(local.pendingYears(), ["2026"]);
});
