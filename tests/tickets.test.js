import { test, eq, ok } from "./run.js";
import { ticketsOf, driveTicketLink, ticketUrl, originalUrl, repoPath, filesOf, wantedKeys, lastDayOf, keysToRemove, planSync, syncTickets, readTicket, mimeOf, fileNameOf, splitLinks, dayTicketLine, isPass, PASS_NOTE } from "../js/tickets.js";

const T1 = { id: "0123456789abcdef", name: "Ticket, Ticketmaster", ext: "pdf", pages: 2 };
const T2 = { id: "fedcba9876543210", name: "Ticket, RA", ext: "png", pages: 1 };
const ev = (id, start, tickets, extra = {}) => ({ id, title: id, start, tickets, ...extra });

function fakeStore(initial = []) {
  const m = new Map(initial.map((k) => [k, new Blob(["x"])]));
  return { m,
    keys: async () => [...m.keys()],
    get: async (k) => m.get(k) || null,
    put: async (k, b) => { m.set(k, b); },
    remove: async (k) => { m.delete(k); } };
}
const fakeManifest = (m = {}) => ({ m, load: () => JSON.parse(JSON.stringify(m)), save: (x) => { Object.keys(m).forEach((k) => delete m[k]); Object.assign(m, x); } });
const gh = (have, log = []) => ({ log, getRaw: async (p) => {
  log.push(p);
  if (!have.includes(p)) { const e = new Error("nf"); e.gh = "notFound"; throw e; }
  return new Blob(["data:" + p]);
} });

test("ticketsOf keeps well-formed pointers only", () => {
  const e = ev("a", "2026-11-01", [T1, { id: "../x", ext: "pdf", pages: 1 }, { ...T2, ext: "exe" }, { ...T2, pages: 99 }, { ...T2, pages: "1" }, null]);
  eq(ticketsOf(e).map((t) => t.id), [T1.id]);
  eq(ticketsOf(ev("b", "2026-11-01")), []);
  eq(ticketsOf(ev("c", "2026-11-01", [T1], { deleted: true })), []);
});

test("driveTicketLink needs a Ticket label and a Drive url", () => {
  const e = { links: [{ label: "Website", url: "https://drive.google.com/a" }, { label: "Ticket, RA", url: "https://example.com/x" }, { label: "Ticket, RA", url: "https://drive.google.com/file/d/1/view" }] };
  eq(driveTicketLink(e).url, "https://drive.google.com/file/d/1/view");
  eq(driveTicketLink({ links: [] }), null);
});

test("keys and repo paths", () => {
  eq(ticketUrl(T1.id, 2), `tickets/${T1.id}-p2.png`);
  eq(originalUrl(T1), `tickets/${T1.id}.pdf`);
  eq(repoPath(`tickets/${T1.id}.pdf`), `calendar/data/compass/tickets/${T1.id}.pdf`);
  eq(filesOf(T1), [`tickets/${T1.id}-p1.png`, `tickets/${T1.id}-p2.png`, `tickets/${T1.id}.pdf`]);
  eq(filesOf({ ...T1, pages: 0 }), [`tickets/${T1.id}.pdf`]);
  eq(mimeOf("jpg"), "image/jpeg");
});

test("wantedKeys: future events only, last day counts, deleted ones do not", () => {
  const events = [
    ev("past", "2026-10-23", [T1]),
    ev("yesterday", "2026-10-24", [T2]),
    ev("today", "2026-10-25", [T1]),
    ev("trip", "2026-10-20", [T2], { end: "2026-10-26" }),   // still running
    ev("gone", "2026-12-01", [T2], { deleted: true }),
    ev("none", "2026-12-02"),
  ];
  eq([...wantedKeys(events, "2026-10-25")].sort(), [...filesOf(T1), ...filesOf(T2)].sort());
  eq([...wantedKeys([events[0], events[4], events[5]], "2026-10-25")], []);
  eq([...wantedKeys([events[1]], "2026-10-25")], filesOf(T2)); // one grace day
  eq([...wantedKeys(null, "2026-10-25")], []);
});

test("planSync: fetch the missing, delete the unwanted, leave other keys alone", () => {
  const wanted = new Set(filesOf(T1));
  const p = planSync(wanted, [filesOf(T1)[0], filesOf(T2)[0], "other/thing"]);
  eq(p.fetch, [filesOf(T1)[1], filesOf(T1)[2]]);
  eq(p.remove, [filesOf(T2)[0]]);
  eq(planSync(wanted, [...wanted]), { fetch: [], remove: [] });
});

