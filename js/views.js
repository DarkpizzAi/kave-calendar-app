/* Compass: the shape of the three views, as data (spec: prototype P3 is the
   reference). Weekly draws days, Monthly draws weeks, Yearly draws months;
   Monthly is the hub. Everything here is pure and tested; drawing lives in
   the view modules. */
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

/* How far the views reach: back to 1 January of this year; forward to the end
   of the year after next, or to the last event if that is later. */
export function loadRange(today, lastEventDay) {
  const max = (Number(today.slice(0, 4)) + 2) + "-12-31";
  return { min: today.slice(0, 4) + "-01-01", max: lastEventDay && lastEventDay > max ? lastEventDay : max };
}

/* ---- free weekends (Monthly): the current and the next month only ---- */
export function freeWeekendSaturday(monday, eventsOn, today) {
  const sat = addDays(monday, 5);
  const thisMonth = today.slice(0, 7);
  const next = addDays(thisMonth + "-28", 7).slice(0, 7);
  if (![thisMonth, next].includes(sat.slice(0, 7))) return null;
  return [4, 5, 6].every((k) => !eventsOn(addDays(monday, k)).length) ? sat : null;
}

/* ---- long weekends (Yearly), from the bank holidays ---- */
const offDay = (holidays) => (d) => dayOfWeek(d) >= 5 || !!holidays[d];

/* Every weekday holiday grows through the weekends and holidays around it
   into one block of days off. Two holidays in one block (Good Friday and
   Easter Monday) give one block, found from the first of them. */
export function weekendBlocks(holidays, from, to) {
  const off = offDay(holidays); const seen = new Set(); const out = [];
  for (const anchor of Object.keys(holidays).sort()) {
    if (anchor < from || anchor > to || dayOfWeek(anchor) >= 5) continue;
    let start = anchor, end = anchor;
    while (off(addDays(start, -1))) start = addDays(start, -1);
    while (off(addDays(end, 1))) end = addDays(end, 1);
    if (seen.has(start)) continue;
    seen.add(start);
    const length = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
    out.push({ anchor, start, end, length });
  }
  return out;
}

/* Decide what a block of days off is worth to plan around.
   Returns { kind: "long" | "chance", start, end } or null.
   - "long": the block is already three or more days off in a row.
   - "chance": a one-day holiday on a Thursday or a Tuesday, where taking the
     Friday or the Monday off makes four days (start and end cover all four).
   - null: anything else (a lone Wednesday, say), not worth flagging. */
export function classifyWeekend(block) {
  if (block.length >= 3) return { kind: "long", start: block.start, end: block.end };
  if (block.length !== 1) return null;
  const dow = dayOfWeek(block.anchor);
  if (dow === 3) return { kind: "chance", start: block.anchor, end: addDays(block.anchor, 3) };
  if (dow === 1) return { kind: "chance", start: addDays(block.anchor, -3), end: block.anchor };
  return null;
}

export function longWeekends(holidays, from, to, eventsOn) {
  const out = [];
  for (const block of weekendBlocks(holidays, from, to)) {
    const c = classifyWeekend(block);
    if (!c) continue;
    const days = [];
    for (let d = c.start; d <= c.end; d = addDays(d, 1)) days.push(d);
    const busy = days.some((d) => eventsOn(d).length);
    const names = [...new Set(days.filter((d) => holidays[d]).map((d) => holidays[d]))].join(", ");
    const text = c.kind === "chance" ? "Long weekend opportunity" : busy ? "Long weekend" : "Free long weekend";
    out.push({ ...c, text, names });
  }
  return out;
}

/* ---- the Yearly stats card: trips, cities, plans first; never costs ---- */
export function yearStats(events, today) {
  const year = today.slice(0, 4);
  const past = events.filter((e) => e.start.startsWith(year) && e.start <= today && !e.deleted);
  const trips = past.filter((e) => e.away);
  const nights = trips.reduce((n, e) => n + Math.max(0, Math.round((Date.parse(e.end || e.start) - Date.parse(e.start)) / 864e5)), 0);
  const byType = {};
  for (const e of past) {
    const t = (e.activities && e.activities[0] && e.activities[0].type) || "none";
    if (!e.away && t !== "none") byType[t] = (byType[t] || 0) + 1;
  }
  return {
    trips: trips.length,
    cities: new Set(trips.map((e) => e.city).filter(Boolean)).size,
    plans: past.length,
    nightsAway: nights,
    visitors: past.filter((e) => e.activities && e.activities.some((a) => a.type === "visitor")).length,
    byType,
  };
}
