# Story 21.4 retained failed attempts

This is an audit of retained nonzero `*.exit` receipts under `/tmp/zobba-story-21-4`, including the methodology custody package. At this audit point there are **19 nonzero receipts: 18 failed checks, harness attempts or product regressions and one valid expected-negative control**. Names below identify the receipt without its `.exit` suffix; the matching `.log` is the primary evidence unless another artifact is named. Logs were inspected without copying traces, environment values, browser storage, cookies, credentials, or raw response identifiers into this report.

This is not a final verification receipt. The first full Rust run passed **301 tests, with 3 helper tests ignored**, but predates the final omission and compact-receipt repairs. The second full run now passed **302 tests, 0 failed, 3 helper tests ignored across 44 result blocks** (`rust-tests-2.exit` is 0); the knowledge suite passed 3/3 in 131.07 seconds and includes those repairs. `knowledge-envelope-2` separately passed all 3 API envelope/parity tests. Focused browser run 4 still has one diagnosed product failure; its repair, a fully passing final browser run, and final smoke closure remain pending. Later successful checks establish only the source and scope they actually ran.

## Failed static and unit checks

| Attempt | Exit and observed result | Diagnosis, repair, and limit |
| --- | --- | --- |
| `fmt` | 1; formatting differences in application/API knowledge files | Rust formatting check found source formatting differences. Formatting was applied. This was not an executed behavioral test. |
| `fmt-final-2` | 1; formatting differences in API knowledge and infrastructure knowledge tests | Newly added omission and compact-receipt tests needed formatting. Subsequent `fmt-final-3.exit` is 0. A formatting pass establishes formatting only. |
| `clippy` | 101; two `collapsible_if` errors in infrastructure knowledge | Strict Clippy rejected nested branches. The branches were collapsed without relaxing the lint. |
| `clippy-2` | 101; `len_zero` error in an API knowledge test | Replaced the length comparison with `is_empty()`. Subsequent `clippy-3.exit` and `clippy-final.exit` are 0; those receipts do not cover edits made after their invocations. |
| `web-check` | 1; 174 passed, 1 failed | `the real API contract distinguishes live, ready, and unavailable` supplied schema version 9 to the now-version-10 health parser and received `Invalid service response`. Current test diff confirms updating the ready fixture to 10 and old/future rejection fixtures accordingly. This was a unit fixture mismatch, not evidence of an API outage. `web-check-4` later passed all 177 tests. |

## Failed PostgreSQL and HTTP attempts

Each of the five attempts below reported **2 passed and 1 failed**. The two passing support guard tests intentionally exercise refusal paths; their caught panic output is not an additional failed test.

| Attempt | Exit and stopping point | Diagnosis, repair, and limit |
| --- | --- | --- |
| `knowledge-infra-1` | 101; main producer test stopped at the destructive fixture guard before database work | Test roles did not share one complete effective endpoint set. Test-role endpoint configuration was aligned. The refusal was preserved; the guard was not bypassed. This attempt supplied no knowledge producer proof. |
| `knowledge-infra-2` | 101; main producer test failed with `SchemaMismatch` during bootstrap | Implementation lead identified the schema inventory and ledger ceiling as still reflecting the pre-10 schema. Those schema checks were updated for migration 10. The retained log proves `SchemaMismatch`; it does not independently isolate each inventory/ceiling subcheck. |
| `knowledge-infra-3` | 101; oversized-envelope fixture failed its assertion that all individual fields were valid | The fixture repeated a dependency, so duplicate-dependency validation rejected it before the intended aggregate-size boundary. It was changed to 32 distinct, syntactically valid source references. Those references are intentionally unresolved: this is a negative capacity test that must refuse before source lookup or writes, not positive evidence produced from real sources. |
| `knowledge-http-1` | 101; shared response-status assertion received a successful initial knowledge page | The test expected an unavailable initial binding, although real Task admission initializes the methodology binding. The fixture expectation was aligned with the admitted Task's actual current binding. The successful empty page is not a failed knowledge read. |
| `knowledge-http-2` | 101; Guide submission returned `invalid_task_command` | The fixture sent Guide through the create-task command lane. It was moved to the existing task-control lane used by Guide. No new Guide authority was introduced to satisfy the fixture. |

