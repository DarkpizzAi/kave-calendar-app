/* Compass: rendering.

   Full re-render on every interaction. Nothing here is incrementally
   updated. That is a size-dependent choice, not a principle: it is fine while
   the app is this small, and the thing to know before adding features is that
   every renderX() rebuilds its subtree and re-binds its own listeners.

   Transient UI state (which tab is open) is module-level and calls render()
   directly. Persisted state goes through store.setSetting -> notify. */
"use strict";

import { store } from "./store.js";
import { escapeHtml, copyText } from "./util.js";
import { PALETTES, applyPalette, themeBootRan, paletteAccents, paletteSofts } from "./theme.js";
import { status as syncStatus, checkToken } from "./sync.js";
import { ICON } from "./chrome-icons.js";
import { calendarHtml, afterCalendar, backToToday, todaysCount, refreshArchive } from "./calendar.js";
import { refreshSheet, openLevel, registerLevel } from "./sheet.js";
import { readPrefs, defaultsSummary, VIEW_NAMES, DETAIL_NAMES } from "./prefs.js";
import { CATEGORIES, iconFor } from "./icons.js";
import { DAY_PRIORITY } from "./cal-model.js";
import { resetCalendarDefaults, openArchive } from "./calendar.js";
import { checkForUpdate, ensureVersionAsked, updateStatusLines, updateBusy, updateButtonText, updateReady } from "./updates.js";
import { gateStep, gateHtml, bindGate } from "./gate.js";
import { insightsHtml, bindInsights, newVisit } from "./view-insights.js";

/* Sync of the events themselves, shown in Settings only (spec: the Calendar
   never shows sync state). Set by boot.js. */
export const dataSync = { state: "idle", message: "", at: 0 };
/* Set by boot.js: what "Sync now" runs. */
export const actions = { sync: null };

/* The five tabs (the Compass A spec in kave-hub). Calendar is home and
   back from anywhere returns to it; there is no separate home screen. Trips
   is for what is real, Radar for what is not. Settings last, as everywhere
   in this household. */
export const VIEWS = {
  calendar: "Calendar",
  insights: "Insights",
  trips: "Trips",
  radar: "Radar",
  settings: "Settings",
};


let current = "calendar";

export function currentView() { return current; }

export function setView(name) {
  if (!VIEWS[name]) return;
  if (name === current && name === "calendar") { backToToday(); return; }
  current = name;
  if (name === "insights") newVisit(); // a different "Did you know" each visit
  /* Every tab switch lands at the top, filters visible. firstDraw is true
     only for the app's first render, so afterCalendar keeps this 0 rather
     than jumping to #today, which sits below the controls. */
  document.getElementById("view").scrollTop = 0;
  render();
}

/* A view that is honestly not built yet. Dashed, never a tidy empty state:
   an empty state says "nothing here", and this has to say "not written yet",
   which is the same signal Spoon's Plan tab uses. */
function stub(title, line) {
  return `<div class="stub"><b>${escapeHtml(title)}</b>${escapeHtml(line)}</div>`;
}

const STUBS = {
  trips: ["The next departure, every trip, and the throwback.",
    "Phases, events, bookings and costs per trip. + creates a trip and can pull in existing events."],
  radar: ["What might happen, and what we are watching.",
    "Ideas, and prices being watched. Tap an idea to make it an event or a trip."],
};

function renderStub(id) {
  const [lede, line] = STUBS[id];
  return `
    <p class="lede">${escapeHtml(lede)}</p>
    ${stub("Not built yet", line)}
  `;
}

/* Settings, laid out like Spoon's (spec section 3, Settings): no cards, a
   bold label per field, controls on the page. Calendar defaults and
   Categories open the sheet; token and About sit in the Advanced fold. */
let advancedOpen = false;
const field = (label, control, hint) =>
  `<div class="field"><p class="flabel">${label}</p>${control}${hint ? `<p class="fhint">${hint}</p>` : ""}</div>`;
const choices = (attr, opts, current) => `<div class="choices" role="radiogroup">${opts.map(([v, l]) =>
  `<button role="radio" aria-checked="${current === v}" class="${current === v ? "on" : ""}" data-${attr}="${escapeHtml(v)}">${escapeHtml(l)}</button>`).join("")}</div>`;
const opener = (label, level, sum) =>
  field(label, `<button class="opener" data-level="${level}"><span>${escapeHtml(sum)}</span>${ICON.chev}</button>`);

