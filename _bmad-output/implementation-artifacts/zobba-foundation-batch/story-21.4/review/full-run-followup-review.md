# Story 21.4 full-run follow-up review

Result: the three bounded follow-up cases have source and focused execution closure. `repair-full-failures-focused-1.log` records 3/3 passed in 40.2 seconds, one worker, zero retries, exit 0. The 245-entry source manifests are identical before and after that invocation and the four reviewed current browser files match those manifests. No remaining concrete defect was found in these fixture/diagnostic changes. The full browser gate and final combined verification reconciliation remain pending; this report does not close the running full-2 invocation.

Review scope is the additional failures from the first repaired full invocation: the asynchronous administration/evidence lock test, named same-client knowledge reuse sign-in, and actual inner skill disclosure lifecycle. Original H1–H4 source/execution reports remain unchanged. Only authorized source, patches, list logs, manifests and safe proof artifacts were read. This reviewer ran no tests, builds, services or application changes and read no private raw reporter, trace or environment material.

## Preserved failures and limits of diagnosis

`repair-browser-full-1.log/.exit` remains failed evidence: 145 total, 142 passed, 3 failed, 17.5 minutes, one worker, zero retries, exit 1.

- Evidence case: asynchronous psql closed unsuccessfully and raised the generic mutation error. That original receipt does not identify SQLSTATE, failed phase or exact lock cause.
- Named reuse case: the initial `signIn(page)` call failed its unchanged Your engagements visibility assertion after the real login callback flow, before the reuse journey began. Root separately reported the signed-out callback-error state. No callback failure cause was established by this review, and later success does not diagnose it.
- Skills case: the held session route threw `Route is already handled!` at fulfillment, followed by target-closed cleanup failure. The exact cause of that original route error remains unproven.

The first diagnostic invocation preserved the original evidence timing/SQL and failed at `evidence-observe-metadata-lock`, child close, SQLSTATE `P0001`, exit code 3. This is the observer's explicit two-second exception, establishing absence of its expected predicate within that window, not why it was absent and not the cause of the earlier generic full-run failure. Named reuse passed in that same diagnostic invocation. The subsequent single-case evidence diagnostic passed with the old timing, and diagnostic-3 passed both evidence and skills. None of those passes is treated as a diagnosis of the original failures.

Diagnostic-3's safe skills ledger contained 304 events with zero overflow, mixed bound/unbound session traffic, expected cancelled skill requests, successful fulfillment/settlement and no handler failure. It supported narrowing gate ownership; it did not reproduce or explain the earlier already-handled error.

## Evidence fixture: owned blocking chain and bounded cleanup

Reviewed both `/tmp/zobba-story-21-4/evidence-owned-barrier.patch` and the actual applied source. The final `auth-runtime.ts:134–270` helper owns two asynchronous psql children and a uniquely named API pool. `database_options` already permits `application_name`; no authority or connection-routing option was added to production. `evidence.spec.ts:389–422` performs real OIDC, obtains the real current session and navigates only its page to `about:blank`, retaining the context cookie while retiring unrelated UI polling. The test then issues one real metadata request through the same API/database proxy.

The helper first observes the owned API pool idle. Its holder emits a PID marker only after a real session-row `FOR UPDATE` lock and an explicit nonempty actor-row check. While retaining that lock, the holder performs bounded read-only statistics observations. Metadata ownership requires exactly one unsettled API transaction, the exact `SELECT public.evidence_session_locked($1,$2)` query used by the source, and exactly the holder PID as blocker. Admin ownership requires its exact child PID, unique application name, fixed UPDATE query and the same metadata PID as its sole blocker. COMMIT occurs only after both edges are observed. There is no fixed sleep to release the lock, no SQL/HTTP mutation retry and no invented successful response.

Both children share the original absolute 10-second bound and 500ms termination escalation; observations remain bounded at two seconds. The helper uses fixed bounded output frames, only sanitized phase/SQLSTATE/process results, and never emits session tokens or raw stderr. `complete()` waits for actual child close separately from pending-exchange failure. Cleanup queues rollback where commit was not requested, awaits both owned children and retains primary plus cleanup errors. The final real status-200 and empty-items assertions are unchanged, and the test additionally requires both children completed and the metadata response still unresolved before release.

The final safe `repair-owned-blocker-chain-proof.json` establishes:

| Observation | Executed value |
| --- | --- |
| Initially owned API pool | Four connections, zero unsettled transactions |
| Holder PID | `1060395` |
| Metadata PID | `1060393`, sole unsettled API transaction, blocker exactly `[1060395]` |
| Waiting admin PID | `1060397`, blocker exactly `[1060393]` |
| Phase order | idle observed → session lock ready → metadata observed → admin started → chain observed → explicit commit |
| Completion | holder completed and admin completed both true; release `commit`; actual metadata status 200 |

The passing exact-source test additionally verifies the metadata body has `items: []`. This is direct blocked-chain/commit evidence, not an inference from elapsed time or a generic matching activity row.

## Knowledge sign-in: observation without retry or weakened privacy checks

`knowledge.spec.ts:44–104` retains the original single login interaction and Your engagements assertion. Its new failure observer is installed on the actual calling Page and attaches before an auxiliary reader context could close. It records bounded callback/status/path categories, fixed error names, request-failure categories, current session/readiness status and process exit state. OAuth/query values, cookies, response bodies and opaque provider interaction paths are not emitted. The catch always rethrows the original failure. No auth retry, success fallback, timeout increase or altered privacy assertion was introduced.

