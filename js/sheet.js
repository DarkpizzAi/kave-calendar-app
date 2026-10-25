/* Compass: the one sheet (spec section 3, "The sheet").

   Levels, top to bottom: a single day, then whatever other screens register
   (the event page and form, Settings' sheets). Tapping
   inside replaces the content and the title; there is never a second sheet.
   Each level is a history entry, so phone Back, browser Back, Escape and
   Backspace go up one level; tapping or swiping the header closes it.

   Depth moves vertically: going deeper, the old content slides up and out
   while the new level rises from the bottom; Back reverses. (Switching views
   stays sideways: views sit side by side, levels stack.) */
"use strict";

import { escapeHtml as esc, safeUrl } from "./util.js";
import { addDays, dayOfWeek } from "./dates.js";
import { holidayOn, isProvisional } from "./holidays.js";
import { iconsOf, guestsExcludingViewer, rowLinks, shownStatus, gesture } from "./cal-model.js";
import { frameNow, detailGrey, dayEvents } from "./calendar.js";
import { ICON } from "./chrome-icons.js";
import { STATUS_LABEL } from "./model.js";

const LONGDOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (d) => `${LONGDOW[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Run fn once an animation ends, or after a timeout: animationend never
   fires while the page is hidden or throttled, and layers must not pile up. */
function afterAnim(el, fn, ms = 450) {
  let done = false;
  const go = () => { if (!done) { done = true; fn(); } };
  el.addEventListener("animationend", (e) => { if (e.target === el) go(); });
  setTimeout(go, ms);
}

let stack = [];
let root = null;

/* F21: the single day view's own "+", persisted the way the header bar
   already persists (it lives in the sheet's fixed chrome, outside the
   scrolling .sbody, exactly how the "+" fab stays on screen elsewhere in
   the Calendar tab -- calendar.js/render.js's #fabs). view-event.js sets
   this once, at boot, to avoid a circular import. */
let dayAdd = null;
export function setDayAdd(fn) { dayAdd = fn; }

/* Other screens add their own levels (Settings: Calendar defaults,
   Categories; the event page and form): { title(level), body(level),
   onAction(button), bar(level) for buttons in the bar, onInput(field) }. */
const custom = {};
export function registerLevel(kind, def) { custom[kind] = def; }

export const sheetOpen = () => stack.length > 0;
export const topLevel = () => stack[stack.length - 1] || null;

function title(l) {
  if (custom[l.kind]) return custom[l.kind].title(l);
  return l.kind === "day" ? longDay(l.d) : "";
}

const who = (o) => (o === "isa" ? "Isa" : o === "hugo" ? "Hugo" : "Both of you");

/* Day level: no cards, a strip per event; a time and names say what they
   are, so no "When / Who / Where" labels. Layout A (title left, icons right,
   a chevron column) until Task 9c settles it. */
/* The icons share a flex row with the chevron, beside the (possibly
   multi-line) title block, so they centre on the chevron rather than on
   the title's first line. */
/* Name, title, status pill, in that order. Named only when the event is
   neither the viewer's own nor shared. */
function stripName(e, f) { return e.owner !== f.me && e.owner !== "shared" ? who(e.owner) : ""; }

const LINK_GLYPH = ["🎟", "📱", "🌐"];
function strip(e, f, d) {
  /* Emoji left; title; one grey line (time, guests, open to-dos); the best
     tier of links, a line each, then "+ N more"; status top right. The guests
     rule (viewer's own name removed) stays in guestsExcludingViewer. */
  const guests = guestsExcludingViewer(e.guests, who(f.me));
  const name = stripName(e, f);
  const open = (e.checklist || []).filter((c) => !c.done).length;
  const meta = [d === e.start ? e.startTime : "", guests].filter(Boolean).map(esc).join('<span class="dsep">·</span>');
  const count = open ? `<span class="dcount" role="img" aria-label="${open} open to-do${open > 1 ? "s" : ""}">${open}${ICON.checkbox}</span>` : "";
  const { shown, more, tier } = rowLinks((e.links || []).filter((l) => safeUrl(l.url)));
  const links = shown.map((l) => `<a class="dlink" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">`
    + `<span aria-hidden="true">${LINK_GLYPH[tier]}</span><span class="dlt">${esc(l.label)}</span>${ICON.chev}</a>`).join("")
    + (more ? `<p class="dmore">+ ${more} more link${more > 1 ? "s" : ""}</p>` : "");
  const status = shownStatus(e);
  const st = status === "booked" ? " st-b" : status === "cancelled" ? " st-c" : "";
  return `<section class="dsec dst${st}${detailGrey(e) ? " greyw" : ""}" data-sact="event" data-id="${esc(e.id)}" role="button" tabindex="0">`
    + `<span class="dem">${iconsOf(e, f.me).map(esc).join("")}</span>`
    + `<div class="dmain"><h3>${name ? `${esc(name)} ` : ""}${esc(e.title)}</h3>`
    + `<span class="dstat">${esc(STATUS_LABEL[status] || "")}</span>`
    + (meta || count ? `<p class="dline">${meta}</p>${count}` : "") + (links ? `<div class="dlinks">${links}</div>` : "")
    + `</div></section>`;
}
/* The day's events come from dayEvents (calendar.js): the same list
   whichever view the day was opened from -- cancelled ones included, shown
   with their Cancelled status -- and every event when opened from the
   Archive (`archive` on the level). */
