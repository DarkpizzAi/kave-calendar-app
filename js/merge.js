/* Compass: merging. Per event, never per file: two people editing different
   events in the same year never conflict. The newest edit wins, except that
   a delete can only be undone by a restore made after it, because a phone
   that was offline during the delete must not resurrect the event. */
"use strict";

export function isNewer(a, b) {
  if (a.updated.at !== b.updated.at) return a.updated.at > b.updated.at;
  return a.updated.by > b.updated.by;
}

function pick(cur, inc) {
  if (!!cur.deleted !== !!inc.deleted) {
    const del = cur.deleted ? cur : inc;
    const live = cur.deleted ? inc : cur;
    return live.restoredAt && live.restoredAt > del.deletedAt ? live : del;
  }
  return isNewer(inc, cur) ? inc : cur;
}

export function mergeEvents(base, incoming) {
  const map = new Map(base.map((e) => [e.id, e]));
  for (const e of incoming) {
    const cur = map.get(e.id);
    map.set(e.id, cur ? pick(cur, e) : e);
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function collectYears(years) {
  const map = new Map();
  for (const list of Object.values(years)) {
    for (const e of list) {
      if (e.movedTo) continue;
      const cur = map.get(e.id);
      if (!cur || isNewer(e, cur)) map.set(e.id, e);
    }
  }
  return [...map.values()].filter((e) => !e.deleted);
}
