---
title: 'AW P4: open a selected inspection beyond the Replay prefix'
type: feature
created: '2026-09-20'
status: done
baseline_commit: fae6b5667196ec92cef338aa9a73b8b9d569ab7c
review_loop_iteration: 1
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/contracts/replay-v1.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** Record-review links identify an exact inspection, but Replay loads only the earliest 500 frames and their early timeline context. A later inspection cannot be opened even when its captures are retained. Increasing the global limit would only move the defect and increase every page's cost.

**Approach:** Add a bounded, separately identified selected-inspection read. Resolve its first frame and global position against all retained frames on the authorized Run, then return that inspection's frame page with exact action/step and observation context. Preserve the default chronological prefix and expose explicit navigation between the selected inspection's bounded pages.

## Boundaries & Constraints

**Always:** Reauthorize the Run on every route request and each protected image fetch. Bind every frame, action, step and work item join to the same Run. Resolve a nullable action owner through its Step Execution consistently. Show global frame numbers and honest selected-inspection/page bounds. Start paused and preserve the selected inspection on reload. Keep a fixed per-request frame bound and deterministic order.

**Never:** Contact the provider, re-execute work, create evidence, append a far-later frame to a falsely contiguous prefix, disclose storage/provider URLs, silently substitute another record's frame, or claim absent evidence merely because it was outside the prefix.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Default replay | No selected work item | Existing first-500 chronological view, exact total | No new execution or provider access |
| Late inspection | Valid same-Run work item beyond frame 500 | First retained frame for that inspection, paused, exact global ordinal and context | No prefix fallback |
| Step-only owner | Action workItem null; Step owns inspection | Same selection and narration as explicitly owned action | Consistent ownership resolver |
| Many selected frames | Inspection exceeds fixed page size | Explicit bounded next/previous page links retaining workItem | Never unbounded serialization |
| No captures | Valid work item with no retained registered screenshots | Say no capture exists for this inspection | Distinct from denied/invalid selection |
| Invalid selection | Bad/duplicate/cross-Run workItem or page cursor | No selected frame; safe explanatory state | No disclosure of foreign identity |
| Late observations | More than 500 registration events before selected frame | Exact full-history count at that frame's action time | Do not use truncated event prefix |
| Equal timestamps | Several actions/captures share time | Stable order by action time, action ID, evidence ID | Ordinals and pagination cannot drift |
| Protected image fails | Grant, permission or integrity refusal | Existing unavailable-frame presentation | No provider/storage fallback |
| Active Run | Any selected inspection | Existing Live View guidance | No terminal Replay illusion |

</frozen-after-approval>

## Code Map

- `packages/infrastructure/src/runs/run-detail-repository.ts`: `readFrames`, `frames`, `RunFrameRow`, timeline DTOs. Add a dedicated selected-inspection page DTO/read, with validated workItem and bounded page cursor, exact count/global ranks from registered screenshots, exact action and Step context joined by IDs, work item label and observation count. Query only the requested page; count/rank in SQL. Explicitly tie evidence capture, tool action, Step and owner to runId. Keep existing default read contract stable. Use a final evidence-ID tie-breaker wherever frame order/rank is shared.
- `apps/web/app/runs/[id]/replay/page.tsx`: validate singleton workItem and cursor after `openRun`; load either default prefix or exact inspection page. Do not depend on the first-500 timeline rows to narrate late frames. Resolve target display name through frozen plan, and distinguish unavailable selection from a valid empty inspection. Retain terminal-only behavior.
- `apps/web/src/runs/replay.ts`: typed selection/window information and a shared effective work-item rule; no effects or outbound calls. Preserve strict invalid/duplicate selection behavior. Default prefix jump targets that lie outside the prefix should offer a route to their exact inspection where a work-item identity exists.
- `apps/web/src/runs/ReplayViewer.tsx`: explicit selected-inspection heading, fixed page bounds/navigation and per-frame global position. Keyboard/scrubber movement and play stay within the current loaded page and stop at its end; page navigation is explicit and returns paused. A selected empty/invalid view never defaults to index zero. Prefix copy must not describe a selected page as the first N session frames.
- `apps/web/src/runs/LiveViewer.tsx`: reuse its existing protected frame rendering without weakening grants or integrity. Any shared type extension must preserve Live View semantics.
- `docs/contracts/replay-v1.md`, `docs/workstreams/auditor-workspace/P4-checkpoint.md`: document selection/page behavior, exact versus bounded counts and actual proof. Update the continuation report and reusable lessons in `CLAUDE.md`.

