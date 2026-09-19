/* Compass: sync status and the token check.

   There is no data sync yet, because Compass's data model has not been
   designed. What exists is the half that is already decided: whether the
   token works, and how that is reported.

   When the feature spec lands, the engine it grows follows Spoon's, and the
   four things Spoon learned the hard way are not optional:
     - conditional GETs with an ETag, so a 304 is free and uncharged
     - two lanes, so a contended file is not held back by a large one
     - a lane stamped only when actually entered, never when merely due
     - the `syncing` latch cleared in a `finally`, because clearing it on the
       normal tail leaves it stuck on forever after one throw, and the app
       then goes quietly stale with no error to show for it
   The reasoning is in the Spoon README's Status section. Read it before
   writing a sync engine here. */
"use strict";

import { store } from "./store.js";
import { github } from "../github.js";

/* Transient, not persisted: a status is about this session. */
export let status = { state: "idle", message: "", at: 0 };

function set(state, message) {
  status = { state, message, at: Date.now() };
}

/* Prove the token can actually reach the repo. A HEAD-shaped read of the
   repo's own metadata is enough: it needs the same Contents permission real
   sync will need, and it writes nothing. */
export async function checkToken() {
  const token = store.state.settings.token;
  if (!token) { set("none", "No token set"); return status; }

  set("checking", "Checking token...");
  try {
    github.setToken(token);
    await github.getFile("calendar/data/roadmap.md");
    set("ok", "Token works. Reached kave-hub.");
    store.state.sync.syncedAt = Date.now();
    store.persist("compass.sync", store.state.sync);
  } catch (e) {
    const kind = e && e.gh;
    if (kind === "offline") set("offline", "Offline. Nothing synced.");
    else if (kind === "unauthorized") set("bad", "Token rejected. Check it has Contents: read and write on kave-hub.");
    else if (kind === "notFound") set("bad", "Reached GitHub but not the file. Is the token scoped to kave-hub?");
    else if (kind === "rateLimited") set("bad", "Rate limited by GitHub. Try again later.");
    else set("bad", "Could not reach GitHub: " + (e && e.message ? e.message : "unknown error"));
  }
  return status;
}
