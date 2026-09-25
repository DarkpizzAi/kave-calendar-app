/* Compass: the Calendar tab (spec section 3; ported from prototype P4).

   From the top: the Today card, the control row, then the view. Monthly is
   the hub. One rule: a heading with a chevron changes view; a card opens the
   sheet. Decisions live in cal-model.js (tested); this file draws them and
   handles the taps. Every synced string goes through escapeHtml, every url
   through safeUrl. */
"use strict";

import { escapeHtml as esc } from "./util.js";
import { addDays, dayOfWeek, mondayOf, todayKey } from "./dates.js";
import { isoWeek, monthOfWeek, loadRange, freeWeekendSaturday, longWeekends } from "./views.js";
import { HOLIDAYS } from "./holidays.js";
import { applyDetail } from "./filter.js";
import { store } from "./store.js";
import { indexByDay, weekRows, tappable, zoomWeekTarget, zoomMonthTarget, isAway, awayText,
  shouldLoadMore, nextCount, iconsOf, searchEvents, shortDate, pastMonths, gesture, lastEventDay,
  fullPastWeeks, fullPastMonths, backToTodayState, todaysCount as cmTodaysCount, eventsInMonth, hideCancelled,
  hasLoadedOlder, hasOpenTodos } from "./cal-model.js";
import { openLevel, sheetOpen } from "./sheet.js";
import { ICON } from "./chrome-icons.js";
import { readPrefs, byCategories } from "./prefs.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const VIEWS = ["weekly", "monthly", "yearly"];
const WIDE = "(min-width: 900px)";

/* Transient UI state: not persisted, reset when the app opens. The defaults
   come from Settings. */
const S = {
  view: null, detail: null, fromView: null, slide: "",
  past: { weekly: 0, monthly: 0, yearly: 0 }, future: { weekly: 10, monthly: 10, yearly: 15 },
  searchOpen: false, query: "", menu: false,
  scrollTo: null, keepAnchor: false, pending: false,
  /* older years, loaded on demand: the oldest year shown, and whether
     kave-hub has anything older */
  floor: null, exhausted: false, loadingOlder: false,
};

let ctx = null;          // { data, render, isCalendar, sync }
let frame = null;        // what this draw is built from; rebuilt every draw

function prefs() {
  const s = store.state.settings;
  if (!S.view) S.view = VIEWS.includes(s.defaultView) ? s.defaultView : "weekly";
  if (!S.detail) S.detail = ["full", "partial", "minimal"].includes(s.defaultDetail) ? s.defaultDetail : "full";
  return { me: s.me, style: s.cardStyle === "icons" ? "icons" : "lines" };
}

function buildFrame() {
  const { me, style } = prefs();
  const today = todayKey();
  const thisYear = today.slice(0, 4);
  /* the detail level first, then the viewer's categories for this view */
  const detailed = applyDetail(byCategories(ctx.data.events(), readPrefs(store.state.settings), me, S.view), me, S.detail);
  const grey = new Set(detailed.filter((x) => x.grey).map((x) => x.event.id));
  /* F35: Weekly hides a cancelled event outright; Monthly and Yearly keep it
     (struck through, cls() below). */
  const events = hideCancelled(detailed.map((x) => x.event), S.view);
  const idx = indexByDay(events);
  const last = lastEventDay(events);
  if (!S.floor) S.floor = thisYear;
  const range = loadRange(today, last, S.floor);
  /* F20: "N plans" must not respect the category filters (the heat-strip
     fill still does, F17/F12 unaffected) -- an index built with detail
     applied but no category filtering, so the count matches what Monthly
     will actually show once you jump there. */
  const allEvents = applyDetail(ctx.data.events(), me, S.detail).map((x) => x.event);
  const allIdx = indexByDay(allEvents);
  return { me, style, today, thisYear, events, idx, grey, range,
    on: (d) => idx.get(d) || [], onAll: (d) => allIdx.get(d) || [],
    thisMonday: mondayOf(today), firstMonday: mondayOf(range.min) };
}

