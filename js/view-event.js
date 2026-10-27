/* Compass: the event page and the event form (Material 3, Task 4).

   Both are levels of the one sheet system (sheet.js): "event" (the page, in
   the sheet) and "edit" / "new" (the form, a full-screen dialog on a phone
   and a dialog otherwise). Adding a cost, a to-do or a link, the menu, the
   delete confirmation and the date and time pickers are layers over them.
   Decisions live in event-form.js (tested). Every synced string goes
   through escapeHtml and every url through safeUrl. */
"use strict";

import { escapeHtml as esc, safeUrl, copyText } from "./util.js";
import { todayKey } from "./dates.js";
import { newEvent, STATUS_LABEL, statusOf } from "./model.js";
import { CATEGORIES as MONEY, formatCents, visibleCosts, toCents } from "./money.js";
import { CATEGORIES, GROUPS, iconFor, categoryOf, onlyIcon } from "./icons.js";
import { readForm, costDefaults, canChangeCost, addTask, addCost, addLinkTo, whenParts, mapsUrl, isMapsUrl, toDraft, costPayerText,
  spanAfterStartChange, spanAfterEndChange, copyToDay } from "./event-form.js";
import { defaultCity, shownStatus, categoryGroup, iconsOf } from "./cal-model.js";
import { registerLevel, openLevel, replaceTop, back, closeAll, topLevel, openLayer, closeLayer, snack } from "./sheet.js";
import { loadRange } from "./views.js";
import { detailGrey } from "./calendar.js";
import { openDatePicker, openTimePicker, dateLabel } from "./pickers.js";
import { store } from "./store.js";
import { ms } from "./chrome-icons.js";
import { splitLinks, ticketButton } from "./tickets.js";
import { kaveKey } from "../m3/kave-m3.js";

const MONEY_LABEL = Object.fromEntries(MONEY.map((c) => [c.slug, c.label]));
const CURRENCIES = [["EUR", "€ EUR"], ["GBP", "£ GBP"], ["USD", "$ USD"], ["CHF", "CHF"], ["CZK", "Kč CZK"], ["MAD", "MAD"], ["MYR", "RM MYR"], ["VND", "₫ VND"]];
const OWNERS = [["shared", "Both of us"], ["isa", "Isa"], ["hugo", "Hugo"]];
const STATUS_CHOICES = [["planned", "Planned"], ["booked", "Booked"], ["cancelled", "Cancelled"]];
const RUNG = { estimate: ["Estimate", "An estimate"], recorded: ["Recorded", "Recorded by hand"],
  confirmed: ["Email", "Confirmed by the booking email"], locked: ["Bank", "Locked by the bank extract"] };
const personName = (p) => ({ isa: "Isa", hugo: "Hugo", shared: "Both of you" }[p] || "");

let data = null;
let draft = null;          // the form's values while "edit" or "new" is open
let picker = null;         // the activity picker: null, "cat" or a category type
let needing = null;        // which form field needs attention (drawn with is-error)

const me = () => store.state.settings.me;
const find = (id) => data.events().find((e) => e.id === id);
const thisYear = () => todayKey().slice(0, 4);
const currentId = () => (topLevel() || {}).id;

/* ---------- small pieces ---------- */
const lead = (icon) => `<span class="m3-list-item__lead m3-list-item__lead--plain">${ms(icon)}</span>`;
/* One list row. text and sub are plain strings (escaped here); lead, trail and
   attrs are markup built from constants and already-escaped values. */
function li({ icon = "", leadHtml = "", text, sub = "", trail = "", tag = "div", attrs = "", cls = "" }) {
  const tap = tag !== "div";
  return `<${tag}${tag === "button" ? ' type="button"' : ""} class="m3-list-item${tap ? " m3-list-item--tap" : ""}${cls ? " " + cls : ""}"${attrs}>`
    + `${leadHtml || (icon ? lead(icon) : "")}<div class="m3-list-item__text"><div class="m3-body-l">${esc(text)}</div>`
    + `${sub ? `<div class="m3-body-m m3-variant">${esc(sub)}</div>` : ""}</div>${trail}</${tag}>`;
}
const addRow = (label, act, icon = "add") =>
  `<button type="button" class="m3-list-item m3-list-item--tap add-row" data-act="${act}">${ms(icon)}<span class="m3-body-l">${label}</span></button>`;
