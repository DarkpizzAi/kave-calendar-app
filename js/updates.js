/* Compass: "Check for updates" and the version line (spec section 3,
   Advanced settings, "About (version...)"). F19: Compass had neither; this
   ports Spoon's mechanism (kave-food-app js/view-settings.js's
   checkForUpdate, updateState, swVersion, whenSettled) rather than inventing
   a new one.

   Spoon owns its DOM directly (renderUpdateStatus() writes into #updateStatus
   and #updateBtn on every state change). Compass instead rebuilds its whole
   Settings subtree from a string on every render() (render.js), so this
   module stays UI-free: it holds updateState and pure-ish helpers that turn
   it into text; render.js is the only thing that writes markup. */
"use strict";

import { showSnackbar } from "../m3/kave-m3.js";

const IS_LOCAL_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);

// { kind: "idle"|"checking"|"installing"|"ready"|"current"|"error"|"unsupported", version, checkedAt, reason }
export let updateState = { kind: "idle", version: null, checkedAt: null, reason: null };

/* Ask the controlling worker which VERSION it is running. */
function swVersion() {
  return new Promise((resolve) => {
    const s = deps.sw(), sw = s && s.controller;
    if (!sw) return resolve(null);
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve((e.data && e.data.version) || null); };
    try { sw.postMessage({ type: "version" }, [ch.port2]); }
    catch { clearTimeout(t); resolve(null); }
  });
}

/* Resolves when an incoming worker finishes installing, rejects if it fails. */
function whenSettled(worker) {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (worker.state === "activated") resolve("activated");
      else if (worker.state === "installed") resolve("installed");
      else if (worker.state === "redundant") reject(new Error("install failed"));
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/* What the update flow touches outside this file, replaceable so a test can
   stand in for the service worker (the preview pane refuses real ones). */
export const deps = {
  sw: () => (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined),
  reload: () => location.reload(),
  host: () => document.getElementById("snackHost") || document.body,
  later: (fn, ms) => setTimeout(fn, ms),
  localDev: () => IS_LOCAL_DEV,
};

/* The update snackbar: sticky, one per update. Restart tells a worker that is
   still waiting to take over (the message service-worker.js listens for is
   { type: "skipWaiting" }), then reloads on controllerchange, once, with a
   fallback timer so a worker that never takes over cannot strand the button.
   The current worker calls skipWaiting itself on install, so usually nothing
   is waiting by then and Restart is just the reload. */
let restarting = false;
export async function restartForUpdate() {
  if (restarting) return;
  restarting = true;
  let reloaded = false;
  const reload = () => { if (reloaded) return; reloaded = true; deps.reload(); };
  try {
    const sw = deps.sw();
    const reg = sw ? await sw.getRegistration() : null;
    if (reg && reg.waiting) {
      sw.addEventListener("controllerchange", reload, { once: true });
      reg.waiting.postMessage({ type: "skipWaiting" });
      deps.later(reload, 4000);
      return;
    }
  } catch { /* fall through to a plain reload */ }
  reload();
}

/* One update, one snackbar, and it outlives other snackbars. The kit shows a
   single snackbar at a time, so a Synced or Undo one would silently replace
   this; a watcher on the host puts it back whenever the host goes empty while
   the update is still unanswered. A tap on its Restart or dismiss answers it. */
export const UPDATE_TEXT = "A new version is ready";
let updatePending = false;
let watchedHost = null, watcher = null;
export const updateIsPending = () => updatePending;
/* tests only: forget a previous update flow */
export function resetUpdateFlow() { updatePending = false; restarting = false; watchedHost = null; if (watcher) watcher.disconnect(); watcher = null; }

function showUpdateSnack() {
  showSnackbar(deps.host(), { text: UPDATE_TEXT, action: "Restart", ms: 0, onAction: () => { restartForUpdate(); } });
}

export function offerUpdate() {
  if (updatePending) return;
  updatePending = true;
  const host = deps.host();
  if (host && watchedHost !== host) {
    watchedHost = host;
    if (watcher) watcher.disconnect();
    host.addEventListener("click", (e) => {
      const s = e.target.closest && e.target.closest(".m3-snackbar");
      if (s && s.textContent.startsWith(UPDATE_TEXT)) updatePending = false;
    }, true);
    watcher = new MutationObserver(() => {
      if (updatePending && !host.querySelector(".m3-snackbar")) showUpdateSnack();
    });
    watcher.observe(host, { childList: true });
  }
  showUpdateSnack();
}

/* Wired once at boot with the registration: a worker already waiting when the
   page opens and one that finishes installing later. A first install, with no
   controller yet, never offers anything. */
export function watchRegistration(reg) {
  const sw = deps.sw();
  if (!sw) return;
  if (reg.waiting && sw.controller) offerUpdate();
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener("statechange", () => { if (w.state === "installed" && sw.controller) offerUpdate(); });
  });
}

