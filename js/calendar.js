/* Compass: the Calendar tab, the Interactive design.

   A strip card under the top bar holds one week (a letter and one emoji per
   day) and opens into the month (day numbers and one emoji per day). Under it
   runs the agenda: every day from a year back to two years ahead, empty days
   as thin rows, so time passing is visible. The same day is highlighted in
   the strip, the month and the agenda. A tap on a day glides the agenda to
   it; scrolling the agenda moves the highlight and never closes the month.

   Decisions live in cal-model.js (tested); this file draws them and handles
   the gestures. Every synced string goes through escapeHtml. */
"use strict";

import { escapeHtml as esc, markJump, isJumping, clearJump } from "./util.js";
import { addDays, dayOfWeek, todayKey } from "./dates.js";
import { loadRange } from "./views.js";
import { holidayOn } from "./holidays.js";
import { readPrefs } from "./prefs.js";
import { applyDetail, isTheirs } from "./filter.js";
import { store } from "./store.js";
import { indexByDay, eventsOn, pickDayIcon, iconsOf, todaysCount as cmTodaysCount, hasOpenTodos,
  agendaDays, stripWeek, monthCells, pinPick, clampDay, clampMonth, addMonths,
  categoryGroup, stripGesture, rowMeta } from "./cal-model.js";
import { openLevel } from "./sheet.js";
import { ms, offlineCardHtml } from "./chrome-icons.js";
import { iconFor } from "./icons.js";
import { play, EASE, motionFactor } from "../m3/kave-m3.js";
import { showTopBar, onBarMove, barOffset, barHeight, barTarget } from "./top-bar.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LONGDOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORTDOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/* Transient UI state: not persisted, reset when the app opens. `open` is null
   until the first draw reads the Settings default (week or month). */
const S = {
  open: null, sel: null, month: null, detail: null,
  fx: 0,          // +1 / -1: the body slides in from that side after a swipe
  fresh: true,    // the tab was not on screen before this draw
  touched: false, // the reader has scrolled since the tab appeared
  box: null,      // the day in the agenda's fixed box (the rule's, see pinPick)
};

let ctx = null;          // { data, render, isCalendar, sync, add }
let frame = null;        // what this draw is built from; rebuilt every draw

const view = () => document.getElementById("view");
const expanded = () => document.documentElement.dataset.size === "expanded";
const stripEl = () => document.querySelector("#view [data-live]");
const monthName = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1];
const monthTitle = (ym) => `${monthName(ym)} ${ym.slice(0, 4)}`;
const longDay = (d) => `${LONGDOW[dayOfWeek(d)]} ${Number(d.slice(8))} ${monthName(d)}`;
const who = (o) => (o === "isa" ? "Isa" : o === "hugo" ? "Hugo" : "Both of you");

function prefs() {
  const s = store.state.settings, p = readPrefs(s);
  if (S.open === null) S.open = p.defaultView === "month";
  if (!S.detail) S.detail = p.defaultDetail;
  return { me: s.me, order: p.gridOrder };
}

function buildFrame() {
  const { me, order } = prefs();
  const today = todayKey();
  const range = loadRange(today);
  /* every event at this detail level, cancelled included: the agenda keeps a
     cancelled one (struck through), the strip and the month leave it out */
  const all = applyDetail(ctx.data.events(), me, S.detail).map((x) => x.event);
  const idx = indexByDay(all);
  if (!S.sel) S.sel = today;
  S.sel = clampDay(S.sel, range.min, range.max);
  S.month = clampMonth(S.month || S.sel.slice(0, 7), range.min, range.max);
  return { me, order, today, thisYear: today.slice(0, 4), all, idx, range,
    grey: (e) => isTheirs(e, me),
    on: (d) => idx.get(d) || [] };
}

/* ---- the strip ---- */

/* One emoji per day: the Grid emoji order's winner among the events on it (a
   middle night of a stay included; a cancelled event is not shown). */
function dayEmoji(d) {
  const evs = frame.on(d).filter((e) => e.status !== "cancelled");
  const best = pickDayIcon(evs, d, { order: frame.order, me: frame.me });
  return best ? { emo: iconFor(best.a, best.e, frame.me), grey: frame.grey(best.e) } : null;
}

function dayBtn(d, kind, inMonth) {
  const out = d < frame.range.min || d > frame.range.max;
  const cls = ["lc-d", kind, d === frame.today ? "today" : "", d === S.sel ? "sel" : "", inMonth ? "" : "out", d < frame.today ? "past" : ""]
    .filter(Boolean).join(" ");
  const e = inMonth && !out ? dayEmoji(d) : null;
  const names = frame.on(d).filter((x) => x.status !== "cancelled").map((x) => x.title).join(", ");
  const label = `${longDay(d)}${d === frame.today ? ", today" : ""}${names ? ", " + names : ", nothing planned"}`;
  const top = kind === "wc"
    ? `<span class="wd m3-label-s">${LETTERS[dayOfWeek(d)]}</span>`
    : `<span class="dn m3-label-l">${Number(d.slice(8))}</span>`;
  return `<button type="button" class="${cls}" data-day="${d}" aria-label="${esc(label)}"${out ? " disabled" : ""}>${top}`
    + `<span class="emos m3-emoji${e && e.grey ? " grey" : ""}" aria-hidden="true">${e ? esc(e.emo) : ""}</span></button>`;
}

