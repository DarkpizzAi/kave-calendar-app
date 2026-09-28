/* Compass: the Calendar tab (spec section 3).

   From the top: the control row, then the view, Grid (a month grid per
   month) or Agenda (a card per day). A tap on a day or an event opens the
   sheet. Decisions live in cal-model.js (tested); this file draws them and
   handles the taps. Every synced string goes through escapeHtml, every url
   through safeUrl. */
"use strict";

import { escapeHtml as esc } from "./util.js";
import { addDays, dayOfWeek, mondayOf, todayKey } from "./dates.js";
import { loadRange, dayFreeState, weekFreeNote, weekFreeDays } from "./views.js";
import { HOLIDAYS } from "./holidays.js";
import { applyDetail } from "./filter.js";
import { store } from "./store.js";
import { indexByDay, zoomWeekTarget, zoomMonthTarget, isAway, awayText, AWAY,
  shouldLoadMore, nextCount, iconsOf, searchEvents, shortDate, pastMonths, gesture, lastEventDay,
  fullPastWeeks, fullPastMonths, backToTodayState, todaysCount as cmTodaysCount, hideCancelled,
  hasLoadedOlder, hasOpenTodos } from "./cal-model.js";
import { openLevel, sheetOpen } from "./sheet.js";
import { ICON } from "./chrome-icons.js";
import { CATEGORIES, iconFor } from "./icons.js";
import { readPrefs, eventBlocksFreeTime } from "./prefs.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const VIEWS = ["grid", "agenda"];

/* Transient UI state: not persisted, reset when the app opens. The defaults
   come from Settings. */
const S = {
  view: null, detail: null, fromView: null, slide: "",
  past: { grid: 0, agenda: 0 }, future: { grid: 15, agenda: 10 },
  searchOpen: false, freeOn: false, query: "", menu: false,
  scrollTo: null, keepAnchor: false, pending: false,
  /* older years, loaded on demand for search: the oldest year fetched from
     kave-hub, and whether it has anything older still */
  floor: null, exhausted: false,
};

/* ---- Archive: the popup opened by the "older" control button. Unlike the
   main view (always pinned to today), Archive shows only the past -- newest
   at the bottom, oldest at the top -- with no future, no scroll-triggered
   loading and no category/detail filtering (Isa: "all events, no filters").
   It draws with the exact same gridMonth/weekBlocks machinery as the main
   view (frame is swapped for the duration of the draw, see archiveFrame),
   so grid and agenda look identical in and out of Archive. */
const AR = { open: false, view: null, floor: null, exhausted: false, loading: false, keepAnchor: false };

let ctx = null;          // { data, render, isCalendar, sync }
let frame = null;        // what this draw is built from; rebuilt every draw

function prefs() {
  const s = store.state.settings;
  if (!S.view) S.view = VIEWS.includes(s.defaultView) ? s.defaultView : "grid";
  if (!S.detail) S.detail = ["full", "partial", "minimal"].includes(s.defaultDetail) ? s.defaultDetail : "full";
  return { me: s.me };
}

function buildFrame() {
  const { me } = prefs();
  const today = todayKey();
  const thisYear = today.slice(0, 4);
  const detailed = applyDetail(ctx.data.events(), me, S.detail);
  const grey = new Set(detailed.filter((x) => x.grey).map((x) => x.event.id));
  /* F35: Grid hides a cancelled event outright; Agenda keeps it (struck
     through, cls() below). */
  const events = hideCancelled(detailed.map((x) => x.event), S.view);
  const idx = indexByDay(events);
  const last = lastEventDay(events);
  if (!S.floor) S.floor = thisYear;
  const range = loadRange(today, last, S.floor);
  /* onAll: every event at this detail level, before Grid drops cancelled
     ones; the free-time colouring reads this. */
  const allIdx = indexByDay(detailed.map((x) => x.event));
  return { me, today, thisYear, events, idx, grey, range,
    on: (d) => idx.get(d) || [], onAll: (d) => allIdx.get(d) || [],
    thisMonday: mondayOf(today), firstMonday: mondayOf(range.min) };
}

/* ---- pieces ---- */
const icons = (e) => iconsOf(e, frame.me);
/* F35: Agenda keeps a cancelled event visible, title struck through; Grid
   never sees one here at all (hideCancelled in buildFrame). */
const cls = (e) => `${frame.grey.has(e.id) ? "grey" : ""}${e.status === "idea" ? " idea" : ""}${e.status === "cancelled" ? " cancelled" : ""}`;

