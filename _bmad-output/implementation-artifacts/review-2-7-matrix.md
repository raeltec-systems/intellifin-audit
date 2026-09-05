# Story 2.7 — acceptance matrix evidence

The following maps the frozen matrix to executable checks. Final execution results are recorded in the story's Auto Run Result; this map alone is not a passing result.

| Frozen scenario | Covering checks |
|---|---|
| Submit, atomic state/event/notification | `tests/unit/version-decisions.test.ts`: submission transition fields and all managers; forced enqueue rollback. `tests/integration/version-decisions.test.ts`: durable recipients, delivery privacy and replay. `tests/e2e/version-review.spec.ts`: authored P-1 through the actual worker into submitted review. |
| Submit refused | Unit cases cover missing sections, blockers, pending, failed and stale plans without writes. Browser case covers every local editor, confirmation recheck, pending saves and unknown outcomes with accessible refusal reasons. |
| Author cannot approve | Unit policy and missing-provenance cases; integration cases persist Evidence and Schedule edits by a Manager before attempting approval; P-1 browser journey uses a separate Manager. |
| Approve | Unit test freezes the reviewed plan and first-version diff, stopping at APPROVED. Integration preserves the submitted baseline after a predecessor changes. Browser journey approves and reloads after losing the committed response. |
| Concurrent approval | Integration holds the first transaction open until the competitor is observed waiting on its database lock; exactly one transition succeeds. Unit case checks the stale revision refusal. |
| Reject | Unit checks require storable rationale and notify the responsible author. Browser journey rejects with rationale and shows the saved decision. |
| Edit after rejection | Unit transition and browser reject/Edit/resubmit/approve journey; browser checks retain prior rejection rationale in decision history. |
| First version review | Unit diff check and browser fully expanded review. Actual React rendering tests additionally distinguish previous/current Scope, Evidence and executable steps for a successor. |

Additional repair checks cover contradictory durable review snapshots, invalid predecessor refusal, more than 100 notifications with exact microsecond ties and recipient privacy, invalid pagination cursors, and submission review metadata isolated from later live-row metadata.
