/* Compass: one-time wiring that outlives a render.

   Anything bound to a node that render() replaces belongs in render.js and is
   re-bound every time. Only listeners on window, document or the persistent
   shell go here, and each one is registered exactly once - Spoon's rule after
   a resize handler ended up attached per render. */
"use strict";

import { store } from "./store.js";
import { render } from "./render.js";
import { syncColorScheme } from "./theme.js";

export function wire() {
  store.subscribe(render);

  /* The header is fixed, so the body needs its real height as padding. It is
     measured rather than assumed because it changes with the safe-area inset
     and with the font once Rubik actually loads. */
  const syncHeaderHeight = () => {
    const h = document.querySelector(".app-header");
    if (h) document.documentElement.style.setProperty("--header-h", h.offsetHeight + "px");
  };
  syncHeaderHeight();
  window.addEventListener("resize", syncHeaderHeight);
  /* Rubik arriving changes the header height after first paint. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);

  window.addEventListener("online", syncColorScheme);
}

/* A banner, not a toast: the household pattern for status that is not about
   one specific control. Tappable variant comes when something needs tapping. */
let bannerTimer = 0;
export function showBanner(msg, ms = 4000) {
  let b = document.getElementById("banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "banner";
    b.className = "banner";
    b.setAttribute("role", "status");
    document.body.append(b);
  }
  b.textContent = msg;
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}
