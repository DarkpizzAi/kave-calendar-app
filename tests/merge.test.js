import { test, eq } from "./run.js";
import { mergeEvents, collectYears } from "../js/merge.js";

const ev = (id, at, extra = {}) => ({ id, title: id + at, updated: { at, by: "isa" }, deleted: false, ...extra });

test("newest edit wins per event, others untouched", () => {
  const out = mergeEvents([ev("a", "1"), ev("b", "5")], [ev("a", "2"), ev("b", "3"), ev("c", "1")]);
  eq(out.map((e) => e.title), ["a2", "b5", "c1"]);
});
test("equal timestamps break ties by person, deterministically", () => {
  const x = { ...ev("a", "1"), updated: { at: "1", by: "hugo" }, title: "h" };
  const y = { ...ev("a", "1"), updated: { at: "1", by: "isa" }, title: "i" };
  eq(mergeEvents([x], [y])[0].title, mergeEvents([y], [x])[0].title);
});
test("a later offline edit does not undo a delete (Review Focus 1)", () => {
  const del = ev("a", "5", { deleted: true, deletedAt: "5" });
  const stale = ev("a", "9");
  eq(mergeEvents([del], [stale])[0].deleted, true);
  eq(mergeEvents([stale], [del])[0].deleted, true);
});
test("a restore made after the delete brings it back", () => {
  const del = ev("a", "5", { deleted: true, deletedAt: "5" });
  const back = ev("a", "6", { restoredAt: "6" });
  eq(mergeEvents([del], [back])[0].deleted, false);
});
test("collectYears hides deleted and moved markers, no duplicates (Review Focus 2)", () => {
  const moved = { id: "a", deleted: true, deletedAt: "2", movedTo: "2027", updated: { at: "2", by: "isa" } };
  const out = collectYears({ 2026: [moved, ev("b", "1")], 2027: [ev("a", "2", { start: "2027-01-02" })] });
  eq(out.map((e) => e.id).sort(), ["a", "b"]);
});
test("collectYears keeps the newest copy if an event exists in two files", () => {
  const out = collectYears({ 2026: [ev("a", "1")], 2027: [ev("a", "3")] });
  eq(out.map((e) => e.title), ["a3"]);
});