/* ---- pieces ---- */
const icons = (e) => iconsOf(e, frame.me);
/* F35: Monthly and Yearly keep a cancelled event visible, title struck
   through; Weekly never sees one here at all (hideCancelled in buildFrame). */
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
const noteRow = (d, text) => `<li class="note" style="--n:0"><span class="c-d">${esc(shortDate(d, frame.thisYear))}</span><span class="c-i"></span><span class="c-t"><span class="flag acc">${esc(text)}</span></span></li>`;
/* F10: a long weekend line is now a normal event line -- Other's icon (📌),
   no accent-ink, nothing special. */
const noteRowPlain = (d, text) => `<li style="--n:1"><span class="c-d">${esc(shortDate(d, frame.thisYear))}</span><span class="c-i">📌</span><span class="c-t">${esc(text)}</span></li>`;
const iconSpans = (e) => icons(e).map((g) => `<span class="ic ${cls(e)}">${esc(g)}</span>`).join("");
const sortByDay = (items) => items.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).map((x) => x.html).join("");

/* ---- Today (F4: the Today card is gone; a bare anchor keeps the scroll
   machinery -- Back to today, onScroll's visibility check -- working at the
   same spot in the list, between the past and the future). ---- */
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
  /* F29: "load older" is now one of three inline control buttons, sitting
     between detail and search, not a floating round button (F6's mechanism
     is unchanged, only where its trigger sits); its icon is an archive box. */
  const older = showLoadOlder() ? `<button class="ib" data-act="older" aria-label="Load older years">${ICON.older}</button>` : "";
  const search = S.searchOpen
    ? `<div class="sfield"><span class="si">${ICON.search}</span><input id="q" type="search" placeholder="Search every event" value="${esc(S.query)}" autocomplete="off"><button class="clr" data-act="closesearch" aria-label="Close search">${ICON.x}</button></div>`
    : `<button class="ib" data-act="search" aria-label="Search">${ICON.search}</button>`;
  const menu = S.menu ? `<div class="menu"><p class="mt">Detail level</p>${[["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]]
    .map(([k, l]) => `<button class="opt${S.detail === k ? " on" : ""}" data-act="detail" data-v="${k}">${l}</button>`).join("")}`
    + '<p class="mh">Full: both of you. Partial: the other person greyed. Minimal: yours and shared only.</p></div>' : "";
  return `<div class="ctl${S.searchOpen ? " searching" : ""}">${S.searchOpen ? "" : views}<div class="ctl2">${S.searchOpen ? "" : detail + older}${search}</div>${menu}</div>`;
}

/* ---- Weekly and Monthly: runs of weeks ---- */
/* F54: this heading used to also be F26's sticky-title section boundary
   (data-sec); F26 is fully reverted, so it is back to being just the plain,
   non-sticky "September" heading, drawn once per month. */
const monthHead = (d) => {
  const label = `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== frame.thisYear ? " " + d.slice(0, 4) : ""}`;
  return `<h3 class="month">${esc(label)}</h3>`;
};
const weekLabel = (m) => `WEEK ${isoWeek(m)}`;

function dayCard(d) {
  const evs = frame.on(d);
  const body = frame.style === "icons" ? `<div class="icons">${evs.map(iconSpans).join("")}</div>` : rows(evs, false, false);
  const tap = tappable(evs) ? ` role="button" tabindex="0" data-act="day" data-d="${d}"` : "";
  const isToday = d === frame.today;
  const label = `${DOW[dayOfWeek(d)]} ${Number(d.slice(8))}`;
  return `<div class="day${isToday ? " today" : ""}${evs.length ? "" : " empty"}"${tap}>`
    + `<span class="lbl-pill${isToday ? " on" : ""}">${label}</span>${body}</div>`;
}
/* F8: Weekly keeps its "WEEK 39" heading, but it is no longer a tap target
   (F11 removed the jump it gave); it must match Monthly's card label
   exactly, so it shares the same .lbl-pill construction (F9), minus the
   pill itself (F27: this one line never gets the pill treatment). */
