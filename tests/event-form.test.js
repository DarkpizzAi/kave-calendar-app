import { test, eq, ok, throws } from "./run.js";
import { readForm, costDefaults, canChangeCost, addTask, addCost, whenLine, mapsUrl, toDraft, isMapsUrl, costPayerText } from "../js/event-form.js";
import { newEvent, validateEvent } from "../js/model.js";
import { newCostLine } from "../js/money.js";

const now = new Date("2026-09-24T10:00:00Z");
const base = (extra = {}) => newEvent({ title: "Worakls", start: "2026-09-24", ...extra }, { me: "isa", now });

test("event form: times are optional HH:MM, and a bad one is refused", () => {
  eq(validateEvent({ title: "A", start: "2026-09-24", startTime: "21:00", endTime: "03:00" }), []);
  ok(validateEvent({ title: "A", start: "2026-09-24", startTime: "25:00" }).length, "an impossible time");
  eq(base({ startTime: "21:00" }).startTime, "21:00");
  eq(base().endTime, "");
});
test("event form: readForm trims, lowercases the city, splits references, drops empty to-dos and unsafe links", () => {
  const { fields, errors } = readForm({
    title: "  Worakls ", start: "2026-09-24", end: "", startTime: "21:00", endTime: "", city: " Barcelona ", venue: " Razzmatazz ",
    guests: " Apu, Jordi ", notes: " ", refs: "RA-1, , RA-2", owner: "shared", status: "booked", activities: [{ type: "live-music", icon: "💿" }],
    links: [{ label: "RA", url: "https://ra.co/x" }, { label: "bad", url: "javascript:alert(1)" }, { label: "", url: "" }],
    checklist: [{ id: "c1", text: " Pay Jordi ", done: false, assignee: "isa" }, { id: "c2", text: "  ", done: false, assignee: null }],
  });
  eq(errors, []);
  eq([fields.title, fields.city, fields.venue, fields.guests, fields.notes, fields.end], ["Worakls", "barcelona", "Razzmatazz", "Apu, Jordi", "", null]);
  eq(fields.bookingRefs, ["RA-1", "RA-2"]);
  eq(fields.links.map((l) => l.label), ["RA"]);
  eq(fields.checklist.map((c) => c.text), ["Pay Jordi"]);
});
test("event form: readForm reports a missing title or day", () => {
  ok(readForm({ title: " ", start: "2026-09-24" }).errors.length);
  ok(readForm({ title: "A", start: "" }).errors.length);
});
test("event form: cost defaults come from the event (spec)", () => {
  eq(costDefaults(base({ activities: [{ type: "beach" }, { type: "transport" }] }), "hugo"),
    { category: "travel/flights", payer: "hugo", scope: "personal", state: "recorded", currency: "EUR" });
  eq(costDefaults(base({ owner: "shared", activities: [{ type: "eating" }] }), "isa").scope, "shared");
  eq(costDefaults(base({ activities: [{ type: "birthday" }] }), "isa").category, "gifts-donations/gifts");
  eq(costDefaults(base(), "isa").category, "travel/travel-other");
});
test("event form: only estimate and recorded lines can change", () => {
  eq(["estimate", "recorded", "confirmed", "locked"].map((state) => canChangeCost({ state })), [true, true, false, false]);
});
test("event form: addTask appends a trimmed task; Both leaves it unassigned", () => {
  const e = addTask(base(), " Buy a present ", "shared");
  eq(e.checklist.map((c) => [c.text, c.assignee, c.done]), [["Buy a present", null, false]]);
  eq(addTask(e, "Book", "hugo").checklist[1].assignee, "hugo");
  eq(addTask(e, "   ", "isa"), e, "an empty task changes nothing");
});
test("event form: addCost reads the amount as text and keeps name and currency", async () => {
  const e = addCost(base(), { name: " Taxi home ", amountText: "18,50", currency: "EUR", payer: "hugo", scope: "shared", state: "recorded", category: "transport/taxi" }, "isa", now);
  const k = e.costs[0];
  eq([k.name, k.amount, k.currency, k.payer, k.enteredBy, k.state], ["Taxi home", 1850, "EUR", "hugo", "isa", "recorded"]);
  eq(k.evidence[0].currency, "EUR");
  await throws(() => addCost(base(), { amountText: "abc", payer: "isa", scope: "shared", state: "recorded", category: "transport/taxi" }, "isa", now));
  await throws(() => addCost(base(), { amountText: "5", payer: "isa", scope: "shared", state: "locked", category: "transport/taxi" }, "isa", now));
});
test("event form: newCostLine keeps a currency other than euros", () => {
  const k = newCostLine({ category: "travel/flights", payer: "isa", amount: 100000, scope: "shared", currency: "VND", name: "Bus", me: "isa", now });
  eq([k.currency, k.name, k.evidence[0].currency], ["VND", "Bus", "VND"]);
});
test("event form: the when line", () => {
  eq(whenLine(base({ startTime: "21:00", endTime: "03:00" })), "Thursday 24 September · 21:00 to 03:00");
  eq(whenLine(base({ end: "2026-09-26" })), "Thursday 24 September to Saturday 26 September");
  eq(whenLine(base({ start: "2027-01-02" }), "2026"), "Saturday 2 January 2027");
});
test("event form: the Maps link is a safe search url", () => {
  eq(mapsUrl("Razzmatazz", "barcelona"), "https://www.google.com/maps/search/?api=1&query=Razzmatazz%2C%20barcelona");
  eq(mapsUrl("", ""), null);
});

