import { test, eq } from "./run.js";
import { precision, isValidDate, sortKey, compareDates, formatDate, addDays,
  dayOfWeek, mondayOf, todayKey, daysOf, MAX_SPAN_DAYS } from "../js/dates.js";

test("precision from length", () => {
  eq([precision("2025"), precision("2025-08"), precision("2025-08-14"), precision(""), precision(null)],
     ["year", "month", "day", null, null]);
});
test("isValidDate rejects impossible dates", () => {
  eq([isValidDate("2026-02-29"), isValidDate("2024-02-29"), isValidDate("2025-13"), isValidDate("25-01-01"), isValidDate("2025-08-14")],
     [false, true, false, false, true]);
});
test("month and year sort before days of that month and year", () => {
  const list = ["2025-08-14", "2025-08", "2025", "2025-08-01"].sort(compareDates);
  eq(list, ["2025", "2025-08", "2025-08-01", "2025-08-14"]);
  eq(sortKey("2025-08"), "2025-08-00");
});
test("formatDate by precision", () => {
  eq([formatDate("2025"), formatDate("2025-08"), formatDate("2025-08-14")], ["2025", "Aug 2025", "14 Aug 2025"]);
});
test("addDays crosses months, years and DST", () => {
  eq([addDays("2026-01-31", 1), addDays("2025-12-31", 1), addDays("2026-03-29", 1), addDays("2026-03-01", -1)],
     ["2026-02-01", "2026-01-01", "2026-03-30", "2026-02-28"]);
});
test("weeks start on Monday", () => {
  eq([dayOfWeek("2026-09-28"), dayOfWeek("2026-10-04")], [0, 6]);
  eq(mondayOf("2026-10-04"), "2026-09-28");
});
test("todayKey uses local time", () => {
  eq(todayKey(new Date(2026, 8, 24, 23, 59)), "2026-09-24");
});
test("daysOf a multi-day event", () => {
  eq(daysOf({ start: "2026-10-30", end: "2026-11-02" }), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});
test("daysOf: end before start is a single day (Review Focus 3)", () => {
  eq(daysOf({ start: "2025-12-28", end: "2025-01-02" }), ["2025-12-28"]);
});
test("daysOf caps long spans (Review Focus 3)", () => {
  eq(daysOf({ start: "2026-01-01", end: "2026-12-31" }).length, MAX_SPAN_DAYS);
});
test("daysOf is empty without a day-precision start", () => {
  eq([daysOf({ start: "2026-11", end: null }), daysOf({ start: "2026", end: null })], [[], []]);
});