The later `knowledge-infra-4` and `knowledge-infra-5` each passed all 3 tests; `knowledge-http-3` passed all 3 tests. The main producer and HTTP contracts also passed in the first full Rust run. These results resolve the listed fixture/bootstrap failures at those snapshots, not the later final-source gate.

## Knowledge browser attempts

All four retained attempts used one worker and zero retries for nine selected cases.

| Attempt | Exit and observed result | Diagnosis, repair, and limit |
| --- | --- | --- |
| `knowledge-focused-1` | 1; 3 failed, 6 did not run | The first learning case could not find expected visible content; its initially blank/missing-content symptom has **no established root cause** in this audit. The typed-release case timed out selecting a destination. A subsequent fixture reset was refused. `knowledge-focused-1-reset-diagnostic.log` separately proves that deleting an organisation still referenced by new knowledge records violated the foreign key. The guarded reset gained knowledge-child cleanup before parent deletion. That diagnosis does not explain the earlier blank symptom. |
| `knowledge-focused-2` | 1; 5 passed, 4 failed | Typed release timed out at `selectOption`; assertion correction timed out at `fill`; unsent-draft recovery and lost-reply recovery failed to find their expected textarea/control locators. Native select lookup was changed to the combobox accessible name, and controlled textareas to textbox role/name so current field values do not change the matched label text. Assertions were retained. Focused run 3 passed release, assertion correction, and lost-reply recovery; its draft case stopped earlier in a response-body helper. The draft-outage scenario subsequently passed in focused run 4. |
| `knowledge-focused-3` | 1; 6 passed, 3 failed | Unsent-draft and source-correction cases stopped in `createTask` while reading the accepted response body after asserting HTTP 202. Same-client reuse stopped in `recordAssertion` while reading the committed response body after asserting HTTP 200. All three report CDP `Network.getResponseBody` / `No data found for resource with given identifier`. This proves a browser response-body retrieval failure at those helpers, not a rejected command, rolled-back mutation, or completed scenario. Focused run 4 progressed beyond those helper points, but the original CDP failure's cause remains unproven. |
| `knowledge-focused-4` | 1; 8 passed, 1 failed in 1.6 minutes | **Confirmed product race:** the async source-status completion initialized the whole previously captured source-correction draft, erasing a replacement ID typed while status was loading. The browser then blocked submission on the now-empty native required field: no mutation POST occurred, and the original card remained. The test failed waiting for that card to disappear. Real-browser diagnosis distinguishes this from the earlier CDP helper failures. A bounded product repair and a regression that holds the real status response, types before release, then checks preservation/admission are authorized and in progress; no passing repair receipt is claimed yet. |

Focused run 2 passed learning/Undo, automatic acquisition and Guide capture with source navigation, held-success fencing, source correction, and same-client reuse. Focused run 3 passed learning/Undo, typed release, automatic capture/navigation, assertion correction/exclusion/forget, lost-reply recovery, and held-success fencing. Focused run 4 passed all cases except source correction, including the previously incomplete actual-session draft outage. These are separate invocation results; combining their passing cases does not create a single green final browser run.

Focused run 3 overlapped a web check at **18:40:55–18:41:17 UTC** and a web build at **18:41:17–18:41:30 UTC** on 2026-10-02. The implementation lead reports source unchanged during that run; the test geometry capture was added before it started. Temporal overlap does **not** establish build, Vite, or cache causality for the CDP failures. The browser error's generic navigation advice also does not independently prove that navigation caused these failures.

## Methodology harness failures

These are a focused Story 21.2 custody follow-up package, not replacements for Story 21.4 knowledge tests. Detailed sanitized classifications are retained in the package's diagnosis JSON files and `methodology-custody/closure.json`.

