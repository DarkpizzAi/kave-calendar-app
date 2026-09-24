/* Compass: the Calendar screen's decisions, as pure functions (spec section
   3, prototype P4). Drawing lives in calendar.js; anything here that decides
   what shows, what can be tapped or when to load more is tested. */
"use strict";

import { addDays, dayOfWeek, mondayOf, daysOf } from "./dates.js";
import { firstWeekOf } from "./views.js";
import { iconFor } from "./icons.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "Mon 21" in rows; another year's date says its month and year. */
export function shortDate(day, thisYear) {
  const base = `${DOW[dayOfWeek(day)]} ${Number(day.slice(8))}`;
  return day.slice(0, 4) === thisYear ? base : `${base} ${MON[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/* Weekly: day cards three a row (3, 3, 1), one row of seven when wide. */
export function weekRows(days, wide) {
  if (wide) return [days.slice()];
  return [days.slice(0, 3), days.slice(3, 6), days.slice(6)];
}

/* day -> events on it, in start order; a span fills every day it covers. */
export function indexByDay(events) {
  const idx = new Map();
  const sorted = events.filter((e) => !e.deleted).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (const e of sorted) for (const d of daysOf(e)) {
    if (!idx.has(d)) idx.set(d, []);
    idx.get(d).push(e);
  }
  return new Map([...idx.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/* Empty is blank and cannot be tapped (spec: day cards, week cards, rows). */
export const tappable = (events) => events.length > 0;

/* Jumps land the target week at the top of Monthly. */
export const zoomWeekTarget = (day) => mondayOf(day);
export const zoomMonthTarget = (ym) => firstWeekOf(ym);

const has = (e, types) => (e.activities || []).some((a) => types.includes(a.type));
const AWAY = ["transport", "accommodation", "business-trip"];

/* Monthly's "who is away" line. */
export const isAway = (e) => has(e, AWAY);

/* Yearly's big things: trips away, visitors, business trips; never birthdays. */
export function isBig(e) {
  if (has(e, ["birthday"])) return false;
  return isAway(e) || has(e, ["visitor"]);
}

export function awayText(e, thisYear) {
  const who = e.owner === "shared" ? e.title : `${e.owner === "isa" ? "Isa" : "Hugo"} in ${e.title}`;
  return `${who}, ${shortDate(e.start, thisYear)} to ${shortDate(e.end || e.start, thisYear)}`;
}

/* Load more only on a real scroll of a list that actually scrolls, near its
   bottom, never past the range. A host that lets the page grow to full
   height makes "near the bottom" always true; loading from a draw there
   redrew forever and taps never became clicks (P3.1). */
export function shouldLoadMore(box, { count, cap, pending, searching }) {
  if (pending || searching || count >= cap) return false;
  if (box.scrollHeight <= box.clientHeight + 1) return false;
  return box.scrollTop + box.clientHeight >= box.scrollHeight - 500;
}
export const nextCount = (count, step, cap) => Math.min(cap, count + step);

/* The emoji for an event, drawn for this viewer. A dated idea shows ❔. */
export function iconsOf(e, viewer) {
  if (e.status === "idea") return ["❔"];
  const acts = e.activities && e.activities.length ? e.activities : [{ type: "none" }];
  return acts.map((a) => iconFor(a, e, viewer));
}

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function searchEvents(events, query) {
  const q = fold(query).trim();
  if (!q) return [];
  return events.filter((e) => !e.deleted && fold([e.title, e.venue, e.city, e.guests, e.notes].join(" ")).includes(q))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

export { addDays };
