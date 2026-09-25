/* Compass: the event record. Pure functions; every write goes through touch
   so sync always knows who changed what and when. An event always has an
   exact day: anything looser is an idea, and ideas live on Radar (B). */
"use strict";

import { isValidDate, precision, compareDates } from "./dates.js";
import { uid, safeUrl } from "./util.js";

export const STATUSES = ["idea", "planned", "booked", "done", "cancelled"];
export const STATUS_LABEL = { idea: "Idea", planned: "Planned", booked: "Booked", done: "Done", cancelled: "Cancelled" };
export const PEOPLE = ["isa", "hugo"];
export const OWNERS = ["isa", "hugo", "shared"];

/* An optional time of day, "HH:MM" (round 2). */
export const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function validateEvent(e) {
  const errors = [];
  for (const k of ["startTime", "endTime"]) if (e[k] && !isTime(e[k])) errors.push(k + " must be HH:MM");
  if (!e.title || !String(e.title).trim()) errors.push("title is required");
  if (!isValidDate(e.start)) errors.push("date is not valid");
  else if (precision(e.start) !== "day") errors.push("an event needs an exact day; without one it is an idea");
  else if (e.end) {
    if (!isValidDate(e.end) || precision(e.end) !== "day") errors.push("end must be an exact day");
    else if (compareDates(e.end, e.start) < 0) errors.push("end is before start");
  }
  if ((e.activities || []).some((a) => !a || !a.type)) errors.push("every activity needs a category");
  return errors;
}

export function touch(e, me, now) {
  return { ...e, updated: { at: now.toISOString(), by: me } };
}

export function mainType(e) {
  return (e.activities && e.activities[0] && e.activities[0].type) || "none";
}

export function addLink(e, { label, url, ...rest }) {
  const safe = safeUrl(url);
  if (!safe || (e.links || []).some((l) => l.url === safe)) return e;
  return { ...e, links: [...(e.links || []), { label: String(label || "").trim() || "Link", url: safe, ...rest }] };
}

export function newEvent(fields, { me, now }) {
  if (!PEOPLE.includes(me)) throw new Error("who am I is not set");
  const e = {
    id: "ev_" + uid(),
    title: String(fields.title || "").trim(),
    owner: fields.owner || me,
    start: fields.start, end: fields.end || null,
    startTime: fields.startTime || "", endTime: fields.endTime || "",
    status: fields.status || "planned",
    activities: fields.activities || [],
    city: fields.city || "", venue: fields.venue || "",
    bookingRefs: fields.bookingRefs || [], links: [],
    guests: fields.guests || "", notes: fields.notes || "",
    checklist: fields.checklist || [], costs: fields.costs || [],
    trip: null, tripHint: null,
    source: { kind: "app" },
    deleted: false, deletedAt: null, restoredAt: null,
  };
  const errors = validateEvent(e);
  if (errors.length) throw new Error(errors.join(", "));
  const withLinks = (fields.links || []).reduce(addLink, e);
  return touch(withLinks, me, now);
}

export function yearOf(e) { return e.start.slice(0, 4); }

export function markDeleted(e, me, now) {
  return touch({ ...e, deleted: true, deletedAt: now.toISOString() }, me, now);
}

export function restore(e, me, now) {
  return touch({ ...e, deleted: false, restoredAt: now.toISOString() }, me, now);
}

/* The file writes one save needs. An event lives in the file of its start
   year; moving it to another year writes it there and leaves a marker in
   the old file, so the old file cannot bring it back on the next merge. */
export function writesFor(prev, next) {
  /* A moved event is restored in the year it arrives in: coming back to a
     year it once left, it must beat the "moved away" marker there, or it
     would vanish from both files (final review C1). */
  const moving = prev && yearOf(prev) !== yearOf(next);
  const writes = [{ year: yearOf(next), record: moving ? { ...next, restoredAt: next.updated.at } : next }];
  if (moving) {
    writes.push({
      year: yearOf(prev),
      record: { id: prev.id, deleted: true, deletedAt: next.updated.at, movedTo: yearOf(next), updated: next.updated },
    });
  }
  return writes;
}
