/* Compass: the Calendar preferences in Settings (spec section 3, Settings).
   Calendar defaults (view, detail level), the weekday letters and
   which categories block free time. Every category always shows: the old
   per-view "hidden categories" setting was retired with its Settings screen,
   and a stored list is ignored so nothing can stay hidden with no way back.
   Pure: the store persists what these return. */
"use strict";

import { CATEGORIES } from "./icons.js";

export const VIEW_NAMES = [["grid", "Grid"], ["agenda", "Agenda"]];
export const DETAIL_NAMES = [["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]];
const TYPES = CATEGORIES.map((c) => c.type);
const oneOf = (list, v, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const labelOf = (list, v) => list.find(([k]) => k === v)[1];

/* Free-time blocking: which categories count against a free weekend/long
   weekend/opportunity. One list, shared by both people -- symmetric, not
   "my categories" vs "their categories" (spec section 4). Default: things
   usually booked and paid for in advance (a trip, a concert, a work
   commitment); casual, easy-to-move plans don't block. */
export const BLOCKING_DEFAULT = [
  "live-music", "birthday", "cinema", "activity", "business-trip",
  "work", "visitor", "transport", "accommodation",
];

/* Old view names that may still sit in a saved defaultView: yearly and
   glance became grid, monthly became agenda. weekly and the old "grid" (a
   weekly grid, since dropped) have nothing to map to, so they fall back to
   the default. */
const OLD_VIEW_NAME = { weekly: null, monthly: "agenda", yearly: "grid", grid: null, glance: "grid" };
const migrateViewKey = (v) => (v in OLD_VIEW_NAME ? OLD_VIEW_NAME[v] : v);

/* Settings as stored -> clean preferences. Anything unexpected falls back. */
export function readPrefs(settings) {
  const s = settings || {};
  const blockingCategories = Array.isArray(s.blockingCategories)
    ? s.blockingCategories.filter((t) => TYPES.includes(t))
    : BLOCKING_DEFAULT;
  return {
    defaultView: oneOf(VIEW_NAMES, migrateViewKey(s.defaultView), "grid"),
    defaultDetail: oneOf(DETAIL_NAMES, s.defaultDetail, "full"),
    showWeekdayHeader: s.showWeekdayHeader !== false,
    blockingCategories,
  };
}

export function toggleWeekdayHeader(prefs) {
  return { ...prefs, showWeekdayHeader: !prefs.showWeekdayHeader };
}

export function blocksFreeTime(prefs, type) {
  return prefs.blockingCategories.includes(type);
}

export function toggleBlocking(prefs, type) {
  const cur = prefs.blockingCategories;
  const next = cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type];
  return { ...prefs, blockingCategories: next };
}

/* An event with no activity counts as Other ("none"). */
export function eventBlocksFreeTime(prefs, event) {
  const types = event.activities && event.activities.length ? event.activities.map((a) => a.type) : ["none"];
  return types.some((t) => blocksFreeTime(prefs, t));
}

export const freeTimeSummary = (p) => `${p.blockingCategories.length} of ${TYPES.length} block`;

export const defaultsSummary = (p) =>
  `${labelOf(VIEW_NAMES, p.defaultView)}, ${labelOf(DETAIL_NAMES, p.defaultDetail)}`;

