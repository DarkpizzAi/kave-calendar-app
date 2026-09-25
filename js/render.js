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
import { calendarHtml, afterCalendar, onScroll, backToToday, showLoadOlder, todaysCount } from "./calendar.js";
import { refreshSheet, openLevel, registerLevel } from "./sheet.js";
import { readPrefs, isShown, toggleCategory, resetCategories, defaultsSummary, categoriesSummary, VIEW_NAMES, DETAIL_NAMES, STYLE_NAMES } from "./prefs.js";
import { CATEGORIES, iconFor } from "./icons.js";
import { resetCalendarDefaults } from "./calendar.js";

/* Sync of the events themselves, shown in Settings only (spec: the Calendar
   never shows sync state). Set by boot.js. */
export const dataSync = { state: "idle", message: "", at: 0 };
/* Set by boot.js: what "Sync now" runs. */
export const actions = { sync: null };

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

  return `<div class="fields">
    ${field("Theme", theme, "Light and dark follow the phone.")}
    ${opener("Calendar defaults", "set-defaults", defaultsSummary(prefs))}
    ${me ? opener("Categories", "set-cats", categoriesSummary(prefs, me)) : ""}
    ${field("Who am I", choices("me", [["isa", "Isa"], ["hugo", "Hugo"]], me), "Stamps every edit you make. Nothing is saved until it is set.")}
    ${field("Sync", `<div class="sync-status"><p class="sync-line ${dot}"><i></i>${escapeHtml(syncLine)}</p>${when ? `<p class="sync-line muted">${escapeHtml(when)}</p>` : ""}</div>`
      + `<button id="syncNow"${s.token ? "" : " disabled"}>Sync now</button>`)}
    <div class="advanced-block">
      <button class="adv-toggle" id="advToggle" aria-expanded="${advancedOpen}" aria-controls="advFields"><span class="caret">${advancedOpen ? "&#9662;" : "&#9656;"}</span> Advanced settings</button>
      <div class="fields" id="advFields"${advancedOpen ? "" : " hidden"}>
        ${field('<label for="tokenInput">GitHub token</label>', `<div class="token-row"><input id="tokenInput" type="password" placeholder="${s.token ? "Token saved" : "github_pat_..."}"`
          + ` autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><button id="clearToken"${s.token ? "" : " disabled"}>Clear</button></div>${tok}`,
          "Stored on this device only, sent only to GitHub. Fine-grained, Contents: read and write on kave-hub.")}
        ${field('<label for="appLink">App link</label>', `<div class="token-row"><input id="appLink" type="text" value="${escapeHtml(APP_URL)}" readonly><button id="copyAppLink">Copy</button></div>`,
          "Open Compass on another device: copy this and send it to your phone.")}
        ${field("About", `<p class="sync-line muted">Compass <span id="swVersion">checking version...</span></p>${diag}`,
          "The household planner. Data in kave-hub; the mini PC runs the sweeps.")}
      </div>
    </div>
  </div>`;
}

/* The public address, the same wherever this copy runs (a PC, localhost) */
const APP_URL = "https://darkpizzai.github.io/kave-calendar-app/";

/* The two Settings sheets, as levels of the one sheet. */
const VIEW_LABEL = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const PREF_KEYS = ["defaultView", "defaultDetail", "cardStyle"];
registerLevel("set-defaults", {
  title: () => "Calendar defaults",
  body() {
    const p = readPrefs(store.state.settings);
    return `<div class="fields">${field("Default view", choices("pref-view", VIEW_NAMES, p.defaultView), "Where the Calendar opens.")}`
      + field("Default detail level", choices("pref-detail", DETAIL_NAMES, p.defaultDetail), "Full: both of you. Partial: the other person greyed. Minimal: yours and shared only.")
      + field("Card style", choices("pref-style", STYLE_NAMES, p.cardStyle), "How events look in Weekly's day cards.") + "</div>";
  },
  onAction(b) {
    const d = b.dataset;
    const pick = d.prefView != null ? ["defaultView", d.prefView] : d.prefDetail != null ? ["defaultDetail", d.prefDetail]
      : d.prefStyle != null ? ["cardStyle", d.prefStyle] : null;
    if (!pick || !PREF_KEYS.includes(pick[0])) return;
    store.setSetting(pick[0], pick[1]);
    resetCalendarDefaults();
  },
});
registerLevel("set-cats", {
  title: () => "Categories",
  body() {
    const s = store.state.settings, p = readPrefs(s), me = s.me;
    const head = `<div class="grid-h"><span></span>${VIEW_NAMES.map(([, l]) => `<span>${l[0]}<span class="full">${l.slice(1)}</span></span>`).join("")}</div>`;
    const rowsHtml = CATEGORIES.map((c) => `<div class="grid-r"><span class="gl"><span class="gi">${escapeHtml(iconFor({ type: c.type }, { owner: me }, me))}</span>${escapeHtml(c.label)}</span>`
      + VIEW_NAMES.map(([v]) => {
        const on = isShown(p, me, v, c.type);
        return `<button class="tick${on ? " on" : ""}" role="checkbox" aria-checked="${on}" aria-label="${escapeHtml(c.label)} in ${VIEW_LABEL[v]}" data-tick-view="${v}" data-tick-type="${escapeHtml(c.type)}">${on ? ICON.check : ""}</button>`;
      }).join("") + "</div>").join("");
    return `<p class="fhint">What ${me === "hugo" ? "Hugo" : "Isa"} sees in each view. Each of you picks your own; hiding a category deletes nothing.</p><div class="grid">${head}${rowsHtml}</div>`;
  },
  bar: () => `<button class="act-btn" data-act="reset">Reset</button>`,
  onAction(b) {
    const s = store.state.settings;
    if (b.dataset.act === "reset") {
      store.setSetting("hiddenCategories", resetCategories(readPrefs(s)).hiddenCategories);
      return;
    }
    const v = b.dataset.tickView, t = b.dataset.tickType;
    if (!v || !t || !s.me) return;
    store.setSetting("hiddenCategories", toggleCategory(readPrefs(s), s.me, v, t).hiddenCategories);
  },
});

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
      + (showLoadOlder() ? `<button class="fab older" data-fab="older" aria-label="Load older years">${ICON.older}</button>` : "")
      + `<button class="fab add" data-fab="add" aria-label="Add an event">${ICON.plus}</button>` : "";
  if (current === "calendar" && !blocked) { afterCalendar(main, before); firstDraw = false; }
  else onScroll();
  refreshSheet();
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
  document.querySelectorAll("#view [data-palette]").forEach((b) => {
    b.addEventListener("click", () => { applyPalette(b.dataset.palette); store.setSetting("palette", b.dataset.palette); });
  });
  document.querySelectorAll("#view [data-level]").forEach((b) => {
    b.addEventListener("click", () => openLevel({ kind: b.dataset.level }));
  });

  const sync = document.getElementById("syncNow");
  if (sync) sync.addEventListener("click", () => { if (actions.sync) actions.sync(); });

  const adv = document.getElementById("advToggle");
  if (adv) adv.addEventListener("click", () => { advancedOpen = !advancedOpen; render(); });

  /* Spoon's token field saves on change: paste, then leave the field */
  const input = document.getElementById("tokenInput");
  if (input) input.addEventListener("change", () => {
    const v = input.value.trim();
    if (!v) return;
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
