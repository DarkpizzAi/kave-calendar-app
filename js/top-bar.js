/* Compass: the top bar's scroll behaviour, Material 3 "enter always".

   The bar is not a timed slide: it moves with the scroll, pixel for pixel.
   Scrolling down pushes it up and away; scrolling up, anywhere in the list,
   brings it back the same way. When the scroll stops with the bar part way,
   it settles, in the direction the reader was going (all the way out after a
   downward scroll, all the way in after an upward one).

   Only scrolling the reader drives moves it: a finger on the list, the fling
   it starts (in the same direction) and a mouse wheel. A scroll the app makes
   itself (a jump mark, see util.js markJump) never does, and neither does the
   Calendar's snap settling a day on its line after the finger lifts, which
   often runs a little against the drag.

   One behaviour, two bars: the app's own (#topBar over #view) and the bar of
   a full-screen page (Settings and the other drawer pages, over #pageBody),
   which scrolled with its page before (Isa, 05/11/2026). createBar holds the
   behaviour; each bar is an instance.

   Followers of the app's bar (the Calendar's strip and the agenda's box) are
   called with its offset every time it moves, in the same task, so they move
   with it in the same frame. */
"use strict";

import { isJumping } from "./util.js";
import { EASE, motionFactor } from "../m3/kave-m3.js";

/* the kit gives easings as CSS cubic-bezier strings; this solves one for x */
function cubic(css) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css || "");
  const [x1, y1, x2, y2] = m ? m[1].split(",").map(Number) : [0.2, 0, 0, 1];
  const at = (a, b, t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = at(x1, x2, t) - x, d = (at(x1, x2, t + 1e-4) - at(x1, x2, t - 1e-4)) / 2e-4;
      if (!d) break;
      t = Math.min(1, Math.max(0, t - err / d));
    }
    return at(y1, y2, t);
  };
}

/* One enter-always bar over one scroller. `touchOk(e)` says whether a touch
   counts as a scroll of the page (the Calendar's strip does not); `onMove`
   hears every offset change. */
function createBar(bar, scroller, { touchOk = () => true, onMove = null } = {}) {
  let H = 64;              // the bar's height, its safe-area padding included
  let o = 0;               // its offset: 0 shown, -H gone
  let lastY = scroller.scrollTop, dir = 0;  // dir: +1 down, -1 up, the reader's last direction
  let touching = false, lifted = false, wheelAt = 0, endTimer = 0, settleId = 0;

  const target = () => {
    if (o >= 0 || o <= -H) return o >= 0 ? 0 : -H;
    return dir > 0 ? -H : dir < 0 ? 0 : (o < -H / 2 ? -H : 0);
  };
  function apply() {
    bar.style.transform = o ? `translateY(${o}px)` : "";
    bar.classList.toggle("is-hidden", o <= -H);
    if (onMove) onMove(o, H);
  }
  function setO(v) {
    const n = Math.max(-H, Math.min(0, v));
    if (n === o) return;
    o = n;
    apply();
  }
  function stopSettle() { if (settleId) { cancelAnimationFrame(settleId); settleId = 0; } }
  /* animate the bar to an end: 250ms emphasized, as the kit's own motion */
  function settleTo(to) {
    stopSettle();
    if (o === to) return;
    const f = motionFactor();
    if (!f) { setO(to); return; }
    const from = o, t0 = performance.now(), ms = 250 * f;
    const ease = cubic(EASE.emphasized);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      setO(from + (to - from) * ease(p));
      settleId = p < 1 ? requestAnimationFrame(step) : 0;
    };
    settleId = requestAnimationFrame(step);
  }
  /* the scroll came to rest: a bar left part way settles */
  function scrollEnded() {
    clearTimeout(endTimer);
    lifted = false;
    if (!touching) settleTo(target());
  }
  function onScroll() {
    const y = scroller.scrollTop, dy = y - lastY;
    lastY = y;
    if (!dy) return;
    clearTimeout(endTimer);
    endTimer = setTimeout(scrollEnded, 160); /* no scrollend event: a quiet 160ms is the end */
    if (isJumping()) return;
    const s = Math.sign(dy);
    if (touching) dir = s;
    else if (!(performance.now() - wheelAt < 300 || (lifted && s === dir))) return;
    else if (!lifted) dir = s;
    stopSettle();
    setO(y <= 0 ? 0 : o - dy);
  }
  scroller.addEventListener("touchstart", (e) => {
    touching = touchOk(e);
    lifted = false;
    if (touching) stopSettle();
  }, { passive: true });
  const lift = () => {
    if (!touching) return;
    touching = false;
    lifted = true;
    /* a lift with nothing still moving settles now; a fling settles at its end */
    clearTimeout(endTimer);
    endTimer = setTimeout(scrollEnded, 160);
  };
  scroller.addEventListener("touchend", lift, { passive: true });
  scroller.addEventListener("touchcancel", lift, { passive: true });
  scroller.addEventListener("wheel", () => { wheelAt = performance.now(); }, { passive: true });
  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("scrollend", scrollEnded);

  const api = {
    offset: () => o,
    height: () => H,
    target,
    show(now) { dir = -1; if (now) { stopSettle(); setO(0); } else settleTo(0); },
    hide() { dir = 1; settleTo(-H); },
    measure() {
      const h = bar.offsetHeight;
      if (h && h !== H) { const wasGone = o <= -H; H = h; o = wasGone ? -H : Math.max(-H, o); apply(); }
    },
    /* a new page: shown, and the scroll it remembers is the one it has now */
    reset() { stopSettle(); lastY = scroller.scrollTop; dir = 0; setO(0); },
  };
  api.measure();
  return api;
}

/* ---- the app's own bar ---- */
let main = null;
const followers = new Set();

export const barOffset = () => (main ? main.offset() : 0);
export const barHeight = () => (main ? main.height() : 64);
/* Where the bar is going to rest, for the Calendar's snap line: where it is,
   once at either end; part way, where the settle will take it. */
export const barTarget = () => (main ? main.target() : 0);
export function onBarMove(fn) { followers.add(fn); return () => followers.delete(fn); }

/* The bar comes all the way back (a new tab, back to today, a tap's glide):
   the same settle, so whatever follows it moves the same way. `now` skips the
   animation. */
export function showTopBar(now) { if (main) main.show(now); }
export function hideTopBar() { if (main) main.hide(); }
export function measureBar() { if (main) main.measure(); if (page) page.measure(); }

export function initTopBar() {
  const bar = document.getElementById("topBar"), view = document.getElementById("view");
  if (!bar || !view) return;
  main = createBar(bar, view, {
    /* a touch on the Calendar's strip is a swipe of the strip, never a scroll
       of the page, whatever the page does while the strip changes height */
    touchOk: (e) => !(e.target.closest && e.target.closest("[data-live]")),
    onMove: (o, H) => followers.forEach((f) => f(o, H)),
  });
  initPageBar();
}

/* ---- a full-screen page's bar (render.js openPage) ---- */
let page = null;
function initPageBar() {
  const host = document.getElementById("page"), body = document.getElementById("pageBody");
  const bar = host && host.querySelector(".m3-top-bar");
  if (!bar || !body) return;
  page = createBar(bar, body);
}
/* A page was drawn (opened, or another one stacked on top): its bar shows. */
export function resetPageBar() {
  if (!page) return;
  page.measure();
  page.reset();
  const bar = document.querySelector("#page > .m3-top-bar");
  if (bar && bar.offsetHeight) document.documentElement.style.setProperty("--page-bar-h", bar.offsetHeight + "px");
}