function row(e, withDate, click) {
  const ic = icons(e);
  return `<li class="${cls(e)}" style="--n:${ic.length}"${click ? ` data-act="event" data-id="${esc(e.id)}"` : ""}>`
    + (withDate ? `<span class="c-d">${esc(shortDate(e.start, frame.thisYear))}</span>` : "")
    + `<span class="c-i">${ic.map(esc).join("")}</span><span class="c-t">${esc(e.title)}</span>`
    + (hasOpenTodos(e) ? `<span class="todo-ic" aria-label="Open to-dos">${ICON.checkbox}</span>` : "") + "</li>";
}
const list = (items, dated) => (items ? `<ul class="rows${dated ? " dated" : ""}">${items}</ul>` : "");
export const rows = (evs, dated, click) => list(evs.map((e) => row(e, dated, click)).join(""), dated);

/* ---- Today: a bare anchor between the past and the future, which Back to
   today and onScroll's visibility check scroll to. ---- */
const place = (e) => [e.venue, e.city && e.city[0].toUpperCase() + e.city.slice(1)].filter(Boolean).join(", ");
function todayAnchor() {
  return `<span id="today" aria-hidden="true"></span>`;
}

/* ---- control row ----
   F28: the view toggle, detail and search controls stop floating -- this
   row scrolls away with the page again, same as section 3's original
   wording. */
