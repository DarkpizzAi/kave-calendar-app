/* Compass: the one data instance the views read. Events in memory per loaded
   year, merged with the queue so an edit shows before it reaches GitHub. */
"use strict";

import { collectYears, mergeEvents } from "./merge.js";
import { touch, writesFor, markDeleted, restore, PEOPLE } from "./model.js";

export function createData({ sync, local, now, me }) {
  const years = {};
  const listeners = [];
  const yearFlight = {}, knownEmpty = new Set();
  let allFlight = null;
  const notify = () => listeners.forEach((fn) => fn());

  /* A cached year's `events` must be an array. Anything else (a stale or
     corrupt cache) would make mergeEvents throw synchronously, outside
     ensureYear's try/catch, and calendar.js's offline catch would swallow it,
     so a whole year would vanish without a symptom. Normalise instead: a
     broken cache reads as an empty year. */
  function view(y) {
    const raw = (local.getYear(y) || { events: [] }).events;
    const cached = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    return mergeEvents(cached, local.pendingFor(y));
  }
  function refresh(y) { years[y] = view(y); }

  function requireMe() {
    const who = me();
    if (!PEOPLE.includes(who)) throw new Error("choose who you are in Settings first");
    return who;
  }

  return {
    subscribe: (fn) => listeners.push(fn),
    events: () => collectYears(years),
    loadedYears: () => Object.keys(years).sort(),
    /* one load per year at a time: a second ask shares the first */
    ensureYear(y) {
      if (yearFlight[y]) return yearFlight[y];
      if (!years[y]) { refresh(y); notify(); }
      const p = (async () => {
        try { await sync.loadYear(y); } finally { refresh(y); notify(); }
      })().finally(() => { delete yearFlight[y]; });
      return (yearFlight[y] = p);
    },
    /* the years a sync asks for: a year with no events and no file behind it
       (an empty one an earlier run cached) is not worth a request */
    syncYears: () => Object.keys(years).filter((y) => years[y].length || (local.getYear(y) || {}).sha).sort(),
    async sync(ys = Object.keys(years), opts = {}) {
      const r = await sync.syncNow(ys, opts);
      ys.forEach(refresh);
      notify();
      return r;
    },
    /* Everything there is, for the Archive and search: the cached years first
       (offline too), then, if online, one year at a time past either edge
       until a year comes back empty. Reads only. */
    loadAllYears(opts = {}) {
      if (allFlight) return allFlight;
      return (allFlight = this._loadAllYears(opts).finally(() => { allFlight = null; }));
    },
    async _loadAllYears({ online = true, probe = 12 } = {}) {
      const have = (y) => this.events().some((e) => !e.deleted && e.start && e.start.startsWith(y + "-"));
      const cached = local.cachedYears ? local.cachedYears() : [];
      for (const y of cached) {
        if (years[y]) continue;
        const rec = local.getYear(y);
        if (rec && !(Array.isArray(rec.events) ? rec.events.length : rec.events) && !rec.sha) continue; // an old empty entry
        /* offline, or not asked: the phone's copy is the answer, no request */
        if (!online) { refresh(y); notify(); continue; }
        try { await this.ensureYear(y); } catch { /* the cache is what shows */ }
      }
      if (!online) return;
      const known = [...new Set([...Object.keys(years), ...cached])].filter(have).sort();
      if (!known.length) return;
      for (const dir of [-1, 1]) {
        let y = Number(dir < 0 ? known[0] : known[known.length - 1]);
        for (let i = 0; i < probe; i++) {
          y += dir;
          const k = String(y);
          if (years[k]) { if (!have(k)) break; continue; }
          if (knownEmpty.has(k)) break;
          /* a read that stores nothing for a missing year: only a year with
             events joins the loaded (and so the synced) set */
          let got;
          try { got = await sync.probeYear(k); } catch { break; }
          if (!got || !got.length) { knownEmpty.add(k); break; }
          refresh(k); notify();
        }
      }
    },
    save(prev, next) {
      const who = requireMe();
      /* an event that vanished under an open form (the other phone deleted
         it) must not be saved as a record with no id (final review I3) */
      if (!next || !next.id || (prev !== null && !prev)) throw new Error("this event is no longer here");
      const stamped = touch(next, who, now());
      for (const w of writesFor(prev, stamped)) { local.enqueue(w.year, w.record); refresh(w.year); }
      notify();
      sync.syncNow(Object.keys(years)).then(() => { Object.keys(years).forEach(refresh); notify(); });
      return stamped;
    },
    remove(e) {
      const who = requireMe();
      const gone = markDeleted(e, who, now());
      local.enqueue(gone.start.slice(0, 4), gone); refresh(gone.start.slice(0, 4)); notify();
      sync.syncNow(Object.keys(years));
      return gone;
    },
    undoRemove(gone) {
      const who = requireMe();
      const back = restore(gone, who, now());
      local.enqueue(back.start.slice(0, 4), back); refresh(back.start.slice(0, 4)); notify();
      sync.syncNow(Object.keys(years));
      return back;
    },
  };
}

/* The app's instance. Built lazily so tests can import createData without
   touching localStorage or the network. */
let instance = null;
export async function appData() {
  if (instance) return instance;
  const [{ github }, { store }, { createLocal }, { createSync }] = await Promise.all([
    import("../github.js"), import("./store.js"), import("./local.js"), import("./sync.js"),
  ]);
  github.setToken(store.state.settings.token);
  const local = createLocal(localStorage);
  instance = createData({
    sync: createSync({ gh: github, local }), local,
    now: () => new Date(), me: () => store.state.settings.me,
  });
  return instance;
}
