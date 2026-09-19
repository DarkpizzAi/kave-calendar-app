/* Compass: palette and colour-scheme handling.

   The token values are NOT here. They live in tokens.css, generated from
   design/data/household-tokens.css in kave-hub. This module only decides
   which palette is selected and keeps the browser's colour-scheme in step.

   Light or dark follows the OS and nothing else. There is deliberately no
   in-app override: [data-theme] exists in the tokens file as an internal
   read mechanism, not as a user setting. */
"use strict";

import { store } from "./store.js";

/* palette id -> display name. Must stay in step with the [data-palette]
   blocks in tokens.css; adding one here without adding it there silently
   falls back to Cobalt. */
export const PALETTES = {
  cobalt: "Cobalt",
  amber: "Amber",
  chartreuse: "Chartreuse",
  lime: "Lime",
  tangerine: "Tangerine",
  volt: "Volt",
};

export function darkNow() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/* Tell the browser which way the page leans. This is what darkens the Android
   gesture bar; the status bar at the top is the phone's own and takes no
   instruction from us. tokens.css also declares color-scheme, but an
   installed app can outlive a token change, so the app states it too. */
export function syncColorScheme() {
  document.documentElement.style.colorScheme = darkNow() ? "dark" : "light";
}

export function applyPalette(palette) {
  const root = document.documentElement;
  if (palette && palette !== "cobalt") root.setAttribute("data-palette", palette);
  else root.removeAttribute("data-palette");
  syncColorScheme();
}

export function initTheme() {
  applyPalette(store.state.settings.palette);
  /* The OS can flip while the app is open, and an installed PWA is often
     open for days. Without this the app keeps the scheme it booted with. */
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncColorScheme);
}

/* Each palette's accent, for the swatches in Settings.

   Read from tokens.css rather than hardcoded here: a second copy of six hex
   values is a second thing to keep in step, and it would drift the first time
   a palette is retuned in the hub. Same trick Spoon uses - set the attribute,
   read the resolved value, put it back - and it has to restore exactly what
   was there, including "nothing". Cached because it forces a style
   recalculation per palette and the answer cannot change at runtime. */
let accentCache = null;
export function paletteAccents() {
  if (accentCache) return accentCache;
  const root = document.documentElement;
  const prev = root.getAttribute("data-palette");
  const out = {};
  for (const id of Object.keys(PALETTES)) {
    if (id === "cobalt") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", id);
    out[id] = getComputedStyle(root).getPropertyValue("--accent").trim();
  }
  if (prev === null) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", prev);
  accentCache = out;
  return out;
}

/* Did the inline #theme-preload script in index.html actually run? If the CSP
   hash stops matching, that script is blocked SILENTLY - the only symptom
   would be a flash of the wrong palette on load. It stamps data-theme-boot
   before doing anything else, so its absence is the tell, and Settings says
   so out loud rather than leaving it to be noticed. */
export function themeBootRan() {
  return document.documentElement.dataset.themeBoot === "1";
}
