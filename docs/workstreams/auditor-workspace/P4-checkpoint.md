# Auditor Workspace — P4 review and Replay checkpoint

Status: partial implementation, not target-release acceptance. No merge or deployment.

## Delivered behavior

The existing selected-record inspector reuses EvaluationReview and its independent
authorization, Result/review revisions and immutable proposal/decision overlay. Opening
evidence is explicitly separate from confirming an assessment. P1’s bounded queue
retains its list snapshot while selected detail reports newer authoritative facts.

This follow-up repairs review-to-Replay continuity: the existing workItem query link
was ignored by the Replay route. It now opens the first stored capture for that exact
same-Run inspection, paused, and retains the selection on reload. Invalid, duplicate,
cross-Run or unavailable selections show an explicit unavailable stage, never another
record’s frame zero. Bounded-out and never-captured states remain distinct. Multi-system
records expose separate target inspection links instead of silently selecting one.

Replay still reaches only platform-owned evidence and existing protected read grants.
No execution command, provider client or mutable target access is added.

## Verification status

Focused resolver/viewer/inspector and shared stylesheet checks, plus web/root TypeScript,
are the local verification. New real-browser assertions request the second inspection,
check the protected image decoded, reload the exact selection, reject another Run’s
work item and duplicate parameters without image requests, block outside origins and
compare persisted Run/review-independent audit state. That new journey is pending CI.

Normal CI on the preceding controller candidate `379699d` passed all 609 PostgreSQL
integration cases. Its full browser result is recorded in P3 when available. Neither
that result nor these component tests proves the new P4 journey.

## Remaining P4 scope and gates

Full conversation-to-capture/assessment history linkage and a combined record-inspector
confirmation/rejection browser journey remain. The prior dedicated evaluation-review
journey does not by itself prove the composed inspector. Loading a selected inspection
beyond the current Replay read bound also remains; this candidate reports that limit
honestly. P3’s remaining commands and P6 secure assistance are still required for the
full co-working target. G1 auditor review and G3/G4/G5/G7 release obligations remain open.


## Composed worker-to-inspector review candidate

The existing actual P-1 worker journeys now open their produced record from the review
queue and make both confirm and reject decisions inside its inspector. They require
the selected URL to survive reload, no review command from merely opening the record,
the worker-completed command and sealed Result, original proposal history and unchanged
Observation/evaluation/Evidence rows. Rejection still requires the worker-signed
Exception. The independent standalone review tests remain in the normal suite.

Root test TypeScript passes locally. These changed browser journeys are pending normal
CI; their prior Run Detail passes do not prove this new composition. On `c8a7a68`,
CI `35459276209` has passed all 4,696 unit tests, TypeScript, 675-module boundaries and
P0 browser checks; its full application browser suite is still running.


## Actual composed review proof

CI `35464796052` on `625dd3b` passed both actual P-1 compiled-worker journeys through
the record queue and inspector: confirm sealed the Result; reject produced the
worker-signed Exception. Both retained the selected record on reload and checked
original Observation/evaluation/Evidence rows and persisted command completion.
This supersedes the pending composition note above.

The selected Replay journey reached its decoded same-record image, reload, cross-Run
and duplicate-selection refusal checks, then failed its audit-chain comparison. The
fixture's raised Escalation queues independent notification delivery; the follow-up
waits for its persisted channel outcomes before taking the baseline, keeps all existing
non-access audit entries in the comparison, and includes event types in any failure.
That correction still needs CI; full history/deep Replay and the release gates remain.


### Inspector filter readability correction

Visual inspection of the retained `625dd3b` worker-produced inspector capture exposed
a narrow search field and an almost arrow-only filter. The four-column grid responded
only to viewport width while the inspector reduced the queue's available space. The
follow-up uses a grid that wraps according to the pane width and adds a 1280×800 browser
assertion requiring readable search/filter widths. Existing value, paging, selected-row,
revocation and accessibility assertions remain. Actual browser verification is pending.


## Selected inspection beyond the prefix — implementation candidate

