/* Compass: the small shared helpers. One copy of each, on purpose.

   escapeHtml and safeUrl are not conveniences, they are the whole XSS
   defence. The GitHub token sits in localStorage in plain text on a static
   origin, so anything that can run script here can read it and write to the
   hub repo. Every synced string goes through escapeHtml; every URL goes
   through safeUrl. There is no eval, no new Function, no document.write and
   no insertAdjacentHTML anywhere in this app. */
"use strict";

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

/* escapeHtml is not enough in an href. A URL scheme has no characters for it
   to escape, so `javascript:...` used to come straight through a template
   literal in Spoon and become a live link on its own origin. Anything that is
   not an absolute http(s) URL is dropped rather than rendered. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u), location.href);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
  } catch { return ""; }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Bare obj.hasOwnProperty(k) throws on an object with a "hasOwnProperty" key,
   and in Spoon that crash landed inside a render and persisted, so the app
   came back broken on every load. Cheap to just never call it directly. */
export function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
