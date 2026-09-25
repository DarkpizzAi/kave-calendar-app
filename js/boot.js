/* Compass: entry point.

   Loaded as <script type="module">, which is deferred, so the DOM is parsed
   by the time this runs. Do not add anything here that depends on running
   before parse - that is what the inline #theme-preload script in index.html
   is for, and it is inline precisely because a deferred module is too late to
   prevent a flash of the wrong palette. */
"use strict";

import { initTheme } from "./theme.js";
import { render, isCalendar, dataSync, actions } from "./render.js";
import { wire, showBanner } from "./wire.js";
import { initPullToSync } from "./pull-to-sync.js";
import { appData } from "./data.js";
import { store } from "./store.js";
import { initCalendar, backToToday, closeMenus, scrollToTop } from "./calendar.js";
import { initSheet, back, sheetOpen, refreshSheet, setDayAdd } from "./sheet.js";
import { initEvent, newEventForm } from "./view-event.js";

initTheme();
wire();
initPullToSync();

const data = await appData();
data.subscribe(render);

/* Sync on open and whenever the app comes back into view. The status goes
   to Settings only; the Calendar never shows it. */
async function syncNow() {
  if (!store.state.settings.token) return;
  dataSync.state = "working"; dataSync.message = "Syncing...";
  const r = await data.sync([...new Set([...data.loadedYears(), String(new Date().getFullYear()), String(new Date().getFullYear() + 1)])]);
  const kind = r.error && r.error.gh;
  Object.assign(dataSync, r.ok ? { state: "ok", message: "Synced" }
    : { state: kind === "offline" ? "offline" : "failed",
        message: kind === "offline" ? "Offline. Your edits are kept and sent when you are back online."
          : kind === "unauthorized" ? "Sync failed: the token was rejected. Check it in Advanced settings."
          : kind === "rateLimited" ? "Sync failed: rate limited by GitHub. It retries on its own."
          : "Sync failed: " + ((r.error && r.error.message) || "unknown error") }, { at: Date.now() });
  render();
}

actions.sync = syncNow;
initSheet();
initEvent({ data, refresh: refreshSheet });
setDayAdd(newEventForm); // F21: the day-level sheet's own "+"
initCalendar({ data, render, isCalendar, sync: syncNow });
render();
syncNow();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
window.addEventListener("online", syncNow);

/* F28: the three round buttons -- "+", up (scroll to top) and down (back to
   today, collapsing loaded-older data). "Load older" (F29) moved inline
   into the control row and is bound there, in calendar.js's own onClick. */
document.getElementById("fabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-fab]");
  if (!b) return;
  if (b.dataset.fab === "up") scrollToTop();
  else if (b.dataset.fab === "down") backToToday();
  else newEventForm();
});

/* Backspace = Back on a computer (except while typing), like the phone's
   Back; Escape too. Up one sheet level, else close a menu or search. */
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable]");
  if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
    if (sheetOpen()) { e.preventDefault(); back(); }
    else if (e.key === "Escape" && closeMenus()) e.preventDefault();
  }
  if ((e.key === "Enter" || e.key === " ") && !typing && e.target.matches && e.target.matches("#view [data-act][role=button]")) {
    e.preventDefault(); e.target.click();
  }
});

/* ---------- service worker ---------- */

/* Never register on localhost. The dev server sends no-store, but a worker
   registered once would go on serving a cached shell from a previous run and
   the symptom looks like "my edit did nothing". service-worker.js also tears
   itself down on localhost, because this guard is unreachable the moment an
   old worker is already serving a stale copy of this file. */
const IS_LOCAL_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);

if ("serviceWorker" in navigator && !IS_LOCAL_DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((reg) => {
      /* A new worker took over: the shell on screen is the old one. Say so
         rather than leaving the user on a stale app that looks current. */
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            showBanner("New version ready. Close and reopen Compass.", 8000);
          }
        });
      });
    }).catch(() => { /* registration is an enhancement, never a hard failure */ });
  });
}
