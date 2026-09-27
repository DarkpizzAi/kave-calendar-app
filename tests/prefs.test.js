import { test, eq, ok } from "./run.js";
import { readPrefs, isShown, toggleCategory, byCategories, defaultsSummary, categoriesSummary, resetCategories, blocksFreeTime, toggleBlocking, eventBlocksFreeTime, BLOCKING_DEFAULT, freeTimeSummary } from "../js/prefs.js";

const ev = (id, types) => ({ id, activities: types.map((type) => ({ type })) });

test("prefs: every category shows in Weekly and Monthly by default", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "grid", "cinema"));
  ok(isShown(p, "hugo", "agenda", "none"));
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["glance", "full", "lines"]);
});

/* F17: the drift Isa found -- the Categories grid said "everything on" while
   Yearly only ever drew trips away, visitors and business trips. The grid's
   stored default now matches that real filter, in both directions: the four
   "big" categories on, everything else (including "none"/Other) off. */
test("prefs: Yearly starts on its real filter, not 'everything on' (F17)", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "glance", "transport"));
  ok(isShown(p, "isa", "glance", "accommodation"));
  ok(isShown(p, "isa", "glance", "business-trip"));
  ok(isShown(p, "hugo", "glance", "visitor"));
  ok(!isShown(p, "isa", "glance", "drinks"), "Isa's exact complaint: drinks read as on but never showed");
  ok(!isShown(p, "hugo", "glance", "birthday"));
  ok(!isShown(p, "hugo", "glance", "none"));
});
test("prefs: a toggle is per person and per view", () => {
  /* "transport" is one of Yearly's real defaults (F17: shown, not cinema)
     so toggling it actually hides something rather than un-hiding it. */
  const p = toggleCategory(readPrefs({}), "isa", "glance", "transport");
  eq(isShown(p, "isa", "glance", "transport"), false);
  ok(isShown(p, "isa", "grid", "transport"), "other view untouched");
  ok(isShown(p, "hugo", "glance", "transport"), "other person untouched");
  ok(isShown(toggleCategory(p, "isa", "glance", "transport"), "isa", "glance", "transport"), "toggling back shows it");
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
  /* F17: the spec's own example (section 3, Settings) -- "Weekly all,
     Monthly all, Yearly 4" -- is the default now, not "Yearly all". */
  eq(categoriesSummary(p, "isa"), "Glance 4, Grid all, Agenda all");
  p = toggleCategory(toggleCategory(p, "isa", "glance", "transport"), "isa", "glance", "visitor");
  eq(categoriesSummary(p, "isa"), "Glance 2, Grid all, Agenda all", "two of the four hidden");
  eq(categoriesSummary(p, "hugo"), "Glance 4, Grid all, Agenda all");
});

test("prefs: resetCategories restores the corrected Yearly defaults, not the old bug (F18)", () => {
  let p = readPrefs({});
  p = toggleCategory(p, "isa", "glance", "drinks"); // Isa un-hides drinks for Yearly
  p = toggleCategory(p, "isa", "glance", "transport"); // and hides transport
  p = toggleCategory(p, "hugo", "grid", "cinema"); // Hugo hides cinema in Weekly
  const r = resetCategories(p);
  ok(isShown(r, "isa", "glance", "transport"), "back to shown");
  ok(!isShown(r, "isa", "glance", "drinks"), "back to hidden -- the real default, not 'everything on'");
  ok(isShown(r, "hugo", "grid", "cinema"), "every person and view resets, not just the one touched");
  eq(categoriesSummary(r, "isa"), "Glance 4, Grid all, Agenda all");
  eq(categoriesSummary(r, "hugo"), "Glance 4, Grid all, Agenda all");
  eq([r.defaultView, r.defaultDetail, r.cardStyle], [p.defaultView, p.defaultDetail, p.cardStyle], "reset touches categories only");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3, cardStyle: null, hiddenCategories: { isa: { grid: "cinema" }, eve: {} } });
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["glance", "full", "lines"]);
  ok(isShown(p, "isa", "grid", "cinema"));
  eq(Object.keys(p.hiddenCategories).sort(), ["hugo", "isa"]);
});
test("prefs: old-named stored settings migrate to the new view names", () => {
  const stored = {
    defaultView: "yearly",
    hiddenCategories: { isa: { yearly: ["drinks", "transport"], weekly: ["eating"] }, hugo: { monthly: ["birthday"] } },
  };
  const p = readPrefs(stored);
  eq(p.defaultView, "glance", "yearly -> glance");
  eq(p.hiddenCategories.isa.glance, ["drinks", "transport"], "yearly's hidden list moved to glance");
  eq(p.hiddenCategories.isa.grid, ["eating"], "weekly's hidden list moved to grid");
  eq(p.hiddenCategories.hugo.agenda, ["birthday"], "monthly's hidden list moved to agenda");
});
