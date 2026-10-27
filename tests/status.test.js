import { test, eq, ok } from "./run.js";
import { memStorage, fakeGh } from "./helpers.js";
import { createLocal } from "../js/local.js";
import { createSync, pathFor, onSyncState } from "../js/sync.js";
import { createData } from "../js/data.js";
import * as U from "../js/updates.js";
import { showSnackbar } from "../m3/kave-m3.js";

const { deps, offerUpdate, restartForUpdate, watchRegistration, watchTakeover, checkForUpdate, resetUpdateFlow, UPDATE_TEXT } = U;

const ev = (id, at, extra = {}) => ({ id, title: id + at, start: "2026-05-05", updated: { at, by: "isa" }, deleted: false, ...extra });
const file = (events, n = 1) => ({ json: { schema: 1, year: 2026, events }, sha: "s" + n, etag: "e" + n });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- sync state reporting ---------- */

const log = [];
onSyncState((s, m) => log.push([s, !!m.manual, !!m.unsent, !!m.joined]));

test("status: a background sync reports syncing then ok, not manual", async () => {
  const s = createSync({ gh: fakeGh({ [pathFor("2026")]: file([ev("a", "1")]) }), local: createLocal(memStorage()) });
  const n0 = log.length;
  await s.syncNow(["2026"]);
  eq(log.slice(n0), [["syncing", false, false, false], ["ok", false, false, false]]);
});

test("status: a manual sync that cannot reach GitHub reports offline, manual", async () => {
  const gh = fakeGh({});
  gh.getFile = async () => { const e = new Error("offline"); e.gh = "offline"; throw e; };
  const s = createSync({ gh, local: createLocal(memStorage()) });
  const n0 = log.length;
  await s.syncNow(["2026"], { manual: true });
  eq(log.slice(n0).map((x) => x.slice(0, 2)), [["syncing", true], ["offline", true]]);
});

test("status: a failure with edits still queued says unsent; without edits it does not", async () => {
  const gh = fakeGh({});
  gh.getFile = async () => { const e = new Error("no"); e.gh = "unauthorized"; throw e; };
  const local = createLocal(memStorage());
  const s = createSync({ gh, local });
  let n0 = log.length;
  await s.syncNow(["2026"]);
  eq(log.slice(n0)[1], ["failed", false, false, false]);
  local.enqueue("2026", ev("q", "1"));
  n0 = log.length;
  await s.syncNow(["2026"]);
  eq(log.slice(n0)[1], ["failed", false, true, false]);
});

test("status: a manual sync during a running one joins it (one start, one result, announced as manual)", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([ev("a", "1")]) });
  const get = gh.getFile;
  gh.getFile = async (p, o) => { await sleep(30); return get(p, o); };
  const s = createSync({ gh, local: createLocal(memStorage()) });
  const n0 = log.length;
  const p1 = s.syncNow(["2026"]);
  await sleep(5);
  const p2 = s.syncNow(["2026"], { manual: true, bar: true });
  const r = await Promise.all([p1, p2]);
  const got = log.slice(n0);
  eq(got.filter((x) => x[0] === "syncing" && !x[3]).length, 1);
  eq(got[got.length - 1], ["ok", true, false, false]);
  ok(r[1].skipped, "the joiner is told it joined");
});

test("status: the latch is clear after a failure, so the next sync runs", async () => {
  const gh = fakeGh({});
  const get = gh.getFile;
  let fail = true;
  gh.getFile = async (p, o) => { if (fail) { const e = new Error("x"); e.gh = "http"; throw e; } return get(p, o); };
  const s = createSync({ gh, local: createLocal(memStorage()) });
  eq((await s.syncNow(["2026"])).ok, false);
  eq(s.syncing(), false);
  fail = false;
  eq((await s.syncNow(["2026"])).ok, true);
});

/* ---------- loading every year for the Archive and search ---------- */

test("local.cachedYears lists the years on the phone", () => {
  const st = memStorage(), local = createLocal(st);
  local.setYear("2024", { events: [], sha: null, etag: null });
  local.setYear("2026", { events: [], sha: null, etag: null });
  st.setItem("compass.other", "1");
  eq(local.cachedYears(), ["2024", "2026"]);
});

test("data.loadAllYears: offline it reads the cache and asks for nothing", async () => {
  const gh = fakeGh({});
  let asked = 0;
  const get = gh.getFile; gh.getFile = async (p, o) => { asked++; return get(p, o); };
  const local = createLocal(memStorage());
  local.setYear("2023", { events: [ev("old", "1", { start: "2023-03-03" })], sha: "x", etag: null });
  const data = createData({ sync: createSync({ gh, local }), local, now: () => new Date(), me: () => "isa" });
  await data.loadAllYears({ online: false });
  eq(data.events().map((e) => e.id), ["old"]);
  eq(asked, 0);
});

