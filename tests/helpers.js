export function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

function ghErr(kind, status) { const e = new Error(kind); e.gh = kind; e.status = status; return e; }

/* A fake of github.js over an in-memory map of path -> { json, sha, etag }.
   `beforePut` lets a test change the file between a flush's read and write,
   which is how a concurrent save from the other phone is simulated. */
export function fakeGh(files = {}) {
  let n = 0;
  const gh = {
    files, puts: 0, beforePut: null,
    async getFile(path, opts) {
      const f = files[path];
      if (!f) throw ghErr("notFound", 404);
      if (opts && opts.etag && opts.etag === f.etag) return { notModified: true };
      return { json: structuredClone(f.json), sha: f.sha, etag: f.etag };
    },
    async putFile(path, value, sha) {
      if (gh.beforePut) { const hook = gh.beforePut; gh.beforePut = null; await hook(); }
      const f = files[path];
      if ((f ? f.sha : null) !== (sha || null)) throw ghErr(f ? "conflict" : "http", f ? 409 : 422);
      n++; gh.puts++;
      files[path] = { json: structuredClone(value), sha: "sha" + n, etag: "etag" + n };
      return { sha: "sha" + n, commit: "c" + n };
    },
  };
  return gh;
}