const grouped = (rows) => `<div class="m3-grouped">${rows.join("")}</div>`;
const heading = (text) => `<h3 class="m3-list-header m3-title-s">${esc(text)}</h3>`;
const chips = (key, opts, cur) => `<div class="m3-chips" role="radiogroup">${opts.map(([v, l]) =>
  `<button type="button" role="radio" aria-checked="${cur === v}" class="m3-chip${cur === v ? " is-selected" : ""}" data-pick="${key}" data-v="${esc(v)}">${cur === v ? ms("check") : ""}${esc(l)}</button>`).join("")}</div>`;
const field = (f, label, val, extra = "") =>
  `<label class="m3-field${needing === f ? " is-error" : ""}"><span class="m3-field__label">${esc(label)}</span>`
  + `<input class="m3-field__input" data-f="${f}" value="${esc(val)}" autocomplete="off"${extra}></label>`;
const firstType = (e) => (e.activities && e.activities[0] && e.activities[0].type) || "none";

function costRow(k, removable) {
  const meta = [MONEY_LABEL[k.category] || k.category, costPayerText(k, me())].filter(Boolean).join(" · ");
  const [word, long] = RUNG[k.state] || RUNG.recorded;
  const trail = `<span class="cost-amt"><span class="m3-title-m m3-num">${esc(formatCents(k.amount, k.currency))}</span>`
    + `<span class="m3-label-s m3-variant" title="${esc(long)}">${esc(word)}</span></span>`
    + (removable && canChangeCost(k) ? `<button type="button" class="m3-icon-btn" data-act="rmcost" data-k="${esc(k.id)}" aria-label="Remove this cost">${ms("close")}</button>` : "");
  return li({ icon: "payments", text: k.name || MONEY_LABEL[k.category] || "Cost", sub: meta, trail, cls: canChangeCost(k) ? "" : "fixed" });
}

/* the total only when the visible lines share one currency */
function costTotal(lines) {
  if (!lines.length) return "";
  const cur = lines[0].currency || "EUR";
  if (lines.some((k) => (k.currency || "EUR") !== cur)) return "";
  return formatCents(lines.reduce((s, k) => s + k.amount, 0), cur);
}
const costsHeading = (lines) => heading(`Costs${costTotal(lines) ? " · " + costTotal(lines) : ""}`);

function linkRow(l, removeIdx = -1) {
  const u = safeUrl(l.url);
  const map = isMapsUrl(l.url);
  const text = l.label && l.label !== "Link" ? l.label : map ? "Directions" : l.url;
  const trail = removeIdx >= 0
    ? `<button type="button" class="m3-icon-btn" data-act="rmlink" data-i="${removeIdx}" aria-label="Remove this link">${ms("close")}</button>`
    : `<span class="m3-list-item__trail">${ms("open_in_new")}</span>`;
  const sub = String(l.url || "");
  if (removeIdx >= 0 || !u) return li({ icon: map ? "map" : "link", text, sub, trail });
  return li({ icon: map ? "map" : "link", text, sub, trail, tag: "a", attrs: ` href="${esc(u)}" target="_blank" rel="noopener noreferrer"` });
}

