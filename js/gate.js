/* Compass: the first-run gate. The hub site's own pattern, so all three
   household apps open the same way: the wordmark, one masked pill field and
   a round arrow button. No labels, no placeholder, no error text; a token
   that cannot read Compass's data just clears the field. After a fresh
   token, two one-tap steps in the same look: who, then which theme.

   Nothing else of the app draws while the gate is up (render.js asks
   gateStep() first). The Settings token field stays for replacing a token;
   clearing it there brings the gate back. */
"use strict";

import { escapeHtml } from "./util.js";
import { store } from "./store.js";
import { probeToken } from "./sync.js";
import { PALETTES, applyPalette, SEED_HEX } from "./theme.js";
import { ms } from "./chrome-icons.js";

/* true between a fresh token and the theme pick, this session only */
let fresh = false;

export function gateStep() {
  const s = store.state.settings;
  if (!s.token) return "token";
  if (!s.me) return "who";
  return fresh ? "theme" : null;
}

/* The gate is a Material dialog over a scrim. The wordmark is the dialog's
   headline; there are still no labels, no placeholder and no error text. */
const dialog = (inner) => '<div class="m3-scrim" aria-hidden="true"></div>'
  + '<div class="m3-dialog m3-dialog--basic gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle">'
  + `<h2 class="m3-headline-s" id="gateTitle">Compass</h2>${inner}</div>`;

export function gateHtml(step) {
  if (step === "token") {
    return dialog('<label class="m3-field"><input class="m3-field__input" id="gateToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Access" data-1p-ignore data-lpignore="true"></label>'
      + `<div class="m3-dialog__actions"><button type="button" class="m3-btn m3-btn--filled" id="gateGo" aria-label="Connect">${ms("arrow_forward")}</button></div>`);
  }
  if (step === "who") {
    return dialog('<div class="gate-actions">'
      + '<button type="button" class="m3-btn m3-btn--tonal setup-choice" data-gate-me="isa">Isa</button>'
      + '<button type="button" class="m3-btn m3-btn--tonal setup-choice" data-gate-me="hugo">Hugo</button></div>');
  }
  /* the swatch colours are the five seed identities (SEED_HEX) */
  return dialog(`<div class="m3-swatch-row">${Object.entries(PALETTES).map(([id, name]) =>
    `<button type="button" class="m3-swatch setup-swatch" data-gate-palette="${escapeHtml(id)}" aria-label="${escapeHtml(name)}" style="background:${escapeHtml(SEED_HEX[id] || "")}"></button>`).join("")}</div>`);
}

/* Wires the gate just drawn. onToken runs once a token is saved. */
export function bindGate(root, { onToken }) {
  const input = root.querySelector("#gateToken");
  if (input) {
    let busy = false;
    const submit = async () => {
      const candidate = input.value.trim();
      input.value = "";
      if (!candidate || busy) return;
      busy = true;
      const r = await probeToken(candidate);
      busy = false;
      if (!r.ok) { input.focus(); return; }
      fresh = true;
      store.setSetting("token", candidate);
      onToken();
    };
    root.querySelector("#gateGo").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    input.focus();
  }
  root.querySelectorAll("[data-gate-me]").forEach((b) =>
    b.addEventListener("click", () => store.setSetting("me", b.dataset.gateMe)));
  root.querySelectorAll("[data-gate-palette]").forEach((b) =>
    b.addEventListener("click", () => {
      fresh = false;
      applyPalette(b.dataset.gatePalette);
      store.setSetting("palette", b.dataset.gatePalette);
    }));
  const first = root.querySelector(".setup-choice, .setup-swatch");
  if (first) first.focus();
}
