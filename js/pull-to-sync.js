/* Compass: pull down to sync.

   Two rules carried from Spoon, both learned by getting them wrong:

   1. A pull syncs what the current tab shows, and only that. A gesture that
      always syncs everything is slower and, worse, it makes "I pulled and it
      did not update" ambiguous.
   2. It does not arm on a tab with no data of its own. Spoon armed it on
      Settings for a while, where it could only spin and fetch nothing.

   The Calendar's pull lives in calendar.js, because there one pull also
   reveals See previous and the list, not the window, is what scrolls. Trips
   has no data yet, so this still arms nowhere; it is the shape waiting for
   the tabs that scroll the window. */
"use strict";

import { currentView } from "./render.js";
import { showBanner } from "./wire.js";
import { checkToken } from "./sync.js";

/* Which views own data worth re-fetching. Empty until the data model exists;
   add a view here in the same change that gives it something to fetch. */
const PULLABLE = new Set([]);

export function initPullToSync() {
  let startY = 0;
  let armed = false;

  window.addEventListener("touchstart", (e) => {
    armed = window.scrollY === 0 && PULLABLE.has(currentView()) && e.touches.length === 1;
    startY = armed ? e.touches[0].clientY : 0;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!armed) return;
    armed = false;
    const dy = (e.changedTouches[0] || {}).clientY - startY;
    if (dy < 70) return;
    showBanner("Syncing...");
    checkToken().then((s) => showBanner(s.message));
  }, { passive: true });
}