Record-review links now use a dedicated same-Run inspection read with at most 100 frames
per request. It resolves late action/Step context directly, counts registration events
through the action time over the full history, and labels each frame with its global
session position. Explicit previous/next inspection-page links retain selection and open
paused. Empty inspections and invalid identities/pages show no substituted capture. The
default 500-frame chronological view offers exact inspection links for Work Item and
Exception targets outside its prefix. Protected frame rendering and read grants are shared
unchanged with the existing viewer.

The focused Replay/LiveViewer, selected route/SSR and stylesheet checks passed 114 cases
locally. The dedicated PostgreSQL fixture in
`tests/integration/selected-replay.test.ts` covers 610 captures, 608 actions/Steps, 508
registration events, Step-only ownership, 100+5 inspection pagination, exact global ranks,
512 observations at the selected action time, deterministic ties, foreign identities and
empty inspections. Its execution and authenticated late-image/page-navigation proof are
pending the parent verification pass; fixture existence is not a passing result.

This supersedes the earlier implementation limitation for prefix-excluded inspections.
Conversation/history synchronization and the other P4 and release gates remain separate
obligations. No production acceptance or deployment is claimed by this slice.


### Selected Replay review corrections

The image refusal state retains the exact capture metadata, announces the refusal and
offers a paused retry of the same protected Evidence ID. Selected page props project only
the fields displayed in the viewer; stored action diagnostics do not enter browser props.
Observation totals now use one cumulative aggregation rather than a correlated base-history
sum for each frame. The initial parent PostgreSQL run passed two of three new cases; its
remaining failure was a fixture assumption about UUIDv7 generation order within a
millisecond. The fixture now independently sorts the Evidence tie keys. The initial
610-frame/508-event page took 522.6ms during that full run; the revised aggregation and
5,508-event measurement await the parent verification pass.

After review, 93 focused checks passed covering the changed helper/route/viewer, existing
LiveViewer and stylesheet checks. Added PostgreSQL cases exercise interleaved 205-frame
history, 100+3 selected pagination with global gaps, action-only and conflicting Step-first
owners, permitted foreign FK relationships excluded by the read and the storage trigger's
cross-Run capture refusal. Added browser assertions follow the real prefix-excluded link,
observe timer advancement and page-end stop, navigate while playing, retry refused bytes,
and revoke the role before subsequent image/page access. A source-backed record-review
fixture follows its actual inspection link to an honestly empty capture set; it does not
claim a late-capture journey from that fixture.

Browser off-origin counting is explicitly browser telemetry. Server and worker outbound
calls are not instrumented by this test; disabled provider/model credentials are fixture
configuration, not a measured zero-call result. Revised database/browser execution and
remaining full verification are still parent owned.


## Selected inspection Replay — implemented and locally verified

An auditor can open a retained inspection beyond the first 500 Replay frames. Dedicated
100-frame pages carry exact action/Step context, global session positions and cumulative
Observation counts from the full history. Links retain the selected inspection and reopen
paused. Invalid or empty selections never substitute another record. Failed protected images
retain their metadata and offer an explicit retry of the same Evidence ID.

Three independent reviews were reconciled. All five PostgreSQL cases passed, including
610-frame pagination, interleaved ownership, deterministic timestamp ties, foreign identity
refusals and a verified 5,508-event chain. The larger page query took 655.7ms locally;
fixture setup took 897.3ms. These measurements do not close capacity acceptance.

Both authenticated browser journeys passed with zero retries across separate runs. The
record-review journey follows its actual inspection link to an empty retained capture set;
the long journey proves late image decoding, reload, paging, playback, integrity refusal,
retry and role revocation. The initial combined invocation recorded one Chromium target
crash; the isolated long journey passed in 49.5 seconds. Browser off-origin telemetry does
not measure server/worker outbound calls.

The final combined local unit suite passed **4,812/4,812 tests across 250 files**. Build,
web/root TypeScript and final dependency boundaries passed. This includes the native POST
correction. See [the Replay specification and suggested review order](../../../_bmad-output/implementation-artifacts/spec-aw-selected-replay.md).
Conversation/record/evidence/history synchronization remains required; all seven overall
proof gates remain open. No merge or deployment has occurred.
