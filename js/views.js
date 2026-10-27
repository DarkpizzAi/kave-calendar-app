/* Compass: how far the calendar reaches, as data. Pure and tested; drawing
   lives in calendar.js. */
"use strict";

/* "YYYY-MM-DD" shifted by whole years; 29 February lands on the 28th where
   the other year has no 29th. */
function shiftYears(day, n) {
  const y = Number(day.slice(0, 4)) + n, md = day.slice(5);
  if (md === "02-29") return `${y}-${new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1 ? "02-29" : "02-28"}`;
  return `${y}-${md}`;
}

/* One year back to two years ahead of today, exactly: the strip, the month
   and the agenda stop there and no later. */
export function loadRange(today) {
  return { min: shiftYears(today, -1), max: shiftYears(today, 2) };
}
