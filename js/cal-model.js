/* Compass: the Calendar screen's decisions, as pure functions (spec section
   3, prototype P4). Drawing lives in calendar.js; anything here that decides
   what shows, what can be tapped or when to load more is tested. */
"use strict";

import { addDays, dayOfWeek, mondayOf, daysOf } from "./dates.js";
import { CATEGORIES, iconFor } from "./icons.js";
import { applyDetail } from "./filter.js";
import { statusOf } from "./model.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* "Mon 21": weekday and day of the month only. Every card already names its
   own month and year, so the line does not repeat them. */
export function shortDate(day) {
  return `${DOW[dayOfWeek(day)]} ${Number(day.slice(8))}`;
}

/* Within one day: all-day and untimed first (a span's later days count as
   all-day, its start time belongs to its first day only), then by start time.
   Ties fall back to the earlier start, then the id, so the order is stable
   instead of whatever the merge happened to leave. */
const timeOn = (e, d) => (d === e.start && e.startTime ? e.startTime : "");
const byDayOrder = (d) => (a, b) => {
  const ta = timeOn(a, d), tb = timeOn(b, d);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/* day -> events on it, in day order (see byDayOrder); a span fills every day
   it covers. */
export function indexByDay(events) {
  const idx = new Map();
  for (const e of events) {
    if (e.deleted) continue;
    for (const d of daysOf(e)) {
      if (!idx.has(d)) idx.set(d, []);
      idx.get(d).push(e);
    }
  }
  for (const [d, list] of idx) list.sort(byDayOrder(d));
  return new Map([...idx.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/* One day's events, in day order, without indexing every day of every
   event: what the Day popup and the nav badge need. */
const covers = (e, d) => !e.deleted && e.start <= d && lastDay(e) >= d;
export const eventsOn = (events, d) => indexByDay(events.filter((e) => covers(e, d))).get(d) || [];

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

/* Where a day sits in an accommodation stay: "in" (its first day, check-in,
   also a one-day stay), "out" (its last day, check-out), "mid" (the days
   between), or null for anything that is not a stay. Agenda and Grid alike
   show a stay on check-in and check-out only (calendar.js's visibleOn drops
   the middle nights before either view draws a day; Isa, 2026-10-11: one
   rule for both views). Agenda names the two days; the Day popup still
   lists the stay on every night. */
export function stayRole(e, d) {
  if (!has(e, ["accommodation"])) return null;
  if (d === e.start) return "in";
  return d === lastDay(e) ? "out" : "mid";
}
export const isMidStay = (e, d) => stayRole(e, d) === "mid";

/* One emoji per day (Grid): the day's own most important activity, by a fixed
   priority. The first day of a visit comes first of all (a visitor arriving
   outranks even a flight or a check-in). Then away -- transport,
   accommodation, business trip -- then work, then every other category in
   the Settings catalogue order, "none" (Other) last. A stay's icon only
   takes its place on check-in; on check-out it ranks below everything, so
   any other icon wins and it still shows alone. (Grid never passes a
   middle night's stay in here -- see stayRole -- so on those nights the
   stay shows nothing.) A day
   with several activities across several events shows only the one that
   ranks highest; ties keep whichever was found first. */
export const DAY_PRIORITY = [...AWAY, "work", ...CATEGORIES.map((c) => c.type).filter((t) => !AWAY.includes(t) && t !== "work")];
/* Rank inside one person's group: lower wins. `order` is the viewer's Grid
   emoji order (Settings; defaults to DAY_PRIORITY). The two fixed rules sit
   outside it: a visitor's arrival tops everything, a stay off its check-in
   day ranks below everything. */
export const dayRank = (a, e, d, order = DAY_PRIORITY) => {
  if (a.type === "visitor" && d === e.start) return -1;
  if (a.type === "accommodation" && stayRole(e, d) !== "in") return order.length;
  const i = order.indexOf(a.type);
  return i < 0 ? order.indexOf("none") : i;
};
/* The {a, e} (activity, event) whose icon the day shows, or null. In my Grid
   (`me`), every emoji from my events (mine or shared) outranks every emoji
   from the other person's; within each group the order decides. */
export function pickDayIcon(evs, d, { order = DAY_PRIORITY, me = null } = {}) {
  let best = null, bestKey = Infinity;
  const span = order.length + 2;
  for (const e of evs) {
    const theirs = me && e.owner !== me && e.owner !== "shared" ? 1 : 0;
    const acts = e.activities && e.activities.length ? e.activities : [{ type: "none" }];
    for (const a of acts) {
      const key = theirs * span * 2 + dayRank(a, e, d, order) + 1;
      if (key < bestKey) { bestKey = key; best = { a, e }; }
    }
  }
  return best;
}
/* The words the Agenda adds to a stay's row; a one-day stay has no check-out
   to name, so it gets none. */
export const stayLabel = (e, d) => {
  const role = stayRole(e, d);
  return role === "in" && lastDay(e) > e.start ? "Check in" : role === "out" ? "Check out" : "";
};
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
   changes view, a pull down from the very top syncs; anything else is an
   ordinary scroll. (The main view never holds past weeks any more -- the
   Archive does -- so its top is always today's.) */
export function gesture({ dx, dy, top, searching }) {
  if (searching) return null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx < 0 ? "next" : "prev";
  if (top && dy > 60 && Math.abs(dy) > Math.abs(dx)) return "pull";
  return null;
}

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

/* F3: the Calendar nav icon's badge: what the views show on `day`. Minimal
   shows only the viewer's own (and shared) events; Full shows
   both people's -- applyDetail's own rule, reused. A cancelled event and
   the middle nights of a stay are not counted: no view shows them on the
   day. */
export function todaysCount(eventsToday, me, detail, day) {
  const shown = eventsToday.filter((e) => !e.deleted && e.status !== "cancelled" && !isMidStay(e, day));
  return applyDetail(shown, me, detail).length;
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

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/* Grid square: how many event dots fit on the top edge beside the day number
   on a 43px phone square. `extra` is the events beyond the one the emoji
   stands for: up to 3 dots, past that 2 and a "+". */
export function gridDots(extra) {
  if (extra <= 0) return { dots: 0, plus: false };
  return extra > 3 ? { dots: 2, plus: true } : { dots: extra, plus: false };
}

/* Day sheet links. A link is one of three tiers: tickets (0), the official
   app (1), the official website (2). TEMPORARY: links carry no type yet
   (typed links are on the roadmap), so the tier is read from the label. */
export function linkTier(l) {
  const t = fold(l && l.label);
  if (/ticket|wallet|boarding|voucher|billet|entrada/.test(t)) return 0;
  if (/\bapp\b/.test(t)) return 1;
  return 2;
}
/* The status the day sheet shows: an event with a ticket link counts as
   booked, unless it is cancelled. Display only, the stored status is never
   rewritten. */
export function shownStatus(e) {
  const s = statusOf(e);
  if (s === "cancelled") return s;
  return (e.links || []).some((l) => l && l.url && linkTier(l) === 0) ? "booked" : s;
}
/* A row shows only the best tier it has: all of it up to 3 links, or the
   first 2 when there are 4 or more. Everything else is counted in `more`. */
export function rowLinks(links) {
  const list = (links || []).filter((l) => l && l.url);
  if (!list.length) return { shown: [], more: 0, tier: 0 };
  const top = Math.min(...list.map(linkTier));
  const tier = list.filter((l) => linkTier(l) === top);
  const shown = tier.length <= 3 ? tier : tier.slice(0, 2);
  return { shown, more: list.length - shown.length, tier: top };
}

export function searchEvents(events, query) {
  const q = fold(query).trim();
  if (!q) return [];
  return events.filter((e) => !e.deleted && fold([e.title, e.venue, e.city, e.guests, e.notes].join(" ")).includes(q))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

/* ---- the Interactive calendar: week strip, month and agenda (Task 3) ---- */

/* every day from fromDay to toDay, inclusive; empty days are days too */
export function agendaDays(fromDay, toDay) {
  const out = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push(d);
  return out;
}

/* Monday to Sunday of the week holding `selected` */
export function stripWeek(selected) {
  const mon = mondayOf(selected);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/* "YYYY-MM" shifted by n months */
export function addMonths(ym, n) {
  const t = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/* The month grid for one "YYYY-MM": Monday first, whole weeks, five rows or
   six as the month needs (never fewer than five). Days of the neighbouring months are there to
   complete the rows (inMonth false). */
export function monthCells(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -dayOfWeek(first));
  const days = daysInMonth(ym);
  const rows = Math.max(5, Math.ceil((dayOfWeek(first) + days) / 7)); /* five rows at least, so the month never jumps in height for February */
  return Array.from({ length: rows * 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, inMonth: day.slice(0, 7) === ym };
  });
}
const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

export const clampDay = (day, min, max) => (day < min ? min : day > max ? max : day);
/* min and max may be days or months; a month is clamped as a month, so the
   strip never opens on an empty one past either end */
export function clampMonth(ym, min, max) {
  const lo = min.slice(0, 7), hi = max.slice(0, 7), m = ym.slice(0, 7);
  return m < lo ? lo : m > hi ? hi : m;
}

/* The day the agenda highlights while it scrolls: the first row sitting fully
   below the strip with room to spare, so it is never half hidden under the
   edge. `rows` are in order with `top` in the scroller's own coordinates,
   `scrollTop` is the coordinate of the strip's lower edge, `gap` the room the
   highlighted day is given below it. A row 8px short of the full gap still
   counts, which is how a day the app itself scrolled to (exactly `gap` below
   the edge, the caller allows 4px more) is always picked. */
export function firstFullyVisible(rows, scrollTop, gap) {
  const from = scrollTop + gap - 8;
  /* rows run in order, so the first one at or below `from` is a binary search */
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].top >= from) hi = mid; else lo = mid + 1; }
  return lo < rows.length ? rows[lo].day : null;
}

/* One finished drag on the strip: sideways moves a week (a month when open),
   down opens the month, up closes it; the longer axis wins and anything under
   40px is a tap. */
export function stripGesture({ dx, dy }) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next" : "prev";
  return dy > 0 ? "open" : "close";
}

/* Spec section 2: the seven colour groups. A category is matched by its
   stable id (icons.js); anything not listed, now or later, is Other. */
export const GROUP_OF = {
  eating: "food", drinks: "food",
  "live-music": "nights", clubbing: "nights", birthday: "nights",
  cinema: "culture", activity: "culture", games: "culture",
  park: "outdoors", beach: "outdoors", sport: "outdoors", hike: "outdoors",
  transport: "travel", accommodation: "travel", "business-trip": "travel",
  work: "life", visitor: "life", health: "life",
};
export const categoryGroup = (type) => (Object.prototype.hasOwnProperty.call(GROUP_OF, type) ? GROUP_OF[type] : "other");

/* The agenda row's second line: what the event is doing on that day. A stay
   names its check-in and check-out; a time belongs to the event's first day;
   everything else (no time, a span's later days) is all day. */
export function rowMeta(e, d) {
  const stay = stayLabel(e, d);
  if (stay) return stay;
  const t = timeOn(e, d);
  if (!t) return "All day";
  return e.endTime && (!e.end || e.end === e.start) ? `${t} to ${e.endTime}` : t;
}

export { addDays };
