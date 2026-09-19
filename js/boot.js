/* Compass: entry point.

   Loaded as <script type="module">, which is deferred, so the DOM is parsed
   by the time this runs. Do not add anything here that depends on running
   before parse - that is what the inline #theme-preload script in index.html
   is for, and it is inline precisely because a deferred module is too late to
   prevent a flash of the wrong palette. */
"use strict";

import { initTheme } from "./theme.js";
import { render } from "./render.js";
import { wire, showBanner } from "./wire.js";
import { initPullToSync } from "./pull-to-sync.js";

initTheme();
wire();
render();
initPullToSync();

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
