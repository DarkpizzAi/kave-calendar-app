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
  box: null,      // the day the agenda's box is on (the rule's, see pinPick)
  vis: 0,         // that box's height
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
  t.innerHTML = stripInner();
  if (key) { const again = t.querySelector(key); if (again && !again.disabled) again.focus({ preventScroll: true }); }
  const h1 = t.offsetHeight, body = t.querySelector(".lc-week, .lc-grid");
  if (h0 && Math.abs(h1 - h0) > 2) {
    play(t, [{ height: `${h0}px` }, { height: `${h1}px` }], 400, EASE.emphasized);
    if (body) play(body, [{ opacity: 0 }, { opacity: 1 }], 200, "linear", { delay: 100 });
  } else if (S.fx && body) {
    play(body, [{ opacity: 0, transform: `translateX(${S.fx * 56}px)` }, { opacity: 1, transform: "none" }], 300, EASE.decelerate);
  }
  S.fx = 0;
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
  /* the box lives in the row (see .ag-hl in styles.css): sticky, so it moves
     with the scroll on the compositor and never trails the content */
  return `<div class="${cls}" data-row="${d}"><div class="ag-hlw" aria-hidden="true"><div class="ag-hl"></div></div>`
    + `<button type="button" class="ag-d" data-act="day" data-d="${d}" aria-label="Open ${esc(longDay(d))}">`
    + `<span class="ag-dw m3-label-s">${SHORTDOW[dayOfWeek(d)]}</span><span class="ag-dn m3-title-l">${Number(d.slice(8))}</span></button>`
    + `<div class="ag-evs">${holiday}${evs.map((e) => card(e, d)).join("")}${note}</div></div>`;
}

function agendaHtml() {
  const out = ['<div class="ag-mask" aria-hidden="true"></div><div class="ag-pin" aria-hidden="true"></div>'];
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
  syncBox();
}

/* The pin line under the strip, for CSS: --lc-h is the strip's height when it
   sits above the agenda (0 beside it, expanded), --lc-top its sticky offset
   (styles.css, it follows the top bar). One observer, moved to each new strip.
   The line can move with no scroll at all (the month opening, the top bar
   sliding in or out), so both re-run the rule. */
let stripObs = null;
function watchStrip(mn) {
  const cal = mn.querySelector(".cal"), t = stripEl();
  if (!cal || !t) return;
  if (!cal.dataset.pinWired) {
    cal.dataset.pinWired = "1";
    cal.addEventListener("transitionend", (e) => { if (e.target === cal && e.propertyName === "--lc-top") pinMoved(); });
  }
  if (typeof ResizeObserver !== "function") return;
  if (stripObs) stripObs.disconnect();
  const set = () => { cal.style.setProperty("--lc-h", `${expanded() ? 0 : t.offsetHeight}px`); pinMoved(); };
  stripObs = new ResizeObserver(set);
  stripObs.observe(t);
  set();
}

/* ---- scrolling ---- */
const showBar = () => { const b = document.getElementById("topBar"); if (b) b.classList.remove("is-hidden"); };

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
  /* landed, the line is at the row's top; if the rule would already give the
     box to the next day there, stop one pixel short */
  const res = pinPick(rows(), row.offsetTop);
  const short = res && res.day !== d ? 1 : 0;
  /* the pin line keeps a gap under the strip (styles.css --pin-gap) */
  const cal = mn.querySelector(".cal");
  const gap = cal ? parseFloat(getComputedStyle(cal).getPropertyValue("--pin-gap")) || 0 : 0;
  const top = Math.max(0, rowTop(row) - moving - edgeY(true) - gap - short);
  const ms = glide ? Math.min(600, 250 + Math.abs(top - mn.scrollTop) / 20) : 0;
  /* marked after the measuring: a big layout can take longer than the mark */
  markJump(ms + 400);
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
function stopGlide() { cancelAnimationFrame(glideId); clearTimeout(glideEnd); glideId = glideEnd = 0; }
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
  const from = mn.scrollTop, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    mn.scrollTop = from + (top - from) * emphasized(p);
    if (p < 1) glideId = requestAnimationFrame(step);
    else { glideId = 0; clearTimeout(glideEnd); glideEnd = 0; } /* landed: the snap timer must not fire later */
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

