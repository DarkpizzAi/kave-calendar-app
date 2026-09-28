/* Compass: the Calendar screen's decisions, as pure functions (spec section
   3, prototype P4). Drawing lives in calendar.js; anything here that decides
   what shows, what can be tapped or when to load more is tested. */
"use strict";

import { addDays, dayOfWeek, mondayOf, daysOf } from "./dates.js";
import { firstWeekOf } from "./views.js";
import { iconFor } from "./icons.js";
import { applyDetail } from "./filter.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* "Mon 21": weekday and day of the month only. Every card already names its
   own month and year, so the line does not repeat them. `thisYear` stays in
   the signature because every caller passes it. */
export function shortDate(day, thisYear) {
  return `${DOW[dayOfWeek(day)]} ${Number(day.slice(8))}`;
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

/* Jumps land the target week at the top of Agenda. */
export const zoomWeekTarget = (day) => mondayOf(day);
export const zoomMonthTarget = (ym) => firstWeekOf(ym);

const has = (e, types) => (e.activities || []).some((a) => types.includes(a.type));
/* The "who is away" categories. Exported: Grid ranks a day's emoji by it. */
export const AWAY = ["transport", "accommodation", "business-trip"];

/* Agenda's "who is away" line. */
export const isAway = (e) => has(e, AWAY);

/* F35: a cancelled event is hidden outright in Grid ("if I really don't
   want to see them I'll delete them" is Isa's own escape hatch there);
   Agenda keeps it visible, struck through instead (calendar.js's cls()
   marks it, the CSS strikes only the title). */
export const hideCancelled = (events, view) => (view === "grid" ? events.filter((e) => e.status !== "cancelled") : events);

/* An event's real last day: daysOf caps a span at 62 days and reads an end
   before the start as one day, so a typo'd end (2099) stretches nothing
   (final review M1). */
const lastDay = (e) => { const d = daysOf(e); return d.length ? d[d.length - 1] : e.start; };
export function lastEventDay(events) {
  return events.reduce((m, e) => { const l = lastDay(e); return l > m ? l : m; }, "");
}

/* F22: a new event defaults its city to Barcelona, unless its date falls
   within a trip the person is already on -- reusing isAway (Agenda's own
   "away" test, spec section 3) rather than a second definition of "trip".
   `events` need not be pre-filtered: deleted events are skipped here. */
export function tripCityFor(events, date) {
  const e = events.find((ev) => !ev.deleted && isAway(ev) && daysOf(ev).includes(date));
  return e && e.city ? e.city : null;
}

/* F22: the form's actual default -- Barcelona, unless a trip's city wins. */
export const defaultCity = (events, date) => tripCityFor(events, date) || "barcelona";

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
   syncs); anything else is an ordinary scroll. F53: "the very top" only
   counts as the true top -- scrollTop<=0 alone is not enough once "load
   older" (F6/F29) has pulled earlier data in, because scrollTop 0 then sits
   at the start of THAT older content, not at today's normal range. A pull
   there must not arm; the down button (F28) is what collapses it back, and
   only after that does a pull at the visual top mean anything again. */
export function gesture({ dx, dy, top, searching, loadedOlder }) {
  if (searching) return null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx < 0 ? "next" : "prev";
  if (top && !loadedOlder && dy > 60 && Math.abs(dy) > Math.abs(dx)) return "pull";
  return null;
}

/* F53: whether the currently loaded content's visual top is still today's
   normal range, or whether "load older" has moved it -- the same state
   backToTodayState resets. Pure so gesture()'s arming condition and the
   down button's own "is there anything to collapse" both read one answer. */
export const hasLoadedOlder = (past) => Object.values(past).some(Boolean);

/* Grid's past months, oldest first: the last `count` months before this
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

/* How many weeks or months reach back to 1 January of the floor year, in
   one go (the Archive draws them all at once). */
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
  return { past: { grid: 0, agenda: 0 }, floor: thisYear, exhausted: false };
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

/* F16/F38: true when an event has at least one unchecked to-do -- the one
   place this is decided, so the list row's icon (calendar.js) and the
   single-day strip's icon (sheet.js) can never drift apart. */
export function hasOpenTodos(e) {
  return (e.checklist || []).some((c) => !c.done);
}

/* F37: the guests text with the viewer's own first name removed, so "Isa"
   never appears in guests shown on Isa's own phone even if she is listed.
   Guests is free text, comma-separated first names (spec section 1); a
   case-insensitive whole-name match is removed, the rest rejoined. */
export function guestsExcludingViewer(guests, viewerName) {
  const vn = String(viewerName || "").trim().toLowerCase();
  return String(guests || "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g && g.toLowerCase() !== vn)
    .join(", ");
}

/* The line under an event's title in the day sheet: guests alone, or
   empty. Never the status, which the pill above already shows. */
export function statusGuestsLine(guestsText) {
  return guestsText || "";
}

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function searchEvents(events, query) {
  const q = fold(query).trim();
  if (!q) return [];
  return events.filter((e) => !e.deleted && fold([e.title, e.venue, e.city, e.guests, e.notes].join(" ")).includes(q))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

export { addDays };
