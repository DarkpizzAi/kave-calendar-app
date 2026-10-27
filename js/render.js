/* Compass: rendering and the shell's moving parts.

   Full re-render on every interaction. Nothing here is incrementally
   updated. That is a size-dependent choice, not a principle: it is fine while
   the app is this small, and the thing to know before adding features is that
   every renderX() rebuilds its subtree and re-binds its own listeners.

   Transient UI state (which tab is open, the drawer, the pages) is
   module-level and calls render() directly. Persisted state goes through
   store.setSetting -> notify.

   The shell is Material 3: a navigation bar (compact) or rail (medium,
   expanded), a centred top bar that scrolls away, a menu drawer holding
   Settings and Roadmap, and full pages with a back arrow. Every layer takes
   one history entry so the phone's Back closes it; the drawer hands its entry
   to the page it opens. */
"use strict";

import { enterLayer, exitLayer, fadeThrough, sharedAxisIn, sharedAxisOut } from "../m3/kave-m3.js";
import { store } from "./store.js";
import { escapeHtml, copyText, markJump } from "./util.js";
import { PALETTES, SEED_HEX, toSeed, applyPalette, themeBootRan } from "./theme.js";
import { status as syncStatus, checkToken } from "./sync.js";
import { ms, ICON } from "./chrome-icons.js";
import { calendarHtml, afterCalendar, backToToday, todaysCount, archiveHtml, archiveOpened, archivePickYear } from "./calendar.js";
import { refreshSheet, sheetOwnsPop, openLevel } from "./sheet.js";
import { openSearch, onSearchPop, searchIsOpen, refreshSearch } from "./search.js";
import { syncBarOn } from "./sync.js";
import { readPrefs, defaultsSummary, VIEW_NAMES, DETAIL_NAMES } from "./prefs.js";
import { CATEGORIES, iconFor } from "./icons.js";
import { DAY_PRIORITY } from "./cal-model.js";
import { resetCalendarDefaults } from "./calendar.js";
import { checkForUpdate, ensureVersionAsked, updateStatusLines, updateBusy, updateButtonText, updateReady, restartForUpdate } from "./updates.js";
import { gateStep, gateHtml, bindGate } from "./gate.js";
import { insightsHtml, bindInsights, newVisit } from "./view-insights.js";
import { roadmapHtml } from "./view-roadmap.js";

const $ = (id) => document.getElementById(id);

/* Sync of the events themselves, shown in Settings only (spec: the Calendar
   never shows sync state). Set by boot.js. */
export const dataSync = { state: "idle", message: "", at: 0 };
/* Set by boot.js: what "Sync now" runs, and what the New event button opens. */
export const actions = { sync: null, add: null };

/* The two tabs. Calendar is home and back from anywhere returns to it.
   Trips and Radar left the navigation and live in the Roadmap until they are
   built; Settings is a page in the menu drawer, not a tab. */
export const VIEWS = {
  calendar: "Calendar",
  insights: "Insights",
};
const VIEW_ICON = { calendar: "calendar_month", insights: "insights" };

let current = "calendar";

export function currentView() { return current; }

/* A copy of the tab on screen, laid over it while the new tab fades in
   (fade through: the old one out, the new one in). Ids are stripped so the
   copy never answers a getElementById. */
function ghostOf(main) {
  const g = main.cloneNode(true);
  g.removeAttribute("id");
  g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  g.classList.add("view-leaving");
  g.style.cssText = `top:${main.offsetTop}px;height:${main.offsetHeight}px;padding:${getComputedStyle(main).padding}`;
  g.setAttribute("aria-hidden", "true");
  g.inert = true;
  main.after(g);
  return g;
}

export function setView(name) {
  if (!VIEWS[name]) return;
  if (name === current && name === "calendar") { backToToday(); return; }
  const main = $("view");
  const ghost = name !== current ? ghostOf(main) : null;
  current = name;
  if (name === "insights") newVisit(); // a different "Did you know" each visit
  /* Every tab switch lands at the top, filters visible. firstDraw is true
     only for the app's first render, so afterCalendar keeps this 0 rather
     than jumping to #today, which sits below the controls. */
  markJump(300);
  main.scrollTop = 0;
  showTopBar();
  render();
  if (ghost) {
    main.style.opacity = "0";
    fadeThrough(ghost, main).then(() => { main.style.opacity = ""; ghost.remove(); });
  }
}

