# Story 21.4 — final coverage handoff preflight

**No new unclaimed or unmapped canonical Story 21.4 requirement was found.** All three canonical acceptance criteria and all ten frozen matrix rows have concrete evidence mappings. The already completed backend, focused browser, harness and public-upgrade closures are supported by the independent reports. **Complete story acceptance is still blocked: the combined 145-case browser invocation completed with 142 passes and 3 failures, so diagnosis and a passing final full rerun remain required, followed by final source/evidence reconciliation.** This preflight does not close that gate.

Review date: 2026-10-02. Baseline: `d38e1daed736415ef13e7606345dac71bd1d9f01`. This is read-only documentation/evidence reconciliation, not another test execution or a fresh full implementation audit. No application edits, builds, tests, services, private reporters, traces or credentials were accessed. Only this report was authored.

I compared canonical `epics.md:427–449`, the frozen Story 21.4 specification and its accepted context, current `verification-map.md`, `repair-closure.md`, `consumer-contract.md`, and all four independent execution-closure reports. I also checked the current source of the mapped narrow-screen journey to distinguish executed viewport assertions from final visual review.

## Handoff reconciliation findings — corrected during review

### C1 — combined-run status now retains the known failures

The initial inspected handoff documents correctly withheld complete acceptance, but their live status was inconsistent:

- `verification-map.md:3,21,67` and `repair-closure.md:3,34` only describe the 145-case run as running/pending.
- The concurrently updated `consumer-contract.md:3,89` records **two** known failures, cases 82 and 94.
- Root's current review instruction reports **three** failures under lead investigation. I did not inspect the private reporter or independently diagnose those failures.

**Resolved in the final reread:** all three current handoff documents now consistently record completed BF1 as **142 passed / 3 failed of 145, exit 1**, preserve the failed invocation, describe the limited known failure observations without inventing root causes, and require diagnosis plus a passing final full rerun. The final handoff refers to a safe completed receipt and unchanged source map. This preflight read the updated documentation; it did not independently diagnose the three failures or inspect private runtime artifacts. There is no remaining documentation-status correction from C1. The underlying combined runtime gate remains open.

### C2 — the completed independent execution closures are now indexed

The initial `repair-closure.md:34` named the source reports and said only `core-repair-execution-closure.md` additionally reconciled completed receipts; the initial verification map similarly emphasized the core execution closure. The following completed independent execution reports also exist and were read:

| Independent report | Bounded closure it supplies |
| --- | --- |
| `review/core-repair-execution-closure.md` | P1–P5/P14/P15 backend source → repaired full Rust receipts, plus immutable prefix integrity. |
| `review/ui-focused-execution-closure.md` | P4–P11/P16 rendered/interaction source → passing B2 18/18, including the five runtime follow-ups and safe source-refusal/wire artifacts. |
| `review/harness-repair-execution-closure.md` | H1–H4 source and safe chronology → HF3 5/5; retains HF1/HF2 failures and unknown cause limits. |
| `review/ports-repair-execution-closure.md` | P12 contracts/parser and P13 actual public excerpt/legacy recovery → passing logs, unchanged manifests, source bytes and pinned baseline binaries. |

**Resolved in the final reread:** `verification-map.md:57`, `repair-closure.md:40` and `consumer-contract.md:98` now name all four execution-evidence supplements and distinguish their bounded receipt/source reconciliation from reviewer execution and a green full-browser result. They also explain the dated pending statements in earlier reports. There is no remaining C2 index correction; the original independent reports appropriately retain their historical checkpoints.

### Known stale consumer H2/legacy status — resolved during this review

The initial `consumer-contract.md` read still marked historical public recovery and H2 pending. The final inspected version corrects those claims at lines 3, 57, 81 and 89: HF3 and U are passed while full Chromium acceptance remains pending after failed BF1. This is the already reported duplicate item, recorded once here as resolved; no second repair request is raised. The current consumer snapshot is pinned below.

## Acceptance coverage reconciliation

