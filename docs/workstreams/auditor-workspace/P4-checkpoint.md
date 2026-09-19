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