/* The search magnifier on every tab opens js/search.js's page. */
export { openSearch };

/* The indeterminate bar under the header: only while Sync now runs (a pull has
   its own spinner, a background sync shows nothing). Toggled in place, never
   by a render, so a sync does not redraw the Calendar. */
export function paintSyncBar() {
  const b = $("syncBar");
  if (b) b.hidden = !syncBarOn();
}

export function showTopBar() { const b = $("topBar"); if (b) b.classList.remove("is-hidden"); }
export function hideTopBar() { const b = $("topBar"); if (b) b.classList.add("is-hidden"); }

/* ---------- settings ---------- */
const esc = escapeHtml;
const choices = (attr, opts, cur) => `<div class="m3-chips" role="radiogroup">${opts.map(([v, l]) =>
  `<button type="button" role="radio" aria-checked="${cur === v}" class="m3-chip${cur === v ? " is-selected" : ""}" data-${attr}="${esc(v)}">${cur === v ? ms("check") : ""}${esc(l)}</button>`).join("")}</div>`;
const navRow = (page, label, summary) =>
  `<button type="button" class="m3-list-item m3-list-item--tap set-row-btn" data-page-open="${page}">`
  + `<div class="m3-list-item__text"><div class="m3-title-m">${esc(label)}</div><div class="m3-body-m m3-variant">${esc(summary)}</div></div>`
  + `<span class="m3-list-item__trail">${ms("chevron_right")}</span></button>`;
const group = (title, rows) => `<section class="set-group"><h2 class="m3-list-header m3-title-s">${esc(title)}</h2><div class="m3-grouped">${rows}</div></section>`;
const staticRow = (inner) => `<div class="m3-list-item set-col">${inner}</div>`;
const hint = (t) => `<p class="m3-body-s m3-variant">${esc(t)}</p>`;

/* The public address, the same wherever this copy runs (a PC, localhost) */
const APP_URL = "https://darkpizzai.github.io/kave-calendar-app/";