test("data.loadAllYears: online it walks back past the edge until a year is empty", async () => {
  const f = (y) => ({ json: { schema: 1, year: y, events: [ev("e" + y, "1", { start: `${y}-02-02` })] }, sha: "s" + y, etag: "t" + y });
  const gh = fakeGh({ [pathFor("2024")]: f(2024), [pathFor("2023")]: f(2023), [pathFor("2022")]: f(2022) });
  const local = createLocal(memStorage());
  local.setYear("2024", { events: [ev("e2024", "1", { start: "2024-02-02" })], sha: "s2024", etag: "t2024" });
  const data = createData({ sync: createSync({ gh, local }), local, now: () => new Date(), me: () => "isa" });
  await data.loadAllYears({ online: true });
  eq(data.events().map((e) => e.id).sort(), ["e2022", "e2023", "e2024"]);
  ok(!data.loadedYears().includes("2021"), "the missing year that ends the walk is not kept");
  ok(!data.loadedYears().includes("2020"));
  eq(local.getYear("2021"), null, "and nothing is cached for it");
  eq(data.syncYears(), ["2022", "2023", "2024"]);
});

test("data.loadAllYears: a 404 probe does not grow loadedYears, and is not asked again", async () => {
  const gh = fakeGh({});
  let asked = 0;
  const get = gh.getFile; gh.getFile = async (p, o) => { asked++; return get(p, o); };
  const local = createLocal(memStorage());
  local.setYear("2025", { events: [ev("e", "1", { start: "2025-02-02" })], sha: "s", etag: "t" });
  const data = createData({ sync: createSync({ gh, local }), local, now: () => new Date(), me: () => "isa" });
  await data.ensureYear("2025");
  const before = data.loadedYears();
  await data.loadAllYears({ online: true });
  eq(data.loadedYears(), before);
  eq(local.cachedYears(), ["2025"]);
  const n = asked;
  await data.loadAllYears({ online: true });
  eq(asked, n, "known-empty years are not probed on every open");
});

test("data: an empty year cached by an earlier run is not in the sync list; concurrent loads share one request", async () => {
  const gh = fakeGh({ [pathFor("2026")]: file([ev("a", "1")]) });
  let asked = 0;
  const get = gh.getFile; gh.getFile = async (p, o) => { asked++; await sleep(10); return get(p, o); };
  const local = createLocal(memStorage());
  local.setYear("2028", { events: [], sha: null, etag: null });
  const data = createData({ sync: createSync({ gh, local }), local, now: () => new Date(), me: () => "isa" });
  await data.ensureYear("2028");
  await Promise.all([data.ensureYear("2026"), data.ensureYear("2026")]);
  eq(asked, 2, "one request for 2026 and one for 2028");
  ok(data.loadedYears().includes("2028"));
  eq(data.syncYears(), ["2026"]);
});

/* ---------- the update flow, against a mocked service worker ---------- */

function mockSw({ controller = {}, reg = null } = {}) {
  const sw = new EventTarget();
  sw.controller = controller;
  sw.getRegistration = async () => reg;
  return sw;
}
function mockReg({ waiting = null, installing = null, onUpdate = null } = {}) {
  const reg = new EventTarget();
  reg.waiting = waiting; reg.installing = installing;
  reg.update = async () => { if (onUpdate) onUpdate(reg); };
  return reg;
}
function freshEnv(sw) {
  const host = document.createElement("div");
  document.body.append(host);
  const calls = { reload: 0 };
  Object.assign(deps, { sw: () => sw, reload: () => { calls.reload++; }, host: () => host, later: () => 0, localDev: () => false });
  resetUpdateFlow();
  return { host, calls };
}
const snackText = (host) => [...host.querySelectorAll(".m3-snackbar")].map((s) => s.textContent);
const worker = () => { const w = new EventTarget(); w.state = "installed"; w.posted = []; w.postMessage = (m) => w.posted.push(m); return w; };

test("update: the snackbar is sticky with Restart, and a second offer makes no second one", async () => {
  const { host } = freshEnv(mockSw());
  offerUpdate(); offerUpdate();
  const bars = host.querySelectorAll(".m3-snackbar");
  eq(bars.length, 1);
  ok(bars[0].textContent.startsWith(UPDATE_TEXT));
  ok([...bars[0].querySelectorAll("button")].some((b) => b.textContent === "Restart"));
  ok(bars[0].querySelector('[aria-label="Dismiss"]'), "ms 0 means it stays until answered");
  host.remove();
});

test("update: another snackbar replaces it, and it comes back when that one has gone", async () => {
  const { host } = freshEnv(mockSw());
  offerUpdate();
  showSnackbar(host, { text: "Synced just now", ms: 60 });
  await Promise.resolve(); await Promise.resolve();
  eq(snackText(host), ["Synced just now"]);
  for (let i = 0; i < 40 && !snackText(host).some((t) => t.startsWith(UPDATE_TEXT)); i++) await sleep(100);
  eq(snackText(host).length, 1);
  ok(snackText(host)[0].startsWith(UPDATE_TEXT));
  host.remove();
});

