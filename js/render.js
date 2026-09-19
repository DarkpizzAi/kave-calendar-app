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

export const VIEWS = {
  today: "Today",
  trips: "Trips",
  settings: "Settings",
};

let current = "today";

export function currentView() { return current; }

export function setView(name) {
  if (!VIEWS[name]) return;
  current = name;
  render();
}

/* A view that is honestly not built yet. Dashed, never a tidy empty state:
   an empty state says "nothing here", and this has to say "not written yet",
   which is the same signal Spoon's Plan tab uses. */
function stub(title, line) {
  return `<div class="stub"><b>${escapeHtml(title)}</b>${escapeHtml(line)}</div>`;
}

function renderToday() {
  return `
    <h2 class="view-title">Today</h2>
    <p class="lede">Key dates, bookings and what is coming up.</p>
    ${stub("Not built yet", "Compass has been brainstormed but not specced. This view arrives with its own spec.")}
  `;
}

function renderTrips() {
  return `
    <h2 class="view-title">Trips</h2>
    <p class="lede">Planned and past trips, and what each one cost.</p>
    ${stub("Not built yet", "Trips, where we have been and where we want to go. Brainstormed; the shape of it is the next spec.")}
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
            aria-pressed="${s.palette === id}" title="${escapeHtml(name)}"
            aria-label="${escapeHtml(name)}"
            style="background:${escapeHtml(accents[id] || "")}"></button>`).join("");

  const diag = themeBootRan()
    ? `<p class="status-line good">Theme preload OK</p>`
    : `<p class="status-line warn">Theme preload BLOCKED - recompute the CSP hash (see README)</p>`;

  const sync = syncStatus.state === "idle"
    ? `<p class="status-line">Not checked this session.</p>`
    : `<p class="status-line ${syncStatus.state === "ok" ? "good" : (syncStatus.state === "checking" ? "" : "warn")}">${escapeHtml(syncStatus.message)}</p>`;

  return `
    <h2 class="view-title">Settings</h2>

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
        <p class="hint">The household calendar. Shell only: brainstormed, not specced, and the backend is not decided yet.</p>
      </div>
    </section>
  `;
}

function renderNav() {
  return Object.entries(VIEWS).map(([id, label]) => `
    <button data-view="${escapeHtml(id)}" ${current === id ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${id === "today" ? "&#9679;" : id === "trips" ? "&#9650;" : "&#9881;"}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>`).join("");
}

export function render() {
  const main = document.getElementById("view");
  main.innerHTML =
    current === "today" ? renderToday() :
    current === "trips" ? renderTrips() :
    renderSettings();

  document.getElementById("nav").innerHTML = renderNav();
  bindView();
}

/* Re-bound on every render, because every render replaces these nodes. */
function bindView() {
  document.querySelectorAll("#nav button").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
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
