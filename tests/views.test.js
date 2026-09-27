import { test, eq, ok } from "./run.js";
import { isoWeek, monthOfWeek, firstWeekOf, loadRange, freeWeekendSaturday, weekendBlocks, classifyWeekend, longWeekends, yearStats, dayFreeState, weekFreeNote, weekFreeDays } from "../js/views.js";
import { applyDetail, DETAIL_LEVELS } from "../js/filter.js";
import { CATEGORIES, iconFor } from "../js/icons.js";
import { HOLIDAYS } from "../js/holidays.js";

const ev = (id, s, extra = {}) => ({ id, title: id, start: s, end: null, owner: "shared", activities: [], ...extra });
const on = (events) => (d) => events.filter((e) => e.start <= d && d <= (e.end || e.start));

/* ---- weeks ---- */
test("ISO week numbers", () => {
  eq([isoWeek("2026-09-21"), isoWeek("2026-01-01"), isoWeek("2027-01-03"), isoWeek("2026-12-28")], [39, 1, 53, 53]);
});
test("a week belongs to the month holding its Thursday", () => {
  eq([monthOfWeek("2026-09-28"), monthOfWeek("2026-11-30"), monthOfWeek("2026-06-29")], ["2026-10", "2026-12", "2026-07"]);
  eq([firstWeekOf("2026-10"), firstWeekOf("2026-12"), firstWeekOf("2027-03")], ["2026-09-28", "2026-11-30", "2027-03-01"]);
});
test("load range: 1 January back, end of the year after next forward, or the last event", () => {
  eq(loadRange("2026-09-24", "2026-12-12"), { min: "2026-01-01", max: "2028-12-31" });
  eq(loadRange("2026-09-24", "2029-05-02"), { min: "2026-01-01", max: "2029-05-02" });
});

/* ---- free weekends: current and next month only ---- */
test("a free weekend shows on its Saturday, this month and next only", () => {
  const blocksAll = () => true;
  const blocksNothing = () => false;
  const events = [ev("a", "2026-10-03")];
  eq(freeWeekendSaturday("2026-09-21", on(events), "2026-09-24", blocksAll), "2026-09-26");
  eq(freeWeekendSaturday("2026-09-28", on(events), "2026-09-24", blocksAll), null);
  eq(freeWeekendSaturday("2026-11-23", on([]), "2026-09-24", blocksAll), null);
  eq(freeWeekendSaturday("2026-09-21", on([ev("b", "2026-09-26")]), "2026-09-24", blocksNothing), "2026-09-26",
     "a non-blocking event on the Saturday itself doesn't stop it reading as free");
  eq(freeWeekendSaturday("2026-09-21", on([]), "2026-09-28", blocksAll), null,
     "a free Saturday that has already passed doesn't show, even in the current month");
  eq(freeWeekendSaturday("2026-09-21", on([]), "2026-09-26", blocksAll), null,
     "today being the Saturday itself is enough to stop it showing");
});

/* ---- long weekends from bank holidays ---- */
test("blocks of days off grow through weekends and neighbouring holidays", () => {
  const b = weekendBlocks(HOLIDAYS, "2026-01-01", "2026-12-31");
  const easter = b.find((x) => x.anchor === "2026-04-03");
  eq([easter.start, easter.end, easter.length], ["2026-04-03", "2026-04-06", 4]);
  eq(b.filter((x) => x.anchor === "2026-04-06").length, 0);
  const pilar = b.find((x) => x.anchor === "2026-10-12");
  eq([pilar.start, pilar.end, pilar.length], ["2026-10-10", "2026-10-12", 3]);
});
test("classify: three or more days off is a long weekend", () => {
  eq(classifyWeekend({ anchor: "2026-10-12", start: "2026-10-10", end: "2026-10-12", length: 3 }),
     { kind: "long", start: "2026-10-10", end: "2026-10-12" });
});
test("classify: a Thursday or Tuesday holiday is an opportunity (one bridge day makes four)", () => {
  eq(classifyWeekend({ anchor: "2026-09-24", start: "2026-09-24", end: "2026-09-24", length: 1 }),
     { kind: "chance", start: "2026-09-24", end: "2026-09-27" });
  eq(classifyWeekend({ anchor: "2026-12-08", start: "2026-12-08", end: "2026-12-08", length: 1 }),
     { kind: "chance", start: "2026-12-05", end: "2026-12-08" });
});
test("classify: a Wednesday holiday is not a long weekend", () => {
  eq(classifyWeekend({ anchor: "2026-06-24", start: "2026-06-24", end: "2026-06-24", length: 1 }), null);
});
test("long weekends are labelled free, long, or opportunity, with the holiday names", () => {
  const blocksAll = () => true;
  const lw = longWeekends(HOLIDAYS, "2026-09-01", "2026-12-31", on([ev("x", "2026-10-10")]), blocksAll);
  const byStart = Object.fromEntries(lw.map((w) => [w.start, w]));
  eq(byStart["2026-09-11"].text, "Free long weekend");
  eq(byStart["2026-09-24"].text, "Long weekend opportunity");
  eq(byStart["2026-10-10"].text, "Long weekend");
  eq(byStart["2026-12-05"].names, "La Immaculada");
  eq(byStart["2026-12-25"].names, "Nadal, Sant Esteve");
});
test("long weekends: a non-blocking event doesn't turn Free into Long", () => {
  const blocksNothing = () => false;
  const lw = longWeekends(HOLIDAYS, "2026-09-01", "2026-09-30", on([ev("x", "2026-09-12")]), blocksNothing);
  const byStart = Object.fromEntries(lw.map((w) => [w.start, w]));
  eq(byStart["2026-09-11"].text, "Free long weekend", "an event that doesn't block still reads as free");
});

