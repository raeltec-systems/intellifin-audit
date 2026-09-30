# Story 20.4 review record

30 September 2026. Baseline: `1c598ca55511c6e27d6cc3a2e2b836912c2a9adf`.
**Status: accepted by root after independent review and all final gates.**

The independent second agent used a separate restricted migration-owner/nonowner
runtime PostgreSQL fixture. Its initial 41 tests passed (conversation database3,
actual HTTP 3, concurrent seed/authority 4, client state/parsing 31). It inspected
all15 new browser journeys for meaningful integration assertions, without
claiming to have executed the browser suite.

## Independent ordering repair

The reviewer reproduced a material same-scope ordering race: a conversation
snapshot and a later Task page were fetched concurrently. The page could observe
pre-Continue state while the snapshot included Continue's newer watermark; later
empty feeds then left the old cycle displayed as current indefinitely.

The existing specification requires race-proof current projection/cursor recovery.
Root classified the defect as a high-severity implementation patch within that
contract. The client now fetches the later page after the snapshot and publishes
both together. A deferred unit regression covers the interleaving.

Independent timing-aware verification confirmed the page request starts after the
snapshot, shows the new cycle and never combines a newer watermark with old Task
state. A temporary copy restoring parallel reads fails the same assertion. The
negative control establishes that the regression detects the original defect.

Post-repair independent results: **42 passed, 0 failed/skipped**—conversation
PostgreSQL 3, actual HTTP 3, restricted seed fixture 4 and updated client suites 32.
The server's current session/CSRF/scope authority and expected-actor refusal fence
passed. Concurrent fixture seeding preserves revoked authority. Migrations and
catalogs 1–3 are unchanged. All eight specification matrix rows have supporting
checks; final combined-browser execution and BMAD review remain root's gates.

Evidence resides under `/tmp/zobba-independent-20.4/`, including
`ordering-repair.log`, `ordering-parallel-negative.log` and `client-postrepair.log`.
The post-repair 81-file manifest SHA-256 is
`2f375a33931aa5940fd94ebb6ba4f43dda1b0f2b55dc00ae59fcba654f5e6d2d`.
No product files were changed by the independent reviewer.

## Pre-review gates and matrix audit

Root checked all five execution tasks against the implemented source and accepted
test evidence. All eight frozen matrix rows are covered by executed passing
checks, mapped in the implementation report. No matrix expectation was weakened.

Final pre-review gates passed: 81 Rust, 43 web, 46 OIDC fixture, 47 Python and
38 actual browser tests, plus formatting, locked Clippy/build, frozen install,
generated contracts, boundaries and process smoke. The Rust discovery list has
one intentionally ignored helper that its passing reliability parent explicitly
invokes; no acceptance parent is skipped. Full workspace and browser logs were
read, including final result groups. The post-ordering web suite and production
build passed. Root visually inspected the running desktop and narrow layouts,
and actual lost-response and pending/confirmed Stop captures.

At that point the specification and canonical sprint entry were in review, with
all five execution tasks checked. Final acceptance had not yet been granted.

## Fresh-context BMAD review

All three reviewers were launched before collection/triage, at the root model
capability and without prior conversation context. Their fully substituted
prompts contained the complete tracked/untracked diff, captured without staging:
350,485 bytes, 6,255 lines, SHA-256
`5d6bf73989e61e877b3725772b0d4e5be7fd6f90f32241022e8d13f1f155383f`.
Root collected all three results before consolidated repair. Edge findings
repeated R1/R6/R7 exactly; those claims/actions are combined below. The two
verification gaps are independent findings and were assessed separately.

Each finding is a **patch** within the existing race-safe delivery, explicit
receipt, bounded recovery and retained interaction contract. No missing owner
intent, architecture decision or specification ambiguity was identified. The
frozen contract is unchanged; review-loop iteration remains zero.

