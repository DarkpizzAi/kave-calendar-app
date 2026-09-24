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
import { HOLIDAYS, holidayOn } from "./holidays.js";
import { applyDetail } from "./filter.js";
import { store } from "./store.js";
import { indexByDay, weekRows, tappable, zoomWeekTarget, zoomMonthTarget, isAway, isBig, awayText,
  shouldLoadMore, nextCount, iconsOf, searchEvents, shortDate } from "./cal-model.js";
import { openLevel, sheetOpen } from "./sheet.js";
import { ICON } from "./chrome-icons.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const VIEWS = ["weekly", "monthly", "yearly"];
const WIDE = "(min-width: 900px)";

/* Transient UI state: not persisted, reset when the app opens. The defaults
   come from Settings. */
const S = {
  view: null, detail: null, fromView: null, slide: "",
  past: { weekly: 0, monthly: 0, yearly: 0 }, future: { weekly: 10, monthly: 10, yearly: 15 },
  revealPrev: false, searchOpen: false, query: "", menu: false,
  scrollTo: null, keepAnchor: false, pending: false,
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
  const shown = applyDetail(ctx.data.events(), me, S.detail);
  const grey = new Set(shown.filter((x) => x.grey).map((x) => x.event.id));
  const events = shown.map((x) => x.event);
  const idx = indexByDay(events);
  const last = events.reduce((m, e) => ((e.end || e.start) > m ? (e.end || e.start) : m), "");
  const range = loadRange(today, last);
  return { me, style, today, thisYear, events, idx, grey, range,
    on: (d) => idx.get(d) || [], thisMonday: mondayOf(today), firstMonday: mondayOf(range.min) };
}

/* ---- pieces ---- */
const icons = (e) => iconsOf(e, frame.me);
const cls = (e) => `${frame.grey.has(e.id) ? "grey" : ""}${e.status === "idea" ? " idea" : ""}`;

function row(e, withDate, click) {
  const ic = icons(e);
  return `<li class="${cls(e)}" style="--n:${ic.length}"${click ? ` data-act="event" data-id="${esc(e.id)}"` : ""}>`
    + (withDate ? `<span class="c-d">${esc(shortDate(e.start, frame.thisYear))}</span>` : "")
    + `<span class="c-i">${ic.map(esc).join("")}</span><span class="c-t">${esc(e.title)}</span>`
    + ((e.checklist || []).some((c) => !c.done) ? '<span class="todo" aria-label="Open to-dos"></span>' : "") + "</li>";
}
const list = (items, dated) => (items ? `<ul class="rows${dated ? " dated" : ""}">${items}</ul>` : "");
export const rows = (evs, dated, click) => list(evs.map((e) => row(e, dated, click)).join(""), dated);
const noteRow = (d, text) => `<li class="note" style="--n:0"><span class="c-d">${esc(shortDate(d, frame.thisYear))}</span><span class="c-i"></span><span class="c-t"><span class="flag acc">${esc(text)}</span></span></li>`;
const hintRow = (d, text) => `<li class="hintrow" style="--n:1"><span class="c-d">${esc(shortDate(d, frame.thisYear))}</span><span class="c-i">🔍</span><span class="c-t">${esc(text)}</span></li>`;
const iconSpans = (e) => icons(e).map((g) => `<span class="ic ${cls(e)}">${esc(g)}</span>`).join("");
const sortByDay = (items) => items.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).map((x) => x.html).join("");

/* ---- Today card ---- */
const place = (e) => [e.venue, e.city && e.city[0].toUpperCase() + e.city.slice(1)].filter(Boolean).join(", ");
function todayCard() {
  const evs = frame.on(frame.today);
  const hol = holidayOn(frame.today);
  const items = evs.map((e) => `<div class="titem"><span class="ticons">${icons(e).map(esc).join("")}</span><div class="tbody">`
    + `<p class="ttitle">${esc(e.title)}</p>${place(e) ? `<p class="tmeta">${esc(place(e))}</p>` : ""}`
    + ((e.links || []).length ? `<span class="tticket">🎟 ${esc(e.links[0].label)}</span>` : "") + "</div></div>").join("");
  return `<section id="today" class="todayc" data-act="day" data-d="${frame.today}" role="button" tabindex="0">`
    + `<p class="tbig">Today</p>${hol ? `<p class="thol">Bank holiday: ${esc(hol)}</p>` : ""}`
    + (items || '<p class="tmeta">No events planned for today</p>') + "</section>";
}