function controls() {
  const idx = VIEWS.indexOf(S.view), from = S.fromView == null ? idx : VIEWS.indexOf(S.fromView);
  /* F59: Spoon's .segment/.seg-thumb construction, copied verbatim
     (styles.css) -- .ind became .seg-thumb, .views became .segment. */
  const views = `<div class="segment" role="tablist"><span class="seg-thumb" style="--i:${idx};--from:${from}"></span>`
    + VIEWS.map((v) => `<button role="tab" aria-selected="${S.view === v}" data-act="view" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("") + "</div>";
  const detail = `<button class="ib" data-act="menu" aria-label="Detail level" aria-expanded="${S.menu}">${ICON.eye}</button>`;
  const free = `<button class="ib${S.freeOn ? " on" : ""}" data-act="free" aria-label="Highlight free time" aria-pressed="${S.freeOn}">${ICON.leaf}</button>`;
  /* "older" is an inline control button, between detail and search; it
     opens the Archive popup. */
  const older = showLoadOlder() ? `<button class="ib" data-act="older" aria-label="Open archive">${ICON.older}</button>` : "";
  const search = S.searchOpen
    ? `<div class="sfield"><span class="si">${ICON.search}</span><input id="q" type="search" placeholder="Search every event" value="${esc(S.query)}" autocomplete="off"><button class="clr" data-act="closesearch" aria-label="Close search">${ICON.x}</button></div>`
    : `<button class="ib" data-act="search" aria-label="Search">${ICON.search}</button>`;
  const menu = S.menu ? `<div class="menu"><p class="mt">Detail level</p>${[["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]]
    .map(([k, l]) => `<button class="opt${S.detail === k ? " on" : ""}" data-act="detail" data-v="${k}">${l}</button>`).join("")}`
    + '<p class="mh">Full: both of you. Partial: the other person greyed. Minimal: yours and shared only.</p></div>' : "";
  return `<div class="ctl${S.searchOpen ? " searching" : ""}">${S.searchOpen ? "" : views}<div class="ctl2">${S.searchOpen ? "" : free + detail + older}${search}</div>${menu}</div>`;
}

/* ---- Agenda: a run of weeks ---- */
/* the plain, non-sticky month heading, drawn once per month */
const monthLabel = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== frame.thisYear ? " " + d.slice(0, 4) : ""}`;
const monthHead = (d) => `<h3 class="month">${esc(monthLabel(d))}</h3>`;
/* Agenda's card model: a "period card" (one calendar week, var(--panel),
   black in dark mode) holding one smaller "day card" per day
   (var(--surface-2), grey, CSS) -- never a border. Today is the one day
   card whose FILL turns solid accent, always wins over Clear/Open. Free
   time (S.freeOn) colours Clear/Open only on days that are actually part of
   a detected free weekend/long weekend/opportunity (weekFreeDays) -- never
   a bare weekday just because nothing happens to land on it. Grid (below)
   shares the same free-time colouring logic via periodState/freeBlocks, but
   draws its own month-grid card model. */
function freeBlocks(e) { return eventBlocksFreeTime(readPrefs(store.state.settings), e); }
function periodState(d, freeDays) {
  if (d === frame.today) return "today";
  if (!S.freeOn || !freeDays.has(d)) return "";
  return dayFreeState(d, frame.onAll, freeBlocks) || "";
}
/* Agenda: one card per day, straight in a run -- no week-card wrapper
   holding several of them (Isa: "no card containing all the individual day
   cards"). Every day still shows, never skipped, never a "Nothing planned"
   line -- an empty day is just a day card with nothing in it. Black
   (var(--panel)), same as Grid's own square; a weekend gets the branding's
   own card grey (--surface-2) instead, unconditionally -- Clear/Open and
   today still win over it, same priority as before. data-week carries the
   week's Monday on every one of its days (not a separate wrapper), so a
   jump target still has something to scroll to. */
/* Top-left the weekday, top-right the day and month, plain empty space
   between the two (no rule, no dots); the month only shows here, not just
   once per section, because a week now routinely breaks across two of
   them (below) and a bare "28" right after a "30" reads as a typo, not
   the 1st of a new month. The year only joins in when the day isn't in
   frame.thisYear (Archive, mostly). */
const dayMonth = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}${d.slice(0, 4) !== frame.thisYear ? " " + d.slice(0, 4) : ""}`;
function agendaDay(d, m, freeDays, note) {
  const evs = frame.on(d);
  const away = evs.filter(isAway), rest = evs.filter((e) => !isAway(e));
  const weekend = dayOfWeek(d) >= 5 ? " weekend" : "";
  /* Monday is the first day of the week: it's the one day that keeps the
     wider between-weeks gap (.content's own flex gap); every other day
     pulls in tighter, to the same-week spacing below. */
  const weekStart = dayOfWeek(d) === 0 ? " week-start" : "";
  const dow = DOW[dayOfWeek(d)][0] + DOW[dayOfWeek(d)].slice(1).toLowerCase();
  const cd = `<div class="cd"><span class="cd-dow">${dow}</span><span class="cd-date">${dayMonth(d)}</span></div>`;
  /* Every day card opens the day, empty or not -- matches Grid's own
     squares (gridSquare below), which have always worked this way. */
  const tap = ` role="button" tabindex="0" data-act="day" data-d="${d}"`;
  /* A plain free weekend is colour only (Clear/Open, above); only a real
     long weekend or opportunity earns the 🔍 and its explanatory text, on
     the day its window opens. */
  const noteLine = (note && note.kind === "long" && note.on === d)
    ? `<li style="--n:1"><span class="c-i">🔍</span><span class="c-t">${esc(note.text)}</span></li>` : "";
  return `<div class="daycard ${periodState(d, freeDays)}${weekend}${weekStart}" data-week="${m}"${tap}>${cd}`
    + away.map((e) => `<span class="away${frame.grey.has(e.id) ? " grey" : ""}">${esc(icons(e)[0])} ${esc(awayText(e, frame.thisYear))}</span>`).join("")
    + `<ul class="rows">${rest.map((e) => row(e, false, false)).join("")}${noteLine}</ul></div>`;
}
/* Agenda's per-card height rule -- two independent groups per week
   (weekdays, weekend), not one across all seven:
     - a card with content is at least one line tall, and taller still if
       it has more than one line -- its own height, never matched up to a
       busier sibling.
     - a card with nothing on it is also one line tall, PROVIDED its group
       (Mon-Fri, or Sat+Sun) has something somewhere that week -- otherwise
       the whole group is thin, not even one line (an ordinary quiet week
       stays quiet-looking).
   "One line" isn't a card's own content, so it can't come from measuring
   that card -- oneLineHeight renders a one-off, one-row reference card
   (detached, same width as the real ones) once per draw and reuses the
   number for every card that needs the floor. */
function oneLineHeight(root) {
  const probe = document.createElement("div");
  probe.className = "daycard";
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  probe.innerHTML = '<div class="cd"><span class="cd-dow">Mon</span><span class="cd-date">1 Jan</span></div>'
    + '<ul class="rows"><li data-act="event" style="--n:1"><span class="c-i">•</span><span class="c-t">x</span></li></ul>';
  root.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}
function equalizeAgendaHeights(root) {
  const cards = root.querySelectorAll(".daycard[data-week]");
  cards.forEach((el) => { el.style.minHeight = ""; });
  if (!cards.length) return;
  const groups = new Map();
  cards.forEach((el) => {
    const key = `${el.dataset.week}:${el.classList.contains("weekend") ? "we" : "wd"}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(el);
  });
  const oneLine = oneLineHeight(root);
  for (const els of groups.values()) {
    if (els.some((el) => el.querySelector(".rows li, .away"))) els.forEach((el) => { el.style.minHeight = `${oneLine}px`; });
  }
}
/* A calendar week almost never fits neatly inside one month: this breaks
   it at the boundary instead of filing the whole week under whichever
   month its Thursday happened to land in. cur tracks the last month
   heading actually drawn, across every week in this run, so a month
   heading appears exactly once, right before its first day, even when
   that's day 3 of a week already under way. The week itself -- freeDays,
   the long-weekend note, data-week for spacing/grouping -- stays whole;
   only which heading a day falls under is per-day. */
