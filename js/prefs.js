/* Compass: the Calendar preferences in Settings (spec section 3, Settings).
   Calendar defaults (view, detail level, card style) and, per person and per
   view, which categories show. Hidden categories are stored rather than shown
   ones, so a category added later shows for everyone until someone hides it.
   Pure: the store persists what these return. */
"use strict";

import { CATEGORIES } from "./icons.js";
import { PEOPLE } from "./model.js";
import { AWAY } from "./cal-model.js";

export const VIEW_NAMES = [["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
export const DETAIL_NAMES = [["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]];
export const STYLE_NAMES = [["lines", "Icon and title"], ["icons", "Icons only"]];
const TYPES = CATEGORIES.map((c) => c.type);
const oneOf = (list, v, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const labelOf = (list, v) => list.find(([k]) => k === v)[1];

/* F17: Yearly's real filter is "big things" (trips away, visitors, business
   trips; never birthdays, spec section 3) -- the same set Yearly's own
   rendering (cal-model.js's AWAY, plus "visitor") already used, hard-coded,
   with no path through here. That is the drift Isa found: this module's
   stored defaults said "everything shows", while Yearly actually only ever
   drew four categories. One list now, imported rather than re-declared, so
   the Categories grid and the Calendar cannot disagree again. This becomes
   the new default (Isa, 2026-09-25), not a return to "show everything". */
export const YEARLY_DEFAULT_SHOWN = [...AWAY, "visitor"];
const defaultHidden = (view) => (view === "yearly" ? TYPES.filter((t) => !YEARLY_DEFAULT_SHOWN.includes(t)) : []);

/* Settings as stored -> clean preferences. Anything unexpected falls back. */
export function readPrefs(settings) {
  const s = settings || {};
  const raw = s.hiddenCategories && typeof s.hiddenCategories === "object" ? s.hiddenCategories : {};
  const hiddenCategories = {};
  for (const p of PEOPLE) {
    hiddenCategories[p] = {};
    for (const [v] of VIEW_NAMES) {
      const list = raw[p] && raw[p][v];
      hiddenCategories[p][v] = Array.isArray(list) ? list.filter((t) => TYPES.includes(t)) : defaultHidden(v);
    }
  }
  return {
    defaultView: oneOf(VIEW_NAMES, s.defaultView, "weekly"),
    defaultDetail: oneOf(DETAIL_NAMES, s.defaultDetail, "full"),
    cardStyle: oneOf(STYLE_NAMES, s.cardStyle, "lines"),
    hiddenCategories,
  };
}

/* F18: Reset restores these corrected defaults, not the old "everything on"
   bug -- same set defaultHidden() already falls back to for stored junk. */
export function resetCategories(prefs) {
  const hiddenCategories = {};
  for (const p of PEOPLE) {
    hiddenCategories[p] = {};
    for (const [v] of VIEW_NAMES) hiddenCategories[p][v] = defaultHidden(v);
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