/* ---- control row ---- */
function controls() {
  const idx = VIEWS.indexOf(S.view), from = S.fromView == null ? idx : VIEWS.indexOf(S.fromView);
  const views = `<div class="views" role="tablist"><span class="ind" style="--i:${idx};--from:${from}"></span>`
    + VIEWS.map((v) => `<button role="tab" aria-selected="${S.view === v}" class="${S.view === v ? "on" : ""}" data-act="view" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("") + "</div>";
  const detail = `<button class="ib" data-act="menu" aria-label="Detail level" aria-expanded="${S.menu}">${ICON.eye}</button>`;
  const search = S.searchOpen
    ? `<div class="sfield"><span class="si">${ICON.search}</span><input id="q" type="search" placeholder="Search every event" value="${esc(S.query)}" autocomplete="off"><button class="clr" data-act="closesearch" aria-label="Close search">${ICON.x}</button></div>`
    : `<button class="ib" data-act="search" aria-label="Search">${ICON.search}</button>`;
  const menu = S.menu ? `<div class="menu"><p class="mt">Detail level</p>${[["full", "Full"], ["partial", "Partial"], ["minimal", "Minimal"]]
    .map(([k, l]) => `<button class="opt${S.detail === k ? " on" : ""}" data-act="detail" data-v="${k}">${l}</button>`).join("")}`
    + '<p class="mh">Full: both of you. Partial: the other person greyed. Minimal: yours and shared only.</p></div>' : "";
  return `<div class="ctl${S.searchOpen ? " searching" : ""}">${S.searchOpen ? "" : views}<div class="ctl2">${S.searchOpen ? "" : detail}${search}</div>${menu}</div>`;
}

/* ---- Weekly and Monthly: runs of weeks ---- */
const monthHead = (d) => `<h3 class="month">${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== frame.thisYear ? " " + d.slice(0, 4) : ""}</h3>`;
const weekLabel = (m) => `WEEK ${isoWeek(m)}`;

function dayCard(d) {
  const evs = frame.on(d);
  const body = frame.style === "icons" ? `<div class="icons">${evs.map(iconSpans).join("")}</div>` : rows(evs, false, false);
  const tap = tappable(evs) ? ` role="button" tabindex="0" data-act="day" data-d="${d}"` : "";
  const isToday = d === frame.today;
  return `<div class="day${isToday ? " today" : ""}${evs.length ? "" : " empty"}"${tap}>`
    + `<span class="lbl dl${isToday ? " on" : ""}">${DOW[dayOfWeek(d)]} ${Number(d.slice(8))}</span>${body}</div>`;
}
function weekRow(m) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(m, k));
  const grid = weekRows(days, matchMedia(WIDE).matches).map((r) => r.map(dayCard).join("")).join("");
  return `<section class="week" data-week="${m}"><button class="lbl wk" data-act="zoomweek" data-m="${m}">${weekLabel(m)}${ICON.chev}</button>`
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
  return `<div class="wcard${now ? " now" : ""}${evs.length ? "" : " empty"}" data-week="${m}"${tap}>`
    + `<div class="wh"><span class="lbl">${weekLabel(m)}</span>`
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
const prevBtn = () => '<button class="reveal" data-act="prev">See previous</button>';
function weeks(kind) {
  const from = addDays(frame.thisMonday, -7 * S.past[kind]);
  return { past: (S.revealPrev && from > frame.firstMonday ? prevBtn() : "") + weekBlocks(from, S.past[kind], kind),
    future: weekBlocks(frame.thisMonday, S.future[kind], kind) };
}

/* ---- Yearly: a card per month ---- */
const ymOf = (y, mo) => `${y}-${String(mo + 1).padStart(2, "0")}`;
const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
function monthCard(y, mo) {
  const key = ymOf(y, mo), n = daysIn(y, mo);
  const evs = []; let cells = "";
  for (let dd = 1; dd <= n; dd++) {
    const d = `${key}-${String(dd).padStart(2, "0")}`;
    const on = frame.on(d);
    for (const e of on) if (!evs.includes(e)) evs.push(e);
    cells += `<i class="${on.length ? "on" : ""}${dayOfWeek(d) >= 5 ? " we" : ""}${HOLIDAYS[d] ? " hol" : ""}${d === frame.today ? " t" : ""}"></i>`;
  }
  const lw = longWeekends(HOLIDAYS, key + "-01", `${key}-${n}`, frame.on).filter((w) => w.start.slice(0, 7) === key || w.end.slice(0, 7) === key);
  const items = evs.filter(isBig).map((e) => ({ d: e.start, html: row(e, true, true) }))
    .concat(lw.map((w) => ({ d: w.start, html: hintRow(w.start, `${w.text}, ${w.names}`) })));
  const now = key === frame.today.slice(0, 7);
  return `<div class="mcard${now ? " now" : ""}" data-act="zoommonth" data-ym="${key}" data-month="${key}">`
    + `<p class="mh"><span class="lbl">${MONTHS[mo].toUpperCase()}${String(y) !== frame.thisYear ? " " + y : ""}${ICON.chev}</span>`
    + `<span class="cnt">${evs.length} plan${evs.length === 1 ? "" : "s"}</span></p>`
    + `<div class="heat" style="--n:${n}" aria-hidden="true">${cells}</div>` + list(sortByDay(items), true) + "</div>";
}
function yearly() {
  const y0 = Number(frame.thisYear), m0 = Number(frame.today.slice(5, 7)) - 1;
  const start = Math.max(0, m0 - S.past.yearly);
  let past = S.revealPrev && start > 0 ? prevBtn() : "";
  for (let mo = start; mo < m0; mo++) past += monthCard(y0, mo);
  let future = "";
  for (let y = y0, mo = m0, n = 0; ymOf(y, mo) + "-01" <= frame.range.max && n < S.future.yearly; n++) {
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

/* ---- the tab ---- */
export function calendarHtml() {
  frame = buildFrame();
  ensureYears();
  if (S.searchOpen) return `<div class="page">${controls()}${searchPage()}</div>`;
  const v = S.view === "yearly" ? yearly() : weeks(S.view);
  return `<div class="page ${S.slide}">${v.past}${todayCard()}${controls()}${v.future}</div>`;
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

/* ---- "Back to today": shown once today is off screen, points towards it.
   Measured on screen: an animation's transform throws offsetTop off. ---- */
export function onScroll() {
  const mn = document.getElementById("view"), t = document.getElementById("today"), b = document.querySelector(".to-today");
  if (!mn || !b) return;
  if (!t) { b.classList.remove("show"); return; }
  const r = t.getBoundingClientRect(), box = mn.getBoundingClientRect();
  const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, window.innerHeight);
  b.classList.toggle("show", !(r.bottom > top + 60 && r.top < bottom));
  b.classList.toggle("down", r.top >= bottom);
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

function setView(v, target) {
  if (v === S.view && !target) return;
  S.slide = VIEWS.indexOf(v) > VIEWS.indexOf(S.view) ? "slide-left" : v === S.view ? "" : "slide-right";
  S.fromView = S.view; S.view = v; S.revealPrev = false; S.menu = false;
  if (target) {
    const need = Math.round((Date.parse(frame.thisMonday) - Date.parse(target)) / 6048e5);
    if (need > 0) S.past[v] = Math.max(S.past[v], need + 1);
    S.future[v] = Math.max(S.future[v], -need + 12);
    S.scrollTo = `[data-week="${target}"]`;
  }
  ctx.render();
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
  else if (a === "search") { S.searchOpen = true; S.menu = false; ctx.render(); }
  else if (a === "closesearch") { S.searchOpen = false; S.query = ""; ctx.render(); }
  else if (a === "prev") { S.past[S.view] += S.view === "yearly" ? 3 : 4; S.revealPrev = false; S.keepAnchor = true; ctx.render(); }
  else if (a === "zoomweek") { e.stopPropagation(); setView("monthly", zoomWeekTarget(b.dataset.m)); }
  else if (a === "zoommonth") setView("monthly", zoomMonthTarget(b.dataset.ym));
  else if (a === "day") openLevel({ kind: "day", d: b.dataset.d });
  else if (a === "week") openLevel({ kind: "week", m: b.dataset.m });
  else if (a === "event") { e.stopPropagation(); openLevel({ kind: "event", id: b.dataset.id }); }
  else return;
  e.preventDefault();
}

export function backToToday() {
  const t = document.getElementById("today");
  if (t) t.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/* Things the sheet needs to draw its levels, from the same frame. */
export const frameNow = () => frame;
export const detailGrey = (e) => !!frame && frame.grey.has(e.id);

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
  let g = null;
  mn.addEventListener("pointerdown", (e) => {
    g = ctx.isCalendar() && !sheetOpen() ? { x: e.clientX, y: e.clientY, top: mn.scrollTop <= 0 } : null;
  });
  document.addEventListener("pointerup", (e) => {
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    const wasTop = g.top; g = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy) && !S.searchOpen) {
      const i = VIEWS.indexOf(S.view) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < VIEWS.length) { swallowClick(); setView(VIEWS[i]); }
    } else if (wasTop && dy > 60 && !S.searchOpen) {
      /* one pull does both: reveals See previous and syncs (quietly) */
      ctx.sync();
      if (!S.revealPrev) { S.revealPrev = true; ctx.render(); }
    }
  });
  mn.addEventListener("wheel", (e) => {
    if (ctx.isCalendar() && mn.scrollTop <= 0 && e.deltaY < -30 && !S.revealPrev && !S.searchOpen) { S.revealPrev = true; ctx.render(); }
  }, { passive: true });
}

/* A swipe ends in a click on whatever was under the finger: eat that one. */
function swallowClick() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 400);
}

export { place };
