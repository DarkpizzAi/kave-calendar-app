/* Compass: the Insights tab (spec section 7, mockups v3 / ticket wall v2 /
   numbers option E) and the sheets it opens: a category's history, the ticket
   wall with Edit, and the clean-up cards.

   Decisions live in insights-data.js and cleanup.js (both tested); this file
   draws them. Every synced string goes through escapeHtml and every url
   through safeUrl. The tab redraws whole, like every other view, and binds
   one listener on its own root each time. */
"use strict";

import { escapeHtml as esc, safeUrl } from "./util.js";
import { todayKey, dayOfWeek } from "./dates.js";
import { store } from "./store.js";
import { github } from "../github.js";
import { registerLevel, openLevel, replaceTop, topLevel } from "./sheet.js";
import { ICON } from "./chrome-icons.js";
import { TILES, yearCounts, history, comingUp, ticketWall, wallTakenOff, didYouKnow } from "./insights-data.js";
import { QUEUE_PATH, LOG_PATH, answerKey, mergeOutbox, cleanupCounts, pruneSent, flushOutbox } from "./cleanup.js";

let ctx = null;            // { data, render, view, banner }
const me = () => store.state.settings.me;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmt = (d) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const inDays = (n) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const TILE = Object.fromEntries(TILES.map((t) => [t.key, t]));

/* The Google Drive mark: brand artwork, constant markup, never data. */
const DRIVE_SVG = '<svg class="drive" viewBox="0 0 87.3 78" role="img" aria-label="Drive"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';

/* ---------------- state ---------------- */

/* A different fact on each visit: the tab bumps this when it is opened. */
let seed = Math.floor(Date.now() / 86400000);
export function newVisit() { seed++; }

let wallFilter = "all", wallEdit = false;
const WALL_PILLS = [["all", "All"], ["concerts", "🎶 Concerts"], ["culture", "🎭 Culture"], ["club", "🪩 Club"], ["films", "🎬 Cinema"]];

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

