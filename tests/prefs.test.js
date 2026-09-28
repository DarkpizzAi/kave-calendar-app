import { test, eq, ok } from "./run.js";
import { readPrefs, defaultsSummary, blocksFreeTime, toggleBlocking, eventBlocksFreeTime, BLOCKING_DEFAULT, freeTimeSummary } from "../js/prefs.js";
import { CATEGORIES } from "../js/icons.js";

test("prefs: the defaults", () => {
  const p = readPrefs({});
  eq([p.defaultView, p.defaultDetail, p.showWeekdayHeader], ["grid", "full", true]);
});
test("prefs: a stored hidden-categories list is ignored, so nothing can stay hidden", () => {
  const p = readPrefs({ hiddenCategories: { isa: { grid: ["drinks"] } } });
  eq("hiddenCategories" in p, false);
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
  eq(freeTimeSummary(p), `${BLOCKING_DEFAULT.length} of ${CATEGORIES.length} block`);
  p = toggleBlocking(p, "transport");
  eq(freeTimeSummary(p), `${BLOCKING_DEFAULT.length - 1} of ${CATEGORIES.length} block`);
});
test("prefs: the Calendar defaults summary", () => {
  const p = readPrefs({ defaultView: "grid", defaultDetail: "partial" });
  eq(defaultsSummary(p), "Grid, Partial");
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