function settingsHtml() {
  const s = store.state.settings;
  const prefs = readPrefs(s);
  const cur = toSeed(s.palette);
  const swatches = Object.entries(PALETTES).map(([id, n]) => {
    const on = cur === id;
    return `<button type="button" class="m3-swatch${on ? " is-selected" : ""}" aria-pressed="${on}" aria-label="${esc(n)}" title="${esc(n)}" data-palette="${esc(id)}" style="background:${esc(SEED_HEX[id] || "")}">`
      + `${on ? `<span class="m3-swatch__check">${ms("check")}</span>` : ""}</button>`;
  }).join("");

  const dot = dataSync.state === "ok" ? "ok" : dataSync.state === "failed" ? "error" : dataSync.state === "working" ? "working" : "";
  const syncLine = dataSync.state === "idle" ? "Not synced yet this session." : dataSync.message;
  const when = dataSync.at ? `${dataSync.state === "ok" ? "Last synced" : "Last tried"} at ${new Date(dataSync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "";
  const tok = syncStatus.state === "idle" ? "" : `<p class="m3-body-s set-error">${esc(syncStatus.message)}</p>`;
  const diag = themeBootRan() ? "" : '<p class="m3-body-s set-error">Theme preload BLOCKED: recompute the CSP hash (see README)</p>';
  /* the version line and the update check: one mechanism (js/updates.js) */
  ensureVersionAsked(render);
  const updLines = updateStatusLines().map(([k, t]) => `<p class="set-line ${k}"><i></i><span class="m3-body-m">${esc(t)}</span></p>`).join("");

  return `<div class="page-col">
    ${group("Appearance", staticRow(`<div class="m3-title-m">Theme</div><div class="m3-swatch-row" role="group" aria-label="Theme">${swatches}</div>${hint("Light and dark follow the phone.")}`))}
    ${group("Calendar",
      navRow("defaults", "Calendar defaults", defaultsSummary(prefs))
      + navRow("emorder", "Grid emoji order", orderSummary(prefs.gridOrder))
      + navRow("archive", "Archive", "Look back before this year"))}
    ${group("Sync", staticRow(`<p class="set-line ${dot}"><i></i><span class="m3-body-m">${esc(syncLine)}</span></p>${when ? hint(when) : ""}`
      + `<div class="set-actions"><button type="button" id="syncNow" class="m3-btn m3-btn--tonal"${s.token ? "" : " disabled"}>${ms("sync")}Sync now</button></div>`))}
    ${group("Who am I", staticRow(`<div class="m3-chips" role="group" aria-label="Who am I">${[["isa", "Isa"], ["hugo", "Hugo"]].map(([v, l]) =>
      `<button type="button" class="m3-chip${s.me === v ? " is-selected" : ""}" aria-pressed="${s.me === v}" data-me="${v}">${s.me === v ? ms("check") : ""}${l}</button>`).join("")}</div>`
      + hint("Stamps every edit you make. Nothing is saved until it is set.")))}
    ${group("This device",
      staticRow(`<label class="m3-field"><span class="m3-field__label">App link</span><input class="m3-field__input" id="appLink" type="text" value="${esc(APP_URL)}" readonly></label>`
        + `<div class="set-actions"><button type="button" id="copyAppLink" class="m3-btn m3-btn--tonal">${ms("content_copy")}Copy</button></div>`
        + hint("Open Compass on another device: copy this and send it to your phone."))
      + staticRow(`<label class="m3-field"><span class="m3-field__label">GitHub token</span><input class="m3-field__input" id="tokenInput" type="password" placeholder="${s.token ? "Token saved" : "github_pat_..."}"`
        + ` autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></label>${tok}`
        + `<div class="set-actions"><button type="button" id="clearToken" class="m3-btn m3-btn--text"${s.token ? "" : " disabled"}>Clear token</button></div>`
        + hint("Stored on this device only, sent only to GitHub. Fine-grained, Contents: read and write on kave-hub."))
      + staticRow(`<div class="m3-title-m">About</div>${updLines}`
        + `<div class="set-actions"><button type="button" id="updateBtn" class="m3-btn m3-btn--tonal"${updateBusy() ? " disabled" : ""}>${esc(updateButtonText())}</button></div>${diag}`
        + hint("The household planner. Data in kave-hub; the mini PC runs the sweeps.")))}
  </div>`;
}

/* ---------- Calendar defaults and Grid emoji order (pages of Settings) ---------- */
const PREF_KEYS = ["defaultView", "defaultDetail"];
function defaultsHtml() {
  const p = readPrefs(store.state.settings);
  return `<div class="page-col">`
    + group("Default view", staticRow(choices("pref-view", VIEW_NAMES, p.defaultView) + hint("Whether the strip opens as one week or as the whole month.")))
    + group("Default detail level", staticRow(choices("pref-detail", DETAIL_NAMES, p.defaultDetail) + hint("Full: both of you, the other person greyed. Minimal: yours and shared only.")))
    + `</div>`;
}

/* Grid emoji order (spec 7.4): the first five emoji of the viewer's order. */
const orderEmoji = (type) => iconFor({ type }, { owner: store.state.settings.me || "isa" }, store.state.settings.me || "isa");
const orderSummary = (order) => order.slice(0, 5).map(orderEmoji).join(" ") + " …";
const sameOrder = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
const saveOrder = (order) => store.setSetting("gridOrder", sameOrder(order, DAY_PRIORITY) ? null : order);
/* "Other" is the fixed last row: no handle, no buttons. */
function orderRow(t, i, last) {
  const label = esc(CATEGORIES.find((c) => c.type === t).label);
  const fixed = t === "none";
  return `<li class="m3-list-item og-row${fixed ? " fixed" : ""}" data-type="${esc(t)}"><span class="og-n m3-num">${i + 1}</span><span class="og-e m3-emoji">${esc(orderEmoji(t))}</span><span class="og-l m3-body-l">${label}</span>`
    + (fixed ? "" : `<button type="button" class="m3-icon-btn og-mv" data-og-up="${esc(t)}" aria-label="Move ${label} up"${i === 0 ? " disabled" : ""}>${ms("keyboard_arrow_up")}</button>`
      + `<button type="button" class="m3-icon-btn og-mv down" data-og-down="${esc(t)}" aria-label="Move ${label} down"${i === last - 1 ? " disabled" : ""}>${ms("keyboard_arrow_down")}</button>`
      + `<span class="og-handle" data-og-drag aria-hidden="true">${ms("drag_handle")}</span>`) + `</li>`;
}
function emorderHtml() {
  const order = readPrefs(store.state.settings).gridOrder;
  return `<div class="page-col"><p class="m3-body-m m3-variant page-intro">When a day has several events, Grid shows the emoji highest in this list. Your own events (and shared ones) always come before the other person's. Drag the handle, or use the arrows.</p>`
    + `<ul class="og-list m3-grouped" id="ogList">${order.map((t, i) => orderRow(t, i, order.length - 1)).join("")}</ul>`
    + `<div class="set-actions"><button type="button" class="m3-btn m3-btn--outlined" data-og-reset>Reset to default order</button></div>`
    + hint("Always, whatever the order: a visitor's arrival day shows first; a hotel shows only on check-in day; Other is last.")
    + `</div>`;
}
/* Dragging a row by its handle (pointer events, so mouse and touch alike).
   The rows move in the DOM while the finger is down; the order is saved
   once, on release (a save redraws the page, which would drop the drag). */
