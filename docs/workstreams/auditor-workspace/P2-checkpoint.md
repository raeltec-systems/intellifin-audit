# Auditor Workspace — P2 conversation and composition checkpoint

Status: in development, not a completed co-working release. P3 conversational actions,
near-live preview, authentication assistance, synchronized
Replay and the remaining proof gates are still outstanding. No merge or deployment.

## Functionality in this candidate

- `/runs/<id>/workspace` composes the existing protected capture stage and live channel
  with a resizable conversation pane, contextual wait controls, run safety controls,
  current record context and record review links. Captures are labelled action-linked.
- Read-only progress uses the exact P1 projection without creating or evicting review
  paging snapshots. The selected source ordinal is resolved against this Run.
- Conversation messages have durable identity, ordered bounded pages, actor attribution,
  a retry key bound to semantic content and a recorded platform response. Text is encrypted
  separately from immutable message/audit metadata using a dedicated authenticated cipher.
- Selected operational events now create an immutable conversation reference in the
  existing audit transaction. Reads derive fixed copy from the actual source event:
  workspace creation, inspection start, registered captures/observations, decisions,
  pause requested/applied, resume and terminal sealing. This is newly recorded history;
  no historical backfill or source-record relationship is inferred from event timing.
  Related-record links use a bounded same-Run join through the actual work item/tool
  action, frozen subject-target step and unique included source identity. Duplicate keys,
  whole-table inspections and unresolved evidence relationships retain unknown context.
- The composer preserves an unconfirmed draft and retry key. Reload reads PostgreSQL;
  older history is bounded and reauthorized, rather than an accumulating client transcript.
- Free-text control requests currently produce explicit non-executing responses. Existing
  buttons and contextual answers retain their existing command authority. This is an
  intermediate P2 implementation; it does not satisfy P3 or the target release.

## Admission and verification

Conversation defaults off. Only explicitly configured synthetic mode is implemented;
it requires a dedicated content key. The disposable browser fixture enables that mode.
No provider, model identity, production environment or execution engine is changed.
Exceptional removal/retention, export and key lifecycle remain subject to D2/G4; there is
no invented retention period or public removal endpoint. A content tombstone preserves
immutable message identity and rejects silent content replacement/resurrection.

Local checks: 288 focused cipher/parser/config, component, accessibility and native-POST
tests passed; web/root-test typechecks and direct boundary checks passed. A broad
unit run found prohibited ARIA names in new markup; these were corrected and the guard
now passes. The parser also now accepts the client's explicit null context and preserves
its normalized DTO on a second parse. Boundary
mutation tests that invoke pnpm cannot run on the local runtime version; pinned normal
CI remains required. Database persistence, real browser interactions and screenshots are
pending for this candidate and are not inferred from local model or rendering tests.
The browser suite also opens an actual compiled-worker-produced Northstar screenshot,
checks protected bytes against its registered digest, verifies browser decoding and reload,
and retains the workspace image. This test has been written, not yet passed on CI.

Candidate `0a9c34a` normal CI run `35448272915` passed type/boundary/unit checks,
P0 browser checks, container builds and migration/schema-drift checks. The PostgreSQL
suite failed during new conversation fixture setup: two active standard Runs shared
one procedure/period, correctly violating the unique invariant. The fixture now gives
the Runs distinct periods. The 48 other integration files passed; the seven new
conversation tests were not proven by that run. A second-removal regression explicitly
checks the existing tombstone guard; no change to that guard was needed.

That run's browser suite finished with 202 passed, 10 failed and 18 not run; its separate
focused authoring journey passed 16 tests. Retained artifact `10586163931` has SHA-256
`911ce3e5061a5fb7593c127aed7bed92107915d462529b3694ad0bd3242de8be`.
The actual worker capture decoded and matched registered bytes, then failed the keyboard
accessibility check on its scroll container. Record review reached the populated queue
but failed summary-label contrast. Conversation send returned an honest unavailable
receipt: PostgreSQL could not infer an uncast parameter inside `jsonb_build_array`.
Older-history interaction did not issue its read, consistent with a click before
hydration. The revocation test refused access, but its Date-valued raw SQL restoration
failed and contaminated later tests. These are failure evidence, not acceptance passes.
Corrections add the explicit integer/timestamp encodings, keyboard focus, accessible
label contrast and disabled pre-hydration conversation controls. The fixture now seeds
historical messages before the real escalation narration and counts persisted rows.
Hydrated worker abuse mutation checks passed separately on this exact candidate.

The follow-up adds early decision/inspector captures and a bounded test-only IPC barrier
in the compiled-worker journey, so the real registered image is checked while its Run
is still active. That test verifies image decoding, protected response bytes, digest,
ETag and the recorded grant before releasing the existing worker. It does not replace
the browser provider or manufacture execution evidence. Review chrome is now compact,
and the workspace decision uses human action/capture labels with IDs under technical
details. Native browser layout and persistence remain pending the next normal CI run.

Narration uses the established Run-before-audit-head lock order and the same head lock
as human conversation writes. Its metadata commits or rolls back with its source fact;
no sensitive prose is copied into the audit chain. Operational entries do not consume
the 10,000 governed-message budget. At the absolute conversation sequence bound,
authoritative audit recording/execution continues; full history remains in Run details.
Local narration/component checks pass; real PostgreSQL rollback/concurrency and actual
worker browser assertions remain the required proof, not the mapper's model tests.

## Remaining decisions and proof

The full target remains the baseline. G1 still requires non-builder auditor review and
the five-auditor moderated study. G3 must prove safe near-live capture/private pixels and
exclusive authentication input in the same isolated provider workspace. D2/G4 policy
approval is required before real data; D3 proposed controller-transfer authority remains
ungranted. G5 crash/race/rollback and G7 measured safety/Q&A/preview isolation remain
release gates. Routine synthetic implementation continues without choosing a limited pilot.

## Follow-up CI on `4a88960`

Normal CI `35450768006` passed all 12 conversation PostgreSQL tests, including actual
transaction rollback/concurrency and the unique/duplicate/cross-Run record joins.
The full database suite was 601 passed, one failed: the new pause outer-commit assertion
compared a bigint returned as text with an integer. The test query now casts explicitly.
Type/boundary/unit, P0 design browser, container and hydrated worker-abuse checks passed.
The full application browser suite is still running; its result remains open.
