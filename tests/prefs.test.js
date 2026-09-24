import { test, eq, ok } from "./run.js";
import { readPrefs, isShown, toggleCategory, byCategories, defaultsSummary, categoriesSummary } from "../js/prefs.js";

const ev = (id, types) => ({ id, activities: types.map((type) => ({ type })) });

test("prefs: every category shows in every view by default", () => {
  const p = readPrefs({});
  ok(isShown(p, "isa", "weekly", "cinema"));
  ok(isShown(p, "hugo", "yearly", "none"));
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["weekly", "full", "lines"]);
});
test("prefs: a toggle is per person and per view", () => {
  const p = toggleCategory(readPrefs({}), "isa", "yearly", "cinema");
  eq(isShown(p, "isa", "yearly", "cinema"), false);
  ok(isShown(p, "isa", "weekly", "cinema"), "other view untouched");
  ok(isShown(p, "hugo", "yearly", "cinema"), "other person untouched");
  ok(isShown(toggleCategory(p, "isa", "yearly", "cinema"), "isa", "yearly", "cinema"), "toggling back shows it");
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
  p = toggleCategory(toggleCategory(p, "isa", "yearly", "cinema"), "isa", "yearly", "gaming");
  eq(categoriesSummary(p, "isa"), "Weekly all, Monthly all, Yearly 16");
  eq(categoriesSummary(p, "hugo"), "Weekly all, Monthly all, Yearly all");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3, cardStyle: null, hiddenCategories: { isa: { weekly: "cinema" }, eve: {} } });
  eq([p.defaultView, p.defaultDetail, p.cardStyle], ["weekly", "full", "lines"]);
  ok(isShown(p, "isa", "weekly", "cinema"));
  eq(Object.keys(p.hiddenCategories).sort(), ["hugo", "isa"]);
});
