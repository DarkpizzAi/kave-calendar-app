/* Compass: palette and colour-scheme handling.

   The token values are NOT here. They live in m3/kave-m3-tokens.css, generated from
   brand/data/kave-m3-tokens.css in kave-hub. This module only decides
   which palette is selected and keeps the browser's colour-scheme in step.

   Light or dark follows the OS and nothing else. There is deliberately no
   in-app override: [data-theme] exists in the tokens file as an internal
   read mechanism, not as a user setting. */
"use strict";

import { store } from "./store.js";

/* seed id -> display name. Must stay in step with the [data-seed] blocks in
   m3/kave-m3-tokens.css (blue is the bare :root). #theme-preload in index.html
   repeats the id list and the legacy map (it runs before modules load);
   change both, then recompute its hash. */
export const PALETTES = {
  blue: "Blue",
  teal: "Teal",
  yellow: "Yellow",
  periwinkle: "Periwinkle",
  terracotta: "Terracotta",
};
/* The seed colour of each palette, shown as its swatch (an identity, not a
   theme colour: the same five hexes the kit's seeds are built from). */
export const SEED_HEX = { blue: "#4285f4", teal: "#009688", yellow: "#ffc107", periwinkle: "#5c6bc0", terracotta: "#c05c46" };
/* A palette stored before Material 3 maps across: cobalt and chartreuse become
   blue, amber becomes yellow. Anything unknown is blue. */
const LEGACY = { cobalt: "blue", amber: "yellow", chartreuse: "blue" };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export function toSeed(id) {
  if (has(PALETTES, id)) return id;
  return has(LEGACY, id) ? LEGACY[id] : "blue";
}

export function darkNow() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/* Tell the browser which way the page leans. This is what darkens the Android
   gesture bar; the status bar at the top is the phone's own and takes no
   instruction from us. the kit tokens also declare color-scheme, but an
   installed app can outlive a token change, so the app states it too. */
export function syncColorScheme() {
  document.documentElement.style.colorScheme = darkNow() ? "dark" : "light";
}

export function applyPalette(palette) {
  document.documentElement.setAttribute("data-seed", toSeed(palette));
  syncColorScheme();
}

export function initTheme() {
  applyPalette(store.state.settings.palette);
  /* The OS can flip while the app is open, and an installed PWA is often
     open for days. Without this the app keeps the scheme it booted with. */
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncColorScheme);
}

/* Each seed's accent (--md-sys-color-primary), for the swatches in Settings.

   Read from the kit's tokens rather than hardcoded here: a second copy of the hex
   values is a second thing to keep in step, and it would drift the first time
   a palette is retuned in the hub. Same trick Spoon uses - set the attribute,
   read the resolved value, put it back - and it has to restore exactly what
   was there, including "nothing". Cached because it forces a style
   recalculation per palette and the answer cannot change at runtime. */
let accentCache = null;
let softs = {};
/* Each seed's primary container, read in the same pass as its accent. */
export function paletteSofts() { paletteAccents(); return softs; }

export function paletteAccents() {
  if (accentCache) return accentCache;
  const root = document.documentElement;
  const prev = root.getAttribute("data-seed");
  const out = {};
  softs = {};
  for (const id of Object.keys(PALETTES)) {
    root.setAttribute("data-seed", id);
    const cs = getComputedStyle(root);
    out[id] = cs.getPropertyValue("--md-sys-color-primary").trim();
    softs[id] = cs.getPropertyValue("--md-sys-color-primary-container").trim();
  }
  if (prev === null) root.removeAttribute("data-seed");
  else root.setAttribute("data-seed", prev);
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
