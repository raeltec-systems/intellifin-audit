# Independent browser-harness verification review

The evidence teardown repair preserves and strengthens the six replacement cases, which all passed without retry. The conversation instrumentation preserves withdrawal assertions and now supplies meaningful fault-delivery evidence in a subsequent one-case diagnostic pass. However, the first instrumented seven-case run failed because no fault request was observed. That failure remains preserved; the added observations and later pass do not establish its cause or demonstrate that an intermittent delivery problem has been eliminated. A fresh full 107-case pass is not claimed.

## Source and preserved P16 scope

I compared both current test files with `conversation-review.spec.ts.before-harness-repair` and `evidence.spec.ts.before-harness-repair`. The saved files match the original P16 `source-start.json` hashes. `source-full-attempt1-finished.json` exactly matches that 201-file start manifest.

At the final source read for this report, comparison of all 201 registered files finds exactly these additional changes:

| File | Current SHA-256 |
| --- | --- |
| `zobba/web/tests/browser/conversation-review.spec.ts` | `448a1f28b480ad234a30bef78fe688405493edba30978e18e6143a0f6b114d9e` |
| `zobba/web/tests/browser/evidence.spec.ts` | `e7267a670538f3de10006afdaf338ca0456aca6e5207ad665513d0c538b1a967` |

All product/backend/schema/API files remain identical to the P16 start manifest. The P16 test beginning `inner methodology disclosure survives cancelled reads...` is byte-for-byte unchanged from the saved pre-harness browser file. The component and the prior P16 negative/focused proof therefore retain their previously documented source scope and limitations. A new final manifest for these two later test hashes had not been supplied at this inspection; the original start manifest must not be described as matching these later test bytes.

## Original failures and evidence handling

The first P16 full run is a failed receipt: **105 passed, two failed, exit 1**, preserved under `browser-full-attempt1.*`. I inspected only allowlisted summaries, assertion details and source locations from sensitive raw logs; no synthetic session/header values are reproduced here.

The conversation failure was the final Task-details count, expected zero and observed one. The old test supplied no observation proving that its fault handler actually received a request. The later screenshot follows route removal in cleanup and cannot establish assertion-time fault state. The available evidence does not prove a glob mismatch or a product failure on a delivered current fault.

The evidence error attributed to the subsequent same-actor download case originated at the preceding metadata route handler's `route.fetch` line, with the test already ended. That source location supports an outstanding metadata callback escaping its test lifetime. It does not establish a failed zero-Blob assertion.

## What the new assertions establish

The conversation case still performs the original same-session hiding, mounted-control/methodology, disclosure and focus checks. It drains the previous successful-read handlers, installs an exact same-origin matcher for the snapshot and event endpoints, clicks Latest and awaits a snapshot request for which both the `route.abort` completion and the matching Playwright `requestfailed` event were observed. The matching Request object indexes the diagnostic entry; failure evidence cannot come from an unrelated session or stylesheet request. Only after that assertion does the test run its unchanged zero-count assertions for Task details, marked control and marked methodology node.

The diagnostic attachment is collected while the fault remains installed. It includes paths, relative times, network error text and node counts; it omits request headers, cookies, query values and response bodies. The later diagnostic-only additions record API-path traffic and whether the native click occurred. The one-use click listener only marks the button; it does not invoke application internals, force a projection, add a successful response, dispatch an extra click or weaken an assertion. The test still uses one ordinary awaited Playwright click. The native click marker is diagnostic, not a separately asserted application-resync receipt.

The evidence patch affects both tests registered for each of the three existing accounts: same actor with replacement session, another actor in the same engagement, and a foreign-scope actor. Registration remains the unconditional three-account loop, producing six awaited test bodies. All original evidence-detail removal, unfinished-reservation removal, session-storage draft erasure, foreign-content absence and zero-Blob checks remain. The download case still requires a real 200 response before the gate and waits for actual fulfill completion after replacement. Both metadata and download cases now release their gates and await `unrouteAll({ behavior: 'wait' })` in `finally`. Removing the old `.catch(() => {})` on fulfill exposes errors that were previously swallowed. The installed Playwright wait behavior drains callbacks without enabling its separate ignore-errors path.

No timeout increase, retry allowance, skipped case, relaxed count or fabricated successful server response was added. The bounded repair does not prove a universally deterministic schedule; it makes the tested schedule and its failures observable and prevents successful test completion with active owned route callbacks.

## Executed receipts and remaining limits

