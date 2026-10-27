import { test, eq, ok } from "./run.js";
import { splitTime, joinTime, dialPoint, clampDayTo, monthBounds, canStep, dateLabel } from "../js/pickers.js";

test("time picker: a value splits into hours and minutes, and an empty one opens on 20:00", () => {
  eq(splitTime("09:05"), { h: 9, m: 5 });
  eq(splitTime(""), { h: 20, m: 0 });
  eq(splitTime("25:99"), { h: 20, m: 0 });
  eq(joinTime(9, 5), "09:05");
  eq(joinTime(0, 0), "00:00");
});
test("time picker: 24 hours sit on two rings, 12 at the top, 0 on the outer ring", () => {
  const top = dialPoint(0, 12, 106), noon = dialPoint(12 % 12, 12, 70), three = dialPoint(3, 12, 106);
  eq([Math.round(top.x), Math.round(top.y)], [128, 22]);
  eq([Math.round(noon.x), Math.round(noon.y)], [128, 58]);
  eq([Math.round(three.x), Math.round(three.y)], [234, 128]);
});
test("date picker: a day outside the range snaps to the nearest edge", () => {
  eq(clampDayTo("2026-01-01", "2026-03-01", "2026-12-31"), "2026-03-01");
  eq(clampDayTo("2030-01-01", "2026-03-01", "2026-12-31"), "2026-12-31");
  eq(clampDayTo("2026-05-05", "2026-03-01", "2026-12-31"), "2026-05-05");
  eq(clampDayTo("2026-05-05", "", ""), "2026-05-05", "no range, no clamp");
});
test("date picker: month arrows stop at the range, so no empty month opens", () => {
  eq(monthBounds("2026-03-01", "2026-12-31"), { min: "2026-03", max: "2026-12" });
  eq([canStep("2026-03", -1, "2026-03", "2026-12"), canStep("2026-03", 1, "2026-03", "2026-12"), canStep("2026-12", 1, "2026-03", "2026-12")], [false, true, false]);
  eq(canStep("2026-05", -1, "", ""), true);
});
test("date picker: the short label", () => {
  eq(dateLabel("2026-10-28"), "Wed, 28 Oct");
  eq(dateLabel("2026-11-01"), "Sun, 1 Nov");
});
