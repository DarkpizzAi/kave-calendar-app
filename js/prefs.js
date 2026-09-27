/* Compass: the Calendar preferences in Settings (spec section 3, Settings).
   Calendar defaults (view, detail level, card style) and, per person and per
   view, which categories show. Hidden categories are stored rather than shown
   ones, so a category added later shows for everyone until someone hides it.
   Pure: the store persists what these return. */
"use strict";

import { CATEGORIES } from "./icons.js";
import { PEOPLE } from "./model.js";

export const VIEW_NAMES = [["grid", "Grid"], ["agenda", "Agenda"]];
export const DETAIL_NAMES = [["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]];
export const STYLE_NAMES = [["lines", "Icon and title"], ["icons", "Icons only"]];
const TYPES = CATEGORIES.map((c) => c.type);
const oneOf = (list, v, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const labelOf = (list, v) => list.find(([k]) => k === v)[1];

/* F17 (2026-09-25) restricted the old Glance to "big things" (away trips,
   business trips, visitors) because it drew only those four regardless of
   what this module's stored defaults said -- a drift between what Settings
   claimed and what actually showed. The Glance redesign (one emoji per day,
   picked by priority) removed that drift a different way: every category
   can render, so there is no longer a mismatch to guard against. Every view
   now starts with nothing hidden. */
const defaultHidden = () => [];

/* Free-time blocking: which categories count against a free weekend/long
   weekend/opportunity. One list, shared by both people -- symmetric, not
   "my categories" vs "their categories" (spec section 4). Default: things
   usually booked and paid for in advance (a trip, a concert, a work
   commitment); casual, easy-to-move plans don't block. */
export const BLOCKING_DEFAULT = [
  "live-music", "birthday", "cinema", "activity", "business-trip",
  "work", "visitor", "transport", "accommodation",
];

/* Old view names, still possibly sitting in someone's saved settings from
   before a rename. Two renames deep now:
   - 2026-09-25: weekly/monthly/yearly -> grid/agenda/glance.
   - 2026-09-27: the weekly grid view was dropped outright and Glance (the
     yearly month-grid) took over the name "grid". There is nothing sane to
     migrate the old weekly-grid's saved settings *to* -- that view is gone
     -- so both its old and new key names map to null and are discarded
     rather than silently contaminating the new Grid's settings. yearly and
     glance both become grid, monthly stays agenda. */
const OLD_VIEW_NAME = { weekly: null, monthly: "agenda", yearly: "grid", grid: null, glance: "grid" };
const migrateViewKey = (v) => (v in OLD_VIEW_NAME ? OLD_VIEW_NAME[v] : v);

/* Settings as stored -> clean preferences. Anything unexpected falls back. */
export function readPrefs(settings) {
  const s = settings || {};
  const raw = s.hiddenCategories && typeof s.hiddenCategories === "object" ? s.hiddenCategories : {};
  const hiddenCategories = {};
  for (const p of PEOPLE) {
    hiddenCategories[p] = {};
    const rawPerson = raw[p] && typeof raw[p] === "object" ? raw[p] : {};
    const migratedPerson = {};
    for (const [oldOrNewKey, list] of Object.entries(rawPerson)) migratedPerson[migrateViewKey(oldOrNewKey)] = list;
    for (const [v] of VIEW_NAMES) {
      const list = migratedPerson[v];
      hiddenCategories[p][v] = Array.isArray(list) ? list.filter((t) => TYPES.includes(t)) : defaultHidden();
    }
  }
  const blockingCategories = Array.isArray(s.blockingCategories)
    ? s.blockingCategories.filter((t) => TYPES.includes(t))
    : BLOCKING_DEFAULT;
  return {
    defaultView: oneOf(VIEW_NAMES, migrateViewKey(s.defaultView), "grid"),
    defaultDetail: oneOf(DETAIL_NAMES, s.defaultDetail, "full"),
    cardStyle: oneOf(STYLE_NAMES, s.cardStyle, "lines"),
    showWeekdayHeader: s.showWeekdayHeader !== false,
    hiddenCategories,
    blockingCategories,
  };
}

export function toggleWeekdayHeader(prefs) {
  return { ...prefs, showWeekdayHeader: !prefs.showWeekdayHeader };
}

/* Reset restores nothing-hidden, the same set defaultHidden() already
   falls back to for stored junk. */
export function resetCategories(prefs) {
  const hiddenCategories = {};
  for (const p of PEOPLE) {
    hiddenCategories[p] = {};
    for (const [v] of VIEW_NAMES) hiddenCategories[p][v] = defaultHidden();
  }
  return { ...prefs, hiddenCategories };
}

export function isShown(prefs, me, view, type) {
  const h = prefs.hiddenCategories[me];
  return !(h && h[view] && h[view].includes(type));
}

export function toggleCategory(prefs, me, view, type) {
  const cur = prefs.hiddenCategories[me][view];
  const next = cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type];
  return { ...prefs, hiddenCategories: { ...prefs.hiddenCategories, [me]: { ...prefs.hiddenCategories[me], [view]: next } } };
}

export function blocksFreeTime(prefs, type) {
  return prefs.blockingCategories.includes(type);
}

export function toggleBlocking(prefs, type) {
  const cur = prefs.blockingCategories;
  const next = cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type];
  return { ...prefs, blockingCategories: next };
}

/* Same "no activities reads as Other" rule byCategories already uses --
   reused, not re-derived, so the two can't drift apart (Review Focus). */
export function eventBlocksFreeTime(prefs, event) {
  const types = event.activities && event.activities.length ? event.activities.map((a) => a.type) : ["none"];
  return types.some((t) => blocksFreeTime(prefs, t));
}

export const freeTimeSummary = (p) => `${p.blockingCategories.length} of ${TYPES.length} block`;

/* An event shows while any of its activities' categories shows; an event
   with no activity counts as Other. Dinner then drinks stays visible to
   someone who hides eating out but not drinks. */
export function byCategories(events, prefs, me, view) {
  return events.filter((e) => {
    const types = e.activities && e.activities.length ? e.activities.map((a) => a.type) : ["none"];
    return types.some((t) => isShown(prefs, me, view, t));
  });
}

export const defaultsSummary = (p) =>
  `${labelOf(VIEW_NAMES, p.defaultView)}, ${labelOf(DETAIL_NAMES, p.defaultDetail)}, ${labelOf(STYLE_NAMES, p.cardStyle)}`;

export function categoriesSummary(p, me) {
  return VIEW_NAMES.map(([v, l]) => {
    const n = TYPES.filter((t) => isShown(p, me, v, t)).length;
    return `${l} ${n === TYPES.length ? "all" : n}`;
  }).join(", ");
}
