/* Kave Compass: the Insights tab, on Material 3 (spec section 7, mockup
   "Insights" option B with D's number shapes), and the sheets it opens: a
   category's history, the full ticket wall with Edit, and the clean-up cards.

   Top to bottom: the hero (the next transport or accommodation, whichever
   comes first), the year in numbers as emoji shapes, Did you know, the ticket
   wall (four tickets and See all tickets) and the clean-up card.

   Decisions live in insights-data.js and cleanup.js (both tested); this file
   draws them. Every synced string goes through escapeHtml and every url
   through safeUrl. The tab redraws whole, like every other view, and binds
   one listener on its own root each time. Nothing here draws a chart: the
   shapes are plain boxes coloured by the kit's data tokens (kaveKey), so
   there is nothing to resolve at draw time and a seed or scheme change
   restyles them by itself. */
"use strict";

import { escapeHtml as esc, safeUrl } from "./util.js";
import { todayKey, dayOfWeek } from "./dates.js";
import { store } from "./store.js";
import { github } from "../github.js";
import { registerLevel, openLevel, replaceTop, topLevel, sheetOpen } from "./sheet.js";
import { ms, offlineCardHtml } from "./chrome-icons.js";
import { ticketsOf, ticketButton } from "./tickets.js";
import { categoryGroup } from "./cal-model.js";
import { kaveKey } from "../m3/kave-m3.js";
import { TILES, yearCounts, history, comingUp, nextHero, ticketWall, wallTakenOff, wallTap, didYouKnow } from "./insights-data.js";
import { QUEUE_PATH, LOG_PATH, answerKey, mergeOutbox, cleanupCounts, pruneIfFresh, compactStamp, flushOutbox } from "./cleanup.js";

let ctx = null;            // { data, render, view, banner }
const me = () => store.state.settings.me;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmt = (d) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const inDays = (n) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const TILE = Object.fromEntries(TILES.map((t) => [t.key, t]));
/* a tile's colour is its catalogue group's data hue */
const hue = (key) => kaveKey(categoryGroup((TILE[key] || { types: [] }).types[0]));

/* The Google Drive mark: brand artwork, constant markup, never data. */
const DRIVE_SVG = '<svg class="drive" viewBox="0 0 87.3 78" role="img" aria-label="Drive"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';

/* ---------------- state ---------------- */

/* A different fact on each visit: the tab bumps this when it is opened. */
let seed = Math.floor(Date.now() / 86400000);
export function newVisit() { seed++; }

let wallFilter = "all", wallEdit = false;
const WALL_PILLS = [["all", "All"], ["concerts", "🎶 Concerts"], ["culture", "🎭 Culture"], ["club", "🪩 Club"], ["films", "🎬 Cinema"]];
const WALL_FIRST = 4;      // tickets on the tab; the rest are behind See all tickets

/* Clean-up: what was last read from GitHub, plus the outbox, kept in
   localStorage so an answer given offline survives a closed app. */
const LS_CLEANUP = "compass.cleanup";
const CU = { queue: null, log: null, outbox: [], sent: [], loaded: false };
const drafts = {};          // card -> { lines: {line: value}, text }
let skipped = [];           // cards skipped this session go to the back

function loadCleanup() {
  if (CU.loaded) return;
  CU.loaded = true;
  try {
    const c = JSON.parse(localStorage.getItem(LS_CLEANUP));
    if (c && typeof c === "object") {
      CU.queue = c.queue || null; CU.log = c.log || null;
      CU.outbox = Array.isArray(c.outbox) ? c.outbox : [];
      CU.sent = Array.isArray(c.sent) ? c.sent : [];
    }
  } catch { /* corrupt or blocked storage: start empty */ }
}
function saveCleanup() {
  try { localStorage.setItem(LS_CLEANUP, JSON.stringify({ queue: CU.queue, log: CU.log, outbox: CU.outbox, sent: CU.sent })); }
  catch { /* storage full or blocked: the cache is optional, the outbox is lost only on a closed app */ }
}

