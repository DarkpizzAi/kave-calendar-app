import { test, eq } from "./run.js";
import { escapeHtml, safeUrl } from "../js/util.js";

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