test("syncTickets downloads missing files and clears passed ones; a re-run does nothing", async () => {
  const store = fakeStore(filesOf(T2));
  const g = gh(filesOf(T1).map(repoPath));
  const events = [ev("a", "2026-11-01", [T1]), ev("old", "2026-10-01", [T2])];
  const manifest = fakeManifest({ [T2.id]: { eventId: "old", year: "2026", lastDay: "2026-10-01" } });
  const r = await syncTickets({ events, today: "2026-10-25", gh: g, store, loadedYears: ["2026"], manifest });
  eq([r.fetched, r.removed, r.stopped], [3, 2, ""]);
  eq([...store.m.keys()].sort(), filesOf(T1).sort());
  const again = await syncTickets({ events, today: "2026-10-25", gh: g, store, loadedYears: ["2026"], manifest });
  eq([again.fetched, again.removed], [0, 0]);
  eq(g.log.length, 3);
});

test("syncTickets stops quietly offline and skips a file the repo lacks", async () => {
  const off = { getRaw: async () => { const e = new Error("o"); e.gh = "offline"; throw e; } };
  const store = fakeStore();
  const r = await syncTickets({ events: [ev("a", "2026-11-01", [T1])], today: "2026-10-25", gh: off, store });
  eq([r.fetched, r.stopped, store.m.size], [0, "offline", 0]);
  const g = gh([repoPath(filesOf(T1)[1])]);
  const r2 = await syncTickets({ events: [ev("a", "2026-11-01", [T1])], today: "2026-10-25", gh: g, store });
  eq([r2.fetched, r2.stopped], [1, ""]);
  eq(await syncTickets({ events: [], gh: off, store: null }), { fetched: 0, removed: 0, stopped: "" });
});

test("readTicket: from the phone, else from the repo (and kept), else null", async () => {
  const store = fakeStore([ticketUrl(T2.id, 1), originalUrl(T2)]);
  const none = gh([]);
  const r = await readTicket(T2, { gh: none, store });
  eq([r.pages.length, !!r.original, none.log.length], [1, true, 0]);
  const miss = fakeStore();
  eq(await readTicket(T2, { gh: none, store: miss }), null);
  const g = gh([repoPath(ticketUrl(T2.id, 1))]);
  const r2 = await readTicket(T2, { gh: g, store: miss });
  eq([r2.pages.length, r2.original, miss.m.has(ticketUrl(T2.id, 1))], [1, null, true]);
  const pass = { ...T1, pages: 0, ext: "pkpass" };
  eq(await readTicket(pass, { gh: none, store: miss }), null); // a pass not on the phone says so up front
  ok(await readTicket(pass, { gh: gh([repoPath(originalUrl(pass))]), store: miss }), "a pass opens once its file is there");
});

test("fileNameOf drops punctuation and keeps the extension", () => {
  eq(fileNameOf(T1), "Ticket Ticketmaster.pdf");
  eq(fileNameOf({ name: "../..", ext: "png" }), "Ticket.png");
});

test("splitLinks hides the Drive link only when a phone copy exists", () => {
  const drive = { label: "Ticket, RA", url: "https://drive.google.com/file/d/1/view" }, site = { label: "Website", url: "https://x.example" };
  const a = splitLinks({ links: [drive, site], tickets: [T1] });
  eq([a.tickets.length, a.drives, a.links], [1, [drive], [site]]);
  const b = splitLinks({ links: [drive, site] });
  eq([b.tickets.length, b.drives, b.links.length], [0, [], 2]);
});

test("dayTicketLine escapes the seller name", () => {
  const h = dayTicketLine({ id: "e1" }, { ...T1, name: "Ticket, <b>x</b>" });
  ok(!h.includes("<b>") && h.includes('data-tk="e1"') && h.includes(`data-tid="${T1.id}"`));
});

