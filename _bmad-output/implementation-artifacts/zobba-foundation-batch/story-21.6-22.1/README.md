# Stories 21.6 and 22.1 — reviewed local checkpoint

Baseline: `67a290173dea7212b600d00ec5bad3f5bd52a6c0`. Branch: `codex/zobba-foundation-batch`.

Story 21.6 supplies bounded evidence search and exact source inspection. Story 22.1 supplies native model transport, durable invocation history and current tool admission locally. It remains incomplete pending the separately approved live-provider qualification. Story 22.2 has not started. Nothing was merged or deployed; no live model, Graph or managed-computer service was called.

## Delivered behaviour

- Search current-engagement filenames and five attributed source fields using literal, context-independent Unicode lowercase matching. Queries are bounded to 200 UTF-8 bytes, pages to 50 matches and 256 examined candidates. An empty partial page offers continuation and never proves absence. Previously accepted FEFF values remain exact.
- Inspect immutable source identity, scope, version, digest and acquisition provenance; download verified original bytes separately from a bounded inert preview. Knowledge links open the actual original scope while retaining the destination conversation and Task. Revocation, replacement sessions, late responses, narrow layouts and return focus are exercised in Chromium.
- Use native OpenAI Responses and Anthropic Messages through owned portable contracts, bounded strict JSON/SSE decoding and explicit requested/actual model, tier, usage and completion facts. No automatic retry, redirect, provider-owned conversation or fallback.
- Preserve exact producing authority through recovery. Tool admission and claim consumption use the existing Permissions owner and current Task, knowledge, catalogue and qualification checks. Historical receipts remain facts; revoked context cannot support new disclosure. Repeated cumulative history verifies unique dependencies without multiplying shared ancestry.
- Add schema 11; retain all 20 published migration/catalogue files 1–10 unchanged. Admin configuration cannot qualify a provider or grant audit access. The default composition has no live-qualified model and starts no autonomous loop.

## Verification

| Final local gate | Result |
| --- | --- |
| Rust workspace | **371 passed**, zero failed; three parent-owned helpers ignored in default enumeration |
| Web checks and units | **183 passed** |
| Real Chromium browser suite | **159 passed**, zero failed, **zero retries** |
| Qualification runner guards | **6 passed**; no live calls |
| Python setup/smoke guards | **47 passed** |
| OIDC fixture checks | **56 passed** |
| Formatting, strict all-target Clippy, architecture boundaries, web build | Passed |
| API/worker process smoke | Passed, including database-loss readiness and same-process recovery |

 Gate receipts retain exact commands, start/end times, exits, log hashes and before/after source manifests. [source-reconciliation.json](source-reconciliation.json) identifies any final changes outside an earlier gate's inputs. Supplemental reruns are not added to unique full-suite totals. Three default-ignored Rust entries are parent-owned subprocess helpers, not unexecuted feature tests.

Local environment: Rust 1.98.1, Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4 and system Chromium. Real PostgreSQL and actual loopback HTTP/SSE/OIDC fixtures were used. Rust and browser suites used distinct guarded disposable databases and owned fixture ports. Protected development services and data were left untouched. This is local verification, not a remote GitHub Actions result.

## Independent review and repairs

Three fresh, context-free reviewers inspected the complete unstaged tracked/untracked diff. Root adjudicated the findings; implementers and root repaired them, and independent targeted rechecks accepted them. Reviewers did not independently rerun the suites. Root owns the execution receipts.

See [review-triage.md](review-triage.md) for 16 findings, including replacement-owner admission, cumulative-history verification, historical-only source withdrawal, cancellation usage custody, production transport policy, Unicode search, transfer continuity and exact cross-scope browser coverage. The immutable review snapshot hash identifies the initial review input; final source manifests and recheck records identify the repaired checkpoint.

Retained development failures include initial debug async-stack overflows, a random-ID candidate-count assumption, a test lease lapse, native usage-event assertion and browser response-capture/timing/viewport preconditions. A subsequent full Rust run encountered the existing four-second membership statement timeout; PostgreSQL logs confirm cancellation but do not identify the cause of delay. The unchanged focused target passed, and final database/browser verification was scheduled sequentially. The repairs preserve authority, custody and exact-byte assertions; no global stack/timeout increase or test retries hide a failure. The earlier full-rust-3 pass is superseded because two native source files changed during that run. See [the gate history](gates/README.md) for every retained invocation and result.

The five [safe screenshots](screenshots/README.md) come from passing source-library journeys in the final 159-case browser run. Root visually inspected each; exact originating paths and image hashes are retained. No sign-in captures, private fixture environment, raw browser traces or provider credentials are included.

## Limits and next dependency

- Search covers registered metadata only, with explicit bounded coverage; it does not extract meaning from document contents.
- Native reasoning effort currently supports None. The initial structured schema is restricted, including integer-only numeric values; unsupported capabilities fail before use. Catalogue tools bind exact prepared operations; variable arguments require a later trusted resolver.
- Local cancellation cannot prove provider non-execution or zero charge. Account labels require deliberate operator/key binding. No audit quality, customer-data residency, live model entitlement or production service level is qualified here.
- A successful synthetic qualification would validate adapter transport only. It does not install trusted production registration, qualify methodology or implement Story 22.2's autonomous task loop.
- The current build retains Vite's existing large-chunk warning; the production build succeeds.

To complete 22.1, review the separate [model qualification proposal](../MODEL-QUALIFICATION-PROPOSAL.md): existing workspace, designated nonproduction accounts, exact model/endpoints, six synthetic requests, Standard tiers, no external tool effects and proposed USD20 API-token usage before tax. Accounts, credentials, processing permission and spending approval remain outstanding. The us-east-1/USD300 hosting proposal remains unapproved.

Next is 22.2 after 22.1 qualification and its already accepted 21.4/20.4 producers. Keep early 23.1 real-computer qualification in sequence; present its exact environment, region and spend ceiling separately before incurring costs. Graph 21.5 also retains its independent credentials/permission gate.

## Review entry points

The specifications retain the frozen intent and add concern-led Suggested Review Orders:

- [Story 21.6 specification](../../spec-21-6-find-working-material-without-losing-provenance.md)
- [Story 22.1 specification](../../spec-22-1-route-native-models-through-a-current-tool-catalog.md)
- [Evidence acceptance map](evidence-acceptance-matrix.md) and [model acceptance map](model-acceptance-matrix.md)
- [Independent review and repairs](review-triage.md), [source reconciliation](source-reconciliation.json) and [published schema prefix](published-prefix.json)

The checkpoint manifest hashes changed source/configuration/specification files outside this evidence directory. The evidence manifest hashes packaged evidence separately and excludes itself to avoid a recursive digest. Git's commit identity supplies the final immutable checkpoint reference.

To verify packaged digests from any checkout location, run:

```sh
python3 _bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.6-22.1/verify_checkpoint.py
```

This read-only check validates files and gate-log hashes; it does not rerun suites or establish approval.