/* Redraw the tab, and the clean-up sheet too (it is not refreshed by the
   sheet's own background redraw, so a typed note is never cut off), unless a
   note is being typed right now. */
function redraw() {
  if (!ctx) return;
  if (ctx.view() === "insights") ctx.render();
  const l = topLevel();
  const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f === "cu-text";
  if (l && l.kind === "ins-clean" && !typing) replaceTop(l);
}

/* ---------------- older years, once per session ---------------- */

let olderState = 0, olderLocal = false;
async function loadOlder() {
  if (olderState) return;
  /* offline: the phone's own copies only, no request; the full pass waits for a connection */
  if (navigator.onLine === false) {
    if (!olderLocal) { olderLocal = true; ctx.data.loadAllYears({ online: false }).catch(() => { /* cache only */ }); }
    return;
  }
  olderState = 1;
  try {
    let y = Number(todayKey().slice(0, 4)) - 1;
    for (let i = 0; i < 12; i++, y--) {
      await ctx.data.ensureYear(String(y));
      if (!ctx.data.events().some((e) => typeof e.start === "string" && e.start.startsWith(String(y)))) break;
    }
  } catch { /* offline or no token: the years already cached still count */ }
  olderState = 2;
}

/* ---------------- the tab ---------------- */

const cardHead = (id, title, aside) =>
  `<div class="m3-card__head"><h2 class="m3-title-m" id="${id}">${esc(title)}</h2><span class="m3-spacer"></span>${aside || ""}</div>`;

/* The hero: the next flight or the next stay, whichever comes first. */
function heroHtml(cu) {
  const h = nextHero(cu);
  if (!h) {
    return '<section class="ins-hero ins-hero--empty" aria-label="Next transport or accommodation">'
      + `<span class="ins-hero__icon">${ms("event_upcoming")}</span>`
      + '<p class="m3-title-m ins-hero__t">Nothing booked soon</p>'
      + '<p class="m3-body-m ins-hero__m">The next flight or stay shows here once it is within a month.</p></section>';
  }
  const f = cu.flight, s = cu.stay;
  let emoji, label, title, meta;
  if (h.kind === "transport") {
    emoji = "✈️"; label = "Next transport"; title = f.title;
    meta = `${DOW[dayOfWeek(f.date)]} ${fmt(f.date)}${f.time ? `, ${f.time}` : ""}`;
  } else {
    emoji = "🏨"; label = "Next accommodation"; title = [s.title, s.city].filter(Boolean).join(", ");
    meta = `${fmt(s.start)} to ${fmt(s.end)}, ${s.nights} night${s.nights === 1 ? "" : "s"}`;
  }
  return `<section class="ins-hero" aria-label="${esc(label)}">`
    + `<div class="ins-hero__kicker"><span class="m3-emoji" aria-hidden="true">${emoji}</span><span class="m3-title-s">${esc(label)}</span>`
    + `<span class="m3-spacer"></span><span class="m3-label-l">${esc(inDays(h.days))}</span></div>`
    + `<h2 class="m3-headline-m ins-hero__t">${esc(title)}</h2><p class="m3-body-m ins-hero__m">${esc(meta)}</p>`
    + `<div class="ins-hero__acts"><button type="button" class="m3-btn ins-hero__open" data-ins="event" data-id="${esc(h.id)}">Open event</button></div></section>`;
}

/* Option D: each category as a shape of its own colour holding its emoji,
   with the count under it. The shape alternates round, rounded and scallop. */
