/* Compass: the event page and form's decisions (spec section 3, "The event
   page and the event form"). Pure and tested; view-event.js draws them. */
"use strict";

import { validateEvent } from "./model.js";
import { newCostLine, toCents, EDITABLE_STATES } from "./money.js";
import { safeUrl, uid } from "./util.js";
import { dayOfWeek } from "./dates.js";

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
  cinema: "leisure/culture", theatre: "leisure/culture", activity: "leisure/culture", birthday: "gifts-donations/gifts",
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
  const days = longDay(e.start, thisYear) + (e.end && e.end !== e.start ? " to " + longDay(e.end, thisYear) : "");
  const times = e.startTime ? ` · ${e.startTime}${e.endTime ? " to " + e.endTime : ""}` : "";
  return days + times;
}

export function mapsUrl(venue, city) {
  const q = [venue, city].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  return q ? safeUrl("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q)) : null;
}
