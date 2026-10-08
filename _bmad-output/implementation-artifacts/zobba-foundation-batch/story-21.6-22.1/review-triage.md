# Independent review and repair ledger

Baseline: `67a290173dea7212b600d00ec5bad3f5bd52a6c0`. Three fresh, context-free reviewers used the complete tracked/untracked diff, before staging. All three were launched before findings were collected. Source was frozen during the review. No reviewer ran a paid service or changed code.

The findings below are direct implementation or verification corrections to the frozen story matrix. The accepted scope already specifies recovery, exact current authority, supported provider capabilities, retained usage, Unicode matching, responsive source navigation and reviewable qualification. No product intent or owner policy change is required. Duplicates were combined only where the claim and repair are the same. All are routed **patch**; each repair has an independent source recheck and focused passing evidence. Final combined results are recorded separately in the checkpoint index.

| ID | Review source | Severity | Finding and required correction | Owner |
| --- | --- | --- | --- | --- |
| R01 | Blind | medium | Same-session periodic access verification must not continually cancel a bounded source transfer; quarantine while uncertain and reverify before disclosure. | 21.6 |
| R02 | Blind | medium | Whole-string Unicode lowercase loses the literal Greek prefix ΟΣ in ΟΣΑ; use documented context-independent matching and regressions. | 21.6 |
| R03 | Blind + Edge | high | A recovered successful proposal must admit under the replacement worker's current basis while preserving the original producing basis. | 22.1 |
| R04 | Blind | medium | Repeated cumulative history must not exhaust the unique dependency verification allowance; memoize verified exchanges without trusting conflicting duplicates. | 22.1 |
| R05 | Blind + Edge | medium | Reject unsupported OpenAI strict structured schemas before network I/O. | Native |
| R06 | Blind | medium | Invalid optional JSON metadata must not replace a known HTTP 429/503 classification. | Native |
| R07 | Blind + Verification | high | Browser-test reused knowledge opening the original engagement's library, retaining destination Task/conversation, then real source-only revocation. | 21.6 |
| R08 | Blind | medium | Exercise narrow-screen keyboard search, continuation, previous page and inspector return over multiple pages. | 21.6 |
| R09 | Blind | medium | Retain bounded synthetic tool call identity/argument digest/output and exact continuation evidence; test native body reconstruction. | Root |
| R10 | Blind | medium | Put dated rates, context allowances, calculation and public references into the reviewable spend proposal. | Root |
| R11 | Edge | medium | Retain independently valid output usage when input usage is malformed or inconsistent. | Native |
| R12 | Edge | medium | Missing final/error output_tokens must not erase an earlier observed output count. | Native |
| R13 | Verification | high | Redirect/retry tests must exercise the shared production transport policy, not a independently reimplemented fixture client. | Native |
| R14 | Verification | high | Test withdrawal of a knowledge dependency used only by historical model context; continuation must refuse without a new invocation. | 22.1 |
| R15 | Edge recheck | medium | Renew the exact owner lease between bounded phases of the new cumulative-history integration test. | 22.1 test |
| R16 | Edge recheck | medium | Retain complete already-received JSON usage when cancellation interrupts body framing, without releasing model output. | Native |

Additional gate failure G01: `full-rust-2` failed the evidence candidate count at infrastructure/tests/evidence.rs:666 (2 versus 1). Preserve the failed run, diagnose the random-ID ordering interaction, and make the assertion deterministic without narrowing production search or deleting custody coverage.

## Targeted independent rechecks

- Blind reviewer accepted R01/R02/R07/R08/G01 after the evidence repairs; separately accepted R09/R10 and the explicit CI qualification-example command. Source review only.
- Verification reviewer accepted R07/R13/R14 after tracing their exact repaired tests. Source review only.
- Edge reviewer accepted the production recovery/history repairs and found R15: the new cumulative-history test failed to renew its five-second owner lease. Severity medium, route patch. `operations-review-repair` independently reproduced Fenced at model_execution.rs:1076 after 8.96s; preserve that failed receipt. Repair uses the existing exact-basis lease-renewal API, with no lease/timeout increase or relaxed assertions.
- G02: `browser-search-review` ran all 14 cases:13 passed,1 failed,zero retries. All new review journeys passed. B1 could not read an observed response body through Chromium DevTools; the capture was repaired while retaining server-body and rendered-coverage assertions. A later G03 in browser-search-clean exposed the same CDP capture issue in B8; both now use unchanged actual upstream bytes bound to the exact completed browser request. The clean focused run passed all 14 cases with zero retries.

