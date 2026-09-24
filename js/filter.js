/* Compass: the detail level. Not privacy: the viewer decides how much of the
   other person's plans to see. Full shows everything; Partial shows theirs
   greyed; Minimal shows only yours and shared ones. (Trips abroad surviving
   Minimal arrive with B.) */
"use strict";

export const DETAIL_LEVELS = ["full", "partial", "minimal"];

export function applyDetail(events, me, level) {
  const out = [];
  for (const event of events) {
    const theirs = event.owner !== me && event.owner !== "shared";
    if (theirs && level === "minimal") continue;
    out.push({ event, grey: theirs && level === "partial" });
  }
  return out;
}
