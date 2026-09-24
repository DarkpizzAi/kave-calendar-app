const rows = [];
let failed = 0;

export function test(name, fn) { rows.push({ name, fn }); }

export function eq(actual, expected, label = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

export function ok(value, label = "") {
  if (!value) throw new Error(`${label} expected truthy, got ${JSON.stringify(value)}`);
}

export async function throws(fn, label = "") {
  try { await fn(); } catch (e) { return e; }
  throw new Error(`${label} expected a throw`);
}

export async function runAll() {
  const out = document.getElementById("out");
  for (const { name, fn } of rows) {
    let line;
    try { await fn(); line = "PASS " + name; }
    catch (e) { failed++; line = "FAIL " + name + " :: " + e.message; }
    const p = document.createElement("p");
    p.textContent = line;
    out.append(p);
  }
  const done = document.createElement("p");
  done.id = "done";
  done.textContent = `DONE ${rows.length - failed} passed, ${failed} failed`;
  out.append(done);
}
