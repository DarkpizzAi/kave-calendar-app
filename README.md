# Compass

The household planner: events, what they cost, trips, and the loose ends
attached to them. Replaces Google Calendar and the yearly planning sheet.

**This is a shell, not a finished app.** Calendar, Insights, Trips and Radar
are deliberate dashed stubs. Compass has been brainstormed - see
`calendar/data/compass-planning-app-brainstorm.md` in kave-hub, which covers
the event model, money, the two-person noise filter, the five tabs and the
daily recap - but it has no spec and no data model yet. What exists here is everything the household
conventions already decided: the look, the module shape, the security
posture, the service worker, and a Settings tab that actually works.

**This repo is the static app shell only.** No data, no secrets. It is public
so GitHub Pages can serve it for free.

## Where things live

**The repo is the data store.** Events, cost lines, checklists, travel data,
the insights queue and voice-note transcripts all live in the private
`DarkpizzAi/kave-hub` repo under `calendar/data/`, reached with
a personal token pasted in Settings. That is the pattern this shell was built
on and it stands. The finance facts log Compass writes to is not Compass
data: it lives with the finance plugin, `finance/data/` in kave-hub.

**An always-on mini PC runs what the app cannot.** Arriving early October
2026, on 24/7, also a media server. It runs two separable scheduled jobs: a
nightly pass that scans both inboxes, reads new bank extracts, transcribes
voice notes and matches them against existing events; and a morning pass that
sends each person's recap email. Two jobs, so a failure in one does not kill
the other.

It beats a scheduled GitHub Action or a small VPS for one specific reason:
**Gmail and the bank extracts never leave the house.**

**Standing principle: repo first, box second.** Only genuinely sensitive
things live on the mini PC, and as little as possible - Gmail OAuth tokens,
any bank credentials, raw audio pending transcription, and the scheduled jobs
themselves. Everything else is in the repo, because anything on the box is
invisible, unversioned and lost if the box dies.

Known risk: the box is a single point of failure - asleep, rebooting,
Windows updating. Survivable only because a last-scanned timestamp makes it
visible in the app.

Nothing personal is ever committed to *this* repo, which is the public shell.

## What Compass owns

**Interpretation, never amounts.** The bank extracts are the source of truth
for money. Compass enriches them: whose a line is, how it splits, which trip
it belongs to. A cost typed into Compass is a claim until a sweep matches it
to a bank line and someone locks it; on a mismatch the bank's figure wins.
The finance side reads the extracts and consults Compass, one way.

What Compass is the source of truth for is everything the bank cannot know:
events, trips and their phases, checklists, ideas on the Radar, and the
decisions people made on insights.

## Run locally

```bash
python dev_server.py
```

Then open `http://localhost:8778/`. Port 8778 so it runs alongside Spoon
(8777) and the kave-hub page (8642). The server sends `no-store`, so a plain
reload always shows your latest edit. The service worker does not run on
`localhost`, and tears itself down if it ever finds itself there.

## The look

`tokens.css` is **generated**. It is a verbatim copy of
`brand/data/household-tokens.css` in kave-hub, placed by that repo's
`brand/tools/sync-household-tokens.py`.

**Never hand-edit `tokens.css`.** Edit the hub and re-sync. To check this copy
has not drifted, from the kave-hub repo:

```bash
python brand/tools/sync-household-tokens.py --check
```

`styles.css` uses those tokens and defines none of its own. Density tier here
is `phone`.

## Icons

`icon-512.png` is the master artwork, and it is currently a **placeholder** -
a generated compass rose, not designed. Replace it, then:

```bash
python make_icons.py
```

That derives `icon-192.png`, `icon-512-maskable.png` (opaque, artwork at 70%
so any launcher crop is safe) and `apple-touch-icon.png` (flattened; iOS
paints alpha black). Then bump `VERSION` in `service-worker.js`.

## Deploy

Pushed to `main`, served by GitHub Pages. Relative fetch paths, so a subpath
is fine.

**Bump `VERSION` in `service-worker.js` on every deploy.** A token change is a
deploy too: a stale service worker will happily keep serving the old look.

