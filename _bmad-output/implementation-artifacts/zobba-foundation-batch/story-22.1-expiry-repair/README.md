# Story 22.1 — final dispatch expiry repair

Baseline: `6aaca7aab3463fb00e4f411e9b488eef5b2fa290`. Branch: `codex/zobba-foundation-batch`.

Final model/history validation completes before the final fresh lease and Permissions checks. Deferred dispatch writes are flushed first. Policy/material/decision reads also finish before the final database fence, which refreshes accumulated source access, the lease and permission time. A refusal rolls back staged dispatch records before the gateway receives a dispatch capability.

## Deterministic evidence

Three separate regressions exercise the real PostgreSQL repository and owned loopback Gateway. A handshake pauses the second, post-staging model qualification check. Database time proves all authority was valid at validation entry and only the selected component expired before release. A test-only deferred marker proves all dispatch records and a changed wakeup were staged before the pause. Each case returns its exact authority error below the unchanged two-second gateway timeout.

| Expiry | Refusal | Dispatch elapsed | Controlled delay | Connections / sends / committed dispatch rows |
| --- | --- | ---: | ---: | --- |
| Lease during validation | `Fenced` | 967.21 ms | 854.37 ms | 0 / 0 / 0 |
| Request during validation | `Denied` | 989.74 ms | 852.32 ms | 0 / 0 / 0 |
| Required exact approval during validation | `NeedsDecision` | 982.68 ms | 857.38 ms | 0 / 0 / 0 |
| Foreign source assignment during later policy reads | `Denied` | 1,004.10 ms | 468.98 ms | 0 / 0 / 0 |

The fourth regression addresses an independent-review finding: moving model/history validation earlier could leave another engagement's source assignment stale during subsequent policy reads. It binds real knowledge assertions across two engagements, gates the later policy read after staging and source validation, proves the source alone expires while blocked, then checks refusal. Both the staged dispatch tables and the changed wakeup roll back; historical invocation, admission, approval and knowledge facts remain identical.

The complete gateway target passed **7 tests**, with one parent-owned helper entry ignored in default enumeration and exercised by the process test. The operations target passed **5 tests**, including existing model/history, exact authority, recovery and deferred-write expiry contracts. Formatting, architecture boundaries and strict workspace/all-target Clippy passed. All five final gates used identical `zobba/` source, unchanged during each invocation. See [executed gates](gates/README.md), [measured results](expiry-results.json) and [source reconciliation](source-reconciliation.json).

## Negative controls and retained failures

The three requested tests all fail against the baseline production file: lease and approval return `Ok(Completed)` instead of their refusal; request expiry returns `Ok(Unknown)` rather than `Denied`. A separate negative control retains the validation reorder but removes the final source/time fence: the foreign-source case returns `Ok(Completed)` instead of `Denied`. These controls keep the final tests unchanged and restore repaired production code unconditionally afterward. Final source manifests reconcile both temporary variants with the tested repair.

Earlier invocations are retained with explicit labels. The first fixture run stalled asynchronous progress in a synchronous Condvar gate and panicked during poisoned-lock cleanup. The repaired test uses `block_in_place`, drops its guard before asserting and safely releases on cleanup. An earlier negative control caught request/approval dispatch but failed lease fixture preparation. Moving the selected test deadline from database time +3 to +4 seconds added setup allowance within the existing five-second owner lease. Dispatch still starts approximately one second before expiry; no gateway, SQL or production lease timeout increased. Earlier passes predate final review repairs and are not the checkpoint proof.

Receipts retain exact commands, exits, source manifests, log hashes and duration. Guard-test panic text in the passing `--nocapture` log is expected and caught. This is local verification; no remote CI execution is claimed. To repeat the checks, configure the guarded disposable Rust test database described in `zobba/README.md`, then run the commands recorded in the five final receipts from `zobba/`.

## Independent review and boundaries

Independent implementation, adversarial, edge and verification reviews are recorded in the [review ledger](review.md). Both production rechecks found no blocking findings. The final test review confirmed the separate expiry boundaries, exact below-timeout refusals, rollback and raw connection checks; the recorded execution evidence was reconciled separately.

No schema, frontend, provider transport or production timeout changed. All twenty-two published migration/catalogue files remain byte-identical to the baseline. No live provider call, Graph access, hosting, merge or deployment occurred. Story 22.1 remains in progress for its separately approved live qualification; 22.2 remains queued. Earlier full-suite/browser results belong to the baseline and are not relabelled as reruns of this repair. The final authority sample is a pre-commit check, not an indefinite grant after that point.

## Review entry points

- [Repair specification](../../spec-22-1-final-dispatch-expiry-repair.md)
- [Canonical Story 22.1 specification](../../spec-22-1-route-native-models-through-a-current-tool-catalog.md)
- [Reviewed final source diff](review-final.diff), [initial review diff](review-initial.diff), [schema integrity](published-schema-prefix.json)

Run the packaged read-only digest check from the repository root:

```sh
python3 _bmad-output/implementation-artifacts/zobba-foundation-batch/story-22.1-expiry-repair/verify_checkpoint.py
```

It verifies source/evidence and gate-log hashes; it does not rerun tests or establish live qualification.
