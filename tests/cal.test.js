import { test, eq, ok } from "./run.js";
import { weekRows, indexByDay, tappable, zoomWeekTarget, zoomMonthTarget, isAway, isBig, awayText,
  shouldLoadMore, nextCount, iconsOf, searchEvents, todaysCount, fullPastWeeks, fullPastMonths,
  backToTodayState, eventsInMonth, tripCityFor, defaultCity, hideCancelled,
  hasOpenTodos, guestsExcludingViewer } from "../js/cal-model.js";
import { readPrefs, byCategories } from "../js/prefs.js";

const ev = (id, start, extra = {}) => ({ id, title: id, start, end: null, owner: "shared", status: "planned", activities: [], ...extra });
const act = (type, icon) => ({ type, icon });

test("cal: F35 -- a cancelled event is hidden in Weekly, kept (for a struck-through title) in Monthly and Yearly", () => {
  const list = [ev("live", "2026-10-01"), ev("dead", "2026-10-01", { status: "cancelled" })];
  eq(hideCancelled(list, "weekly").map((e) => e.id), ["live"]);
  eq(hideCancelled(list, "monthly").map((e) => e.id), ["live", "dead"]);
  eq(hideCancelled(list, "yearly").map((e) => e.id), ["live", "dead"]);
});
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

/* ---- older years on demand (Isa, 2026-09-24: 2024 and 2025 reachable) ---- */
import { seePrevious, pastMonths } from "../js/cal-model.js";
import { loadRange } from "../js/views.js";

