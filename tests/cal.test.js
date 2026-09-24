import { test, eq, ok } from "./run.js";
import { weekRows, indexByDay, tappable, zoomWeekTarget, zoomMonthTarget, isAway, isBig, awayText,
  shouldLoadMore, nextCount, iconsOf, searchEvents } from "../js/cal-model.js";

const ev = (id, start, extra = {}) => ({ id, title: id, start, end: null, owner: "shared", status: "planned", activities: [], ...extra });
const act = (type, icon) => ({ type, icon });

test("cal: week rows are 3-3-1 on a phone, 7 when wide", () => {
  const days = ["a", "b", "c", "d", "e", "f", "g"];
  eq(weekRows(days, false), [["a", "b", "c"], ["d", "e", "f"], ["g"]]);
  eq(weekRows(days, true), [days]);
});
test("cal: indexByDay spans multi-day events and skips deleted ones", () => {
  const idx = indexByDay([ev("trip", "2026-10-30", { end: "2026-11-01" }), ev("gone", "2026-10-30", { deleted: true })]);
  eq([...idx.keys()], ["2026-10-30", "2026-10-31", "2026-11-01"]);
  eq(idx.get("2026-10-31").map((e) => e.id), ["trip"]);
});
test("cal: a day or week with nothing cannot be tapped", () => {
  eq([tappable([]), tappable([ev("a", "2026-10-01")])], [false, true]);
});
test("cal: jump targets land on a Monday", () => {
  eq(zoomWeekTarget("2026-09-24"), "2026-09-21");
  eq(zoomMonthTarget("2026-10"), "2026-09-28");
  eq(zoomMonthTarget("2026-11"), "2026-11-02");
});
test("cal: away and big", () => {
  const flight = ev("f", "2026-10-01", { activities: [act("transport")] });
  const visit = ev("v", "2026-10-01", { activities: [act("visitor")] });
  const bday = ev("b", "2026-10-01", { activities: [act("birthday"), act("transport")] });
  const dinner = ev("d", "2026-10-01", { activities: [act("eating")] });
  eq([isAway(flight), isAway(visit), isAway(dinner)], [true, false, false]);
  eq([isBig(flight), isBig(visit), isBig(bday), isBig(dinner)], [true, true, false, false]);
});
test("cal: away text names the person unless shared", () => {
  eq(awayText(ev("Anglet", "2026-10-16", { owner: "hugo", end: "2026-10-18" }), "2026"), "Hugo in Anglet, Fri 16 to Sun 18");
  eq(awayText(ev("Porto", "2026-10-16", { owner: "shared" }), "2026"), "Porto, Fri 16 to Fri 16");
});
test("cal: load more only on a real scroll near the bottom, under the cap", () => {
  const box = { scrollHeight: 3000, clientHeight: 800, scrollTop: 1900 };
  const s = { count: 10, cap: 40, pending: false, searching: false };
  ok(shouldLoadMore(box, s), "near the bottom");
  eq(shouldLoadMore({ scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, s), false, "does not scroll (a tall host)");
  eq(shouldLoadMore({ ...box, scrollTop: 100 }, s), false, "far from the bottom");
  eq(shouldLoadMore(box, { ...s, pending: true }), false, "pending");
  eq(shouldLoadMore(box, { ...s, searching: true }), false, "searching");
  eq(shouldLoadMore(box, { ...s, count: 40 }), false, "at the cap");
});
test("cal: nextCount grows by a step and stops at the cap", () => {
  eq([nextCount(10, 8, 40), nextCount(36, 8, 40)], [18, 40]);
});
test("cal: icons: a dated idea shows a question mark, people follow the viewer", () => {
  eq(iconsOf(ev("i", "2026-10-01", { status: "idea", activities: [act("eating")] }), "isa"), ["❔"]);
  const run = ev("r", "2026-10-01", { activities: [act("sport", "running"), act("drinks", "🍺")] });
  eq(iconsOf(run, "hugo"), ["🏃‍♂️", "🍺"]);
  eq(iconsOf(ev("n", "2026-10-01"), "isa"), ["📌"]);
});
test("cal: search ignores accents and case, across title, venue, city, guests", () => {
  const evs = [ev("Mercè fireworks", "2026-09-24"), ev("Dinner", "2026-10-02", { guests: "Jordi" }), ev("Gig", "2026-10-03", { venue: "Razzmatazz" })];
  eq(searchEvents(evs, "merce").map((e) => e.id), ["Mercè fireworks"]);
  eq(searchEvents(evs, "JORDI").map((e) => e.id), ["Dinner"]);
  eq(searchEvents(evs, "razz").map((e) => e.id), ["Gig"]);
  eq(searchEvents(evs, "  ").length, 0);
});