function dayBody(l, f) {
  const d = l.d, evs = dayEvents(d, l.archive), hol = holidayOn(d);
  /* a year the Generalitat has not published yet is our own guess: say so */
  const holText = hol ? `Bank holiday: ${hol}${isProvisional(d) ? " (provisional)" : ""}` : "";
  return `<div class="dpage">${hol ? `<p class="dhol">${esc(holText)}</p>` : ""}${evs.map((e) => strip(e, f, d)).join("")}</div>`;
}

function body(l) {
  if (custom[l.kind]) return custom[l.kind].body(l);
  const f = frameNow();
  return f && l.kind === "day" ? dayBody(l, f) : "";
}

/* ---- drawing ---- */
/* [old's exit class, new's entrance class] per anim value draw() gets. */
const ANIM_DIR = { deeper: ["out-up", "in-up"], shallower: ["out-down", "in-down"],
  next: ["out-left", "in-left"], prev: ["out-right", "in-right"] };
function draw(anim) {
  if (!stack.length) {
    if (!root.firstChild) return;
    const sh = root.querySelector(".sheet");
    if (reduced() || !sh) { root.innerHTML = ""; return; }
    sh.classList.add("out");
    root.querySelector(".shade").classList.add("out");
    afterAnim(sh, () => { if (!stack.length) root.innerHTML = ""; });
    return;
  }
  const l = stack[stack.length - 1];
  let sh = root.querySelector(".sheet:not(.out)");
  if (!sh) {
    root.innerHTML = '<div class="shade" data-sact="close"></div><section class="sheet in" role="dialog" aria-modal="true" aria-labelledby="stitle">'
      + '<header class="sbar" data-sact="close" data-swipe="sheet"><span class="grab" aria-hidden="true"></span>'
      + '<div class="stitle-wrap"><h2 class="stitle" id="stitle"></h2><div class="stags"></div></div><div class="bar-acts"></div></header>'
      + '<div class="sstage"></div></section>';
    sh = root.querySelector(".sheet");
    anim = "";
  }
  sh.className = `sheet lv-${l.kind}${anim === "" && sh.classList.contains("in") ? " in" : ""}`;
  sh.querySelector(".stitle").textContent = title(l);
  const def = custom[l.kind];
  sh.querySelector(".stags").innerHTML = def && def.tags ? def.tags(l) : "";
  sh.querySelector(".bar-acts").innerHTML = l.kind === "day"
    ? `<button class="sbtn" data-sact="newday" aria-label="Add an event">${ICON.plus}</button>`
    : def && def.bar ? def.bar(l) : "";
  const stage = sh.querySelector(".sstage");
  const fresh = document.createElement("div");
  fresh.className = "sbody";
  fresh.innerHTML = body(l);
  const old = stage.querySelector(".sbody:not(.leaving)");
  stage.querySelectorAll(".sbody.leaving").forEach((n) => n.remove());
  if (!old || !anim || reduced()) {
    /* a redraw in place (a tick, new data) keeps where the reader was */
    const keep = old && !anim ? old.scrollTop : 0;
    stage.replaceChildren(fresh);
    fresh.scrollTop = keep;
    return;
  }
  /* both layers stay until the animation ends, so the old one visibly
     leaves -- vertically for stack depth (deeper/shallower), horizontally
     for a day swipe (next/prev, ANIM_DIR below): the old day slides out
     the way the finger swiped, the new one arrives from the far side, the
     same two-layer trick either way. */
  const [outCls, inCls] = ANIM_DIR[anim] || ANIM_DIR.shallower;
  old.classList.add("leaving", outCls);
  fresh.classList.add(inCls);
  stage.append(fresh);
  afterAnim(fresh, () => { old.remove(); fresh.classList.remove(inCls); });
}

/* A background redraw (new data from a sync) must never rebuild an open
   form: the input would be replaced and the phone's keyboard would close
   mid-word (final review I2). The form's values live in its draft anyway. */
const FORMS = ["edit", "new", "ins-clean"]; // the clean-up cards hold a free-text box
export const refreshable = (l) => !!l && !FORMS.includes(l.kind);

/* Called after the page redraws (new data): refresh the open level in place. */
export function refreshSheet() { if (refreshable(stack[stack.length - 1])) draw(""); }

/* Swap the level on top for another (a new event, once saved, becomes its
   page; a day swipe steps to the next/previous day, anim "next"/"prev").
   Defaults to no animation -- an in-place redraw (a form's own re-render,
   an edit becoming its event page) must never suddenly slide. */
