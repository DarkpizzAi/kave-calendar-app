/* Compass: the ticket viewer (stage 4, spec 6.3). A level of the one sheet:
   the ticket's pages full width and scrollable, pinch to zoom (nothing here
   blocks touch gestures), Close and Send a copy in the bar. The screen is
   kept awake while it is open, so a QR code does not dim at the gate.

   The pages come from the phone (Cache Storage, kept by tickets.js), so this
   works with no signal and no Google sign-in. A ticket the phone does not
   hold yet is fetched if there is signal; otherwise it says so plainly. */
"use strict";

import { escapeHtml as esc } from "./util.js";
import { github } from "../github.js";
import { registerLevel, openLevel, back, topLevel, refreshSheet } from "./sheet.js";
import { ticketsOf, readTicket, openStore, originalUrl, repoPath, mimeOf, fileNameOf, PASS_NOTE } from "./tickets.js";

export const NOT_ON_PHONE = "This ticket is not on this phone yet; open Compass once with signal.";

let ctx = null;
let cur = null;      // { t, status: "loading" | "ready" | "missing", urls, original }
let lock = null;     // the screen wake lock while the viewer is open

function release() {
  if (cur) { (cur.urls || []).forEach((u) => URL.revokeObjectURL(u)); cur = null; }
  if (lock) { try { lock.release(); } catch { /* already gone */ } lock = null; }
}

async function keepAwake() {
  try {
    if (lock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    const got = await navigator.wakeLock.request("screen");
    /* the viewer was closed while the request was pending: let it go at once */
    if (!cur) { got.release(); return; }
    lock = got;
    lock.addEventListener("release", () => { lock = null; });
  } catch { /* unsupported or refused: the screen may dim, the ticket still opens */ }
}

/* Open one of an event's stored tickets (the first when tid is not given). */
export async function openTicket(eventId, tid) {
  const e = ctx.data.events().find((x) => x.id === eventId);
  const list = e ? ticketsOf(e) : [];
  const t = list.find((x) => x.id === tid) || list[0];
  if (!t) return;
  release();
  const mine = cur = { t, status: "loading", urls: [], original: null };
  openLevel({ kind: "ticket", id: t.id });
  keepAwake();
  const got = await readTicket(t, { gh: github, store: await openStore() });
  if (cur !== mine) return; // closed (or another ticket opened) meanwhile
  if (got) {
    mine.status = "ready";
    mine.original = got.original;
    mine.urls = got.pages.map((b) => URL.createObjectURL(b));
  } else mine.status = "missing";
  const top = topLevel();
  if (top && top.kind === "ticket") refreshSheet();
}

function body() {
  if (!cur) return `<p class="hint pad">${esc(NOT_ON_PHONE)}</p>`;
  if (cur.status === "loading") return '<p class="hint pad">Opening the ticket...</p>';
  if (cur.status === "missing") return `<p class="hint pad">${esc(NOT_ON_PHONE)}</p>`;
  if (!cur.urls.length) return `<p class="hint pad">${esc(PASS_NOTE)}</p>`;
  return `<div class="tkv">${cur.urls.map((u, i) =>
    `<img src="${esc(u)}" alt="${esc(cur.t.name || "Ticket")}, page ${i + 1} of ${cur.urls.length}">`).join("")}</div>`;
}

/* The original file, from the phone or (with signal) from the repo. */
async function originalBlob() {
  if (cur.original) return cur.original;
  const store = await openStore();
  try { const b = store && await store.get(originalUrl(cur.t)); if (b) return (cur.original = b); } catch { /* fetch it */ }
  const b = await github.getRaw(repoPath(originalUrl(cur.t)));
  const blob = new Blob([b], { type: mimeOf(cur.t.ext) });
  if (store) { try { await store.put(originalUrl(cur.t), blob, mimeOf(cur.t.ext)); } catch { /* shared anyway */ } }
  return (cur.original = blob);
}

async function sendCopy() {
  const mine = cur;
  if (!mine) return;
  let blob;
  try { blob = await originalBlob(); }
  catch { ctx.banner("The file is not on this phone yet. Open Compass once with signal."); return; }
  const type = mimeOf(mine.t.ext), name = fileNameOf(mine.t);
  const file = new File([blob], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (err) { if (err && err.name === "AbortError") return; /* else fall back to a download */ }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function initTicketView(c) {
  ctx = c;
  registerLevel("ticket", {
    title: () => (cur && cur.t.name) || "Ticket",
    body,
    bar: () => '<button class="act-btn" data-tk-act="send">Send a copy</button><button class="act-btn primary" data-tk-act="close">Close</button>',
    onAction: (b) => {
      if (b.dataset.tkAct === "send") sendCopy();
      else if (b.dataset.tkAct === "close") back();
    },
  });
  const root = document.getElementById("sheetRoot");
  /* A tap on a ticket line (Day, event page, history) opens the viewer. It
     is caught before the sheet's own handler, because a Day line sits inside
     a strip that would otherwise open the event. */
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tk]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openTicket(b.dataset.tk, b.dataset.tid);
  }, true);
  /* Leaving the viewer by any road (Back, swipe, Escape) lets the screen sleep. */
  window.addEventListener("popstate", () => setTimeout(() => {
    const top = topLevel();
    if (cur && !(top && top.kind === "ticket")) release();
  }, 0));
  /* a hidden page loses its wake lock: take it again on return */
  document.addEventListener("visibilitychange", () => { if (cur && document.visibilityState === "visible") keepAwake(); });
}