/* ---- per-day free state: Clear (nothing at all) vs Open (something, but
   nothing blocking) ---- */
test("dayFreeState: Clear when nobody has anything, Open when they do but it doesn't block", () => {
  const blocksTransport = (e) => e.activities.some((a) => a.type === "transport");
  const noEvents = on([]);
  const flexibleOnly = on([ev("h", "2026-10-04", { activities: [{ type: "eating" }] })]);
  const withBlocking = on([ev("f", "2026-10-04", { activities: [{ type: "transport" }] })]);
  eq(dayFreeState("2026-10-04", noEvents, blocksTransport), "clear");
  eq(dayFreeState("2026-10-04", flexibleOnly, blocksTransport), "open");
  eq(dayFreeState("2026-10-04", withBlocking, blocksTransport), "", "a day with a blocking event on it is neither");
});

test("weekFreeNote: a plain free weekend note attaches to the Saturday", () => {
  /* an empty holidays object here, deliberately -- this test is only about
     freeWeekendSaturday's own behaviour, not about which real 2026 holidays
     happen to fall near this week */
  const blocksAll = () => true;
  eq(weekFreeNote("2026-09-21", {}, on([]), "2026-09-24", blocksAll), { on: "2026-09-26", text: "Free weekend" });
  eq(weekFreeNote("2026-11-16", {}, on([]), "2026-09-24", blocksAll), null, "outside the current/next month freeWeekendSaturday itself checks");
});
test("weekFreeNote: a long weekend or opportunity starting inside this week takes priority", () => {
  const blocksAll = () => true;
  // 2026-10-12 (Pilar) is a Monday holiday, weekendBlocks grows it back to Saturday 2026-10-10
  const note = weekFreeNote("2026-10-05", HOLIDAYS, on([]), "2026-09-24", blocksAll);
  eq(note.on, "2026-10-10");
  eq(note.text, "Free long weekend");
});
test("weekFreeNote: nothing qualifying this week is null", () => {
  const blocksAll = () => true;
  eq(weekFreeNote("2026-09-21", {}, on([ev("x", "2026-09-26")]), "2026-09-24", blocksAll), null);
});
test("weekFreeNote: a long weekend that has already started (today is its first day, or later) is null", () => {
  const blocksAll = () => true;
  // block runs 2026-10-10 to 2026-10-12
  eq(weekFreeNote("2026-10-05", HOLIDAYS, on([]), "2026-10-10", blocksAll), null, "today is the block's first day");
  eq(weekFreeNote("2026-10-05", HOLIDAYS, on([]), "2026-10-13", blocksAll), null, "today is after it ends");
});

