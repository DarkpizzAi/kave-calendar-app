# Compass - non-negotiables

Rules that are expensive to break and easy to break by accident. Everything
else, including the whole design system, lives in the `design` plugin of the
private `kave-hub` repo: read `design/data/household-look.md` and
`design/data/household-tokens.css`, or invoke its `apply-household-look`
skill. **Do not restate the design system here.** This repo is public.

## Never rename

The repo, its GitHub Pages URL, and the `CACHE` name in `service-worker.js`
are the deployment's identity. Renaming any of them moves the live URL and
orphans every installed copy on every phone. There is no migration path.

## Bump `VERSION` on every deploy

In `service-worker.js`. **A token change counts as a deploy.** A stale
service worker will happily keep serving the old shell and the old look, and
the symptom looks like "my change did nothing" rather than like an error.

## `tokens.css` is generated

It is a verbatim copy of `design/data/household-tokens.css` in kave-hub,
placed by that repo's `design/tools/sync-household-tokens.py`.

**Never hand-edit it.** Edit the hub and re-sync. Check for drift with
`python design/tools/sync-household-tokens.py --check` from the hub. If you
change how this app links or names that file, flip its flag in that script's
`TARGETS` in the same commit, or the check stops guarding it silently.

`styles.css` uses those tokens and must define none of its own.

## Security: XSS is the whole threat model

The GitHub token sits in `localStorage` in plain text, because a static page
with no server of its own has nowhere better. So anything that can run script
on this origin can read it and write to the private repo.

- Every synced string reaches the DOM through `escapeHtml`.
- Every URL goes through `safeUrl`. Escaping does nothing to a
  `javascript:` scheme, which is how this exact bug reached production in the
  sister app.
- No `eval`, no `new Function`, no `document.write`, no
  `insertAdjacentHTML`. Not "avoid" - none.
- **Recompute the CSP hash after touching `#theme-preload`**, even by one
  character of whitespace. The command is in the README. A blocked script is
  silent; the app flags it in Settings, which is the only reason you would
  notice.

## Every module goes in `SHELL`

In `service-worker.js`. A module missing there is a module the app cannot
load offline, and nothing reports it until someone opens the app with no
signal. Adding a file under `js/` means adding it to `SHELL` in the same
change.

## `eol=lf`

Pinned in `.gitattributes`. The CSP carries a sha256 of an inline script, so
the bytes hashed locally have to be the bytes Pages serves. A CRLF working
tree hashes to something production rejects.

## Repo first, box second

An always-on mini PC runs the scheduled jobs this app cannot run while
closed. **Only genuinely sensitive things live on it, and as little as
possible:** OAuth tokens, any bank credentials, raw audio awaiting
transcription, and the jobs themselves.

Everything else belongs in the repo - events, cost lines, checklists, travel
data, the insights queue, transcripts. Anything on the box is invisible,
unversioned, and lost if the box dies.

## Compass is the confirmation gate

What a person reviewed and accepted from a nightly sweep, or entered by hand,
is the source of truth. Nothing downstream may contradict it.

The unconfirmed remainder is not this app's problem: it belongs to a separate
finance app, and **that app reads the confirmed set from here**, one way.
Never build a path that infers the same number independently, and never add
anything to the user's data automatically - a sweep proposes, a person
decides.

## Check the no-token state

The app with no token saved is a real screen, seen after every reinstall. It
is invisible to a diff and to a dev run with a token present, and in the
sister app that blind spot hid three defects in one release. Test it
deliberately.
