import { test, eq, ok } from "./run.js";
import { TILES, countable, yearCounts, history, comingUp, ticketWall, wallTakenOff, didYouKnow } from "../js/insights-data.js";

let n = 0;
const ev = (type, start, o = {}) => ({
  id: "e" + (++n), title: o.title || "Thing " + n, start, end: o.end || start, status: "planned",
  activities: type ? [{ type, icon: o.icon || "x" }] : [], city: "barcelona", venue: "", owner: "shared", links: [],
  ...o.extra,
});
const DRIVE = "https://drive.google.com/file/d/abc/view";

test("TILES lists the 12 tiles in order", () => {
  eq(TILES.map((t) => t.key), ["concerts", "club", "films", "culture", "meals", "drinks", "sport", "outdoors", "flights", "hotels", "birthdays", "visitors"]);
});

test("countable drops deleted, moved, cancelled and idea", () => {
  const base = ev("eating", "2026-03-01");
  eq([countable(base), countable({ ...base, deleted: true }), countable({ ...base, movedTo: "x" }),
    countable({ ...base, status: "cancelled" }), countable({ ...base, status: "idea" }), countable({ ...base, status: "booked" })],
    [true, false, false, false, false, true]);
});

test("yearCounts: counts per tile, sorted by count then tile order, zeros hidden", () => {
  const events = [
    ev("eating", "2026-01-05"), ev("eating", "2026-02-05"), ev("live-music", "2026-03-05"),
    ev("clubbing", "2026-04-05"), ev("eating", "2025-04-05"), ev("park", "2026-05-01"), ev("hike", "2026-05-02"),
  ];
  eq(yearCounts(events, 2026).map((c) => [c.key, c.count]), [["meals", 2], ["outdoors", 2], ["concerts", 1], ["club", 1]]);
  eq(yearCounts(events, 2026)[0], { key: "meals", emoji: "🍴", label: "Meals out", count: 2 });
});

test("yearCounts ignores no-activity, deleted, idea and cancelled events", () => {
  const events = [
    ev(null, "2026-01-05"), ev("eating", "2026-01-06", { extra: { deleted: true } }),
    ev("eating", "2026-01-07", { extra: { status: "idea" } }), ev("eating", "2026-01-08", { extra: { status: "cancelled" } }),
    ev("eating", "2026-01-09", { extra: { movedTo: "2026-02-09" } }),
  ];
  eq(yearCounts(events, 2026), []);
});

test("yearCounts: a multi-day event counts once, in its start year", () => {
  const events = [ev("accommodation", "2025-12-30", { end: "2026-01-03" }), ev("accommodation", "2026-02-01", { end: "2026-02-09" })];
  eq(yearCounts(events, 2026).map((c) => [c.key, c.count]), [["hotels", 1]]);
  eq(yearCounts(events, 2025).map((c) => [c.key, c.count]), [["hotels", 1]]);
});

test("yearCounts: two activities in one tile count once; two tiles count in each", () => {
  const e = ev("eating", "2026-06-01");
  e.activities = [{ type: "eating", icon: "x" }, { type: "eating", icon: "y" }, { type: "drinks", icon: "z" }];
  eq(yearCounts([e], 2026).map((c) => [c.key, c.count]), [["meals", 1], ["drinks", 1]]);
});

test("yearCounts: flights need a plane icon, a train is not a flight", () => {
  const events = [ev("transport", "2026-03-01", { icon: "✈️" }), ev("transport", "2026-03-02", { icon: "🛫" }),
    ev("transport", "2026-03-03", { icon: "🛬" }), ev("transport", "2026-03-04", { icon: "🚄" })];
  eq(yearCounts(events, 2026).map((c) => [c.key, c.count]), [["flights", 3]]);
});

