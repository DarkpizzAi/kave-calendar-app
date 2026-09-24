import { test, eq, ok, throws } from "./run.js";
import { newEvent, validateEvent, touch, yearOf, markDeleted, restore, writesFor, mainType, addLink } from "../js/model.js";

const NOW = new Date("2026-09-24T10:00:00Z");
const LATER = new Date("2026-09-24T11:00:00Z");

test("newEvent fills defaults", () => {
  const e = newEvent({ title: "La Colectiva", start: "2026-09-26" }, { me: "isa", now: NOW });
  eq([e.owner, e.status, e.activities, e.links, e.deleted, e.source.kind, e.updated.by, e.costs.length],
     ["isa", "planned", [], [], false, "app", "isa", 0]);
  ok(e.id.startsWith("ev_"));
});
test("an event needs a title and an exact day", () => {
  eq(validateEvent({ title: "", start: "2026-02-30" }), ["title is required", "date is not valid"]);
  eq(validateEvent({ title: "x", start: "2026-11" }), ["an event needs an exact day; without one it is an idea"]);
  eq(validateEvent({ title: "x", start: "2026-10-02", end: "2026-10-01" }), ["end is before start"]);
  eq(validateEvent({ title: "x", start: "2026-10-02", end: "2026-10" }), ["end must be an exact day"]);
});
test("newEvent refuses an invalid event, and refuses without a person (Review Focus 5)", async () => {
  await throws(() => newEvent({ title: " ", start: "2026-09-26" }, { me: "isa", now: NOW }));
  await throws(() => newEvent({ title: "x", start: "2026-09-26" }, { me: "", now: NOW }));
});
test("activities keep their order; the first is the main one", () => {
  const e = newEvent({ title: "Night out", start: "2026-09-26",
    activities: [{ type: "eating", icon: "🍝" }, { type: "drinks", icon: "🍸" }, { type: "clubbing", icon: "🪩" }] }, { me: "isa", now: NOW });
  eq(e.activities.map((a) => a.type), ["eating", "drinks", "clubbing"]);
  eq([mainType(e), mainType({ activities: [] })], ["eating", "none"]);
});
test("an activity needs a known shape", () => {
  eq(validateEvent({ title: "x", start: "2026-10-02", activities: [{ type: "", icon: "🍸" }] }), ["every activity needs a category"]);
});
test("links keep only safe http(s) urls", () => {
  const e = newEvent({ title: "Solomun", start: "2026-09-05" }, { me: "isa", now: NOW });
  const e2 = addLink(e, { label: "Ticket, Resident Advisor", url: "https://ra.co/events/1" });
  eq(e2.links, [{ label: "Ticket, Resident Advisor", url: "https://ra.co/events/1" }]);
  eq(addLink(e, { label: "x", url: "javascript:alert(1)" }).links, []);
  eq(addLink(e2, { label: "again", url: "https://ra.co/events/1" }).links.length, 1);
});
test("touch stamps who and when", () => {
  eq(touch({ id: "ev_1" }, "hugo", LATER).updated, { at: "2026-09-24T11:00:00.000Z", by: "hugo" });
});
test("delete and restore keep the timestamps merge needs", () => {
  const e = newEvent({ title: "x", start: "2026-09-26" }, { me: "isa", now: NOW });
  const d = markDeleted(e, "isa", NOW);
  eq([d.deleted, d.deletedAt], [true, NOW.toISOString()]);
  const r = restore(d, "isa", LATER);
  eq([r.deleted, r.restoredAt], [false, LATER.toISOString()]);
});
test("writesFor: same year is one write", () => {
  const prev = { id: "ev_1", start: "2026-09-26" };
  eq(writesFor(prev, { ...prev, title: "y" }).map((w) => w.year), ["2026"]);
});
test("writesFor: a year change writes a moved marker to the old year (Review Focus 2)", () => {
  const prev = { id: "ev_1", start: "2026-12-30", updated: { at: "a", by: "isa" } };
  const next = { ...prev, start: "2027-01-02", updated: { at: "b", by: "isa" } };
  const w = writesFor(prev, next);
  eq(w.map((x) => x.year), ["2027", "2026"]);
  eq([w[1].record.id, w[1].record.deleted, w[1].record.movedTo, w[1].record.updated.at], ["ev_1", true, "2027", "b"]);
});
test("yearOf", () => { eq(yearOf({ start: "2025-08-14" }), "2025"); });
