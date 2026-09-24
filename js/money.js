/* Compass: money. Integer cents everywhere. A cost line is one payment; the
   bank extract is the truth, so in A only estimate and recorded can be set,
   and a locked line (written by C) can never be edited here. */
"use strict";

import { uid } from "./util.js";

export const CATEGORIES = [
  { slug: "leisure/events-nightlife", label: "Tickets & nightlife" },
  { slug: "food/eating-out", label: "Eating out" },
  { slug: "travel/flights", label: "Flights" },
  { slug: "travel/accommodation", label: "Accommodation" },
  { slug: "leisure/culture", label: "Culture" },
  { slug: "transport/taxi", label: "Taxi" },
  { slug: "transport/public-transport", label: "Public transport" },
  { slug: "food/coffee-snacks", label: "Coffee & snacks" },
  { slug: "gifts-donations/gifts", label: "Gifts" },
  { slug: "food/groceries", label: "Groceries" },
  { slug: "leisure/hobbies", label: "Hobbies & workshops" },
  { slug: "shopping/clothing", label: "Clothing" },
  { slug: "travel/travel-other", label: "Travel other" },
  { slug: "transport/fuel", label: "Fuel" },
  { slug: "bureaucracy/immigration", label: "Visas & immigration" },
];
export const RUNGS = ["estimate", "recorded", "confirmed", "locked"];
export const EDITABLE_STATES = ["estimate", "recorded"];

export function toCents(text) {
  const s = String(text == null ? "" : text).replace(/[\s  €]/g, "");
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return null;
  /* Parsed as text, never through a float: 36.105 * 100 is 3610.4999... in
     binary, which would round a split amount the wrong way. Half-up on the
     third decimal. */
  const frac = (m[2] || "").padEnd(3, "0");
  return Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
}

const FORMATS = {};
export function formatCents(cents, currency = "EUR") {
  FORMATS[currency] = FORMATS[currency] || new Intl.NumberFormat("fr-FR", { style: "currency", currency });
  return FORMATS[currency].format(cents / 100);
}

/* Who carries how much of one line. A shared line splits in half; the odd
   cent goes to the payer so the two halves always add up. */
export function shareOf(line, person) {
  if (line.scope !== "shared") return line.payer === person ? line.amount : 0;
  const half = Math.floor(line.amount / 2);
  return line.payer === person ? line.amount - half : half;
}

export function visibleCosts(lines, me) {
  return (lines || []).filter((l) => l.scope === "shared" || l.enteredBy === me);
}

export function newCostLine({ category, payer, amount, scope, state = "recorded", me, now }) {
  if (!EDITABLE_STATES.includes(state)) throw new Error("only estimate or recorded can be typed");
  if (!Number.isInteger(amount) || amount < 0) throw new Error("amount must be whole cents");
  const at = now.toISOString();
  return {
    id: "co_" + uid(), category, payer, scope, amount, currency: "EUR", state,
    evidence: [{ kind: "typed", amount, currency: "EUR", by: me, at }],
    enteredBy: me,
  };
}

export function setCostAmount(line, amount, me, now) {
  if (!EDITABLE_STATES.includes(line.state)) throw new Error("this line is " + line.state + " and cannot be edited");
  if (!Number.isInteger(amount) || amount < 0) throw new Error("amount must be whole cents");
  return {
    ...line, amount,
    evidence: [...line.evidence, { kind: "typed", amount, currency: "EUR", by: me, at: now.toISOString() }],
  };
}
