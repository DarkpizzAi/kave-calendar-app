import { test, eq, ok } from "./run.js";
import { readPrefs, isShown, toggleCategory, byCategories, defaultsSummary, categoriesSummary, resetCategories, blocksFreeTime, toggleBlocking, eventBlocksFreeTime, BLOCKING_DEFAULT, freeTimeSummary } from "../js/prefs.js";

const ev = (id, types) => ({ id, activities: types.map((type) => ({ type })) });

test("prefs: every category shows in every view by default", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "grid", "cinema"), "the Grid emoji redesign shows everything, not just big things");
  ok(isShown(p, "hugo", "agenda", "none"));
  ok(isShown(p, "isa", "grid", "drinks"));
  ok(isShown(p, "hugo", "grid", "none"));
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["grid", "full", "lines"]);
});
test("prefs: a toggle is per person and per view", () => {
  const p = toggleCategory(readPrefs({}), "isa", "grid", "transport");
  eq(isShown(p, "isa", "grid", "transport"), false);
  ok(isShown(p, "isa", "agenda", "transport"), "other view untouched");
  ok(isShown(p, "hugo", "grid", "transport"), "other person untouched");
  ok(isShown(toggleCategory(p, "isa", "grid", "transport"), "isa", "grid", "transport"), "toggling back shows it");
});
test("prefs: free-time blocking defaults to things usually booked ahead", () => {
  const p = readPrefs({});
  ok(blocksFreeTime(p, "transport"));
  ok(blocksFreeTime(p, "accommodation"));
  ok(blocksFreeTime(p, "business-trip"));
  ok(blocksFreeTime(p, "work"));
  ok(blocksFreeTime(p, "live-music"));
  ok(blocksFreeTime(p, "cinema"));
  ok(!blocksFreeTime(p, "eating"), "casual, easy to move");
  ok(!blocksFreeTime(p, "none"), "no activity at all never blocks");
});
test("prefs: blocking is one shared list, not per person", () => {
  const p = readPrefs({});
  eq(p.blockingCategories, BLOCKING_DEFAULT);
});
test("prefs: toggling blocking off and back on returns to the start", () => {
  let p = readPrefs({});
  ok(blocksFreeTime(p, "transport"));
  p = toggleBlocking(p, "transport");
  ok(!blocksFreeTime(p, "transport"));
  p = toggleBlocking(p, "transport");
  ok(blocksFreeTime(p, "transport"));
});
test("prefs: eventBlocksFreeTime is per category, never per owner", () => {
  const p = readPrefs({});
  const sharedFlight = { activities: [{ type: "transport" }], owner: "shared" };
  const hugosDinner = { activities: [{ type: "eating" }], owner: "hugo" };
  const noActivity = { activities: [], owner: "isa" };
  const mixed = { activities: [{ type: "eating" }, { type: "transport" }], owner: "isa" };
  ok(eventBlocksFreeTime(p, sharedFlight), "blocking category, shared owner, still blocks");
  ok(!eventBlocksFreeTime(p, hugosDinner), "non-blocking category, not affected by whose it is");
  ok(!eventBlocksFreeTime(p, noActivity), "no activities reads as \"none\", never blocks");
  ok(eventBlocksFreeTime(p, mixed), "any one blocking activity is enough");
});
test("prefs: stored blocking junk falls back to the default", () => {
  eq(readPrefs({ blockingCategories: "nonsense" }).blockingCategories, BLOCKING_DEFAULT);
  eq(readPrefs({ blockingCategories: ["transport", "not-a-real-type"] }).blockingCategories, ["transport"]);
});
test("prefs: freeTimeSummary counts how many categories block", () => {
  let p = readPrefs({});
  eq(freeTimeSummary(p), `${BLOCKING_DEFAULT.length} of 19 block`);
  p = toggleBlocking(p, "transport");
  eq(freeTimeSummary(p), `${BLOCKING_DEFAULT.length - 1} of 19 block`);
});
test("prefs: an event hides only when none of its activities' categories shows", () => {
  let p = toggleCategory(readPrefs({}), "isa", "grid", "eating");
  const dinnerOnly = ev("d", ["eating"]), night = ev("n", ["eating", "drinks"]);
  eq(byCategories([dinnerOnly, night], p, "isa", "grid").map((e) => e.id), ["n"]);
  p = toggleCategory(p, "isa", "grid", "drinks");
  eq(byCategories([dinnerOnly, night], p, "isa", "grid").map((e) => e.id), []);
});
test("prefs: an event with no activity counts as Other", () => {
  const p = toggleCategory(readPrefs({}), "hugo", "agenda", "none");
  eq(byCategories([ev("x", [])], p, "hugo", "agenda").length, 0);
  eq(byCategories([ev("x", [])], p, "isa", "agenda").length, 1);
});
test("prefs: summaries for the two Settings buttons", () => {
  let p = readPrefs({ defaultView: "grid", defaultDetail: "partial", cardStyle: "icons" });
  eq(defaultsSummary(p), "Grid, Partial, Icons only");
  eq(categoriesSummary(p, "isa"), "Grid all, Agenda all");
  p = toggleCategory(toggleCategory(p, "isa", "grid", "transport"), "isa", "grid", "visitor");
  eq(categoriesSummary(p, "isa"), "Grid 17, Agenda all", "two of the nineteen hidden");
  eq(categoriesSummary(p, "hugo"), "Grid all, Agenda all");
});

test("prefs: resetCategories restores nothing hidden, in every view", () => {
  let p = readPrefs({});
  p = toggleCategory(p, "isa", "grid", "drinks");
  p = toggleCategory(p, "hugo", "agenda", "cinema");
  const r = resetCategories(p);
  ok(isShown(r, "isa", "grid", "drinks"), "back to shown");
  ok(isShown(r, "hugo", "agenda", "cinema"), "every person and view resets, not just the one touched");
  eq(categoriesSummary(r, "isa"), "Grid all, Agenda all");
  eq(categoriesSummary(r, "hugo"), "Grid all, Agenda all");
  eq([r.defaultView, r.defaultDetail, r.cardStyle], [p.defaultView, p.defaultDetail, p.cardStyle], "reset touches categories only");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3, cardStyle: null, hiddenCategories: { isa: { grid: "cinema" }, eve: {} } });
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["grid", "full", "lines"]);
  ok(isShown(p, "isa", "grid", "cinema"));
  eq(Object.keys(p.hiddenCategories).sort(), ["hugo", "isa"]);
});
test("prefs: old-named stored settings migrate to the new view names", () => {
  const stored = {
    defaultView: "yearly",
    hiddenCategories: { isa: { yearly: ["drinks", "transport"], weekly: ["eating"] }, hugo: { monthly: ["birthday"] } },
  };
  const p = readPrefs(stored);
  eq(p.defaultView, "grid", "yearly -> glance -> grid");
  eq(p.hiddenCategories.isa.grid, ["drinks", "transport"], "yearly's hidden list moved to grid");
  eq(p.hiddenCategories.hugo.agenda, ["birthday"], "monthly's hidden list moved to agenda");
});
test("prefs: the deleted weekly grid view's saved settings are discarded, not merged into the new Grid", () => {
  const stored = {
    defaultView: "grid",
    hiddenCategories: { isa: { grid: ["eating"], glance: ["drinks"] } },
  };
  const p = readPrefs(stored);
  eq(p.defaultView, "grid", "stored 'grid' meant the old weekly view; it's gone, so this falls back to the default");
  eq(p.hiddenCategories.isa.grid, ["drinks"], "only glance's list survives, under its new name; the old weekly grid's list is dropped");
});
