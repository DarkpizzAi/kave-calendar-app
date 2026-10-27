/* Compass: sync. Spoon's engine, with its four rules intact:
     - conditional GETs with an ETag, so a 304 is free
     - two lanes (near: this year and next; far: older years on demand), so
       a big history load never holds back today's edits
     - a lane stamped only when actually entered
     - the `syncing` latch cleared in a `finally`
   Writes read the file fresh, merge per event, and write with its sha; a
   stale sha is re-read and retried, three times at most. The token check
   below it is unchanged from the shell. */
"use strict";

import { store } from "./store.js";
import { github } from "../github.js";
import { mergeEvents } from "./merge.js";

export const pathFor = (y) => `calendar/data/compass/events-${y}.json`;
const isConflict = (e) => e && (e.gh === "conflict" || (e.gh === "http" && e.status === 422));

/* ---------- state reporting (read-only for the engine) ----------
   The UI learns about a sync here and nowhere else: "syncing" | "ok" |
   "failed" | "offline", plus { manual, unsent }. `manual` is a sync the person
   started (pull, Sync now, Retry); every other sync is background and the UI
   stays silent about it. Nothing below changes what a sync does, only what it
   announces. */
const listeners = [];
let cycle = null;       // the sync currently reporting, if any
let barOn = false;      // the indeterminate bar under the header: Sync now only, not a pull
export function onSyncState(cb) { listeners.push(cb); }
export const syncBarOn = () => barOn;

function emit(state, meta) {
  for (const cb of listeners) {
    try { cb(state, meta || {}); } catch (err) { console.warn("sync listener:", err); }
  }
}
function reportStart(manual, bar) {
  cycle = { manual: !!manual };
  barOn = !!(manual && bar);
  emit("syncing", { manual: !!manual });
}
/* A manual sync asked for while another runs does not start a second one: it
   joins the running one, which becomes manual so its result announces itself. */
function reportJoin(bar) {
  if (!cycle) return;
  cycle.manual = true;
  if (bar) barOn = true;
  emit("syncing", { manual: true, joined: true });
}
function reportEnd(r, unsent) {
  const c = cycle || { manual: false };
  cycle = null;
  barOn = false;
  const kind = r && r.error && r.error.gh;
  emit(r && r.ok ? "ok" : kind === "offline" ? "offline" : "failed", { manual: c.manual, unsent: !!unsent });
}