let olderState = 0;
async function loadOlder() {
  if (olderState) return;
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

const section = (title, sub, body) =>
  `<div class="tab-section"><div class="tab-section-head"><span class="tab-section-title">${esc(title)}</span>`
  + `${sub ? `<span class="tab-section-sub">${esc(sub)}</span>` : ""}</div>${body}</div>`;

function comingHtml(cu) {
  const out = [];
  if (cu.flight) {
    const f = cu.flight;
    const when = `${DOW[dayOfWeek(f.date)]} ${fmt(f.date)}${f.time ? `, ${f.time}` : ""}`;
    out.push(`<button class="ins-card ins-tap" data-ins="event" data-id="${esc(f.id)}">`
      + `<span class="ins-cardhead"><span>Next flight</span><span>${esc(inDays(f.days))}</span></span>`
      + `<span class="ins-pass"><b>✈️ ${esc(f.title)}</b><span class="ins-meta">${esc(when)}</span></span></button>`);
  }
  if (cu.stay) {
    const s = cu.stay;
    const name = [s.title, s.city].filter(Boolean).join(", ");
    out.push(`<button class="ins-card ins-tap" data-ins="event" data-id="${esc(s.id)}">`
      + `<span class="ins-cardhead"><span>Next stay</span><span>${esc(inDays(s.days))}</span></span>`
      + `<span class="ins-pass"><b>🏨 ${esc(name)}</b><span class="ins-meta">${esc(fmt(s.start))} to ${esc(fmt(s.end))}, ${s.nights} night${s.nights === 1 ? "" : "s"}</span></span></button>`);
  }
  return `<div class="ins-stack">${out.join("")}</div>`;
}

/* Option E: first in the middle, second left, third right, then the rest. */
function numbersHtml(counts) {
  if (!counts.length) return '<div class="ins-card"><p class="hint">Nothing counted yet this year.</p></div>';
  const slot = (c, cls) => (c
    ? `<button class="pod-b ${cls}" data-ins="cat" data-key="${esc(c.key)}"><i>${esc(c.emoji)}</i><b>${c.count}</b><span>${esc(c.label.toLowerCase())}</span></button>`
    : "<span></span>");
  const rest = counts.slice(3).map((c) =>
    `<button class="rest-i" data-ins="cat" data-key="${esc(c.key)}"><span>${esc(c.emoji)}</span><b>${c.count}</b><span class="rest-l">${esc(c.label.toLowerCase())}</span></button>`).join("");
  return `<div class="ins-card"><div class="pod">${slot(counts[1], "p2")}${slot(counts[0], "p1")}${slot(counts[2], "p3")}</div>`
    + (rest ? `<div class="rest">${rest}</div>` : "") + "</div>";
}

/* A stub: the category emoji, the name, the date. No ticket icon. */
function stubInner(w) {
  return `<span class="ic">${esc((TILE[w.cat] || {}).emoji || "")}</span><b>${esc(w.title)}</b><span>${esc(fmt(w.date))}</span>`;
}
function stubLink(w) {
  const u = safeUrl(w.url);
  const cls = `tstub c-${esc(w.cat)}`;
  return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${stubInner(w)}</a>` : `<div class="${cls}">${stubInner(w)}</div>`;
}

function wallHtml(wall) {
  if (!wall.length) return '<div class="ins-card"><p class="hint">Tickets kept for past concerts, shows, club nights and films appear here.</p></div>';
  return `<div class="ins-card"><div class="wall">${wall.slice(0, 6).map(stubLink).join("")}</div>`
    + '<button class="reveal-btn" data-ins="wall-all">See all</button></div>';
}

function cleanupHtml() {
  const c = cleanupCounts({ queue: CU.queue, outbox: CU.outbox, sent: CU.sent, log: CU.log }, todayKey());
  const kpi = (n, l) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="ins-card"><div class="kpis">${kpi(c.toAnswer, "to answer")}${kpi(c.applying, "applying")}${kpi(c.done, "done")}</div>`
    + '<button class="primary wide" data-ins="cleanup">Clean up</button></div>';
}

export function insightsHtml() {
  loadCleanup();
  loadOlder();
  const events = ctx.data.events(), today = todayKey(), who = me(), year = Number(today.slice(0, 4));
  const cu = comingUp(events, today);
  const fact = didYouKnow(events, year, seed);
  return `<div class="ins">`
    + (cu.flight || cu.stay ? section("Coming up", "", comingHtml(cu)) : "")
    + section(`${year} in numbers`, "", numbersHtml(yearCounts(events, year)))
    + section("Ticket wall", "", wallHtml(ticketWall(events, today, who)))
    + (fact ? section("Did you know", "", `<div class="ins-card"><p class="fun">${esc(fact)}</p></div>`) : "")
    + section("Calendar data clean-up", "Last 30 days", cleanupHtml())
    + "</div>";
}

export function bindInsights(main) {
  const root = main.querySelector(".ins");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ins]");
    if (!b) return;
    const a = b.dataset.ins;
    if (a === "cat") openLevel({ kind: "ins-hist", key: b.dataset.key });
    else if (a === "event") openLevel({ kind: "event", id: b.dataset.id });
    else if (a === "wall-all") { wallFilter = "all"; wallEdit = false; openLevel({ kind: "ins-wall" }); }
    else if (a === "cleanup") openLevel({ kind: "ins-clean" });
  });
}

/* ---------------- sheet: a category's history (spec 7.1) ---------------- */

