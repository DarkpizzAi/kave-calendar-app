/* Compass: what lives on the phone. A cache per year file (events, sha,
   etag) and one queue of edits not yet on GitHub, coalesced per event.
   Storage is injected so tests run on a fake; the app passes localStorage. */
"use strict";

const Q = "compass.queue";
const yearKey = (y) => `compass.events.${y}`;

export function createLocal(storage) {
  function read(key, fallback) {
    try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }
  /* true when stored. A cache that fails to store only costs a re-download;
     an edit that fails to store is lost, so enqueue says so (below). */
  function write(key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
  return {
    getYear: (y) => read(yearKey(y), null),
    setYear: (y, rec) => write(yearKey(y), rec),
    /* Years with a cached file on this phone (the Archive and search read
       these without asking the network). */
    cachedYears() {
      let keys = [];
      try {
        keys = typeof storage.keys === "function" ? storage.keys()
          : Array.from({ length: storage.length || 0 }, (_, i) => storage.key(i));
      } catch { /* blocked storage */ }
      return keys.map((k) => /^compass\.events\.(\d{4})$/.exec(k || "")).filter(Boolean).map((m) => m[1]).sort();
    },
    enqueue(year, record) {
      const q = read(Q, {});
      q[year] = q[year] || {};
      q[year][record.id] = record;
      /* the phone's storage is shared with Spoon and the hub: when it is
         full, the edit must fail out loud (the form shows the message)
         rather than vanish */
      if (!write(Q, q)) throw new Error("the phone's storage is full, so this edit was not kept");
    },
    pendingYears() {
      const q = read(Q, {});
      return Object.keys(q).filter((y) => Object.keys(q[y]).length).sort();
    },
    pendingFor: (year) => Object.values(read(Q, {})[year] || {}),
    /* Only drop what was actually sent: an edit queued while the flush was in
       flight has a different timestamp and must stay for the next flush. */
    dequeue(year, flushed) {
      const q = read(Q, {});
      for (const r of flushed) {
        const cur = q[year] && q[year][r.id];
        if (cur && cur.updated.at === r.updated.at) delete q[year][r.id];
      }
      if (q[year] && !Object.keys(q[year]).length) delete q[year];
      write(Q, q);
    },
  };
}