function numbersHtml(counts, year) {
  const history = counts.length
    ? `<button type="button" class="m3-btn m3-btn--text" data-ins="cat" data-key="${esc(counts[0].key)}">History</button>` : "";
  const body = counts.length
    ? `<div class="ins-shapes">${counts.map((c, i) =>
      `<button type="button" class="ins-shape" data-ins="cat" data-key="${esc(c.key)}" aria-label="${esc(`${c.label}, ${c.count}. Open its history`)}">`
      + `<span class="ins-blob m3-emoji ${i % 2 ? "is-scallop" : i % 3 ? "is-soft" : "is-round"}" style="${hue(c.key)}" aria-hidden="true">${esc(c.emoji)}</span>`
      + `<span class="m3-headline-s m3-num">${c.count}</span><span class="m3-body-s m3-variant ins-shape__l">${esc(c.label.toLowerCase())}</span></button>`).join("")}</div>`
    : '<p class="m3-body-m m3-variant">Nothing counted yet this year.</p>';
  return `<section class="ins-card" aria-labelledby="insNumbers">${cardHead("insNumbers", `${year} in numbers`, history)}${body}</section>`;
}

function factHtml(fact) {
  if (!fact) return "";
  return '<section class="ins-fact" aria-labelledby="insFact">'
    + `<div class="ins-fact__head">${ms("lightbulb", "m3-icon--fill")}<h2 class="m3-title-s" id="insFact">Did you know</h2></div>`
    + `<p class="m3-body-l ins-fact__t">${esc(fact)}</p></section>`;
}

/* A ticket stub: the category emoji, the name, a perforation, the date. On the
   wall it is a link to the Drive file (wallTap), in a new tab. */
function stubInner(w) {
  return `<span class="m3-emoji tk-emo" aria-hidden="true">${esc((TILE[w.cat] || {}).emoji || "")}</span>`
    + `<span class="m3-title-s tk-title">${esc(w.title)}</span><span class="tk-perf" aria-hidden="true"></span>`
    + `<span class="m3-label-m tk-date">${esc(fmt(w.date))}</span>`;
}
export function stubLink(w) {
  const u = wallTap(w);
  const cls = "ticket";
  return u
    ? `<a class="${cls}" style="${hue(w.cat)}" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Open the ticket for ${w.title} in Google Drive`)}">${stubInner(w)}</a>`
    : `<div class="${cls}" style="${hue(w.cat)}">${stubInner(w)}</div>`;
}

function wallHtml(wall, hasOff) {
  const count = wall.length ? `<span class="m3-label-m m3-variant">${wall.length} ticket${wall.length === 1 ? "" : "s"}</span>` : "";
  const body = wall.length
    ? `<div class="ins-wall">${wall.slice(0, WALL_FIRST).map(stubLink).join("")}</div>`
    : `<p class="m3-body-m m3-variant">${hasOff ? "Every ticket is taken off your wall. See all tickets to put some back."
      : "Tickets kept for past concerts, shows, club nights and films appear here."}</p>`;
  const more = wall.length || hasOff
    ? `<button type="button" class="m3-btn m3-btn--tonal ins-wide" data-ins="wall-all">${ms("confirmation_number")}See all tickets</button>` : "";
  return `<section class="ins-card" aria-labelledby="insWall">${cardHead("insWall", "Ticket wall", count)}${body}${more}</section>`;
}

function cleanupHtml() {
  const c = cleanupCounts({ queue: CU.queue, outbox: CU.outbox, sent: CU.sent, log: CU.log }, todayKey());
  const row = (icon, n, what) => `<div class="m3-list-item ins-row"><span class="m3-list-item__lead m3-list-item__lead--square">${ms(icon)}</span>`
    + `<div class="m3-list-item__text m3-list-item__text--wrap"><div class="m3-body-l">${n} ${esc(what)}</div></div></div>`;
  return '<section class="ins-card" aria-labelledby="insClean">'
    + cardHead("insClean", "Calendar data clean-up", '<span class="m3-label-m m3-variant">Last 30 days</span>')
    + `<div class="m3-list">${row("help", c.toAnswer, "to answer")}${row("autorenew", c.applying, "applying")}${row("check_circle", c.done, "done")}</div>`
    + `<button type="button" class="m3-btn m3-btn--tonal ins-wide" data-ins="cleanup">${ms("auto_fix_high")}Clean up</button></section>`;
}