test("cal: the range starts at the oldest year loaded", () => {
  eq(loadRange("2026-09-24", "", "2024").min, "2024-01-01");
  eq(loadRange("2026-09-24", "").min, "2026-01-01");
});
test("cal: See previous reveals more, then loads the year before, then stops", () => {
  eq(seePrevious({ from: "2026-03-02", firstMonday: "2025-12-29", exhausted: false }), "more");
  eq(seePrevious({ from: "2025-12-29", firstMonday: "2025-12-29", exhausted: false }), "older");
  eq(seePrevious({ from: "2025-12-29", firstMonday: "2025-12-29", exhausted: true }), "none");
});
test("cal: Yearly's past months run across years, oldest first", () => {
  eq(pastMonths("2026-03-10", "2025", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  eq(pastMonths("2026-03-10", "2026", 12), ["2026-01", "2026-02"]);
  eq(pastMonths("2026-03-10", "2025", 0), []);
});

import { refreshable } from "../js/sheet.js";
test("review I2: a sync never redraws an open form (the keyboard would close)", () => {
  eq([refreshable({ kind: "edit" }), refreshable({ kind: "new" }), refreshable({ kind: "event" }), refreshable(null)], [false, false, true, false]);
});

import { gesture, hasLoadedOlder } from "../js/cal-model.js";
test("review I6: one gesture rule for mouse and touch (swipe sideways, pull at the top)", () => {
  eq(gesture({ dx: -120, dy: 10, top: false, searching: false }), "next");
  eq(gesture({ dx: 120, dy: -10, top: true, searching: false }), "prev");
  eq(gesture({ dx: 5, dy: 90, top: true, searching: false }), "pull");
  eq(gesture({ dx: 5, dy: 90, top: false, searching: false }), null, "a pull away from the top is a scroll");
  eq(gesture({ dx: -120, dy: 10, top: false, searching: true }), null, "no swipes while searching");
  eq(gesture({ dx: 80, dy: 70, top: false, searching: false }), null, "diagonal is a scroll");
});
test("cal: F53 -- a pull only arms at the true top, not once load older has moved it", () => {
  eq(gesture({ dx: 5, dy: 90, top: true, searching: false, loadedOlder: false }), "pull");
  eq(gesture({ dx: 5, dy: 90, top: true, searching: false, loadedOlder: true }), null,
    "scrollTop<=0 after load older sits at the older content's own top, not today's range");
  eq(hasLoadedOlder({ weekly: 0, monthly: 0, yearly: 0 }), false);
  eq(hasLoadedOlder({ weekly: 3, monthly: 0, yearly: 0 }), true);
});

/* ---- deferred minors from the final review ---- */
import { lastEventDay } from "../js/cal-model.js";
test("M1: a typo'd far end date stretches neither the range nor the text", () => {
  const typo = { id: "t", title: "Anglet", owner: "hugo", start: "2026-10-16", end: "2099-01-01" };
  eq(lastEventDay([typo, { id: "b", start: "2026-11-01", end: null }]), "2026-12-16", "62 days from the start at most");
  ok(!awayText(typo, "2026").includes("2099"));
  eq(awayText({ ...typo, end: "2026-10-01" }, "2026"), "Hugo in Anglet, Fri 16 to Fri 16", "an end before the start is one day");
});
import { createPopGate } from "../js/sheet.js";
test("M3: Back events are ignored one by one, never more than were caused", () => {
  const gate = createPopGate();
  gate.expect(2);
  eq([gate.take(), gate.take(), gate.take()], [true, true, false]);
});

/* ---- F3: today's-event-count badge, filtered by detail level ---- */
test("cal: todaysCount is minimal-only-mine, both people at partial and full", () => {
  const evs = [
    ev("mine", "2026-09-25", { owner: "isa" }),
    ev("shared", "2026-09-25", { owner: "shared" }),
    ev("theirs", "2026-09-25", { owner: "hugo" }),
    ev("gone", "2026-09-25", { owner: "hugo", deleted: true }),
  ];
  eq(todaysCount(evs, "isa", "minimal"), 2, "only mine and shared");
  eq(todaysCount(evs, "isa", "partial"), 3, "both, greyed or not");
  eq(todaysCount(evs, "isa", "full"), 3);
  eq(todaysCount([], "isa", "full"), 0);
});

/* ---- F7: "load older" jumps straight to 1 January of the floor year, and
   "Back to today" discards whatever it loaded ---- */
test("cal: fullPastWeeks and fullPastMonths reach exactly 1 January of the floor year", () => {
  eq(fullPastWeeks("2026-09-21", "2026"), 38, "38 Mondays from the first week of 2026 to late September");
  eq(fullPastWeeks("2026-01-05", "2026"), 1);
  eq(fullPastMonths("2026-09-24", "2025"), 20, "January 2025 to August 2026");
});
test("cal: Back to today discards the loaded past, the floor resets to this year", () => {
  eq(backToTodayState("2026"), { past: { weekly: 0, monthly: 0, yearly: 0 }, floor: "2026", exhausted: false });
});

/* ---- F20: "N plans" must not respect the category filters; the heat-strip
   fill still does (unaffected). eventsInMonth is the pure piece
   calendar.js's monthCard runs once against a filtered index (heat-strip)
   and once against an unfiltered one (the count), so the two can now
   disagree on purpose. ---- */
test("cal: eventsInMonth collects each unique event once across the month", () => {
  const drinks = ev("drinks", "2026-10-05", { activities: [act("drinks")] });
  const trip = ev("trip", "2026-10-10", { activities: [act("transport")], end: "2026-10-12" });
  const idx = indexByDay([drinks, trip]);
  const on = (d) => idx.get(d) || [];
  eq(eventsInMonth(on, "2026-10", 31).map((e) => e.id), ["drinks", "trip"]);
});
test("cal: F20 -- the plans count ignores category filters, unlike the heat-strip fill", () => {
  const drinks = ev("drinks", "2026-10-05", { activities: [act("drinks")] });
  const trip = ev("trip", "2026-10-10", { activities: [act("transport")] });
  const all = [drinks, trip];
  const prefs = readPrefs({}); // Yearly's default already hides "drinks" (F17): no toggle needed
  const filtered = byCategories(all, prefs, "isa", "yearly");
  const onAll = (d) => (indexByDay(all).get(d) || []);
  const onFiltered = (d) => (indexByDay(filtered).get(d) || []);
  const count = eventsInMonth(onAll, "2026-10", 31).length;
  const heatEvents = eventsInMonth(onFiltered, "2026-10", 31).length;
  eq(count, 2, "the count includes the hidden-category event");
  eq(heatEvents, 1, "the heat-strip's own event list stays filtered");
  ok(count !== heatEvents, "F20: count and heat-strip now disagree when a category is hidden");
});

/* ---- F22: default city, trip-aware -- reuses isAway (Monthly's "away"
   test), never a second definition of "trip". ---- */
test("cal: tripCityFor finds the trip covering a date, city and all", () => {
  const flight = ev("f", "2026-10-01", { activities: [act("transport")], end: "2026-10-05", city: "porto" });
  eq(tripCityFor([flight], "2026-10-03"), "porto", "inside the span");
  eq(tripCityFor([flight], "2026-10-01"), "porto", "the first day");
  eq(tripCityFor([flight], "2026-10-05"), "porto", "the last day");
  eq(tripCityFor([flight], "2026-10-06"), null, "outside the span");
  eq(tripCityFor([flight], "2026-09-30"), null, "before the span");
});
test("cal: tripCityFor ignores a non-trip activity, a deleted event, and a trip with no city", () => {
  const dinner = ev("d", "2026-10-01", { activities: [act("eating")], city: "madrid" });
  const gone = ev("g", "2026-10-01", { activities: [act("transport")], city: "rome", deleted: true });
  const noCity = ev("n", "2026-10-01", { activities: [act("accommodation")] });
  eq(tripCityFor([dinner, gone, noCity], "2026-10-01"), null);
});
test("cal: F22 -- a blank new event defaults to Barcelona; one dated inside a trip takes that trip's city", () => {
  const trip = ev("t", "2026-11-10", { activities: [act("accommodation")], end: "2026-11-14", city: "lisbon" });
  eq(defaultCity([], "2026-09-25"), "barcelona", "nothing on the calendar");
  eq(defaultCity([trip], "2026-09-25"), "barcelona", "that day is not inside any trip");
  eq(defaultCity([trip], "2026-11-12"), "lisbon", "that day is inside the trip");
});

/* ---- F37: guests text with the viewer's own name filtered out ---- */
test("cal: guestsExcludingViewer drops the viewer's own name, case-insensitively", () => {
  eq(guestsExcludingViewer("Isa, Apu, Jordi", "Isa"), "Apu, Jordi");
  eq(guestsExcludingViewer("isa, Apu, Jordi", "Isa"), "Apu, Jordi", "case-insensitive match");
  eq(guestsExcludingViewer("Apu, Jordi", "Isa"), "Apu, Jordi", "unaffected when the viewer isn't listed");
  eq(guestsExcludingViewer("Isa", "Isa"), "", "the viewer alone leaves nothing");
  eq(guestsExcludingViewer("", "Isa"), "");
  eq(guestsExcludingViewer(null, "Isa"), "");
  eq(guestsExcludingViewer("Apu,  Jordi ,Isa", "Isa"), "Apu, Jordi", "extra whitespace around names is trimmed");
});

/* ---- F38: does this event have at least one open to-do ---- */
test("cal: hasOpenTodos", () => {
  eq(hasOpenTodos(ev("a", "2026-10-01")), false, "no checklist at all");
  eq(hasOpenTodos(ev("b", "2026-10-01", { checklist: [] })), false);
  eq(hasOpenTodos(ev("c", "2026-10-01", { checklist: [{ id: "1", text: "x", done: true }] })), false, "every item done");
  eq(hasOpenTodos(ev("d", "2026-10-01", { checklist: [{ id: "1", text: "x", done: true }, { id: "2", text: "y", done: false }] })), true);
});