**Never rename this repo, its Pages URL, or the service-worker cache name.**
They are the deployment's identity. Renaming moves the live URL and orphans
every installed copy on every phone.

## The token, and what protects it

The GitHub token lives in `localStorage`, under `compass.settings`, in plain
text. There is nowhere better: this is a static page with no server of its
own, so a token that survives a reload has to sit somewhere any script on the
origin can read. `github.js` never touches storage - the app pushes the token
in with `setToken()` - but that is layering, not protection. The input is
`type="password"` with `autocomplete="off"`, and the token is never logged,
never put in a URL, and never rendered into markup: it goes into an
`Authorization` header, to `api.github.com` and nowhere else.

That means **XSS is the whole threat model.** Anything that can run script on
this origin can read the token and write to the hub repo. So: no synced string
reaches the DOM as markup, every interpolation goes through `escapeHtml`,
every URL through `safeUrl`, and there is no `eval`, no `new Function`, no
`document.write` and no `insertAdjacentHTML`.

There is a **Content-Security-Policy** as a `<meta http-equiv>` in
`index.html`, because Pages serves static files and cannot set headers. The
load-bearing part is `script-src 'self'` plus a single hash, with no
`'unsafe-inline'` and no `'unsafe-eval'`. `connect-src` is `'self'` and
`api.github.com` only. A meta CSP silently ignores `frame-ancestors`,
`report-uri` and `sandbox`, so they are absent rather than written down doing
nothing: **clickjacking is not covered.**

If a token is ever exposed, revoke it on GitHub. Clearing it in Settings only
removes this device's copy.

### Recomputing the script hash

`script-src` carries a `sha256` of `#theme-preload`, the anti-flash palette
script inlined in `index.html`. Edit that script - one character of whitespace
is enough - and the hash stops matching and the script is blocked. Recompute
it with:

```
python -c "import re,hashlib,base64;b=re.search(rb'<script id=\"theme-preload\">(.*?)</script>',open('index.html','rb').read(),re.S).group(1);print('sha256-'+base64.b64encode(hashlib.sha256(b).digest()).decode())"
```

It matches on the `id` rather than on the first `<script>` in the file, and it
lives here rather than in `index.html` for the reason that cost Spoon an
iteration: a command containing the text `<script></script>` is itself the
first thing a regex hunting for the script finds, so documenting it in the
file it parses made it hash its own documentation.

A blocked script would otherwise be silent - the symptom is the colour flash
it exists to prevent, not an error. So it announces itself: the script stamps
`data-theme-boot` on `<html>` before doing anything else, and Settings shows a
red *Theme preload BLOCKED* line when that stamp is missing.

`.gitattributes` pins `eol=lf`, so the bytes hashed locally are the bytes
Pages serves - a CRLF working tree would hash to something production rejects.

## Code shape

Native ES modules, no bundler, no build step.

| Module | Does |
|--------|------|
| `js/util.js` | `escapeHtml`, `safeUrl`, `uid`, `own` |
| `js/store.js` | persisted state, `localStorage` under `compass.*` |
| `js/theme.js` | palette selection, colour-scheme, CSP-boot diagnostic |
| `js/sync.js` | sync status and the token check |
| `js/render.js` | all views, re-rendered whole on every interaction |
| `js/wire.js` | one-time listeners, the banner |
| `js/pull-to-sync.js` | the pull gesture, armed per tab |
| `js/boot.js` | entry point, service-worker registration |
| `github.js` | Contents API client, carried over from Spoon |

**Every module must be listed in `SHELL` in `service-worker.js`.** A module
missing there is a module the app cannot load offline, and nothing will say so
until someone opens Compass with no signal.

State lives in three places by lifetime: persisted `store.state` mirrored to
`localStorage`; module-level transient UI state that calls its own render
directly; and derived locals. Rendering is a full re-render on every
interaction, which is fine at this size and is the thing to know before adding
features.

## Status

**Shell only.** Calendar, Insights, Trips and Radar are dashed stubs. Settings works: paste a token, check it against the hub repo,
switch palette, read the running service-worker version, see whether the CSP
preload was blocked.

Next: a spec for what Compass actually does.
