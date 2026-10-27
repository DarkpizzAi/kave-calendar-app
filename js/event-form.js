/* Compass: the event page and form's decisions (spec section 3, "The event
   page and the event form"). Pure and tested; view-event.js draws them. */
"use strict";

import { validateEvent, newEvent, addLink } from "./model.js";
import { newCostLine, toCents, EDITABLE_STATES } from "./money.js";
import { safeUrl, uid } from "./util.js";
import { dayOfWeek, daysOf, addDays } from "./dates.js";

const LONGDOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* The form's raw values -> the event's fields, cleaned, plus what is wrong. */
export function readForm(raw) {
  const t = (v) => String(v == null ? "" : v).trim();
  const fields = {
    title: t(raw.title), start: t(raw.start), end: t(raw.end) || null,
    startTime: t(raw.startTime), endTime: t(raw.endTime),
    owner: raw.owner || "shared", status: raw.status || "planned",
    activities: (raw.activities || []).filter((a) => a && a.type),
    city: t(raw.city).toLowerCase(), venue: t(raw.venue), guests: t(raw.guests), notes: t(raw.notes),
    bookingRefs: t(raw.refs).split(",").map(t).filter(Boolean),
    links: (raw.links || []).map((l) => ({ ...l, label: t(l.label) || "Link", url: safeUrl(t(l.url)) })).filter((l) => l.url),
    checklist: (raw.checklist || []).map((c) => ({ ...c, text: t(c.text) })).filter((c) => c.text),
  };
  return { fields, errors: validateEvent(fields) };
}

/* Adding a cost is prefilled from the event: the category from the first
   activity that suggests one (spec: transport means flights), payer you,
   shared if the event is. */
const COST_FOR = {
  transport: "travel/flights", accommodation: "travel/accommodation", eating: "food/eating-out",
  drinks: "leisure/events-nightlife", clubbing: "leisure/events-nightlife", "live-music": "leisure/events-nightlife",
  cinema: "leisure/culture", activity: "leisure/culture", birthday: "gifts-donations/gifts",
};
export function costDefaults(event, me) {
  const a = (event.activities || []).find((x) => COST_FOR[x.type]);
  return { category: a ? COST_FOR[a.type] : "travel/travel-other", payer: me, scope: event.owner === "shared" ? "shared" : "personal", state: "recorded", currency: "EUR" };
}

/* Confirmed (an email) and locked (the bank) lines are never changed here. */
export const canChangeCost = (line) => EDITABLE_STATES.includes(line.state);

/* "Add a task" at the end of To do. Both leaves it unassigned. */
export function addTask(event, text, forWho) {
  const clean = String(text || "").trim();
  if (!clean) return event;
  const item = { id: "ck_" + uid(), text: clean, done: false, assignee: forWho === "isa" || forWho === "hugo" ? forWho : null };
  return { ...event, checklist: [...(event.checklist || []), item] };
}

/* "Add a cost": the amount is read as text, so 18,50 and 18.50 both work. */
export function addCost(event, c, me, now) {
  const amount = toCents(c.amountText);
  if (amount == null || amount <= 0) throw new Error("the amount is not a number");
  const line = newCostLine({ category: c.category, payer: c.payer, amount, scope: c.scope, state: c.state, currency: c.currency || "EUR", name: c.name, me, now });
  return { ...event, costs: [...(event.costs || []), line] };
}

const longDay = (d, thisYear) =>
  `${LONGDOW[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${thisYear && d.slice(0, 4) !== thisYear ? " " + d.slice(0, 4) : ""}`;

/* "Thursday 24 September · 21:00 to 03:00" */
export function whenLine(e, thisYear = e.start.slice(0, 4)) {
  /* the real last day: a typo'd end (2099) or an end before the start prints nothing odd (M1) */
  const all = daysOf(e), last = all.length ? all[all.length - 1] : e.start;
  const days = longDay(e.start, thisYear) + (last !== e.start ? " to " + longDay(last, thisYear) : "");
  const times = e.startTime ? ` · ${e.startTime}${e.endTime ? " to " + e.endTime : ""}` : "";
  return days + times;
}

/* F49: a Venue field can already hold a Maps link (pasted, not typed as a
   place name). Detect that case and use it as-is for "Open in Maps" instead
   of wrapping it in a broken search query -- extracting the real place name
   from an arbitrary Maps link needs a paid Places API call, out of scope. */