/* Registered synchronously at boot, before the worker registers: the first
   controllerchange is this session's own install taking over, not an update;
   any later one is a new worker that has already taken over. */
export function watchTakeover() {
  const sw = deps.sw();
  if (!sw) return;
  let firstControl = !sw.controller;
  sw.addEventListener("controllerchange", () => {
    if (firstControl) { firstControl = false; return; }
    offerUpdate();
  });
}

/* Ask the registration to re-fetch the worker script and report honestly
   what came back; onChange() re-renders after each state move (same shape
   as render.js's own dataSync: a plain object mutated, then render() called
   by whoever changed it). */
export async function checkForUpdate(onChange) {
  if (!deps.sw()) {
    updateState = { ...updateState, kind: "unsupported", reason: "no-api" };
    onChange();
    return;
  }
  if (deps.localDev()) {
    updateState = { ...updateState, kind: "unsupported", reason: "local-dev" };
    onChange();
    return;
  }
  updateState = { ...updateState, kind: "checking" };
  onChange();
  try {
    const reg = await deps.sw().getRegistration();
    if (!reg) { updateState = { ...updateState, kind: "unsupported", reason: "no-registration" }; onChange(); return; }
    await reg.update();
    const incoming = reg.installing || reg.waiting;
    /* an update found earlier this session and not restarted yet counts: its
       worker has usually taken over already (skipWaiting), so nothing is
       installing now, but the page on screen is still the old shell */
    if (!incoming && !updatePending) {
      updateState = { kind: "current", version: await swVersion(), checkedAt: Date.now() };
      onChange();
      return;
    }
    if (!incoming) {
      updateState = { ...updateState, kind: "ready", checkedAt: Date.now() };
      onChange();
      offerUpdate();
      return;
    }
    updateState = { ...updateState, kind: "installing" };
    onChange();
    const state = await whenSettled(incoming);
    // install() calls skipWaiting, but nudge a worker the browser held back
    if (state === "installed") incoming.postMessage({ type: "skipWaiting" });
    updateState = { ...updateState, kind: "ready", checkedAt: Date.now() };
    onChange();
    offerUpdate();
  } catch {
    updateState = { ...updateState, kind: "error", checkedAt: Date.now() };
    onChange();
  }
}

let versionAsked = false;
/* Fills updateState.version in the background, once, the first time
   Settings' Advanced fold is open; onChange() re-renders when it lands. */
export function ensureVersionAsked(onChange) {
  if (versionAsked || updateState.version || deps.localDev()) return;
  versionAsked = true;
  swVersion().then((v) => { if (v) { updateState = { ...updateState, version: v }; onChange(); } });
}

function timeAgo(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/* [kind, text] lines for render.js to escape and draw; it owns the markup,
   same split as dataSync/syncLine already use. */
export function updateStatusLines() {
  const lines = [];
  if (updateState.version) lines.push(["muted", `Version ${updateState.version}`]);
  if (updateState.kind === "checking") lines.push(["muted", "Checking..."]);
  else if (updateState.kind === "installing") lines.push(["muted", "New version found, downloading..."]);
  else if (updateState.kind === "ready") lines.push(["ok", "New version ready"]);
  else if (updateState.kind === "current") lines.push(["ok", "Up to date"]);
  else if (updateState.kind === "error") lines.push(["error", "Check failed. Try again when you have signal."]);
  else if (updateState.kind === "unsupported" && updateState.reason === "no-api") lines.push(["muted", "This browser has no update mechanism"]);
  else if (updateState.kind === "unsupported" && updateState.reason === "no-registration") lines.push(["error", "No service worker found. Try closing and reopening the app."]);
  else if (updateState.kind === "unsupported" || deps.localDev()) lines.push(["muted", "Updates apply on reload here"]);
  else if (!updateState.checkedAt) lines.push(["muted", "Not checked yet"]);
  if (updateState.kind !== "ready" && updateState.checkedAt) {
    const ago = timeAgo(updateState.checkedAt);
    if (ago) lines.push(["muted", `Checked ${ago}`]);
  }
  return lines;
}

export const updateBusy = () => updateState.kind === "checking" || updateState.kind === "installing";
export const updateReady = () => updateState.kind === "ready";
export const updateButtonText = () => (updateReady() ? "Restart" : "Check for updates");
