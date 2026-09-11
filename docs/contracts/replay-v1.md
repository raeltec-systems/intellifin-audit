# Replay, schema 1

**Status:** normative. Story 5.8 (FR-8, FR-30, UX-DR24, UX-DR26, UX-DR37, addendum §F).

The surface that replays a terminal Run. What it may read, what it may never reach, where a
jump lands, and what a keystroke does. The asset set itself is
`replay-asset-set-v1.md` (Story 5.2); this document renders it and adds nothing to it.

The presentation logic is `apps/web/src/runs/replay.ts`, the component is
`apps/web/src/runs/ReplayViewer.tsx`, the page is `apps/web/app/runs/[id]/replay/page.tsx`,
and the reads are `readFrames`, `readWaits` and `readObservationDeltas` on
`DrizzleRunDetailRepository`.

## Replay reaches NOTHING outside this platform

FR-30's rule is that a terminal Run replays from assets the platform owns even when the
Workspace Provider's own recording has expired or its host cannot be reached. That is a
property of what this path can reach rather than one it remembers:

- every prop the viewer takes is a row PostgreSQL already holds;
- every frame is fetched through the Run's own protected route, which consumes a
  worker-signed Evidence read grant on the server, so no object-store URL — signed or
  otherwise — is ever in the markup (AD-5);
- `replay.ts` takes rows and returns indices, and the page imports no provider client, no
  workspace port and no outbound fetch.

`tests/e2e/replay.spec.ts` makes the claim literal: **every destination but the
application's own origin is aborted at the network AND counted**, and the surface is
required to render whole with the count at zero. A later change that reached for a provider
fails there rather than in a deployment whose provider happened to answer.

**Nothing is ever re-executed** (FR-30, addendum §F). There is no action, no command and no
port on this path; a Replay that could re-run a Tool Action would be a Replay that could
change what it is showing.

## It starts PAUSED at the first frame

UX-DR26. A Replay that started playing would move a session under somebody who opened it to
look at one thing. Server-side rendering is that state, so `ReplayViewer.test.ts` asserts
the contract rather than a convenience: the control offers **Play**, the counter says
`Frame 1 of N`, and the only frame in the markup is the first.

Playing advances one frame every `FRAME_INTERVAL_MS` and STOPS at the last: a loop would
make a finished session look like one still going.

## A Run that has not finished has no Replay

`isActiveRunState` covers `QUEUED` as well as the three working states, so it is the whole
of "not terminal" and there is no second list to keep in step. Such a Run gets the sentence
and a link to Live View, never a viewer: rendering a Replay of a session still being written
would show a reader a finished session that is not finished.

The rail says the same thing from the other side. `WatchControl` is ONE control in the
Session slot with three states — **Watch** disabled with `Live View opens when the Run
starts.` on a Queued Run, **Watch** as a link on an active one, **Replay** as a link on a
terminal one. It rendered nothing at all on a terminal Run until this surface existed.

## Where a jump lands

| Target | Frame |
| --- | --- |
| Work Item | its FIRST frame — jumping to a Work Item means starting at it |
| Exception | the first frame of the Work Item it was raised against |
| Escalation | the LAST frame captured at or before the wait was opened |
| any of them, with no frame | **none**, and the row says so instead of offering a pill |

An Escalation asks about a page, and the page it asks about is the last one captured before
it was raised; a frame captured after it belongs to whatever happened next. An unreadable
instant resolves to nothing rather than to the first frame — guessing where a wait belongs
is worse than saying nothing was found for it.

**A pause is not a jump target.** EXPERIENCE.md's Replay row names Work Items, Exceptions
and Escalations; a pause is a wait that asks nothing, the distinction generation 45 enforces
in the database and `run-pause-v1.md` states.

The list is ordered by the frame each target lands on, so it reads the way the session ran,
with unreachable targets last; ties break on kind then id, so the order is deterministic
rather than whatever the reads returned.

## The Observation count beside a frame

A running total over the chain's own `execution.observations-registered` events, compared
against the frame's ACTION start — the same instant the frames are ordered by, so the number
a reader sees beside a frame is true of the moment that frame was taken. A payload field
this build does not recognize is read as ABSENT rather than coerced: a chain row is
immutable, and a fabricated count would be a fact nobody recorded.

## One session viewer, in two modes

UX-DR24's "one session viewer for Live View and Replay" is met by SHARING the parts that
are literally the same markup — `SessionChrome` (the state dot and word, the workspace
identity, the isolation note, the counter) and `SessionStage` (one registered frame, or the
sentence saying why there is none). Both were extracted from `LiveViewer` when Replay needed
them, rather than copied: two copies would agree on every case anybody tried and diverge on
the first one nobody did, and here that would be a Replay whose dot said one thing and whose
word said another.

What differs is what each surface means by "the frame": Live View shows the newest and
Replay shows the selected one. `readFrames` is `readLatestFrame`'s join with its order
reversed, so Live View's newest frame and Replay's last frame are the same row by
construction.

`REPLAY_FRAME_LIMIT` is 500, larger than a detail page because a scrubber over fifty pills
is a scrubber over a fraction of the session and would silently misrepresent where a Step
sits in it. It is still bounded, with the exact total beside it, and the surface says
`Showing the first {shown} of {total} frames.` when it binds.

## The keyboard

| Key | What it does |
| --- | --- |
| Left / Up | one frame back |
| Right / Down | one frame forward |
| Home / End | the first / last frame |
| Space, on the viewer | play or pause |
| Space or Enter, on a scrubber pill | jump to that frame |
| Space or Enter, on a jump row | jump to that target |

The pills and the jump rows are real `<button>`s, so the browser activates them on Space and
Enter with nothing added. **Space on the viewer is therefore taken only when the viewer
ITSELF has focus** — one keystroke does one thing, and a pill that both jumped and toggled
playback would be the defect.

A frame's `alt` is its Step's narration, the same string the rail shows (UX-DR37): a reader
who cannot see the picture hears exactly what the picture is captioned with.

## What this contract does not cover

- **The asset set** — what a frame, an action, a Session Step or a recording IS, and when
  the set is not whole: `replay-asset-set-v1.md`.
- **The provider's own recording.** `run_replay_recording` is copied at the terminal release
  when `SOLARI_RECORDING` was on at session creation; nothing on this surface reads it, and
  Replay is whole without it. A supplementary link to it is a later story's.
- **Exception investigation** (Epic 6). The jump list reaches an Exception's frame; the
  provenance chain behind it is Exception Detail's.
