/* Compass: the event page and the event form (spec section 3, "The event
   page and the event form"; round 2 prototype). Both are levels of the one
   sheet: "event" (the page), "edit" (the pencil) and "new" (the + button).
   Decisions live in event-form.js (tested). Every synced string goes through
   escapeHtml and every url through safeUrl. */
"use strict";

import { escapeHtml as esc, safeUrl } from "./util.js";
import { todayKey } from "./dates.js";
import { newEvent, STATUSES, STATUS_LABEL } from "./model.js";
import { CATEGORIES as MONEY, formatCents, visibleCosts } from "./money.js";
import { CATEGORIES, iconFor, categoryOf } from "./icons.js";
import { readForm, costDefaults, canChangeCost, addTask, addCost, whenLine, mapsUrl, toDraft, costPayerText } from "./event-form.js";
import { defaultCity } from "./cal-model.js";
import { registerLevel, openLevel, replaceTop, back, closeAll, topLevel } from "./sheet.js";
import { store } from "./store.js";
import { ICON } from "./chrome-icons.js";

const MONEY_AZ = MONEY.map((c) => [c.slug, c.label]).sort((a, b) => a[1].localeCompare(b[1]));
const MONEY_LABEL = Object.fromEntries(MONEY_AZ);
const CURRENCIES = [["EUR", "€ EUR"], ["GBP", "£ GBP"], ["USD", "$ USD"], ["CHF", "CHF"], ["CZK", "Kč CZK"], ["MAD", "MAD"], ["MYR", "RM MYR"], ["VND", "₫ VND"]];
const OWNERS = [["shared", "Both of us"], ["isa", "Isa"], ["hugo", "Hugo"]];
const RUNG = { estimate: ["estimate", "Estimate", "An estimate"], recorded: ["recorded", "Recorded", "Recorded by hand"],
  confirmed: ["confirmed", "Email", "Confirmed by the booking email"], locked: ["locked", "Bank", "Locked by the bank extract"] };
const name = (p) => ({ isa: "Isa", hugo: "Hugo", shared: "Both of us" }[p] || "");

let data = null;
let draft = null;          // the form's values while "edit" or "new" is open
let picker = null;         // the activity picker: null, "cat" or a category type
const pageTask = { text: "", for: "shared" };
let pageCost = null;       // the "Add a cost" line on the page
let undoTimer = 0;
let lastPage = null;       // which event the entry lines belong to

const me = () => store.state.settings.me;
const find = (id) => data.events().find((e) => e.id === id);
const thisYear = () => todayKey().slice(0, 4);

/* ---- pieces ---- */
const group = (icon, body, label) => `<section class="grp" aria-label="${label}"><span class="gic">${ICON[icon]}</span><div class="gbody">${body}</div></section>`;
const section = (title, body) => `<section class="grp sec"><h3 class="sh">${title}</h3><div class="gbody">${body}</div></section>`;
const choices = (f, opts, cur) => `<div class="choices" role="radiogroup">${opts.map(([v, l]) =>
  `<button role="radio" aria-checked="${cur === v}" class="${cur === v ? "on" : ""}" data-pick="${f}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
/* which field needs attention; drawn with the form, so a redraw keeps it */
let needing = null;
const input = (f, val, label, type = "text", cls = "") =>
  `<input class="${cls}${needing === f ? " need" : ""}" data-f="${f}" type="${type}" value="${esc(val)}" placeholder="${esc(label)}" aria-label="${esc(label)}" autocomplete="off">`;
const select = (f, opts, cur, label) => `<select data-f="${f}" aria-label="${label}">${opts.map(([v, l]) =>
  `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