let ogDrag = null;
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest && e.target.closest("[data-og-drag]");
  if (!h) return;
  const row = h.closest(".og-row");
  ogDrag = { row, list: row.parentElement, id: e.pointerId, h };
  row.classList.add("drag");
  try { h.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  if (!ogDrag || e.pointerId !== ogDrag.id) return;
  for (const r of ogDrag.list.querySelectorAll(".og-row:not(.fixed)")) {
    if (r === ogDrag.row) continue;
    const box = r.getBoundingClientRect();
    if (e.clientY < box.top || e.clientY > box.bottom) continue;
    const before = r.compareDocumentPosition(ogDrag.row) & Node.DOCUMENT_POSITION_FOLLOWING; /* dragged row is after r */
    ogDrag.list.insertBefore(ogDrag.row, before ? r : r.nextSibling);
    break;
  }
});
function endOrderDrag(e) {
  if (!ogDrag || e.pointerId !== ogDrag.id) return;
  const { list } = ogDrag;
  ogDrag.row.classList.remove("drag");
  ogDrag = null;
  if (e.type === "pointercancel") { refreshPage(true); return; }
  saveOrder([...list.querySelectorAll(".og-row")].map((r) => r.dataset.type));
}
document.addEventListener("pointerup", endOrderDrag);
document.addEventListener("pointercancel", endOrderDrag);

/* ---------- navigation: bar (compact) and rail (medium, expanded) ---------- */
/* F3: a today's-event-count badge on the Calendar icon, hidden entirely at
   zero rather than showing "0". */
function navItems(kind) {
  const count = todaysCount();
  const cls = kind === "rail" ? "m3-rail" : "m3-nav-item";
  return Object.entries(VIEWS).map(([id, label]) => {
    const on = current === id;
    const badge = id === "calendar" && count ? `<span class="m3-badge">${count > 99 ? "99+" : count}</span>` : "";
    return `<button type="button" class="${cls === "m3-rail" ? "m3-rail__item" : "m3-nav-item"}${on ? " is-active" : ""}" data-view="${esc(id)}"${on ? ' aria-current="page"' : ""}>`
      + `<span class="${cls}__pill">${ms(VIEW_ICON[id], on ? "m3-icon--fill" : "")}${badge}</span>`
      + `<span class="m3-label-m">${esc(label)}</span></button>`;
  }).join("");
}