## Tasks & Acceptance

- [x] Implement bounded same-Run selected-inspection frame/context read and strict cursor handling.
- [x] Render correct paused selection, global positions, page navigation and links for prefix-excluded inspections.
- [x] Keep default prefix and active-Run behavior unchanged and explicit.
- [x] Prove >500-frame and >500-observation-event fixtures, Step-only owner, tie ordering, foreign selection, empty capture, page bounds and exact context in PostgreSQL.
- [x] Prove protected late image decode, reload, page navigation and identity refusal in an authenticated browser; record browser network telemetry separately from unmeasured server/worker calls.
- [x] Run unit/type/boundary checks and record evidence without claiming closure of other P4 or overall gates.

**Acceptance:** Given a retained inspection outside the earliest 500 frames, when an authorized auditor opens its record-review Replay link, then the first capture for that exact inspection appears paused with its correct record, action, time and global position. Given a selection with no retained image or invalid identity, when Replay opens, then it explains that state without showing a different inspection.

## Design Notes

This slice supplies selected-inspection access; conversation-to-record/history/evidence synchronization is another required slice. Prefer a page size no larger than the existing 500 bound; choose a smaller constant if the read carries richer frame context. Selected-inspection pagination need not load unrelated intervening captures. Global ordinal and loaded-page index are different fields. The parent coordinates database/browser tests to keep worker fixtures isolated. Follow actual sibling locations if the code map moved.

## Verification

Pinned runtime; focused Replay unit/SSR and infrastructure integration checks, all unit/type/boundary checks, authenticated Replay browser tests with zero retries, protected frame bytes and provider-unreachable assertion. Compare query bounds against a synthetic long Run and record measured counts/latency; this is local evidence, not final capacity acceptance.

## Parallel implementation ownership

Parent has active answer patches in conversation/waits/schema0059 and sharedworkspaceCSS. Own only Replay read/view/helper/routes and new dedicatedselectedReplaytests. Do not edit LiveViewer unless essential; coordinate types with parent before changing shared framecontracts. Do not touch answerfiles, schema, migrations, sharedCLAUDE or continuationreport. Record notes here for parentintegration. ParentownsDB/browser/build/fullverificationandcommits; usefocusedlightchecks only. No providerAPIcalls. Neverchangeotheragentfilesorcommit/push. Startfromcurrentmainworktree, notisolatedadmissioncheckout.


## Implementation handoff

The selected reader uses 100-frame pages and SQL global/inspection ordinals. The route
validates singleton `workItem` and `cursor` after Run authorization, reads exact page
context without prefix timeline calls, and resolves the display name from the frozen plan.
The shared stage accepts an optional image-failure callback; only Replay uses it to stop
playback and replace refused bytes with an explicit unavailable message. It never shows a
prior capture in place of the failed one.

Focused checks passed: 114 cases across Replay helpers/viewer, selected route/SSR, existing
LiveViewer and shared stylesheet checks. Infrastructure TypeScript passed before the final
same-Run join additions; final full TypeScript/boundary/database/browser checks are parent
owned. Dedicated PostgreSQL and authenticated browser fixtures are ready. Their existence
does not satisfy the still-unchecked proof tasks above.

Parent reusable lesson for CLAUDE.md: bounded frame reads need exact context for the chosen
frame page; increasing the prefix limit cannot supply late inspection selection. Rank by
action start, action ID and Evidence ID, and use the same Step-first owner in SQL and UI.
A protected `<img>` refusal needs an explicit unavailable state keyed to that Evidence ID;
retain metadata and never replace it with a previous frame.

