/* Compass: one-time wiring that outlives a render.

   Anything bound to a node that render() replaces belongs in render.js and is
   re-bound every time. Only listeners on window, document or the persistent
   shell go here, and each one is registered exactly once - Spoon's rule after
   a resize handler ended up attached per render. */
"use strict";

import { store } from "./store.js";
import { sheetOpen } from "./sheet.js";
import { render, openDrawer, closeDrawer, openPage, closePage, openSearch, onPageClick, onPageChange, onShellPop,
  pageIsOpen, drawerIsOpen, showTopBar, hideTopBar, actions, paintSyncBar } from "./render.js";
import { isJumping } from "./util.js";
import { attachPullToRefresh, showSnackbar } from "../m3/kave-m3.js";
import { onSyncState } from "./sync.js";

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

/* ---------- sync status: snackbars, the offline card, pull to refresh ----------
   The snackbar rule. Only a sync the person started (pull, Sync now, Retry)
   says anything about its own result: "Synced just now", or the failure with
   Retry. A background sync stays silent, with two exceptions that matter:
   going offline (said once per offline spell) and a failed push that leaves
   edits unsent (once per spell). A manual sync that ends offline says the
   offline line again, since it answers something the person just did. */
const snack = (opts) => showSnackbar(document.getElementById("snackHost") || document.body, opts);
const OFFLINE_TEXT = "You're offline. Changes are saved on this phone.";
let offlineSaid = false;
let failSaid = false;   // the unsent-edits failure says itself once per spell

function sayOffline() {
  if (offlineSaid) return;
  offlineSaid = true;
  snack({ text: OFFLINE_TEXT, ms: 5000 });
}

function initStatus() {
  onSyncState((state, meta) => {
    paintSyncBar();
    if (state === "ok") {
      offlineSaid = false;
      failSaid = false;
      if (meta.manual) snack({ text: "Synced just now" });
    } else if (state === "offline") {
      if (meta.manual) { offlineSaid = true; snack({ text: OFFLINE_TEXT, ms: 5000 }); }
      else sayOffline();
    } else if (state === "failed" && (meta.manual || (meta.unsent && !failSaid))) {
      failSaid = true;
      snack({
        text: "Couldn't sync. Check the connection.", action: "Retry", ms: 6000,
        onAction: () => { if (actions.sync) actions.sync({ manual: true }); },
      });
    }
  });
  /* the offline card is part of each tab: draw the tab again when the network comes or goes */
  window.addEventListener("offline", () => { sayOffline(); render(); });
  window.addEventListener("online", () => { offlineSaid = false; render(); });
  if (navigator.onLine === false) sayOffline();
}

/* A pull is a manual sync. With no token there is nothing to sync, but the
   gesture still feels like one. */
function pullRefresh() {
  if (!store.state.settings.token || !actions.sync) return new Promise((r) => setTimeout(r, 400));
  return actions.sync({ manual: true });
}

/* The kit's pull indicator wants an element scroller. This stands in for
   #view: same scrollTop, the indicator parked under the header, and every
   touchstart and pointerdown run through the guards first, so a pull never
   arms under the drawer, a page, a sheet, search or a dialog, from more than
   one finger, from a form control, or from the Calendar's strip (whose own
   vertical swipe opens and closes the month). */
function viewScroller(view) {
  const canPull = () => {
    const shell = document.querySelector(".shell");
    return !document.body.classList.contains("gated") && !(shell && shell.inert) && !sheetOpen();
  };
  const ok = (e) => (e.type !== "touchstart" || (e.touches && e.touches.length === 1))
    && !(e.target.closest && e.target.closest("input, textarea, select, [contenteditable], [data-live]"));
  const handlers = new Map();
  return {
    get scrollTop() { return view.scrollTop; },
    get parentElement() { return view.parentElement; },
    get offsetTop() { const h = document.querySelector(".app-header"); return h ? h.offsetHeight : 0; },
    setPointerCapture(id) { view.setPointerCapture(id); },
    addEventListener(type, fn, opts) {
      const guarded = type === "touchstart" || type === "pointerdown";
      const h = guarded ? (e) => { if (canPull() && ok(e)) fn(e); } : fn;
      handlers.set(fn, h);
      view.addEventListener(type, h, opts);
    },
    removeEventListener(type, fn, opts) { view.removeEventListener(type, handlers.get(fn) || fn, opts); },
  };
}

/* Registered once from boot.js, after the app's actions exist. */
export function initStatusUi() {
  initStatus();
  const view = document.getElementById("view");
  if (view) attachPullToRefresh(viewScroller(view), pullRefresh);
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
