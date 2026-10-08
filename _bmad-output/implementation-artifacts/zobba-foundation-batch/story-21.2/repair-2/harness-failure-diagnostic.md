# Bounded browser harness follow-up

The first P16 full run finished 105 passed / 2 failed (12.0m, exit 1) on unchanged source. P16 and all seven methodology cases passed. Full raw log and error contexts remain private because a Playwright route-fetch error includes synthetic fixture session headers. No raw header values are included here.

## Access refresh case

The final assertion expected zero Task details after a conversation fault was installed and Latest was clicked, but observed one. All preceding access hiding, mounted control/methodology, disclosure and focus assertions passed. The original test did not record whether a fault handler ran, a request failed, or that failure belonged to the current read. The screenshot is taken after finally removes fault routes, so it may show recovery and cannot establish the assertion-time state. Installed Playwright glob semantics do cover descendants for the original trailing doubled star; a glob mismatch is not an established explanation. The original cause remains unresolved from retained evidence alone.

The bounded test instrumentation observes exact same-origin conversation snapshot/events paths, actual completed aborts, requestfailed events, and protected node counts while the fault remains installed. It requires a delivered snapshot fault before preserving the original withdrawal assertions. No response success is fabricated and no assertion is weakened.

## Download replacement case

The recorded error is `route.fetch: Test ended` in evidence.spec.ts line198, the preceding metadata-case registry handler, not the current download handler or Blob-count assertion. The prior handler fetched real registry responses and its finally released its gate without waiting for all callbacks. This establishes cross-case outstanding callback contamination, not a demonstrated Blob disclosure. The bounded repair releases and drains both metadata/download paths with `unrouteAll({ behavior: 'wait' })`; it removes their existing swallowed fulfill errors. All metadata, draft-custody, actor/scope, and zero-Blob assertions remain.

## Observed diagnostic outcomes

The first instrumented focused run passed all six metadata/download actor variants, but the access test failed before its withdrawal assertion: its installed fault handler observed zero requests for 12 seconds. This confirms that run never delivered the intended fault; it does not distinguish absent application request from interception timing.

A bounded second diagnostic added a page request observer and a native click marker. It passed with one observed Latest click, a real snapshot request at805ms, abort delivered808ms, requestfailed817ms (`net::ERR_CONNECTION_RESET`), and all three protected node counts zero before cleanup. Exact data is retained in `conversation-access-fault-diagnostic-pass.json`. These observations prove the intended current-run failure/withdrawal interaction. They do not conclusively explain the earlier intermittent no-fault phase, and no production repair is claimed for that unexplained phase.

Final focused follow-up: all seven affected access/metadata/download cases passed without retry (50.1s). The final access diagnostic again records the native click, real snapshot request and completed failure, with all three protected-node counts zero before cleanup. Diagnostic collection has a nested finally so listener removal, gate release and draining always occur even if attachment collection fails. Original failures and the earlier no-fault diagnostic remain retained; the original no-fault cause is still not claimed resolved.