/* ---------- the event page ---------- */
function eventPage(e) {
  const theirs = detailGrey(e);
  const group = theirs ? "other" : categoryGroup(firstType(e));
  const acts = (e.activities || []).map((a) => categoryOf(a.type).label).join(", then ");
  const { date, time } = whenParts(e, thisYear());
  const status = shownStatus(e);
  const statusText = status === "idea" ? "Planned" : STATUS_LABEL[statusOf({ status })];
  const hero = `<section class="ev-hero" style="${kaveKey(group)}" aria-label="${esc(e.title)}">`
    + `<span class="ev-emo m3-emoji" aria-hidden="true">${iconsOf(e, me()).map(esc).join("")}</span>`
    + `<h3 class="m3-headline-s ev-title${e.status === "cancelled" ? " cancelled" : ""}">${esc(e.title)}</h3>`
    + `<p class="m3-body-l">${esc(date)} · ${esc(time)}</p>`
    + `<p class="ev-meta">${acts ? `<span class="m3-label-l">${esc(acts)}</span>` : ""}<span class="m3-tag ev-status">${esc(statusText)}</span></p></section>`;

  const rows = [];
  const venueIsMap = isMapsUrl(e.venue);
  const city = e.city ? e.city[0].toUpperCase() + e.city.slice(1) : "";
  const place = (venueIsMap ? [city] : [e.venue, city]).filter(Boolean).join(", ");
  const maps = mapsUrl(e.venue, e.city);
  if (place || (venueIsMap && maps)) {
    rows.push(li({ icon: "place", text: place || "On the map", sub: "Where",
      trail: maps && e.venue ? `<a class="m3-btn m3-btn--text" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">${ms("near_me")}Directions</a>` : "" }));
  }
  rows.push(li({ icon: "group", text: e.owner === "shared" ? "Isa and Hugo" : personName(e.owner), sub: e.guests ? `With ${e.guests}` : "Who" }));
  /* Stored tickets open the phone's copy, offline too (ticket-view.js catches
     the data-tk taps); a Drive link stays as "Open in Drive". */
  const sp = splitLinks(e);
  for (const t of sp.tickets) {
    const pdf = t.ext === "pdf";
    rows.push(ticketButton(e, t, "m3-list-item m3-list-item--tap",
      `${lead("confirmation_number")}<div class="m3-list-item__text"><div class="m3-body-l">${esc(sp.tickets.length > 1 ? (t.name || "Ticket") : "Ticket")}</div>`
      + `<div class="m3-body-m m3-variant">${pdf ? "Open the ticket PDF" : "Open the ticket"}</div></div><span class="m3-list-item__trail">${ms("chevron_right")}</span>`));
  }
  for (const l of sp.drives) {
    const u = safeUrl(l.url);
    if (u) rows.push(li({ icon: "folder_open", text: "Open in Drive", sub: sp.drives.length > 1 ? l.label : "Ticket", tag: "a",
      attrs: ` href="${esc(u)}" target="_blank" rel="noopener noreferrer"`, trail: `<span class="m3-list-item__trail">${ms("open_in_new")}</span>` }));
  }
  for (const r of e.bookingRefs || []) {
    rows.push(li({ icon: "confirmation_number", text: r, sub: "Booking reference",
      trail: `<button type="button" class="m3-icon-btn" data-act="copyref" data-v="${esc(r)}" aria-label="Copy ${esc(r)}">${ms("content_copy")}</button>` }));
  }
  if (e.notes) rows.push(li({ icon: "notes", text: e.notes, sub: "Notes", cls: "notes-row" }));

  const costs = visibleCosts(e.costs, me());
  const todos = (e.checklist || []).map((c) =>
    `<button type="button" class="m3-list-item m3-list-item--tap todo${c.done ? " done" : ""}" data-act="tick" data-c="${esc(c.id)}" role="checkbox" aria-checked="${!!c.done}">`
    + `<span class="cb${c.done ? " on" : ""}" aria-hidden="true">${c.done ? ms("check") : ""}</span>`
    + `<div class="m3-list-item__text"><div class="m3-body-l">${esc(c.text)}</div><div class="m3-body-m m3-variant">${esc(personName(c.assignee || "shared"))}</div></div></button>`);
  const links = sp.links.filter((l) => l && safeUrl(l.url));

  return hero + grouped(rows)
    + costsHeading(costs) + grouped([...costs.map((k) => costRow(k, false)), addRow("Add a cost", "addcost")])
    + heading("To-dos") + grouped([...todos, addRow("Add a to-do", "addtodo")])
    + heading("Links") + grouped([...links.map((l) => linkRow(l)), addRow("Add a link", "addlink", "link")]);
}

/* ---------- the form ---------- */
/* F22: a new event defaults its city to Barcelona, unless its day falls
   inside a trip already on the calendar (tripCityFor, cal-model.js). `date`
   lets the day sheet's own "+" default to the day it was opened from. */
function blank(date) {
  const start = date || todayKey();
  const city = defaultCity(data.events(), start);
  return { title: "", start, end: "", startTime: "", endTime: "", owner: "shared", status: "planned", activities: [],
    city: city[0].toUpperCase() + city.slice(1), venue: "", guests: "", notes: "", refs: "", links: [], checklist: [], costs: [], newCost: null };
}

const dtField = (label, icon, text, empty, act, which, clearable) =>
  `<div class="m3-field fld"><span class="m3-field__label">${label}</span>`
  + `<button type="button" class="fld-main${text ? "" : " is-empty"}" data-act="${act}" data-w="${which}" aria-label="${label}, ${esc(text || empty)}">${esc(text || empty)}</button>`
  + (clearable && text ? `<button type="button" class="m3-icon-btn m3-icon-btn--small" data-act="cleartime" data-w="${which}" aria-label="Clear the time (all day)">${ms("close")}</button>` : "")
  + `<span class="m3-icon fld-ic" aria-hidden="true">${icon}</span></div>`;