function costLine(k, removable) {
  /* F41: a cost entirely the viewer's own says nothing about who paid or
     how it splits; only someone else's payer, or a shared split, is worth
     a word. */
  const payerText = costPayerText(k, me());
  const meta = [MONEY_LABEL[k.category] || k.category, payerText].filter(Boolean).join(" · ");
  const [icon, word, long] = RUNG[k.state] || RUNG.recorded;
  return `<div class="cost${canChangeCost(k) ? "" : " fixed"}">`
    + `<div class="cleft"><p class="cname">${esc(k.name || MONEY_LABEL[k.category] || "Cost")}</p>`
    + `<p class="cmeta">${esc(meta)}</p></div>`
    + `<div class="cright"><p class="camt">${esc(formatCents(k.amount, k.currency))}</p><p class="rung" title="${long}">${ICON[icon]}${word}</p></div>`
    + (removable && canChangeCost(k) ? `<button class="iconbtn" data-act="rmcost" data-k="${esc(k.id)}" aria-label="Remove this cost">${ICON.x}</button>` : "") + "</div>";
}

/* "Add a cost": one line; the fields appear once a name is typed */
function costEntry(c) {
  const head = `<div class="newline"><span class="plus" aria-hidden="true">${ICON.plus}</span>${input("cost-name", c.name || "", "Add a cost", "text", "bare")}</div>`;
  if (!String(c.name || "").trim()) return `<div class="newcost">${head}</div>`;
  return `<div class="newcost">${head}`
    + `<div class="line">${input("cost-amount", c.amountText || "", "Amount", "text", "amt")}${select("cost-currency", CURRENCIES, c.currency, "Currency")}`
    + choices("cost-payer", [["isa", "Isa paid"], ["hugo", "Hugo paid"]], c.payer) + "</div>"
    + `<div class="line">${choices("cost-scope", [["shared", "Shared"], ["personal", "Personal"]], c.scope)}`
    + choices("cost-state", [["estimate", "Estimate"], ["recorded", "Recorded"]], c.state)
    + select("cost-category", MONEY_AZ, c.category, "Category") + "</div>"
    + `<div class="line"><button class="primary" data-act="addcost">Add</button></div></div>`;
}

/* ---- the page, in Google Calendar's order ---- */
function eventPage(e) {
  const acts = (e.activities || []).map((a) => categoryOf(a.type).label).join(", then ");
  /* F40: the status is its own pill, under the title, not text on the date
     line; F43: the date line keeps only the day, end day and times (the
     "until Sun" span the day sheet shows belongs there, not repeated here).
     F42: the event's type (its activities) gets its own line and icon,
     after the date, instead of living in that removed second line. */
  /* F68: an accent-filled pill, like Spoon's real recipe-page status pill
     (kave-food-app/styles.css's .detail-tag: accent background,
     accent-text, r-pill, fs-meta -- Compass's existing .flag.acc is the
     same construction already) -- not the softer .flag.soft treatment F40
     gave it. */
  const statusPill = `<p class="flag acc status-pill">${esc(STATUS_LABEL[e.status] || "")}</p>`;
  const when = `<p class="big">${esc(whenLine(e, thisYear()))}</p>`;
  const place = [e.venue, e.city && e.city[0].toUpperCase() + e.city.slice(1)].filter(Boolean).join(", ");
  const maps = mapsUrl(e.venue, e.city);
  const where = place ? `<p>${esc(place)}</p>${maps && e.venue ? `<a class="maps" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>` : ""}` : "";
  const who = `<p>${esc(name(e.owner))}</p>${e.guests ? `<p class="dim">With ${esc(e.guests)}</p>` : ""}`;
  const links = [...(e.links || []).map((l) => { const u = safeUrl(l.url); return u
      ? `<p class="ref"><span class="dim">App</span> <a class="ticket" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}${ICON.ext}</a></p>` : ""; }),
    ...(e.bookingRefs || []).map((r) => `<p class="ref"><span class="dim">Booking</span> <span class="refv">${esc(r)}</span>`
      + `<button class="copy" data-act="copy" data-v="${esc(r)}" aria-label="Copy ${esc(r)}">${ICON.copy}<span class="cl">Copy</span></button></p>`)].join("");
  const todos = (e.checklist || []).map((c) => `<button class="todo${c.done ? " done" : ""}" data-act="tick" data-c="${esc(c.id)}" role="checkbox" aria-checked="${!!c.done}">`
    + `<span class="box">${c.done ? ICON.check : ""}</span><span class="tt">${esc(c.text)}</span>${c.assignee ? `<span class="who">${name(c.assignee)}</span>` : ""}</button>`).join("");
  const addT = `<div class="newtodo"><span class="box empty" aria-hidden="true"></span>${input("task", pageTask.text, "Add a task", "text", "bare")}`
    + (pageTask.text.trim() ? `${choices("task-for", [["isa", "Isa"], ["hugo", "Hugo"], ["shared", "Both"]], pageTask.for)}<button class="primary" data-act="addtask">Add</button>` : "") + "</div>";
  const costs = visibleCosts(e.costs, me()).map((k) => costLine(k, false)).join("") + costEntry(pageCost || costDefaults(e, me()));
  return statusPill + group("clock", when, "When") + (acts ? group("tag", `<p>${esc(acts)}</p>`, "Type") : "")
    + (where ? group("pin", where, "Where") : "") + group("people", who, "Who")
    + (links ? group("link", links, "Tickets and links") : "")
    + section("To do", todos + addT) + section("Costs", costs)
    + (e.notes ? group("note", `<p>${esc(e.notes)}</p>`, "Notes") : "");
}