function stripInner() {
  const wide = expanded(), open = S.open || wide;
  const label = monthTitle(open ? S.month : S.sel.slice(0, 7));
  const name = wide
    ? `<span class="lc-title"><span class="m3-title-m">${esc(label)}</span></span>`
    : `<button type="button" class="lc-title" data-act="toggle" aria-expanded="${open}" aria-label="${esc(label)}, ${open ? "show one week" : "show the month"}"><span class="m3-title-m">${esc(label)}</span></button>`;
  /* with a mouse, hovering the month name shows a chevron each side of it
     (Isa, 04/11/2026); touch swipes instead, so they never show there */
  const chev = (act, icon, lbl) => `<button type="button" class="m3-icon-btn lc-chev" data-act="${act}" aria-label="${lbl}">${ms(icon)}</button>`;
  const title = `<span class="lc-name">${chev("mprev", "chevron_left", "Previous month")}${name}${chev("mnext", "chevron_right", "Next month")}</span>`;
  const head = `<div class="lc-head">${title}<span class="sp"></span>`
    + `<button type="button" class="lc-title" data-act="today" aria-label="Back to today"><span class="m3-title-m">Today</span></button></div>`;
  let body;
  if (open) {
    body = `<div class="lc-grid">${LETTERS.map((w) => `<span class="lc-wd m3-label-s">${w}</span>`).join("")}`
      + `${monthCells(S.month).map((c) => dayBtn(c.day, "mc", c.inMonth)).join("")}</div>`;
  } else {
    body = `<div class="lc-week">${stripWeek(S.sel).map((d) => dayBtn(d, "wc", true)).join("")}</div>`;
  }
  const handle = wide ? ""
    : `<button type="button" class="lc-handle" data-act="toggle" aria-label="${open ? "Show one week" : "Show the month"}"><span></span></button>`;
  return `<div class="lc-in">${offlineCardHtml()}${head}${body}${handle}</div>`;
}

/* Redraw the strip in place. When its height changes (the month opens or
   closes, or a month needs a sixth row) the height animates, 400ms
   emphasized; after a swipe the new week or month slides in. Reduced motion:
   `play` does nothing, so the strip simply changes. */
function redrawStrip() {
  const t = stripEl();
  if (!t) return;
  const h0 = t.offsetHeight;
  /* keyboard focus survives the redraw: the same control is focused again */
  const f = document.activeElement && t.contains(document.activeElement) ? document.activeElement : null;
  const key = f && (f.dataset.day ? `[data-day="${f.dataset.day}"]` : f.dataset.act ? `[data-act="${f.dataset.act}"]` : "");
  t.getAnimations().forEach((a) => a.cancel());
  /* snapping off before the strip can change height: measuring it below lays
     the page out, and a snapped list would be re-snapped to the old line
     there and then (the day ends up under an opening month) */
  const mn = view();
  if (mn) mn.classList.add("settling");
  t.innerHTML = stripInner();
  if (key) { const again = t.querySelector(key); if (again && !again.disabled) again.focus({ preventScroll: true }); }
  const h1 = t.offsetHeight, body = t.querySelector(".lc-week, .lc-grid");
  if (h0 && Math.abs(h1 - h0) > 2) {
    stripMoving(400);
    play(t, [{ height: `${h0}px` }, { height: `${h1}px` }], 400, EASE.emphasized);
    if (body) play(body, [{ opacity: 0 }, { opacity: 1 }], 200, "linear", { delay: 100 });
  } else {
    if (mn && !stripUntil) { placePin(); mn.classList.remove("settling"); }
    if (S.fx && body) play(body, [{ opacity: 0, transform: `translateX(${S.fx * 56}px)` }, { opacity: 1, transform: "none" }], 300, EASE.decelerate);
  }
  S.fx = 0;
}

/* The strip changes height: the agenda moves with it, and the line under it
   with them both, so nothing needs re-picking. Until it lands, snapping is off
   (the snap padding would follow a frame late and the list would be nudged
   every frame: the jitter), the rule waits, and the jump mark keeps the top
   bar out of it. */
let stripUntil = 0, stripTimer = 0;
function stripMoving(ms) {
  const mn = view(), f = motionFactor();
  if (!mn) return;
  if (!f) { placePin(); mn.classList.remove("settling"); return; }
  stripUntil = performance.now() + ms * f;
  markJump(ms * f + 100);
  mn.classList.add("settling");
  clearTimeout(stripTimer);
  /* the line first, at the landed height, then the snap back on: on again
     against a stale line, it would re-snap the list to it */
  stripTimer = setTimeout(() => { placePin(); mn.classList.remove("settling"); stripUntil = 0; pinMoved(); }, ms * f + 30);
}

/* ---- the agenda ---- */
const firstType = (e) => (e.activities && e.activities[0] && e.activities[0].type) || "none";

function card(e, d) {
  const theirs = frame.grey(e);
  const group = theirs ? "other" : categoryGroup(firstType(e));
  const cls = ["evc", "g-" + group, theirs ? "grey" : "", e.status === "idea" ? "idea" : "", e.status === "cancelled" ? "cancelled" : ""].filter(Boolean).join(" ");
  const sub = [theirs ? who(e.owner) : "", rowMeta(e, d), e.venue || ""].filter(Boolean).map(esc).join(" · ");
  const todo = hasOpenTodos(e) ? `<span class="evc-todo" role="img" aria-label="Open to-dos">${ms("checklist")}</span>` : "";
  return `<button type="button" class="${cls}" data-act="event" data-id="${esc(e.id)}">`
    + `<span class="evc-em m3-emoji" aria-hidden="true">${iconsOf(e, frame.me).map(esc).join("")}</span>`
    + `<span class="evc-t"><span class="evc-name m3-body-l">${esc(e.title)}</span><span class="m3-body-s">${sub}</span></span>${todo}</button>`;
}

