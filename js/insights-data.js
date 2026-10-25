/* Compass: the pure data behind the Insights tab. No DOM, no storage: events
   in, plain objects out. Rendering lives elsewhere; URLs are returned raw and
   must go through safeUrl where they reach the page. */
"use strict";
import { daysOf, dayOfWeek, addDays } from "./dates.js";

const PLANE_ICONS = ["🛫", "✈️", "🛬"];

/* Spec 7.2, in display order. `types` are catalogue types; `flights` is the
   transport types narrowed to plane icons (see `inTile`). */
export const TILES = [
  { key: "concerts", emoji: "🎶", label: "Concerts", types: ["live-music"] },
  { key: "club", emoji: "🪩", label: "Club nights", types: ["clubbing"] },
  { key: "films", emoji: "🎬", label: "Films", types: ["cinema"] },
  { key: "culture", emoji: "🎭", label: "Shows and culture", types: ["activity"] },
  { key: "meals", emoji: "🍴", label: "Meals out", types: ["eating"] },
  { key: "drinks", emoji: "🍺", label: "Drinks", types: ["drinks"] },
  { key: "sport", emoji: "🏃", label: "Sport", types: ["sport"] },
  { key: "outdoors", emoji: "🌳", label: "Outdoors", types: ["park", "beach", "hike"] },
  { key: "flights", emoji: "✈️", label: "Flights", types: ["transport"] },
  { key: "hotels", emoji: "🏨", label: "Hotel stays", types: ["accommodation"] },
  { key: "birthdays", emoji: "🎂", label: "Birthdays", types: ["birthday"] },
  { key: "visitors", emoji: "🏠", label: "Visitors", types: ["visitor"] },
];
const TILE_BY_KEY = new Map(TILES.map((t) => [t.key, t]));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const countable = (e) => !e.deleted && !e.movedTo && e.status !== "cancelled" && e.status !== "idea";

const lastDay = (e) => { const d = daysOf(e); return d.length ? d[d.length - 1] : e.start; };

/* Does the event belong to the tile? Only through its activities: an event
   with none belongs nowhere. Flights need a plane icon (a train is not one). */
function inTile(e, tile) {
  return (e.activities || []).some((a) => a && tile.types.includes(a.type) && (tile.key !== "flights" || PLANE_ICONS.includes(a.icon)));
}

const dayDiff = (from, to) => {
  const f = from.split("-").map(Number), t = to.split("-").map(Number);
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86400000);
};
const hasDay = (e) => typeof e.start === "string" && e.start.length === 10;
const titleCase = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());

export function yearCounts(events, year) {
  const y = String(year);
  const out = [];
  TILES.forEach((t) => {
    const count = events.filter((e) => countable(e) && hasDay(e) && e.start.slice(0, 4) === y && inTile(e, t)).length;
    if (count > 0) out.push({ key: t.key, emoji: t.emoji, label: t.label, count });
  });
  return out.sort((a, b) => b.count - a.count); // stable: ties keep TILES order
}

const ticketLink = (e) => (e.links || []).find((l) => l && typeof l.label === "string" && l.label.startsWith("Ticket") && l.url);

export function history(events, key, today) {
  const tile = TILE_BY_KEY.get(key);
  if (!tile) return [];
  const byYear = new Map();
  events.filter((e) => countable(e) && hasDay(e) && inTile(e, tile)).forEach((e) => {
    const link = ticketLink(e);
    const place = [e.venue, titleCase(e.city)].filter(Boolean).join(", ");
    const row = {
      id: e.id, date: e.start, title: e.title, place,
      ticket: link ? { when: lastDay(e) < today ? "past" : "future", url: link.url } : null,
    };
    const y = e.start.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(row);
  });
  return [...byYear.keys()].sort().reverse().map((y) => {
    const rows = byYear.get(y).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { year: Number(y), count: rows.length, rows };
  });
}

/* The next countable event of a tile starting today or later, at most 31 days away. */
function nextOf(events, tileKey, today) {
  const tile = TILE_BY_KEY.get(tileKey);
  const limit = addDays(today, 31);
  return events
    .filter((e) => countable(e) && hasDay(e) && e.start >= today && e.start <= limit && inTile(e, tile))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.startTime || "") < (b.startTime || "") ? -1 : (a.startTime || "") > (b.startTime || "") ? 1 : 0))[0] || null;
}

export function comingUp(events, today) {
  const f = nextOf(events, "flights", today);
  const s = nextOf(events, "hotels", today);
  return {
    flight: f ? { id: f.id, title: f.title, date: f.start, time: f.startTime || "", days: dayDiff(today, f.start) } : null,
    stay: s ? { id: s.id, title: s.title, city: titleCase(s.city), start: s.start, end: lastDay(s), nights: dayDiff(s.start, lastDay(s)), days: dayDiff(today, s.start) } : null,
  };
}

const WALL_KEYS = ["concerts", "culture", "club", "films"];
const DRIVE = "https://drive.google.com/";

function wallList(events, today, me, wantHidden) {
  const out = [];
  events.forEach((e) => {
    if (!countable(e) || !hasDay(e) || lastDay(e) >= today) return;
    const link = (e.links || []).find((l) => l && typeof l.label === "string" && l.label.startsWith("Ticket") && typeof l.url === "string" && l.url.startsWith(DRIVE));
    if (!link) return;
    const cat = WALL_KEYS.find((k) => inTile(e, TILE_BY_KEY.get(k)));
    if (!cat) return;
    const hidden = Array.isArray(e.wallHiddenBy) && e.wallHiddenBy.includes(me);
    if (hidden !== wantHidden) return;
    out.push({ id: e.id, title: e.title, date: e.start, cat, url: link.url });
  });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
export const ticketWall = (events, today, me) => wallList(events, today, me, false);
export const wallTakenOff = (events, today, me) => wallList(events, today, me, true);

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function top(map) { // highest count; ties go to the first key in insertion order
  let best = null;
  map.forEach((v, k) => { if (!best || v > best[1]) best = [k, v]; });
  return best;
}

export function didYouKnow(events, year, seed) {
  const y = String(year);
  const list = events.filter((e) => countable(e) && hasDay(e) && e.start.slice(0, 4) === y && (e.activities || []).length > 0);
  if (list.length < 5) return "";
  const facts = [];

  const months = new Map(); // January first, so a tie picks the earlier month
  for (let m = 0; m < 12; m++) months.set(m, 0);
  list.forEach((e) => { const m = Number(e.start.slice(5, 7)) - 1; months.set(m, months.get(m) + 1); });
  const [bm, bmN] = top(months);
  facts.push(`Your busiest month this year was ${MONTHS[bm]}, with ${plural(bmN, "event")}.`);

  const days = new Map();
  for (let d = 0; d < 7; d++) days.set(d, 0);
  list.forEach((e) => { const d = dayOfWeek(e.start); days.set(d, days.get(d) + 1); });
  facts.push(`${WEEKDAYS[top(days)[0]]} is your favourite day to go out.`);

  const cities = new Map();
  list.forEach((e) => {
    const c = titleCase(e.city);
    if (c && c !== "Barcelona") cities.set(c, (cities.get(c) || 0) + 1);
  });
  const bc = top(cities);
  if (bc) facts.push(`${bc[0]} is the city you visited most outside Barcelona, with ${plural(bc[1], "event")}.`);

  const i = ((Math.trunc(seed) || 0) % facts.length + facts.length) % facts.length;
  return facts[i];
}