test("a wallet pass (pages 0): original only, syncs, opens with no page images", async () => {
  const P = { id: "aaaaaaaaaaaaaaaa", name: "Ticket, Apple Wallet", ext: "pkpass", pages: 0 };
  ok(isPass(P) && !isPass(T1) && !isPass({ ...T1, pages: 0 }) && PASS_NOTE.includes("wallet pass"));
  eq(ticketsOf(ev("p", "2026-11-01", [P])).length, 1);
  eq(filesOf(P), [`tickets/${P.id}.pkpass`]);
  eq(mimeOf("pkpass"), "application/vnd.apple.pkpass");
  const store = fakeStore();
  const r = await syncTickets({ events: [ev("p", "2026-11-01", [P])], today: "2026-10-25", gh: gh([repoPath(filesOf(P)[0])]), store });
  eq([r.fetched, [...store.m.keys()]], [1, filesOf(P)]);
  const got = await readTicket(P, { gh: gh([]), store });
  eq([got.pages.length, !!got.original], [0, true]);
});

test("splitLinks, two tickets: every Drive ticket link is hidden and handed back", () => {
  const d1 = { label: "Ticket, RA", url: "https://drive.google.com/file/d/1/view" }, d2 = { label: "Ticket, Ticketmaster", url: "https://drive.google.com/file/d/2/view" };
  const site = { label: "Website", url: "https://x.example" };
  const r = splitLinks({ links: [d1, site, d2], tickets: [T1, T2] });
  eq([r.tickets.length, r.drives, r.links], [2, [d1, d2], [site]]);
});

test("lastDayOf: end unless before start, no cap on a long event", () => {
  eq(lastDayOf({ start: "2026-01-01", end: "2026-04-01" }), "2026-04-01"); // 90 days
  eq(lastDayOf({ start: "2026-10-10", end: "2026-10-05" }), "2026-10-10");
  eq(lastDayOf({ start: "2026-10-10" }), "2026-10-10");
});

test("a PDF with 0 pages is not a wallet pass: it reads as not on the phone", async () => {
  eq(await readTicket({ ...T1, pages: 0 }, { gh: gh([]), store: fakeStore() }), null);
});

test("sync never deletes the ticket of an event whose year is not loaded", async () => {
  const T3 = { id: "1111222233334444", name: "Ticket, X", ext: "png", pages: 1 };
  const store = fakeStore(filesOf(T3));
  const manifest = fakeManifest({ [T3.id]: { eventId: "far", year: "2028", lastDay: "2028-05-01" } });
  const r = await syncTickets({ events: [ev("a", "2026-11-01", [T1])], today: "2026-10-25", gh: gh(filesOf(T1).map(repoPath)), store, loadedYears: ["2026", "2027"], manifest });
  eq(r.removed, 0);
  ok(store.m.has(filesOf(T3)[0]), "2028 ticket kept");
});

test("sync deletes the ticket of a passed event in a loaded year, and the grace day holds", async () => {
  const mk = (day) => {
    const store = fakeStore(filesOf(T2));
    const manifest = fakeManifest({ [T2.id]: { eventId: "e", year: "2026", lastDay: day } });
    return { store, manifest, events: [ev("e", day, [T2])] };
  };
  const y = mk("2026-10-24");
  eq((await syncTickets({ events: y.events, today: "2026-10-25", gh: gh([]), store: y.store, loadedYears: ["2026"], manifest: y.manifest })).removed, 0);
  const o = mk("2026-10-23");
  eq((await syncTickets({ events: o.events, today: "2026-10-25", gh: gh([]), store: o.store, loadedYears: ["2026"], manifest: o.manifest })).removed, 2);
  eq([...o.store.m.keys()], []);
  eq(o.manifest.m, {});
});

test("keysToRemove: an event that stopped listing the ticket frees it; no record means kept", () => {
  const keys = filesOf(T2);
  const man = { [T2.id]: { eventId: "e", year: "2026", lastDay: "2026-12-01" } };
  eq(keysToRemove(keys, [ev("e", "2026-12-01")], ["2026"], man, "2026-10-25"), keys);
  eq(keysToRemove(keys, [ev("e", "2026-12-01", [T2])], ["2026"], man, "2026-10-25"), []);
  eq(keysToRemove(keys, [ev("e", "2026-12-01")], ["2026"], {}, "2026-10-25"), []);
  eq(keysToRemove(keys, [], ["2026"], man, "2026-10-25"), keys); // its event is gone from a loaded year
});

test("sync records the owner of every ticket on a loaded event", async () => {
  const manifest = fakeManifest();
  await syncTickets({ events: [ev("a", "2026-11-01", [T1], { end: "2026-11-03" })], today: "2026-10-25", gh: gh(filesOf(T1).map(repoPath)), store: fakeStore(), loadedYears: ["2026"], manifest });
  eq(manifest.m[T1.id], { eventId: "a", year: "2026", lastDay: "2026-11-03" });
});