function agendaRow(d) {
  const evs = frame.on(d), hol = holidayOn(d);
  const cls = ["ag", d === frame.today ? "today" : "", d === (S.box || S.sel) ? "sel" : "", evs.length || hol ? "" : "empty", d < frame.today ? "past" : ""]
    .filter(Boolean).join(" ");
  const note = d === frame.today && !evs.length ? '<span class="ag-note m3-body-s">Nothing planned today</span>' : "";
  const holiday = hol ? `<span class="ag-note m3-body-s">${esc(hol)}</span>` : "";
  return `<div class="${cls}" data-row="${d}">`
    + `<button type="button" class="ag-d" data-act="day" data-d="${d}" aria-label="Open ${esc(longDay(d))}">`
    + `<span class="ag-dw m3-label-s">${SHORTDOW[dayOfWeek(d)]}</span><span class="ag-dn m3-title-l">${Number(d.slice(8))}</span></button>`
    + `<div class="ag-evs">${holiday}${evs.map((e) => card(e, d)).join("")}${note}</div></div>`;
}

function agendaHtml() {
  const out = ['<div class="ag-pin" aria-hidden="true"><div class="ag-box"></div></div>'];
  let last = "";
  for (const d of agendaDays(frame.range.min, frame.range.max)) {
    const ym = d.slice(0, 7);
    if (ym !== last) {
      out.push(`<h2 class="mhead m3-title-m">${esc(monthName(d))}${d.slice(0, 4) !== frame.thisYear ? " " + d.slice(0, 4) : ""}</h2>`);
      last = ym;
    }
    out.push(agendaRow(d));
  }
  return out.join("");
}

/* The years the range touches load on demand, once each. Asked after the
   draw, never during it: ensureYear notifies (and so redraws) before its
   first await, which from here would start a second draw inside this one.
   Offline, the cache is what shows and nothing is asked for. */
const asked = new Set();
function ensureYears() {
  if (navigator.onLine === false) return;
  for (let y = Number(frame.range.min.slice(0, 4)); y <= Number(frame.range.max.slice(0, 4)); y++) {
    const key = String(y);
    if (asked.has(key)) continue;
    asked.add(key);
    Promise.resolve().then(() => ctx.data.ensureYear(key))
      .catch(() => { /* offline or no token: the cache is shown; Settings says why */ });
  }
}

/* ---- the tab ---- */
export function calendarHtml() {
  S.fresh = !document.querySelector("#view .cal");
  rowCache = null;
  frame = buildFrame();
  ensureYears();
  return `<div class="cal"><div class="lc" data-live>${stripInner()}</div><div class="cal-agenda">${agendaHtml()}</div></div>`;
}

/* After the tab's HTML is in place: a tab that was not on screen opens on the
   selected day; a redraw for new data keeps where the reader was. */
export function afterCalendar(mn, before) {
  mn.classList.remove("fast");
  if (S.fresh) {
    S.touched = false;
    goTo(S.sel, false);
    /* the fonts change row heights a little once they arrive */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { rowCache = null; if (!S.touched && ctx.isCalendar()) goTo(S.sel, false); });
  } else {
    mn.scrollTop = before.top;
    markJump(400); // the redraw's scroll event may land after render()'s own mark
  }
  watchStrip(mn);
  followBar(barOffset(), barHeight());
  syncBox();
}

/* The pin line: GAP under the strip when it sits above the agenda, GAP under
   the top bar beside it (expanded, where the grid card keeps the same 8px),
   and with the strip when the top bar slides away. Set in px on the two
   things that use it, the sticky probe carrying the box and the scroller's
   snap padding, so moving it restyles two elements, never the thousand rows. The strip's height changes (the month opening, a
   sixth row, the safe area) come through one observer, moved to each new
   strip. */
const GAP = 8;
let stripObs = null;
function placePin() {
  const mn = view(), probe = mn && mn.querySelector(".ag-pin"), t = stripEl();
  if (!probe || !t) return;
  const bar = document.getElementById("topBar"), barH = barHeight();
  const inset = bar ? parseFloat(getComputedStyle(bar).paddingTop) || 0 : 0;
  /* sticky offsets count from below the room #view keeps for the bar */
  const pin = (expanded() ? 0 : t.offsetHeight) + GAP;
  probe.style.top = `${pin}px`;
  /* the snap line is where the line will be once the bar rests, so a day
     snapped while the bar is still moving is already in the right place */
  mn.style.scrollPaddingTop = `${barH + pin + Math.max(barTarget(), lowestShift(barH, inset))}px`;
}
function watchStrip(mn) {
  const t = stripEl();
  if (!t) return;
  const set = () => { placePin(); pinMoved(); };
  if (typeof ResizeObserver === "function") {
    if (stripObs) stripObs.disconnect();
    stripObs = new ResizeObserver(set);
    stripObs.observe(t);
  }
  set();
}

