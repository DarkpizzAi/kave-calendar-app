/* Compass: the one sheet (spec section 3, "The sheet").

   Levels, top to bottom: weeks, days, a single day, a single event. Tapping
   inside replaces the content and the title; there is never a second sheet.
   Each level is a history entry, so phone Back, browser Back, Escape and
   Backspace go up one level; tapping or swiping the header closes it.

   Depth moves vertically: going deeper, the old content slides up and out
   while the new level rises from the bottom; Back reverses. (Switching views
   stays sideways: views sit side by side, levels stack.) */
"use strict";

import { escapeHtml as esc, safeUrl } from "./util.js";
import { addDays, dayOfWeek } from "./dates.js";
import { isoWeek } from "./views.js";
import { holidayOn } from "./holidays.js";
import { tappable, iconsOf, shortDate } from "./cal-model.js";
import { rows, frameNow, detailGrey, place } from "./calendar.js";
import { ICON } from "./chrome-icons.js";

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

/* Other screens add their own levels (Settings: Calendar defaults,
   Categories; the event page and form): { title(level), body(level),
   onAction(button), bar(level) for buttons in the bar, onInput(field) }. */
const custom = {};
export function registerLevel(kind, def) { custom[kind] = def; }

export const sheetOpen = () => stack.length > 0;
export const topLevel = () => stack[stack.length - 1] || null;

function findEvent(id) { const f = frameNow(); return f && f.events.find((e) => e.id === id); }

function title(l) {
  if (custom[l.kind]) return custom[l.kind].title(l);
  if (l.kind === "week") return `Week ${isoWeek(l.m)}`;
  if (l.kind === "day") return longDay(l.d);
  const e = findEvent(l.id); return e ? e.title : "";
}

const who = (o) => (o === "isa" ? "Isa" : o === "hugo" ? "Hugo" : "Both of you");
const checklist = (e) => (e.checklist || []).map((c) =>
  `<p class="todo-l${c.done ? " done" : ""}"><span class="box" aria-hidden="true"></span>${esc(c.text)}</p>`).join("");
const tickets = (e) => (e.links || []).map((l) => {
  const u = safeUrl(l.url);
  return u ? `<a class="ticket" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🎟 ${esc(l.label)}</a>` : "";
}).join("");

/* Week level: a roomy row per day; an empty day is blank and cannot be tapped. */
function weekBody(m, f) {
  return [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const d = addDays(m, k), evs = f.on(d);
    const tap = tappable(evs) ? ` role="button" tabindex="0" data-sact="day" data-d="${d}"` : "";
    return `<div class="lrow${d === f.today ? " today" : ""}${evs.length ? "" : " empty"}"${tap}>`
      + `<span class="lday">${LONGDOW[k]} ${Number(d.slice(8))}</span>${rows(evs, false, false)}</div>`;
  }).join("");
}

/* Day level: no cards, a strip per event; a time and names say what they
   are, so no "When / Who / Where" labels. Layout A (title left, icons right,
   a chevron column) until Task 9c settles it. */
function strip(e, f) {
  const lines = [[place(e), e.end && e.end !== e.start ? "until " + shortDate(e.end, f.thisYear) : ""].filter(Boolean).join(" · "),
    e.guests || (e.owner !== f.me && e.owner !== "shared" ? who(e.owner) : "")].filter(Boolean);
  return `<section class="dsec layA${detailGrey(e) ? " greyw" : ""}" data-sact="event" data-id="${esc(e.id)}" role="button" tabindex="0">`
    + `<div class="dmain"><div class="dhead"><h3>${esc(e.title)}</h3><span class="dicons">${iconsOf(e, f.me).map(esc).join("")}</span></div>`
    + lines.map((l) => `<p class="dline">${esc(l)}</p>`).join("") + checklist(e) + tickets(e)
    + `</div><span class="dchev">${ICON.chev}</span></section>`;
}
function dayBody(d, f) {
  const evs = f.on(d), hol = holidayOn(d);
  return `<div class="dpage">${hol ? `<p class="dhol">Bank holiday: ${esc(hol)}</p>` : ""}${evs.map((e) => strip(e, f)).join("")}</div>`;
}

