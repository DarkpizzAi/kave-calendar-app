/* Compass: the Roadmap page. What each part of the app is for, and what is
   coming. Trips and Radar left the navigation; they are lines here and
   nowhere else until they are built. All the text is fixed, none of it comes
   from the sync. */
"use strict";

import { escapeHtml } from "./util.js";
import { ms } from "./chrome-icons.js";

export const ROADMAP = [
  { key: "calendar", name: "Calendar", icon: "calendar_month", live: true,
    text: "Events, what they cost and the loose ends attached to them, in Grid and Agenda." },
  { key: "insights", name: "Insights", icon: "insights", live: true,
    text: "What Kave Compass noticed: questions to answer and facts worth knowing." },
  { key: "trips", name: "Trips", icon: "flight", live: false,
    text: "For what is real: booked trips, their phases and what they cost." },
  { key: "radar", name: "Radar", icon: "radar", live: false,
    text: "For what is not yet: ideas with no exact day, kept until they become a plan." },
];

export function roadmapHtml() {
  const rows = ROADMAP.map((r) => `
    <div class="m3-list-item m3-list-item--three">
      <span class="m3-list-item__lead m3-list-item__lead--square">${ms(r.icon)}</span>
      <div class="m3-list-item__text m3-list-item__text--wrap">
        <div class="m3-title-m">${escapeHtml(r.name)}</div>
        <div class="m3-body-m m3-variant">${escapeHtml(r.text)}</div>
      </div>
      <span class="m3-chip${r.live ? " is-selected" : ""}">${r.live ? "Live" : "Coming soon"}</span>
    </div>`).join("");
  return `<p class="m3-body-m m3-variant page-intro">The parts of Kave Compass, what each one is for, and what is coming. Settings lives in the menu.</p>
    <div class="m3-grouped">${rows}</div>`;
}
