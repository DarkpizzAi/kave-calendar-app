/* Compass: dates as strings. "YYYY", "YYYY-MM" or "YYYY-MM-DD"; the length
   is the precision. Events always carry a day; the looser forms are for
   ideas (Radar, in B). Day arithmetic runs in UTC so a DST change can never
   shift a day, and "today" is read in local time because that is the day
   the person holding the phone is living in. */
"use strict";

export const MAX_SPAN_DAYS = 62;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

export function precision(d) {
  if (!d) return null;
  return d.length === 4 ? "year" : d.length === 7 ? "month" : d.length === 10 ? "day" : null;
}

export function isValidDate(d) {
  if (typeof d !== "string" || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  if (m !== undefined && (m < 1 || m > 12)) return false;
  if (day !== undefined) {
    const t = new Date(Date.UTC(y, m - 1, day));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
  }
  return true;
}

export function sortKey(d) {
  return d.length === 4 ? d + "-00-00" : d.length === 7 ? d + "-00" : d;
}

export function compareDates(a, b) {
  const x = sortKey(a), y = sortKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function formatDate(d) {
  const [y, m, day] = d.split("-");
  if (!m) return y;
  if (!day) return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function toUtc(day) { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }

export function addDays(day, n) {
  const t = toUtc(day);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function dayOfWeek(day) { return (toUtc(day).getUTCDay() + 6) % 7; }

export function mondayOf(day) { return addDays(day, -dayOfWeek(day)); }

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* Every day an event occupies. An end before the start, or a missing end,
   is a single day; a span is capped so one typo cannot paint a year. */
export function daysOf(event) {
  if (precision(event.start) !== "day") return [];
  const end = precision(event.end) === "day" && event.end >= event.start ? event.end : event.start;
  const out = [];
  for (let d = event.start; d <= end && out.length < MAX_SPAN_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
