/* Compass: the detail level. Not privacy: the viewer decides how much of the
   other person's plans to see. Full shows everything; Partial shows theirs
   greyed; Minimal shows only yours, shared ones, and their away events (a
   trip abroad survives Minimal -- cal-model.js's own isAway). */
"use strict";

import { isAway } from "./cal-model.js";

export function applyDetail(events, me, level) {
  const out = [];
  for (const event of events) {
    const theirs = event.owner !== me && event.owner !== "shared";
    if (theirs && level === "minimal" && !isAway(event)) continue;
    out.push({ event, grey: theirs && level === "partial" });
  }
  return out;
}
