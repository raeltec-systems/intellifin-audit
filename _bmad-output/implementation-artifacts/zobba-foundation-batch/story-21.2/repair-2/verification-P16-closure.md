# Independent P16 verification closure

The executed negative control and repaired focused test discriminate the reported inner-disclosure loss. The bounded repair has evidence for retaining the same inner template node, open state and focus through same-session revalidation and simulated tab return, while still withdrawing the basis on an owned transport failure or deadline. The focused evidence supports this retention repair. It does not establish every broader ownership/privacy scenario, and the new full 107-case browser gate is not accepted by this report.

## Source identity and retained gates

I read both complete patches, the current source/test, the source manifests, the negative and focused logs/results, web receipts, preserved gate receipts and the P16 finding. Independent comparison establishes:

- `source-before.json` is identical to `repair-1/source-final.json`, with the same baseline HEAD and 201 implementation files.
- `source-start.json` changes exactly `zobba/web/src/TaskMethodology.tsx` and `zobba/web/tests/browser/conversation-review.spec.ts`. All 201 current file hashes match it. Backend, migrations, API, generated contracts, backend tests, browser harness and configuration are unchanged.
- The saved original component hashes to `a97b8e2f3c4ebf530aa4815d47adc217f4e7aebe42ff0e96f0e34e329691b629`, matching both the prior manifest and `P16-verification.json`'s negative-control source receipt. The repaired component is `66125d5592e07960dbed421f10862dbf1d520887e82ef5464775bc68c241e648`; the repaired browser file is `85798459d372ec6a8e315b9348ab4c5c6fdded982f4546d696f39bafd1186f96`.
- Both patch artifacts correspond to these source changes. Their SHA-256 values are `d5737cb34cffe3b4eada388b6a7b177a9f3810baf8c5528cdc674e4242ccf78c` for the component and `3093c302a1c544b3eb6d4e24823528a44532f5d95ef22560d98115feba86e750` for the browser test.
- Every one of the 431 files listed in `repair-1-preserved-start.json` still matches its recorded hash. All nine retained gate receipts actually contain exit 0. Their underlying outputs include 225 Rust tests/doc tests passed (with three separately reported ignored cases), 47 Python tests passed, 56 fixture tests passed, successful clippy/build/boundary/generation outputs and completed process smoke. These are preserved executions applicable to unchanged inputs, not new P16 executions. Web behavior requires the fresh gates below.

## Negative control and registration

The new test is registered directly at `conversation-review.spec.ts:201`, with its asynchronous phases and assertions awaited. Both focused runners use the real existing HTTPS/OIDC/API fixture and `--workers=1 --retries=0`; no conditional registration, skip, expected-failure annotation or retry was added. The existing three tests are unchanged by this P16 patch and also ran in the repaired focused execution.

`browser-negative.log` reports one selected test, failing at line 255 after the real methodology read had been held, parent authority revalidation had occurred, and the conversation projection was still held. The failed locator is `[data-original-template="retained"]`: expected one, received zero, repeatedly over the assertion timeout. `browser-negative.exit` is 1 and its `.last-run.json` reports failure. The failure is inner-node loss, not a route teardown error or a missing outer section. The original component source supports precisely that failure: access/effect cancellation aborts the still-owned request, whose catch clears `basis`; its hidden-document branch separately clears `basis` explicitly. The saved original-source hash matches the negative-control source receipt. I did not rerun this control or independently capture the served module at execution time.

The old-source execution stops in the first (`tabAway=false`) iteration. It therefore empirically demonstrates the focus/revalidation loss; it does not independently execute the later tab-return, transport-failure or timeout phases against old source.

## What the repaired test proves

The test opens an actual rendered template disclosure, focuses its summary and marks that inner `<details>` node once. The marker is not re-applied during either lifecycle iteration. It then starts a real methodology GET, checks its real HTTP response is 200 and holds delivery before starting parent revalidation. The authority and conversation handlers likewise fetch real responses and assert 200; they do not fabricate a successful projection.

In both iterations, protected content is hidden during authority checking, and body text excludes the Task objective, template name, actor and client. After authority is released while conversation recovery remains held, the marked inner node must still exist, retain its `open` attribute and have a hidden summary. After recovery, the test awaits an enabled methodology Refresh control, drains active handlers, and requires that same marked node to remain open with its summary visible and focused. A remove-and-recreate implementation would lose the marker and fail. Merely preserving the outer section cannot satisfy these assertions.

For tab-away/return, the test deliberately sets both `document.visibilityState` and `document.hidden`, dispatches `visibilitychange`, checks hidden retained inner state, then sends the paired visible state. This matches the two properties consumed by App and TaskMethodology. The overrides are removed in `finally`. It is deterministic application lifecycle simulation in headless Chromium, not a claim about native operating-system tab switching.

The component repair invalidates `request.current` before intentional aborts. The existing catch consequently ignores that superseded callback. The timeout still aborts the current controller without relinquishing ownership, so the same catch continues to clear the basis on genuine owned failure. Owner identity still includes actor, session token, full scope and Task; successful application remains guarded by controller identity, owner identity and current access. The protected GET and subsequent session verification remain unchanged.

The test then aborts an actual current methodology request with `connectionreset`, awaits the unavailable message and requires both the original marker and all template disclosures to disappear. After removing that fault route, it reads the real basis again, opens/marks the recovered inner node, starts another real 200 read and withholds delivery. Without releasing the held response, it awaits the unavailable message and zero marked/template nodes. Source inspection shows the owned eight-second abort deadline; the passing execution demonstrates withdrawal while delivery is held. The test does not assert the exact elapsed duration. This distinguishes intentional cancellation from indiscriminate suppression of every aborted request.

Gates are released in `finally` and handlers drained with `unrouteAll({ behavior: 'wait' })`. No error-swallowing catch or `ignoreErrors` was added. The pre-existing Playwright configuration has zero retries and a 12-second expectation timeout, sufficient to observe the real eight-second deadline without replacing it with a test clock.

## Completed execution and proof limits

`browser-focused.log` records all four cases passing once in 50.6 seconds, including the P16 case in 15.4 seconds; its exit is 0 and results metadata has no failed tests. `web-check.log` records 131 passed, zero failed/skipped, and exit 0. `web-build.log` records successful TypeScript checking and Vite build, also exit 0. The source manifest matches those supplied repaired source hashes.

The new test releases its methodology gate before allowing conversation recovery to complete. It proves retention while parent/conversation verification is pending and focus after methodology refresh completes. It does **not** separately hold a newly initiated methodology refresh after parent recovery to prove whether retained content stays hidden throughout that additional interval. Nor does it introduce a held-inner-basis scenario spanning actor/session/scope replacement or revocation, or an independently identified stale response released after such withdrawal. Those owner guards are unchanged and were inspected, but this focused test should not be cited as execution of those distinct cases. Its released superseded read occurs under the same owner.

At this review's last log inspection, `browser-full.log` was still progressing through the 107-case suite and `browser-full.exit` did not exist. The preserved pre-P16 106-case pass cannot substitute for completion of that changed-frontend gate. No full P16 browser success is claimed.

This was a read-only review of source and receipts. I operated no test, service or database and edited no repository source; only this requested review artifact was written.
