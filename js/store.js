/* Compass: persisted state.

   State lives in three places by lifetime, the household convention:
     1. store.state      persisted, mirrored to localStorage on every
                         mutation, and the only thing render() reads
     2. module-level     transient UI state (which tab, a scroll position).
                         Not persisted, not on store; its handlers call the
                         relevant renderX() directly rather than notify()
     3. locals           derived values, computed where they are used

   Namespace is compass.*, not foodapp.* - the two apps are separate origins
   so they could not collide anyway, but a named prefix makes a storage
   inspector readable. */
"use strict";

export const LS_SETTINGS = "compass.settings";
export const LS_SYNC = "compass.sync";   // { etags, syncedAt } once there is data to sync

const DEFAULTS = {
  token: "",
  palette: "cobalt",
  /* theme is not a user choice. Light and dark follow the OS and nothing
     else, which is the household rule. Kept here only so the shape matches
     Spoon's and a future migration has something to read. */
  theme: "system",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    /* private window, blocked storage, or corrupt JSON. A broken settings
       blob must not take the whole app down: start from defaults. */
    return { ...fallback };
  }
}

export const store = {
  state: {
    settings: read(LS_SETTINGS, DEFAULTS),
    sync: read(LS_SYNC, { syncedAt: 0 }),
  },
  listeners: [],

  subscribe(fn) { this.listeners.push(fn); },
  notify() { for (const fn of this.listeners) fn(); },

  persist(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* quota or blocked storage: the app still works this session */ }
  },

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.persist(LS_SETTINGS, this.state.settings);
    this.notify();
  },

  hasToken() { return !!this.state.settings.token; },
};
