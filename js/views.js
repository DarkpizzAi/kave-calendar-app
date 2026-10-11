/* Compass: the shape of the two views, as data (spec: prototype P3 is the
   reference). Agenda draws weeks, Grid draws months; Agenda is the hub.
   Everything here is pure and tested; drawing lives in the view modules. */
"use strict";

import { addDays, mondayOf, dayOfWeek } from "./dates.js";

/* ---- weeks ---- */
export function isoWeek(day) {
  const thursday = addDays(day, 3 - dayOfWeek(day));
  const jan4 = thursday.slice(0, 4) + "-01-04";
  const week1 = mondayOf(jan4);
  return 1 + Math.round((Date.parse(mondayOf(thursday)) - Date.parse(week1)) / 6048e5);
}

/* A week belongs to the month holding its Thursday, so no week is shown twice. */
export const monthOfWeek = (monday) => addDays(monday, 3).slice(0, 7);

export function firstWeekOf(ym) {
  const m = mondayOf(ym + "-01");
  return monthOfWeek(m) === ym ? m : addDays(m, 7);
}

/* How far the views reach: back to 1 January of this year, or of the oldest
   year loaded on demand (See previous goes on into earlier years); forward
   to the end of the year after next, or to the last event if that is later. */
export function loadRange(today, lastEventDay, floorYear) {
  const max = (Number(today.slice(0, 4)) + 2) + "-12-31";
  const from = floorYear && floorYear < today.slice(0, 4) ? floorYear : today.slice(0, 4);
  return { min: from + "-01-01", max: lastEventDay && lastEventDay > max ? lastEventDay : max };
}