export function insightsHtml() {
  loadCleanup();
  loadOlder();
  const events = ctx.data.events(), today = todayKey(), who = me(), year = Number(today.slice(0, 4));
  const cu = comingUp(events, today);
  const fact = didYouKnow(events, year, seed);
  return '<div class="ins">' + offlineCardHtml() + heroHtml(cu)
    + '<div class="ins-panes">'
    + `<div class="ins-col ins-col--a">${numbersHtml(yearCounts(events, year), year)}${factHtml(fact)}</div>`
    + `<div class="ins-col ins-col--b">${wallHtml(ticketWall(events, today, who), wallTakenOff(events, today, who).length > 0)}</div>`
    + `<div class="ins-col ins-col--c">${cleanupHtml()}</div>`
    + "</div></div>";
}

/* What opened a sheet, so focus can come back to it even though the tab is
   drawn again on every sync (the sheet's own restore needs the very same node). */
let openedBy = null;
function refocus() {
  const o = openedBy; openedBy = null;
  if (!o || sheetOpen()) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const root = document.querySelector("#view .ins");
  const sel = `[data-ins="${o.a}"]${o.key ? `[data-key="${CSS.escape(o.key)}"]` : ""}${o.id ? `[data-id="${CSS.escape(o.id)}"]` : ""}`;
  const el = root && root.querySelector(sel);
  if (el) { try { el.focus({ preventScroll: true }); } catch { /* gone */ } }
}
window.addEventListener("popstate", () => { if (openedBy) setTimeout(refocus, 60); });

export function bindInsights(main) {
  const root = main.querySelector(".ins");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ins]");
    if (!b) return;
    const a = b.dataset.ins;
    openedBy = { a, key: b.dataset.key || "", id: b.dataset.id || "" };
    if (a === "cat") openLevel({ kind: "ins-hist", key: b.dataset.key });
    else if (a === "event") openLevel({ kind: "event", id: b.dataset.id });
    else if (a === "wall-all") { wallFilter = "all"; wallEdit = false; openLevel({ kind: "ins-wall" }); }
    else if (a === "cleanup") openLevel({ kind: "ins-clean" });
  });
}

/* ---------------- sheet: a category's history (spec 7.1) ---------------- */

function histBody(l) {
  const years = history(ctx.data.events(), l.key, todayKey());
  if (!years.length) return '<div class="m3-empty-state"><p class="m3-title-m">Nothing here yet</p><p class="m3-body-m m3-variant">Events of this kind appear here as they happen.</p></div>';
  const evs = new Map(ctx.data.events().map((e) => [e.id, e]));
  const rows = years.map((y) => `<div class="m3-list-header m3-title-s">${esc(y.year)} · ${y.count}</div><div class="m3-list">` + y.rows.map((r) => {
    const u = r.ticket ? safeUrl(r.ticket.url) : "";
    /* a future ticket opens the copy on the phone; a past one (or one the
       phone has no copy of) opens the Drive link */
    const ev = evs.get(r.id), mine = r.ticket && r.ticket.when === "future" && ev ? ticketsOf(ev) : [];
    const tk = mine.length ? ticketButton(ev, mine[0], "m3-icon-btn", ms("confirmation_number"), "Open the ticket")
      : u ? `<a class="m3-icon-btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Open the ticket in Drive">${r.ticket.when === "future" ? ms("confirmation_number") : DRIVE_SVG}</a>` : "";
    return `<div class="m3-list-item"><button type="button" class="row-main" data-sact="event" data-id="${esc(r.id)}">`
      + `<div class="m3-list-item__text m3-list-item__text--wrap"><div class="m3-body-l">${esc(r.title)}</div>`
      + `<div class="m3-body-m m3-variant">${esc([fmt(r.date), r.place].filter(Boolean).join(" · "))}</div></div></button>`
      + (tk ? `<span class="m3-list-item__trail">${tk}</span>` : "") + "</div>";
  }).join("") + "</div>").join("");
  return `<p class="m3-body-m m3-variant ins-hint">Newest first. Tap a line to open the event. ${ms("confirmation_number")} is on this phone, ${DRIVE_SVG} is in Drive.</p>${rows}`;
}

