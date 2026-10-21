# Story 20.6 independent review

Three reviewers examined the complete tracked and untracked implementation before
repairs: blind implementation, edge-case and verification-gap review. Root
reconciled the findings and sent each patch batch to the original lead. The
accepted product intent did not change; no approval ceremony was added to Admin
edits. Final combined execution remains a separate completion gate.

## Disposition

| Boundary | Repaired behavior and independent evidence |
|---|---|
| Uncertain commands and audience | Exact retry survives temporary unavailability; actor or exact-session replacement discards private state and prevents rebinding |
| Invitation navigation | Every incoming fragment is scrubbed; late previews cannot replace newer terms; pending, uncertain and completed sign-out remain usable |
| Expiry | Shared bounded timestamps, effective expired status, explicit membership renewal, retained assignment expiry and command-only assignment renewal |
| Legacy membership size | Complete bounded assignment paging, preserve/remove modes, tuple-consistent cursors and fixed semantics for an editor opened on a partial list |
| Verified recipient | Signed missing/unverified/unusable-string claims withhold recipient proof; malformed claim types retain the pinned SDK's refusal |
| Responsiveness and contract | Retryable unavailable preview, deliberate post-save focus, actor-indexed Admin listing and complete generated vocabulary/bounds |
| Durable revocation | Role-only narrowing and explicit removal fence the affected Task epoch, claims and delegation; preserved engagements remain usable; regrant never revives old execution |
| Lock-wait authority | Acceptance rechecks exact-session logout and aged recipient proof after the actual engagement wait, with unchanged durable state on refusal |
| Renewal inside a transaction | Explicit finite assignment renewal and finite membership widening conservatively fence old authority, including expiry between fence selection and UPDATE |

The last timing repair has a real PostgreSQL trigger barrier after fence selection
and before the membership UPDATE. Tests confirm the old deadline is still future
at that barrier, wait until it passes, release the writer, and check the resulting
old claims and delegation. They cover assignment renewal, removing membership
expiry, extending membership expiry, exact replay, preserved-scope consumption
and unchanged-expiry countercases. The independent reviewers checked these
assertions and the passing restricted-database output; they did not present that
lead-executed suite as their own run.

## Review trail

- Initial findings: [blind](story-20.6/reviews/blind-findings.md),
  [edge cases](story-20.6/reviews/edge-findings.md),
  [verification](story-20.6/reviews/verification-findings.md).
- First repair: [blind](story-20.6/reviews/blind-repair-review.md),
  [edge cases](story-20.6/reviews/edge-repair-review.md),
  [verification](story-20.6/reviews/verification-repair-review.md).
- Final repair and targeted rechecks: [blind, including R1 closure](story-20.6/reviews/final-blind-review.md),
  [edge cases](story-20.6/reviews/final-edge-review.md),
  [verification, including R1 closure](story-20.6/reviews/final-verification-review.md).

The final reviewed source has 159 files in the
[source manifest](SOURCE-MANIFEST-20.6.json). Frozen source diff SHA256:
`33a2368b2df219c17a66963495368549d166f5949fd2ba77e135040f6493bfef`.
Earlier reports deliberately retain their own snapshot hashes and open findings;
their historical statuses are superseded only by the explicit later dispositions.

Reviewers also ran independent isolated Chromium checks of invitation navigation
and preserved draft modes using owned mocks. These supplement the real application
browser suite; they are not represented as database or identity integration tests.
The local development incident has its own guarded recovery review and is
recorded in the [implementation evidence](../story-20-6-implementation-evidence.md).
