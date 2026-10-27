/* Compass: the whole-app search. The magnifier in the top bar (both tabs)
   opens a full-screen page, one history entry, that searches every event on
   the phone as you type. Results come in three groups, in this order: Events,
   Tickets, Categories.

     Events      searchEvents (cal-model.js): title, venue, city, guests, notes
     Tickets     a stored ticket's name; the tap opens the EVENT it belongs to,
                 never the file
     Categories  the Insights categories; the tap opens that category's history

   A tap opens its sheet over this page (the page stays, so Back returns to the
   results). Escape anywhere closes the page unless a sheet sits on top and
   takes it. Every synced string goes through escapeHtml. */
"use strict";

import { enterLayer, exitLayer } from "../m3/kave-m3.js";
import { escapeHtml as esc } from "./util.js";
import { searchEvents, iconsOf } from "./cal-model.js";
import { TILES, history as categoryHistory } from "./insights-data.js";
import { ticketsOf } from "./tickets.js";
import { todayKey } from "./dates.js";
import { store } from "./store.js";
import { ms } from "./chrome-icons.js";
import { openLevel, sheetOpen } from "./sheet.js";

const DEBOUNCE_MS = 120;
const EVENT_LIMIT = 40;
const TICKET_LIMIT = 20;

let ctx = null;          // { data }
let isOpen = false;
let hasHistory = false;
let closeRequested = false;   // history.back() sent, popstate not landed yet
let token = 0;
let opener = null;
let timer = 0;

const $ = (id) => document.getElementById(id);
export const searchIsOpen = () => isOpen;

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dayLabel = (d) => {
  const t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
  return t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/* ---------- matching (pure, tested) ---------- */

/* stored tickets whose name holds the query, with the event they belong to;
   latest event first */
export function ticketMatches(events, query) {
  const q = fold(query).trim();
  if (!q) return [];
  const out = [];
  for (const e of events) {
    if (e.deleted) continue;
    for (const t of ticketsOf(e)) if (fold(t.name || "Ticket").includes(q)) out.push({ event: e, ticket: t });
  }
  return out.sort((a, b) => (a.event.start < b.event.start ? 1 : -1));
}

/* Insights categories whose name holds the query, with how many events each
   has had (all years the phone has) */
export function categoryMatches(events, query, today = todayKey()) {
  const q = fold(query).trim();
  if (!q) return [];
  return TILES.filter((t) => fold(t.label).includes(q))
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label, count: categoryHistory(events, t.key, today).reduce((n, y) => n + y.count, 0) }))
    .filter((c) => c.count > 0);
}

/* ---------- rows ---------- */

function group(title, rows, extra = "") {
  return `<section class="srch-group"><div class="m3-list-header"><span class="m3-title-s">${esc(title)}</span></div>`
    + `<div class="m3-grouped">${rows.join("")}</div>${extra}</section>`;
}
const more = (shown, total) => (total > shown
  ? `<div class="m3-label-m m3-variant srch-more">Showing ${shown} of ${total}. Type more to narrow it down.</div>` : "");

function eventRow(e, me) {
  const when = e.end && e.end > e.start ? `${dayLabel(e.start)} to ${dayLabel(e.end)}` : dayLabel(e.start);
  const sub = [when, e.venue || "", e.status === "cancelled" ? "Cancelled" : e.status === "idea" ? "Idea" : ""].filter(Boolean).map(esc).join(" · ");
  return `<button type="button" class="m3-list-item m3-list-item--tap srch-row" data-srch="event" data-id="${esc(e.id)}">`
    + `<span class="srch-em m3-emoji" aria-hidden="true">${iconsOf(e, me).map(esc).join("")}</span>`
    + `<div class="m3-list-item__text"><div class="m3-body-l">${esc(e.title)}</div><div class="m3-body-m m3-variant">${sub}</div></div></button>`;
}
function ticketRow({ event: e, ticket: t }) {
  return `<button type="button" class="m3-list-item m3-list-item--tap srch-row" data-srch="event" data-id="${esc(e.id)}">`
    + `<span class="srch-em" aria-hidden="true">${ms("confirmation_number")}</span>`
    + `<div class="m3-list-item__text"><div class="m3-body-l">${esc(t.name || "Ticket")}</div>`
    + `<div class="m3-body-m m3-variant">${esc(e.title)} · ${esc(dayLabel(e.start))}</div></div></button>`;
}
function categoryRow(c) {
  return `<button type="button" class="m3-list-item m3-list-item--tap srch-row" data-srch="cat" data-key="${esc(c.key)}">`
    + `<span class="srch-em m3-emoji" aria-hidden="true">${esc(c.emoji)}</span>`
    + `<div class="m3-list-item__text"><div class="m3-body-l">${esc(c.label)}</div>`
    + `<div class="m3-body-m m3-variant">${c.count} event${c.count === 1 ? "" : "s"} · See its history</div></div></button>`;
}
function emptyState(icon, title, line) {
  return `<div class="m3-empty-state"><span class="m3-empty-state__icon">${ms(icon)}</span>`
    + `<span class="m3-title-m">${esc(title)}</span><span class="m3-body-m m3-variant">${esc(line)}</span></div>`;
}

