import { test, eq, ok } from "./run.js";
import { readPrefs, defaultsSummary } from "../js/prefs.js";

test("prefs: the defaults", () => {
  const p = readPrefs({});
  eq([p.defaultView, p.defaultDetail, p.showWeekdayHeader], ["grid", "full", true]);
});
test("prefs: a stored hidden-categories list is ignored, so nothing can stay hidden", () => {
  const p = readPrefs({ hiddenCategories: { isa: { grid: ["drinks"] } } });
  eq("hiddenCategories" in p, false);
});
test("prefs: the Calendar defaults summary", () => {
  const p = readPrefs({ defaultView: "agenda", defaultDetail: "minimal" });
  eq(defaultsSummary(p), "Agenda, Minimal");
});
test("prefs: a saved Partial (retired 2026-10-11) reads as Full", () => {
  eq(readPrefs({ defaultDetail: "partial" }).defaultDetail, "full");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3 });
  eq([p.defaultView, p.defaultDetail], ["grid", "full"]);
});
test("prefs: old view names in a saved default migrate", () => {
  eq(readPrefs({ defaultView: "yearly" }).defaultView, "grid", "yearly became grid");
  eq(readPrefs({ defaultView: "glance" }).defaultView, "grid", "glance became grid");
  eq(readPrefs({ defaultView: "monthly" }).defaultView, "agenda", "monthly became agenda");
  eq(readPrefs({ defaultView: "weekly" }).defaultView, "grid", "weekly has no successor: the default");
});