let firstDraw = true;
export const isCalendar = () => current === "calendar" && !gateStep();

export function render() {
  const main = $("view");
  /* The gate first: no token (or no "who am I") and nothing else draws. */
  const step = gateStep();
  const wasGated = document.body.classList.contains("gated");
  document.body.classList.toggle("gated", !!step);
  /* the header was hidden while gated, so --header-h measured 0: wire.js
     measures it again on resize */
  if (wasGated !== !!step) window.dispatchEvent(new Event("resize"));
  if (step) {
    resetLayers();
    main.classList.remove("is-cal");
    main.innerHTML = gateHtml(step);
    $("nav").innerHTML = "";
    $("railItems").innerHTML = "";
    bindGate(main, { onToken: () => { if (actions.sync) actions.sync(); } });
    const dlg = main.querySelector(".m3-dialog");
    if (dlg && !wasGated) enterLayer(dlg, "dialog");
    return;
  }
  const before = { top: main.scrollTop, height: main.scrollHeight, first: firstDraw };
  $("tabName").textContent = VIEWS[current];
  markJump(300); // rewriting the list moves its scroll: the reader did not
  main.innerHTML = current === "calendar" ? calendarHtml() : insightsHtml();
  main.classList.toggle("is-cal", current === "calendar");
  $("nav").innerHTML = navItems("bar");
  $("railItems").innerHTML = navItems("rail");
  if (current === "calendar") { afterCalendar(main, before); firstDraw = false; }
  refreshSheet();
  refreshPage();
  refreshSearch();
  paintSyncBar();
  bindView();
  if (current === "insights") bindInsights(main);
}

/* Re-bound on every render, because every render replaces these nodes. */
function bindView() {
  document.querySelectorAll("#nav button, #railItems button, #view [data-view]").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
}

/* ---------- layers: the menu drawer and the pages ----------
   Each layer takes one history entry, so the phone's Back closes it. Every
   close goes through one function that sends history.back() once and ignores
   a second request until the pop lands (closeRequested). */
let opener = null; // the control that opened the drawer or a page: closing hands focus back
/* While a layer is open, everything behind it is inert: focus and the screen
   reader stay inside. The drawer and the page sit outside .shell on purpose. */
function syncInert() {
  const shell = document.querySelector(".shell");
  if (shell) shell.inert = drawerOpen || pages.length > 0 || searchIsOpen();
}
function restoreFocus() {
  syncInert(); // focus can only return to a control that is no longer inert
  const o = opener; opener = null;
  if (o && o.isConnected && o.offsetParent !== null) o.focus({ preventScroll: true });
}

let drawerOpen = false;
let drawerHist = false;
let drawerCloseRequested = false;
let drawerToken = 0;

export function openDrawer() {
  if (drawerOpen || gateStep()) return;
  drawerOpen = true;
  drawerCloseRequested = false;
  drawerToken++;
  const d = $("drawer"), scrim = $("drawerScrim");
  opener = document.activeElement;
  scrim.hidden = false; d.hidden = false;
  syncInert();
  enterLayer(d, "drawer");
  try { history.pushState({ compassDrawer: true }, ""); drawerHist = true; } catch { drawerHist = false; }
  const first = d.querySelector(".m3-drawer__item");
  if (first) first.focus({ preventScroll: true });
}
function hideDrawer(keepOpener = false) {
  if (!drawerOpen) return;
  drawerOpen = false;
  drawerCloseRequested = false;
  const d = $("drawer"), scrim = $("drawerScrim");
  const token = ++drawerToken;
  syncInert();
  exitLayer(d, "drawer").then(() => {
    if (token !== drawerToken) return; // reopened meanwhile
    d.hidden = true; scrim.hidden = true;
  });
  if (!keepOpener) restoreFocus();
}
/* the tap, the scrim, Escape and the phone's Back are one path */
export function closeDrawer() {
  if (!drawerOpen || drawerCloseRequested) return;
  if (drawerHist) {
    drawerHist = false; drawerCloseRequested = true;
    try { history.back(); } catch { hideDrawer(); }
    setTimeout(() => { if (drawerOpen && drawerCloseRequested) hideDrawer(); }, 600);
  } else hideDrawer();
}
export const drawerIsOpen = () => drawerOpen;

