# Story 21.1 implementation evidence

**1 October 2026 (Africa/Lusaka) — implementation complete; ready for owner review.**

Baseline: Story 20.6, `e28a4ccb551cb8e37131b64b4cdb20bc479c270e`.
Contract: [immutable evidence specification](spec-21-1-immutable-evidence.md)
and [integration contract](story-21-1-integration-contract.md).
No merge, deployment, live connector, customer data or cloud spending occurred.

## Delivered behavior

The engagement conversation now has an Evidence workspace beside its continuing
Tasks. A scoped user can reserve an original, upload it, inspect attributable
provenance and read a bounded inert text preview or download the verified bytes.
Source system, account, version, selection and coverage remain user assertions;
unknown values stay unknown. The independently verified storage version, SHA-256,
size and acquisition time are separate facts. Byte identity does not establish
truth, completeness, sufficiency or an audit conclusion.

The Rust backend owns immutable reservation identity, conditional object creation,
independent version-pinned read-back and atomic registration. Lost acknowledgements
reconcile the same reservation and object. Changed meaning, partial bytes,
corruption, missing versions and namespace changes cannot overwrite or substitute
an original. Exact session and current composite scope are checked again after
lock waits and object I/O. No transaction holds authority locks over object I/O.

Browser recovery retains the exact request across same-session reload and asks
for the identical file. Pending source details and expected identity are inspectable
before completion. Account or exact-session replacement discards private drafts
and withholds completed stale responses, including downloads before Blob creation.
Temporary authority uncertainty hides private content while preserving a retry
bound to the same session. Accepted registration remains certain if only the
following list refresh fails.

Registered originals and owner-only incomplete reservations have separate bounded
pages, Previous/First controls and stable cursors across routine refresh. An empty
later recovery page retains its navigation when another tab completes its last
item. Explicit inspection moves focus to the evidence and restores the list opener;
ordinary refresh preserves focus. Task selection, guidance and the coordinating
conversation remain available. Evidence remains distinct from work products.

Two shared I/O permits are acquired before body collection. Originals are capped
at 10 MiB, complete transfers at 120 seconds and individual storage requests at
20 seconds. Ordinary metadata keeps its 15-second deadline. A transient busy lane
is distinct from the durable quota of 100 incomplete acquisitions per actor/scope.
Completing one pending acquisition frees one place. Schema 6 preserves all ten
published migration/catalogue files for versions 1–5 byte-for-byte.

## Verification

| Final gate | Result | Output |
| --- | --- | --- |
| Locked Rust workspace, restricted PostgreSQL and actual protocol/process tests | 172 passed; 0 failed | [Rust](zobba-foundation-batch/story-21.1/rust-workspace.txt) |
| Actual Chromium, HTTPS OIDC, Rust API/worker, PostgreSQL and S3 fixture | 95 passed; 0 failed/retried | [Browser](zobba-foundation-batch/story-21.1/browser-full.txt) |
| Web types, generated contract parity and units | 100 passed | [Web](zobba-foundation-batch/story-21.1/web-check.txt) |
| Independent identity fixture | 54 passed | [Fixture](zobba-foundation-batch/story-21.1/identity-fixture.txt) |
| Disposable database/endpoint guards | 47 passed | [Guards](zobba-foundation-batch/story-21.1/python-guards.txt) |
| Startup refusal, repeated migration, dependency loss and same-process recovery | Passed; bootstrap 3/3 | [Smoke](zobba-foundation-batch/story-21.1/process-smoke.txt) |
| Real non-C PostgreSQL ordering and 100/101 quota boundary | 3/3 passed | [Non-C proof](zobba-foundation-batch/story-21.1/non-c-metadata.txt) |
| Frozen install, formatting, warnings-as-errors Clippy, builds and boundaries | Passed | [Commands and results](zobba-foundation-batch/story-21.1/results.json) |

The Rust total includes two compile-fail documentation tests. Three ignored
discovery entries are subprocess helpers explicitly invoked and checked by their
passing parent tests, including all four production-router configurations.
All 180 source/configuration files match the
[final manifest](zobba-foundation-batch/SOURCE-MANIFEST-21.1.json). All ten published
migration/catalogue prefixes remain byte-identical to the baseline. Final Rust,
smoke, formatting and Clippy have successful exit receipts. Browser evidence has
the separately qualified completion record described below.