The full named same-client case passes in the final focused invocation in 6.1 seconds. Its original named destination reuse, exact source record, foreign-action availability, independent reader source-access loss, independent accountable Task-owner source-access loss and source 403 checks remain in the case. The earlier callback failure remains unexplained; the final pass establishes the final-case behavior only.

## Skills lifecycle: exact App gate ownership and settled handlers

Reviewed `/tmp/zobba-story-21-4/skills-final-harness-cleanup.diff` and the applied `skills.spec.ts:601–758`. Only unbound App session reads now own the authority gate and can set `authorityHeld`; bound projection postchecks continue through their real request. This follows the existing `readSession` versus `readSessionJson` contract and the observed mixed traffic. The temporary fetch/signal/console wrapper is entirely removed.

The final test retains exact Playwright Request identity, status, failure, fulfillment and settlement evidence. All owned handler promises are explicitly settled before `unrouteAll({ behavior: 'wait' })`; rejections still fail. Gate release is guaranteed by the inner cleanup path, including registration failure. Nested body/cleanup errors and outer context cleanup errors remain preserved. No already-handled or target-closed error is ignored. All 24 original assertion expressions remain, covering retained inner marked DOM, open disclosure, focus, hidden protected text, successful return, current transport-failure withdrawal and actual timeout withdrawal. The sole additional assertion requires ledger overflow zero.

The final safe `repair-skills-route-lifecycle-proof.json` contains 211 events with zero overflow:

- Exactly 22 registered Request identities and 22 corresponding handler-settled entries; no identity lacks settlement and no handler/body/cleanup failure entry occurs.
- Only unbound session IDs `2` and `12` are held for the focus and visibility authority gates. Ten bound session requests (`6–10`, `15–19`) continue; none is recorded held.
- Actual cancelled skill requests are correlated by identity with `net::ERR_ABORTED`; transport IDs `20` and `21` fail with `net::ERR_CONNECTION_RESET`; the held timeout ID `22` fails with `net::ERR_ABORTED`.
- Handler settlement, route cleanup and final auditor-context close all complete. Recorded response statuses are 200.

The passing exact-source test supplies the associated unchanged DOM/privacy/focus/current-error assertions. This closes the bounded lifecycle regression on the final fixture without claiming the original already-handled failure was causally diagnosed.

## Source and receipt binding

Baseline: `d38e1daed736415ef13e7606345dac71bd1d9f01`. All 245 path/hash entries match between `source-repair-full-failures-focused-1-start.json` (2026-10-02 21:25:26.410830 UTC) and `source-repair-full-failures-focused-1-end.json` (21:26:09.307548 UTC). The actual current hashes below match both manifests:

| Source | SHA256 |
| --- | --- |
| `zobba/web/tests/browser/auth-runtime.ts` | `d33b79b273e83b3d3c8d397d768b581d6752aea1d9301a9afecd5412c1c46f5f` |
| `zobba/web/tests/browser/evidence.spec.ts` | `809882f1ba38bc5d843d593633ccf6b98f1a14fe94e0468488db5b3ccd5d7ab8` |
| `zobba/web/tests/browser/knowledge.spec.ts` | `d032cfdfee3ac38a12514d82c9cc514d156ee0721195ac29e9df1c6cefed2a94` |
| `zobba/web/tests/browser/skills.spec.ts` | `3be06dbcfe2daa308aecfe81317124cd48d82610d0ce257005e31c0feaf7d15d` |

Scoped `git diff --check` was clean. No tests were run by this reviewer. The lead reported a passing final common-fixture upgrade rerun and owns its separate receipt review; this report does not substitute for that gate or the running full browser invocation.

All artifact paths below are relative to `/tmp/zobba-story-21-4/`:

| Artifact | SHA256 |
| --- | --- |
| `repair-browser-full-1.log` | `5ba3abe7d3e641278b041be3b17f00458d6321672f52cd166eb6da7b55580473` |
| `repair-browser-full-1.exit` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `repair-full-failures-diagnostic-1.log` | `8d9ae588aa54b675903f92f2cd76c26723af0f279c28ca47036bac92abd3d35c` |
| `repair-evidence-diagnostic-2.log` | `dcf2a27a2347c88da52598c993951151a9d7620701b469de9468674d64a55bb1` |
| `repair-full-failures-diagnostic-3.log` | `89fb2bdd2895350ec491130514d21bd60d0ae6ba7e4d9d3c79ac693b4a2038a5` |
| Diagnostic-3 standalone `skills-route-lifecycle.json` | `9b59cfdf270f6f041567bf7e306d437daf033e61960fe991fb49515c210bab1c` |
| `repair-full-failures-focused-1.log` | `2a73506666fa80c410c012ec225478c96e37de4bacc271333f32790aff7bf81f` |
| `repair-full-failures-focused-1.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `source-repair-full-failures-focused-1-start.json` | `961aa598c84d7afa50b7f4d833ed1cd7ec235f5cc9ecfff2b2a8f9454ab0ab1a` |
| `source-repair-full-failures-focused-1-end.json` | `986547b5c1f0bc839a7ca5cdd700b7a21029d2277a407e51841eb9a0c0358bb0` |
| `repair-owned-blocker-chain-proof.json` | `adf36af8d274204a8aa48c8eab3e17ea13f9b56812c4b7e8e89ff42823d03b1b` |
| `repair-skills-route-lifecycle-proof.json` | `c6214b6d13e308ddba50d4d7b893f565830af448e4f24369070d321dae907817` |

The diagnostic-3 standalone ledger is under `repair-full-failures-diagnostic-3-results/skills-actual-inner-skill--66552-rent-failures-withdraw-them/`. Original failed attempts remain retained and failed. Final combined closure must use the final full-suite receipts and reconcile any source changes after the manifests above.
