/* Compass service worker.

   Caches the static shell so the app installs and opens offline. Data
   (api.github.com) always hits the network. Bump VERSION on every deploy so
   the old cache is cleared and the "new version" banner fires.

   On the local dev server this file is a kill switch instead: it wipes every
   cache and unregisters itself. boot.js also refuses to register on
   localhost, but that guard is unreachable once an old worker is serving a
   stale boot.js - the browser always re-fetches THIS file from the network,
   so the teardown has to live here to be able to break out of a stale shell.
*/

const VERSION = "v0.6";
const CACHE = `kave-compass-${VERSION}`;

const IS_LOCAL_DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

if (IS_LOCAL_DEV) {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: "window" }))
        .then((cs) => cs.forEach((c) => c.navigate(c.url)))
    );
  });
} else {

/* EVERY module file has to be listed. A module missing here is a module the
   app cannot load offline, and nothing says so until someone opens Compass
   with no signal. Adding a file under js/ means adding it here in the same
   change. */
const SHELL = [
  "./",
  "index.html",
  "tokens.css",
  "styles.css",
  "manifest.json",
  "github.js",
  "js/util.js",
  "js/dates.js",
  "js/money.js",
  "js/merge.js",
  "js/local.js",
  "js/store.js",
  "js/theme.js",
  "js/sync.js",
  "js/render.js",
  "js/wire.js",
  "js/pull-to-sync.js",
  "js/boot.js",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "version" && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: VERSION });
  }
  if (d.type === "skipWaiting") self.skipWaiting();
});

/* Precache with cache: "reload" on every request. c.addAll() goes through the
   browser's HTTP cache, and Pages serves the shell with a 10 minute max-age,
   so a VERSION bump right after a deploy can fill the brand new cache with
   the files it was meant to replace. That really happened to Spoon on its v6
   deploy: index.html and app.js came through fresh, styles.css did not. */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(
        SHELL.map((u) => fetch(new Request(u, { cache: "reload" }))
          .then((res) => {
            if (!res || !res.ok) throw new Error(`precache ${u}: ${res && res.status}`);
            return c.put(u, res);
          }))
      ))
      .then(() => self.skipWaiting())
  );
});

/* Claim BEFORE deleting old caches, not after. The outgoing worker keeps
   handling fetches until this one claims its clients, and its
   stale-while-revalidate does caches.open(<its own CACHE>), which recreates
   the cache just deleted. Spoon watched kave-food-v7 come back from the dead
   moments after activate cleaned it up. */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    self.clients.claim()
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // GitHub API and any other host: straight to the network, never cached.
  // Deliberate: a cached API response would be a cached Authorization result.
  if (url.origin !== self.location.origin && !FONT_HOSTS.includes(url.hostname)) return;

  // navigation: network first so a new shell always wins, cache as the
  // offline fallback. Cache-only here strands the browser on an old
  // index.html that no amount of reloading can replace.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("index.html")))
    );
    return;
  }

  // shell assets + fonts: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

}