function renderSettings() {
  const s = store.state.settings;
  const prefs = readPrefs(s);
  const me = s.me;
  /* the hex comes from tokens.css via paletteAccents(): a value this app
     read, still escaped before it reaches a style attribute */
  const accents = paletteAccents(), softs = paletteSofts();
  const current = PALETTES[s.palette] ? s.palette : "cobalt";
  const theme = `<div class="choices">${Object.entries(PALETTES).map(([id, n]) =>
    `<button class="${current === id ? "on" : ""}" aria-pressed="${current === id}" data-palette="${escapeHtml(id)}">`
    + `<span class="pal" style="background:conic-gradient(${escapeHtml(accents[id] || "")} 0 180deg, ${escapeHtml(softs[id] || "")} 180deg 360deg)"></span>${escapeHtml(n)}</button>`).join("")}</div>`;

  const dot = dataSync.state === "ok" ? "ok" : dataSync.state === "failed" ? "error" : "";
  const syncLine = dataSync.state === "idle" ? "Not synced yet this session." : dataSync.message;
  const when = dataSync.at ? `${dataSync.state === "ok" ? "Last synced" : "Last tried"} at ${new Date(dataSync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "";
  const tok = syncStatus.state === "idle" ? "" : `<p class="token-status">${escapeHtml(syncStatus.message)}</p>`;
  const diag = themeBootRan() ? "" : '<p class="token-status">Theme preload BLOCKED: recompute the CSP hash (see README)</p>';
  /* F19: ported from Spoon (js/view-settings.js's checkForUpdate/updateState)
     rather than invented fresh; the version line moves in here from the old
     ad hoc swVersion postMessage, so there is one mechanism, not two. */
  if (advancedOpen) ensureVersionAsked(render);
  const updLines = updateStatusLines().map(([k, t]) => `<span class="sync-line ${k}"><i></i>${escapeHtml(t)}</span>`).join("");

  return `<div class="fields">
    ${field("Theme", theme, "Light and dark follow the phone.")}
    ${opener("Calendar defaults", "set-defaults", defaultsSummary(prefs))}
    ${field("Archive", `<button id="openArchiveBtn">Open the archive</button>`, "Look back before this year, in Grid or Agenda.")}
    ${field("Sync", `<div class="sync-status"><p class="sync-line ${dot}"><i></i>${escapeHtml(syncLine)}</p>${when ? `<p class="sync-line muted">${escapeHtml(when)}</p>` : ""}</div>`
      + `<button id="syncNow"${s.token ? "" : " disabled"}>Sync now</button>`)}
    <div class="advanced-block">
      <button class="adv-toggle" id="advToggle" aria-expanded="${advancedOpen}" aria-controls="advFields"><span class="caret">${advancedOpen ? "&#9662;" : "&#9656;"}</span> Advanced settings</button>
      <div class="fields" id="advFields"${advancedOpen ? "" : " hidden"}>
        ${field('<label for="appLink">App link</label>', `<div class="token-row"><input id="appLink" type="text" value="${escapeHtml(APP_URL)}" readonly><button id="copyAppLink">Copy</button></div>`,
          "Open Compass on another device: copy this and send it to your phone.")}
        ${field("Who am I", choices("me", [["isa", "Isa"], ["hugo", "Hugo"]], me), "Stamps every edit you make. Nothing is saved until it is set.")}
        ${field('<label for="tokenInput">GitHub token</label>', `<div class="token-row"><input id="tokenInput" type="password" placeholder="${s.token ? "Token saved" : "github_pat_..."}"`
          + ` autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><button id="clearToken"${s.token ? "" : " disabled"}>Clear</button></div>${tok}`,
          "Stored on this device only, sent only to GitHub. Fine-grained, Contents: read and write on kave-hub.")}
        ${field("About", `<div class="sync-status">${updLines}</div>`
          + `<button id="updateBtn"${updateBusy() ? " disabled" : ""}>${escapeHtml(updateButtonText())}</button>${diag}`,
          "The household planner. Data in kave-hub; the mini PC runs the sweeps.")}
      </div>
    </div>
  </div>`;
}

/* The public address, the same wherever this copy runs (a PC, localhost) */
const APP_URL = "https://darkpizzai.github.io/kave-calendar-app/";

/* The two Settings sheets, as levels of the one sheet. */
const PREF_KEYS = ["defaultView", "defaultDetail"];
registerLevel("set-defaults", {
  title: () => "Calendar defaults",
  body() {
    const p = readPrefs(store.state.settings);
    return `<div class="fields">${field("Default view", choices("pref-view", VIEW_NAMES, p.defaultView), "Where the Calendar opens.")}`
      + field("Default detail level", choices("pref-detail", DETAIL_NAMES, p.defaultDetail), "Full: both of you, the other person greyed. Minimal: yours and shared only.")
      + opener("Grid emoji order", "set-order", orderSummary(p.gridOrder))
      + "</div>";
  },
  onAction(b) {
    const d = b.dataset;
    if (d.level) { openLevel({ kind: d.level }); return; }
    const pick = d.prefView != null ? ["defaultView", d.prefView] : d.prefDetail != null ? ["defaultDetail", d.prefDetail] : null;
    if (!pick || !PREF_KEYS.includes(pick[0])) return;
    store.setSetting(pick[0], pick[1]);
    resetCalendarDefaults();
  },
});
/* Grid emoji order (spec 7.4): the first five emoji of the viewer's order. */
const orderEmoji = (type) => iconFor({ type }, { owner: store.state.settings.me || "isa" }, store.state.settings.me || "isa");
const orderSummary = (order) => order.slice(0, 5).map(orderEmoji).join(" ") + " …";
const sameOrder = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
const saveOrder = (order) => store.setSetting("gridOrder", sameOrder(order, DAY_PRIORITY) ? null : order);
/* "Other" is the fixed last row: no handle, no buttons. */
function orderRow(t, i, last) {
  const label = escapeHtml(CATEGORIES.find((c) => c.type === t).label);
  const fixed = t === "none";
  return `<li class="og-row${fixed ? " fixed" : ""}" data-type="${escapeHtml(t)}"><span class="og-n">${i + 1}</span><span class="og-e">${escapeHtml(orderEmoji(t))}</span><span class="og-l">${label}</span>`
    + (fixed ? "" : `<button class="og-mv" data-og-up="${escapeHtml(t)}" aria-label="Move ${label} up"${i === 0 ? " disabled" : ""}>${ICON.up}</button>`
      + `<button class="og-mv down" data-og-down="${escapeHtml(t)}" aria-label="Move ${label} down"${i === last - 1 ? " disabled" : ""}>${ICON.up}</button>`
      + `<span class="og-handle" data-og-drag aria-hidden="true">&#8801;</span>`) + `</li>`;
}
registerLevel("set-order", {
  title: () => "Grid emoji order",
  body() {
    const order = readPrefs(store.state.settings).gridOrder;
    return `<p class="fhint">When a day has several events, Grid shows the emoji highest in this list. Your own events (and shared ones) always come before the other person's. Drag the handle, or use the arrows.</p>`
      + `<ul class="og-list" id="ogList">${order.map((t, i) => orderRow(t, i, order.length - 1)).join("")}</ul>`
      + `<button class="og-reset" data-og-reset>Reset to default order</button>`
      + `<p class="fhint">Always, whatever the order: a visitor's arrival day shows first; a hotel shows only on check-in day; Other is last.</p>`;
  },
  onAction(b) {
    const order = [...readPrefs(store.state.settings).gridOrder];
    if (b.dataset.ogReset != null) { saveOrder(DAY_PRIORITY); return; }
    const up = b.dataset.ogUp, down = b.dataset.ogDown, t = up || down;
    if (!t) return;
    const i = order.indexOf(t), j = i + (up ? -1 : 1);
    if (i < 0 || j < 0 || j >= order.length - 1) return; /* Other stays last */
    [order[i], order[j]] = [order[j], order[i]];
    saveOrder(order);
    /* the sheet redraws after this handler: put the keyboard back on the moved row's button */
    setTimeout(() => {
      const again = document.querySelector(`[data-og-${up ? "up" : "down"}="${t}"]`);
      if (again && !again.disabled) again.focus();
    });
  },
});
/* Dragging a row by its handle (pointer events, so mouse and touch alike).
   The rows move in the DOM while the finger is down; the order is saved
   once, on release (a save redraws the sheet, which would drop the drag). */
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
  if (e.type === "pointercancel") { refreshSheet(); return; }
  saveOrder([...list.querySelectorAll(".og-row")].map((r) => r.dataset.type));
}
document.addEventListener("pointerup", endOrderDrag);
document.addEventListener("pointercancel", endOrderDrag);

