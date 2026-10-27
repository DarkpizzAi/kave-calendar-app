import { test, eq, ok } from "./run.js";
import { ticketMatches, categoryMatches, resultsHtml } from "../js/search.js";

const T1 = { id: "0123456789abcdef", ext: "pdf", pages: 1, name: "Razzmatazz entry" };
const ev = (id, title, start, extra = {}) => ({ id, title, start, end: null, owner: "shared", status: "planned", activities: [], deleted: false, ...extra });
const act = (type, icon) => ({ type, icon });

const events = [
  ev("a", "Razzmatazz night", "2026-10-30", { venue: "Razzmatazz", activities: [act("live-music", "🎶")], tickets: [T1] }),
  ev("b", "Cinema", "2025-02-14", { activities: [act("cinema", "🎬")] }),
  ev("c", "Old concert", "2023-03-04", { activities: [act("live-music", "🎶")] }),
  ev("d", "Gone", "2026-01-01", { venue: "Razzmatazz", deleted: true }),
];

test("search: tickets match by name and lead to their event, newest first", () => {
  eq(ticketMatches(events, "entry").map((x) => x.event.id), ["a"]);
  eq(ticketMatches(events, "xyz"), []);
  eq(ticketMatches(events, "  "), []);
});

test("search: categories match by name with the count over every year", () => {
  eq(categoryMatches(events, "concert", "2026-10-27").map((c) => [c.key, c.count]), [["concerts", 2]]);
  eq(categoryMatches(events, "film", "2026-10-27").map((c) => [c.key, c.count]), [["films", 1]]);
  eq(categoryMatches(events, "flight", "2026-10-27"), [], "a category with no events is not offered");
});

test("search: results come in the groups Events, Tickets, Categories, in that order", () => {
  const h = resultsHtml(events, "razz", "isa");
  ok(h.indexOf("Events") >= 0 && h.indexOf("Tickets") > h.indexOf("Events"));
  ok(!h.includes("Categories"));
  const c = resultsHtml(events, "concert", "isa");
  ok(c.includes("Categories") && c.includes('data-key="concerts"'));
  ok(!c.includes('data-srch="event" data-id="d"'), "a deleted event never shows");
});

test("search: a ticket result opens the event, never the file", () => {
  const h = resultsHtml(events, "entry", "isa");
  ok(h.includes('data-srch="event" data-id="a"'));
  ok(!h.includes("data-tk") && !h.includes("data-tid"));
});

test("search: no results is its own state, blank query is empty markup", () => {
  ok(resultsHtml(events, "nothing like this", "isa").includes("No results"));
  eq(resultsHtml(events, "   ", "isa"), "");
});

test("search: synced text is escaped", () => {
  const evil = [ev("x", '<img src=x onerror=alert(1)>', "2026-05-05", { venue: "<b>v</b>", tickets: [{ ...T1, name: '"><script>1</script>' }] })];
  const h = resultsHtml(evil, "img", "isa");
  ok(!h.includes("<img src=x") && h.includes("&lt;img"));
  const t = resultsHtml(evil, "script", "isa");
  ok(!t.includes("<script>"));
});
