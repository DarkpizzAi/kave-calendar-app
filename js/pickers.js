/* Compass: the Material date picker and the 24-hour time dial (Task 4).

   Both are dialogs on the sheet system's layer stack (openLayer), so Back,
   Escape and a tap outside close exactly one layer, focus returns to the
   field that opened them, and everything behind is inert. Each returns a
   Promise: the chosen value, or null when cancelled. The pure helpers are
   tested (tests/pickers.test.js). */
"use strict";

import { escapeHtml as esc } from "./util.js";
import { addDays, dayOfWeek, todayKey } from "./dates.js";
import { monthCells, addMonths } from "./cal-model.js";
import { ms } from "./chrome-icons.js";
import { openLayer, closeLayer } from "./sheet.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHORT_MONTH = MONTHS.map((m) => m.slice(0, 3));
const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const pad2 = (n) => String(n).padStart(2, "0");

/* ---- pure helpers ---- */

/* "HH:MM" to hours and minutes; an empty or odd value opens on 20:00. */
export function splitTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : { h: 20, m: 0 };
}
export const joinTime = (h, m) => `${pad2(h)}:${pad2(m)}`;

/* A point on the 256px dial: item i of n, at radius r from the centre. */
export function dialPoint(i, n, r) {
  const a = (i / n) * 2 * Math.PI - Math.PI / 2;
  return { x: 128 + r * Math.cos(a), y: 128 + r * Math.sin(a) };
}