const PAGE_TITLES = { settings: "Settings", roadmap: "Roadmap", archive: "Archive", defaults: "Calendar defaults", emorder: "Grid emoji order" };
const PAGE_HTML = { settings: settingsHtml, roadmap: roadmapHtml, archive: archiveHtml, defaults: defaultsHtml, emorder: emorderHtml };
let pages = []; // [{ name, hist }] bottom to top; the top one is on screen
let pageCloseRequested = false;
let hostToken = 0;

const topPage = () => pages[pages.length - 1] || null;
export const pageIsOpen = () => pages.length > 0;
export const currentPage = () => (topPage() ? topPage().name : null);

function drawPage(name, keepScroll) {
  const body = $("pageBody");
  const top = body.scrollTop;
  $("pageTitle").textContent = PAGE_TITLES[name];
  body.innerHTML = PAGE_HTML[name]();
  body.scrollTop = keepScroll ? top : 0;
}
/* A change of data redraws the open page in place, unless the reader is in the
   middle of typing (a token being pasted must not vanish under a sync). */
function refreshPage(force = false) {
  const t = topPage();
  if (!t || t.name === "roadmap") return;
  const a = document.activeElement;
  if (!force && a && a.matches && a.matches("#pageBody input") && !a.readOnly && a.value) return;
  const focusSel = a && a.closest && a.closest("#pageBody") && a.id ? "#" + a.id : "";
  drawPage(t.name, true);
  if (focusSel) { const again = document.querySelector(focusSel); if (again && !again.disabled) again.focus({ preventScroll: true }); }
}

export function openPage(name) {
  if (!PAGE_TITLES[name] || gateStep()) return;
  const top = topPage();
  if (top && top.name === name) return;
  const first = !top;
  // opened from the drawer: the drawer's history entry becomes the page's, so
  // the phone's back is one press from the tab either way
  let hist;
  if (drawerOpen) {
    hist = drawerHist; drawerHist = false;
    hideDrawer(true); // focus returns to the opener when the page closes
  } else {
    if (first) opener = document.activeElement;
    try { history.pushState({ compassPage: name }, ""); hist = true; } catch { hist = false; }
  }
  pages.push({ name, hist });
  syncInert();
  pageCloseRequested = false;
  const host = $("page");
  drawPage(name, false);
  if (first) { hostToken++; host.hidden = false; sharedAxisIn(host, 1); }
  else sharedAxisIn($("pageBody"), 1);
  $("pageBack").focus({ preventScroll: true });
  if (name === "archive") archiveOpened();
}
function popPageNow() {
  const gone = pages.pop();
  pageCloseRequested = false;
  if (!gone) return;
  syncInert();
  const host = $("page");
  if (!pages.length) {
    const token = ++hostToken;
    sharedAxisOut(host, -1).then(() => { if (token === hostToken) host.hidden = true; });
    restoreFocus();
    return;
  }
  drawPage(topPage().name, false);
  sharedAxisIn($("pageBody"), -1);
  const row = document.querySelector(`#pageBody [data-page-open="${gone.name}"]`);
  (row || $("pageBack")).focus({ preventScroll: true });
}
/* one level up: the back arrow, Escape and the phone's Back are one path */
export function closePage() {
  const t = topPage();
  if (!t || pageCloseRequested) return;
  if (t.hist) {
    t.hist = false; pageCloseRequested = true;
    try { history.back(); } catch { popPageNow(); return; }
    setTimeout(() => { if (pageCloseRequested && topPage() === t) popPageNow(); }, 600);
  } else popPageNow();
}
/* wire.js: the browser went back one entry */
export function onShellPop() {
  /* a sheet over a page or over search owns this pop: that layer stays */
  if (sheetOwnsPop()) return false;
  if (onSearchPop()) return true;
  const t = topPage();
  if (t) { t.hist = false; popPageNow(); return true; }
  if (drawerOpen) { drawerHist = false; hideDrawer(); return true; }
  return false;
}
/* the gate arrived (the token was cleared): no layer stays open over it */
function resetLayers() {
  if (drawerOpen) { drawerOpen = false; drawerHist = false; drawerCloseRequested = false; drawerToken++; $("drawer").hidden = true; $("drawerScrim").hidden = true; }
  if (pages.length) { pages = []; pageCloseRequested = false; hostToken++; $("page").hidden = true; }
  opener = null;
  syncInert();
}