/* ---- the form: the same groups and icons ---- */
/* F22: a new event defaults its city to Barcelona, unless its day falls
   inside a trip already on the calendar (tripCityFor, cal-model.js), in
   which case that trip's city wins instead. `date` lets the day-level
   sheet's own "+" (F21) default to the day it was opened from. */
function blank(date) {
  const start = date || todayKey();
  const city = defaultCity(data.events(), start);
  return { title: "", start, end: "", startTime: "", endTime: "", owner: "shared", status: "planned", activities: [],
    city: city[0].toUpperCase() + city.slice(1), venue: "", guests: "", notes: "", refs: "", links: [], checklist: [], costs: [], newCost: null };
}
function activityForm(d) {
  const chips = d.activities.map((a, i) => `<span class="act">${esc(iconFor(a, d, me()))} ${esc(categoryOf(a.type).label)}`
    + `<button class="iconbtn" data-act="rmact" data-i="${i}" aria-label="Remove">${ICON.x}</button></span>`).join('<span class="then">then</span>');
  let pick = "";
  if (picker === "cat") pick = `<p class="sub">Pick a category</p><div class="catgrid">${CATEGORIES.map((c) =>
    `<button data-act="pickcat" data-c="${c.type}"><span class="ci">${esc(iconFor({ type: c.type }, d, me()))}</span>${esc(c.label)}</button>`).join("")}</div>`;
  else if (picker) pick = `<p class="sub">${esc(categoryOf(picker).label)}: pick its icon</p><div class="choices">${categoryOf(picker).icons.map((ic, i) =>
    `<button class="big" data-act="pickicon" data-i="${i}">${esc(iconFor({ type: picker, icon: ic.icon }, d, me()))}</button>`).join("")}</div>`;
  return (chips ? `<div class="acts">${chips}</div>` : "")
    + (picker ? pick : `<button class="add" data-act="addact">${ICON.plus} ${d.activities.length ? "Add what happens next" : "Add an activity"}</button>`);
}
/* F51: adding a to-do follows the same reveal pattern as "Add a cost" --
   the dotted-plus icon on the left, the input in place, the rest (assignee,
   Add) only once there is text. */