Canonical AC1 (later-Task context retains source, attribution, scope and status) is mapped through Direction, Acquisition, Retrieval and Promotion, including original Task/cycle standing and the independent viewer/accountable-actor checks. AC2 (actual harmless inference with inspect/Undo) is mapped through Preference and Forget/Undo, including distinct openings and consumed observations. AC3 (correction/revocation invalidates stale support and excludes inaccessible material) is mapped through Correction, Revocation and Retry/races, including actual evidence and Guide source refusal. No canonical AC is represented solely by an enum, manual editor, enabled button, or invented model-consumption claim.

The following distinction remains important: the table records completed bounded acceptance evidence, not full story completion.

| Frozen matrix row | Already executed evidence represented in the handoff | Remaining final gate |
| --- | --- | --- |
| Direction | PG exact producer/retry/history phases; HTTP real Received → coordinator-owned Applied transition with unchanged original command/Task/cycle/text and independent epoch/binding guards; B2 automatic Guide/source-navigation case. | Combined browser/source reconciliation; no unsupported claim of a separate browser Applied transition. |
| Acquisition | R automatic verified capture/asserted fields/unsupported omission/UTF-8 and post-I/O tests; B2 actual public nonzero range, held GET beyond 12s, invalid boundary, exact retry and unchanged original; U actual schema9 acquisition → migration/API restart → current UI missing-capture recovery → restart/replay. | Combined default browser gate; U remains a separate completed invocation. |
| Preference | PG/domain/HTTP actual learner, distinct openings, delayed-observation fences and consumed Undo horizon; B2 learning/application/inspect/Undo, positive typed release, uncertain local layout and retained outcomes. | Combined browser gate. |
| Retrieval | PG current source/consumer/applicability before disclosure, bounded pages/scan, exact lookup, transitive periods and queued authority refresh; P12 parser/OpenAPI and P14 independent real expected-basis refusal; B2 exact/held-success handling. | Combined browser/source reconciliation. |
| Correction | PG bounded transitive invalidation/cycles/concurrency and preserved originals; HTTP capability/routes; B2 assertion/source correction and actual add/remove/replace exact claimed references; P7 unsupported-original entry. | Combined browser gate. |
| Promotion | PG/HTTP positive same-client exact named-Task reuse and typed preference release, separate viewer/source/destination consumers and both Task lock orders, different-client/authority denials; B2 positive destination retrieval and foreign capability controls. | Combined browser gate; no broader firm/client writer is required or claimed. |
| Revocation | PG/HTTP source/session/post-I/O/queued/current-consumer fences; B2 both actual evidence and Guide source 403 cases withdraw parent text/provenance/draft, preserve unrelated authorized destination recovery and reject stale resurrection. | Combined browser gate and disposition of its failures. |
| Forget / Undo | PG replay/recapture cannot restore exclusions, 50-publication capacity retains retry/withdraw/Undo; HTTP private Undo; B2 Forget and multiple-destination Undo with exact lost-reply recovery/current-owner outcome gating. | Combined browser gate; individual withdrawal outcome uses the reviewed shared path, not an invented separate browser journey. |
| Draft interruption | W custody tests; M prior focused 4/4 plus single-component old-behavior negative/restoration; B2 actual session outage and uncertain navigation/denial/replacement cases; HF3 current authorization/focus/denial harness cases. | Required combined repetition, including methodology custody. M is a focused Story21.2 batch repair, not newly claimed Story21.4 knowledge semantics. |
| Retry / races | HTTP real lost committed reply, exact/changed-meaning outcomes; PG concurrent correction, source/session fences, bounded envelopes and continuing Guide/Pause/Stop controls; B2 exact retained navigation retry through 429 and no automatic submission/competing observation; HF3 unchanged bound/unbound recovery budget. | Combined browser gate, final current-source reconciliation and root closure. |

The map also covers the specification's cross-cutting verification commitments: fmt/strict Clippy/build, Rust/web/fixture/Python/boundary checks, process smoke, immutable 18-file migration/catalogue prefix, populated upgrade, storage/RLS guards, actual envelope byte bounds, legacy-capture honesty and independent review. Their mapping does not require treating every scenario helper as another counted test.