function weekRow(m) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(m, k));
  const grid = weekRows(days, matchMedia(WIDE).matches).map((r) => r.map(dayCard).join("")).join("");
  return `<section class="week" data-week="${m}"><span class="lbl-plain wk">${weekLabel(m)}</span>`
    + `<div class="g3">${grid}</div></section>`;
}
function weekEvents(m) {
  const out = [];
  for (let k = 0; k < 7; k++) for (const e of frame.on(addDays(m, k))) if (!out.includes(e)) out.push(e);
  return out;
}
function weekCard(m) {
  const evs = weekEvents(m);
  const away = evs.filter(isAway), rest = evs.filter((e) => !isAway(e));
  const items = rest.map((e) => ({ d: e.start < m ? m : e.start, html: row(e, true, false) }));
  const sat = freeWeekendSaturday(m, frame.on, frame.today);
  if (sat) items.push({ d: sat, html: noteRow(sat, "Free weekend") });
  const now = m <= frame.today && frame.today <= addDays(m, 6);
  const tap = tappable(evs) ? ` data-act="week" data-m="${m}" role="button" tabindex="0"` : "";
  /* F27: only the current week's label keeps the pill, filled accent; every
     other week's is plain text, no pill, no border (.lbl-pill carries no
     background of its own any more -- only .on does, CSS). */
  return `<div class="wcard${now ? " now" : ""}${evs.length ? "" : " empty"}" data-week="${m}"${tap}>`
    + `<div class="wh"><span class="lbl-pill${now ? " on" : ""}">${weekLabel(m)}</span>`
    + away.map((e) => `<span class="away${frame.grey.has(e.id) ? " grey" : ""}">${esc(icons(e)[0])} ${esc(awayText(e, frame.thisYear))}</span>`).join("")
    + "</div>" + list(sortByDay(items), true) + "</div>";
}
function weekBlocks(from, count, kind) {
  let out = "", cur = "";
  for (let i = 0, m = from; i < count && m <= frame.range.max; i++, m = addDays(m, 7)) {
    /* Weekly heads a month where its 1st falls; Monthly files a week under
       the month of its Thursday, so no week shows twice. */
    const first = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(m, k)).find((x) => x.slice(8) === "01");
    const monthOf = kind === "weekly" ? (first || m) : monthOfWeek(m) + "-01";
    if (monthOf.slice(0, 7) !== cur && (i === 0 || first || kind === "monthly")) { cur = monthOf.slice(0, 7); out += monthHead(monthOf); }
    out += kind === "weekly" ? weekRow(m) : weekCard(m);
  }
  return out;
}
/* F6: "See previous" is no longer inline text in the list; it is the
   floating "load older" button that sits with the floating controls
   (drawn in calendarHtml/controls). */
function weeks(kind) {
  const from = addDays(frame.thisMonday, -7 * S.past[kind]);
  return { past: weekBlocks(from, S.past[kind], kind),
    future: weekBlocks(frame.thisMonday, S.future[kind], kind) };
}

/* ---- Yearly: a card per month ---- */
const ymOf = (y, mo) => `${y}-${String(mo + 1).padStart(2, "0")}`;
const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
/* F10: the year heading is big, once, like Monthly's big month heading. Isa's
   correction in the mock-up round: the year heading itself takes no border
   -- only the current month's card does, the same accent outline as
   Weekly's today-card and Monthly's current-week card. */
