/* Compass: how far the views reach, as data. Pure and tested; drawing lives
   in calendar.js. */
"use strict";

/* How far the views reach: back to 1 January of this year, or of the oldest
   year loaded on demand (Search goes on into earlier years); forward to the
   end of the year after next, or to the last event if that is later. */
export function loadRange(today, lastEventDay, floorYear) {
  const max = (Number(today.slice(0, 4)) + 2) + "-12-31";
  const from = floorYear && floorYear < today.slice(0, 4) ? floorYear : today.slice(0, 4);
  return { min: from + "-01-01", max: lastEventDay && lastEventDay > max ? lastEventDay : max };
}
