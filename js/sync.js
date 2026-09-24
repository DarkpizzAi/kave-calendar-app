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

export function createSync({ gh, local }) {
  let syncing = false;
  const lanes = { near: 0, far: 0 };

  async function loadYear(y) {
    const rec = local.getYear(y);
    try {
      const r = await gh.getFile(pathFor(y), { etag: rec && rec.etag });
      if (r.notModified) return rec.events;
      local.setYear(y, { events: r.json.events || [], sha: r.sha, etag: r.etag });
      return r.json.events || [];
    } catch (e) {
      if (e && e.gh === "notFound") { local.setYear(y, { events: [], sha: null, etag: null }); return []; }
      throw e;
    }
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

  async function syncNow(years) {
    if (syncing) return { ok: true, skipped: true };
    syncing = true;
    try {
      /* Each year flushes on its own: one failing file must not hold back
         the others, or a year move could leave the new copy stranded. */
      let firstError = null;
      for (const y of local.pendingYears()) {
        try { await flushYear(y); } catch (e) { firstError = firstError || e; }
      }
      if (firstError) throw firstError;
      const thisYear = String(new Date().getFullYear());
      for (const y of years) {
        const lane = Number(y) >= Number(thisYear) ? "near" : "far";
        lanes[lane] = Date.now();
        await loadYear(y);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      syncing = false;
    }
  }

  return { loadYear, flushYear, syncNow, syncing: () => syncing, lanes };
}

/* Transient, not persisted: a status is about this session. */
export let status = { state: "idle", message: "", at: 0 };

function set(state, message) {
  status = { state, message, at: Date.now() };
}

/* Prove the token can actually reach the repo. A HEAD-shaped read of the
   repo's own metadata is enough: it needs the same Contents permission real
   sync will need, and it writes nothing. */
export async function checkToken() {
  const token = store.state.settings.token;
  if (!token) { set("none", "No token set"); return status; }

  set("checking", "Checking token...");
  try {
    github.setToken(token);
    await github.getFile("calendar/data/roadmap.md");
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