function todoEntry(d) {
  const text = d.newTodoText || "";
  const head = `<div class="newline"><span class="plus" aria-hidden="true">${ICON.plus}</span>${input("todo-new", text, "Add a to-do", "text", "bare")}</div>`;
  if (!text.trim()) return `<div class="newcost">${head}</div>`;
  return `<div class="newcost">${head}<div class="line">${choices("todo-new-assignee", [["isa", "Isa"], ["hugo", "Hugo"]], d.newTodoAssignee)}`
    + `<button class="primary" data-act="addtodo">Add</button></div></div>`;
}
function formPage(d) {
  return group("title", input("title", d.title, "Title", "text", "titlein"), "Title")
    /* F45: one "to" label between the two rows, vertically centred, rather
       than one repeated per row. */
    + group("clock", `<div class="dt-row"><div class="dt-col">${input("start", d.start, "Day", "date")}${input("startTime", d.startTime || "", "Start time", "time")}</div>`
      + `<span class="dt-to dim">to</span><div class="dt-col">${input("end", d.end || "", "End day", "date")}${input("endTime", d.endTime || "", "End time", "time")}</div></div>`
      /* F47: "done" is not a useful status to pick by hand here; it stays a
         real status (STATUS_LABEL, elsewhere) just not a choice in this form. */
      + `<p class="fhint">The end day and the times are optional.</p>${choices("status", STATUSES.filter((s) => s !== "done").map((s) => [s, STATUS_LABEL[s]]), d.status)}`, "When")
    + group("tag", activityForm(d), "What")
    + group("pin", `${input("venue", d.venue, "Venue")}${input("city", d.city, "City")}`, "Where")
    + group("people", `${choices("owner", OWNERS, d.owner)}${input("guests", d.guests, "Guests, first names")}`, "Who")
    + group("link", d.links.map((l, i) => `<div class="line">${input("link-label-" + i, l.label, "Label, e.g. Resident Advisor")}${input("link-url-" + i, l.url, "https://...")}</div>`).join("")
      + `<button class="add" data-act="addlink">${ICON.plus} Add a link</button>${input("refs", d.refs, "Booking references, separated by commas")}`, "Tickets and links")
    + section("To do", d.checklist.map((c, i) => `<div class="line">${input("todo-" + i, c.text, "Something to do")}${choices("assignee-" + i, [["isa", "Isa"], ["hugo", "Hugo"]], c.assignee)}</div>`).join("")
      + todoEntry(d))
    + section("Costs", visibleCosts(d.costs, me()).map((k) => costLine(k, true)).join("") + costEntry(d.newCost || costDefaults(d, me())))
    + group("note", `<textarea data-f="notes" rows="3" placeholder="Notes" aria-label="Notes">${esc(d.notes)}</textarea>`, "Notes");
}

/* ---- saving ---- */
function banner(msg, undo) {
  let b = document.getElementById("undoBanner");
  if (!b) { b = document.createElement("div"); b.id = "undoBanner"; b.className = "banner undo"; b.setAttribute("role", "status"); document.body.append(b); }
  b.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button id="undoBtn">Undo</button>' : ""}`;
  b.hidden = false;
  if (undo) b.querySelector("#undoBtn").addEventListener("click", () => { undo(); b.hidden = true; });
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { b.hidden = true; }, 6000);
}
function save(prev, next) {
  try { return data.save(prev, next); }
  catch (err) { banner(String(err.message || err)); return null; }
}
function need(sel) {
  needing = sel.match(/data-f="([^"]+)"/)[1];
  refresh();
  /* after the sheet's own redraw for this tap */
  setTimeout(() => { const el = document.querySelector(`#sheetRoot ${sel}`); if (el) el.focus(); }, 0);
}

function saveForm(l) {
  const { fields, errors } = readForm(draft);
  if (errors.length) { need(!fields.title ? '[data-f="title"]' : '[data-f="start"]'); banner(errors[0][0].toUpperCase() + errors[0].slice(1) + "."); return; }
  if (l.kind === "new") {
    let ev;
    try { ev = newEvent(fields, { me: me(), now: new Date() }); } catch (err) { banner(String(err.message || err)); return; }
    const saved = save(null, { ...ev, costs: draft.costs });
    if (saved) { draft = null; replaceTop({ kind: "event", id: saved.id }); }
  } else {
    const prev = find(l.id);
    if (save(prev, { ...prev, ...fields, costs: draft.costs })) { draft = null; back(); }
  }
}

