# Operation future allocation repair

No global/test-thread stack setting was increased.

- operations-diagnostic-1 preserved a reproducible stack overflow after all six
  model scenarios completed, during the existing ordinary-operation scenarios.
- operations-diagnostic-2 measured the production model projection future at
  10,240 bytes and public operation `get` at 13,632 bytes. The measurement used
  type inference on a never-invoked future constructor, so it did not poll or
  manufacture an invalid transaction reference.
- operations-diagnostic-3 boxed only the production model projection seam. Public
  `get` decreased to 5,808 bytes. The suite progressed to the existing
  `task_reconciliation::verify` scenario, whose retained future was 46,128 bytes,
  and overflowed there.
- The production seam stays boxed so all ordinary operations do not inline the
  optional full model-context verification state. The aggregate integration test
  additionally boxes that identified reconciliation scenario. Its assertions and
  execution order are unchanged. Model scenarios are individually boxed phases.
- All diagnostic markers and measurement helpers were removed before
  operations-clean-1. That run also includes real replacement-owner invocation
  recovery rather than merely changing a synthetic owner field.

The root gate wrapper retains each invocation's command, source manifest pair,
raw log, log SHA-256 and outcome in /tmp/zobba-batch-21-6-22-1. This note does not
replace the final clean-run receipt or claim that an in-progress run passed.

Clean result: operations-clean-1 passed all 5 tests in 37.00s, exit 0, with unchanged source manifests and no diagnostic markers.

## Worker gateway follow-up

Full workspace run `full-rust-1` later exposed the same allocation pressure in
`owned_gateway_process_recovery_preserves_source_facts_and_fences_late_sends`.
A temporary standalone diagnostic used a lazy pool and never-invoked constructor
closures, with no database connection or application-future polling:

| Public operation future | Before | After |
| --- | ---: | ---: |
| admit | 15,608 bytes | 10,232 bytes |
| consume | 13,368 bytes | 7,376 bytes |

`gateway-size-before` and `gateway-size-after` retain the measured evidence.
The repair boxes exactly the new `check_proposal` boundary in admission and the
three `check_bound_operation` boundaries (final admission and both consumption
checks), retaining their transaction and ordering. No shallow SQL helper or
existing gateway scenario was changed. Diagnostic code was then removed;
`gateway_process.rs` has no diff from HEAD.

`gateway-clean-1` passed 3 tests in 10.39s with unchanged source and exit 0. One
helper is intentionally ignored in normal discovery but is explicitly launched
by the actual process-recovery test. No global/thread stack setting or assertion
was weakened. Cargo and guarded PostgreSQL slots were released to root afterward.