function histBody(l) {
  const years = history(ctx.data.events(), l.key, todayKey());
  if (!years.length) return '<p class="hint pad">Nothing here yet.</p>';
  const rows = years.map((y) => `<div class="year">${y.year} · ${y.count}</div>` + y.rows.map((r) => {
    const u = r.ticket ? safeUrl(r.ticket.url) : "";
    /* a future ticket will open the copy on the phone (stage 4); until then
       both open the Drive link */
    const tk = u ? `<a class="hk" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Open the ticket">${r.ticket.when === "future" ? "🎟" : DRIVE_SVG}</a>` : "";
    return `<div class="c d" data-sact="event" data-id="${esc(r.id)}">${esc(fmt(r.date))}</div>`
      + `<div class="c t" data-sact="event" data-id="${esc(r.id)}" role="button" tabindex="0">${esc(r.title)}${r.place ? `<small>${esc(r.place)}</small>` : ""}</div>`
      + `<div class="c k">${tk}</div>`;
  }).join("")).join("");
  return `<p class="hint">Newest first. Tap a line to open the event.</p>`
    + `<div class="legend"><span>🎟 on this phone</span><span>${DRIVE_SVG} in Drive</span></div>`
    + `<div class="hist"><div class="c head">Date</div><div class="c head">Event</div><div class="c head k">Ticket</div>${rows}</div>`;
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

function wallBody() {
  const who = me(), today = todayKey(), events = ctx.data.events();
  const keep = (w) => wallFilter === "all" || w.cat === wallFilter;
  const live = ticketWall(events, today, who).filter(keep);
  const off = wallTakenOff(events, today, who).filter(keep);
  const pills = `<div class="pills">${WALL_PILLS.map(([v, t]) =>
    `<button class="pill${wallFilter === v ? " on" : ""}" data-ia="pill" data-v="${v}" aria-pressed="${wallFilter === v}">${esc(t)}</button>`).join("")}</div>`;
  const byYear = new Map();
  live.forEach((w) => { const y = w.date.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(w); });
  const editStub = (w) => `<div class="tstub c-${esc(w.cat)}">`
    + `<button class="tx" data-ia="off" data-id="${esc(w.id)}" aria-label="Take ${esc(w.title)} off the wall">${ICON.x}</button>${stubInner(w)}</div>`;
  const groups = [...byYear.entries()].map(([y, list]) =>
    `<div class="year">${y} · ${list.length}</div><div class="wall">${list.map(wallEdit ? editStub : stubLink).join("")}</div>`).join("")
    || '<p class="hint pad">No tickets here.</p>';
  const removed = wallEdit && off.length
    ? `<div class="removed"><div class="year">Taken off · ${off.length}</div><div class="wall">${off.map((w) =>
      `<div class="tstub c-${esc(w.cat)}"><button class="back" data-ia="on" data-id="${esc(w.id)}">Put back</button>${stubInner(w)}</div>`).join("")}</div></div>` : "";
  const key = `<div class="key">${[["concerts", "concerts"], ["culture", "shows and culture"], ["club", "club nights"], ["films", "cinema"]].map(([k, t]) =>
    `<span><span class="sw c-${k}"></span>${t}</span>`).join("")}</div>`;
  return `<p class="hint">${wallEdit ? "Tap ✕ to take a stub off your wall. Its ticket stays in Drive." : "Tap a stub to open its ticket in Drive."}</p>${pills}${groups}${removed}${key}`;
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
    if (a) return `<div class="cu-line done"><p class="cu-q">${esc(l.question)}</p><p class="cu-applying">Applying: ${esc(optLabel(l.key, a.value))}</p></div>`;
    return `<div class="cu-line"><p class="cu-q">${esc(l.question)}</p><div class="choices">${(l.options || []).map((v) =>
      `<button class="${d.lines[l.key] === v ? "on" : ""}" data-ia="pick" data-card="${esc(c.id)}" data-line="${esc(l.key)}" data-v="${esc(v)}" aria-pressed="${d.lines[l.key] === v}">${esc(optLabel(l.key, v))}</button>`).join("")}</div></div>`;
  }).join("");
  return `<section class="cu-card" data-card="${esc(c.id)}"><h3 class="cu-name">${esc(c.summary || "Event")}</h3>${lines}`
    + `<input type="text" class="cu-text" data-f="cu-text" data-card="${esc(c.id)}" value="${esc(d.text)}" placeholder="Tell Claude something else" aria-label="Tell Claude something else" autocomplete="off">`
    + `<div class="cu-foot"><button data-ia="skip" data-card="${esc(c.id)}">Skip</button>`
    + `<button class="primary" data-ia="done" data-card="${esc(c.id)}"${hasDraft(c.id) ? "" : " disabled"}>Done</button></div></section>`;
}

function cleanBody() {
  const all = (CU.queue && CU.queue.cards) || [];
  const cards = [...all.filter((c) => !skipped.includes(c.id)), ...all.filter((c) => skipped.includes(c.id))];
  const waiting = CU.outbox.length
    ? `<p class="hint">${CU.outbox.length} answer${CU.outbox.length === 1 ? "" : "s"} waiting to be sent. They go as soon as you are back online.</p>` : "";
  if (!cards.length) return waiting + '<p class="hint pad">Nothing to clean up.</p>';
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
  if (d.text.trim()) box = mergeOutbox(box, { card, line: "all", action: "freetext", text: d.text.trim(), by: who, at });
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
    for (const [path, field, empty] of [[QUEUE_PATH, "queue", { cards: [] }], [LOG_PATH, "log", { answers: [] }]]) {
      try { CU[field] = (await github.getFile(path)).json; }
      catch (e) { if (e.gh === "notFound") CU[field] = empty; }
    }
    CU.sent = pruneSent(CU.sent, CU.queue, Date.now());
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
    bar: () => `<button class="act-btn${wallEdit ? " primary" : ""}" data-ia="edit">${wallEdit ? "Done" : "Edit"}</button>`,
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
