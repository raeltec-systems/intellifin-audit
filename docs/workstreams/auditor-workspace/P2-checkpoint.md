# Auditor Workspace — P2 conversation and composition checkpoint

Status: in development, not a completed co-working release. P3 conversational actions,
committed execution narration, near-live preview, authentication assistance, synchronized
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

## Remaining decisions and proof

The full target remains the baseline. G1 still requires non-builder auditor review and
the five-auditor moderated study. G3 must prove safe near-live capture/private pixels and
exclusive authentication input in the same isolated provider workspace. D2/G4 policy
approval is required before real data; D3 proposed controller-transfer authority remains
ungranted. G5 crash/race/rollback and G7 measured safety/Q&A/preview isolation remain
release gates. Routine synthetic implementation continues without choosing a limited pilot.
