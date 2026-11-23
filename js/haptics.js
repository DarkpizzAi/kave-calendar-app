/* Compass: haptics for the agenda (Isa, 23/11/2026). A gentle tick for each
   new day that passes the pin line, and a steady buzz ("goes brrrr") while the
   list is racing. navigator.vibrate exists on Android's browsers and installed
   web apps, not on iOS; everywhere else these do nothing. Pure except for the
   one navigator call, so the tests can pass a fake. */
"use strict";

export const TICK_MS = 8;
/* the buzz: 14ms on, 10ms off, long enough for a hard fling; calm() ends it early */
export const brrrPattern = (total = 1500, on = 14, off = 10) => {
  const p = [];
  for (let t = 0; t < total; t += on + off) p.push(on, off);
  return p;
};

const vib = (nav, p) => { try { return !!(nav && typeof nav.vibrate === "function" && nav.vibrate(p)); } catch (e) { return false; } };
const real = () => (typeof navigator === "undefined" ? null : navigator);

export const tick = (nav = real()) => vib(nav, TICK_MS);
export const brrr = (nav = real()) => vib(nav, brrrPattern());
export const calm = (nav = real()) => vib(nav, 0);