/* ---------------- sheet: the ticket wall, See all and Edit (spec 7.3) ---------------- */

function setHidden(id, hide) {
  const who = me();
  const prev = ctx.data.events().find((e) => e.id === id);
  if (!prev || !who) return;
  const set = new Set(Array.isArray(prev.wallHiddenBy) ? prev.wallHiddenBy : []);
  if (hide) set.add(who); else set.delete(who);
  /* the same path the event page saves by, so the per-event merge sees it */
  try { ctx.data.save(prev, { ...prev, wallHiddenBy: [...set] }); }
  catch (err) { ctx.banner(String(err.message || err)); }
}

/* In Edit a ticket is not a link: it carries its own button, a cross to take
   it off the wall, or (greyed) a plus to put it back. */
function editStub(w, off) {
  const btn = off
    ? `<button type="button" class="tk-x is-add" data-ia="on" data-id="${esc(w.id)}" aria-label="${esc(`Put ${w.title} back on the wall`)}">${ms("add")}</button>`
    : `<button type="button" class="tk-x" data-ia="off" data-id="${esc(w.id)}" aria-label="${esc(`Take ${w.title} off the wall`)}">${ms("close")}</button>`;
  return `<div class="ticket${off ? " is-off" : ""}" style="${hue(w.cat)}">${btn}${stubInner(w)}</div>`;
}

function wallBody() {
  const who = me(), today = todayKey(), events = ctx.data.events();
  const keep = (w) => wallFilter === "all" || w.cat === wallFilter;
  const live = ticketWall(events, today, who).filter(keep).map((w) => ({ w, off: false }));
  const off = wallEdit ? wallTakenOff(events, today, who).filter(keep).map((w) => ({ w, off: true })) : [];
  const all = [...live, ...off].sort((a, b) => (a.w.date < b.w.date ? 1 : a.w.date > b.w.date ? -1 : 0));
  const chips = `<div class="m3-chips ins-filters" role="group" aria-label="Show">${WALL_PILLS.map(([v, t]) =>
    `<button type="button" class="m3-chip${wallFilter === v ? " is-selected" : ""}" data-ia="pill" data-v="${v}" aria-pressed="${wallFilter === v}">${esc(t)}</button>`).join("")}</div>`;
  const byYear = new Map();
  all.forEach((x) => { const y = x.w.date.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(x); });
  const groups = [...byYear.entries()].map(([y, list]) =>
    `<div class="m3-list-header m3-title-s">${esc(y)} · ${list.length}</div><div class="ins-wall">${list.map((x) => (wallEdit ? editStub(x.w, x.off) : stubLink(x.w))).join("")}</div>`).join("")
    || '<p class="m3-body-m m3-variant ins-hint">No tickets here.</p>';
  const key = `<div class="ins-key">${[["concerts", "concerts"], ["culture", "shows and culture"], ["club", "club nights"], ["films", "cinema"]].map(([k, t]) =>
    `<span class="m3-body-s"><span class="ins-sw" style="${hue(k)}"></span>${t}</span>`).join("")}</div>`;
  const hint = wallEdit ? "Take a ticket off your wall with the cross, put it back with the plus. Its file stays in Drive."
    : "Tap a ticket to open it in Google Drive.";
  return `<p class="m3-body-m m3-variant ins-hint">${hint}</p>${chips}${groups}${key}`;
}