/* F3: a today's-event-count badge on the Calendar nav icon, styled like the
   shopping list's item-count badge (household-look.md, "The nav count
   badge"): hidden entirely at zero rather than showing "0". */
function renderNav() {
  const count = todaysCount();
  return Object.entries(VIEWS).map(([id, label]) => `
    <button data-view="${escapeHtml(id)}" ${current === id ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${ICON[id]}${id === "calendar" && count ? `<span class="nav-badge">${count > 99 ? "99+" : count}</span>` : ""}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>`).join("");
}

let firstDraw = true;
export const isCalendar = () => current === "calendar" && !gateStep();

export function render() {
  const main = document.getElementById("view");
  /* The gate first: no token (or no "who am I") and nothing else draws. */
  const step = gateStep();
  const wasGated = document.body.classList.contains("gated");
  document.body.classList.toggle("gated", !!step);
  /* the header was hidden while gated, so --header-h measured 0: wire.js
     measures it again on resize */
  if (wasGated && !step) window.dispatchEvent(new Event("resize"));
  if (step) {
    main.classList.remove("is-cal");
    main.innerHTML = gateHtml(step);
    document.getElementById("nav").innerHTML = "";
    bindGate(main, { onToken: () => { if (actions.sync) actions.sync(); } });
    return;
  }
  const before = { top: main.scrollTop, height: main.scrollHeight, first: firstDraw };
  document.getElementById("tabName").textContent = VIEWS[current];
  main.innerHTML = current === "settings" ? renderSettings()
    : current === "calendar" ? calendarHtml()
    : current === "insights" ? insightsHtml() : renderStub(current);
  main.classList.toggle("is-cal", current === "calendar");
  document.getElementById("nav").innerHTML = renderNav();
  /* No floating buttons any more (#fabs stays empty): Today and "+" sit in
     the Calendar's own control row (calendar.js controls()). */
  if (current === "calendar") { afterCalendar(main, before); firstDraw = false; }
  refreshSheet();
  refreshArchive();
  bindView();
  if (current === "insights") bindInsights(main);
}

