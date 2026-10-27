/* Compass: one-time wiring that outlives a render.

   Anything bound to a node that render() replaces belongs in render.js and is
   re-bound every time. Only listeners on window, document or the persistent
   shell go here, and each one is registered exactly once - Spoon's rule after
   a resize handler ended up attached per render. */
"use strict";

import { store } from "./store.js";
import { render, openDrawer, closeDrawer, openPage, closePage, openSearch, onPageClick, onPageChange, onShellPop,
  pageIsOpen, drawerIsOpen, showTopBar, hideTopBar, actions } from "./render.js";
import { isJumping } from "./util.js";

export function wire() {
  store.subscribe(render);

  /* the shell: menu (top bar on compact, rail on wider windows), search, New event */
  const on = (id, ev, fn) => { const n = document.getElementById(id); if (n) n.addEventListener(ev, fn); };
  on("menuBtn", "click", openDrawer);
  on("railMenuBtn", "click", openDrawer);
  on("searchBtn", "click", openSearch);
  const add = () => { if (actions.add) actions.add(); };
  on("fab", "click", add);
  on("railAdd", "click", add);
  on("drawerScrim", "click", closeDrawer);
  document.querySelectorAll("#drawer [data-page]").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.page)));
  on("pageBack", "click", closePage);
  on("pageBody", "click", onPageClick);
  on("pageBody", "change", onPageChange);
  /* the phone's Back (and the browser's) closes the top layer */
  window.addEventListener("popstate", onShellPop);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (pageIsOpen()) { e.preventDefault(); closePage(); }
    else if (drawerIsOpen()) { e.preventDefault(); closeDrawer(); }
  });

  /* The top bar hides after 64px of downward scroll and returns on any upward
     one; a scroll the app caused itself (a redraw, back to today) never hides it. */
  const view = document.getElementById("view");
  let lastY = 0;
  if (view) view.addEventListener("scroll", () => {
    const y = view.scrollTop;
    if (isJumping()) { lastY = y; return; }
    if (y <= 0 || y < lastY) showTopBar();
    else if (y > 64 && y > lastY) hideTopBar();
    lastY = y;
  }, { passive: true });

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
  /* Light and dark changes are theme.js's own matchMedia listener
     (initTheme), not anything here. */
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