/* ---------------- sheet: the clean-up cards (spec 5) ---------------- */

const optLabel = (line, v) => (v === "both" ? (line === "paid" ? "Half each" : "Both") : v === "isa" ? "Isa" : v === "hugo" ? "Hugo" : v);
const draftOf = (card) => drafts[card] || (drafts[card] = { lines: {}, text: "" });
const hasDraft = (card) => { const d = drafts[card]; return !!d && (Object.keys(d.lines).length > 0 || !!d.text.trim()); };

function cardHtml(c) {
  const given = new Map([...CU.outbox, ...CU.sent].filter((a) => a.action === "accepted").map((a) => [answerKey(a), a]));
  const d = draftOf(c.id);
  const lines = (c.lines || []).map((l) => {
    const a = given.get(`${c.id}-${l.key}`);
    if (a) return `<div class="cu-line"><p class="m3-body-l cu-q">${esc(l.question)}</p><p class="m3-body-m m3-variant cu-applying">${ms("autorenew")}Applying: ${esc(optLabel(l.key, a.value))}</p></div>`;
    return `<div class="cu-line"><p class="m3-body-l cu-q">${esc(l.question)}</p><div class="m3-chips">${(Array.isArray(l.options) ? l.options : []).map((v) => {
      const on = d.lines[l.key] === v;
      return `<button type="button" class="m3-chip${on ? " m3-chip--leading is-selected" : ""}" data-ia="pick" data-card="${esc(c.id)}" data-line="${esc(l.key)}" data-v="${esc(v)}" aria-pressed="${on}">`
        + `${on ? ms("check") : ""}${esc(optLabel(l.key, v))}</button>`;
    }).join("")}</div></div>`;
  }).join("");
  return `<section class="m3-card m3-card--filled cu-card" data-card="${esc(c.id)}"><h3 class="m3-title-m cu-name">${esc(c.summary || "Event")}</h3>${lines}`
    + `<label class="m3-field cu-field"><span class="m3-field__label">Tell Claude something else</span>`
    + `<input class="m3-field__input cu-text" data-f="cu-text" data-card="${esc(c.id)}" value="${esc(d.text)}" autocomplete="off"></label>`
    + `<div class="cu-foot"><button type="button" class="m3-btn m3-btn--text" data-ia="skip" data-card="${esc(c.id)}">Skip</button>`
    + `<button type="button" class="m3-btn m3-btn--filled" data-ia="done" data-card="${esc(c.id)}"${hasDraft(c.id) ? "" : " disabled"}>Done</button></div></section>`;
}

function cleanBody() {
  const all = CU.queue && Array.isArray(CU.queue.cards) ? CU.queue.cards : [];
  const cards = [...all.filter((c) => !skipped.includes(c.id)), ...all.filter((c) => skipped.includes(c.id))];
  const waiting = CU.outbox.length
    ? `<p class="m3-body-m m3-variant ins-hint">${CU.outbox.length} answer${CU.outbox.length === 1 ? "" : "s"} waiting to be sent. They go as soon as you are back online.</p>` : "";
  if (!cards.length) return waiting + '<div class="m3-empty-state"><span class="m3-empty-state__icon">' + ms("task_alt") + '</span><p class="m3-title-m">Nothing to clean up</p></div>';
  return waiting + cards.map(cardHtml).join("");
}

function submitCard(card) {
  const who = me();
  if (!who) { ctx.banner("Choose who you are in Settings first."); return; }
  const d = drafts[card];
  if (!d) return;
  const at = new Date().toISOString();
  let box = CU.outbox;
  Object.entries(d.lines).forEach(([line, value]) => { box = mergeOutbox(box, { card, line, action: "accepted", value, by: who, at }); });
  if (d.text.trim()) box = mergeOutbox(box, { card, line: "all", stamp: compactStamp(at), action: "freetext", text: d.text.trim(), by: who, at });
  CU.outbox = box;
  delete drafts[card];
  saveCleanup();
  flush();
}