| ID | Finding and consequence | Severity | Required repair and proof |
|---|---|---|---|
|R1|Access generation can change during awaited storage admission, leaving a hidden saved request and unchanged draft that can create another key|high|Treat successful persistence as the handoff even if generation changed. Never transmit under the obsolete generation; surface the exact saved record under current same-actor/scope access and clear only its original unchanged draft. Do not delete potentially shared uncertain work. Test deferred reservation across access revalidation.|
|R2|An obsolete exact-Task read failure withdraws a newer verified conversation|medium|Fence both success and failure by inspection lifetime/selection and projection revision. Test late failure after a new selection or resynchronisation.|
|R3|A durable echo removes an outbox record, then a late lost POST reply reports unsaved uncertainty|medium|Retain exact in-flight receipt evidence so transport failure cannot downgrade a durably reconciled command. Preserve fresh authority refusal. Test echo-before-lost-response ordering.|
|R4|Dismissing the last refusal leaves its global error permanently visible|medium|Associate notices with unresolved operations; clear the dismissed notice while preserving other genuine unresolved notices. Test dismissal and a later successful read.|
|R5|Other-tab reservation/dismissal is absent or stale until an unrelated refresh|medium|Observe relevant actor/scope storage changes, refresh bounded recovery state, and never automatically replay or inspect another binding's payload. Test cross-tab creation and dismissal.|
|R6|Revalidation hides only the conversation, leaving protected names, roles, identity or picker visible|high|Hide the complete protected surface during checking while retaining mounted state for successful same-scope recovery. Test both picker and engagement with held authority reads.|
|R7|Successful scope refresh unmounts Task details/controls during projection loading and loses inspection focus/disclosure state|medium|Retain those nodes while protected content is hidden and restore focus when the current projection is usable. Test focused Pause/Stop and expanded inspection disclosure, preserving failure withdrawal.|
|R8|Follow Zobba uses only the displayed message page and misses current activity while reading history or older commands becoming Applied|medium|Provide current activity independently of displayed history and use it for explicit Follow without retargeting the composer or stealing focus. Test historical paging and an older command's later Applied fact.|
|R9|An unresolved send keeps forcing history to the bottom on unrelated updates|medium|Consume the send scroll once; bind it to the exact submitted key. Preserve deliberate earlier-history position through later receipts and pending-record changes.|
|R10|Composer stale-cycle detection ignores an exact inspected Task outside the current page|medium|Include current exact inspection when validating its retained target. Show the stale-target refusal before transmission without silently retargeting or clearing the draft. Test an off-page Task continued to a new cycle.|
|R11|Current quota tests still pass when Web Lock serialization is removed|medium|Use an actual browser-held lock and competing tabs near quota. Prove no persistence/transmission before release, bounded admission and reserved Pause/Stop capacity.|
|R12|Repeated Enter during asynchronous reservation has no regression proof|high|Hold the real storage lock, press Enter twice before release, then verify one persisted key, one POST and one durable command/message. The test must detect removing the synchronous submission fence.|

The original implementation agent receives this as one repair batch. All required
verification gates and independent repair acceptance must pass before done/push.

## Independent post-repair gate

The independent second agent reran the restricted PostgreSQL tests (**3 passed**),
actual HTTP tests (**3 passed**) and all web tests (**58 passed**). Its actual
browser run passed **12 of 13** cases. R1–R10 and R12 passed independent review.
Both safeguard-removal mutation logs fail their intended invariant assertions;
the reviewer inspected those logs but did not claim to have rerun the mutations.

R11 failed on unmodified product source: before lock release, no persistence or
POST occurred, but after release two competing ordinary requests were accepted
where the near-capacity test expected one. Diagnostic repetitions established a
real cross-tab localStorage visibility race: the first tab wrote at
`1790807390271`, and the other tab wrote a different key one millisecond later;
both saw five existing records and each believed it was writing the sixth.
Record removal began only 8.37 seconds later, after a held read timed out and
fresh projection reconciliation resumed. Cleanup did not cause the overbooking.

Native Web Lock ownership serialized callbacks but did not establish fresh
localStorage visibility across those renderers. R11 therefore requires a product
repair using an atomic durable transaction, plus renewed affected regression and
independent acceptance. Delaying callbacks or merely holding another projection
would conceal the defect. Acceptance remained blocked at that point.

The repair replaces the unaccepted preview's persistence with one IndexedDB
object store. Each admission checks exact existing meaning and scoped/global
quotas in the same strict-durability readwrite transaction; only transaction
completion allows transmission. Own-binding indexes bound reads, and cross-tab
signals carry no command payload. Status updates cannot recreate a removed row.
The redundant Web Lock is removed. The browser proof now holds a real write
transaction, and its negative control bypasses the actual quota check rather
than removing a lock that no longer owns correctness. The repeated-Enter negative
control remains required. Async-controller and browser regressions must pass
again before this repair is accepted.

The independent run is recorded in
`/tmp/zobba-independent-20.4/browser-bmad-repair.log`. Its 83-file source manifest
SHA-256 is `797421624c06d0d85b8c196cab62abf7892bc3f8a1c3c776ab2f8d0637701406`.

## Independent acceptance of the atomic repair

