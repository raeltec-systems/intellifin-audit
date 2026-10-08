# Foundation owner-review repair review

Review baseline: `ac47de0204219aafdf85b364be71ec83cd3f8321`.
Accepted integration source: `bbf79f36ee022835f95bb006c883a142e8d087da`.
Specification: [owner repair batch](../spec-foundation-owner-review-repairs.md).

Three fresh, context-free reviewers at the session's model capability reviewed the
complete tracked and untracked diff independently: blind review, edge cases and
verification gaps. Their initial snapshot SHA256 was
`a824536bc700a28867b0a313a70ca4d597a4f56f1603a38ec15099b2cc59305d`.
Root collected all three results before consolidating patches with the original
implementation lead. No code was staged before review.

## Accepted findings

| Finding | Consequence | Required repair and verification |
|---|---|---|
| Conversation 412 recovery resets the App retry budget | High: repeated session replacement can cause an automatic refresh loop | Share the recovery budget through conversation verification; exercise a live poll and repeated post-engagement replacement in a real browser |
| Hidden/visible lifecycle sets busy after recovery is blocked | Medium: explicit Retry is announced disabled | Leave the blocked screen usable; exercise tab visibility followed by successful explicit Retry |
| New CI fixture path uses an unavailable job-level context | High: workflow evaluation can fail before setup | Set the path with the runner's shell environment and persist it for later steps; validate workflow syntax/context |
| CI bypasses the root fixture shortcut | Medium: documented command can regress without normal CI detecting it | Execute the root shortcut and verify generated output before any fallback setup; retain fresh/repeat checks |
| ADMIN self-regrant fixture assumes a restricted migrator | Medium: local supported superuser-migrator checks fail | Preserve the restricted positive capability proof; assert PostgreSQL's refusal to promote a superuser membership and run both configurations |
| Auth browser harness does not consistently resolve IPv6/PGPORT | Medium: the newer auth harness can disagree with the restored proxy | Normalize before stripping inherited PG variables; use the resolver for psql; execute an authenticated PGPORT check |
| Read precondition applied through the shared mutation auth helper | Medium: an optional read header changes POST refusal behavior | Apply the fence only to protected reads; preserve mutation/CSRF contracts |
| Browser no-replay assertion has no uncertain request | Medium: zero POSTs alone does not establish retained-request safety | Include a retained uncertain request during live account replacement and verify unchanged bytes, no disclosure and no retransmission |
| Session parser and read-header bounds differ | Low: a malformed session can be accepted before later refusal | Align the bound and test its boundary |
| Screenshot lies outside uploaded browser results | Low: CI loses the visual evidence | Use the owned test output path and attach the image |
| Custom fixture directory receives default-path success guidance | Low: setup instructions contradict the isolated path | Describe the configured env.sh location accurately |

The loop and live-poll coverage findings were independently identified by multiple
reviewers. They are one coherent correction. The initial combined run passed 82
Rust tests and 51 browser tests; those results exposed the test coverage gap and
are not treated as final acceptance of the reviewed patches.

## Final disposition

All accepted findings are repaired. Independent recheck verified live-poll
withdrawal, the shared budget and mixed-stage cases, preserved mutation contracts,
visibility/Retry recovery, both bootstrap modes and the retained authenticated
PGPORT regression. The verification reviewer's final result was “No verification
gaps found.” Root also inspected the final source and rendered synthetic browser
evidence.

The new routing regression is part of normal Playwright discovery. It guards the
original database bindings before introducing a relay, uses an independent
worker so synchronous CLI/psql calls cannot block forwarding, and requires actual
migration and administrative SQL refusal while disconnected. Separate bypass
controls failed at the intended assertions, including the case where a default
upstream remains reachable. The worker uses static imports; the existing boundary
checker was preserved.

The [repair checkpoint](OWNER-REPAIR-CHECKPOINT.md) records the combined results,
negative controls and remaining product limits. The
[source manifest](SOURCE-MANIFEST-OWNER-REPAIRS.json) identifies all 122 reviewed
workspace/workflow files. No unresolved review finding or next-story work is
carried into this repair checkpoint.