function weekBlocks(from, count) {
  let out = "", cur = "";
  for (let m = from, i = 0; i < count && m <= frame.range.max; i++, m = addDays(m, 7)) {
    const freeDays = S.freeOn ? new Set(weekFreeDays(m, HOLIDAYS, frame.onAll, frame.today, freeBlocks)) : new Set();
    const note = S.freeOn ? weekFreeNote(m, HOLIDAYS, frame.onAll, frame.today, freeBlocks) : null;
    /* Only the week underway trims to today -- Isa: Agenda opens on today
       at the top, but "load older" must still reveal real past weeks in
       full, not empty cards (m !== frame.thisMonday is always entirely in
       the past or entirely in the future here, never split by today). */
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(m, k)).filter((d) => m !== frame.thisMonday || d >= frame.today);
    for (const d of days) {
      const ym = d.slice(0, 7);
      if (ym !== cur) { cur = ym; out += monthHead(`${ym}-01`); }
      out += agendaDay(d, m, freeDays, note);
    }
  }
  return out;
}
function weeks() {
  const from = addDays(frame.thisMonday, -7 * S.past.agenda);
  return { past: weekBlocks(from, S.past.agenda),
    future: weekBlocks(frame.thisMonday, S.future.agenda) };
}

/* ---- Grid: a real Monday-first month grid, one card per month ---- */
const ymOf = (y, mo) => `${y}-${String(mo + 1).padStart(2, "0")}`;
const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
/* Every month gets its own big heading here (the "2026" year-big treatment,
   not Agenda's smaller .month heading) -- same label text and same
   year-suffix rule as Agenda's monthHead (monthLabel, shared), just drawn
   once per month instead of once per year. */
const gridMonthHead = (d) => `<p class="year-big">${esc(monthLabel(d))}</p>`;
/* Lead-padded, Monday-first cells for one calendar month, chunked into
   real weeks (each row's own Monday, for weekFreeDays) -- padded only to
   the next multiple of 7, never a whole extra blank row. */
