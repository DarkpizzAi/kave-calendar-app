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

const IS_LOCAL_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);

// { kind: "idle"|"checking"|"installing"|"ready"|"current"|"error"|"unsupported", version, checkedAt }
export let updateState = { kind: "idle", version: null, checkedAt: null };

/* Ask the controlling worker which VERSION it is running. */
function swVersion() {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
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

/* Ask the registration to re-fetch the worker script and report honestly
   what came back; onChange() re-renders after each state move (same shape
   as render.js's own dataSync: a plain object mutated, then render() called
   by whoever changed it). */
export async function checkForUpdate(onChange) {
  if (!("serviceWorker" in navigator) || IS_LOCAL_DEV) {
    updateState = { ...updateState, kind: "unsupported" };
    onChange();
    return;
  }
  updateState = { ...updateState, kind: "checking" };
  onChange();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { updateState = { ...updateState, kind: "unsupported" }; onChange(); return; }
    await reg.update();
    const incoming = reg.installing || reg.waiting;
    if (!incoming) {
      updateState = { kind: "current", version: await swVersion(), checkedAt: Date.now() };
      onChange();
      return;
    }
    updateState = { ...updateState, kind: "installing" };
    onChange();
    const state = await whenSettled(incoming);
    // install() calls skipWaiting, but nudge a worker the browser held back
    if (state === "installed") incoming.postMessage({ type: "skipWaiting" });
    updateState = { ...updateState, kind: "ready", checkedAt: Date.now() };
    onChange();
  } catch {
    updateState = { ...updateState, kind: "error", checkedAt: Date.now() };
    onChange();
  }
}

let versionAsked = false;
/* Fills updateState.version in the background, once, the first time
   Settings' Advanced fold is open; onChange() re-renders when it lands. */
export function ensureVersionAsked(onChange) {
  if (versionAsked || updateState.version || IS_LOCAL_DEV) return;
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
  else if (updateState.kind === "unsupported" || IS_LOCAL_DEV) lines.push(["muted", "Updates apply on reload here"]);
  else if (!updateState.checkedAt) lines.push(["muted", "Not checked yet"]);
  if (updateState.kind !== "ready" && updateState.checkedAt) {
    const ago = timeAgo(updateState.checkedAt);
    if (ago) lines.push(["muted", `Checked ${ago}`]);
  }
  return lines;
}

export const updateBusy = () => updateState.kind === "checking" || updateState.kind === "installing";
export const updateReady = () => updateState.kind === "ready";
export const updateButtonText = () => (updateReady() ? "Restart to finish" : "Check for updates");
