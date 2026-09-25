import { test, eq, ok } from "./run.js";
import { readPrefs, isShown, toggleCategory, byCategories, defaultsSummary, categoriesSummary, resetCategories } from "../js/prefs.js";

const ev = (id, types) => ({ id, activities: types.map((type) => ({ type })) });

test("prefs: every category shows in Weekly and Monthly by default", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "weekly", "cinema"));
  ok(isShown(p, "hugo", "monthly", "none"));
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["weekly", "full", "lines"]);
});

/* F17: the drift Isa found -- the Categories grid said "everything on" while
   Yearly only ever drew trips away, visitors and business trips. The grid's
   stored default now matches that real filter, in both directions: the four
   "big" categories on, everything else (including "none"/Other) off. */
test("prefs: Yearly starts on its real filter, not 'everything on' (F17)", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "yearly", "transport"));
  ok(isShown(p, "isa", "yearly", "accommodation"));
  ok(isShown(p, "isa", "yearly", "business-trip"));
  ok(isShown(p, "hugo", "yearly", "visitor"));
  ok(!isShown(p, "isa", "yearly", "drinks"), "Isa's exact complaint: drinks read as on but never showed");
  ok(!isShown(p, "hugo", "yearly", "birthday"));
  ok(!isShown(p, "hugo", "yearly", "none"));
});
test("prefs: a toggle is per person and per view", () => {
  /* "transport" is one of Yearly's real defaults (F17: shown, not cinema)
     so toggling it actually hides something rather than un-hiding it. */
  const p = toggleCategory(readPrefs({}), "isa", "yearly", "transport");
  eq(isShown(p, "isa", "yearly", "transport"), false);
  ok(isShown(p, "isa", "weekly", "transport"), "other view untouched");
  ok(isShown(p, "hugo", "yearly", "transport"), "other person untouched");
  ok(isShown(toggleCategory(p, "isa", "yearly", "transport"), "isa", "yearly", "transport"), "toggling back shows it");
});
test("prefs: an event hides only when none of its activities' categories shows", () => {
  let p = toggleCategory(readPrefs({}), "isa", "weekly", "eating");
  const dinnerOnly = ev("d", ["eating"]), night = ev("n", ["eating", "drinks"]);
  eq(byCategories([dinnerOnly, night], p, "isa", "weekly").map((e) => e.id), ["n"]);
  p = toggleCategory(p, "isa", "weekly", "drinks");
  eq(byCategories([dinnerOnly, night], p, "isa", "weekly").map((e) => e.id), []);
});
test("prefs: an event with no activity counts as Other", () => {
  const p = toggleCategory(readPrefs({}), "hugo", "monthly", "none");
  eq(byCategories([ev("x", [])], p, "hugo", "monthly").length, 0);
  eq(byCategories([ev("x", [])], p, "isa", "monthly").length, 1);
});
test("prefs: summaries for the two Settings buttons", () => {
  let p = readPrefs({ defaultView: "monthly", defaultDetail: "partial", cardStyle: "icons" });
  eq(defaultsSummary(p), "Monthly, Partial, Icons only");
  /* F17: the spec's own example (section 3, Settings) -- "Weekly all,
     Monthly all, Yearly 4" -- is the default now, not "Yearly all". */
  eq(categoriesSummary(p, "isa"), "Weekly all, Monthly all, Yearly 4");
  p = toggleCategory(toggleCategory(p, "isa", "yearly", "transport"), "isa", "yearly", "visitor");
  eq(categoriesSummary(p, "isa"), "Weekly all, Monthly all, Yearly 2", "two of the four hidden");
  eq(categoriesSummary(p, "hugo"), "Weekly all, Monthly all, Yearly 4");
});

test("prefs: resetCategories restores the corrected Yearly defaults, not the old bug (F18)", () => {
  let p = readPrefs({});
  p = toggleCategory(p, "isa", "yearly", "drinks"); // Isa un-hides drinks for Yearly
  p = toggleCategory(p, "isa", "yearly", "transport"); // and hides transport
  p = toggleCategory(p, "hugo", "weekly", "cinema"); // Hugo hides cinema in Weekly
  const r = resetCategories(p);
  ok(isShown(r, "isa", "yearly", "transport"), "back to shown");
  ok(!isShown(r, "isa", "yearly", "drinks"), "back to hidden -- the real default, not 'everything on'");
  ok(isShown(r, "hugo", "weekly", "cinema"), "every person and view resets, not just the one touched");
  eq(categoriesSummary(r, "isa"), "Weekly all, Monthly all, Yearly 4");
  eq(categoriesSummary(r, "hugo"), "Weekly all, Monthly all, Yearly 4");
  eq([r.defaultView, r.defaultDetail, r.cardStyle], [p.defaultView, p.defaultDetail, p.cardStyle], "reset touches categories only");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3, cardStyle: null, hiddenCategories: { isa: { weekly: "cinema" }, eve: {} } });
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["weekly", "full", "lines"]);
  ok(isShown(p, "isa", "weekly", "cinema"));
  eq(Object.keys(p.hiddenCategories).sort(), ["hugo", "isa"]);
});
