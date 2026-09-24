/* Compass: rendering.

   Full re-render on every interaction. Nothing here is incrementally
   updated. That is a size-dependent choice, not a principle: it is fine while
   the app is this small, and the thing to know before adding features is that
   every renderX() rebuilds its subtree and re-binds its own listeners.

   Transient UI state (which tab is open) is module-level and calls render()
   directly. Persisted state goes through store.setSetting -> notify. */
"use strict";

import { store } from "./store.js";
import { escapeHtml } from "./util.js";
import { PALETTES, applyPalette, themeBootRan, paletteAccents } from "./theme.js";
import { status as syncStatus, checkToken } from "./sync.js";
import { ICON } from "./chrome-icons.js";
import { calendarHtml, afterCalendar, onScroll, backToToday } from "./calendar.js";
import { refreshSheet } from "./sheet.js";

/* Sync of the events themselves, shown in Settings only (spec: the Calendar
   never shows sync state). Set by boot.js. */
export const dataSync = { state: "idle", message: "", at: 0 };

/* The five tabs from the brainstorm's tab map (kave-hub
   the Compass A spec in kave-hub). Calendar is home and
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
  document.getElementById("view").scrollTop = 0;
  firstDraw = true;
  render();
}

/* A view that is honestly not built yet. Dashed, never a tidy empty state:
   an empty state says "nothing here", and this has to say "not written yet",
   which is the same signal Spoon's Plan tab uses. */
function stub(title, line) {
  return `<div class="stub"><b>${escapeHtml(title)}</b>${escapeHtml(line)}</div>`;
}