The [named acceptance proofs](zobba-foundation-batch/story-21.1/acceptance-test-map.md)
map the story to actual assertions. Root inspected the refreshed
[desktop conversation/evidence view](story-21-1-evidence/evidence-overview-desktop.png),
[preview](story-21-1-evidence/evidence-desktop.png),
[390-pixel provenance](story-21-1-evidence/evidence-top-narrow.png) and
[download-only state](story-21-1-evidence/evidence-narrow.png).
Text, hashes and controls remain readable without apparent horizontal overflow;
the browser also asserts width and keyboard focus behavior.
[Capture facts](story-21-1-evidence/captures.json) record dimensions, times and hashes.

## Review and intermediate failures

Three independent reviewers examined the full tracked and untracked change under
the installed `bmad-build` workflow. Their findings produced ordinary repairs to
destination binding, byte-ordered pagination, recovery bounds, validation,
capacity feedback, inspection/navigation, filenames and generated binary schemas.
Additional proofs cover actual production-router configuration, complete timeout
middleware composition, non-C PostgreSQL ordering, the 100/101 quota boundary and
the rendered measured provenance values. The accepted intent did not change.

The first repaired combined Rust run received a 503 in an existing membership HTTP
scenario. Its exact standalone rerun and final combined run passed without a
membership source change; the transient cause was not established and no fix is
claimed for that event. A diagnostic attempt without the required
OIDC environment was a setup error. The initial focused paging test also compared
different whitespace representations across sibling elements; it was corrected
to compare the filename span, without weakening application behavior. Historical
failure logs remain separate from final acceptance evidence.

A later combined run exposed an existing test setup race: a real 100 ms worker
child completed before the test's `/proc` observer found it. The executor returned
the legitimate `Completed` result; the test failed before reaching its responsiveness
assertion. The test now uses a 500 ms child and a single one-second bound for both
observation and completion, below the actual two-second authority timeout. It
retains the requested-authority, Completed and exact-child join assertions and
adds a monotonic elapsed check. Its 12-case isolated suite, independent review and
final combined execution pass. During diagnosis,
linking also exhausted the workspace disk. Only the reproducible Zobba Rust
incremental cache was removed, restoring 12 GiB of free space; source, built
binaries and evidence were preserved. This environment failure is not a passing
or failing application test.

The complete Chromium runner reports **95 passed**, with a persisted passed
result and no failed tests, followed by normal fixture cleanup. Its original tool
session was lost during the disk-related exec transport interruption, so a
recovered shell exit code is not asserted. The final Rust and smoke wrappers
add separate exit-status receipts. This distinction is retained in the evidence.

[Independent review](zobba-foundation-batch/REVIEW-21.1.md) retains the original
findings, repair instructions, three repair rechecks and the targeted worker-test
review. Initial findings and later source hashes are preserved rather than
retrospectively rewritten. Guarded test services were cleaned up; the
temporary non-C database was removed and development IdP 9443 preserved.

## Limits and next dependency

- Local signed S3 protocol traffic qualifies owned request, retry, read-back and
  refusal behavior. It does not qualify live AWS IAM/KMS, bucket versioning,
  retention, deployed certificate trust or a connector. Missing storage is shown
  explicitly; configured storage does not imply a successful live service probe.
- Preview supports only bounded plain UTF-8 text (64 KiB / 100 lines). Markup and
  binary formats are download-only; no document parser executes in this story.
- Incomplete reservations have no abandonment, deletion or expiry workflow.
  The finite quota and completion-based recovery are disclosed in the UI and setup
  documentation. Discarding a browser draft does not delete durable custody.
- Verification uses local PostgreSQL, HTTPS OIDC, actual Rust processes and
  Chromium. A branch push does not trigger hosted CI. No production deployment
  or real-computer qualification is claimed.

The next recommended batch is [21.2 → 21.3 and 21.4](zobba-foundation-batch/NEXT-BATCH-AFTER-21.1.md).
Keep early Story 23.1 qualification in sequence under the separate
[unapproved environment and spend proposal](zobba-foundation-batch/QUALIFICATION-PROPOSAL.md).