/* The results for a query as markup; "" when the query is blank. */
export function resultsHtml(events, query, me) {
  const raw = String(query || "");
  if (!raw.trim()) return "";
  const evs = searchEvents(events, raw);
  const tks = ticketMatches(events, raw);
  const cats = categoryMatches(events, raw);
  if (!evs.length && !tks.length && !cats.length) {
    return emptyState("search_off", "No results", `Nothing matches "${raw.trim()}". Older years load as you search.`);
  }
  return (evs.length ? group("Events", evs.slice(0, EVENT_LIMIT).map((e) => eventRow(e, me)), more(Math.min(EVENT_LIMIT, evs.length), evs.length)) : "")
    + (tks.length ? group("Tickets", tks.slice(0, TICKET_LIMIT).map(ticketRow), more(Math.min(TICKET_LIMIT, tks.length), tks.length)) : "")
    + (cats.length ? group("Categories", cats.map(categoryRow)) : "");
}

/* ---------- the page ---------- */

export function drawSearch() {
  const input = $("searchInput"), host = $("searchResults");
  if (!input || !host) return;
  const raw = input.value;
  $("searchClear").hidden = !raw;
  const top = host.scrollTop;
  const html = resultsHtml(ctx.data.events(), raw, store.state.settings.me);
  host.innerHTML = html || emptyState("search", "Search Kave Compass", "Look through every event, ticket and category, whichever tab you came from.");
  host.scrollTop = top;
}

/* The shell behind the page stays out of reach while it is open; a sheet that
   opens over the page takes over the same job (sheet.js) and gives it back. */
function setShellInert(on) {
  const shell = document.querySelector(".shell");
  if (shell) shell.inert = on;
}

/* new data arrived (a sync, an edit made from a result): redraw in place */
export function refreshSearch() { if (isOpen) drawSearch(); }

export function openSearch() {
  if (isOpen || !ctx) return;
  /* the menu drawer and the pages have their own back arrow: search is for the tabs */
  const shell = document.querySelector(".shell");
  if (shell && shell.inert) return;
  isOpen = true;
  closeRequested = false;
  token++;
  /* a tap focuses the magnifier; a keyboard or script open may not: it is the way back either way */
  opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : $("searchBtn");
  const el = $("searchPage");
  $("searchInput").value = "";
  drawSearch();
  el.hidden = false;
  $("searchResults").scrollTop = 0;
  setShellInert(true);
  enterLayer(el, "page");
  try { history.pushState({ compassSearch: true }, ""); hasHistory = true; } catch { hasHistory = false; }
  $("searchInput").focus({ preventScroll: true });
  /* older years, in the background: the cached ones now, the rest if online */
  ctx.data.loadAllYears({ online: navigator.onLine !== false }).then(() => { if (isOpen) drawSearch(); }).catch(() => { /* the cache is what shows */ });
}

function hideSearch() {
  if (!isOpen) return;
  isOpen = false;
  closeRequested = false;
  clearTimeout(timer);
  const el = $("searchPage");
  const t = ++token;
  setShellInert(false);
  exitLayer(el, "page").then(() => { if (t === token) el.hidden = true; });
  const o = opener; opener = null;
  if (o && o.isConnected && o.offsetParent !== null) o.focus({ preventScroll: true });
}

/* the back arrow, Escape and the phone's Back are one path; a second request
   while the first is in flight is ignored */
export function closeSearch() {
  if (!isOpen || closeRequested) return;
  if (hasHistory) {
    hasHistory = false; closeRequested = true;
    try { history.back(); } catch { hideSearch(); return; }
    setTimeout(() => { if (isOpen && closeRequested) hideSearch(); }, 600);
  } else hideSearch();
}

/* render.js: the browser went back one entry */
export function onSearchPop() {
  if (!isOpen) return false;
  hasHistory = false;
  hideSearch();
  return true;
}

/* A result was tapped: its sheet opens over the page, which stays under it. */
function onResultClick(e) {
  const b = e.target.closest("[data-srch]");
  if (!b) return;
  if (b.dataset.srch === "event") {
    const r = b.getBoundingClientRect();
    openLevel({ kind: "event", id: b.dataset.id }, { from: { x: r.left, y: r.top, w: r.width, h: r.height } });
  } else if (b.dataset.srch === "cat") openLevel({ kind: "ins-hist", key: b.dataset.key });
}

export function initSearch(c) {
  ctx = c;
  const input = $("searchInput");
  input.addEventListener("input", () => {
    $("searchClear").hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(drawSearch, DEBOUNCE_MS);
  });
  /* Escape closes the page whatever has focus, unless a sheet sits on top and takes it */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen || sheetOpen()) return;
    e.preventDefault(); e.stopPropagation(); closeSearch();
  });
  $("searchBack").addEventListener("click", closeSearch);
  $("searchClear").addEventListener("click", () => { input.value = ""; clearTimeout(timer); drawSearch(); input.focus(); });
  $("searchResults").addEventListener("click", onResultClick);
}