/* The strip and the agenda's box follow the top bar (top-bar.js), offset for
   offset, in the same task as the bar moves: a transform each, so the bar
   leaving or coming back never lays anything out. The strip stops under the
   status bar (the bar's own safe-area padding); the line under it, and so the
   box and the rule, go with it. */
let shift = 0;
/* How far up the strip and the box may follow the bar. A phone: up to the
   status bar (the bar's safe-area padding). A wide window: they stop 28px
   from the top, level with the menu icon in the rail (Isa, 05/11/2026), so
   20px short of the 8px they sit under a showing bar. */
const RAIL_ALIGN = 20;
function lowestShift(H, inset) { return -(H - inset - (expanded() ? RAIL_ALIGN : 0)); }
function followBar(o, H) {
  const bar = document.getElementById("topBar");
  const inset = bar ? parseFloat(getComputedStyle(bar).paddingTop) || 0 : 0;
  shift = Math.max(o, lowestShift(H, inset));
  const tr = shift ? `translateY(${shift}px)` : "";
  for (const el of [stripEl(), view() && view().querySelector(".ag-pin")]) if (el) el.style.transform = tr;
  placePin();
  pinMoved();
}

/* ---- scrolling ---- */
const showBar = () => showTopBar();

/* The scroller's coordinate of the strip's lower edge: the top bar, plus the
   strip when it sits above the agenda (not in the side pane). `final` asks for
   the geometry once an opening or closing strip has finished moving, with the
   bar shown, which is where a programmatic scroll ends up. */
function edgeY(final) {
  const bar = document.getElementById("topBar"), t = stripEl();
  const shown = final || (bar && !bar.classList.contains("is-hidden"));
  const barH = shown && bar ? bar.offsetHeight : 0;
  if (expanded() || !t) return barH;
  const inner = t.firstElementChild;
  return barH + (final && inner ? inner.offsetHeight : t.offsetHeight);
}

/* the row's top in the scroller's own coordinates */
function rowTop(row) {
  const mn = view();
  return row.getBoundingClientRect().top - mn.getBoundingClientRect().top + mn.scrollTop;
}

/* Scroll so the day sits on the pin line, under the strip, where the box
   shows it whole. Always marked as a jump, so the top bar neither hides for
   it nor stays hidden after it. `smooth` glides (unless the phone asks for
   reduced motion). */
let settleTimer = 0;
function goTo(d, smooth) {
  const mn = view(), row = mn && mn.querySelector(`[data-row="${d}"]`);
  if (!row) return;
  const glide = smooth && motionFactor() > 0;
  /* a strip still moving to its new height has pushed the row by the
     difference; take it back off */
  const t = stripEl(), inner = t && t.firstElementChild;
  const moving = !expanded() && t && inner ? t.offsetHeight - inner.offsetHeight : 0;
  /* landed, the row's top is on the pin line, GAP under the strip */
  const top = Math.max(0, rowTop(row) - moving - edgeY(true) - GAP);
  const ms = glide ? Math.min(600, 250 + Math.abs(top - mn.scrollTop) / 20) : 0;
  /* marked after the measuring: a big layout can take longer than the mark */
  markJump(ms + 400);
  /* snapping off first: the bar coming back moves the snap line, and a
     snapped list would jump to it before the glide starts */
  if (ms) mn.classList.add("gliding");
  showBar();
  glideTo(mn, top, ms);
  /* once the jump mark is over the box and the strip agree again, whatever
     moved meanwhile (the top bar's slide, a late font) */
  clearTimeout(settleTimer);
  settleTimer = setTimeout(pinMoved, ms + 450);
}

/* The agenda glides to a day: emphasized easing, 250 to 600ms by distance. Our
   own loop rather than the browser's smooth scroll, so the duration is known
   (the jump mark covers it) and a hidden page still lands: a timer snaps to the
   end. Any touch, wheel or press on the list stops it. ms 0 is a jump. */
let glideId = 0, glideEnd = 0;
function stopGlide() { cancelAnimationFrame(glideId); clearTimeout(glideEnd); glideId = glideEnd = 0; const mn = view(); if (mn) mn.classList.remove("gliding"); }
/* the reader touched the list: the glide stops and their scroll drives the
   highlight and the bar at once */
function takeOver() { if (glideId || glideEnd) { stopGlide(); clearJump(); } }
const bezier = (x1, y1, x2, y2) => (x) => {
  const at = (a, b, c, t) => ((1 - t) ** 3) * 0 + 3 * ((1 - t) ** 2) * t * a + 3 * (1 - t) * t * t * b + t ** 3 * c;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = at(x1, x2, 1, t) - x, d = (at(x1, x2, 1, t + 1e-4) - at(x1, x2, 1, t - 1e-4)) / 2e-4;
    if (!d) break;
    t = Math.min(1, Math.max(0, t - err / d));
  }
  return at(y1, y2, 1, t);
};
const emphasized = bezier(0.2, 0, 0, 1);
function glideTo(mn, top, ms) {
  stopGlide();
  if (!ms || !motionFactor()) { mn.scrollTop = top; return; }
  /* every frame's scrollTop would be snapped to a day: off until it lands */
  mn.classList.add("gliding");
  const from = mn.scrollTop, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    mn.scrollTop = from + (top - from) * emphasized(p);
    if (p < 1) glideId = requestAnimationFrame(step);
    else { glideId = 0; clearTimeout(glideEnd); glideEnd = 0; mn.classList.remove("gliding"); } /* landed: the snap timer must not fire later */
  };
  glideId = requestAnimationFrame(step);
  glideEnd = setTimeout(() => { stopGlide(); mn.scrollTop = top; }, ms + 100);
}

