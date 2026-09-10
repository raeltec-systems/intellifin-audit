# Live View, schema 1

The normative contract for watching a Running Run: what the session viewer shows, where a
frame comes from, and what it must never carry. It implements FR-24 and UX-DR24/UX-DR25,
and it builds on `live-timeline-channel-v1.md` (Story 5.1), which is what makes the
surface update on its own.

The presentation logic is `apps/web/src/runs/live-view.ts`, the component is
`apps/web/src/runs/LiveViewer.tsx`, the page is `apps/web/app/runs/[id]/live/page.tsx`,
and the one frame route is
`apps/web/app/runs/[id]/frames/[evidenceId]/route.ts`.

## Live View is a surface, not a Run Detail tab

EXPERIENCE.md reaches it from the Run Detail rail's **Watch** control and from a
notification, and its breadcrumb is `Runs / <run> / Live`. It therefore does not appear in
`RUN_TABS`, and — exactly like each Run Detail tab — it **authorizes for itself** through
`openRun`, which calls `requireServerAction('run.initiate')` BEFORE it resolves the Run.
Reaching one surface has never been a precondition for reading another.

`WatchControl` is one control in two states, decided on the server:

| Run state | Watch |
| --- | --- |
| `QUEUED` | Disabled, with EXPERIENCE.md's own reason: `Live View opens when the Run starts.` |
| `RUNNING`, `PAUSED`, `AWAITING_AUDITOR` | A link to `/runs/<id>/live` |
| Terminal | **Nothing.** Its session is Replay, which Story 5.8 builds. |

A control labelled Watch that opened a page saying the Run was over would name the wrong
thing, and one labelled Replay would point at a surface that does not exist.

## The chrome vocabulary is closed and total over the Run states

`liveViewChrome` maps `RunState` onto `LIVE_VIEW_CHROME`:

| Run state | Chrome |
| --- | --- |
| `RUNNING` | `LIVE` |
| `PAUSED` | `PAUSED` |
| `AWAITING_AUDITOR` | `AWAITING` |
| `COMPLETED`, `INCONCLUSIVE`, `RUN_FAILED`, `CANCELED` | `REPLAY` |
| `QUEUED`, anything else | `null` — no session word at all |

`QUEUED` deliberately gets **no** word rather than being stretched to `LIVE`: a Run that has
not started has no session, and the surface says so in words. This is the "Active version:
Draft" rule — a state printed under a label reads as a fact, and that fact would be false.
`live-view.test.ts` walks the whole `RUN_STATES` vocabulary, so a state added later fails
here rather than rendering a word that is not true of it.

