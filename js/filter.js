/* Compass: the detail level. Not privacy: the viewer decides how much of the
   other person's plans to see. Full shows everything; Minimal shows only
   yours, shared ones, and their away events (a trip abroad survives
   Minimal -- cal-model.js's own isAway).

   Grey is not a detail level: the other person's events are greyed at every
   level, in Grid and Agenda alike (Isa, 2026-10-11: Agenda matches Grid,
   and Partial, which only added the grey, was retired). */
"use strict";

import { isAway } from "./cal-model.js";

export const isTheirs = (event, me) => event.owner !== me && event.owner !== "shared";

export function applyDetail(events, me, level) {
  const out = [];
  for (const event of events) {
    const theirs = isTheirs(event, me);
    if (theirs && level === "minimal" && !isAway(event)) continue;
    out.push({ event, grey: theirs });
  }
  return out;
}
