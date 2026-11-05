import { test, eq } from "./run.js";
import { escapeHtml, safeUrl, appHref } from "../js/util.js";

test("escapeHtml escapes the five characters", () => {
  eq(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
test("safeUrl keeps absolute http(s)", () => {
  eq(safeUrl("https://maps.google.com/?q=Razzmatazz"), "https://maps.google.com/?q=Razzmatazz");
});
test("safeUrl drops javascript:, relative and empty", () => {
  eq(safeUrl("javascript:alert(1)"), "");
  eq(safeUrl("not a url"), "");
  eq(safeUrl(""), "");
});

import { copyText } from "../js/util.js";
test("copyText: the clipboard first, then the older copy command, else false", async () => {
  const written = [];
  eq(await copyText("u", { clipboard: { writeText: async (t) => { written.push(t); } }, legacy: () => false }), true);
  eq(written, ["u"]);
  eq(await copyText("u", { clipboard: { writeText: async () => { throw new Error("denied"); } }, legacy: () => true }), true);
  eq(await copyText("u", { clipboard: null, legacy: () => false }), false);
});

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
test("appHref opens the Ryanair app on Android, the page as fallback", () => {
  eq(appHref("https://www.ryanair.com/gb/en/trip/manage", ANDROID),
    "intent://www.ryanair.com/gb/en/trip/manage#Intent;scheme=https;package=com.ryanair.cheapflights;"
    + "S.browser_fallback_url=https%3A%2F%2Fwww.ryanair.com%2Fgb%2Fen%2Ftrip%2Fmanage;end");
});
test("appHref leaves other sellers, other phones and bad links alone", () => {
  eq(appHref("https://www.liceubarcelona.cat/x", ANDROID), "https://www.liceubarcelona.cat/x");
  eq(appHref("https://www.ryanair.com/gb/en/trip/manage", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), "https://www.ryanair.com/gb/en/trip/manage");
  eq(appHref("javascript:alert(1)", ANDROID), "");
});