const when = (label, which, day, time) =>
  `<div class="fsec"><p class="m3-label-l m3-variant fsec-h">${label}</p><div class="fgrid">`
  + dtField("Date", "calendar_today", dateLabel(day), "Choose a day", "pickdate", which, false)
  + dtField("Time", "schedule", time, "All day", "picktime", which, true) + "</div></div>";

function activityBlock(d) {
  const rows = d.activities.map((a, i) => {
    const g = categoryGroup(a.type);
    return li({ leadHtml: `<span class="m3-list-item__lead m3-list-item__lead--square m3-emoji" style="${kaveKey(g)}" aria-hidden="true">${esc(iconFor(a, d, me()))}</span>`,
      text: categoryOf(a.type).label, sub: i ? "Then" : "",
      trail: `<button type="button" class="m3-icon-btn" data-act="rmact" data-i="${i}" aria-label="Remove ${esc(categoryOf(a.type).label)}">${ms("close")}</button>` });
  });
  if (!picker) return grouped([...rows, addRow(d.activities.length ? "Add what happens next" : "Add an activity", "addact")]);
  let pick;
  if (picker === "cat") {
    pick = `<div class="m3-stack picker">${GROUPS.map((g) => {
      const cats = CATEGORIES.filter((c) => c.group === g);
      if (!cats.length) return "";
      return `<p class="m3-label-l m3-variant catgroup">${esc(g)}</p><div class="m3-chips">${cats.map((c) =>
        `<button type="button" class="m3-chip cat-chip" style="${kaveKey(categoryGroup(c.type))}" data-act="pickcat" data-c="${esc(c.type)}">`
        + `<span class="m3-emoji">${esc(iconFor({ type: c.type }, d, me()))}</span>${esc(c.label)}</button>`).join("")}</div>`;
    }).join("")}<button type="button" class="m3-btn m3-btn--text picker-x" data-act="pickclose">Cancel</button></div>`;
  } else {
    const g = categoryGroup(picker);
    pick = `<div class="m3-stack picker"><p class="m3-label-l m3-variant">${esc(categoryOf(picker).label)}: pick its emoji</p><div class="emogrid">${categoryOf(picker).icons.map((ic, i) =>
      `<button type="button" class="emobtn m3-emoji" style="${kaveKey(g)}" data-act="pickicon" data-i="${i}" aria-label="${esc(ic.icon)}">${esc(iconFor({ type: picker, icon: ic.icon }, d, me()))}</button>`).join("")}</div>`
      + `<button type="button" class="m3-btn m3-btn--text picker-x" data-act="pickback">${ms("arrow_back")}Back to categories</button></div>`;
  }
  return (rows.length ? grouped(rows) : "") + pick;
}

function formPage(d) {
  const costs = visibleCosts(d.costs, me());
  const todos = d.checklist.map((c, i) => li({ leadHtml: '<span class="cb" aria-hidden="true"></span>', text: c.text, sub: personName(c.assignee || "shared"),
    trail: `<button type="button" class="m3-icon-btn" data-act="rmtodo" data-i="${i}" aria-label="Remove this to-do">${ms("close")}</button>` }));
  const status = d.status === "idea" ? "planned" : d.status;
  return field("title", "Title", d.title, ' placeholder="What is it?" aria-label="Title"')
    + when("Starts", "start", d.start, d.startTime)
    + when("Ends", "end", d.end || d.start, d.endTime)
    + heading("Activity") + activityBlock(d)
    + heading("Where") + `<div class="fcol">${field("venue", "Venue", d.venue)}${field("city", "City", d.city)}</div>`
    + heading("Who") + `<div class="fcol">${chips("owner", OWNERS, d.owner)}${field("guests", "Guests, first names", d.guests)}</div>`
    + heading("Status") + chips("status", STATUS_CHOICES, status)
    + costsHeading(costs) + grouped([...costs.map((k) => costRow(k, true)), addRow("Add a cost", "addcost")])
    + heading("To-dos") + grouped([...todos, addRow("Add a to-do for Isa, Hugo or both", "addtodo")])
    + heading("Links") + grouped([...d.links.map((l, i) => linkRow(l, i)), addRow("Add a link (tickets, maps, booking)", "addlink", "link")])
    + heading("Notes") + `<label class="m3-field"><span class="m3-field__label">Notes</span><textarea class="m3-field__input" data-f="notes" rows="3" aria-label="Notes">${esc(d.notes)}</textarea></label>`
    + `<div class="fcol">${field("refs", "Booking references, separated by commas", d.refs)}</div>`
    + (draft && draft.id ? `<button type="button" class="m3-btn m3-btn--outlined m3-btn--danger form-del" data-act="deleteform">${ms("delete")}Delete event</button>` : "");
}