/* The pin line in the agenda's coordinates. A zero-height sticky probe sits
   on it (styles.css .ag-pin), so this is the line the CSS is really using,
   the top bar's slide and the strip's height animation included. */
function pinY() {
  const ag = view() && view().querySelector(".cal-agenda"), probe = ag && ag.querySelector(".ag-pin");
  return probe ? probe.getBoundingClientRect().top - ag.getBoundingClientRect().top : 0;
}

/* Put the agenda's box where the rule says. Its height only changes at a
   hand-over: a box that has to grow is revealed with a clip (paint only, no
   layout), and going back up the list a box that has to shrink is clipped
   down; the sticky CSS does all the rest, so no frame of scrolling runs any. */
function setBox(res) {
  if (!res) return;
  if (S.box === res.day) { S.vis = res.vis; return; }
  const list = rows(), from = S.vis, to = res.vis;
  const old = S.box && list.find((r) => r.day === S.box), now = list[res.i];
  const hlOf = (r) => r.el.querySelector(".ag-hl");
  if (old) { old.el.classList.remove("sel"); hlOf(old).getAnimations().forEach((a) => a.cancel()); }
  if (now) {
    now.el.classList.add("sel");
    hlOf(now).getAnimations().forEach((a) => a.cancel());
    if (old && to > from + 2) {
      play(hlOf(now), [{ clipPath: `inset(0 0 ${to - from}px 0 round 12px)` }, { clipPath: "inset(0 0 0 0 round 12px)" }], 300, EASE.decelerate);
    } else if (old && from > to + 2) {
      old.el.classList.add("leaving");
      play(hlOf(old), [{ clipPath: "inset(0 0 0 0 round 12px)" }, { clipPath: `inset(0 0 ${from - to}px 0 round 12px)` }], 300, EASE.decelerate, { fill: "forwards" })
        .then(() => { old.el.classList.remove("leaving"); hlOf(old).getAnimations().forEach((a) => a.cancel()); });
    }
  }
  S.box = res.day;
  S.vis = to;
}
function syncBox() {
  if (!frame || !view() || !view().querySelector(".cal-agenda")) return;
  setBox(pinPick(rows(), pinY()));
}

/* The reader scrolls the agenda: the box follows the rule on every scroll
   event (cheap: two rects and a binary search over cached rows), and the
   strip follows the box, its month too when the day crosses into another
   one, open or closed (Isa, 04/11/2026). A scroll the app caused (a tap's
   glide, back to today) moves the box but leaves the strip on the day the
   app went to. */
function onScroll() {
  if (!ctx.isCalendar() || !frame) return;
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
function followBox() {
  const cur = S.box;
  if (cur && cur !== S.sel) {
    const prev = S.sel, crossed = cur.slice(0, 7) !== prev.slice(0, 7);
    S.sel = cur;
    if (!S.open || expanded() || crossed) S.month = cur.slice(0, 7);
    moveStripSel(prev);
  }
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
  const detail = S.detail || readPrefs(store.state.settings).defaultDetail;
  const today = todayKey();
  return cmTodaysCount(eventsOn(ctx.data.events(), today), store.state.settings.me, detail, today);
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
    + `<p class="m3-label-l m3-variant page-intro">${inYear.length} event${inYear.length === 1 ? "" : "s"} in ${esc(y)}, in ${months.length} month${months.length === 1 ? "" : "s"}${AR.loading ? " (looking for older years)" : ""}</p>`
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
  mn.addEventListener("scroll", onScroll, { passive: true });
  for (const ev of ["wheel", "touchstart", "pointerdown"]) mn.addEventListener(ev, takeOver, { passive: true });
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