const STUBS = {
  insights: ["What needs doing, and what needs a decision.",
    "Checklist items, trip warnings, and proposals from mail, bank lines and voice notes. Nothing is ever added automatically."],
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

function renderSettings() {
  const s = store.state.settings;
  const tokenSet = !!s.token;

  /* The hex comes from tokens.css via paletteAccents(), so it is a value this
     app read rather than one it stored. It still goes through escapeHtml
     before reaching a style attribute: the source is trusted today, and
     "trusted today" is exactly how the next injection gets written. */
  const accents = paletteAccents();
  const swatches = Object.entries(PALETTES).map(([id, name]) => `
    <button class="swatch" data-palette="${escapeHtml(id)}"
            aria-pressed="${(PALETTES[s.palette] ? s.palette : "cobalt") === id}" title="${escapeHtml(name)}"
            aria-label="${escapeHtml(name)}"
            style="background:${escapeHtml(accents[id] || "")}"></button>`).join("");

  const diag = themeBootRan()
    ? `<p class="status-line good">Theme preload OK</p>`
    : `<p class="status-line warn">Theme preload BLOCKED - recompute the CSP hash (see README)</p>`;

  const sync = syncStatus.state === "idle"
    ? `<p class="status-line">Not checked this session.</p>`
    : `<p class="status-line ${syncStatus.state === "ok" ? "good" : (syncStatus.state === "checking" ? "" : "warn")}">${escapeHtml(syncStatus.message)}</p>`;

  const me = s.me;
  const who = [["isa", "Isa"], ["hugo", "Hugo"]].map(([id, n]) =>
    `<button class="${me === id ? "" : "ghost"}" data-me="${id}" aria-pressed="${me === id}">${n}</button>`).join("");
  const ds = dataSync.state === "idle" ? "Not synced yet this session."
    : dataSync.message + (dataSync.at ? ` (${new Date(dataSync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "");

  return `
    <section class="section">
      <h3 class="section-title">You</h3>
      <div class="card">
        <p class="field-label">Who am I</p>
        <div class="row">${who}</div>
        <p class="hint">Stamps every edit you make. Nothing is saved until it is set.</p>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">Sync</h3>
      <div class="card">
        <p class="status-line ${dataSync.state === "ok" ? "good" : dataSync.state === "failed" ? "warn" : ""}">${escapeHtml(ds)}</p>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">GitHub token</h3>
      <div class="card">
        <p class="field-label"><label for="tokenInput">Fine-grained token, Contents: read and write on kave-hub</label></p>
        <input id="tokenInput" type="password" autocomplete="off" spellcheck="false"
               placeholder="${tokenSet ? "Token saved" : "Paste token"}" />
        <div class="row" style="margin-top: var(--sp-3)">
          <button id="saveToken">Save</button>
          <button id="checkToken" class="ghost">Check</button>
          ${tokenSet ? `<button id="clearToken" class="danger">Clear</button>` : ""}
        </div>
        ${sync}
        <p class="hint">Stored in this phone's localStorage in plain text. Clearing it here only removes this device's copy - revoke it on GitHub if it is ever exposed.</p>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">Display</h3>
      <div class="card">
        <p class="field-label">Palette</p>
        <div class="palettes">${swatches}</div>
        <p class="hint">Light and dark follow the phone. There is no in-app switch, on purpose.</p>
        ${diag}
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">About</h3>
      <div class="card">
        <p class="status-line">Compass <span id="swVersion">checking version...</span></p>
        <p class="hint">The household planner. Data in kave-hub; the mini PC runs the sweeps.</p>
      </div>
    </section>
  `;
}

function renderNav() {
  return Object.entries(VIEWS).map(([id, label]) => `
    <button data-view="${escapeHtml(id)}" ${current === id ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${ICON[id]}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>`).join("");
}

/* The Calendar's gates, before anything else: no token, then who am I. */
function gate() {
  const s = store.state.settings;
  if (!s.token) return `<div class="gate"><p class="gate-title">Connect Compass first</p>
    <p class="lede">Compass keeps your events in kave-hub. Add the GitHub token in Settings, then come back here.</p>
    <button data-view="settings">Open Settings</button></div>`;
  if (!s.me) return `<div class="gate"><p class="gate-title">Who are you?</p>
    <p class="lede">Every edit is stamped with who made it. You can change this later in Settings.</p>
    <div class="row"><button data-me="isa">Isa</button><button data-me="hugo">Hugo</button></div></div>`;
  return "";
}

let firstDraw = true;
export const isCalendar = () => current === "calendar" && !gate();

export function render() {
  const main = document.getElementById("view");
  const before = { top: main.scrollTop, height: main.scrollHeight, first: firstDraw };
  document.getElementById("tabName").textContent = VIEWS[current];
  const blocked = current === "calendar" && gate();
  main.innerHTML = current === "settings" ? renderSettings()
    : current === "calendar" ? (blocked || calendarHtml()) : renderStub(current);
  main.classList.toggle("is-cal", current === "calendar" && !blocked);
  document.getElementById("nav").innerHTML = renderNav();
  document.getElementById("fabs").innerHTML = current === "calendar" && !blocked
    ? `<button class="fab to-today" data-fab="today" aria-label="Back to today">${ICON.up}</button>`
      + `<button class="fab add" data-fab="add" aria-label="Add an event">${ICON.plus}</button>` : "";
  if (current === "calendar" && !blocked) { afterCalendar(main, before); firstDraw = false; refreshSheet(); }
  else onScroll();
  bindView();
}

/* Re-bound on every render, because every render replaces these nodes. */
function bindView() {
  document.querySelectorAll("#nav button, #view [data-view]").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  document.querySelectorAll("#view [data-me]").forEach((b) => {
    b.addEventListener("click", () => store.setSetting("me", b.dataset.me));
  });

  document.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      const p = b.dataset.palette;
      applyPalette(p);
      store.setSetting("palette", p);
    });
  });

  const save = document.getElementById("saveToken");
  if (save) {
    save.addEventListener("click", () => {
      const input = document.getElementById("tokenInput");
      const v = input.value.trim();
      if (!v) return;
      store.setSetting("token", v);
      input.value = "";
      checkToken().then(render);
    });
  }

  const check = document.getElementById("checkToken");
  if (check) check.addEventListener("click", () => { render(); checkToken().then(render); });

  const clear = document.getElementById("clearToken");
  if (clear) clear.addEventListener("click", () => store.setSetting("token", ""));

  const ver = document.getElementById("swVersion");
  if (ver) reportVersion(ver);
}

/* Ask the running service worker what VERSION it is. The app cannot know it
   from its own source: the whole point is to catch the case where a stale
   worker is serving an older shell than the one just deployed. */
function reportVersion(node) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    node.textContent = "(not installed)";
    return;
  }
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => { node.textContent = (e.data && e.data.version) || "(unknown)"; };
  navigator.serviceWorker.controller.postMessage({ type: "version" }, [ch.port2]);
}