function cleanAction(b) {
  const a = b.dataset.ia, card = b.dataset.card;
  if (a === "pick") {
    const d = draftOf(card);
    if (d.lines[b.dataset.line] === b.dataset.v) delete d.lines[b.dataset.line]; else d.lines[b.dataset.line] = b.dataset.v;
  } else if (a === "skip") skipped = [...skipped.filter((x) => x !== card), card];
  else if (a === "done") submitCard(card);
}

function wallAction(b) {
  const a = b.dataset.ia;
  if (a === "edit") wallEdit = !wallEdit;
  else if (a === "pill") wallFilter = b.dataset.v;
  else if (a === "off") setHidden(b.dataset.id, true);
  else if (a === "on") setHidden(b.dataset.id, false);
}

/* ---------------- clean-up: sending and reading ---------------- */

let flushing = false;
async function flush() {
  if (flushing || !CU.outbox.length || !store.state.settings.token) { redraw(); return; }
  flushing = true;
  try {
    const r = await flushOutbox(github, CU.outbox);
    /* the outbox may have grown while this ran: remove only what was sent */
    CU.outbox = CU.outbox.filter((a) => !r.sent.includes(a));
    const keys = new Set(r.sent.map(answerKey));
    CU.sent = [...CU.sent.filter((s) => !keys.has(answerKey(s))), ...r.sent];
    if (r.error === "unauthorized") ctx.banner("Answers could not be sent: the token was rejected.");
  } finally {
    flushing = false;
    saveCleanup();
    redraw();
  }
}

/* Called with every sync: read the queue and the log, forget what the sweep
   has applied, send what is waiting. Offline leaves the cache and the outbox
   as they are. */
let syncing = false;
export async function syncCleanup() {
  loadCleanup();
  if (syncing || !store.state.settings.token) return;
  syncing = true;
  try {
    let queueFresh = false;
    for (const [path, field, empty] of [[QUEUE_PATH, "queue", { cards: [] }], [LOG_PATH, "log", { answers: [] }]]) {
      try { CU[field] = (await github.getFile(path)).json; if (field === "queue") queueFresh = true; }
      catch (e) { if (e.gh === "notFound") { CU[field] = empty; if (field === "queue") queueFresh = true; } }
    }
    CU.sent = pruneIfFresh(CU.sent, CU.queue, queueFresh, Date.now());
    saveCleanup();
  } finally {
    syncing = false;
  }
  await flush();
}

/* ---------------- wiring ---------------- */

export function initInsights(c) {
  ctx = c;
  registerLevel("ins-hist", {
    title: (l) => {
      const t = TILE[l.key];
      const n = history(ctx.data.events(), l.key, todayKey()).reduce((s, y) => s + y.count, 0);
      return t ? `${t.emoji} ${t.label}, ${n} in all` : "History";
    },
    body: histBody,
    onAction: () => {},
  });
  registerLevel("ins-wall", {
    title: () => "Ticket wall",
    body: wallBody,
    bar: () => `<button type="button" class="m3-btn m3-btn--small ${wallEdit ? "m3-btn--filled" : "m3-btn--text"}" data-ia="edit">${wallEdit ? "Done" : "Edit"}</button>`,
    onAction: wallAction,
  });
  registerLevel("ins-clean", {
    title: () => "Clean up",
    body: cleanBody,
    onAction: cleanAction,
    onInput: (t) => {
      if (!t.dataset || t.dataset.f !== "cu-text") return;
      draftOf(t.dataset.card).text = t.value;
      const card = [...document.querySelectorAll("#sheetRoot .cu-card")].find((n) => n.dataset.card === t.dataset.card);
      const done = card && card.querySelector('[data-ia="done"]');
      if (done) done.disabled = !hasDraft(t.dataset.card);
    },
  });
}