test("weekFreeDays: a plain free weekend covers only Saturday and Sunday", () => {
  const blocksAll = () => true;
  eq(weekFreeDays("2026-09-21", {}, on([]), "2026-09-24", blocksAll), ["2026-09-26", "2026-09-27"]);
});
test("weekFreeDays: an opportunity block includes its bridge weekday, not the whole week", () => {
  const blocksAll = () => true;
  // 2026-09-24 (Thu) is an opportunity holiday, block runs Thu-Sun (bridge Friday); today is before it starts
  eq(weekFreeDays("2026-09-21", HOLIDAYS, on([]), "2026-09-21", blocksAll),
     ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
});
test("weekFreeDays: a long weekend block is excluded once today is its first day, falling back to the plain Saturday check", () => {
  const blocksAll = () => true;
  // the Thu-Sun opportunity block starting 2026-09-24 no longer qualifies once today
  // reaches its first day, so this only reports the following Saturday/Sunday
  eq(weekFreeDays("2026-09-21", HOLIDAYS, on([]), "2026-09-24", blocksAll), ["2026-09-26", "2026-09-27"]);
});
test("weekFreeDays: nothing qualifying this week is an empty list", () => {
  const blocksAll = () => true;
  eq(weekFreeDays("2026-09-21", {}, on([ev("x", "2026-09-26")]), "2026-09-24", blocksAll), []);
});

/* ---- the Yearly stats card ---- */
test("stats lead with trips, cities, plans, and never costs", () => {
  const events = [ev("t1", "2026-06-23", { end: "2026-06-28", away: true, city: "porto" }), ev("t2", "2026-08-06", { end: "2026-08-10", away: true, city: "prague" }),
                  ev("t3", "2026-10-30", { end: "2026-11-02", away: true, city: "porto" }), ev("v", "2026-02-27", { activities: [{ type: "visitor", icon: "🧳" }] }),
                  ev("n", "2026-03-01", { activities: [{ type: "live-music", icon: "🎶" }] })];
  const s = yearStats(events, "2026-09-24");
  eq([s.trips, s.cities, s.plans, s.nightsAway, s.visitors], [2, 2, 4, 9, 1]);
  ok(!("cost" in s));
});

/* ---- detail levels ---- */
test("detail levels: full, partial greys the other person, minimal hides them except when away", () => {
  const list = [
    ev("m", "2026-10-01", { owner: "isa" }),
    ev("o", "2026-10-01"),
    ev("t", "2026-10-01", { owner: "hugo" }),
    ev("trip", "2026-10-01", { owner: "hugo", activities: [{ type: "transport" }] }),
  ];
  eq(DETAIL_LEVELS, ["full", "partial", "minimal"]);
  eq(applyDetail(list, "isa", "full").map((x) => [x.event.id, x.grey]),
     [["m", false], ["o", false], ["t", false], ["trip", false]]);
  eq(applyDetail(list, "isa", "partial").map((x) => [x.event.id, x.grey]),
     [["m", false], ["o", false], ["t", true], ["trip", true]]);
  eq(applyDetail(list, "isa", "minimal").map((x) => x.event.id), ["m", "o", "trip"],
     "hugo's non-away event is hidden; his trip survives");
});
test("detail levels: minimal keeps an away event even when it has other activities too", () => {
  const mixed = ev("mixed", "2026-10-01", { owner: "hugo", activities: [{ type: "eating" }, { type: "transport" }] });
  eq(applyDetail([mixed], "isa", "minimal").map((x) => x.event.id), ["mixed"],
     "one away activity among several is still enough to survive Minimal");
});

/* ---- icons ---- */
test("the catalogue from round 1b, and person icons follow the viewer", () => {
  /* F33: the CD icon is gone from the catalogue; 🎶 stays the default */
  eq(CATEGORIES.find((c) => c.type === "live-music").icons[0].icon, "🎶");
  ok(!CATEGORIES.find((c) => c.type === "live-music").icons.some((i) => i.icon === "💿"));
  ok(!CATEGORIES.find((c) => c.type === "party"));
  const run = { type: "sport", icon: "running" };
  eq([iconFor(run, { owner: "shared" }, "isa"), iconFor(run, { owner: "shared" }, "hugo"), iconFor(run, { owner: "hugo" }, "isa")], ["🏃‍♀️", "🏃‍♂️", "🏃‍♂️"]);
  eq(iconFor({ type: "drinks", icon: "🍻" }, { owner: "isa" }, "hugo"), "🍻");
  eq(iconFor({ type: "nonsense", icon: "" }, { owner: "isa" }, "isa"), "📌");
});

test("the catalogue has a work event category (Isa, 2026-09-24)", () => {
  const work = CATEGORIES.find((c) => c.type === "work");
  ok(work, "work category");
  eq([work.label, work.icons.map((i) => i.icon)], ["Work event", ["🏢", "💻", "🎤"]]);
});