function gridRows(key, n) {
  const lead = dayOfWeek(`${key}-01`);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dd = 1; dd <= n; dd++) cells.push(`${key}-${String(dd).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const start = addDays(`${key}-01`, -lead);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push({ monday: addDays(start, i), days: cells.slice(i, i + 7) });
  return rows;
}
/* One emoji per day: the day's own busiest activity, by a fixed priority
   (away -- transport/accommodation/business-trip -- then work, then every
   social category in the Settings catalogue order, "none" last). A day
   with several activities across several events still shows only the one
   that ranks highest; ties keep whichever was found first. */
const DAY_PRIORITY = [...AWAY, "work", ...CATEGORIES.map((c) => c.type).filter((t) => !AWAY.includes(t) && t !== "work")];
function gridIcon(d) {
  const evs = frame.on(d);
  let best = null, bestRank = Infinity;
  for (const e of evs) {
    const acts = e.activities && e.activities.length ? e.activities : [{ type: "none" }];
    for (const a of acts) {
      const rank = DAY_PRIORITY.indexOf(a.type);
      if (rank < bestRank) { bestRank = rank; best = { a, e }; }
    }
  }
  if (!best) return "";
  const grey = best.e.owner !== frame.me && best.e.owner !== "shared";
  const more = evs.length > 1 ? `<span class="more"></span>` : "";
  return `<span class="emo${grey ? " grey" : ""}">${esc(iconFor(best.a, best.e, frame.me))}</span>${more}`;
}
function gridSquare(d, freeDays, note) {
  if (!d) return `<div class="dsq pad"></div>`;
  const st = periodState(d, freeDays);
  /* Every Grid square opens the single day, empty or not (Agenda's day
     cards work the same way, agendaDay above): it is also the entry point
     for the day-swipe browser in sheet.js, which needs to be able to land
     on a day with nothing on it. */
  /* F16's own glyph, reused rather than re-derived: at least one event
     that day still has an unchecked to-do. */
  const todo = frame.on(d).some(hasOpenTodos) ? `<span class="dtodo" aria-label="Open to-dos">${ICON.checkbox}</span>` : "";
  /* A plain free weekend is colour only (Clear/Open, above); only a real
     long weekend or opportunity earns the 🔍, on the day its window opens
     (kind: "long" -- weekFreeNote's plain-Saturday case never reaches
     here). */
  const glass = (note && note.kind === "long" && note.on === d) ? `<span class="note" aria-label="Long weekend">🔍</span>` : "";
  const weekend = dayOfWeek(d) >= 5 ? " weekend" : "";
  return `<div class="dsq ${st}${weekend}" role="button" tabindex="0" data-act="day" data-d="${d}"><span class="num">${Number(d.slice(8))}</span>${todo}${glass}${gridIcon(d)}</div>`;
}
function gridMonth(y, mo) {
  const key = ymOf(y, mo), n = daysIn(y, mo), now = key === frame.today.slice(0, 7);
  const rows = gridRows(key, n).map((r) => {
    const freeDays = S.freeOn ? new Set(weekFreeDays(r.monday, HOLIDAYS, frame.onAll, frame.today, freeBlocks)) : new Set();
    const note = S.freeOn ? weekFreeNote(r.monday, HOLIDAYS, frame.onAll, frame.today, freeBlocks) : null;
    return `<div class="grid7">${r.days.map((d) => gridSquare(d, freeDays, note)).join("")}</div>`;
  }).join("");
  const wdhead = readPrefs(store.state.settings).showWeekdayHeader
    ? `<div class="wdhead">${DOW.map((w) => `<span>${w[0]}</span>`).join("")}</div>` : "";
  return `<div class="gridCard${now ? " now" : ""}" data-month="${key}">${wdhead}<div class="monthgrid">${rows}</div></div>`;
}
function grid() {
  const y0 = Number(frame.thisYear), m0 = Number(frame.today.slice(5, 7)) - 1;
  const shown = pastMonths(frame.today, S.floor, S.past.grid);
  let past = "";
  for (const ym of shown) past += gridMonthHead(ym + "-01") + gridMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1);
  let future = "";
  for (let y = y0, mo = m0, n = 0; ymOf(y, mo) + "-01" <= frame.range.max && n < S.future.grid; n++) {
    future += gridMonthHead(ymOf(y, mo) + "-01") + gridMonth(y, mo);
    if (++mo === 12) { mo = 0; y++; }
  }
  return { past, future };
}
function yearlyCap() {
  const [y, m] = frame.range.max.split("-").map(Number), [y0, m0] = frame.today.split("-").map(Number);
  return (y - y0) * 12 + (m - m0) + 1;
}
const weeksCap = () => Math.round((Date.parse(frame.range.max) - Date.parse(frame.thisMonday)) / 6048e5) + 1;

function searchPage() {
  const hits = searchEvents(frame.events, S.query);
  if (!S.query.trim()) return '<p class="hint">Type a name, a place or a guest.</p>';
  return `<p class="hint">${hits.length} result${hits.length === 1 ? "" : "s"}</p>${hits.length ? `<div class="card">${rows(hits, true, true)}</div>` : ""}`;
}

/* The years a draw touches: they load on demand, once each. */
const asked = new Set();
function ensureYears() {
  const want = new Set([frame.thisYear, String(Number(frame.thisYear) + 1)]);
  if (S.view === "grid") for (let i = 0; i < S.future.grid; i += 12) want.add(String(Number(frame.thisYear) + 1 + i / 12));
  else want.add(addDays(frame.thisMonday, 7 * S.future[S.view]).slice(0, 4));
  for (const y of want) if (!asked.has(y) && y <= frame.range.max.slice(0, 4)) {
    asked.add(y);
    ctx.data.ensureYear(y).catch(() => { /* offline or no token: the cache is shown; Settings says why */ });
  }
}

/* ---- the tab: the control row (it scrolls with the page), then the view
   between its past and future halves, with the Today anchor between them.
   The swipe animation moves only .content, never the controls. ---- */
/* F34: the swipe animation now applies only to .content (the list), not
   the whole .page -- the controls stay put; only the view toggle's own
   .seg-thumb (its own transform/animation, untouched) visibly slides to its
   new position. */
export function calendarHtml() {
  frame = buildFrame();
  ensureYears();
  if (S.searchOpen) return `<div class="page">${controls()}${searchPage()}</div>`;
  const v = S.view === "grid" ? grid() : weeks();
  return `<div class="page">${controls()}<div class="content ${S.slide}">${v.past}${todayAnchor()}${v.future}</div></div>`;
}

/* After the tab's HTML is in place: scroll, focus, clear one-shot state. */
export function afterCalendar(mn, before) {
  if (S.view === "agenda") equalizeAgendaHeights(mn);
  if (S.keepAnchor) mn.scrollTop = before.top + (mn.scrollHeight - before.height);
  else if (S.scrollTo) { const t = mn.querySelector(S.scrollTo); if (t) t.scrollIntoView({ block: "start" }); }
  else if (before.first) { const t = mn.querySelector("#today"); if (t) t.scrollIntoView({ block: "start" }); }
  else mn.scrollTop = before.top;
  const q = mn.querySelector("#q");
  if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); q.addEventListener("input", () => { S.query = q.value; ctx.render(); }); }
  S.slide = ""; S.fromView = null; S.scrollTo = null; S.keepAnchor = false;
  onScroll();
}

/* ---- the up and down buttons share one slot above "+" and never show
   together: up once today has scrolled out above the view, down while today
   is still below it. Measured on screen, because an animation's transform
   throws offsetTop off. ---- */
export function onScroll() {
  const mn = document.getElementById("view"), t = document.getElementById("today");
  const up = document.querySelector(".fab.up"), down = document.querySelector(".fab.down");
  if (!mn || !up || !down) return;
  if (!t) { up.classList.remove("show"); down.classList.remove("show"); return; }
  const r = t.getBoundingClientRect(), box = mn.getBoundingClientRect();
  const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, window.innerHeight);
  const pastTop = r.bottom <= top + 60;    // today has scrolled up and out: show up (back to top)
  const pastBottom = r.top >= bottom;      // today is still below the fold: show down (jump to today)
  up.classList.toggle("show", pastTop);
  down.classList.toggle("show", !pastTop && pastBottom);
}

/* F28: the up button -- scrolls back to the top of the list, revealing the
   (now non-floating) controls again. */
export function scrollToTop() {
  const mn = document.getElementById("view");
  if (!mn) return;
  mn.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/* Only a real scroll event calls this, never a draw. */
function loadMore(mn) {
  if (!frame) return;
  const cap = S.view === "grid" ? yearlyCap() : weeksCap();
  if (!shouldLoadMore(mn, { count: S.future[S.view], cap, pending: S.pending, searching: S.searchOpen })) return;
  S.future[S.view] = nextCount(S.future[S.view], S.view === "grid" ? 6 : 8, cap);
  S.pending = true;
  setTimeout(() => { S.pending = false; ctx.render(); }, 0);
}

/* ---- older years on demand (spec: See previous, search, opening an old
   event). kave-hub is asked for the year before the oldest one shown; an
   empty or missing year means there is nothing older. ---- */
let olderInFlight = null;
function loadOlder() {
  /* a tap while another load runs waits for it instead of being lost (M4) */
  if (olderInFlight) return olderInFlight;
  olderInFlight = loadOlderOnce().finally(() => { olderInFlight = null; });
  return olderInFlight;
}
async function loadOlderOnce() {
  if (S.exhausted) return false;
  S.loadingOlder = true;
  const y = String(Number(S.floor) - 1);
  try {
    await ctx.data.ensureYear(y);
    if (ctx.data.events().some((e) => e.start.startsWith(y))) S.floor = y; else S.exhausted = true;
    return !S.exhausted;
  } catch {
    /* offline or no token: a year already cached still shows; otherwise
       try again on the next tap */
    if (ctx.data.events().some((e) => e.start.startsWith(y))) { S.floor = y; return true; }
    return false;
  } finally {
    S.loadingOlder = false;
  }
}
async function loadAllOlder() {
  for (let i = 0; i < 15 && !S.exhausted; i++) if (!(await loadOlder())) break;
  if (S.searchOpen) ctx.render();
}
/* ---- Archive: the popup the "older" button opens. The main view always
   opens on today and never grows into the past; Archive shows only the past,
   oldest at the top, from 1 January of this year, one more January per
   "Load more". It keeps its own floor/exhausted (S.floor/S.exhausted track
   how far back Search has fetched). All events, no detail filtering.

   It draws with the same gridMonth/weekBlocks the main view uses, against
   a swapped-in frame, so both look identical. */
function archiveFrame() {
  const today = todayKey(), thisYear = today.slice(0, 4);
  const events = hideCancelled(ctx.data.events(), AR.view);
  const idx = indexByDay(events);
  return { me: store.state.settings.me, today, thisYear,
    events, idx, grey: new Set(), on: (d) => idx.get(d) || [], onAll: (d) => idx.get(d) || [],
    thisMonday: mondayOf(today), range: { max: today } };
}
function archiveBody() {
  const saved = frame;
  frame = archiveFrame();
  const html = AR.view === "grid"
    ? pastMonths(frame.today, AR.floor, fullPastMonths(frame.today, AR.floor))
      .map((ym) => gridMonthHead(ym + "-01") + gridMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1)).join("")
    : weekBlocks(mondayOf(`${AR.floor}-01-01`), fullPastWeeks(frame.thisMonday, AR.floor));
  frame = saved;
  return html;
}
function archiveHtml() {
  const body = archiveBody() || '<p class="hint">Nothing archived yet.</p>';
  const more = AR.exhausted ? "" : `<button class="archive-more" data-act="archivemore"${AR.loading ? " disabled" : ""}>${AR.loading ? "Loading…" : "Load more"}</button>`;
  return '<div class="shade" data-act="archiveclose"></div>'
    + '<section class="sheet in archive" role="dialog" aria-modal="true" aria-labelledby="archtitle">'
    + '<header class="sbar" data-act="archiveclose"><span class="grab" aria-hidden="true"></span>'
    + '<div class="stitle-wrap"><h2 class="stitle" id="archtitle">Archive</h2></div></header>'
    + `<div class="sstage"><div class="sbody archive-body">${more}${body}</div></div></section>`;
}
function renderArchive() {
  const root = document.getElementById("archiveRoot");
  if (!root) return;
  if (!AR.open) { root.innerHTML = ""; return; }
  const old = root.querySelector(".archive-body");
  const before = old ? { top: old.scrollTop, height: old.scrollHeight } : null;
  root.innerHTML = archiveHtml();
  const fresh = root.querySelector(".archive-body");
  if (fresh && AR.view === "agenda") equalizeAgendaHeights(fresh);
  if (fresh) fresh.scrollTop = AR.keepAnchor && before ? before.top + (fresh.scrollHeight - before.height) : fresh.scrollHeight;
  AR.keepAnchor = false;
}
function openArchive() {
  if (!frame) return;
  Object.assign(AR, { open: true, view: S.view, floor: frame.thisYear, exhausted: false, loading: false, keepAnchor: false });
  renderArchive();
}
function closeArchive() { AR.open = false; renderArchive(); }
async function loadMoreArchive() {
  if (AR.loading || AR.exhausted) return;
  AR.loading = true;
  renderArchive();
  const y = String(Number(AR.floor) - 1);
  try {
    await ctx.data.ensureYear(y);
    if (ctx.data.events().some((e) => e.start.startsWith(y))) AR.floor = y; else AR.exhausted = true;
  } catch {
    if (ctx.data.events().some((e) => e.start.startsWith(y))) AR.floor = y;
  } finally {
    AR.loading = false;
    AR.keepAnchor = true;
    renderArchive();
  }
}
function archiveClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;
  if (a === "archiveclose") closeArchive();
  else if (a === "archivemore") loadMoreArchive();
  else if (a === "day") openLevel({ kind: "day", d: b.dataset.d });
  else if (a === "week") openLevel({ kind: "week", m: b.dataset.m });
  else if (a === "event") { e.stopPropagation(); openLevel({ kind: "event", id: b.dataset.id }); }
  else return;
  e.preventDefault();
}

function setView(v, target) {
  if (v === S.view && !target) return;
  S.slide = VIEWS.indexOf(v) > VIEWS.indexOf(S.view) ? "slide-left" : v === S.view ? "" : "slide-right";
  S.fromView = S.view; S.view = v; S.menu = false;
  if (target) {
    const need = Math.round((Date.parse(frame.thisMonday) - Date.parse(target)) / 6048e5);
    if (need > 0) S.past[v] = Math.max(S.past[v], need + 1);
    S.future[v] = Math.max(S.future[v], -need + 12);
    S.scrollTo = `[data-week="${target}"]`;
  }
  ctx.render();
}

/* F29: "load older" is now an inline control button (drawn in controls()
   above, not with the round buttons); hidden while searching, where it
   makes no sense. */
export const showLoadOlder = () => !S.searchOpen;

/* F3: the nav icon's badge. Independent of whatever view is drawn (the
   badge shows even before the Calendar has been opened this session), so it
   reads straight from the data instance rather than the last-built frame. */
export function todaysCount() {
  if (!ctx || !store.state.settings.me) return 0;
  const detail = S.detail || (["full", "partial", "minimal"].includes(store.state.settings.defaultDetail) ? store.state.settings.defaultDetail : "full");
  const today = todayKey();
  const idx = indexByDay(ctx.data.events());
  return cmTodaysCount(idx.get(today) || [], store.state.settings.me, detail);
}

function onClick(e) {
  if (!ctx.isCalendar()) return;
  const b = e.target.closest("[data-act]");
  if (!b || !b.closest("#view")) {
    if (S.menu && !e.target.closest(".menu")) { S.menu = false; ctx.render(); }
    return;
  }
  const a = b.dataset.act;
  if (a === "view") setView(b.dataset.v);
  else if (a === "menu") { S.menu = !S.menu; ctx.render(); }
  else if (a === "free") { S.freeOn = !S.freeOn; ctx.render(); }
  else if (a === "detail") { S.detail = b.dataset.v; S.menu = false; ctx.render(); }
  else if (a === "search") { S.searchOpen = true; S.menu = false; ctx.render(); loadAllOlder(); }
  else if (a === "closesearch") { S.searchOpen = false; S.query = ""; ctx.render(); }
  /* F29: "load older" is now one of the inline control buttons, not a
     floating round button; it now opens the Archive popup (F6/F7's
     "load straight to 1 January" idea lives on inside it). */
  else if (a === "older") openArchive();
  else if (a === "zoomweek") { e.stopPropagation(); setView("agenda", zoomWeekTarget(b.dataset.m)); }
  else if (a === "zoommonth") setView("agenda", zoomMonthTarget(b.dataset.ym));
  else if (a === "day") openLevel({ kind: "day", d: b.dataset.d });
  else if (a === "week") openLevel({ kind: "week", m: b.dataset.m });
  else if (a === "event") { e.stopPropagation(); openLevel({ kind: "event", id: b.dataset.id }); }
  else return;
  e.preventDefault();
}

/* F7/F28: the down button -- jumps to today and discards whatever earlier
   data "load older" pulled in, so the list is back to its normal range and
   pull to refresh (F53) works again. */
export function backToToday() {
  const t = document.getElementById("today");
  if (frame && hasLoadedOlder(S.past)) {
    Object.assign(S, backToTodayState(frame.thisYear));
    S.scrollTo = "#today";
    ctx.render();
    return;
  }
  if (t) t.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/* Things the sheet needs to draw its levels, from the same frame. */
export const frameNow = () => frame;
export const detailGrey = (e) => !!frame && frame.grey.has(e.id);

/* Settings changed a default: the Calendar opens on it next time it draws. */
export function resetCalendarDefaults() { S.view = null; S.detail = null; }

export function closeMenus() {
  if (AR.open) { closeArchive(); return true; }
  if (S.menu) { S.menu = false; ctx.render(); return true; }
  if (S.searchOpen) { S.searchOpen = false; S.query = ""; ctx.render(); return true; }
  return false;
}

/* Registered once: the list node (#view) and the document persist. */
export function initCalendar(c) {
  ctx = c;
  const mn = document.getElementById("view");
  mn.addEventListener("scroll", () => { onScroll(); if (ctx.isCalendar()) loadMore(mn); }, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick);
  const ar = document.getElementById("archiveRoot");
  if (ar) ar.addEventListener("click", archiveClick);

  /* Gestures: swipe the list sideways to change view; pull down at the top
     (or wheel up) to reveal See previous. */
  /* Mouse and pen use pointer events. A finger uses touch events: when a
     touch starts to scroll, the browser cancels the pointer and never sends
     pointerup, so a pull would never register on a phone (final review I6). */
  let g = null;
  const start = (x, y) => { g = ctx.isCalendar() && !sheetOpen() ? { x, y, top: mn.scrollTop <= 0 } : null; };
  const end = (x, y) => {
    if (!g) return;
    const act = gesture({ dx: x - g.x, dy: y - g.y, top: g.top, searching: S.searchOpen, loadedOlder: hasLoadedOlder(S.past) });
    g = null;
    if (act === "next" || act === "prev") {
      const i = VIEWS.indexOf(S.view) + (act === "next" ? 1 : -1);
      if (i >= 0 && i < VIEWS.length) { swallowClick(); setView(VIEWS[i]); }
    } else if (act === "pull") {
      /* F53: only reachable once the true top is today's own range again
         (gesture() itself refuses to arm otherwise); the down button (F28)
         is what gets a person back here after loading older data. */
      ctx.sync();
    }
  };
  mn.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") start(e.clientX, e.clientY); });
  document.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") end(e.clientX, e.clientY); });
  mn.addEventListener("touchstart", (e) => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  mn.addEventListener("touchend", (e) => { const t = e.changedTouches[0]; if (t) end(t.clientX, t.clientY); }, { passive: true });
  /* F53: a wheel "pull" (desktop) obeys the same true-top rule. */
  mn.addEventListener("wheel", (e) => {
    if (ctx.isCalendar() && mn.scrollTop <= 0 && !hasLoadedOlder(S.past) && e.deltaY < -30 && !S.searchOpen) ctx.sync();
  }, { passive: true });
}

/* A swipe ends in a click on whatever was under the finger: eat that one. */
function swallowClick() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 400);
}

export { place };