| Attempt | Exit and observed result | Diagnosis, repair, and limit |
| --- | --- | --- |
| `methodology-custody/negative-harness-1/negative` | 1; zero tests selected/executed | The anchored grep did not match Playwright's full test title, which includes its filename. The selection expression was fixed. No runtime or target product assertion executed; this is **not** a valid negative control. Exact repaired source bytes were restored. |
| `methodology-custody/negative-harness-2/negative` | 1; one test entered, but target custody assertion was not reached | Sign-in, seed, and editor fields worked; exact-label select lookup included option text and timed out. The selector was changed to the combobox accessible name. No custody interruption or target restored-draft assertion executed; this is **not** a valid negative control. Exact repaired source bytes were restored. |
| `methodology-custody/repaired` | 1; 3 passed, 1 failed | Same-account replacement and another-identity clearing assertions passed. The failing case's final explicit sign-in after application logout reused a surviving provider SSO cookie and therefore did not show an Account control. The fixture now waits for completed application logout and uses the existing replacement-sign-in helper to clear only the provider cookie. No product source change or assertion removal was needed for that repair. |
| `methodology-custody/repaired-retry-1` | 1; `beforeAll` exceeded 90 seconds, no case bodies executed, 3 remaining unrun | A cold Cargo build in standard `startAuthRuntime` startup exceeded the hook budget while backend source was changing. An owned fixture provider process started near timeout and was subsequently identified and terminated. The workspace/harness was prebuilt separately before retry; timeouts were not weakened. This is startup failure, not an executed browser product assertion. |

The later `methodology-custody/repaired-retry-2.exit` is 0: **4 passed, 0 failed, 0 skipped**, one worker, zero retries, 37.4 seconds. Its source manifest and closure record report no source changes during invocation and exact restored component bytes. That closes the focused repaired methodology suite. It is Chromium-only and does not qualify native OS tabs or the full knowledge regression.

## Valid expected-negative control

| Attempt | Exit and observed result | Why it is valid, and its scope |
| --- | --- | --- |
| `methodology-custody/negative` | 1; one selected test reached the intended failure in 20.5 seconds | Only the exact previous `MethodologyWorkspace.tsx` baseline was substituted. After an actual `/auth/session` 503 unmount and a successful fresh scoped Admin read, the assertion requiring the exact unsent Edit methodology form to reappear failed. The substitution manifest and closure record confirm no source changes during the negative invocation and exact restoration of the repaired file afterward. This is the intended old-source negative, separate from the two invalid harness negatives above. |

Expected refusal assertions inside passing guard, authority, capacity, and replay tests are also intentional negative coverage. Their diagnostic lines must not be added to the nonzero-attempt count or described as failed regressions. Conversely, a guard blocking an entire intended positive integration invocation, as in `knowledge-infra-1`, remains a failed harness attempt and supplies no positive producer evidence.

## Outstanding uncertainty at this audit point

- The first focused knowledge browser run's blank/missing-content symptom is not explained by the later, independently diagnosed fixture-reset foreign key failure.
- Focused run 3's HTTP statuses were successful, but why CDP could not retrieve those response bodies is still under investigation. Overlapping check/build timing is recorded without a causal claim.
- Focused run 4 establishes a separate source-status/draft product race. Its bounded repair and held-real-response regression are forthcoming. It does not retroactively establish causes for the unknown blank symptom or CDP failures.
- The second full Rust run and final API envelope run are now green. A fully green knowledge browser invocation after the draft repair, full browser regression, and final smoke closure are not claimed here. Preserve these earlier failed attempts when updating final verification.

Inventory cross-check: 5 static/unit receipts + 3 infrastructure receipts + 2 HTTP receipts + 4 knowledge browser receipts + 4 methodology harness receipts + 1 valid expected-negative receipt = **19**.

Final repaired closure is recorded separately in `repair-final-gates.json`, `repair-failed-attempts.md` and `repair-browser-full-3-receipt.json`: complete Chromium 145/145, zero retries, unchanged final source. The earlier unknown blank-landing/CDP causes and recorded cache/build overlap remain historical unknowns; no causal explanation is inferred from the later pass.