/* Row tops and heights within the agenda, read once per draw (a draw, a
   resize or the fonts arriving drops them), never per scroll frame. */
let rowCache = null;
function rows() {
  if (rowCache) return rowCache;
  const ag = view() && view().querySelector(".cal-agenda");
  rowCache = ag ? [...ag.querySelectorAll(".ag[data-row]")].map((el) => ({ day: el.dataset.row, top: el.offsetTop, h: el.offsetHeight, el })) : [];
  return rowCache;
}

/* The pin line in the agenda's coordinates, where it is drawn: the sticky
   probe's offsetTop (the agenda is its offset parent; it counts the sticky
   offset) plus the shift it follows the top bar by. */
function pinY() {
  const probe = view() && view().querySelector(".cal-agenda > .ag-pin");
  return probe ? probe.offsetTop + shift : 0;
}

/* The fixed box takes the rule's day: that row gets .sel (its date and text
   colours) and the box takes its height, animated only when the height
   changes (300ms decelerate, as the strip's own box glides). The box itself
   never moves; scrolling and the snap bring the day to it. */
function setBox(res) {
  if (!res) return;
  const list = rows(), now = list[res.i];
  const box = view() && view().querySelector(".ag-box");
  if (S.box !== res.day) {
    const old = S.box && list.find((r) => r.day === S.box);
    if (old) old.el.classList.remove("sel");
    if (now) now.el.classList.add("sel");
  }
  if (box) {
    const want = `${res.vis}px`;
    if (box.style.height !== want) {
      const had = !!box.style.height, from = box.getBoundingClientRect().height;
      box.getAnimations().forEach((a) => a.cancel());
      box.style.height = want;
      /* a box just drawn (a new draw) takes its height at once, and so does
         one the list is racing through */
      if (had && !M.fast && Math.abs(from - res.vis) > 1) play(box, [{ height: `${from}px` }, { height: want }], 300, EASE.decelerate);
    }
  }
  S.box = res.day;
}
function syncBox() {
  const mn = view(), ag = mn && mn.querySelector(".cal-agenda");
  if (!frame || !ag || performance.now() < stripUntil) return;
  const probe = ag.querySelector(".ag-pin");
  const avail = probe ? mn.clientHeight - (parseFloat(mn.style.scrollPaddingTop) || 0) : Infinity;
  setBox(pinPick(rows(), pinY(), Math.max(48, avail)));
}

/* The reader scrolls the agenda: the box follows the rule on every scroll
   event (cheap: two rects and a binary search over cached rows), and the
   strip follows the box, its month too when the day crosses into another
   one, open or closed (Isa, 04/11/2026). A scroll the app caused (a tap's
   glide, back to today) moves the box but leaves the strip on the day the
   app went to. */
function onScroll() {
  if (!ctx.isCalendar() || !frame) return;
  track(view());
  syncBox();
  if (isJumping()) return;
  S.touched = true;
  followBox();
}
/* the pin line moved under a still list: the same rule, but not the reader's scroll */
function pinMoved() {
  if (!ctx.isCalendar() || !frame) return;
  syncBox();
  if (!isJumping()) followBox();
}
/* While the list moves fast the box keeps showing every day it passes, but
   the strip waits for the list to slow down or rest, then catches up in one
   move (Hugo skips weeks at a time, 05/11/2026). While it is still moving at
   all, the strip never redraws to a new week or month: a redraw would put
   the snap back on mid-fling and stop it dead. */
function followBox(force) {
  const cur = S.box;
  if (!cur || cur === S.sel) return;
  if (!force && (M.fast || (moving() && !sameStrip(cur)))) return;
  const prev = S.sel, crossed = cur.slice(0, 7) !== prev.slice(0, 7);
  S.sel = cur;
  if (!S.open || expanded() || crossed) S.month = cur.slice(0, 7);
  moveStripSel(prev);
}
/* the day is in the week or month the strip shows: its box can glide there */
function sameStrip(d) {
  const t = stripEl(), c = t && t.querySelector(`.lc-week [data-day="${d}"], .lc-grid [data-day="${d}"]:not(.out)`);
  return !!c && !c.disabled;
}

/* ---- fast scrolling ----
   Speed comes from the scroll events themselves (px per ms, smoothed), so a
   phone fling, a trackpad and a free-spinning wheel all count the same. Above
   FAST the strip and the box's height animation wait. A burst of wheel
   notches also lifts the snap (.fast): with a snap point on every day the
   browser pulls each notch back to a day, which is what made a free-spinning
   wheel crawl. When the list rests the snap comes back the way it would have
   landed anyway: a short glide to the nearest day on the pin line. A hard
   touch fling lifts it the same way (Hugo, 06/11/2026: "swipe hard just
   once and it goes brrrr through weeks"): with a snap point on every day the
   browser's snapped fling stopped after a few days. */