/* ---------- small dialogs: a cost, a to-do, a link ---------- */
/* spec: [{ type: "text", key, label, placeholder, inputmode, trail }, { type: "chips", key, label, options, wrap }, { type: "note", id }]
   state holds the values; isValid(state) enables the button; submit(state)
   returns an error message, or nothing when it worked (the dialog then
   closes). */
function smallDialog({ title, fields, state, okLabel = "Add", isValid, submit, onChange }) {
  const chipHtml = (f) => `<div class="m3-chips dlg-chips" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${state[f.key] === v}" class="m3-chip${state[f.key] === v ? " is-selected" : ""}" data-chip="${f.key}" data-v="${esc(v)}">${state[f.key] === v ? ms("check") : ""}${esc(l)}</button>`).join("")}</div>`;
  const fieldHtml = (f) => {
    if (f.type === "chips") return `<div class="dlg-grp" data-grp="${f.key}"><p class="m3-label-l m3-variant">${esc(f.label)}</p>${chipHtml(f)}</div>`;
    if (f.type === "note") return `<p class="m3-body-s m3-variant" data-note="${f.id}">${esc(f.text(state))}</p>`;
    return `<label class="m3-field"><span class="m3-field__label">${esc(f.label)}</span>`
      + `<input class="m3-field__input" data-d="${f.key}" value="${esc(state[f.key] || "")}" placeholder="${esc(f.placeholder || "")}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ""} autocomplete="off">`
      + (f.trail || "") + "</label>";
  };
  const html = `<h2 class="m3-headline-s dlg-title">${esc(title)}</h2><div class="dlg-body">${fields.map(fieldHtml).join("")}`
    + '<p class="m3-body-s dlg-err" role="alert" hidden></p></div>'
    + `<div class="m3-dialog__actions"><button type="button" class="m3-btn m3-btn--text" data-dlg="cancel">Cancel</button>`
    + `<button type="button" class="m3-btn m3-btn--filled" data-dlg="ok"${isValid(state) ? "" : " disabled"}>${esc(okLabel)}</button></div>`;
  let layer = null;
  const ok = () => layer.el.querySelector('[data-dlg="ok"]');
  const showErr = (msg) => { const n = layer.el.querySelector(".dlg-err"); n.textContent = msg || ""; n.hidden = !msg; };
  layer = openLayer({
    kind: "dialog", html, label: title, cls: "m3-dialog--basic add-dialog",
    onMount: (el) => {
      const submitNow = () => {
        if (!isValid(state)) return;
        const err = submit(state);
        if (err) showErr(err); else closeLayer(layer);
      };
      el.addEventListener("input", (e) => {
        const k = e.target.dataset && e.target.dataset.d;
        if (!k) return;
        state[k] = e.target.value;
        ok().disabled = !isValid(state);
        showErr("");
        if (onChange) onChange(state, el);
      });
      el.addEventListener("change", (e) => {
        const k = e.target.dataset && e.target.dataset.d;
        if (k) { state[k] = e.target.value; }
      });
      el.addEventListener("click", (e) => {
        const c = e.target.closest("[data-chip]");
        if (c) {
          state[c.dataset.chip] = c.dataset.v;
          const f = fields.find((x) => x.key === c.dataset.chip);
          const g = el.querySelector(`[data-grp="${f.key}"]`);
          g.querySelector(".dlg-chips").outerHTML = chipHtml(f);
          g.querySelector(`[data-v="${CSS.escape(c.dataset.v)}"]`).focus({ preventScroll: true });
          ok().disabled = !isValid(state);
          if (onChange) onChange(state, el);
          return;
        }
        const b = e.target.closest("[data-dlg]");
        if (!b) return;
        if (b.dataset.dlg === "cancel") closeLayer(layer);
        else submitNow();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); submitNow(); }
      });
    },
  });
  return layer;
}

/* "Add a cost": amount, what for, a category, who paid. `target` is the event
   (or the form's draft) the defaults come from; onAdd gets the new cost
   fields and returns an error message or nothing. */