export function isMapsUrl(text) {
  const u = safeUrl(String(text || "").trim());
  if (!u) return false;
  try {
    const { hostname } = new URL(u);
    return hostname === "maps.google.com" || hostname === "goo.gl" || hostname === "maps.app.goo.gl"
      || /(^|\.)google\.[a-z.]+$/.test(hostname) && u.includes("/maps");
  } catch { return false; }
}

export function mapsUrl(venue, city) {
  const v = String(venue || "").trim();
  if (isMapsUrl(v)) return safeUrl(v);
  const q = [venue, city].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  return q ? safeUrl("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q)) : null;
}

/* An event on disk may predate a list field (links, checklist, costs,
   activities). formPage maps over every one of them, and a throw there
   aborts the sheet's draw halfway (new title and bar, old body), so every
   list field is defaulted here. Every list comes from the copy, never the
   event itself: the form edits these in place, and an original array here
   would change the live event before Save (and keep the change on Cancel). */
export function toDraft(e) {
  const c = JSON.parse(JSON.stringify(e));
  return { ...c, refs: (c.bookingRefs || []).join(", "),
    city: c.city ? c.city[0].toUpperCase() + c.city.slice(1) : "",
    activities: c.activities || [], links: c.links || [], checklist: c.checklist || [], costs: c.costs || [],
    newCost: null };
}

/* F41: a cost entirely the viewer's own (personal, paid by them) shows no
   payer or scope text at all. Someone else's line says who paid; a shared
   line adds "Split cost" regardless of who paid it. */
export function costPayerText(cost, viewer) {
  const parts = [];
  if (cost.payer !== viewer) parts.push("Paid by " + (cost.payer === "isa" ? "Isa" : cost.payer === "hugo" ? "Hugo" : "Both of us"));
  if (cost.scope === "shared") parts.push("Split cost");
  return parts.join(" · ");
}

/* ---- the form's dates (Task 4) ---- */

/* Whole days from a to b (b later is positive). Day keys are plain dates, so
   a UTC difference is exact through a daylight-saving change. */
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/* Moving the start keeps the length of the event: a stay of three days moved
   a week is still three days. No end stays no end. */
export function spanAfterStartChange(start, end, newStart) {
  if (!end) return { start: newStart, end: "" };
  const span = Math.max(0, daysBetween(start, end));
  return { start: newStart, end: addDays(newStart, span) };
}

/* Choosing an end before the start pulls the start back to it, so the two
   can never cross. */
export function spanAfterEndChange(start, end, newEnd) {
  return newEnd < start ? { start: newEnd, end: newEnd } : { start, end: newEnd };
}

/* The day and the time, apart: "Thursday 24 September" and "21:00 to 03:00".
   An event with no time reads "All day", the same word the agenda uses. */
export function whenParts(e, thisYear = e.start.slice(0, 4)) {
  const line = whenLine(e, thisYear), cut = line.indexOf(" · ");
  const date = cut < 0 ? line : line.slice(0, cut);
  const time = cut < 0 ? "All day" : line.slice(cut + 3);
  return { date, time };
}

/* ---- copy to another day (Task 4) ---- */

/* A copy is a fresh event on the chosen day with the same length. It takes
   the shape of the original, not its money or its paperwork: no cost lines
   (a copied line would be a second claim on one bank line), no stored
   tickets, no booking references, no Drive ticket link, no trip. To-dos come
   back unticked. It goes through newEvent, so it is a normal new event. */
export function copyToDay(e, day, { me, now }) {
  const span = e.end && e.end > e.start ? daysBetween(e.start, e.end) : 0;
  const links = (e.links || []).filter((l) => l && !/^ticket/i.test(String(l.label || "")));
  const fresh = newEvent({
    title: e.title, owner: e.owner, start: day, end: span ? addDays(day, span) : "",
    startTime: e.startTime || "", endTime: e.endTime || "", status: "planned",
    activities: JSON.parse(JSON.stringify(e.activities || [])), city: e.city || "", venue: e.venue || "",
    guests: e.guests || "", notes: e.notes || "", links: JSON.parse(JSON.stringify(links)),
    checklist: (e.checklist || []).map((c) => ({ id: "ck_" + uid(), text: c.text, done: false, assignee: c.assignee || null })),
  }, { me, now });
  return fresh;
}

/* "Add a link": the address is required, the name is not. A bare host gets
   https. Anything unsafe, or already there, changes nothing. */
export function addLinkTo(e, { url, label }) {
  let u = String(url == null ? "" : url).trim();
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  return addLink(e, { label: String(label == null ? "" : label).trim(), url: u });
}