Executed partial gates after the production repairs:215 library tests (including37 native),6 qualification-example tests,3 evidence PG tests,183 web checks, strict Clippy, web build and historical schema9 browser upgrade all passed. These focused results did not replace the subsequent clean combined gates.

- R15 was independently accepted after `operations-lease-repair` passed all 5 tests with unchanged source.
- R16 now salvages complete bounded JSON on Deadline or Cancelled, preserving Cancelled and withholding model output. Both providers are exercised with200/429/503 and complete/incomplete JSON. The first test assertion wrongly rejected the required Usage event; `native-cancellation-repair` records37 passes and1 failure. The corrected assertion requires exactly one matching Usage event for complete metadata and none for incomplete metadata. `native-cancellation-clean` passed all 38 native tests. Edge review accepted the production repair and exact assertion correction.
- Final read-only Blind recheck found no discrepancy among the qualification proposal, runner and safe evidence: USD20 pre-tax, six requests, Standard tiers, synthetic only, unapproved/unexecuted,22.1 incomplete and22.2 queued.

## Final adjudication

All16 review findings and the G01/G02/G03 test defects are repaired. No product policy or broad architectural change was made. No finding was rejected merely because it fell outside one implementer's file ownership. Source rechecks are independent inspections, not independent suite reruns; root owns the recorded executions. See the checkpoint index for the final frozen-source combined results, retained earlier failures and source reconciliation.

## Combined regression follow-up

- G04: Full browser run failed the legacy paginated-engagement focus assertion. The capture showed conversation loading, and the test revoked access before attempting focus without asserting it succeeded. Repair awaits a usable conversation, establishes and asserts focus on the exact original back button, then revokes asynchronously and checks both node removal and heading focus. No production focus change.
- G05: The methodology disclosure test reached its final held-response timeout assertion after the explicit connection-reset path passed. It was still Checking after12 seconds. Source inspection shows15/30 second refreshes can deliberately supersede request ownership; the run did not record which timer fired. Repair runs real sign-in/creation normally, pauses the installed clock and reloads before inspection, then proves retention at 7999ms and withdrawal at 8000ms against the actual held response. No raised timeout or relaxed assertion.
- G06: The mixed Unicode browser case completed exact metadata, all five byte-for-byte downloads and the sorted registry assertion, then required all five richer rows to fit simultaneously. Each exact-ID row is now scrolled into view before the unchanged ratio 1 visibility assertion. No source-value or download assertion is removed.
- Edge reviewer independently accepted all three test-only patches before application. Static review is distinct from their subsequent execution.
- G07: full-rust-4 failed the legacy membership expiry Save with Unavailable. Existing PostgreSQL logs confirm a 4000ms statement timeout within the 101-scope membership fence. Cause of delay is not established. The unchanged focused target passed all 3tests. Final database/browser gates are sequential; no production deadline was raised. See membership-timeout-diagnosis.json.

- Follow-up focused browser run passed G04/G05 but the initial G06 scroll helper left a row border at intersection ratio 0.997929. Root inspected the screenshot and changed the test to actual DOM scrollIntoView with block:center, retaining ratio1. Edge recheck accepted that exact change. `browser-preconditions-clean` passed all 3cases with zero retries and unchanged source; the failed 2-pass/1-failure invocation is retained.

- Final `full-rust-5` completed 371 passes, zero failures, with unchanged source. Its membership aggregate passed all 3tests in 32.37s under the original 4000ms database deadlines. The failed full-rust-4 remains part of gate history. Three parent-owned helper entries remain intentionally ignored in default enumeration and are exercised by their parent contracts.

- Final `browser-full-clean` completed all 159 cases with zero failures, zero retries and unchanged source. G04/G05/G06 and all fourteen new source-library journeys passed. Five fresh synthetic captures from this final run were visually inspected and packaged with exact hashes.