/* ---- typing: values go into the draft (or the page's entry lines) ---- */
function onInput(t, l) {
  const f = t.dataset.f; if (!f) return;
  const v = t.value;
  if (needing === f) { needing = null; t.classList.remove("need"); }
  const onPage = l.kind === "event";
  /* F44 (second cause): refresh() is refreshSheet, deliberately a no-op
     while a form ("edit"/"new") is open (review I2 -- a background sync
     must never redraw an open form and close the keyboard). But typing the
     first character of a name is a user-initiated reveal, same as tapping
     a choice button already does (sheet.js's own click handler always
     redraws after onAction, form or not) -- so it needs the same
     unconditional redraw, not the guarded one. replaceTop redraws the
     current level in place, with no history entry, whichever level it is. */
  const redraw = (sel) => { const l = topLevel(); if (l) replaceTop(l); const i = document.querySelector(`#sheetRoot [data-f="${sel}"]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  if (f === "task") {
    const had = !!pageTask.text.trim(); pageTask.text = v;
    if (had !== !!v.trim()) redraw("task");
    return;
  }
  if (f.startsWith("cost-")) {
    const holder = onPage ? null : draft;
    let c = onPage ? pageCost : draft.newCost;
    if (!c) c = { ...costDefaults(onPage ? find(l.id) : draft, me()) };
    const had = !!String(c.name || "").trim();
    const k = f.slice(5);
    if (k === "amount") c.amountText = v; else c[k] = v;
    if (holder) holder.newCost = c; else pageCost = c;
    if (k === "name" && had !== !!v.trim()) redraw("cost-name");
    return;
  }
  if (!draft) return;
  if (f === "todo-new") {
    const had = !!(draft.newTodoText || "").trim();
    draft.newTodoText = v;
    if (had !== !!v.trim()) redraw("todo-new");
    return;
  }
  if (f.startsWith("link-label-")) draft.links[Number(f.slice(11))].label = v;
  else if (f.startsWith("link-url-")) draft.links[Number(f.slice(9))].url = v;
  else if (f.startsWith("todo-")) draft.checklist[Number(f.slice(5))].text = v;
  else draft[f] = v;
}

let refresh = () => {};

/* ---- taps ---- */
function onAction(b, l) {
  const a = b.dataset.act, pick = b.dataset.pick;
  const e = l.kind === "event" ? find(l.id) : null;
  if (a === "edit") { draft = toDraft(e); picker = null; barOpen = false; openLevel({ kind: "edit", id: e.id }); return; }
  if (a === "save") { saveForm(l); return; }
  if (a === "cancel") { draft = null; picker = null; back(); return; }
  if (a === "delete") {
    const prev = find(l.id);
    let gone;
    try { gone = data.remove(prev); } catch (err) { banner(String(err.message || err)); return; }
    draft = null; closeAll();
    banner(`Deleted ${prev.title}.`, () => data.undoRemove(gone));
    return;
  }
  if (a === "copy") {
    const done = () => { const s = b.querySelector(".cl"); s.textContent = "Copied"; setTimeout(() => { s.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.v).then(done, done); else done();
    return;
  }
  if (e) {
    if (a === "tick") save(e, { ...e, checklist: e.checklist.map((c) => (c.id === b.dataset.c ? { ...c, done: !c.done } : c)) });
    else if (pick === "task-for") pageTask.for = b.dataset.v;
    else if (a === "addtask") { if (save(e, addTask(e, pageTask.text, pageTask.for))) { pageTask.text = ""; pageTask.for = "shared"; } }
    else if (pick && pick.startsWith("cost-")) { pageCost = pageCost || { ...costDefaults(e, me()) }; pageCost[pick.slice(5)] = b.dataset.v; }
    else if (a === "addcost") {
      let next;
      try { next = addCost(e, pageCost || costDefaults(e, me()), me(), new Date()); } catch { need('[data-f="cost-amount"]'); return; }
      if (save(e, next)) pageCost = null;
    }
    return;
  }
  const d = draft;
  if (!d) return;
  if (pick) {
    if (pick.startsWith("assignee-")) { const c = d.checklist[Number(pick.slice(9))]; c.assignee = c.assignee === b.dataset.v ? null : b.dataset.v; }
    else if (pick === "todo-new-assignee") d.newTodoAssignee = d.newTodoAssignee === b.dataset.v ? null : b.dataset.v;
    else if (pick.startsWith("cost-")) { d.newCost = d.newCost || { ...costDefaults(d, me()) }; d.newCost[pick.slice(5)] = b.dataset.v; }
    else d[pick] = b.dataset.v;
  }
  else if (a === "addact") picker = "cat";
  else if (a === "pickcat") picker = b.dataset.c;
  else if (a === "pickicon") { d.activities.push({ type: picker, icon: categoryOf(picker).icons[Number(b.dataset.i)].icon }); picker = null; }
  else if (a === "rmact") d.activities.splice(Number(b.dataset.i), 1);
  else if (a === "addlink") d.links.push({ label: "", url: "" });
  else if (a === "addtodo") {
    const text = String(d.newTodoText || "").trim();
    if (text) d.checklist.push({ id: "ck_" + Date.now().toString(36), text, done: false, assignee: d.newTodoAssignee || null });
    d.newTodoText = ""; d.newTodoAssignee = null;
  }
  else if (a === "rmcost") d.costs = d.costs.filter((k) => k.id !== b.dataset.k || !canChangeCost(k));
  else if (a === "addcost") {
    try { d.costs = addCost(d, d.newCost || costDefaults(d, me()), me(), new Date()).costs; d.newCost = null; }
    catch { need('[data-f="cost-amount"]'); }
  }
  else if (a === "barmore") barOpen = !barOpen;
}

/* F46: the bar collapses to Save plus a small reveal arrow; Cancel and
   Delete stay hidden until it is tapped. */
let barOpen = false;
const formBar = (l) => '<button class="act-btn primary" data-act="save">' + (l.kind === "new" ? "Add" : "Save") + "</button>"
  + `<button class="sbtn reveal${barOpen ? " on" : ""}" data-act="barmore" aria-expanded="${barOpen}" aria-label="${barOpen ? "Hide more actions" : "More actions"}">${ICON.chev}</button>`
  + `<span class="bar-more"${barOpen ? "" : " hidden"}><button class="act-btn" data-act="cancel">Cancel</button>`
  + (l.kind === "edit" ? '<button class="act-btn" data-act="delete">Delete</button>' : "") + "</span>";

export function initEvent(ctx) {
  data = ctx.data;
  refresh = ctx.refresh;
  registerLevel("event", {
    title: (l) => { const e = find(l.id); return e ? e.title : "Event"; },
    body: (l) => {
      /* the entry lines belong to one event: a different event starts them empty */
      if (l.id !== lastPage) { lastPage = l.id; pageCost = null; pageTask.text = ""; pageTask.for = "shared"; }
      const e = find(l.id); return e ? eventPage(e) : '<p class="hint pad">This event is no longer here.</p>';
    },
    bar: () => `<button class="sbtn" data-act="edit" aria-label="Edit this event">${ICON.pen}</button>`,
    onAction: (b) => onAction(b, { kind: "event", id: currentId() }),
    onInput: (t, ev) => { if (ev.type === "input" || t.tagName === "SELECT") onInput(t, { kind: "event", id: currentId() }); },
  });
  for (const kind of ["edit", "new"]) {
    registerLevel(kind, {
      title: () => (kind === "new" ? "New event" : "Edit event"),
      body: () => (draft ? formPage(draft) : ""),
      bar: (l) => formBar(l),
      onAction: (b) => onAction(b, { kind, id: currentId() }),
      onInput: (t, ev) => { if (ev.type === "input" || t.tagName === "SELECT") onInput(t, { kind, id: currentId() }); },
    });
  }
  /* Enter in "Add a task" adds it */
  document.getElementById("sheetRoot").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.f === "task") { e.preventDefault(); onAction({ dataset: { act: "addtask" } }, { kind: "event", id: currentId() }); refresh(); }
  });
}

const currentId = () => (topLevel() || {}).id;

/* The + button: an empty form. F21: the day-level sheet's own "+" passes
   that day, so the form (and F22's trip-aware default city) starts there. */
export function newEventForm(date) {
  if (!me()) { banner("Choose who you are in Settings first."); return; }
  draft = blank(date); picker = null; barOpen = false;
  openLevel({ kind: "new" });
}