function costDialog(target, onAdd) {
  const def = costDefaults(target, me());
  const state = { amount: "", name: "", category: def.category, payer: def.payer === "hugo" ? "hugo" : "isa", currency: "EUR" };
  const cur = `<select class="cur-select" data-d="currency" aria-label="Currency">${CURRENCIES.map(([v, l]) =>
    `<option value="${v}">${esc(l)}</option>`).join("")}</select>`;
  smallDialog({
    title: "Add a cost", state, isValid: (s) => { const c = toCents(s.amount); return c != null && c > 0; },
    fields: [
      { type: "text", key: "amount", label: "Amount", placeholder: "0,00", inputmode: "decimal", trail: cur },
      { type: "text", key: "name", label: "What for", placeholder: "Tickets, dinner..." },
      { type: "chips", key: "category", label: "Category", options: MONEY.map((c) => [c.slug, c.label]) },
      { type: "chips", key: "payer", label: "Paid by", options: [["isa", "Isa"], ["hugo", "Hugo"]] },
    ],
    submit: (s) => onAdd({ name: s.name, amountText: s.amount, currency: s.currency, payer: s.payer, scope: def.scope, state: "recorded", category: s.category }),
  });
}

function todoDialog(onAdd) {
  const state = { text: "", forWho: "shared" };
  smallDialog({
    title: "Add a to-do", state, isValid: (s) => !!s.text.trim(),
    fields: [
      { type: "text", key: "text", label: "To-do", placeholder: "Buy a present, print the tickets..." },
      { type: "chips", key: "forWho", label: "For", options: [["isa", "Isa"], ["hugo", "Hugo"], ["shared", "Both"]] },
    ],
    submit: (s) => onAdd(s.text, s.forWho),
  });
}

function linkDialog(onAdd) {
  const state = { url: "", label: "" };
  smallDialog({
    title: "Add a link", state, isValid: (s) => !!s.url.trim(),
    fields: [
      { type: "text", key: "url", label: "Link", placeholder: "https://", inputmode: "url" },
      { type: "text", key: "label", label: "Name (optional)", placeholder: "Booking, menu..." },
      { type: "note", id: "map", text: (s) => (isMapsUrl(s.url) ? "A Maps link: it shows as Directions on the event." : "Paste a ticket, booking or Maps link.") },
    ],
    onChange: (s, el) => { const n = el.querySelector('[data-note="map"]'); if (n) n.textContent = isMapsUrl(s.url) ? "A Maps link: it shows as Directions on the event." : "Paste a ticket, booking or Maps link."; },
    submit: (s) => onAdd(s.url, s.label),
  });
}

/* ---------- saving ---------- */
function save(prev, next) {
  try { return data.save(prev, next); }
  catch (err) { snack(String(err.message || err)); return null; }
}

function need(f) {
  needing = f;
  redraw();
  setTimeout(() => { const el = document.querySelector(`#sheetRoot [data-f="${f}"]`); if (el) el.focus(); }, 0);
}

/* Draw the open level again in place (the form after a picker or a dialog). */
function redraw(focusSel) {
  const l = topLevel();
  if (!l) return;
  replaceTop(l);
  if (focusSel) { const n = document.querySelector(`#sheetRoot ${focusSel}`); if (n) n.focus({ preventScroll: true }); }
}

function saveForm(l) {
  if (draft.end && draft.end === draft.start) draft.end = "";
  const { fields, errors } = readForm(draft);
  if (errors.length) {
    if (!fields.title) need("title");
    snack(errors[0][0].toUpperCase() + errors[0].slice(1) + ".");
    return;
  }
  if (l.kind === "new") {
    let ev;
    try { ev = newEvent(fields, { me: me(), now: new Date() }); } catch (err) { snack(String(err.message || err)); return; }
    const saved = save(null, { ...ev, costs: draft.costs });
    if (saved) { draft = null; picker = null; replaceTop({ kind: "event", id: saved.id }, "deeper"); }
  } else {
    const prev = find(l.id);
    if (!prev) { snack("This event is no longer here."); return; }
    if (save(prev, { ...prev, ...fields, costs: draft.costs })) { draft = null; picker = null; back(); }
  }
}

/* ---------- typing: values go into the draft ---------- */
function onInput(t) {
  const f = t.dataset.f; if (!f || !draft) return;
  if (needing === f) { needing = null; const w = t.closest(".m3-field"); if (w) w.classList.remove("is-error"); }
  draft[f] = t.value;
}