const FAST = 1.5, REST_MS = 140, WHEEL_BURST_MS = 80;
const M = { y: 0, t: 0, v: 0, fast: false, wheelAt: 0, rest: 0, touching: false };
const moving = () => performance.now() - M.t < REST_MS;
function track(mn) {
  const now = performance.now(), dt = now - M.t, dy = Math.abs(mn.scrollTop - M.y);
  /* a first event after a pause carries no speed */
  const v = dt > 0 && dt < REST_MS ? dy / dt : 0;
  M.v = M.v * 0.6 + v * 0.4;
  M.y = mn.scrollTop; M.t = now;
  if (M.v > FAST) {
    M.fast = true;
    if (ctx.isCalendar() && !mn.classList.contains("gliding") && !mn.classList.contains("fast")) mn.classList.add("fast");
  } else if (M.fast && M.v < FAST / 2) { M.fast = false; if (!isJumping()) followBox(); }
  clearTimeout(M.rest);
  M.rest = setTimeout(rest, REST_MS);
}
function onWheel() {
  const now = performance.now(), mn = view();
  if (ctx.isCalendar() && mn && now - M.wheelAt < WHEEL_BURST_MS && !mn.classList.contains("fast")) mn.classList.add("fast");
  M.wheelAt = now;
}
function rest() {
  M.v = 0;
  M.fast = false;
  const mn = view();
  if (!mn) return;
  if (!ctx.isCalendar() || !frame) { mn.classList.remove("fast"); return; }
  if (mn.classList.contains("fast")) {
    /* a notch may still be on its way, or a finger still down: wait for both */
    if (performance.now() - M.wheelAt < REST_MS || M.touching) { M.rest = setTimeout(rest, REST_MS); return; }
    const top = nearestSnap(mn);
    mn.classList.remove("fast");
    if (top != null && Math.abs(top - mn.scrollTop) > 1) {
      /* glideTo turns the snap off for the glide and back on once it lands */
      markJump(260);
      glideTo(mn, top, 180);
      return; // the glide's own scroll events bring the next rest
    }
  }
  syncBox();
  if (!isJumping()) followBox(true);
}
/* Where the browser's mandatory snap would settle: the scroll position that
   puts the nearest day's top on the snap line (the scroller's padding). */
function nearestSnap(mn) {
  const list = rows();
  if (!list.length) return null;
  const base = rowTop(list[0].el) - list[0].top;
  const line = mn.scrollTop + (parseFloat(mn.style.scrollPaddingTop) || 0) - base;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].top < line) lo = mid + 1; else hi = mid; }
  const best = lo > 0 && line - list[lo - 1].top < list[lo].top - line ? lo - 1 : lo;
  const max = mn.scrollHeight - mn.clientHeight;
  return Math.max(0, Math.min(max, mn.scrollTop + list[best].top - line));
}

/* The strip's box moves to S.sel. In the same week or month it glides there
   (a ghost box, transform only, then the cell takes the colour back);
   anything else redraws the strip, with its own slide. */
let ghost = null;
function moveStripSel(prev) {
  const t = stripEl(), body = t && t.querySelector(".lc-week, .lc-grid");
  const from = body && body.querySelector(`[data-day="${prev}"]`), to = body && body.querySelector(`[data-day="${S.sel}"]`);
  const title = t && t.querySelector(".lc-head .m3-title-m");
  const want = monthTitle(S.open || expanded() ? S.month : S.sel.slice(0, 7));
  if (!from || !to || to.disabled || !title || title.textContent !== want || (S.open || expanded()) && to.classList.contains("out")) { redrawStrip(); return; }
  if (ghost) { ghost.remove(); ghost = null; }
  body.querySelectorAll(".lc-d.arriving").forEach((c) => c.classList.remove("arriving"));
  from.classList.remove("sel");
  to.classList.add("sel");
  if (!motionFactor()) return;
  const g = document.createElement("span");
  g.className = "lc-ghost";
  g.style.cssText = `left:${from.offsetLeft}px;top:${from.offsetTop}px;width:${from.offsetWidth}px;height:${from.offsetHeight}px`;
  body.append(g);
  ghost = g;
  to.classList.add("arriving");
  play(g, [{ transform: "none" }, { transform: `translate(${to.offsetLeft - from.offsetLeft}px, ${to.offsetTop - from.offsetTop}px)` }], 300, EASE.decelerate, { fill: "forwards" })
    .then(() => { to.classList.remove("arriving"); g.remove(); if (ghost === g) ghost = null; });
}

/* ---- taps ---- */
function pickDay(d) {
  const prev = S.sel;
  S.sel = clampDay(d, frame.range.min, frame.range.max);
  S.month = S.sel.slice(0, 7);
  /* an open month stays open (Isa, 04/11/2026): only the handle, the month
     name or a swipe up closes it */
  moveStripSel(prev);
  goTo(S.sel, true);
}

/* The month chevrons. The open month (or the wide grid) shows the next
   month, as a swipe does; the closed week strip goes to that month's first
   day (today, for this month) and the agenda glides there. */
function stepMonth(s) {
  if (!frame) return;
  const open = S.open || expanded();
  const from = open ? S.month : S.sel.slice(0, 7);
  const m = clampMonth(addMonths(from, s), frame.range.min, frame.range.max);
  if (m === from) return;
  S.fx = s;
  if (open) { S.month = m; redrawStrip(); return; }
  const today = todayKey();
  S.sel = clampDay(today.slice(0, 7) === m ? today : `${m}-01`, frame.range.min, frame.range.max);
  S.month = S.sel.slice(0, 7);
  redrawStrip();
  goTo(S.sel, true);
}

/* Back to today: select it and glide there (the strip's box glides too when
   today is in the week or month on show). */