The first instrumented run is preserved as `browser-harness-focused-attempt1.log/.exit`, using `--workers=1 --retries=0`. It reports **six passed, one failed, exit 1**. All six evidence cases passed. The conversation case failed its new delivered-snapshot-fault poll. Its preserved `conversation-access-fault-focused-attempt1.json` says the fault was installed, but `reads` is empty and all three protected-node counts are one. This is a useful discriminating failure: the test did not silently credit withdrawal without exercising the fault. It does not reveal why no matching request occurred.

After the traffic/click observation additions, `browser-access-diagnostic.log/.exit` records the conversation case passing once with zero retries in 9.6 seconds, exit 0. Its preserved `conversation-access-fault-diagnostic-pass.json` records a same-origin snapshot request at relative 805 ms, completed abort at 808 ms, matching request failure at 817 ms with `net::ERR_CONNECTION_RESET`, an observed click, and all three node counts zero. This is actual observed fault delivery followed by withdrawal on that execution. It is stronger evidence than the earlier bare click, but one diagnostic pass does not explain the previous empty-read run.

At this inspection there was no completed clean seven-case receipt for the final diagnostic version and no completed fresh full 107-case gate. The six successful unchanged evidence cases and one later successful conversation case must be reported separately, with both prior failed gates retained. The new instrumentation is suitable for the next full execution; acceptance requires reconciling its completed receipt and final source manifest. The P16 retention closure remains bounded as described in `verification-P16-closure.md`.

No tests, builds, services or database operations were performed for this review, and no repository source was edited. Only this requested review artifact was written.

## Final bounded reconciliation — settled seven-case receipt

The remaining combined-focused receipt and source-freeze questions above are now resolved for the settled harness candidate. I independently read `browser-harness-focused.log/.exit`: the selected conversation case and all six metadata/download replacement cases pass together in **50.1 seconds**, using one worker and **zero retries**, with exit 0. `browser-harness-focused-results/.last-run.json` reports passed and no failed tests. This is a distinct completed run, not a reclassification of either earlier failed attempt.

All 201 current file hashes match `source-harness-candidate.json`. Its only differences from the original P16 `source-start.json` are the two browser tests. The final conversation-review hash is `ea4098a35a3065e143e9f347d7b2333d6318445e9c67a9993f162e9dbdc1ad84`; the evidence-test hash remains `e7267a670538f3de10006afdaf338ca0456aca6e5207ad665513d0c538b1a967`. `TaskMethodology.tsx` remains `66125d5592e07960dbed421f10862dbf1d520887e82ef5464775bc68c241e648`, and the complete P16 inner-disclosure test remains byte-for-byte unchanged. The supplied `browser-harness-repair-delta.json` agrees with this independent comparison.

The final conversation-test change since the initial report wraps diagnostic collection in a nested `try/finally`. Source lines 158–175 retain collection before route removal, while the inner `finally` always removes listeners, releases both gates and awaits `unrouteAll({ behavior: 'wait' })`, even if attachment collection or node-count retrieval fails. No catch suppresses that error or a route-handler failure. This closes the cleanup hole in the intermediate diagnostic version without weakening its assertions.

I read the separately preserved `conversation-access-fault-focused-final.json`, SHA-256 `a973f725093baa56087f87cd590530be46436e2af924120e94f249cb98008416`. It records the real conversation snapshot observed at relative 863 ms, abort completion at 867 ms, matched request failure at 875 ms with `net::ERR_CONNECTION_RESET`, a same-origin request observation, the native click marker and zero Task-detail/original-control/original-methodology counts. These observations were captured before cleanup could restore successful reads. The preserved focused copy is the stable evidence reference; the reporter's generic `conversation-access-fault-full.json` may be overwritten by the next run.

The resulting bounded assessment is **supported harness closure on this focused execution**: exact delivered snapshot failure and withdrawal are demonstrated, all six replacement cases complete with drained handlers and unsuppressed errors, and production/P16 behavior is unchanged. The first full 107-case run still has 105 passes/two failures and exit 1; the first instrumented seven-case run still has six passes/one failure and exit 1; the intermediate one-case diagnostic pass remains separate. The original cause of the intermittent missing-request phase is not established by these observations or by the settled pass, and no causal-root claim is made.

The new full 107-case gate remains pending: `browser-full.exit` did not exist at reconciliation. This focused closure does not substitute for its completed receipt or alter the proof limits in `verification-P16-closure.md`. This reconciliation used read-only source and artifact inspection; no tests, builds, services or database operations were run.