const yearHead = (y) => `<p class="year-big">${y}</p>`;
function monthCard(y, mo) {
  const key = ymOf(y, mo), n = daysIn(y, mo), now = key === frame.today.slice(0, 7);
  const evs = []; let cells = "";
  for (let dd = 1; dd <= n; dd++) {
    const d = `${key}-${String(dd).padStart(2, "0")}`;
    const on = frame.on(d);
    for (const e of on) if (!evs.includes(e)) evs.push(e);
    /* F58 (revises F12/F31): the current month is colour-coded -- the
       viewer's own or a joint event in the accent, an other-person-only day
       in accent-soft. Future months are new: the viewer's own or a joint
       event fills in a muted, darker "accent fade" (.future, CSS); every
       other future square is empty, the same empty fill as the current
       month's (no class at all -- "grey" no longer exists as a separate,
       flatter colour). Today is marked independent of fill. */
    const mine = on.some((e) => e.owner === frame.me || e.owner === "shared");
    const fill = now ? (mine ? "mine" : on.length ? "other" : "") : mine ? "future" : "";
    cells += `<i class="${fill}${d === frame.today ? " t" : ""}"></i>`;
  }
  /* F10: a long weekend or opportunity that has already passed does not
     show; the line is a normal event line (no 🔍, no accent-ink). */
  const lw = longWeekends(HOLIDAYS, key + "-01", `${key}-${n}`, frame.on)
    .filter((w) => (w.start.slice(0, 7) === key || w.end.slice(0, 7) === key) && w.end >= frame.today);
  /* F17: no second, hard-coded gate here any more -- evs already carries only
     the viewer's Yearly categories (prefs.js's byCategories, applied in
     buildFrame), whose default is now the real "big things" set. Toggling
     Categories in Settings genuinely changes what a month's card lists. */
  /* F56: each plan line renders through the same row()/noteRowPlain() the
     rest of the app uses -- no separate per-line colour/heat tint exists
     here (checked: cls() only ever adds "grey" for partial-detail's other
     person, unchanged everywhere else, "idea" and "cancelled", none of them
     Yearly-specific). Confirmed live: a month card's lines are plain text,
     same colours as Weekly/Monthly's own rows. F56 is a verification, not a
     code change; F58 above is the actual bug it was seen alongside (the
     heat-strip squares, not these lines). */
  const items = evs.map((e) => ({ d: e.start, html: row(e, true, true) }))
    .concat(lw.map((w) => ({ d: w.start, html: noteRowPlain(w.start, `${w.text}, ${w.names}`) })));
  /* F20: the count is unfiltered by category (frame.onAll), a partial
     revert of F17 -- it has to match what Monthly will show once you jump
     there. The heat-strip fill above is unaffected, still built from
     frame.on (filtered). */
  const plansCount = eventsInMonth(frame.onAll, key, n).length;
  /* F11: the month heading is plain text, no chevron, not a tap target; "N
     plans" plus a literal ">" is the only jump into Monthly. */
  /* F27: only the current month's card label keeps the pill (accent). */
  return `<div class="mcard${now ? " now" : ""}" data-month="${key}">`
    + `<p class="mh"><span class="lbl-pill${now ? " on" : ""}">${MONTHS[mo].toUpperCase()}</span>`
    + `<button class="plans-line" data-act="zoommonth" data-ym="${key}">${plansCount} plan${plansCount === 1 ? "" : "s"} &gt;</button></p>`
    + `<div class="heat" style="--n:${n}" aria-hidden="true">${cells}</div>` + list(sortByDay(items), true) + "</div>";
}
function yearly() {
  const y0 = Number(frame.thisYear), m0 = Number(frame.today.slice(5, 7)) - 1;
  const shown = pastMonths(frame.today, S.floor, S.past.yearly);
  let past = "", pastYear = null;
  for (const ym of shown) {
    const y = Number(ym.slice(0, 4));
    if (y !== pastYear) { past += yearHead(y); pastYear = y; }
    past += monthCard(y, Number(ym.slice(5, 7)) - 1);
  }
  let future = "", curYear = pastYear;
  for (let y = y0, mo = m0, n = 0; ymOf(y, mo) + "-01" <= frame.range.max && n < S.future.yearly; n++) {
    if (y !== curYear) { future += yearHead(y); curYear = y; }
    future += monthCard(y, mo);
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
  if (S.view === "yearly") for (let i = 0; i < S.future.yearly; i += 12) want.add(String(Number(frame.thisYear) + 1 + i / 12));
  else want.add(addDays(frame.thisMonday, 7 * S.future[S.view]).slice(0, 4));
  for (const y of want) if (!asked.has(y) && y <= frame.range.max.slice(0, 4)) {
    asked.add(y);
    ctx.data.ensureYear(y).catch(() => { /* offline or no token: the cache is shown; Settings says why */ });
  }
}

/* ---- the tab ----
   F28: the control row scrolls with the page again (F5 reversed). F54: F26's
   sticky month/year title is gone entirely -- the big per-section heading
   (monthHead/yearHead) is the only heading now, drawn once, non-sticky,
   where it always was. F4: no more Today card, just its anchor. */
/* F34: the swipe animation now applies only to .content (the list), not
   the whole .page -- the controls stay put; only the view toggle's own
   .seg-thumb (its own transform/animation, untouched) visibly slides to its
   new position. */
export function calendarHtml() {
  frame = buildFrame();
  ensureYears();
  if (S.searchOpen) return `<div class="page">${controls()}${searchPage()}</div>`;
  const v = S.view === "yearly" ? yearly() : weeks(S.view);
  return `<div class="page">${controls()}<div class="content ${S.slide}">${v.past}${todayAnchor()}${v.future}</div></div>`;
}

/* After the tab's HTML is in place: scroll, focus, clear one-shot state. */
export function afterCalendar(mn, before) {
  if (S.keepAnchor) mn.scrollTop = before.top + (mn.scrollHeight - before.height);
  else if (S.scrollTo) { const t = mn.querySelector(S.scrollTo); if (t) t.scrollIntoView({ block: "start" }); }
  else if (before.first) { const t = mn.querySelector("#today"); if (t) t.scrollIntoView({ block: "start" }); }
  else mn.scrollTop = before.top;
  const q = mn.querySelector("#q");
  if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); q.addEventListener("input", () => { S.query = q.value; ctx.render(); }); }
  S.slide = ""; S.fromView = null; S.scrollTo = null; S.keepAnchor = false;
  onScroll();
}