/* A day outside min..max snaps to the nearest end; an empty bound is open. */
export function clampDayTo(day, min, max) {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

export const monthBounds = (min, max) => ({ min: min ? min.slice(0, 7) : "", max: max ? max.slice(0, 7) : "" });

/* Can the month arrows go one step (dir -1 or 1) without leaving the range? */
export function canStep(ym, dir, minYm, maxYm) {
  const next = addMonths(ym, dir);
  return !((minYm && next < minYm) || (maxYm && next > maxYm));
}

/* "Wed, 28 Oct" */
export const dateLabel = (d) => `${SHORT_DOW[dayOfWeek(d)]}, ${Number(d.slice(8))} ${SHORT_MONTH[Number(d.slice(5, 7)) - 1]}`;

const longLabel = (d) => `${SHORT_DOW[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/* ---- the date picker ---- */
export function openDatePicker({ value, min = "", max = "", title = "Select date" } = {}) {
  return new Promise((resolve) => {
    let sel = clampDayTo(value || todayKey(), min, max);
    let ym = sel.slice(0, 7), result = null, focusSel = "";
    const { min: minYm, max: maxYm } = monthBounds(min, max);
    const today = todayKey();

    const html = () => {
      const cells = monthCells(ym).map((c) => {
        if (!c.inMonth) return "<span></span>";
        const off = (min && c.day < min) || (max && c.day > max);
        const on = c.day === sel;
        return `<button type="button" class="dp-d${on ? " on" : ""}${c.day === today ? " today" : ""}" data-day="${c.day}" tabindex="${on ? 0 : -1}"`
          + `${off ? " disabled" : ""} aria-label="${esc(longLabel(c.day))}"${on ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${Number(c.day.slice(8))}</button>`;
      }).join("");
      return `<div class="dp-head"><span class="m3-label-l m3-variant">${esc(title)}</span><span class="m3-headline-m">${esc(dateLabel(sel))}</span></div>`
        + '<div class="m3-divider"></div>'
        + `<div class="dp-nav"><span class="m3-title-s dp-month" aria-live="polite">${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}</span><span class="m3-spacer"></span>`
        + `<button type="button" class="m3-icon-btn m3-icon-btn--small" data-step="-1" aria-label="Previous month"${canStep(ym, -1, minYm, maxYm) ? "" : " disabled"}>${ms("chevron_left")}</button>`
        + `<button type="button" class="m3-icon-btn m3-icon-btn--small" data-step="1" aria-label="Next month"${canStep(ym, 1, minYm, maxYm) ? "" : " disabled"}>${ms("chevron_right")}</button></div>`
        + `<div class="dp-grid" role="group" aria-label="${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}">${LETTERS.map((w) => `<span class="dp-w" aria-hidden="true">${w}</span>`).join("")}${cells}</div>`
        + '<div class="m3-dialog__actions dp-acts"><button type="button" class="m3-btn m3-btn--text" data-pick="cancel">Cancel</button>'
        + '<button type="button" class="m3-btn m3-btn--text" data-pick="ok">OK</button></div>';
    };

    let layer = null;
    const draw = () => {
      layer.el.innerHTML = html();
      const target = layer.el.querySelector(focusSel || ".dp-d.on");
      if (focusSel && target) target.focus({ preventScroll: true });
      focusSel = "";
    };
    const move = (day) => {
      const to = clampDayTo(day, min, max);
      if (to === sel) return;
      sel = to; ym = sel.slice(0, 7); focusSel = ".dp-d.on"; draw();
    };

    layer = openLayer({
      kind: "dialog", label: title, cls: "dp-dialog", html: html(),
      onClose: () => resolve(result),
      onMount: (el) => {
        el.addEventListener("click", (e) => {
          const day = e.target.closest("[data-day]"), step = e.target.closest("[data-step]"), pick = e.target.closest("[data-pick]");
          if (day && !day.disabled) { sel = day.dataset.day; focusSel = ".dp-d.on"; draw(); }
          else if (step && !step.disabled) {
            const dir = Number(step.dataset.step);
            ym = addMonths(ym, dir);
            focusSel = `[data-step="${dir}"]`;
            draw();
            /* the arrow that has just reached the end of the range is disabled: keep focus in the dialog */
            if (!layer.el.querySelector(focusSel) || layer.el.querySelector(focusSel).disabled) layer.el.querySelector(".dp-d.on, .dp-d:not([disabled])").focus({ preventScroll: true });
          } else if (pick) {
            if (pick.dataset.pick === "ok") result = sel;
            closeLayer(layer);
          }
        });
        el.addEventListener("keydown", (e) => {
          if (!e.target.closest(".dp-grid")) return;
          const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (by) { e.preventDefault(); move(addDays(sel, by)); }
          else if (e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            const m = addMonths(sel.slice(0, 7), e.key === "PageUp" ? -1 : 1);
            move(clampDayTo(`${m}-${pad2(Math.min(Number(sel.slice(8)), 28))}`, min, max));
          }
        });
        const on = el.querySelector(".dp-d.on");
        if (on) on.focus({ preventScroll: true });
      },
    });
  });
}

/* ---- the time dial: 24 hours on two rings, then minutes ---- */
export function openTimePicker({ value = "", title = "Select time" } = {}) {
  return new Promise((resolve) => {
    let { h, m } = splitTime(value);
    let mode = "h", result = null, focusSel = "";

    const html = () => {
      let nums = "", hand = null;
      if (mode === "h") {
        for (let i = 0; i < 24; i++) {
          const inner = i >= 12, p = dialPoint(i % 12, 12, inner ? 70 : 106), on = i === h;
          nums += `<button type="button" class="tp-n${inner ? " in" : ""}${on ? " on" : ""}" data-h="${i}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px" aria-label="${pad2(i)} hours"${on ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${pad2(i)}</button>`;
          if (on) hand = p;
        }
      } else {
        for (let i = 0; i < 12; i++) {
          const v = i * 5, p = dialPoint(i, 12, 106), on = v === m - (m % 5);
          nums += `<button type="button" class="tp-n${on ? " on" : ""}" data-m="${v}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px" aria-label="${pad2(v)} minutes"${on ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${pad2(v)}</button>`;
          if (on) hand = p;
        }
      }
      const box = (k, v) => `<button type="button" class="tp-box${mode === k ? " on" : ""}" data-mode="${k}" aria-label="${k === "h" ? "Hours" : "Minutes"}, ${pad2(v)}">${pad2(v)}</button>`;
      return `<div class="dp-head"><span class="m3-label-l m3-variant">${esc(title)}</span>`
        + `<div class="tp-boxes">${box("h", h)}<span class="tp-colon m3-display-s">:</span>${box("m", m)}</div></div>`
        + `<div class="tp-dial"><svg width="256" height="256" viewBox="0 0 256 256" aria-hidden="true">`
        + `${hand ? `<line class="tp-hand" x1="128" y1="128" x2="${hand.x.toFixed(1)}" y2="${hand.y.toFixed(1)}"/>` : ""}<circle class="tp-pivot" cx="128" cy="128" r="4"/></svg>${nums}</div>`
        + '<div class="m3-dialog__actions dp-acts"><button type="button" class="m3-btn m3-btn--text" data-pick="cancel">Cancel</button>'
        + '<button type="button" class="m3-btn m3-btn--text" data-pick="ok">OK</button></div>';
    };

    let layer = null;
    const draw = () => {
      layer.el.innerHTML = html();
      const t = layer.el.querySelector(focusSel || ".tp-n.on");
      if (t) t.focus({ preventScroll: true });
      focusSel = "";
    };

    layer = openLayer({
      kind: "dialog", label: title, cls: "dp-dialog tp-dialog", html: html(),
      onClose: () => resolve(result),
      onMount: (el) => {
        el.addEventListener("click", (e) => {
          const hb = e.target.closest("[data-h]"), mb = e.target.closest("[data-m]"), bx = e.target.closest("[data-mode]"), pick = e.target.closest("[data-pick]");
          if (hb) { h = Number(hb.dataset.h); mode = "m"; focusSel = ".tp-n.on"; draw(); }
          else if (mb) { m = Number(mb.dataset.m); draw(); }
          else if (bx) { mode = bx.dataset.mode; focusSel = ".tp-n.on"; draw(); }
          else if (pick) {
            if (pick.dataset.pick === "ok") result = joinTime(h, m);
            closeLayer(layer);
          }
        });
        el.addEventListener("keydown", (e) => {
          if (!e.target.closest(".tp-dial")) return;
          const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
          if (!step) return;
          e.preventDefault();
          if (mode === "h") h = (h + step + 24) % 24; else m = (m - (m % 5) + step * 5 + 60) % 60;
          focusSel = ".tp-n.on"; draw();
        });
        const on = el.querySelector(".tp-n.on");
        if (on) on.focus({ preventScroll: true });
      },
    });
  });
}
