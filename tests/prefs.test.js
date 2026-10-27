import { test, eq, ok } from "./run.js";
import { readPrefs, defaultsSummary } from "../js/prefs.js";
import { DAY_PRIORITY } from "../js/cal-model.js";
import { CATEGORIES } from "../js/icons.js";

test("prefs: the defaults", () => {
  const p = readPrefs({});
  eq([p.defaultView, p.defaultDetail, "showWeekdayHeader" in p], ["week", "full", false]);
  eq(p.gridOrder, DAY_PRIORITY);
});
test("prefs: a stored hidden-categories list is ignored, so nothing can stay hidden", () => {
  const p = readPrefs({ hiddenCategories: { isa: { grid: ["drinks"] } } });
  eq("hiddenCategories" in p, false);
});
test("prefs: the Calendar defaults summary", () => {
  const p = readPrefs({ defaultView: "month", defaultDetail: "minimal" });
  eq(defaultsSummary(p), "Month, Minimal");
});
test("prefs: a saved Partial (retired 2026-10-11) reads as Full", () => {
  eq(readPrefs({ defaultDetail: "partial" }).defaultDetail, "full");
});
test("prefs: stored junk falls back to defaults", () => {
  const p = readPrefs({ defaultView: "daily", defaultDetail: 3 });
  eq([p.defaultView, p.defaultDetail], ["week", "full"]);
});
test("prefs: old view names in a saved default migrate (grid to month, agenda to week)", () => {
  eq(readPrefs({ defaultView: "grid" }).defaultView, "month", "grid became month");
  eq(readPrefs({ defaultView: "agenda" }).defaultView, "week", "agenda became week");
  eq(readPrefs({ defaultView: "yearly" }).defaultView, "month", "yearly was grid, now month");
  eq(readPrefs({ defaultView: "glance" }).defaultView, "month", "glance was grid, now month");
  eq(readPrefs({ defaultView: "monthly" }).defaultView, "week", "monthly was agenda, now week");
  eq(readPrefs({ defaultView: "weekly" }).defaultView, "week", "weekly has no successor: the default");
  eq([readPrefs({ defaultView: "week" }).defaultView, readPrefs({ defaultView: "month" }).defaultView], ["week", "month"], "the new names are kept");
});
test("prefs: a stored Weekday letters value is ignored", () => {
  eq("showWeekdayHeader" in readPrefs({ showWeekdayHeader: false }), false);
});
test("prefs: gridOrder keeps the stored order, drops junk and repeats, Other last", () => {
  const o = readPrefs({ gridOrder: ["live-music", "bogus", "transport", "live-music", "none"] }).gridOrder;
  eq(o.slice(0, 2), ["live-music", "transport"]);
  eq(o[o.length - 1], "none");
  eq([...o].sort(), CATEGORIES.map((c) => c.type).sort(), "every category once");
});
test("prefs: a category missing from the stored order goes just above Other", () => {
  const stored = DAY_PRIORITY.filter((t) => t !== "none" && t !== "health");
  const o = readPrefs({ gridOrder: stored }).gridOrder;
  eq(o.slice(-2), ["health", "none"]);
  eq(readPrefs({ gridOrder: "junk" }).gridOrder, DAY_PRIORITY);
});