test("history: newest year first, rows newest first, place title-cased", () => {
  const events = [
    ev("live-music", "2025-05-01", { title: "A", extra: { venue: "Hall", city: "porto" } }),
    ev("live-music", "2026-02-01", { title: "B", extra: { venue: "Club X", city: "san sebastian" } }),
    ev("live-music", "2026-07-01", { title: "C", extra: { city: "barcelona" } }),
    ev("eating", "2026-07-02"),
  ];
  const h = history(events, "concerts", "2026-10-25");
  eq(h.map((y) => [y.year, y.count]), [[2026, 2], [2025, 1]]);
  eq(h[0].rows.map((r) => r.title), ["C", "B"]);
  eq(h[0].rows.map((r) => r.place), ["Barcelona", "Club X, San Sebastian"]);
  eq(h[1].rows[0].place, "Hall, Porto");
});

test("history: a multi-day event is one row on its start date", () => {
  const events = [ev("accommodation", "2026-04-01", { end: "2026-04-05", title: "Stay" })];
  const h = history(events, "hotels", "2026-10-25");
  eq(h.length, 1);
  eq(h[0].rows.map((r) => [r.date, r.title]), [["2026-04-01", "Stay"]]);
});

test("history: ticket is null, future or past from the first Ticket link", () => {
  const mk = (start, links) => ev("live-music", start, { extra: { links } });
  const events = [
    mk("2026-03-01", []),
    mk("2026-04-01", [{ label: "Map", url: "https://x.test/m" }, { label: "Ticket (PDF)", url: DRIVE }, { label: "Ticket 2", url: "https://x.test/2" }]),
    mk("2026-12-01", [{ label: "Tickets", url: "https://x.test/f" }]),
  ];
  const rows = history(events, "concerts", "2026-10-25")[0].rows;
  eq(rows.map((r) => r.ticket), [{ when: "future", url: "https://x.test/f" }, { when: "past", url: DRIVE }, null]);
});

test("history: ignores cancelled, deleted and unknown keys", () => {
  const events = [ev("live-music", "2026-03-01", { extra: { status: "cancelled" } }), ev("live-music", "2026-03-02", { extra: { deleted: true } })];
  eq(history(events, "concerts", "2026-10-25"), []);
  eq(history(events, "nope", "2026-10-25"), []);
});

test("comingUp: next flight and next stay within 31 days", () => {
  const events = [
    ev("transport", "2026-11-10", { icon: "✈️", title: "Flight to Porto", extra: { startTime: "07:30" } }),
    ev("transport", "2026-11-05", { icon: "✈️", title: "Flight to Rome", extra: { startTime: "09:00" } }),
    ev("accommodation", "2026-11-05", { end: "2026-11-08", title: "Hotel Sol", extra: { city: "rome" } }),
  ];
  const c = comingUp(events, "2026-10-25");
  eq([c.flight.title, c.flight.date, c.flight.time, c.flight.days], ["Flight to Rome", "2026-11-05", "09:00", 11]);
  eq([c.stay.title, c.stay.city, c.stay.start, c.stay.end, c.stay.nights, c.stay.days], ["Hotel Sol", "Rome", "2026-11-05", "2026-11-08", 3, 11]);
});

test("comingUp: today counts, 31 days counts, 32 days and past do not", () => {
  const today = "2026-10-25";
  const events = [ev("transport", today, { icon: "✈️" }), ev("accommodation", "2026-11-25"), ev("accommodation", "2026-10-24")];
  const c = comingUp(events, today);
  eq(c.flight.days, 0);
  eq(c.stay.days, 31);
  eq(comingUp([ev("accommodation", "2026-11-26"), ev("transport", "2026-10-24", { icon: "✈️" })], today), { flight: null, stay: null });
});

test("comingUp: cancelled, idea and non-plane transport are skipped", () => {
  const events = [
    ev("transport", "2026-10-30", { icon: "🚄" }), ev("transport", "2026-10-31", { icon: "✈️", extra: { status: "cancelled" } }),
    ev("accommodation", "2026-11-01", { extra: { status: "idea" } }),
  ];
  eq(comingUp(events, "2026-10-25"), { flight: null, stay: null });
});

const concert = (start, o = {}) => ev("live-music", start, { title: o.title, extra: { links: [{ label: "Ticket", url: o.url || DRIVE }], ...(o.extra || {}) } });