export function createSync({ gh, local }) {
  let syncing = false;
  const lanes = { near: 0, far: 0 };
  /* Bumped each time a flush writes a year. A load runs outside the sync
     latch (calendar.js asks for years as it draws), so its GET can start
     before a flush's PUT and land after it: that copy is older than the
     cache and must not replace it. */
  const writes = {};

  async function loadYear(y) {
    const rec = local.getYear(y), gen = writes[y] || 0;
    try {
      const r = await gh.getFile(pathFor(y), { etag: rec && rec.etag });
      if ((writes[y] || 0) !== gen) return local.getYear(y).events;
      if (r.notModified) return rec.events;
      local.setYear(y, { events: r.json.events || [], sha: r.sha, etag: r.etag });
      return r.json.events || [];
    } catch (e) {
      if (e && e.gh === "notFound") { local.setYear(y, { events: [], sha: null, etag: null }); return []; }
      throw e;
    }
  }

  /* A read for the Archive and search: like loadYear, but a missing year is
     answered with null and stored nowhere, so probing past the edge of the
     data never adds a year to the cache or to the synced set. */
  async function probeYear(y) {
    const rec = local.getYear(y), gen = writes[y] || 0;
    let r;
    try { r = await gh.getFile(pathFor(y), { etag: rec && rec.etag }); }
    catch (e) { if (e && e.gh === "notFound") return null; throw e; }
    if ((writes[y] || 0) !== gen) return local.getYear(y).events;
    if (r.notModified) return rec.events;
    local.setYear(y, { events: r.json.events || [], sha: r.sha, etag: r.etag });
    return r.json.events || [];
  }

  async function flushYear(y) {
    const queued = local.pendingFor(y);
    if (!queued.length) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      let remote = [], sha = null;
      try {
        const r = await gh.getFile(pathFor(y));
        remote = r.json.events || []; sha = r.sha;
      } catch (e) { if (!(e && e.gh === "notFound")) throw e; }
      const merged = mergeEvents(remote, queued);
      try {
        const out = await gh.putFile(pathFor(y), { schema: 1, year: Number(y), events: merged }, sha,
          `compass: ${queued.length} event edit(s) in ${y} by ${store.state.settings.me || "?"}`);
        local.setYear(y, { events: merged, sha: out.sha, etag: null });
        writes[y] = (writes[y] || 0) + 1;
        local.dequeue(y, queued);
        return;
      } catch (e) {
        if (!isConflict(e)) throw e;
      }
    }
    const e = new Error("the file kept changing; your edits are kept and will be retried");
    e.gh = "conflict";
    throw e;
  }

  /* A sync asked for while one runs is not dropped (final review I1): the
     running sync runs once more when it finishes, with the union of the
     years, and the skipped caller waits for that. */
  let running = null, again = null;
  function syncNow(years, opts = {}) {
    if (syncing) {
      again = [...new Set([...(again || []), ...years])];
      if (opts.manual) reportJoin(opts.bar);
      return running.then((r) => ({ ...r, skipped: true }));
    }
    syncing = true;
    reportStart(opts.manual, opts.bar);
    running = (async () => {
      let r = { ok: false, error: new Error("sync did not finish") };
      try {
        r = await syncOnce(years);
        while (again) {
          const ys = again; again = null;
          const r2 = await syncOnce(ys);
          if (!r2.ok) r = r2;
        }
        return r;
      } finally {
        syncing = false;   // the latch covers the rerun too, and is always cleared
        reportEnd(r, !r.ok && local.pendingYears().length > 0);
      }
    })();
    return running;
  }

  /* Each year flushes and loads on its own: one failing file must not hold
     back the others -- not the other uploads (a year move could leave the
     new copy stranded), and not the downloads either (one year that keeps
     conflicting would otherwise stop the other phone's edits arriving).
     The first error is reported once everything has been tried. */
  async function syncOnce(years) {
    let firstError = null;
    for (const y of local.pendingYears()) {
      try { await flushYear(y); } catch (e) { firstError = firstError || e; }
    }
    const thisYear = String(new Date().getFullYear());
    for (const y of years) {
      const lane = Number(y) >= Number(thisYear) ? "near" : "far";
      lanes[lane] = Date.now();
      try { await loadYear(y); } catch (e) { firstError = firstError || e; }
    }
    return firstError ? { ok: false, error: firstError } : { ok: true };
  }

  return { loadYear, probeYear, flushYear, syncNow, syncing: () => syncing, lanes };
}

/* Transient, not persisted: a status is about this session. */
export let status = { state: "idle", message: "", at: 0 };

function set(state, message) {
  status = { state, message, at: Date.now() };
}

/* Can this token read Compass's data? One read of this year's events
   file: it needs the same Contents permission sync needs, and writes
   nothing. It has to be a JSON file, because getFile parses what it reads
   (a markdown file here once made every good token read as a failure). */
export async function probeToken(token, gh = github, year = new Date().getFullYear()) {
  gh.setToken(token);
  try {
    try { await gh.getFile(pathFor(year)); }
    catch (e) {
      /* early January, before this year's file exists: last year's will do */
      if (!(e && e.gh === "notFound")) throw e;
      await gh.getFile(pathFor(year - 1));
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e }; }
}

export async function checkToken() {
  const token = store.state.settings.token;
  if (!token) { set("none", "No token set"); return status; }

  set("checking", "Checking token...");
  try {
    const r = await probeToken(token);
    if (!r.ok) throw r.error;
    set("ok", "Token works. Reached kave-hub.");
    store.state.sync.syncedAt = Date.now();
    store.persist("compass.sync", store.state.sync);
  } catch (e) {
    const kind = e && e.gh;
    if (kind === "offline") set("offline", "Offline. Nothing synced.");
    else if (kind === "unauthorized") set("bad", "Token rejected. Check it has Contents: read and write on kave-hub.");
    else if (kind === "notFound") set("bad", "Reached GitHub but not the file. Is the token scoped to kave-hub?");
    else if (kind === "rateLimited") set("bad", "Rate limited by GitHub. Try again later.");
    else set("bad", "Could not reach GitHub: " + (e && e.message ? e.message : "unknown error"));
  }
  return status;
}