export function backToToday() {
  if (!frame) return;
  const prev = S.sel;
  S.sel = clampDay(todayKey(), frame.range.min, frame.range.max);
  S.month = S.sel.slice(0, 7);
  moveStripSel(prev);
  goTo(S.sel, true);
}

/* The sheet never opens over the menu drawer or a page: while one is up (or a
   sheet is open) the whole shell is inert and nothing here reacts. */
const layerUp = () => { const s = document.querySelector(".shell"); return !!(s && s.inert); };

function onClick(e) {
  if (!ctx.isCalendar() || !frame || layerUp()) return;
  const b = e.target.closest("#view [data-day], #view [data-act]");
  if (!b) return;
  if (b.dataset.day) pickDay(b.dataset.day);
  else {
    const a = b.dataset.act;
    if (a === "toggle") { S.open = !S.open; S.month = S.sel.slice(0, 7); redrawStrip(); }
    else if (a === "today") backToToday();
    else if (a === "mprev" || a === "mnext") stepMonth(a === "mnext" ? 1 : -1);
    else if (a === "day") openLevel({ kind: "day", d: b.dataset.d });
    else if (a === "event") {
      e.stopPropagation();
      /* the card grows into the event sheet (container transform) */
      const r = b.getBoundingClientRect();
      openLevel({ kind: "event", id: b.dataset.id }, { from: { x: r.left, y: r.top, w: r.width, h: r.height } });
    }
    else return;
  }
  e.preventDefault();
}

/* One day's events for the Day popup: every event on the day at this detail
   level, cancelled included; from the Archive, every event with no filtering. */
export function dayEvents(d, archive) {
  if (archive) return eventsOn(ctx.data.events(), d);
  return frame ? eventsOn(frame.all, d) : [];
}

/* The nav icon's badge. Independent of whatever is drawn (the badge shows
   even before the Calendar has been opened this session). */
export function todaysCount() {
  if (!ctx || !store.state.settings.me) return 0;
  const today = todayKey();
  return cmTodaysCount(eventsOn(ctx.data.events(), today), store.state.settings.me, today);
}

/* Things the sheet needs to draw its levels, from the same frame. */
export const frameNow = () => frame;
export const detailGrey = (e) => !!frame && frame.grey(e);

/* ---- the Archive (Settings > Archive) ----
   Every year the phone has data for, not only the calendar's range: a chip
   per year, then a card per month holding its emoji grid (one emoji a day, the
   Grid emoji order's winner, the same pick as the strip) and that month's
   events. It reads only: nothing here writes, and a tap on an event opens its
   page. Older years load when the page opens (cached ones first, offline too;
   one year at a time past the edges when online). */
const AR = { year: null, loading: false };

export function archiveOpened() {
  AR.year = null;
  if (!ctx) return;
  AR.loading = true;
  const done = () => { AR.loading = false; ctx.render(); };
  ctx.data.loadAllYears({ online: navigator.onLine !== false }).then(done, done);
}
export function archivePickYear(y) { AR.year = String(y); }

function archiveCard(ym, evs, idx, me, order) {
  const cells = monthCells(ym).map((c) => {
    const here = c.inMonth ? (idx.get(c.day) || []).filter((e) => e.status !== "cancelled") : [];
    const best = here.length ? pickDayIcon(here, c.day, { order, me }) : null;
    const grey = best && isTheirs(best.e, me);
    return `<div class="lc-d mc ar-d${c.inMonth ? "" : " out"}${c.day === todayKey() ? " today" : ""}">`
      + `<span class="dn m3-label-l">${Number(c.day.slice(8))}</span>`
      + `<span class="emos m3-emoji${grey ? " grey" : ""}" aria-hidden="true">${best ? esc(iconFor(best.a, best.e, me)) : ""}</span></div>`;
  }).join("");
  const rows = evs.map((e) => {
    const theirs = isTheirs(e, me);
    const cls = ["evc", "g-" + (theirs ? "other" : categoryGroup(firstType(e))), theirs ? "grey" : "", e.status === "idea" ? "idea" : "", e.status === "cancelled" ? "cancelled" : ""].filter(Boolean).join(" ");
    const sub = [theirs ? who(e.owner) : "", rowMeta(e, e.start), e.venue || ""].filter(Boolean).map(esc).join(" · ");
    return `<button type="button" class="${cls}" data-arch-ev="${esc(e.id)}">`
      + `<span class="evc-em m3-emoji" aria-hidden="true">${iconsOf(e, me).map(esc).join("")}</span>`
      + `<span class="evc-t"><span class="evc-name m3-body-l">${esc(e.title)}</span><span class="m3-body-s">${esc(longDay(e.start))}${sub ? " · " + sub : ""}</span></span></button>`;
  }).join("");
  const label = `${monthName(ym)} ${ym.slice(0, 4)}`;
  return `<section class="ar-card" aria-label="${esc(label)}"><div class="ar-head"><h2 class="m3-title-m">${esc(label)}</h2>`
    + `<span class="m3-label-m m3-variant">${evs.length} event${evs.length === 1 ? "" : "s"}</span></div>`
    + `<div class="lc-grid ar-grid">${LETTERS.map((w) => `<span class="lc-wd m3-label-s">${w}</span>`).join("")}${cells}</div>`
    + `<div class="ar-list">${rows}</div></section>`;
}