/* ---- F55: one fixed slot above "+", never two heights, never both
   showing at once. Up (scrolled forward into the future, today is above
   the visible area) and down (scrolled back into the past/loaded-older
   data, today is below it) are mutually exclusive by scroll direction, not
   two independently-toggled booleans any more. Measured on screen: an
   animation's transform throws offsetTop off. ---- */
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
  const cap = S.view === "yearly" ? yearlyCap() : weeksCap();
  if (!shouldLoadMore(mn, { count: S.future[S.view], cap, pending: S.pending, searching: S.searchOpen })) return;
  S.future[S.view] = nextCount(S.future[S.view], S.view === "yearly" ? 6 : 8, cap);
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
/* F7: one tap loads straight to 1 January of the floor year (the range
   already starts there); a further tap once that is fully shown loads the
   year before it from kave-hub, then reveals that too, in one go each time. */
async function loadOlderFull() {
  if (S.view === "yearly") {
    const need = fullPastMonths(frame.today, S.floor);
    if (S.past.yearly < need) { S.past.yearly = need; S.keepAnchor = true; ctx.render(); return; }
    if (!(await loadOlder())) { ctx.render(); return; }
    S.past.yearly = fullPastMonths(frame.today, S.floor);
  } else {
    const need = fullPastWeeks(frame.thisMonday, S.floor);
    if (S.past[S.view] < need) { S.past[S.view] = need; S.keepAnchor = true; ctx.render(); return; }
    if (!(await loadOlder())) { ctx.render(); return; }
    S.past[S.view] = fullPastWeeks(frame.thisMonday, S.floor);
  }
  S.keepAnchor = true;
  ctx.render();
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
export { loadOlderFull };

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
  else if (a === "detail") { S.detail = b.dataset.v; S.menu = false; ctx.render(); }
  else if (a === "search") { S.searchOpen = true; S.menu = false; ctx.render(); loadAllOlder(); }
  else if (a === "closesearch") { S.searchOpen = false; S.query = ""; ctx.render(); }
  /* F29: "load older" is now one of the inline control buttons, not a
     floating round button; same loadOlderFull mechanism (F6/F7). */
  else if (a === "older") loadOlderFull();
  else if (a === "zoomweek") { e.stopPropagation(); setView("monthly", zoomWeekTarget(b.dataset.m)); }
  else if (a === "zoommonth") setView("monthly", zoomMonthTarget(b.dataset.ym));
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
  /* rows of 3-3-1 or one of seven are decided at draw time: redraw on crossing */
  matchMedia(WIDE).addEventListener("change", () => { if (ctx.isCalendar()) ctx.render(); });

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