Narrow navigation is not an unclaimed gap: the B2 case at `knowledge.spec.ts:171` actually executes a 390×844 viewport, requires the exact source preview fully visible, at least 240px of reading area, Pause/Stop and engagement navigation in the viewport, and no horizontal overflow; it writes a screenshot/geometry artifact. The UI execution closure identifies that passing case. Final visual/artifact inspection remains explicitly pending in `verification-map.md:75`; this preflight did not inspect screenshots and must not close that separate review step.

## Consumer-contract consistency and bounded limits

No contradictory product authority or changed acceptance contract was found. The handoff consistently preserves attributed assertions versus source-state observations versus Guide direction; current source/session access; exact source/version/byte provenance; owner-private typed preferences and narrowly explicit release; same-client named-Task reuse without lending consumer access; immutable originals/history; existing Task/method/skill owners; and current revalidation before use. It does not claim a model consumed the assembled context.

The following are accurately declared scope/coverage limits, not newly missing story requirements:

- The accepted 1,024-candidate scan can be partial, exact lookup needs a known reference, and empty retrieval is not absence. No opaque continuation/global discovery expansion is needed for this story.
- A distinct period-change-after-admitted-reuse replay scenario has source inspection rather than a separate executed case; the docs retain that limitation while the transitive applicability and authority-replay owners have executed coverage.
- The focused multi-destination browser outcome journey tests Undo; individual withdrawal shares the inspected outcome implementation and has backend coverage.
- Legacy public recovery proves an API restart with the same object fixture, not a worker restart or external-provider qualification. Historical timestamps/uncaptured sources are not fabricated by bulk backfill.
- The response-envelope proofs and compact durable receipt bounds are distinct from simultaneous maximum-field admission. No global response cap was enlarged.
- Chromium geometry/lifecycle proof does not qualify native OS tab behavior, a new non-C database locale, model inference/consumption, deployment, paid-provider behavior or customer data.

The final consumer opening also now cites the latest `repair-web-check-6`, consistent with the verification map/closure and final H2 test-source checkpoint. Its earlier valid `repair-web-check-3` reference was updated during this same handoff reconciliation.

## Final reconciliation prerequisites

Before marking Story21.4 complete: retain/dispose the current failed combined invocation, complete the authorized repairs and required passing combined gate, reconcile its final before/after source map with R/W/S/B2/HF3/U and the independent closure scopes, complete the declared visual/artifact review, and update the handoff indices/status consistently. Existing passing focused evidence remains valid for its recorded bytes and scope; it cannot erase a later combined failure. Root owns the final decision and publication. No new user authority/product decision is exposed by this preflight.

## Inspected documentation hashes

The three handoff documents changed during review to fix the status/index findings above; their hashes below are the final versions actually reread. Paths prefixed `_bmad-output/` are repository-relative; other paths are under `/tmp/zobba-story-21-4/`.

```text
fb6ccca0e5a41adb5415ace4b053817a2cec7dcbc55e5cd3640a25ff25240d13  _bmad-output/planning-artifacts/epics.md
01361676b3fe9a9fe99073a95b20438e02494415a8c83aad56ad7d2f29ff8d86  _bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md
0a69af8fa6b67774a9b693671792205d1d21765d58bfd3ebc03ba7f3a68aaac9  _bmad-output/implementation-artifacts/story-21-4-knowledge-context.md
9bd171c107351aa00194ae4af5beea7d396f2d467c2d63dce31f1d74c3159455  verification-map.md
66116d00a6ff824e85154eefb923ea4bb3ef98ac036d5dca442212cd970ba25a  repair-closure.md
a3ff898f62c3a620b7d5026327e70c2ab36b125001ba69c033b3bd371b94df00  consumer-contract.md
305b2e0211bc59db344b02280fd2aa4ef66bf691909c532d29a1f84f8aa27d02  review/core-repair-execution-closure.md
adb7331313a1f5b4c15d279e47992a6d504e49415f547eaa856f4cf870356f4f  review/ui-focused-execution-closure.md
cf8d604df1f3f31045a0e8d21f6faf88b0ab440251281dfe371a0b369ca33abe  review/harness-repair-execution-closure.md
e89eac5a2026a35018520d8fc2c4a8e0f77164d8ec014f6598d2fd4e819f386c  review/ports-repair-execution-closure.md
```
