import { test, eq, ok } from "./run.js";
import { loadRange } from "../js/views.js";
import { applyDetail } from "../js/filter.js";
import { CATEGORIES, iconFor, onlyIcon, categoryOf } from "../js/icons.js";
import { HOLIDAYS, STATUS, isProvisional } from "../js/holidays.js";

const ev = (id, s, extra = {}) => ({ id, title: id, start: s, end: null, owner: "shared", activities: [], ...extra });

test("load range: 1 January back, end of the year after next forward, or the last event", () => {
  eq(loadRange("2026-09-24", "2026-12-12"), { min: "2026-01-01", max: "2028-12-31" });
  eq(loadRange("2026-09-24", "2029-05-02"), { min: "2026-01-01", max: "2029-05-02" });
});

/* ---- the holiday table itself ---- */
test("holidays: every listed year has a status, and no holiday falls on a Sunday", () => {
  const years = [...new Set(Object.keys(HOLIDAYS).map((d) => d.slice(0, 4)))];
  eq(years.filter((y) => !STATUS[y]), []);
  eq(Object.keys(HOLIDAYS).filter((d) => new Date(d + "T12:00:00Z").getUTCDay() === 0), []);
  eq([isProvisional("2027-01-01"), isProvisional("2029-05-21")], [false, true]);
});

/* ---- detail levels ---- */
test("detail levels: the other person is greyed at every level, minimal hides them except when away", () => {
  const list = [
    ev("m", "2026-10-01", { owner: "isa" }),
    ev("o", "2026-10-01"),
    ev("t", "2026-10-01", { owner: "hugo" }),
    ev("trip", "2026-10-01", { owner: "hugo", activities: [{ type: "transport" }] }),
  ];
  eq(applyDetail(list, "isa", "full").map((x) => [x.event.id, x.grey]),
     [["m", false], ["o", false], ["t", true], ["trip", true]], "Agenda greys like Grid (Isa, 2026-10-11)");
  eq(applyDetail(list, "isa", "minimal").map((x) => [x.event.id, x.grey]),
     [["m", false], ["o", false], ["trip", true]]);
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
  eq([work.label, work.icons.map((i) => i.icon)], ["Work event", ["💼"]]);
});

const iconsOf = (type) => categoryOf(type).icons.map((i) => i.icon);
test("catalogue, Isa's review 2026-10-11: work and business trip are both the briefcase, a visitor is the house", () => {
  eq([iconsOf("work"), iconsOf("business-trip"), iconsOf("visitor")], [["💼"], ["💼"], ["🏠"]]);
});
test("catalogue, Isa's review: tennis and padel share the tennis ball, no ping pong, no medal", () => {
  const sport = iconsOf("sport");
  eq([sport.includes("🎾"), sport.includes("🏓"), sport.includes("🏅")], [true, false, false]);
});
test("catalogue, Isa's review: the additions to Eating out and Paid activity, and a Health appointment", () => {
  ok(["🥘", "🥐", "🍦"].every((i) => iconsOf("eating").includes(i)), "eating additions");
  ok(["🧩", "💆"].every((i) => iconsOf("activity").includes(i)), "activity additions");
  eq(iconsOf("health"), ["🩺", "🦷"]);
  eq(categoryOf("health").label, "Health appointment");
});
test("a category with exactly one icon has nothing to pick: onlyIcon returns it, else null", () => {
  eq([onlyIcon("work"), onlyIcon("visitor"), onlyIcon("cinema"), onlyIcon("none")], ["💼", "🏠", "🎬", "📌"]);
  eq([onlyIcon("eating"), onlyIcon("health"), onlyIcon("nope")], [null, null, null]);
});
test("a retired icon on stored data falls back: an old Work building shows the briefcase", () => {
  eq(iconFor({ type: "work", icon: "🏢" }, { owner: "isa" }, "isa"), "💼");
});

test("iconFor only ever returns a catalogue icon", () => {
  eq(iconFor({ type: "transport", icon: "🛩" }, { owner: "isa" }, "isa"), "✈️", "a retired icon falls back to the category's first");
  eq(iconFor({ type: "eating", icon: '<b id="x">x</b>' }, { owner: "isa" }, "isa"), "🍴", "markup in the data never comes back out");
  eq(iconFor({ type: "eating", icon: "🍕" }, { owner: "isa" }, "isa"), "🍕", "a listed icon is kept");
});

/* ---- navigation (Material 3 shell) ---- */
test("navigation: two tabs, Trips and Radar in the roadmap", async () => {
  const { VIEWS } = await import("../js/render.js");
  const { ROADMAP } = await import("../js/view-roadmap.js");
  eq(Object.keys(VIEWS), ["calendar", "insights"]);
  eq(ROADMAP.map((r) => r.key), ["calendar", "insights", "trips", "radar"]);
  eq(ROADMAP.map((r) => r.live), [true, true, false, false]);
});
