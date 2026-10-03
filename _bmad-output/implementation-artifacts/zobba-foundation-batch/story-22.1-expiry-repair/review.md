# Independent review and dispositions

Baseline: `6aaca7aab3463fb00e4f411e9b488eef5b2fa290`. Reviews were read-only and independent of implementation. Root ran the recorded checks; reviewers did not claim suite execution.

## Initial review

Three reviewers independently inspected the initial tracked/untracked diff (SHA-256 `c2d568690d43ceca6ffb4bad52b34e476d6db7dfbc9dc0750cae7ef65fe12e21`, retained as `review-initial.diff`). The edge-case reviewer initially reported no findings; the verification reviewer initially reported no verification gaps. The blind adversarial reviewer returned twelve findings. Root adjudicated them as follows:

| Finding | Disposition |
| --- | --- |
| Lease can expire during policy reads after structural basis verification | Repaired: the final SQL fence refreshes the lease after all policy/material/decision reads. This was a pre-existing window, closed with the related source repair. |
| Permission time sampled before the awaited exact-decision read | Repaired: load the decision first and sample permission time in the final fence. |
| Reordered model validation widens the window for another engagement's source assignment to expire | Confirmed independently by the edge reviewer. Repaired by re-auditing accumulated knowledge scopes after later reads; add a real cross-engagement regression. |
| Fixture preparation shares the selected deadline and may fail under heavy load | Retain explicit valid-entry/runway preconditions: overload fails the fixture rather than producing a false pass. Setup allowance is four seconds within the existing five-second lease; dispatch starts about one second before expiry. No production or gateway deadline increases. |
| Reported validation delay begins after inspector queries | Repaired: capture the actual second qualification-call entry instant before blocking. |
| Three expiry fixtures do not contain actual history dependencies | The three requested independent deadline tests exercise real model binding. Added source-expiry regression uses real assertions with knowledge dependencies across engagements; the existing operations aggregate separately exercises cumulative model history. |
| No happy-path case using the same delay gate | No new duplicate case: the combined operations/gateway suites retain real successful dispatch/recovery; old-order negative controls also demonstrate successful dispatch from the same fixture. |
| No new expiry-after-source-confirmed-absence replacement combination | Existing operations/process suites retain replacement/reconciliation coverage; refusal uses the same staged transaction rollback path. No separate defect identified. |
| A pre-existing pending wakeup could satisfy the staging marker | Repaired: explicitly start the sole wakeup non-pending; the deferred marker requires it pending, and the post-refusal facts comparison requires rollback to non-pending. |
| Endpoint event counting begins after parsing | Repaired: count raw accepted connections before capacity/HTTP/canonical validation and assert zero alongside parsed events and effects. |
| Code Map describes pre-repair ordering | Preserve it as the workflow's planning baseline. The appended Suggested Review Order describes the final implementation. |
| Completed verification tasks lack linked results | Repaired in the final specification and this evidence package, with raw logs, source identities and explicit limitations. |

## Production repair rechecks

Both the independent edge reviewer and blind reviewer inspected the final production fence and reported **no blocking findings**. They confirmed that policy/material/decision reads finish first, the dependent `MATERIALIZED` CTEs audit recorded source scopes before sampling time, lease and permission evaluation share that timestamp, structural checks retain the existing locks, and no further validation query follows the fence before commit. Specific errors remain `Fenced`, `Denied`, and `NeedsDecision`; explicit denial and standing permission behavior remain intact.

This is a final pre-commit authority sample, not a promise that authority remains valid indefinitely after it.

## Test/evidence recheck

The independent verification reviewer inspected the final test source, then the
gateway/operations and both negative-control logs, receipts and manifests. It
reported **no blocking verification gaps**:

- Gateway: seven passes; four exact expiry refusals in 0.967–1.004 seconds.
- Operations: five passes. The ignored gateway helper is explicitly invoked by
  the passing parent process test.
- All four negative cases failed at the exact-outcome assertion after passing
  the two-second bound; none failed through timeout.
- All 263 source hashes stayed stable within each run. Both positive runs match
  final files; both controls differ only in `operation.rs`. The reviewer
  independently matched the baseline and fence-removal variant hashes.
- Zero raw connections, rollback and unchanged historical facts are enforced by
  executed assertions, not inferred from elapsed time or missing logs.

Root subsequently reconciled the formatting, boundary and strict Clippy receipts
against the same complete source manifest and checked all 22 published schema
files against the baseline. These static gates were root-executed; the reviewer
did not claim to rerun them or review their artifacts. No blocking finding remains
in this repair. The live-provider qualification gate remains open.