/* Event level: a page, like a Spoon recipe. Its full design, with editing,
   is round 2 (Task 10). */
function eventBody(e, f) {
  const sec = (h, body) => (body ? `<section class="esec"><h3>${h}</h3>${body}</section>` : "");
  const when = e.end && e.end !== e.start ? `${longDay(e.start)} to ${longDay(e.end)}` : longDay(e.start);
  return `<div class="epage"><div class="ehero${detailGrey(e) ? " greyw" : ""}"><span class="eicons">${iconsOf(e, f.me).map(esc).join("")}</span>`
    + `<p class="esub">${esc(when)}${e.start.slice(0, 4) !== f.thisYear ? " " + e.start.slice(0, 4) : ""}</p></div>`
    + sec("Where", place(e) ? `<p>${esc(place(e))}</p>` : "")
    + sec("Who", `<p>${esc(who(e.owner))}${e.guests ? ", with " + esc(e.guests) : ""}</p>`)
    + sec("To do", checklist(e)) + sec("Tickets", tickets(e))
    + sec("Notes", e.notes ? `<p>${esc(e.notes)}</p>` : "")
    + '<p class="hint">The full event page, with editing and costs, arrives in round 2.</p></div>';
}

function body(l) {
  if (custom[l.kind]) return custom[l.kind].body(l);
  const f = frameNow();
  if (!f) return "";
  if (l.kind === "week") return weekBody(l.m, f);
  if (l.kind === "day") return dayBody(l.d, f);
  const e = findEvent(l.id);
  return e ? eventBody(e, f) : '<p class="hint">This event is no longer here.</p>';
}

/* ---- drawing ---- */
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
      + '<header class="sbar" data-sact="close" data-swipe="sheet"><span class="grab" aria-hidden="true"></span><h2 class="stitle" id="stitle"></h2><div class="bar-acts"></div></header>'
      + '<div class="sstage"></div></section>';
    sh = root.querySelector(".sheet");
    anim = "";
  }
  sh.className = `sheet lv-${l.kind}${anim === "" && sh.classList.contains("in") ? " in" : ""}`;
  sh.querySelector(".stitle").textContent = title(l);
  const def = custom[l.kind];
  sh.querySelector(".bar-acts").innerHTML = def && def.bar ? def.bar(l) : "";
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
  /* both layers stay until the animation ends, so the old one visibly leaves */
  old.classList.add("leaving", anim === "deeper" ? "out-up" : "out-down");
  fresh.classList.add(anim === "deeper" ? "in-up" : "in-down");
  stage.append(fresh);
  afterAnim(fresh, () => { old.remove(); fresh.classList.remove("in-up", "in-down"); });
}

/* Called after the page redraws (new data): refresh the open level in place. */
export function refreshSheet() { if (stack.length) draw(""); }

/* Swap the level on top for another (a new event, once saved, becomes its page). */
export function replaceTop(l) {
  if (!stack.length) return openLevel(l);
  stack[stack.length - 1] = l;
  draw("");
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

export function closeAll() {
  const n = stack.length;
  if (!n) return;
  stack = [];
  draw("");
  ignorePops += n;
  try { history.go(-n); } catch { ignorePops = 0; }
}
let ignorePops = 0;

export function initSheet() {
  root = document.getElementById("sheetRoot");
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops = 0; return; }
    if (stack.length) up();
  });
  root.addEventListener("click", (e) => {
    const barBtn = e.target.closest(".bar-acts button");
    const b = barBtn ? null : e.target.closest("[data-sact]");
    if (!b) {
      /* a registered level's own buttons go to its handler */
      const l = stack[stack.length - 1], btn = e.target.closest("button");
      if (btn && l && custom[l.kind] && custom[l.kind].onAction) { custom[l.kind].onAction(btn); draw(""); }
      return;
    }
    const a = b.dataset.sact;
    if (a === "close") closeAll();
    else if (a === "day") openLevel({ kind: "day", d: b.dataset.d });
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
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 400);
      closeAll();
    }
    y0 = null;
  });
}
