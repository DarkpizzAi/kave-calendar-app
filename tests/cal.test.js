import { test, eq, ok } from "./run.js";
import { indexByDay, eventsOn, isMidStay, stayRole, stayLabel, pickDayIcon, isAway,
  shouldLoadMore, nextCount, iconsOf, searchEvents, todaysCount, fullPastWeeks, fullPastMonths,
  tripCityFor, defaultCity, hideCancelled,
  hasOpenTodos, guestsExcludingViewer, rowLinks, shownStatus, gridDots, DAY_PRIORITY } from "../js/cal-model.js";

const ev = (id, start, extra = {}) => ({ id, title: id, start, end: null, owner: "shared", status: "planned", activities: [], ...extra });
const act = (type, icon) => ({ type, icon });

test("cal: F35 -- a cancelled event is hidden in Grid, kept (for a struck-through title) in Agenda", () => {
  const list = [ev("live", "2026-10-01"), ev("dead", "2026-10-01", { status: "cancelled" })];
  eq(hideCancelled(list, "grid").map((e) => e.id), ["live"]);
  eq(hideCancelled(list, "agenda").map((e) => e.id), ["live", "dead"]);
});
test("cal: indexByDay spans multi-day events and skips deleted ones", () => {
  const idx = indexByDay([ev("trip", "2026-10-30", { end: "2026-11-01" }), ev("gone", "2026-10-30", { deleted: true })]);
  eq([...idx.keys()], ["2026-10-30", "2026-10-31", "2026-11-01"]);
  eq(idx.get("2026-10-31").map((e) => e.id), ["trip"]);
});
test("cal: a day lists all-day and untimed first, then by start time", () => {
  const idx = indexByDay([
    ev("train", "2026-10-16", { startTime: "19:33" }), ev("fisio", "2026-10-16", { startTime: "09:00" }),
    ev("bday", "2026-10-16"), ev("hotel", "2026-10-15", { end: "2026-10-18", startTime: "19:00" }),
  ]);
  eq(idx.get("2026-10-16").map((e) => e.id), ["hotel", "bday", "fisio", "train"]);
});
test("cal: a span's start time belongs to its first day only", () => {
  const idx = indexByDay([ev("late", "2026-10-16", { end: "2026-10-17", startTime: "23:00" }), ev("morning", "2026-10-17", { startTime: "08:00" })]);
  eq(idx.get("2026-10-16").map((e) => e.id), ["late"]);
  eq(idx.get("2026-10-17").map((e) => e.id), ["late", "morning"]);
});
test("cal: ties keep a stable order whatever order the events arrive in", () => {
  const a = ev("a", "2026-10-16", { startTime: "10:00" }), b = ev("b", "2026-10-16", { startTime: "10:00" });
  eq(indexByDay([b, a]).get("2026-10-16").map((e) => e.id), ["a", "b"]);
});
test("cal: an accommodation shows on check-in and check-out only", () => {
  const stay = ev("stay", "2026-10-16", { end: "2026-10-18", activities: [act("accommodation", "🏨")] });
  eq(["2026-10-16", "2026-10-17", "2026-10-18"].map((d) => isMidStay(stay, d)), [false, true, false]);
  eq(isMidStay(ev("night", "2026-10-16", { end: "2026-10-17", activities: [act("accommodation", "🏨")] }), "2026-10-17"), false);
  eq(isMidStay(ev("one", "2026-10-16", { activities: [act("accommodation", "🏨")] }), "2026-10-16"), false);
  eq(isMidStay(ev("trip", "2026-10-16", { end: "2026-10-18", activities: [act("transport", "🚆")] }), "2026-10-17"), false);
});
test("cal: a stay is in on its first day, out on its last, mid between; only an accommodation is a stay", () => {
  const stay = ev("stay", "2026-10-16", { end: "2026-10-18", activities: [act("accommodation", "🏨")] });
  eq(["2026-10-16", "2026-10-17", "2026-10-18"].map((d) => stayRole(stay, d)), ["in", "mid", "out"]);
  eq(["2026-10-16", "2026-10-17", "2026-10-18"].map((d) => stayLabel(stay, d)), ["Check in", "", "Check out"]);
  const one = ev("one", "2026-10-16", { activities: [act("accommodation", "🏨")] });
  eq([stayRole(one, "2026-10-16"), stayLabel(one, "2026-10-16")], ["in", ""]);
  eq(stayRole(ev("t", "2026-10-16", { end: "2026-10-18", activities: [act("transport", "🚆")] }), "2026-10-17"), null);
});
test("cal: the Grid emoji of a day: a visit's first day tops everything, then travel, then the rest", () => {
  const pick = (evs, d) => { const b = pickDayIcon(evs, d); return b && b.e.id; };
  const visit = ev("visit", "2026-10-28", { end: "2026-11-01", activities: [act("visitor", "🏠")] });
  const flight = ev("flight", "2026-10-28", { activities: [act("transport", "✈️")] });
  const stay = ev("stay", "2026-10-28", { end: "2026-10-30", activities: [act("accommodation", "🏨")] });
  const dinner = ev("dinner", "2026-10-29", { activities: [act("eating", "🍴")] });
  eq(pick([flight, stay, visit], "2026-10-28"), "visit");
  eq(pick([stay, flight], "2026-10-28"), "flight");
  eq(pick([stay, dinner], "2026-10-29"), "dinner");
  eq(pick([stay], "2026-10-30"), "stay");
  eq(pick([stay, ev("lunch", "2026-10-30", { activities: [act("eating", "🍴")] })], "2026-10-30"), "lunch");
  eq(pick([visit, dinner], "2026-10-29"), "dinner");
  eq(pick([ev("plain", "2026-10-29")], "2026-10-29"), "plain");
  eq(pick([], "2026-10-29"), null);
});
test("cal: the Grid emoji order decides inside a group; mine and shared outrank the other person's", () => {
  const pick = (evs, d, opts) => { const b = pickDayIcon(evs, d, opts); return b && b.e.id; };
  const d = "2026-10-29";
  const mineEat = ev("mineEat", d, { owner: "isa", activities: [act("eating", "🍴")] });
  const hugoFlight = ev("hugoFlight", d, { owner: "hugo", activities: [act("transport", "✈️")] });
  const hugoMusic = ev("hugoMusic", d, { owner: "hugo", activities: [act("live-music", "🎶")] });
  const shared = ev("shared", d, { owner: "shared", activities: [act("drinks", "🍺")] });
  const order = ["transport", "accommodation", "live-music", ...DAY_PRIORITY.filter((t) => !["transport", "accommodation", "live-music"].includes(t))];
  eq(pick([hugoFlight, mineEat], d, { order, me: "isa" }), "mineEat", "my dinner beats Hugo's flight");
  eq(pick([hugoFlight, hugoMusic], d, { order, me: "isa" }), "hugoFlight", "only his: his flight shows");
  eq(pick([hugoFlight, hugoMusic], d, { order: ["live-music", ...order.filter((t) => t !== "live-music")], me: "isa" }), "hugoMusic", "my order decides inside his group");
  eq(pick([hugoFlight, shared], d, { order, me: "isa" }), "shared", "shared counts as mine");
  eq(pick([hugoFlight, mineEat], d, { order, me: "hugo" }), "hugoFlight", "Hugo's own grid is the other way round");
  eq(pick([mineEat, hugoMusic], d, { order: [...DAY_PRIORITY].reverse(), me: "isa" }), "mineEat");
});
test("cal: the fixed rules hold inside each group whatever the order", () => {
  const pick = (evs, d, opts) => { const b = pickDayIcon(evs, d, opts); return b && b.e.id; };
  const bottom = ["none", ...DAY_PRIORITY.filter((t) => t !== "none")];
  const visit = ev("visit", "2026-10-28", { end: "2026-11-01", owner: "isa", activities: [act("visitor", "🏠")] });
  const flight = ev("flight", "2026-10-28", { owner: "isa", activities: [act("transport", "✈️")] });
  eq(pick([flight, visit], "2026-10-28", { order: bottom, me: "isa" }), "visit", "arrival first");
  const stay = ev("stay", "2026-10-28", { end: "2026-10-30", owner: "isa", activities: [act("accommodation", "🏨")] });
  const lunch = ev("lunch", "2026-10-30", { owner: "isa", activities: [act("none", "📌")] });
  eq(pick([stay, lunch], "2026-10-30", { order: ["accommodation", ...DAY_PRIORITY.filter((t) => t !== "accommodation")], me: "isa" }), "lunch", "check-out ranks below everything");
});
test("review: eventsOn gives one day's events in day order, spans and cancelled included, deleted not", () => {
  const evs = [ev("late", "2026-10-16", { startTime: "21:00" }), ev("trip", "2026-10-14", { end: "2026-10-18" }),
    ev("off", "2026-10-16", { status: "cancelled" }), ev("gone", "2026-10-16", { deleted: true }), ev("other", "2026-10-17")];
  eq(eventsOn(evs, "2026-10-16").map((e) => e.id), ["trip", "off", "late"]);
  eq(eventsOn(evs, "2026-10-20"), []);
});
test("cal: away", () => {
  const flight = ev("f", "2026-10-01", { activities: [act("transport")] });
  const visit = ev("v", "2026-10-01", { activities: [act("visitor")] });
  const dinner = ev("d", "2026-10-01", { activities: [act("eating")] });
  eq([isAway(flight), isAway(visit), isAway(dinner)], [true, false, false]);
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
import { pastMonths } from "../js/cal-model.js";
import { loadRange } from "../js/views.js";

test("cal: the range starts at the oldest year loaded", () => {
  eq(loadRange("2026-09-24", "", "2024").min, "2024-01-01");
  eq(loadRange("2026-09-24", "").min, "2026-01-01");
});
test("cal: Grid's past months run across years, oldest first", () => {
  eq(pastMonths("2026-03-10", "2025", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  eq(pastMonths("2026-03-10", "2026", 12), ["2026-01", "2026-02"]);
  eq(pastMonths("2026-03-10", "2025", 0), []);
});

import { refreshable } from "../js/sheet.js";
test("review I2: a sync never redraws an open form (the keyboard would close)", () => {
  eq([refreshable({ kind: "edit" }), refreshable({ kind: "new" }), refreshable({ kind: "event" }), refreshable(null)], [false, false, true, false]);
});

import { gesture } from "../js/cal-model.js";
test("review I6: one gesture rule for mouse and touch (swipe sideways, pull at the top)", () => {
  eq(gesture({ dx: -120, dy: 10, top: false, searching: false }), "next");
  eq(gesture({ dx: 120, dy: -10, top: true, searching: false }), "prev");
  eq(gesture({ dx: 5, dy: 90, top: true, searching: false }), "pull");
  eq(gesture({ dx: 5, dy: 90, top: false, searching: false }), null, "a pull away from the top is a scroll");
  eq(gesture({ dx: -120, dy: 10, top: false, searching: true }), null, "no swipes while searching");
  eq(gesture({ dx: 80, dy: 70, top: false, searching: false }), null, "diagonal is a scroll");
});

/* ---- deferred minors from the final review ---- */
import { lastEventDay } from "../js/cal-model.js";
test("M1: a typo'd far end date does not stretch the range", () => {
  const typo = { id: "t", title: "Anglet", owner: "hugo", start: "2026-10-16", end: "2099-01-01" };
  eq(lastEventDay([typo, { id: "b", start: "2026-11-01", end: null }]), "2026-12-16", "62 days from the start at most");
});
import { createPopGate } from "../js/sheet.js";
test("M3: Back events are ignored one by one, never more than were caused", () => {
  const gate = createPopGate();
  gate.expect(2);
  eq([gate.take(), gate.take(), gate.take()], [true, true, false]);
});

/* ---- F3: today's-event-count badge, filtered by detail level ---- */
test("cal: todaysCount is minimal-only-mine, both people at full", () => {
  const evs = [
    ev("mine", "2026-09-25", { owner: "isa" }),
    ev("shared", "2026-09-25", { owner: "shared" }),
    ev("theirs", "2026-09-25", { owner: "hugo" }),
    ev("gone", "2026-09-25", { owner: "hugo", deleted: true }),
  ];
  const D = "2026-09-25";
  eq(todaysCount(evs, "isa", "minimal", D), 2, "only mine and shared");
  eq(todaysCount(evs, "isa", "full", D), 3);
  eq(todaysCount([], "isa", "full", D), 0);
});
test("review: the badge counts what the views show -- no cancelled event, no middle night of a stay", () => {
  const stay = ev("stay", "2026-09-24", { end: "2026-09-26", activities: [act("accommodation", "🏨")] });
  const evs = [ev("on", "2026-09-25"), ev("off", "2026-09-25", { status: "cancelled" }), stay];
  eq(todaysCount(evs, "isa", "full", "2026-09-25"), 1, "the stay's middle night and the cancelled event are left out");
  eq(todaysCount([stay], "isa", "full", "2026-09-26"), 1, "check-out day counts");
});

/* ---- F7: "load older" jumps straight to 1 January of the floor year, and
   "Back to today" discards whatever it loaded ---- */
test("cal: fullPastWeeks and fullPastMonths reach exactly 1 January of the floor year", () => {
  eq(fullPastWeeks("2026-09-21", "2026"), 38, "38 Mondays from the first week of 2026 to late September");
  eq(fullPastWeeks("2026-01-05", "2026"), 1);
  eq(fullPastMonths("2026-09-24", "2025"), 20, "January 2025 to August 2026");
});

/* ---- F22: default city, trip-aware -- reuses isAway (Agenda's "away"
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

test("cal: rowLinks shows only the best tier, 3 in full or 2 plus a count", () => {
  const L = (label) => ({ label, url: "https://x.test/" + label });
  const labels = (r) => r.shown.map((l) => l.label);
  let r = rowLinks([L("Official website"), L("Hotel app"), L("Voucher")]);
  eq(labels(r), ["Voucher"], "a ticket hides the app and the website"); eq(r.more, 2, "both counted");
  r = rowLinks([L("Ticket A"), L("Ticket B"), L("Ticket C"), L("Hotel app")]);
  eq(labels(r), ["Ticket A", "Ticket B", "Ticket C"], "3 tickets all show"); eq(r.more, 1);
  r = rowLinks([L("Ticket A"), L("Ticket B"), L("Ticket C"), L("Ticket D"), L("Ticket E")]);
  eq(labels(r), ["Ticket A", "Ticket B"], "4 or more: first 2"); eq(r.more, 3);
  r = rowLinks([L("Official website"), L("Open the DICE app")]);
  eq(labels(r), ["Open the DICE app"], "no ticket: the app wins"); eq(r.more, 1);
  r = rowLinks([L("Official website")]); eq(r.more, 0, "only a website: nothing more");
  eq(rowLinks([]).shown, []); eq(rowLinks(null).more, 0);
});

test("cal: shownStatus makes an event with a ticket link booked, except cancelled", () => {
  const t = [{ label: "Ticket A", url: "https://x.test/a" }], w = [{ label: "Official website", url: "https://x.test/w" }];
  eq(shownStatus({ status: "planned", links: t }), "booked", "a ticket books it");
  eq(shownStatus({ status: "idea", links: t }), "booked");
  eq(shownStatus({ status: "cancelled", links: t }), "cancelled", "cancelled stays cancelled");
  eq(shownStatus({ status: "planned", links: w }), "planned", "a website alone does not");
  eq(shownStatus({ status: "idea" }), "idea", "no links at all");
  eq(shownStatus({ status: "done" }), "planned", "a stray stored done reads as planned: there is no done status");
  eq(shownStatus({ status: "done", links: t }), "booked", "and a ticket still books it");
});

test("cal: gridDots fits the top edge: up to 3 dots, past that 2 and a plus", () => {
  eq(gridDots(0), { dots: 0, plus: false }, "one event: nothing");
  eq(gridDots(2), { dots: 2, plus: false });
  eq(gridDots(3), { dots: 3, plus: false }, "three fit");
  eq(gridDots(4), { dots: 2, plus: true }, "past three: two and a plus");
});
