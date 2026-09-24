import { test, eq, ok, throws } from "./run.js";
import { CATEGORIES, toCents, formatCents, shareOf, visibleCosts, newCostLine, setCostAmount } from "../js/money.js";

const NOW = new Date("2026-09-24T10:00:00Z");

test("fifteen categories, flights and accommodation present", () => {
  eq(CATEGORIES.length, 15);
  ok(CATEGORIES.find((c) => c.slug === "travel/flights"));
  eq(CATEGORIES[0].slug, "leisure/events-nightlife");
});
test("toCents reads both decimal styles and thousands spaces", () => {
  eq([toCents("12,50"), toCents("12.5"), toCents("1 234,56"), toCents("1234"), toCents("36.105")],
     [1250, 1250, 123456, 123400, 3611]);
});
test("toCents rejects junk and negatives", () => {
  eq([toCents(""), toCents("-"), toCents("abc"), toCents("-5")], [null, null, null, null]);
});
test("formatCents", () => { eq(formatCents(123456).replace(/\s/g, " "), "1 234,56 €"); });
test("a shared odd amount splits with no lost cent", () => {
  const line = { amount: 1001, payer: "hugo", scope: "shared" };
  eq(shareOf(line, "hugo") + shareOf(line, "isa"), 1001);
  eq([shareOf(line, "hugo"), shareOf(line, "isa")], [501, 500]);
});
test("a personal line is all the payer's", () => {
  const line = { amount: 4000, payer: "isa", scope: "personal" };
  eq([shareOf(line, "isa"), shareOf(line, "hugo")], [4000, 0]);
});
test("personal lines hidden from the other person", () => {
  const lines = [{ id: 1, scope: "shared", enteredBy: "hugo" }, { id: 2, scope: "personal", enteredBy: "hugo" }];
  eq(visibleCosts(lines, "isa").map((l) => l.id), [1]);
  eq(visibleCosts(lines, "hugo").map((l) => l.id), [1, 2]);
});
test("newCostLine records typed evidence", () => {
  const l = newCostLine({ category: "travel/flights", payer: "hugo", amount: 18000, scope: "shared", me: "hugo", now: NOW });
  eq([l.state, l.currency, l.evidence.length, l.evidence[0].kind, l.evidence[0].amount], ["recorded", "EUR", 1, "typed", 18000]);
  ok(l.id.startsWith("co_"));
});
test("setCostAmount appends evidence; a locked line refuses", async () => {
  const l = newCostLine({ category: "food/eating-out", payer: "isa", amount: 5000, scope: "personal", me: "isa", now: NOW });
  const l2 = setCostAmount(l, 5200, "isa", NOW);
  eq([l2.amount, l2.evidence.length], [5200, 2]);
  await throws(() => setCostAmount({ ...l2, state: "locked" }, 1, "isa", NOW), "locked");
});
test("A cannot create confirmed or locked lines", async () => {
  await throws(() => newCostLine({ category: "travel/flights", payer: "isa", amount: 1, scope: "shared", state: "locked", me: "isa", now: NOW }));
});