test("update: Restart posts skipWaiting to the waiting worker and reloads once, however many controllerchange events", async () => {
  const w = worker();
  const sw = mockSw({ reg: mockReg({ waiting: w }) });
  const { host, calls } = freshEnv(sw);
  await restartForUpdate();
  eq(w.posted, [{ type: "skipWaiting" }]);
  eq(calls.reload, 0);
  sw.dispatchEvent(new Event("controllerchange"));
  sw.dispatchEvent(new Event("controllerchange"));
  eq(calls.reload, 1);
  await restartForUpdate();       // a second tap while restarting does nothing
  eq(w.posted.length, 1);
  host.remove();
});

test("update: Restart with nothing waiting is just the reload; a worker that never takes over is reloaded by the fallback", async () => {
  const first = freshEnv(mockSw({ reg: mockReg() }));
  await restartForUpdate();
  eq(first.calls.reload, 1);
  first.host.remove();
  const w = worker(), sw = mockSw({ reg: mockReg({ waiting: w }) });
  const env = freshEnv(sw);
  let fallback = null;
  deps.later = (fn) => { fallback = fn; };
  await restartForUpdate();
  eq(env.calls.reload, 0);
  fallback();
  eq(env.calls.reload, 1);
  sw.dispatchEvent(new Event("controllerchange"));
  eq(env.calls.reload, 1, "the late takeover does not reload a second time");
  env.host.remove();
});

test("update: a first install never offers; a waiting worker, a later install and a later takeover do", async () => {
  // first install: no controller yet
  let env = freshEnv(mockSw({ controller: null }));
  let reg = mockReg();
  watchRegistration(reg);
  let w = worker(); reg.installing = w;
  reg.dispatchEvent(new Event("updatefound")); w.dispatchEvent(new Event("statechange"));
  eq(snackText(env.host).length, 0, "installed with no controller: first install");
  env.host.remove();
  // a worker already waiting at open
  env = freshEnv(mockSw({ controller: {} }));
  watchRegistration(mockReg({ waiting: worker() }));
  eq(snackText(env.host).length, 1);
  env.host.remove();
  // one that finishes installing later
  env = freshEnv(mockSw({ controller: {} }));
  reg = mockReg(); watchRegistration(reg);
  w = worker(); reg.installing = w;
  reg.dispatchEvent(new Event("updatefound")); w.dispatchEvent(new Event("statechange"));
  eq(snackText(env.host).length, 1);
  env.host.remove();
  // takeover: the first controllerchange is the session's own, the second is an update
  const sw4 = mockSw({ controller: null });
  env = freshEnv(sw4);
  watchTakeover();
  sw4.dispatchEvent(new Event("controllerchange"));
  eq(snackText(env.host).length, 0);
  sw4.dispatchEvent(new Event("controllerchange"));
  eq(snackText(env.host).length, 1);
  env.host.remove();
});

test("update: Check for updates offers the snackbar when a worker is waiting", async () => {
  const w = worker();
  const env = freshEnv(mockSw({ reg: mockReg({ waiting: w }) }));
  await checkForUpdate(() => {});
  eq(U.updateState.kind, "ready");
  eq(snackText(env.host).length, 1);
  ok(snackText(env.host)[0].startsWith(UPDATE_TEXT));
  env.host.remove();
});

test("update: Check for updates with nothing new says up to date and shows no snackbar", async () => {
  const env = freshEnv(mockSw({ reg: mockReg() }));
  await checkForUpdate(() => {});
  eq(U.updateState.kind, "current");
  eq(snackText(env.host).length, 0);
  env.host.remove();
});

test("update: Check for updates after a worker already took over still offers the restart", async () => {
  const env = freshEnv(mockSw({ controller: {}, reg: mockReg() }));
  offerUpdate();                                  // found earlier this session, worker already active
  env.host.querySelector(".m3-snackbar").remove(); // the reader swiped it away without answering
  await checkForUpdate(() => {});
  eq(U.updateState.kind, "ready");
  await sleep(20);
  eq(snackText(env.host).length, 1);
  env.host.remove();
});

test("update: Check for updates picks up a worker that installs during the check", async () => {
  const w = worker();
  const env = freshEnv(mockSw({ reg: mockReg({ onUpdate: (r) => { r.installing = w; } }) }));
  await checkForUpdate(() => {});
  eq(U.updateState.kind, "ready");
  eq(snackText(env.host).length, 1);
  env.host.remove();
});

test("update: Check for updates on the local dev server says so and does nothing", async () => {
  const env = freshEnv(mockSw({ reg: mockReg() }));
  deps.localDev = () => true;
  await checkForUpdate(() => {});
  eq(U.updateState.kind, "unsupported");
  eq(snackText(env.host).length, 0);
  deps.localDev = () => false;
  env.host.remove();
});