/* ---------- page actions (one delegated listener, bound once in wire.js) ---------- */
const kebab = (k) => "data-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
export function onPageClick(e) {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.pageOpen) { openPage(d.pageOpen); return; }
  if (d.archYear) { archivePickYear(d.archYear); drawPage("archive", false); const c = document.querySelector(`#pageBody [data-arch-year="${CSS.escape(d.archYear)}"]`); if (c) c.focus({ preventScroll: true }); return; }
  if (d.archEv) {
    const r = b.getBoundingClientRect();
    openLevel({ kind: "event", id: d.archEv }, { from: { x: r.left, y: r.top, w: r.width, h: r.height } });
    return;
  }
  const key = Object.keys(d)[0];
  const again = () => { // the page redraws on a save: put the keyboard back on the same control
    if (!key) return;
    const n = document.querySelector(`#pageBody [${kebab(key)}="${CSS.escape(d[key])}"]`);
    if (n && !n.disabled) n.focus({ preventScroll: true });
  };
  if (d.me) { store.setSetting("me", d.me); again(); return; }
  if (d.palette) { applyPalette(d.palette); store.setSetting("palette", d.palette); again(); return; }
  const pick = d.prefView != null ? ["defaultView", d.prefView] : d.prefDetail != null ? ["defaultDetail", d.prefDetail] : null;
  if (pick && PREF_KEYS.includes(pick[0])) { resetCalendarDefaults(); store.setSetting(pick[0], pick[1]); again(); return; } /* reset first: the save redraws the Calendar */
  if (d.ogReset != null) { saveOrder(DAY_PRIORITY); return; }
  const up = d.ogUp, down = d.ogDown, t = up || down;
  if (t) {
    const order = [...readPrefs(store.state.settings).gridOrder];
    const i = order.indexOf(t), j = i + (up ? -1 : 1);
    if (i < 0 || j < 0 || j >= order.length - 1) return; /* Other stays last */
    [order[i], order[j]] = [order[j], order[i]];
    saveOrder(order);
    /* put the keyboard back on the moved row's button */
    setTimeout(() => {
      const n = document.querySelector(`[data-og-${up ? "up" : "down"}="${t}"]`);
      if (n && !n.disabled) n.focus();
    });
    return;
  }
  if (b.id === "syncNow") { if (actions.sync) actions.sync({ manual: true, bar: true }); return; }
  if (b.id === "clearToken") { store.setSetting("token", ""); return; }
  if (b.id === "copyAppLink") {
    const input = $("appLink");
    input.focus(); input.select();
    copyText(input.value).then((ok) => {
      if (!ok) return;
      const n = $("copyAppLink");
      if (!n) return;
      n.lastChild.textContent = "Copied";
      setTimeout(() => { const m = $("copyAppLink"); if (m) m.lastChild.textContent = "Copy"; }, 1500);
    });
    return;
  }
  if (b.id === "updateBtn") {
    if (updateReady()) { restartForUpdate(); return; }
    checkForUpdate(render);
  }
}
/* Spoon's token field saves on change: paste, then leave the field */
export function onPageChange(e) {
  const input = e.target;
  if (!input || input.id !== "tokenInput") return;
  const v = input.value.trim();
  /* the same value twice is one paste: a redraw can blur the field and
     fire change again while this render is still running */
  if (!v || v === store.state.settings.token) return;
  input.value = ""; // the token is never left showing in the field (the gate does the same)
  store.setSetting("token", v);
  checkToken().then(render);
  if (actions.sync) actions.sync();
}