test("ticketWall: past, countable, Drive ticket, wall category, newest first", () => {
  const events = [
    concert("2026-03-01", { title: "Old" }), concert("2026-09-01", { title: "New" }),
    concert("2026-12-01", { title: "Future" }),
    concert("2026-04-01", { title: "NotDrive", url: "https://other.test/t" }),
    ev("eating", "2026-05-01", { extra: { links: [{ label: "Ticket", url: DRIVE }] } }),
    concert("2026-06-01", { extra: { status: "cancelled" } }),
    ev("live-music", "2026-07-01", { extra: { links: [{ label: "Map", url: DRIVE }] } }),
  ];
  const w = ticketWall(events, "2026-10-25", "isa");
  eq(w.map((x) => x.title), ["New", "Old"]);
  eq(w[0], { id: w[0].id, title: "New", date: "2026-09-01", cat: "concerts", url: DRIVE });
});

test("ticketWall: an event still running today is not past", () => {
  const e = concert("2026-10-24", { extra: { end: "2026-10-25" } });
  eq(ticketWall([e], "2026-10-25", "isa"), []);
  eq(ticketWall([e], "2026-10-26", "isa").length, 1);
});

test("ticketWall: hidden per person, shown in wallTakenOff for that person only", () => {
  const e = concert("2026-03-01", { title: "Hid", extra: { wallHiddenBy: ["isa"] } });
  const f = concert("2026-04-01", { title: "Vis" });
  eq(ticketWall([e, f], "2026-10-25", "isa").map((x) => x.title), ["Vis"]);
  eq(ticketWall([e, f], "2026-10-25", "hugo").map((x) => x.title), ["Vis", "Hid"]);
  eq(wallTakenOff([e, f], "2026-10-25", "isa").map((x) => x.title), ["Hid"]);
  eq(wallTakenOff([e, f], "2026-10-25", "hugo"), []);
});

test("ticketWall covers culture, club and films; a deleted event stays off both lists", () => {
  const mk = (type) => ev(type, "2026-02-01", { extra: { links: [{ label: "Ticket", url: DRIVE }] } });
  const events = [mk("activity"), mk("clubbing"), mk("cinema"), { ...concert("2026-01-01"), deleted: true }];
  eq(ticketWall(events, "2026-10-25", "isa").map((x) => x.cat).sort(), ["club", "culture", "films"]);
  eq(wallTakenOff([{ ...concert("2026-01-01", { extra: { wallHiddenBy: ["isa"] } }), deleted: true }], "2026-10-25", "isa"), []);
});

// 2026-07-04, 11 and 18 are Saturdays.
const busy = () => [
  ev("eating", "2026-07-04", { extra: { city: "porto" } }), ev("eating", "2026-07-11", { extra: { city: "porto" } }),
  ev("drinks", "2026-07-18"), ev("drinks", "2026-07-19"), ev("eating", "2026-03-02", { extra: { city: "Lisbon" } }),
];

test("didYouKnow: empty with fewer than 5 countable events", () => {
  eq(didYouKnow(busy().slice(0, 4), 2026, 0), "");
  const withNoise = busy().slice(0, 4).concat([ev(null, "2026-08-01"), ev("eating", "2026-08-02", { extra: { status: "cancelled" } })]);
  eq(didYouKnow(withNoise, 2026, 0), "");
});

test("didYouKnow: the three facts, picked by seed", () => {
  const e = busy();
  eq(didYouKnow(e, 2026, 0), "Your busiest month this year was July, with 4 events.");
  eq(didYouKnow(e, 2026, 1), "Saturday is your favourite day to go out.");
  eq(didYouKnow(e, 2026, 2), "Porto is the city you visited most outside Barcelona, with 2 events.");
  eq(didYouKnow(e, 2026, 3), didYouKnow(e, 2026, 0));
});

test("didYouKnow: with no city outside Barcelona only two facts rotate", () => {
  const e = [1, 2, 3, 4, 5].map((i) => ev("eating", "2026-05-0" + i));
  ok(didYouKnow(e, 2026, 0).startsWith("Your busiest month this year was May, with 5 events"));
  eq(didYouKnow(e, 2026, 2), didYouKnow(e, 2026, 0));
});

test("didYouKnow: only the asked year counts", () => {
  eq(didYouKnow(busy(), 2025, 0), "");
});