/* ---------- the menu, copy and delete ---------- */
function openMenu(anchor, e) {
  const layer = openLayer({
    kind: "menu", anchor, label: "More",
    html: `<button type="button" role="menuitem" data-m="copy">${ms("content_copy")}<span class="m3-body-l">Copy to another day</span></button>`
      + `<button type="button" role="menuitem" data-m="delete">${ms("delete")}<span class="m3-body-l">Delete</span></button>`,
    onMount: (el) => el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-m]");
      if (!b) return;
      if (b.dataset.m === "copy") closeLayer(layer, () => copyFlow(e.id));
      else closeLayer(layer, () => confirmDelete(e.id));
    }),
  });
}

async function copyFlow(id) {
  const e = find(id);
  if (!e) return;
  const rng = loadRange(todayKey());
  const day = await openDatePicker({ value: e.start, min: rng.min, max: rng.max, title: `Copy ${e.title} to` });
  if (!day) return;
  let saved;
  try { saved = data.save(null, copyToDay(e, day, { me: me(), now: new Date() })); }
  catch (err) { snack(String(err.message || err)); return; }
  /* Undo is a normal change: the copy is marked deleted through the store,
     so the sync merge sees it like any other delete */
  snack(`Copied to ${dateLabel(day)}`, "Undo", () => {
    try { data.remove(find(saved.id) || saved); } catch (err) { snack(String(err.message || err)); }
  });
}

function confirmDelete(id) {
  const e = find(id);
  if (!e) return;
  const layer = openLayer({
    kind: "dialog", label: `Delete ${e.title}`, cls: "m3-dialog--basic",
    html: `<span class="m3-empty-state__icon dlg-ic" aria-hidden="true">${ms("delete")}</span><h2 class="m3-headline-s dlg-title dlg-center">Delete ${esc(e.title)}?</h2>`
      + '<p class="m3-body-m m3-variant">It goes for both of you, with its costs and to-dos. You can undo it straight after.</p>'
      + '<div class="m3-dialog__actions"><button type="button" class="m3-btn m3-btn--text" data-dlg="cancel">Cancel</button>'
      + '<button type="button" class="m3-btn m3-btn--filled" data-dlg="ok">Delete</button></div>',
    onMount: (el) => el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-dlg]");
      if (!b) return;
      if (b.dataset.dlg === "cancel") { closeLayer(layer); return; }
      closeLayer(layer, () => {
        const prev = find(id);
        if (!prev) return;
        let gone;
        try { gone = data.remove(prev); } catch (err) { snack(String(err.message || err)); return; }
        draft = null; picker = null;
        closeAll();
        snack(`Deleted ${prev.title}`, "Undo", () => { try { data.undoRemove(gone); } catch (err) { snack(String(err.message || err)); } });
      });
    }),
  });
}

/* ---------- taps ---------- */
async function pickDate(which) {
  const d = draft, rng = loadRange(todayKey());
  const day = await openDatePicker({ value: which === "start" ? d.start : d.end || d.start, min: rng.min, max: rng.max,
    title: which === "start" ? "Starts on" : "Ends on" });
  if (!day || draft !== d) return;
  const r = which === "start" ? spanAfterStartChange(d.start, d.end, day) : spanAfterEndChange(d.start, d.end || d.start, day);
  d.start = r.start; d.end = r.end;
  redraw(`[data-act="pickdate"][data-w="${which}"]`);
}
async function pickTime(which) {
  const d = draft;
  const key = which === "start" ? "startTime" : "endTime";
  const t = await openTimePicker({ value: d[key] || d.startTime || "", title: which === "start" ? "Starts at" : "Ends at" });
  if (!t || draft !== d) return;
  d[key] = t;
  redraw(`[data-act="picktime"][data-w="${which}"]`);
}

function onPageAction(b, e) {
  const a = b.dataset.act;
  if (a === "edit") { draft = toDraft(e); picker = null; needing = null; openLevel({ kind: "edit", id: e.id }); return; }
  if (a === "menu") { openMenu(b, e); return; }
  if (a === "copyref") {
    copyText(b.dataset.v).then((ok) => { if (ok) snack("Copied " + b.dataset.v); });
    return;
  }
  if (a === "tick") { save(e, { ...e, checklist: e.checklist.map((c) => (c.id === b.dataset.c ? { ...c, done: !c.done } : c)) }); return; }
  if (a === "addcost") {
    costDialog(e, (c) => {
      const cur = find(e.id);
      if (!cur) return "This event is no longer here.";
      let next;
      try { next = addCost(cur, c, me(), new Date()); } catch { return "The amount is not a number."; }
      return save(cur, next) ? undefined : "The cost could not be saved.";
    });
  } else if (a === "addtodo") {
    todoDialog((text, forWho) => {
      const cur = find(e.id);
      return cur && save(cur, addTask(cur, text, forWho)) ? undefined : "The to-do could not be saved.";
    });
  } else if (a === "addlink") {
    linkDialog((url, label) => {
      const cur = find(e.id);
      if (!cur) return "This event is no longer here.";
      const next = addLinkTo(cur, { url, label });
      if (next === cur) return "That link is not valid, or it is already there.";
      return save(cur, next) ? undefined : "The link could not be saved.";
    });
  }
}

