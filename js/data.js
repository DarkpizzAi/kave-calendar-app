/* Compass: the one data instance the views read. Events in memory per loaded
   year, merged with the queue so an edit shows before it reaches GitHub. */
"use strict";

import { collectYears, mergeEvents } from "./merge.js";
import { touch, writesFor, markDeleted, restore, PEOPLE } from "./model.js";

export function createData({ sync, local, now, me }) {
  const years = {};
  const listeners = [];
  const notify = () => listeners.forEach((fn) => fn());

  function view(y) {
    const cached = (local.getYear(y) || { events: [] }).events;
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
    async ensureYear(y) {
      if (!years[y]) { refresh(y); notify(); }
      try { await sync.loadYear(y); } finally { refresh(y); notify(); }
    },
    async sync(ys = Object.keys(years)) {
      const r = await sync.syncNow(ys);
      ys.forEach(refresh);
      notify();
      return r;
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