export function replaceTop(l, anim = "") {
  if (!stack.length) return openLevel(l);
  stack[stack.length - 1] = l;
  draw(anim);
}

export function openLevel(l) {
  const deeper = stack.length > 0;
  stack.push(l);
  try { history.pushState({ compassLevel: stack.length }, ""); } catch { /* sandboxed host */ }
  draw(deeper ? "deeper" : "");
}

function up() {
  if (!stack.length) return;
  stack.pop();
  draw(stack.length ? "shallower" : "");
}

export function back() {
  if (!stack.length) return false;
  try { history.back(); } catch { up(); }
  return true;
}

/* closeAll steps history back n entries at once; the browser answers with
   popstate events that must not each close another level. They are ignored
   one by one, never more than were caused (final review M3). */
export function createPopGate() {
  let pending = 0;
  return { expect(n) { pending += n; }, take() { if (pending > 0) { pending--; return true; } return false; }, reset() { pending = 0; } };
}
const pops = createPopGate();

export function closeAll() {
  const n = stack.length;
  if (!n) return;
  stack = [];
  draw("");
  /* history.go(-n) fires a single popstate for the whole jump */
  pops.expect(1);
  try { history.go(-n); } catch { pops.reset(); }
}

export function initSheet() {
  root = document.getElementById("sheetRoot");
  window.addEventListener("popstate", () => {
    if (pops.take()) return;
    if (stack.length) up();
  });
  root.addEventListener("click", (e) => {
    /* F21: the day level's own "+" is a .bar-acts button carrying
       data-sact, unlike every registered level's own bar buttons (they
       dispatch through onAction below by data-act instead) -- caught here,
       ahead of that split, or the .bar-acts branch below would swallow it
       looking for an onAction "day" never registers. */
    if (e.target.closest("a.dlink")) return;
    const newDayBtn = e.target.closest('[data-sact="newday"]');
    if (newDayBtn) { const l = stack[stack.length - 1]; if (dayAdd && l) dayAdd(l.d); return; }
    const barBtn = e.target.closest(".bar-acts button");
    const b = barBtn ? null : e.target.closest("[data-sact]");
    if (!b) {
      /* a registered level's own buttons go to its handler */
      const l = stack[stack.length - 1], btn = e.target.closest("button");
      if (btn && l && custom[l.kind] && custom[l.kind].onAction) {
        custom[l.kind].onAction(btn);
        /* opening another level has drawn it with its own animation already (M2) */
        if (stack[stack.length - 1] === l) draw("");
      }
      return;
    }
    const a = b.dataset.sact;
    if (a === "close") closeAll();
    else if (a === "event") openLevel({ kind: "event", id: b.dataset.id });
  });
  const onField = (e) => {
    const l = stack[stack.length - 1];
    if (l && custom[l.kind] && custom[l.kind].onInput) custom[l.kind].onInput(e.target, e);
  };
  root.addEventListener("input", onField);
  root.addEventListener("change", onField);
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-sact][role=button]")) { e.preventDefault(); e.target.click(); }
  });
  /* swipe the header down to close */
  let y0 = null;
  root.addEventListener("pointerdown", (e) => { y0 = e.target.closest("[data-swipe]") ? e.clientY : null; });
  root.addEventListener("pointerup", (e) => {
    if (y0 != null && e.clientY - y0 > 60) {
      swallowSheetClick();
      closeAll();
    }
    y0 = null;
  });

  /* The single day level: swipe anywhere in the body sideways to step to
     the previous or next day, one at a time -- replaceTop, not openLevel,
     so repeated swipes never pile up history entries (final review I6's
     one gesture rule, reused rather than re-derived). Previous is left
     (swipe right, dx > 0), next is right (swipe left, dx < 0), matching
     calendar.js's own view-swipe direction. */
  let d0 = null;
  const dayStart = (x, y) => {
    const l = stack[stack.length - 1];
    d0 = l && l.kind === "day" ? { x, y, d: l.d, archive: l.archive } : null;
  };
  const dayEnd = (x, y) => {
    if (!d0) return;
    const act = gesture({ dx: x - d0.x, dy: y - d0.y, top: false, searching: false });
    const { d: from, archive } = d0;
    d0 = null;
    if (act === "next" || act === "prev") {
      swallowSheetClick();
      replaceTop({ kind: "day", d: addDays(from, act === "next" ? 1 : -1), archive }, act);
    }
  };
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" && e.target.closest(".sbody")) dayStart(e.clientX, e.clientY);
  });
  document.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") dayEnd(e.clientX, e.clientY); });
  root.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1 && e.target.closest(".sbody")) dayStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  root.addEventListener("touchend", (e) => { const t = e.changedTouches[0]; if (t) dayEnd(t.clientX, t.clientY); }, { passive: true });
}

/* A swipe ends in a click on whatever was under the finger (a day row, an
   event strip): eat that one click, the same trick calendar.js uses for
   its own view swipe. */
function swallowSheetClick() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 400);
}