function onFormAction(b, l) {
  const d = draft;
  if (!d) return;
  const a = b.dataset.act, pick = b.dataset.pick;
  if (a === "save") { saveForm(l); return; }
  if (a === "pickdate") { pickDate(b.dataset.w); return; }
  if (a === "picktime") { pickTime(b.dataset.w); return; }
  if (a === "cleartime") { d[b.dataset.w === "start" ? "startTime" : "endTime"] = ""; return; }
  if (a === "deleteform") { confirmDelete(l.id); return; }
  if (pick) { d[pick] = b.dataset.v; return; }
  if (a === "addact") picker = "cat";
  else if (a === "pickclose") picker = null;
  else if (a === "pickback") picker = "cat";
  else if (a === "pickcat") {
    const only = onlyIcon(b.dataset.c);
    if (only) { d.activities.push({ type: b.dataset.c, icon: only }); picker = null; } else picker = b.dataset.c;
  } else if (a === "pickicon") { d.activities.push({ type: picker, icon: categoryOf(picker).icons[Number(b.dataset.i)].icon }); picker = null; }
  else if (a === "rmact") d.activities.splice(Number(b.dataset.i), 1);
  else if (a === "rmtodo") d.checklist.splice(Number(b.dataset.i), 1);
  else if (a === "rmlink") d.links.splice(Number(b.dataset.i), 1);
  else if (a === "rmcost") d.costs = d.costs.filter((k) => k.id !== b.dataset.k || !canChangeCost(k));
  else if (a === "addcost") {
    costDialog(d, (c) => {
      if (draft !== d) return "";
      try { d.costs = addCost(d, c, me(), new Date()).costs; } catch { return "The amount is not a number."; }
      redraw();
    });
  } else if (a === "addtodo") {
    todoDialog((text, forWho) => { if (draft === d) { d.checklist = addTask(d, text, forWho).checklist; redraw(); } });
  } else if (a === "addlink") {
    linkDialog((url, label) => {
      if (draft !== d) return "";
      const next = addLinkTo(d, { url, label });
      if (next === d) return "That link is not valid, or it is already there.";
      d.links = next.links; redraw();
    });
  }
}

export function initEvent(ctx) {
  data = ctx.data;
  registerLevel("event", {
    title: (l) => { const e = find(l.id); return e ? e.title : "Event"; },
    body: (l) => { const e = find(l.id); return e ? eventPage(e) : '<p class="m3-body-m m3-variant pad">This event is no longer here.</p>'; },
    bar: () => `<button type="button" class="m3-icon-btn" data-act="edit" aria-label="Edit this event">${ms("edit")}</button>`
      + `<button type="button" class="m3-icon-btn" data-act="menu" aria-label="More">${ms("more_vert")}</button>`,
    onAction: (b) => { const e = find(currentId()); if (e) onPageAction(b, e); },
  });
  for (const kind of ["edit", "new"]) {
    registerLevel(kind, {
      layer: "form",
      title: () => (kind === "new" ? "New event" : "Edit event"),
      body: () => (draft ? formPage(draft) : ""),
      bar: () => `<button type="button" class="m3-btn m3-btn--filled" data-act="save">${kind === "new" ? "Add" : "Save"}</button>`,
      onAction: (b) => onFormAction(b, topLevel()),
      onInput: (t) => onInput(t),
    });
  }
}

/* The + button: an empty form. F21: the day sheet's own "+" passes that day,
   so the form (and F22's trip-aware default city) starts there. */
export function newEventForm(date) {
  if (!me()) { snack("Choose who you are in Settings first."); return; }
  draft = blank(date); picker = null; needing = null;
  openLevel({ kind: "new" });
  setTimeout(() => { const t = document.querySelector('#sheetRoot [data-f="title"]'); if (t) t.focus({ preventScroll: true }); }, 60);
}