test("M1: the when line never prints a typo'd far end date", () => {
  ok(!whenLine(base({ end: "2099-01-01" })).includes("2099"));
});

test("F44: toDraft defaults every list field, so editing an event missing them never crashes formPage", () => {
  const bare = { id: "ev_1", title: "Old event", start: "2020-01-01", owner: "isa", status: "planned" };
  const d = toDraft(bare);
  eq([d.activities, d.links, d.checklist, d.costs], [[], [], [], []]);
  eq(d.newCost, null);
});
test("F44: toDraft still carries over real lists and derived fields (refs, city)", () => {
  const e = base({ city: "barcelona", bookingRefs: ["RA-1", "RA-2"], links: [{ label: "RA", url: "https://ra.co/x" }] });
  const d = toDraft(e);
  eq(d.refs, "RA-1, RA-2");
  eq(d.city, "Barcelona");
  eq(d.links, [{ label: "RA", url: "https://ra.co/x" }]);
});

test("F49: isMapsUrl recognises a Maps link typed into Venue, and rejects a plain place name", () => {
  ok(isMapsUrl("https://maps.google.com/?q=Razzmatazz"));
  ok(isMapsUrl("https://www.google.com/maps/place/Razzmatazz"));
  ok(isMapsUrl("https://goo.gl/maps/abc123"));
  ok(isMapsUrl("https://maps.app.goo.gl/abc123"));
  ok(!isMapsUrl("Razzmatazz"));
  ok(!isMapsUrl(""));
  ok(!isMapsUrl("javascript:alert(1)"));
});
test("F49: mapsVenueUrl uses a Maps link typed into Venue directly, instead of wrapping it in a search query", () => {
  eq(mapsUrl("https://maps.app.goo.gl/abc123", "barcelona"), "https://maps.app.goo.gl/abc123");
  eq(mapsUrl("Razzmatazz", "barcelona"), "https://www.google.com/maps/search/?api=1&query=Razzmatazz%2C%20barcelona");
});

test("F41: a cost entirely the viewer's own shows no payer or scope text at all", () => {
  eq(costPayerText({ payer: "isa", scope: "personal" }, "isa"), "");
});
test("F41: someone else's cost says who paid; a shared cost adds Split cost", () => {
  eq(costPayerText({ payer: "hugo", scope: "personal" }, "isa"), "Paid by Hugo");
  eq(costPayerText({ payer: "isa", scope: "shared" }, "isa"), "Split cost");
  eq(costPayerText({ payer: "hugo", scope: "shared" }, "isa"), "Paid by Hugo · Split cost");
  eq(costPayerText({ payer: "hugo", scope: "shared" }, "hugo"), "Split cost");
});
