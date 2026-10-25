/* Compass: tickets kept on the phone (stage 4).

   The hub sweep copies the ticket of every future event into the private
   repo (calendar/data/compass/tickets/): the original as <id>.<ext> and one
   PNG per page as <id>-p<N>.png, and records a pointer on the event:
   tickets: [{ id, name, ext, pages }]. On every sync with signal this module
   downloads what the phone is missing into Cache Storage ("compass-tickets",
   separate from the shell cache) and deletes what no future event refers to
   any more, so the cache never outgrows the coming events.

   The decisions (which files are wanted, what to fetch, what to delete) are
   pure and tested; Cache Storage and github.js are passed in. */
"use strict";

import { daysOf, todayKey } from "./dates.js";
import { escapeHtml as esc } from "./util.js";
import { ICON } from "./chrome-icons.js";

export const REPO_DIR = "calendar/data/compass/tickets";
export const CACHE_NAME = "compass-tickets";
const EXTS = ["pdf", "png", "jpg", "pkpass"];
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", pkpass: "application/vnd.apple.pkpass" };
const MAX_PAGES = 6;
const DRIVE = "https://drive.google.com/";

/* A wallet pass (.pkpass) is stored as the original only: no page images. */
export const isPass = (t) => t.pages === 0;
export const PASS_NOTE = "This ticket is a wallet pass. Use Send a copy.";

export const mimeOf = (ext) => MIME[ext] || "application/octet-stream";

/* The event's stored tickets, minus anything malformed (ids and extensions
   end up in URLs and paths, so they are checked, not trusted). */
export function ticketsOf(e) {
  const list = e && !e.deleted && Array.isArray(e.tickets) ? e.tickets : [];
  return list.filter((t) => t && typeof t.id === "string" && /^[0-9a-f]{16}$/.test(t.id)
    && EXTS.includes(t.ext) && Number.isInteger(t.pages) && t.pages >= 0 && t.pages <= MAX_PAGES);
}

/* The Drive link of the event's ticket, the "Open in Drive" target. */
export const driveTicketLink = (e) => (e.links || []).find((l) => l && typeof l.label === "string"
  && l.label.startsWith("Ticket") && typeof l.url === "string" && l.url.startsWith(DRIVE)) || null;

/* Cache keys are relative paths; ticketUrl(id, page) is a page image. */
export const ticketUrl = (id, page) => `tickets/${id}-p${page}.png`;
export const originalUrl = (t) => `tickets/${t.id}.${t.ext}`;
export const repoPath = (key) => `${REPO_DIR}/${key.slice("tickets/".length)}`;

/* Every file of one ticket: its pages first (what the viewer shows), then the
   original (what Send a copy shares). */
export function filesOf(t) {
  const out = [];
  for (let p = 1; p <= t.pages; p++) out.push(ticketUrl(t.id, p));
  out.push(originalUrl(t));
  return out;
}

export const lastDayOf = (e) => { const d = daysOf(e); return d.length ? d[d.length - 1] : e.start; };

/* Files the phone should hold: every ticket of every live event whose last
   day is today or later. */
export function wantedKeys(events, today) {
  const out = new Set();
  (events || []).forEach((e) => {
    if (!e || e.deleted || !e.start || lastDayOf(e) < today) return;
    ticketsOf(e).forEach((t) => filesOf(t).forEach((k) => out.add(k)));
  });
  return out;
}

/* What to download (wanted and missing, in wanted order) and what to delete
   (held, but nobody wants it). Only keys under tickets/ are ever deleted. */
export function planSync(wanted, cached) {
  const have = new Set(cached);
  return {
    fetch: [...wanted].filter((k) => !have.has(k)),
    remove: [...have].filter((k) => k.startsWith("tickets/") && !wanted.has(k)),
  };
}

/* ---- Cache Storage, behind a tiny interface so tests can pass a fake ---- */
export async function openStore() {
  try {
    const c = await caches.open(CACHE_NAME);
    return {
      async keys() { return (await c.keys()).map((r) => { const u = new URL(r.url); return u.pathname.slice(u.pathname.indexOf("tickets/")); }); },
      async get(key) { const r = await c.match(key); return r ? r.blob() : null; },
      async put(key, blob, type) { await c.put(key, new Response(blob, { headers: { "Content-Type": type || blob.type || "application/octet-stream" } })); },
      async remove(key) { await c.delete(key); },
    };
  } catch { return null; }
}