The second agent independently passed **71 client tests**, **15 actual browser
cases**, and one additional browser proof that aborts the real IndexedDB
transaction after its insertion request succeeds. That proof observed no
committed recovery row, POST or message; the original draft remained editable.
It is now incorporated into the permanent storage-failure journey. Earlier
independent PostgreSQL 3/3 and actual HTTP 3/3 remain valid; Rust source did not
change during this persistence repair.

The reviewer confirmed strict transaction-completion handoff, atomic scoped and
global quotas, reserved controls, own-binding reads, safe asynchronous authority
checks, nonthrowing post-commit notifications, bounded failure handling and
connection disposal. Known receipts stay Received when local cleanup fails; a
cleanup retry does not send another command. All **R1–R12 are closed**, with no
remaining material finding. The reviewer inspected the implementation lead's
replacement quota-bypass and duplicate-Enter negative controls: each fails the
intended invariant. Those expected failures are not failed acceptance gates.

Evidence: `/tmp/zobba-independent-20.4/web-idb-repair.log`,
`browser-idb-repair.log`, and the independent transaction-abort proof in the same
directory. The 84-file reviewed source manifest SHA-256 is
`a2e85cf4eebdad119c51a4b00eeafd99ffd70b11e80f4cde4d5154cee243013d`.
The reviewer changed no product files. Root independently reran the actual
development demonstration after the repair, with zero browser errors, and
refreshed and visually inspected the desktop/narrow captures in `demo/`.

## Final regression corrections

The first targeted IndexedDB browser run passed 16/20 cases. Three failures were
test-harness `TransactionInactiveError`: a held transaction remains unfinished
but accepts requests only in an active request callback. The holder now reads its
snapshot inside that callback; all five storage browser proofs pass unchanged
acceptance assertions.

The fourth failure was a Stop 503. PostgreSQL logged a statement timeout at
22:48:01.034 UTC, backend 190739, while locking the engagement tuple. The test had
suspended the worker inside a transaction. The fixture now confirms the exact
owned worker is stopped outside any SQL transaction/lock, with its real child
still alive, using bounded thaw/retry if needed. It still requires 202, pending
cessation, and later observed cessation. The independent reviewer accepted this
fixture correction; no server behavior or acceptance assertion was relaxed.

The post-repair boundary check also caught seven variable dynamic imports in
browser tests. They now use exact relative literals resolving to the same owned
Vite module. No boundary guard exemption was added. The final TypeScript and inward-boundary checks pass with these imports.


## Final root acceptance

The complete frozen-source browser run passed **46/46 in 3.6 minutes**, with
zero failures, skips, flaky cases or retries. It includes all retained identity
checks and the actual two-Task, guidance, interruption, exact retry, Pause/Stop,
Resume/Continue, uncertainty, authority and narrow-layout journeys. Root read the
complete results and independently checked the JSON totals. The process-control
attachments establish the stopped owned coordinator, three idle connections,
zero open transactions/granted locks and one live inert child before suspension.
Root visually inspected and saved the final Pause, pending/observed Stop and
lost-response/original-receipt captures in `demo/`.

Final gates: **81 Rust, 71 web, 46 OIDC fixture and 47 Python tests passed**,
plus formatting, locked Clippy/build, frozen installation, generated contracts,
TypeScript, production build, inward boundaries and actual process smoke. The
one ignored Rust helper discovery entry is deliberately invoked by its passing
reliability parent. No acceptance parent is skipped. These are local executed
gates, not a claim of hosted CI or deployment.

After the final test-only import, typing, abort-proof and process-discovery
changes, the independent reviewer reconfirmed acceptance with no remaining
findings. Product files were unchanged from its tested version. The final
[84-file source manifest](SOURCE-MANIFEST-20.4.json) has aggregate SHA-256
`2711be103e5632527237faa66fd121b77154573cf01ebbef085ce3e5b5ce1c2d`.
Root verified all file digests and the aggregate against the workspace.

All five execution tasks and all eight frozen matrix rows are satisfied.
Root accepts Story 20.4 and closes its canonical queue entry as done. The
specification's frozen intent and Code Map remain unchanged; its appended
Suggested Review Order provides the reviewer trail. Stories 20.1–20.4 are done;
Epic 20 stays in progress. No next-batch implementation or paid resource is
included in this acceptance.

Final browser log: `/tmp/zobba-20-4-idb-combined-final.log`; structured results:
`/tmp/zobba-20-4-idb-combined-final-results.json`. Reproduction instructions and
permanent regression tests are retained in the repository.
