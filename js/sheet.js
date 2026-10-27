/* Compass: the sheet system (Material 3 popups, spec sections 8 to 10).

   One history entry per layer. The order, bottom to top:
     the sheet      a bottom sheet on a phone, a side sheet on wider windows;
                    it holds the stack of levels (a single day, the event
                    page, the ticket, whatever other screens register);
     the form       the event form is a level too, but it draws as a
                    full-screen dialog on a phone and a dialog otherwise,
                    over the sheet it was opened from;
     layers         menus, dialogs and pickers (openLayer): each takes a
                    history entry, so the phone's Back closes exactly one.
   A level opened from another moves along the shared axis. The container
   under a modal layer is inert, and focus returns to what opened it.
   Closing always goes through history, so Back, Escape, a scrim tap and a
   button are one path, and a second request for the same close is ignored. */
"use strict";

import { escapeHtml as esc } from "./util.js";
import { addDays, dayOfWeek } from "./dates.js";
import { holidayOn, isProvisional } from "./holidays.js";
import { iconsOf, guestsExcludingViewer, rowMeta, categoryGroup, gesture, hasOpenTodos } from "./cal-model.js";
import { frameNow, detailGrey, dayEvents } from "./calendar.js";
import { ms } from "./chrome-icons.js";
import { splitLinks, ticketButton } from "./tickets.js";
import { enterLayer, exitLayer, sharedAxisIn, sharedAxisOut, play, EASE, motionFactor, showSnackbar } from "../m3/kave-m3.js";

const LONGDOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (d) => `${LONGDOW[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const who = (o) => (o === "isa" ? "Isa" : o === "hugo" ? "Hugo" : "Both of you");
const compact = () => { const s = document.documentElement.dataset.size; return s !== "medium" && s !== "expanded"; };

let stack = [];          // levels, bottom to top
let layers = [];         // menus, dialogs, pickers, bottom to top
let root = null;         // #sheetRoot: the sheet and the form
let layerRoot = null;    // #layerRoot: the transient layers
let shown = null;        // the sheet on screen: { lv, host, el, side, ... }
let formShown = null;    // the form on screen
let opener = null;       // what had focus when the first layer opened
const closing = new WeakSet(); // layers and levels already asked to close

/* The single day's own "+": set once at boot to avoid a circular import. */
let dayAdd = null;
export function setDayAdd(fn) { dayAdd = fn; }

/* Other screens add their own levels: { title(level), body(level),
   bar(level) for the header's buttons, onAction(button), onInput(field, event),
   layer: "form" to draw as a full-screen dialog / dialog }. */
const custom = {};
export function registerLevel(kind, def) { custom[kind] = def; }

const isForm = (l) => !!(l && custom[l.kind] && custom[l.kind].layer === "form");
export const sheetOpen = () => stack.length > 0 || layers.length > 0;
export const topLevel = () => stack[stack.length - 1] || null;
const sheetLevels = () => stack.filter((l) => !isForm(l));

function title(l) {
  if (custom[l.kind]) return custom[l.kind].title(l);
  return l.kind === "day" ? longDay(l.d) : "";
}

/* ---------- the day level ---------- */
const firstType = (e) => (e.activities && e.activities[0] && e.activities[0].type) || "none";

function dayCard(e, f, d) {
  const theirs = detailGrey(e);
  const group = theirs ? "other" : categoryGroup(firstType(e));
  const cancelled = e.status === "cancelled";
  const cls = ["dcard", "g-" + group, theirs ? "grey" : "", e.status === "idea" ? "idea" : "", cancelled ? "cancelled" : ""].filter(Boolean).join(" ");
  const guests = guestsExcludingViewer(e.guests, who(f.me));
  const sub = [theirs ? who(e.owner) : "", rowMeta(e, d), guests, e.venue || ""].filter(Boolean).map(esc).join(" · ");
  const todo = hasOpenTodos(e) ? `<span class="evc-todo" role="img" aria-label="Open to-dos">${ms("checklist")}</span>` : "";
  const tickets = splitLinks(e).tickets.map((t) => ticketButton(e, t, "m3-btn m3-btn--tonal m3-btn--small dcard-tk",
    `${ms("confirmation_number")}<span>${esc(t.name || "Ticket")}</span>`, `Open ${t.name || "the ticket"}`)).join("");
  return `<div class="${cls}"><button type="button" class="dcard-main" data-sact="event" data-id="${esc(e.id)}">`
    + `<span class="evc-em m3-emoji" aria-hidden="true">${iconsOf(e, f.me).map(esc).join("")}</span>`
    + `<span class="evc-t"><span class="evc-name m3-body-l">${esc(e.title)}</span><span class="m3-body-s">${sub}</span></span>${todo}</button>`
    + (tickets ? `<div class="dcard-acts">${tickets}</div>` : "") + "</div>";
}

function dayBody(l, f) {
  const d = l.d, evs = dayEvents(d, l.archive), hol = holidayOn(d);
  /* a year the Generalitat has not published yet is our own guess: say so */
  const holText = hol ? `Bank holiday: ${hol}${isProvisional(d) ? " (provisional)" : ""}` : "";
  const holiday = hol ? `<p class="dhol m3-body-m">${ms("celebration")}<span>${esc(holText)}</span></p>` : "";
  const list = evs.length ? `<div class="dlist">${evs.map((e) => dayCard(e, f, d)).join("")}</div>`
    : `<div class="m3-empty-state"><span class="m3-empty-state__icon">${ms("event_available")}</span>`
      + `<p class="m3-title-m">Nothing planned</p><p class="m3-body-m m3-variant">A free day. Add something, or keep it that way.</p>`
      + `<button type="button" class="m3-btn m3-btn--tonal" data-sact="newday">${ms("add")}Add an event</button></div>`;
  return `<div class="dpage">${holiday}${list}</div>`;
}

function body(l) {
  if (custom[l.kind]) return custom[l.kind].body(l);
  const f = frameNow();
  return f && l.kind === "day" ? dayBody(l, f) : "";
}

/* The day's own buttons: earlier, later, add. They stop at the ends of the
   calendar's range. */
function dayBar(l) {
  const f = frameNow(), r = f && f.range;
  const prev = !r || l.d > r.min, next = !r || l.d < r.max;
  return `<button type="button" class="m3-icon-btn" data-sact="prev" aria-label="Previous day"${prev ? "" : " disabled"}>${ms("chevron_left")}</button>`
    + `<button type="button" class="m3-icon-btn" data-sact="next" aria-label="Next day"${next ? "" : " disabled"}>${ms("chevron_right")}</button>`
    + `<button type="button" class="m3-icon-btn" data-sact="newday" aria-label="Add an event on this day">${ms("add")}</button>`;
}

/* ---------- the containers ---------- */
function headHtml(side) {
  return `<header class="m3-sheet__head sheet-head"${side ? "" : " data-grip"}><span class="sback"></span>`
    + `<h2 class="m3-sheet__title" id="stitle"></h2><div class="bar-acts"></div>`
    + (side ? `<button type="button" class="m3-icon-btn" data-sact="close" aria-label="Close">${ms("close")}</button>` : "") + "</header>";
}

function mountHost(className, innerHtml) {
  const host = document.createElement("div");
  host.className = "layer-host " + className;
  host.innerHTML = innerHtml;
  root.append(host);
  return host;
}

function mountSheet(l, from) {
  const side = !compact();
  const host = mountHost("sheet-host",
    '<div class="m3-scrim" data-sact="scrim"></div>'
    + `<section class="sheet ${side ? "m3-sheet--side" : "m3-sheet--bottom"}" role="dialog" aria-modal="true" aria-labelledby="stitle" tabindex="-1">`
    + (side ? "" : '<div class="m3-drag-handle" data-grip aria-hidden="true"></div>')
    + headHtml(side) + '<div class="sstage"></div></section>');
  const el = host.querySelector(".sheet");
  shown = { lv: null, host, el, side, kind: side ? "side" : "bottom", stage: host.querySelector(".sstage"), dragged: false };
  paint(shown, l, "", true);
  enterLayer(el, shown.kind, from);
  if (!side) bindDrag(shown);
  syncInert();
  el.focus({ preventScroll: true });
}

function mountForm(l) {
  const page = compact();
  const host = mountHost("form-host",
    (page ? "" : '<div class="m3-scrim" data-sact="scrim"></div>')
    + `<section class="sheet form-sheet ${page ? "m3-page" : "m3-dialog"}" role="dialog" aria-modal="true" aria-labelledby="stitle" tabindex="-1">`
    + headHtml(true).replace(/<button type="button" class="m3-icon-btn" data-sact="close"[^>]*>.*?<\/button>/, "")
    + '<div class="sstage"></div></section>');
  const el = host.querySelector(".sheet");
  /* a form closes with a cross at its left, where a back arrow would be */
  host.querySelector(".sback").innerHTML = `<button type="button" class="m3-icon-btn" data-sact="back" aria-label="Close without saving">${ms("close")}</button>`;
  formShown = { lv: null, host, el, side: false, kind: page ? "page" : "dialog", stage: host.querySelector(".sstage") };
  paint(formShown, l, "", true);
  enterLayer(el, formShown.kind);
  syncInert();
  el.focus({ preventScroll: true });
}

/* Draw a level into a container: its header, then its body. anim is
   "deeper", "shallower", "next" or "prev" (the shared axis along x), or ""
   for a redraw in place that keeps where the reader was. */
function paint(view, l, anim, first = false) {
  const prevLv = view.lv;
  view.lv = l;
  const sheetView = view === shown;
  const el = view.el, def = custom[l.kind];
  el.dataset.level = l.kind;
  el.querySelector(".stitle, .m3-sheet__title").textContent = title(l);
  const depth = sheetLevels().length;
  if (sheetView) el.querySelector(".sback").innerHTML = depth > 1
    ? `<button type="button" class="m3-icon-btn" data-sact="back" aria-label="Back">${ms("arrow_back")}</button>` : "";
  el.querySelector(".bar-acts").innerHTML = l.kind === "day" ? dayBar(l) : def && def.bar ? def.bar(l) : "";
  /* a phone's sheet is as tall as its content, up to nearly the screen, but
     a page of detail is always tall so going deeper does not jump */
  const h0 = sheetView && !view.side && !first ? el.offsetHeight : 0;
  if (sheetView && !view.side) el.classList.toggle("is-tall", l.kind !== "day");
  const fresh = document.createElement("div");
  fresh.className = "m3-sheet__body sbody";
  fresh.innerHTML = body(l);
  const stage = view.stage;
  const old = stage.querySelector(".sbody:not(.leaving)");
  stage.querySelectorAll(".sbody.leaving").forEach((n) => n.remove());
  if (!old || !anim || !motionFactor()) {
    const keep = old && !anim && prevLv && prevLv.kind === l.kind && prevLv.id === l.id && prevLv.d === l.d ? old.scrollTop : 0;
    stage.replaceChildren(fresh);
    fresh.scrollTop = keep;
  } else {
    const dir = anim === "deeper" || anim === "next" ? 1 : -1;
    old.classList.add("leaving");
    old.inert = true;
    stage.append(fresh);
    sharedAxisOut(old, dir).then(() => old.remove());
    sharedAxisIn(fresh, dir);
  }
  if (h0 && Math.abs(el.offsetHeight - h0) > 2) play(el, [{ height: `${h0}px` }, { height: `${el.offsetHeight}px` }], 300, EASE.emphasized);
}

function hideView(view, onDone) {
  view.host.inert = true;
  const done = () => { view.host.remove(); if (onDone) onDone(); };
  /* a dragged sheet is already leaving on its own animation */
  if (view.dragged) setTimeout(done, 280);
  else if (!motionFactor()) done();
  else exitLayer(view.el, view.kind).then(done);
}

/* Everything below the top modal is inert; focus and the screen reader stay
   inside it. */
function syncInert() {
  const hosts = [];
  if (shown) hosts.push(shown.host);
  if (formShown) hosts.push(formShown.host);
  layers.forEach((l) => hosts.push(l.host));
  hosts.forEach((h, i) => { h.inert = i < hosts.length - 1; });
  const shell = document.querySelector(".shell");
  const covers = coverPages();
  /* a page (Settings, the Archive, search) under the sheet is out of reach
     while the sheet is up, and the shell stays inert behind it after */
  covers.forEach((p) => { p.inert = hosts.length > 0; });
  if (shell) shell.inert = hosts.length > 0 || covers.some((p) => !p.hidden);
}
/* the full-screen pages a sheet can open over */
const coverPages = () => ["page", "searchPage"].map((id) => document.getElementById(id)).filter(Boolean);

function restoreFocus() {
  const o = opener; opener = null;
  if (o && o.isConnected && o.offsetParent !== null) { try { o.focus({ preventScroll: true }); } catch { /* gone */ } }
}

/* Bring the screen in line with the stack. force repaints the top level's
   container even when it is the same level object. */
function sync(anim = "", from = null, force = false) {
  const top = stack[stack.length - 1] || null;
  const formLv = isForm(top) ? top : null;
  const sheetLv = sheetLevels().pop() || null;
  const formGone = !formLv && formShown;
  if (formLv) {
    if (!formShown) mountForm(formLv);
    else if (formShown.lv !== formLv || force) paint(formShown, formLv, anim);
  } else if (formShown) {
    const f = formShown; formShown = null;
    hideView(f);
  }
  if (sheetLv) {
    if (!shown) mountSheet(sheetLv, from);
    else if (shown.lv !== sheetLv || (force && !formLv) || formGone) paint(shown, sheetLv, shown.lv !== sheetLv ? anim : "");
  } else if (shown) {
    const s = shown; shown = null;
    hideView(s);
  }
  syncInert();
  if (!stack.length) restoreFocus();
}

/* ---------- drag to close (a phone's bottom sheet) ---------- */
function bindDrag(view) {
  const { el, host } = view, scrim = host.querySelector(".m3-scrim");
  let y0 = null, dy = 0, h = 1, id = null;
  host.querySelectorAll("[data-grip]").forEach((g) => {
    g.style.touchAction = "none";
    g.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      el.getAnimations().forEach((a) => a.cancel());
      y0 = e.clientY; dy = 0; h = el.offsetHeight || 1; id = e.pointerId;
      try { g.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    });
    g.addEventListener("pointermove", (e) => {
      if (y0 == null || e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - y0);
      el.style.transform = `translateY(${dy}px)`;
      if (scrim) scrim.style.opacity = String(Math.max(0, 1 - dy / h));
    });
    const end = (cancelled) => {
      if (y0 == null) return;
      y0 = null;
      const from = dy;
      const fade = scrim ? Number(scrim.style.opacity || 1) : 1;
      if (!cancelled && from > h / 3) {
        /* leave from where the finger let go; the history is walked back at once */
        const t = Math.max(120, 250 * (1 - from / h));
        view.dragged = true;
        if (scrim) play(scrim, [{ opacity: fade }, { opacity: 0 }], t, "linear", { fill: "forwards" });
        play(el, [{ transform: `translateY(${from}px)` }, { transform: "translateY(100%)" }], t, EASE.accelerate, { fill: "forwards" });
        closeAll();
      } else {
        /* a cancelled gesture is never a close: spring back, scrim back to full */
        el.style.transform = "";
        if (scrim) { scrim.style.opacity = ""; if (from > 0) play(scrim, [{ opacity: fade }, { opacity: 1 }], 250, "linear"); }
        if (from > 0) play(el, [{ transform: `translateY(${from}px)` }, { transform: "none" }], 250, EASE.decelerate);
      }
    };
    g.addEventListener("pointerup", () => end(false));
    g.addEventListener("pointercancel", () => end(true));
    g.addEventListener("lostpointercapture", () => { if (y0 != null) end(true); });
  });
}

/* ---------- the stack ---------- */
/* A form is never redrawn by a background sync: the input would be replaced
   and the phone's keyboard would close mid-word (final review I2). Its
   values live in its draft anyway. */
const FORMS = ["edit", "new", "ins-clean"]; // the event form, and the clean-up cards with their free-text box
export const refreshable = (l) => !!l && !isForm(l) && !FORMS.includes(l.kind);

/* Called after the page redraws (new data): refresh the open level in place. */
export function refreshSheet() {
  const top = topLevel();
  if (shown && top && refreshable(top) && shown.lv === top) paint(shown, top, "");
}

/* Swap the level on top for another (a new event, once saved, becomes its
   page; a day step goes to the next or previous day). Defaults to no
   animation: an in-place redraw must never suddenly slide. */
export function replaceTop(l, anim = "") {
  if (!stack.length) return openLevel(l);
  stack[stack.length - 1] = l;
  sync(anim, null, true);
}

/* opts.from is the card's rectangle: the sheet grows out of it (container
   transform) when this is the first level. */
export function openLevel(l, opts = {}) {
  const deeper = stack.length > 0;
  /* never over the menu drawer or a page: while one is up the shell is inert
     and nothing of ours is open */
  const drawer = document.getElementById("drawer");
  if (!deeper && drawer && !drawer.hidden) return;
  if (!deeper && !coverPages().some((p) => !p.hidden) && document.querySelector(".shell").inert) return;
  if (layers.length) return;
  if (!deeper) opener = document.activeElement;
  stack.push(l);
  try { history.pushState({ compassLevel: stack.length }, ""); } catch { /* sandboxed host */ }
  sync(deeper && !isForm(l) ? "deeper" : "", opts.from || null);
}

function popTop() {
  if (layers.length) { finishLayer(layers[layers.length - 1]); return; }
  if (!stack.length) return;
  /* a level can refuse to leave (a form with unsaved changes): the entry the
     browser just spent is put back and the level says why */
  const top = stack[stack.length - 1], def = custom[top.kind];
  if (def && def.guard && def.guard(top)) {
    closing.delete(top);
    try { history.pushState({ compassLevel: stack.length }, ""); } catch { /* sandboxed host */ }
    if (def.onGuard) def.onGuard(top);
    return;
  }
  const gone = stack.pop();
  closing.delete(gone);
  sync(isForm(gone) ? "" : "shallower");
}

/* One step back, once: a second request for the same close is ignored until
   the first has landed (a double tap, Escape then a tap). */
export function back() {
  const top = layers[layers.length - 1] || stack[stack.length - 1];
  if (!top) return false;
  if (closing.has(top)) return true;
  closing.add(top);
  try { history.back(); } catch { popTop(); return true; }
  /* a history that never answers must not leave the layer stuck */
  setTimeout(() => {
    const still = layers[layers.length - 1] || stack[stack.length - 1];
    if (still === top && closing.has(top)) popTop();
  }, 700);
  return true;
}

/* closeAll steps history back n entries at once; the browser answers with
   popstate events that must not each close another level. They are ignored
   one by one, never more than were caused (final review M3). */
export function createPopGate() {
  let pending = 0;
  return { expect(n) { pending += n; }, take() { if (pending > 0) { pending--; return true; } return false; }, pending() { return pending; }, reset() { pending = 0; } };
}
const pops = createPopGate();
/* The sheet's own history entries are about to be popped (or just were): the
   shell's handlers (pages, search) must leave this popstate alone. */
export const sheetOwnsPop = () => stack.length > 0 || layers.length > 0 || pops.pending() > 0;

export function closeAll() {
  const n = layers.length + stack.length;
  if (!n) return;
  const inFlight = [...layers, ...stack].filter((x) => closing.has(x)).length;
  const lay = layers; layers = [];
  lay.forEach((l) => { l.closing = true; teardownLayer(l); if (l.onClose) l.onClose(); });
  stack = [];
  sync("");
  const steps = n - inFlight;
  if (steps > 0) {
    /* history.go(-n) fires a single popstate for the whole jump */
    pops.expect(1);
    try { history.go(-steps); } catch { pops.reset(); }
  }
}

/* ---------- menus, dialogs and pickers ---------- */
/* openLayer({ kind: "dialog" | "menu", html, label, anchor, cls, onMount, onClose })
   html is built by the caller with every synced string escaped. Returns the
   layer; closeLayer(layer, after) closes it through history and then runs
   after (so a second layer can be opened without racing the first). */
export function openLayer({ kind = "dialog", html, label = "", anchor = null, cls = "", onMount = null, onClose = null }) {
  const host = document.createElement("div");
  host.className = "layer-host layer-" + kind;
  const scrim = document.createElement("div");
  scrim.className = "m3-scrim" + (kind === "menu" ? " m3-scrim--clear" : "");
  const el = document.createElement("div");
  el.className = (kind === "menu" ? "m3-menu" : "m3-dialog") + (cls ? " " + cls : "");
  el.setAttribute("role", kind === "menu" ? "menu" : "dialog");
  if (kind !== "menu") el.setAttribute("aria-modal", "true");
  if (label) el.setAttribute("aria-label", label);
  el.tabIndex = -1;
  el.innerHTML = html;
  host.append(scrim, el);
  layerRoot.append(host);
  const layer = { host, el, kind, onClose, closing: false, after: null, opener: document.activeElement };
  scrim.addEventListener("click", () => closeLayer(layer));
  layers.push(layer);
  try { history.pushState({ compassLayer: layers.length }, ""); } catch { /* sandboxed host */ }
  syncInert();
  if (kind === "menu" && anchor) {
    const r = anchor.getBoundingClientRect();
    el.style.top = `${Math.round(r.bottom + 4)}px`;
    el.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    el.style.transformOrigin = "top right";
  }
  enterLayer(el, kind);
  if (onMount) onMount(el, layer);
  const first = el.querySelector("[autofocus], input:not([type=hidden]), button:not([disabled])");
  (first || el).focus({ preventScroll: true });
  return layer;
}

export function closeLayer(layer, after) {
  if (!layer || layer.closing) return;
  layer.closing = true;
  layer.after = after || null;
  if (layers[layers.length - 1] === layer) back();
}

function teardownLayer(layer) {
  layer.host.inert = true;
  const done = () => layer.host.remove();
  exitLayer(layer.el, layer.kind).then(done);
}

function finishLayer(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  layer.closing = true;
  closing.delete(layer);
  teardownLayer(layer);
  syncInert();
  const o = layer.opener;
  if (o && o.isConnected && o.offsetParent !== null) { try { o.focus({ preventScroll: true }); } catch { /* gone */ } }
  if (layer.onClose) layer.onClose();
  if (layer.after) layer.after();
}

/* A snackbar over everything, one at a time (the kit closes the last). */
export function snack(text, action, onAction) {
  return showSnackbar(document.getElementById("snackHost") || document.body, { text, action, onAction });
}

/* ---------- wiring ---------- */
export function initSheet() {
  root = document.getElementById("sheetRoot");
  layerRoot = document.createElement("div");
  layerRoot.id = "layerRoot";
  document.body.append(layerRoot);
  window.addEventListener("popstate", () => {
    if (pops.take()) return;
    popTop();
  });
  /* the window crossed a size class: a sheet is a bottom or side sheet, a
     form a page or a dialog, so draw them again in the other shape */
  let size = document.documentElement.dataset.size;
  window.addEventListener("resize", () => {
    const now = document.documentElement.dataset.size;
    if (now === size) return;
    size = now;
    const s = shown, f = formShown;
    if (s) { s.host.remove(); shown = null; }
    if (f) { f.host.remove(); formShown = null; }
    const top = topLevel();
    const sheetLv = sheetLevels().pop();
    if (sheetLv) mountSheet(sheetLv, null);
    if (isForm(top)) mountForm(top);
    syncInert();
  });

  root.addEventListener("click", (e) => {
    const fromForm = !!e.target.closest(".form-host");
    const view = fromForm ? formShown : shown;
    const l = view && view.lv;
    if (e.target.closest("a")) return;
    const s = e.target.closest("[data-sact]");
    if (s && !s.disabled) {
      const a = s.dataset.sact;
      if (a === "scrim" || a === "close") {
        /* a tap outside a form with unsaved changes does not close it */
        const g = l && custom[l.kind];
        if (a === "scrim" && fromForm) { if (!(g && g.guard && g.guard(l))) back(); }
        else closeAll();
      }
      else if (a === "back") back();
      else if (a === "newday") { if (dayAdd && l) dayAdd(l.d); }
      else if (a === "prev" || a === "next") stepDay(a);
      else if (a === "event") openLevel({ kind: "event", id: s.dataset.id });
      return;
    }
    /* a registered level's own buttons go to its handler */
    const btn = e.target.closest("button");
    if (btn && !btn.disabled && l && custom[l.kind] && custom[l.kind].onAction) {
      const depth = layers.length;
      custom[l.kind].onAction(btn);
      /* a layer opened, or another level: it has drawn itself already (M2) */
      /* a level that has just been closed (Save) is not drawn again, it would flash empty */
      if (layers.length === depth && view && view.lv === l && (shown === view || formShown === view) && !closing.has(l)) paint(view, l, "");
    }
  });
  const onField = (e) => {
    const view = e.target.closest(".form-host") ? formShown : shown;
    const l = view && view.lv;
    if (l && custom[l.kind] && custom[l.kind].onInput) custom[l.kind].onInput(e.target, e);
  };
  root.addEventListener("input", onField);
  root.addEventListener("change", onField);
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-sact][role=button]")) { e.preventDefault(); e.target.click(); }
  });

  /* The single day level: swipe anywhere in the body sideways to step to
     the previous or next day, one at a time -- replaceTop, not openLevel,
     so repeated swipes never pile up history entries. Previous is a swipe
     right (dx > 0), next a swipe left, matching the calendar's own. */
  let d0 = null;
  const dayStart = (x, y) => {
    const l = topLevel();
    d0 = l && l.kind === "day" && !layers.length ? { x, y, d: l.d, archive: l.archive } : null;
  };
  const dayEnd = (x, y) => {
    if (!d0) return;
    const act = gesture({ dx: x - d0.x, dy: y - d0.y, top: false, searching: false });
    d0 = null;
    if (act === "next" || act === "prev") { swallowSheetClick(); stepDay(act); }
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

/* The previous or next day, along the shared axis. Stops at either end of
   the calendar's range: no empty day beyond it. */
function stepDay(dir) {
  const l = topLevel();
  if (!l || l.kind !== "day" || layers.length) return;
  const f = frameNow(), r = f && f.range;
  const d = addDays(l.d, dir === "next" ? 1 : -1);
  if (r && (d < r.min || d > r.max)) return;
  replaceTop({ kind: "day", d, archive: l.archive }, dir);
}

/* A swipe ends in a click on whatever was under the finger (a day row, an
   event card): eat that one click, the same trick calendar.js uses for its
   own view swipe. */
function swallowSheetClick() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 400);
}