/* Re-bound on every render, because every render replaces these nodes. */
function bindView() {
  document.querySelectorAll("#nav button, #view [data-view]").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  document.querySelectorAll("#view [data-me]").forEach((b) => {
    b.addEventListener("click", () => store.setSetting("me", b.dataset.me));
  });
  document.querySelectorAll("#view [data-palette]").forEach((b) => {
    b.addEventListener("click", () => { applyPalette(b.dataset.palette); store.setSetting("palette", b.dataset.palette); });
  });
  document.querySelectorAll("#view [data-level]").forEach((b) => {
    b.addEventListener("click", () => openLevel({ kind: b.dataset.level }));
  });

  const sync = document.getElementById("syncNow");
  if (sync) sync.addEventListener("click", () => { if (actions.sync) actions.sync(); });

  const arch = document.getElementById("openArchiveBtn");
  if (arch) arch.addEventListener("click", () => openArchive());

  const adv = document.getElementById("advToggle");
  if (adv) adv.addEventListener("click", () => { advancedOpen = !advancedOpen; render(); });

  /* Spoon's token field saves on change: paste, then leave the field */
  const input = document.getElementById("tokenInput");
  if (input) input.addEventListener("change", () => {
    const v = input.value.trim();
    /* the same value twice is one paste: a redraw can blur the field and
       fire change again while this render is still running */
    if (!v || v === store.state.settings.token) return;
    store.setSetting("token", v);
    checkToken().then(render);
    if (actions.sync) actions.sync();
  });
  const clear = document.getElementById("clearToken");
  if (clear) clear.addEventListener("click", () => store.setSetting("token", ""));

  /* App link: copy, or leave the link selected to copy by hand */
  const copy = document.getElementById("copyAppLink");
  if (copy) copy.addEventListener("click", () => {
    const input = document.getElementById("appLink");
    input.focus(); input.select();
    copyText(input.value).then((ok) => {
      if (!ok) return;
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    });
  });

  const upd = document.getElementById("updateBtn");
  if (upd) upd.addEventListener("click", () => {
    if (upd.disabled) return;
    if (updateReady()) { location.reload(); return; }
    checkForUpdate(render);
  });
}