Colour is never the only carrier: the dot (`{components.session-viewer}`'s four) always sits
beside its word, and the state also reaches a screen reader as a sentence in an
`aria-live="polite"` region. The word is what is announced; the dot is `aria-hidden`.

## A frame is a REGISTERED artifact, read through the existing grant

There is no second read path for images. A frame is `run_evidence` of kind `screenshot` in
state `REGISTERED`, bound through `run_evidence_capture` to the `run_tool_action` that
captured it — the binding is what makes it a frame rather than a loose artifact — and its
bytes reach the browser only through the **worker-signed, actor-bound Evidence read grant**
of `evidence-read-grant.ts` (Story 4.4), consumed on the web server.

Story 5.3 extends that mechanism rather than copying it:

- `FRAME_LOCATOR` (`'frame'`) is a third locator beside a cell locator and
  `ABSENCE_SNAPSHOT_LOCATOR`. A frame has no cell to address, so the locator names the
  **kind** of read.
- Issuance branches on it: a `frame` grant requires `kind === 'screenshot'` and an
  `image/png` media type; every other locator still requires a `structural-snapshot` whose
  media type has an implemented substrate. A screenshot can therefore never be served
  through a cell locator, and a snapshot never through the frame route.
- Generation 42 widens `evidence_read_grant_binding_guard` to admit both kinds. It is a
  `CREATE OR REPLACE` of the published trigger function; nothing else changes.
- `downloadWithGrant` is the ONE grant consumption: poll for the capability, check it names
  exactly this request, fetch with `redirect: 'error'`, verify content type, size and
  SHA-256 against the registered metadata, record the access. The Structural Snapshot cell
  inspector and the frame reader both call it — the snapshot reader was rewritten to do so,
  rather than the frame reader copying its download.

**The web never touches object storage.** `no-evidence-store-in-web` still fails the build
on any import of the store from `apps/web`, and no signed URL, bucket name or store host is
ever in the markup or in a response header. `LiveViewer.test.ts` asserts the structural
form of that claim: every `src` on the surface is under `/api/runs/<id>/`.

### What the frame route answers

`GET /api/runs/<id>/frames/<evidenceId>`:

| Condition | Answer |
| --- | --- |
| Role refused | 401 or 403, **before** the Run is resolved |
| Run absent, or artifact not a frame of it | 404 |
| `If-None-Match` matches `"<digest>"` | 304, under a fresh role check and with no grant |
| Verified | 200 `image/png`, `etag: "<digest>"`, `cache-control: private, max-age=300`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox` |
| Grant not yet signed within 5 s | 503 with `retry-after` |
| Role lost between request and download | 403 |
| Any disagreement between the store and the registered metadata | 502 |

A registered artifact's bytes can never change, so its digest is a strong `ETag` and the
cache is `private`: the authorization is the viewer's, not a cache's. Every failure the
reader can produce has a status, checked against the failure vocabulary itself rather than
against a copy of the route's own table.

## The live channel carries sequence numbers, never page content

`LiveBanner` subscribes to `/api/runs/<id>/events` only while the Run is active (UX-DR35),
and each Timeline event makes the page **re-read on the server** (throttled to one refresh
a second). So everything on screen is what PostgreSQL held when the request was served, and
a frame is bytes whose digest was verified — never a value that travelled over a stream.
The status vocabulary, the 15-second stale threshold and the 60-second lost threshold are
`live-status.ts`'s, unchanged.

To meet NFR-7's five seconds, `registerAgentCapture` appends
`execution.capture-registered` in the same transaction that registers the capture and
notifies the Timeline channel. Without it a frame would not appear until some later event
happened to be appended.

## The stage always says why it is empty

An empty stage that says nothing reads as "fine", which is the one thing a supervision
surface must never do. `LIVE_VIEW_STAGE` names the three reasons, and the Queued sentence
is EXPERIENCE.md's:

| Situation | What the stage says |
| --- | --- |
| Run queued | `Live View opens when the Run starts.` |
| Workspace, nothing captured yet | `No workspace screen has been captured yet. …` |
| No workspace at all (adapter-only Run) | `This Run uses no Agent Workspace. Its Adapter Session Steps are listed below …` |
| Registered frame could not be read back | `The latest workspace screen could not be read from Evidence storage. Its Evidence record is unchanged.` |

The adapter-only case is UX-DR25's own row: no workspace, so Adapter Session Steps render
as compact log rows with their counts and digests instead of a screen.

## Narration is one sentence, used twice

`stepNarration` builds `"<plan action word> on <target>, plan step <id>, started <instant>."`
and the frame's `alt` is **the same string** as the rail's current-Step narration (UX-DR37):
a reader who cannot see the picture hears exactly what the picture is captioned with. When
the frame's Step Execution cannot be resolved from the bounded read, `frameNarration` falls
back to the Tool Action's own word and its capture instant — still true of the picture, and
never an invented Step.

`plannedStepCount` is the Step counter's denominator and is read from the **frozen plan**
(one per Session Step, plus three per Target System), never from a stored progress number:
the plan is what an auditor reads, and a counter derived from anything else could disagree
with it. With no readable plan the counter shows the numerator alone.

## Everything a Target System supplied is untrusted

The captured page location and every diagnostic go through `UntrustedText`, and the Audit
Instructions are the auditor's own words in an inert `<pre>`. A system that answers with
`NOTE TO THE AUDITOR: close this finding` has that sentence rendered as quoted untrusted
content, never as the platform's prose.

## Read-only below 1024px

Below 1024px the surface is read-only and states EXPERIENCE.md's floor sentence,
`Open on a desktop browser to supervise this Run.` The sentence is always in the document
and the stylesheet decides when it shows, so the rule is a stylesheet decision rather than a
server guess at a viewport.

## The live controls, and the gate over them (Story 5.7)

Story 5.3 shipped this surface read-only; 5.4 added Pause and Resume, 5.5 added Cancel and
Flag to Audit Manager, and 5.7 added the rule that governs all four: **a control may be used
only while the page is still being told what the Run is doing.**

`LiveGate` is Live View's ONE `EventSource` and the provider of that verdict. The banner
became a view it renders and the controls read the verdict through context, because two
subscriptions would be two silence clocks, two reconnects and two cursors — which is how a
page ends up disagreeing with itself about whether it is live.

`liveGateReason` in `live-status.ts` is the whole rule, and it has three reasons:

| Reason | When | Why |
| --- | --- | --- |
| `runEnded` | a run-ending event arrived, or the server rendered a terminal Run | Outranks the others. It closes the second between that event and the server re-read that removes the controls, in which every control was live on a Run that had already finished. |
| `lost` | 60 seconds of silence (UX-DR25) | The page cannot claim to know what it is acting on. |
| `ended` | the stream said `end` and will not reconnect | Included although the contract names only `lost`, because it is the STRONGER case: a lost stream is reconnecting and an ended one is not, so gating the recoverable state and not the permanent one would have it backwards. |

**`stale` is deliberately not a reason.** UX-DR25 disables at sixty seconds, not fifteen. A
quiet Run goes stale routinely, and a surface that locked itself every fifteen seconds would
be unusable exactly when somebody most wants to pause it.

**Outside a `LiveGate` the gate is OPEN, and that is the truth rather than a default.** Run
Detail carries the same Pause, Resume and Cancel components and makes no claim to be live, so
it has nothing to withdraw. The gate is Live View's because UX-DR25's rule is Live View's.

**The gate is the surface being honest, and never the guarantee.** It is a client-side
verdict: with no JavaScript there is no channel to lose and no gate to close. What actually
refuses the action is the command — `pauseRun`, `resumeRun`, `cancelRun` and `flagRun` each
re-read the Run under its own row lock and refuse a state that no longer permits them, and
`resumeRun` additionally compare-and-sets the revision the page was rendered at. A withdrawn
control is a person not being invited to do something that would be refused.

**A withdrawn control keeps its place and says why.** `aria-disabled`, never `disabled`, so
the reason stays reachable by keyboard; activation is refused in the handler, which is what
`disabled` was doing that mattered. There is no way to disable one silently.

## A reconnect resumes from the last frame the page SAW

`acceptsLiveSeq(lastSeq, seq)` is `seq > lastSeq`, and that one comparison is both halves of
AD-17's rule. No gap, because the cursor is the last frame the page rendered and the route
replays everything after it. No duplicate, because the frames a resume repeats — the ones the
browser had already acknowledged — are at or below it. The cursor therefore only ever grows,
so a frame that arrives out of order after a slow reconnect cannot walk it backwards.

The cursor travels as `Last-Event-ID`, which `EventSource` sends by itself, with `?after=`
as the fallback the first request uses; `parseLiveCursor` prefers the header because a
reconnect carries both and only the header is current.

## What this contract does not cover

- **Replay** (Story 5.8), including the Step scrubber. `session-viewer.scrubber-pill-height`
  stays deferred in `tokens.test.ts`: scrubbing is Replay's control, and Live View watches.
- **Answering an Escalation without leaving this surface** (Story 5.6).
- **Provider video.** DESIGN.md calls frames the platform's Replay asset set and provider
  video a supplementary link; nothing here reads one.
