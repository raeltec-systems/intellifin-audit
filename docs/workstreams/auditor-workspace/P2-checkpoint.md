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
- The P3 extension now applies exact unqualified pause requests through the existing
  handler and worker boundary; see the P3 checkpoint. Other free-text control requests
  remain non-executing. Contextual answers retain existing command authority. The full
  P3 interaction catalogue and target release are still incomplete.

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
The full application browser suite finished with 227 passed and three failed. The
worker-produced active capture passed decoding, protected-byte digest, ETag and grant
checks. The remaining failures were a terminal assertion on the workspace instead of
Run Detail, reading a selected-record URL before navigation completed, and a hard-coded
first sequence after committed narration added an entry. These are corrected in the
follow-up; Q&A persistence and the captured-record inspector still require a passing run.

Retained browser artifact `10587765054` has SHA-256
`b8304c6f2ecb1e0d4aac03a3f53a43cfb61418c18cf2eb00eb6615151cd30a20`.
It contains the actual active workspace, contextual decision and record inspector views.
Inspection exposed a composer below the viewport and an overly short decision panel;
the compact review frame also still placed a full escalation above the record queue.
Those images are application evidence and design feedback, not a G1 usability pass.

## Application layout follow-up

The viewport repair measures the available space after the actual route chrome, keeps
the composer inside that space, and gives the contextual decision a compact layout.
Record review discloses an outstanding decision without placing the entire decision
form before its queue; the link falls back to ordinary Run Detail when the conversation
feature is disabled. Captured-fact labels now use the secondary text token: its contrast
on the sunken card is 6.92:1, replacing the muted token's 4.34:1.

The actual workspace gains Fit capture / Native size controls around the existing
protected image. Native mode preserves original pixel dimensions and keyboard panning.
The compiled-worker journey checks those dimensions and pan behavior, then opens a
record inspector backed by an observation produced by that same worker. These are new
browser assertions, pending the next normal CI run; they do not establish G1 or G3.

The record inspector now also renders the selected observation’s original captured
attributes through the existing inert untrusted-content component. Configuration values
are therefore readable without opening technical artifacts. The browser journey compares
its displayed observed value with the value persisted by the real worker.


## Actual application proof on `f89b1a0`

Normal CI `35454413253` completed the focused authoring suite (16 passed) and the full
application browser suite (228 passed, two failed). The compiled-worker P-4 journey passed:
its real registered capture decoded through the protected grant, matched stored bytes,
digest and ETag, retained its natural dimensions in Native size, and panned by keyboard.
The same journey inspected a worker-produced record and compared the displayed original
observed value with PostgreSQL. It also proved the queued/applied conversational pause,
existing Resume and unchanged golden Inconclusive result.

The 1440×900 contextual question journey passed encrypted message persistence, reload
and authorization-revocation checks. Two failures remain explicit: the 1280×800 first
choice was clipped, and the record-review test wrongly required every untrusted-content
block to disappear when object bytes were unavailable. That page correctly retains the
registered grounding label as inert metadata. The corrected assertion preserves the
typed unavailable warning and forbids an actual snapshot cell while requiring the label.

The new layout candidate compacts workspace-only chrome and keeps a measurable history
area beside the current question and composer. Browser bounds and early failure captures
remain mandatory on the rerun; these changes are not claimed visually verified yet.

Retained browser artifact `10587952669` has SHA-256
`7ff876e206d9fe50d10a412a4d56aa8f75f4d4bd4e899a4d1b157c53350d5337`.
Its active-workspace, decision and worker-record-inspector images were shown for owner
review. Type/boundary/unit passed 4,646 tests; P0 browser, container/startup and hydrated
worker-abuse checks passed. PostgreSQL finished 603/604; the precise fixture correction
is recorded in P3. G1 still needs human usability review; G3/G4/G5/G7 remain open.


## Completed controller browser run and fixture repair

CI `35457445681` completed: focused authoring 16 passed; full application browser
189 passed, 22 failed and 20 not run. The compiled-worker journey passed with controller
acquisition, confirmed Resume, persisted conversational pause, native evidence and
record inspection, retaining the golden Inconclusive result. Hydrated abuse also passed.

Record review reached its 1440/1280 inspector captures, paging and role-revocation
checks, then failed to restore the shared Auditor because its fixture bound a raw Date
through postgres.js. Later authenticated cases failed or could not start. The repair
encodes the timestamp explicitly, including the same latent controller-fixture cleanup
bug. A separate live-escalation assertion now includes the actual lease-acquired event.
No authorization check is weakened. The new workspace layout, stale-tab controller
proof and Replay selection cases remain unverified until the clean normal-CI rerun.

Browser artifact `10589361619` reports SHA-256
`ba4135ee7adee8d7812b70db8a2a54df8a2b175c0929f5704d4277b86b96d6a4`.
The completed run is failed, not a passing checkpoint or closure of a proof gate.
