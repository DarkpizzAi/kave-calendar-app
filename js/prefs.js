/* Compass: the Calendar preferences in Settings (spec section 3, Settings).
   Calendar defaults (view, detail level) and the weekday letters. Every
   category always shows: the old per-view "hidden categories" setting was
   retired with its Settings screen, and a stored list is ignored so nothing
   can stay hidden with no way back. (Free-time blocking was retired too.)
   Pure: the store persists what these return. */
"use strict";

export const VIEW_NAMES = [["grid", "Grid"], ["agenda", "Agenda"]];
/* Partial (the other person greyed) was retired on 2026-10-11, once grey
   became every level's rule: a saved "partial" reads as Full, which now
   looks exactly as Partial did. */
export const DETAIL_NAMES = [["full", "Full"], ["minimal", "Minimal"]];
const oneOf = (list, v, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const labelOf = (list, v) => list.find(([k]) => k === v)[1];

/* Old view names that may still sit in a saved defaultView: yearly and
   glance became grid, monthly became agenda; weekly has nothing to map to,
   so it falls back to the default. "grid" is not here: it is today's Grid,
   a valid choice, never an old name to drop. */
const OLD_VIEW_NAME = { weekly: null, monthly: "agenda", yearly: "grid", glance: "grid" };
const migrateViewKey = (v) => (Object.prototype.hasOwnProperty.call(OLD_VIEW_NAME, v) ? OLD_VIEW_NAME[v] : v);

/* Settings as stored -> clean preferences. Anything unexpected falls back. */
export function readPrefs(settings) {
  const s = settings || {};
  return {
    defaultView: oneOf(VIEW_NAMES, migrateViewKey(s.defaultView), "grid"),
    defaultDetail: oneOf(DETAIL_NAMES, s.defaultDetail, "full"),
    showWeekdayHeader: s.showWeekdayHeader !== false,
  };
}

export function toggleWeekdayHeader(prefs) {
  return { ...prefs, showWeekdayHeader: !prefs.showWeekdayHeader };
}

export const defaultsSummary = (p) =>
  `${labelOf(VIEW_NAMES, p.defaultView)}, ${labelOf(DETAIL_NAMES, p.defaultDetail)}`;

