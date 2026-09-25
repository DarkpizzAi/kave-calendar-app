/* Compass: the Calendar screen's decisions, as pure functions (spec section
   3, prototype P4). Drawing lives in calendar.js; anything here that decides
   what shows, what can be tapped or when to load more is tested. */
"use strict";

import { addDays, dayOfWeek, mondayOf, daysOf } from "./dates.js";
import { firstWeekOf } from "./views.js";
import { iconFor } from "./icons.js";
import { applyDetail } from "./filter.js";

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
/* Also prefs.js's single source for Yearly's default-shown categories
   (F17): the "who is away" set plus "visitor" is what Yearly always meant
   by "big things", so it is exported rather than re-declared. */
export const AWAY = ["transport", "accommodation", "business-trip"];

/* Monthly's "who is away" line. */
export const isAway = (e) => has(e, AWAY);

/* Yearly's big things: trips away, visitors, business trips; never birthdays. */
export function isBig(e) {
  if (has(e, ["birthday"])) return false;
  return isAway(e) || has(e, ["visitor"]);
}

/* An event's real last day: daysOf caps a span at 62 days and reads an end
   before the start as one day, so a typo'd end (2099) stretches nothing
   (final review M1). */
const lastDay = (e) => { const d = daysOf(e); return d.length ? d[d.length - 1] : e.start; };
export function lastEventDay(events) {
  return events.reduce((m, e) => { const l = lastDay(e); return l > m ? l : m; }, "");
}

export function awayText(e, thisYear) {
  const who = e.owner === "shared" ? e.title : `${e.owner === "isa" ? "Isa" : "Hugo"} in ${e.title}`;
  return `${who}, ${shortDate(e.start, thisYear)} to ${shortDate(lastDay(e), thisYear)}`;
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

/* One rule for a finished drag, mouse or touch: a clear sideways swipe
   changes view, a pull down from the very top reveals See previous (and
   syncs); anything else is an ordinary scroll. */
export function gesture({ dx, dy, top, searching }) {
  if (searching) return null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx < 0 ? "next" : "prev";
  if (top && dy > 60 && Math.abs(dy) > Math.abs(dx)) return "pull";
  return null;
}

/* See previous: reveal more of what is loaded, load the year before, or
   nothing, once kave-hub has no older year. */
export function seePrevious({ from, firstMonday, exhausted }) {
  if (from > firstMonday) return "more";
  return exhausted ? "none" : "older";
}

/* Yearly's past months, oldest first: the last `count` months before this
   one, never before January of the floor year. */
export function pastMonths(today, floorYear, count) {
  const out = [];
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  while (out.length < count) {
    if (--m < 0) { m = 11; y--; }
    if (y < Number(floorYear)) break;
    out.unshift(`${y}-${String(m + 1).padStart(2, "0")}`);
  }
  return out;
}

/* F7: "See previous" / the floating "load older" button jump straight to 1
   January of the current floor year in one go, instead of revealing a few
   weeks or months at a time. */
export function fullPastWeeks(thisMonday, floorYear) {
  const floorMonday = mondayOf(floorYear + "-01-01");
  return Math.max(0, Math.round((Date.parse(thisMonday) - Date.parse(floorMonday)) / 6048e5));
}
export function fullPastMonths(today, floorYear) {
  return pastMonths(today, floorYear, 9999).length;
}

/* F7: "Back to today" discards whatever earlier years were loaded, so the
   list is back to its normal range (this year on) and pull to refresh works
   again -- the bug was old, loaded years sitting in the DOM state. */
export function backToTodayState(thisYear) {
  return { past: { weekly: 0, monthly: 0, yearly: 0 }, floor: thisYear, exhausted: false };
}

/* F3: the Calendar nav icon's badge. Minimal shows only the viewer's own
   (and shared) events today; Partial and Full show both people's -- exactly
   applyDetail's own "minimal drops theirs" rule, reused rather than
   reinvented. `eventsToday` is undeduped by span (indexByDay already gives
   one entry per day). */
export function todaysCount(eventsToday, me, detail) {
  return applyDetail(eventsToday.filter((e) => !e.deleted), me, detail).length;
}

/* The emoji for an event, drawn for this viewer. A dated idea shows ❔. */
export function iconsOf(e, viewer) {
  if (e.status === "idea") return ["❔"];
  const acts = e.activities && e.activities.length ? e.activities : [{ type: "none" }];
  return acts.map((a) => iconFor(a, e, viewer));
}

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function searchEvents(events, query) {
  const q = fold(query).trim();
  if (!q) return [];
  return events.filter((e) => !e.deleted && fold([e.title, e.venue, e.city, e.guests, e.notes].join(" ")).includes(q))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

export { addDays };