No additional environment variables are required beyond the existing browser setup:
DATABASE_URL for the isolated database, E2E_PASSWORD/auth states, the current compiled
worker/packages, and the running web server. The browser fixture owns its synthetic S3
server and starts a production worker with provider/model credentials disabled. Run it
sequentially with other worker-owning browser fixtures.


### Accepted review patches

Retain source/time/digest metadata during protected image refusal; announce status and
retry the same image paused. Project only displayed frame/action fields into client props.
Test the real jump-target builder for Work Item and Exception inspection link identities.
Use a single grouped cumulative observation aggregation. Extend PostgreSQL proof to
interleaving, action-only/conflicting owners, foreign FK defenses and 5,508 registration
events; correct Evidence tie expectations by independently sorting UUID keys.

The new browser checks follow a prefix-generated link and a source-backed record-review
link (the latter has no retained image), observe actual playback and paused page navigation,
retry failed bytes, and refuse subsequent image/page reads after role revocation. Browser
off-origin counting is not server/worker network telemetry; reports narrow that claim.
Focused changed-suite checks: 93 passed. Parent must rerun revised PG/browser and full checks.


### PostgreSQL cleanup follow-up

All five revised assertions passed in the parent run. Query-only latency was 26.9ms for
508 registration events and 103.7ms for 5,508 events; the larger case's 28.0-second duration
was dominated by setup. The suite still failed cleanup because the intentionally foreign
Tool Action referenced a Step in the first Run being deleted. Cleanup now deletes both
saved fixture Runs' capture/action rows before any Step rows, in one transaction.

The larger fixture now inserts canonical, hash-linked events in batches of 500 under the
Run/head locks, preserves the database guards and verifies the whole 5,508-event chain.
The original 508-event scene still uses the production appender. Timing output separates
queryOnlyMs from fixtureSetupMs, and setup prints exact synthetic fixture identities for
scoped recovery after a future cleanup failure. Revised cleanup/batching execution is
pending the parent rerun; local syntax and diff checks passed.


## Final review and verification

Three independent reviews were reconciled. Accepted corrections retain metadata and explicit
retry on image refusal, limit browser props, verify real jump-link construction, enforce
same-Run ownership and deterministic ties, and aggregate full observation history once.
All five PostgreSQL cases passed, including cleanup, in 19.47 seconds. The 610-frame /
508-registration scene read its selected page in 570.5ms; the 5,508-event scene measured
655.7ms query-only and 897.3ms fixture setup. These are local observations, not capacity acceptance.

Both authenticated browser journeys passed with zero retries across separate runs: actual
record-review navigation to an empty retained inspection, and late capture decoding, reload,
paging, playback boundaries, integrity refusal, retry and role revocation. The initial combined
invocation had one Chromium target crash; the isolated long journey passed in 49.5 seconds.
No crash cause or server/worker zero-call measurement is inferred from that rerun.

Final full unit verification passed 4,812/4,812 cases across 250 files. The focused revised
checks passed 93 cases; these overlap the full result. Infrastructure build, web/root TypeScript
and final dependency boundaries passed. No schema migration is added. Conversation/history
synchronization and all seven overall proof gates remain open.

## Suggested Review Order

- Open the exact inspection through an authorized bounded route.
  [page.tsx:93](../../apps/web/app/runs/[id]/replay/page.tsx#L93)

- Rank retained captures and resolve complete context within the same Run.
  [run-detail-repository.ts:555](../../packages/infrastructure/src/runs/run-detail-repository.ts#L555)

- Keep page navigation explicit and playback bounded.
  [ReplayViewer.tsx:87](../../apps/web/src/runs/ReplayViewer.tsx#L87)

- Validate selection identity and page boundaries.
  [replay.ts:63](../../apps/web/src/runs/replay.ts#L63)

- Prove late frames, interleaved ownership, deterministic ties and full-history counts.
  [selected-replay.test.ts:1](../../tests/integration/selected-replay.test.ts#L1)

- Exercise protected bytes, real links, playback and revoked access.
  [selected-replay.spec.ts:1](../../tests/e2e/selected-replay.spec.ts#L1)