export function archiveHtml() {
  const s = store.state.settings, me = s.me, order = readPrefs(s).gridOrder;
  const all = ctx ? ctx.data.events().filter((e) => !e.deleted && typeof e.start === "string" && e.start.length === 10) : [];
  const years = [...new Set(all.map((e) => e.start.slice(0, 4)))].sort();
  const intro = '<p class="m3-body-m m3-variant page-intro">Everything in the calendar, a year at a time. Tap an event to open it.</p>';
  if (!years.length) {
    return `<div class="page-col">${intro}<div class="m3-empty-state"><div class="m3-empty-state__icon">${ms("inventory_2")}</div>`
      + `<p class="m3-title-m">${AR.loading ? "Looking for older years" : "Nothing archived yet"}</p>`
      + `<p class="m3-body-m m3-variant">${AR.loading ? "One moment." : "Events from earlier years show here once the phone has them."}</p></div></div>`;
  }
  const thisYear = todayKey().slice(0, 4);
  const y = years.includes(AR.year) ? AR.year : years.includes(thisYear) ? thisYear : years[years.length - 1];
  const inYear = all.filter((e) => e.start.slice(0, 4) === y)
    .sort((a, b) => (a.start + (a.startTime || "")).localeCompare(b.start + (b.startTime || "")));
  const idx = indexByDay(all);
  const months = [...new Set(inYear.map((e) => e.start.slice(0, 7)))];
  const chips = `<div class="m3-chips ar-years" role="radiogroup" aria-label="Year">${years.map((yy) =>
    `<button type="button" role="radio" aria-checked="${yy === y}" class="m3-chip${yy === y ? " is-selected" : ""}" data-arch-year="${esc(yy)}">${yy === y ? ms("check") : ""}${esc(yy)}</button>`).join("")}</div>`;
  return `<div class="page-col">${intro}${chips}`
    + `<p class="m3-body-m m3-variant page-intro">${inYear.length} event${inYear.length === 1 ? "" : "s"} in ${esc(y)}, in ${months.length} month${months.length === 1 ? "" : "s"}${AR.loading ? " (looking for older years)" : ""}</p>`
    + months.map((ym) => archiveCard(ym, inYear.filter((e) => e.start.startsWith(ym)), idx, me, order)).join("") + `</div>`;
}

/* Settings changed a default: the Calendar opens on it next time it draws. */
export function resetCalendarDefaults() { S.open = null; S.detail = null; }

/* The open month is a state of the strip, not a layer: nothing to close. */
export function closeMenus() { return false; }

/* ---- gestures on the strip ---- */
function stripGestures(mn) {
  let g = null, swiped = false;
  const body = () => mn.querySelector("[data-live] .lc-week, [data-live] .lc-grid");
  const spring = () => {
    const b = body();
    if (!b || !b.style.transform) return;
    const tr = b.style.transform;
    b.style.transform = "";
    play(b, [{ transform: tr }, { transform: "none" }], 250, EASE.decelerate);
  };
  mn.addEventListener("pointerdown", (e) => {
    g = !layerUp() && ctx.isCalendar() && e.button <= 0 && e.target.closest("[data-live]") ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  });
  /* the week or month follows the finger sideways */
  document.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y, b = body();
    if (b && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) b.style.transform = `translateX(${dx * 0.6}px)`;
  });
  document.addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.id) { g = null; spring(); } });
  document.addEventListener("pointerup", (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g = null;
    spring();
    const act = stripGesture({ dx, dy });
    if (!act || !frame) return;
    /* a swipe ends on a day; that is not a tap (cleared after 60ms) */
    swiped = true;
    setTimeout(() => { swiped = false; }, 60);
    const open = S.open || expanded(), s = act === "next" ? 1 : -1;
    if (act === "next" || act === "prev") {
      /* at either end of the range nothing moves: no empty month, no week
         past the last day (the finger's own spring-back is all that shows) */
      if (open) {
        const m = clampMonth(addMonths(S.month, s), frame.range.min, frame.range.max);
        if (m === S.month) return;
        S.month = m;
      } else {
        const d = clampDay(addDays(S.sel, 7 * s), frame.range.min, frame.range.max);
        if (d === S.sel) return;
        S.sel = d;
        S.month = d.slice(0, 7);
        goTo(S.sel, true);
      }
      S.fx = s;
    } else if (!expanded()) {
      S.open = act === "open";
      S.month = S.sel.slice(0, 7);
    } else return;
    redrawStrip();
  });
  mn.addEventListener("click", (e) => { if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); } }, true);
}

/* Registered once: the list node (#view) and the document persist. */
export function initCalendar(c) {
  ctx = c;
  const mn = view();
  onBarMove((o, H) => { if (ctx.isCalendar()) followBar(o, H); });
  mn.addEventListener("scroll", onScroll, { passive: true });
  for (const ev of ["wheel", "touchstart", "pointerdown"]) mn.addEventListener(ev, takeOver, { passive: true });
  mn.addEventListener("wheel", onWheel, { passive: true });
  mn.addEventListener("touchstart", () => { M.touching = true; }, { passive: true });
  for (const ev of ["touchend", "touchcancel"]) mn.addEventListener(ev, () => { M.touching = false; }, { passive: true });
  document.addEventListener("click", onClick);
  stripGestures(mn);
  /* the window crossed a size class: the strip is a pane or a card now */
  let size = document.documentElement.dataset.size;
  window.addEventListener("resize", () => {
    rowCache = null;
    const now = document.documentElement.dataset.size;
    if (now !== size) { size = now; if (ctx.isCalendar()) ctx.render(); }
  });
}