const typeOfKey = (key) => mimeOf(key.slice(key.lastIndexOf(".") + 1));

/* Sync: download what is missing, delete what is not wanted. A network
   problem (offline, token, rate limit) stops the run quietly and the next
   sync carries on; a file the repo does not have yet is skipped. Call it
   only after a successful sync, so an empty event list can never be mistaken
   for "no future events" and empty the cache. */
export async function syncTickets({ events, today = todayKey(), gh, store }) {
  const res = { fetched: 0, removed: 0, stopped: "" };
  if (!store) return res;
  let cached;
  try { cached = await store.keys(); } catch { return res; }
  const plan = planSync(wantedKeys(events, today), cached);
  for (const key of plan.remove) {
    try { await store.remove(key); res.removed++; } catch { /* next time */ }
  }
  for (const key of plan.fetch) {
    try {
      await store.put(key, await gh.getRaw(repoPath(key)), typeOfKey(key));
      res.fetched++;
    } catch (e) {
      if (e && e.gh === "notFound") continue;
      if (e && ["offline", "unauthorized", "rateLimited"].includes(e.gh)) { res.stopped = e.gh; break; }
      if (!e || !e.gh) { res.stopped = "cache"; break; } // the phone refused to store it
    }
  }
  return res;
}

/* Everything the viewer needs for one ticket: the page blobs from the phone,
   falling back to the repo (and keeping what it gets) when the phone lacks
   them. { pages: [Blob], original: Blob|null } or null when it is not on the
   phone and cannot be fetched. */
export async function readTicket(t, { gh, store }) {
  const grab = async (key) => {
    try { const b = store && await store.get(key); if (b) return b; } catch { /* fall through */ }
    try {
      const b = await gh.getRaw(repoPath(key));
      if (store) { try { await store.put(key, b, typeOfKey(key)); } catch { /* shown anyway */ } }
      return new Blob([b], { type: typeOfKey(key) });
    } catch { return null; }
  };
  /* a wallet pass has no pages: its original is the ticket, so it must be
     on the phone for "opens" to be true */
  if (t.pages === 0) {
    const o = await grab(originalUrl(t));
    return o ? { pages: [], original: o } : null;
  }
  const pages = [];
  for (let p = 1; p <= t.pages; p++) {
    const b = await grab(ticketUrl(t.id, p));
    if (!b) return null;
    pages.push(b);
  }
  let original = null;
  try { original = store && await store.get(originalUrl(t)); } catch { /* fetched on demand by Send a copy */ }
  return { pages, original: original || null };
}

/* A name for the shared / downloaded copy: the pointer's name with the
   punctuation gone ("Ticket, RA" -> "Ticket RA.pdf"). */
export const fileNameOf = (t) => `${String(t.name || "Ticket").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Ticket"}.${t.ext}`;

/* One sync entry point for the app: open the phone's store and run it. */
export async function keepTickets(events, gh) {
  return syncTickets({ events, gh, store: await openStore() });
}

/* The event's links, split for the screens: its stored tickets, and the
   links left over (every Drive ticket link is dropped from `links` when a
   phone copy exists, and handed back in `drives` for the event page). */
export function splitLinks(e) {
  const tickets = ticketsOf(e);
  const isDrive = (l) => l && typeof l.label === "string" && l.label.startsWith("Ticket") && typeof l.url === "string" && l.url.startsWith(DRIVE);
  const drives = tickets.length ? (e.links || []).filter(isDrive) : [];
  return { tickets, drives, links: (e.links || []).filter((l) => !drives.includes(l)) };
}

/* A tappable line for one stored ticket; ticket-view.js catches the tap. */
export const ticketButton = (e, t, cls, inner, label = "") =>
  `<button type="button" class="${cls}"${label ? ` aria-label="${esc(label)}"` : ""} data-tk="${esc(e.id)}" data-tid="${esc(t.id)}">${inner}</button>`;
export const dayTicketLine = (e, t) => ticketButton(e, t, "dlink",
  `<span aria-hidden="true">🎟</span><span class="dlt">${esc(t.name || "Ticket")}</span>${ICON.chev}`);
