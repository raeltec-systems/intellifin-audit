# Story 21.4 core repair execution closure

Review date: 2 October 2026. Repository: `/workspace/intellifin-audit`. Baseline: `d38e1daed736415ef13e7606345dac71bd1d9f01`.

**Backend closure supported for P1–P5 and P14/P15:** the independently inspected repaired implementation and regression sources match the full repaired Rust test run's start/end manifests, and both substantive knowledge test owners passed in that full run. No new concrete defect or source/evidence discrepancy was found. P4/P5 rendered action availability, other frontend findings, browser and smoke closure remain separately lead-owned and pending. This report does not close the complete story.

This is an independent reconciliation of existing source, manifests and executed receipts. This reviewer did not run tests/builds, touch services, read secrets or raw fixture environments, modify application files, or stage/commit. The earlier `core-repair-source-review.md` is unchanged; its SHA-256 at this review is `22a3b274c382fc5c37bc04a1723ff760fb6b316ea0e40b3500da22a665b6647e`.

## Full Rust execution evidence

The reviewer read the complete `/tmp/zobba-story-21-4/repair-rust-full.log` and its exit file, independently counted every Cargo result section, and recomputed artifact hashes.

- Exit: **0**.
- Results: **305 passed, 0 failed, 3 ignored, 0 measured, 0 filtered**, across **44 result sections**, all `ok`.
- Log: **35,642 bytes**, SHA-256 `a47a70818cf1e8c3ecda268bad8be744d8cda076cbbae637b0bdb8deb9c5baa8`.
- Exit file: 2 bytes, SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`.

The ignored entries are explicitly subprocess helpers: `composition::production_constructor_child`, `gateway_worker_helper`, and `reliability_worker_helper`. Their source declarations mark them ignored with parent-process explanations, and their respective parent source invokes them with `--ignored` and the exact helper name. They are not three omitted knowledge regressions. The complete log also reports their enclosing evidence/gateway/reliability parent tests passing. This report does not inflate the passed count by separately counting helper assertions or scenario functions.

| Full-run test owner | Reported result | Repair coverage reconciled to inspected source |
| --- | --- | --- |
| `postgres_knowledge_producers_retrieval_authority_and_mutation_contracts`, `crates/infrastructure/tests/knowledge.rs` | `ok`; its binary reports 3/3 passed in 154.11 seconds | The aggregate test directly invokes `reuse_qualifies_both_exact_task_consumers` and `dependency_periods_cannot_be_laundered` at lines 322–323. These exercise P1–P3, including both actual Task-ID orderings, independent source/destination consumers, fresh admission and exact authority replay, and transitive compatible/incompatible/unknown periods with historical disclosure distinguished from current eligibility. |
| `knowledge_http_producers_mutations_exact_recovery_and_authority_contract`, `crates/api/tests/knowledge_http.rs` | `ok`; its binary reports 3/3 passed in 3.67 seconds | The aggregate calls `http_foreign_origin_controls` and `http_verification_basis_and_applied_guide` at lines 593 and 604, plus owner-private preference capability checks. It supplies P4/P5 API capability/route proof and P14/P15 real-owner proof. |

Each binary's other two tests are shared database guard tests. The two substantive owners above remain **two aggregate tests**, even though their helper functions exercise many assertions and scenarios. The full-run timings supersede neither the earlier focused-run receipts nor their historical durations; this report records the new full invocation separately.

P14/P15 are implemented in the HTTP test file. The passing aggregate includes:

1. An actual HTTP Pause that changes the Task epoch while retaining the binding; a verification request with the old epoch and **current binding** refuses with `knowledge_conflict`; a fresh pair succeeds and the exact assertion view remains unchanged.
2. Actual HTTP Guide admission followed by Received inspection with the old binding still current, then the real `TaskRepository::coordinate` owner applying retained intent and pending context while the Task is paused.
3. A verification request with the **current epoch** and old binding refusing independently; the fresh pair returns `verified: true` and the unchanged assertion view still matches.
4. Exact Guide inspection showing Applied, retaining original record/author/scope/text/period/dependencies and command/Task/cycle identity, with exact admission replay and one matching applied event from the owner.

Thus the full run exercises both expected-basis guards independently, not merely source revocation or mocked HTTP conflicts. The previous source-review limitation still applies: no distinct executed scenario advances a previously admitted reuse's period and replays it; that specific replay branch was inspected directly. No additional test execution is inferred for it from the aggregate pass.

## Source-boundary reconciliation

All three manifests contain 245 file hashes and the same baseline:

| Manifest | Observation time (UTC) | SHA-256 |
| --- | --- | --- |
| `source-repair-rust-full-start.json` | 2026-10-02 20:08:43.816232 | `f8aa5eaa44852c58518ef6367732973af4406daf076130ebaeb3eaf90e2ef345` |
| `source-repair-five-final.json` | 2026-10-02 20:16:56.116503 | `c5d86042de59d433bdc67a36294842b692aa1f56aa348941aad671b7caed2d40` |
| `source-repair-rust-full-end.json` | 2026-10-02 20:21:52.219528 | `65b03a6a81d92f49e61326eeea64e847d4246caf965b04481bee29906a6ef276` |

An independent complete comparison of start versus end found exactly these five changed paths, with no additions/removals and no backend/schema change:

```text
zobba/web/src/InspectionPreference.tsx
zobba/web/src/KnowledgeSupport.tsx
zobba/web/src/knowledge.ts
zobba/web/tests/browser/knowledge.spec.ts
zobba/web/tests/knowledge.test.mjs
```

`source-repair-five-final.json` and the full-run end manifest have identical file maps. All twelve backend/schema/test files named in the earlier source-review manifest match **all three manifests and the current working files**:

```text
22eccc53230e94ec52a975220008767eb9a3c60718b50fcd082b68e2f1b2c720  zobba/crates/domain/src/knowledge.rs
0246345401e8c02fcdcee4f3ce37ae10d6968d5a5b4bcc1db8e32a8f940dbc9f  zobba/crates/domain/src/task.rs
c1853eea4fa80dd94782f89f8d3d03e1654bbfa224b41c97af7c791d7a23356c  zobba/crates/domain/src/identity.rs
9e00dcb7f4414c137b687f098a18e2876018817d98d135195fb55cd8fe3736c5  zobba/crates/application/src/knowledge.rs
a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de  zobba/crates/infrastructure/src/knowledge.rs
f7e997a6f3329d99c8e65919ad2ef616596a707a5f5b94a162800fd82dd29428  zobba/crates/infrastructure/src/scope.rs
09a320a97c1156f54046b726f5eb18a36edb391ce3d67a57d86da735c4f4ceee  zobba/crates/infrastructure/src/methodology.rs
6f81cc6f23b50141bbf80e00bceb35336dc237b08b944e63da9943e801f18219  zobba/crates/infrastructure/src/task.rs
243ba8519afadf46867aab40e98b8e7fa8cc3b66da25d2508f3fae400a8f3707  zobba/migrations/0010_knowledge.sql
9e19b5f6bac184590074232c3b87bad27cb4fe9a63a10cbec1e2b1850e56de34  zobba/crates/api/src/knowledge.rs
fdd351b616b9846974a45da49eace78ec00e57104388a416c46c9f50573b919a  zobba/crates/infrastructure/tests/knowledge.rs
4c766c712b99551293ea308e252e94c9bc1753ff0b2b3adef43d256870bbb0e3  zobba/crates/api/tests/knowledge_http.rs
```

These boundary manifests and unchanged hashes tie the prior semantic review to the recorded Rust invocation. They do not assert that the five frontend edits have passed browser/smoke verification.

## Published file integrity

The reviewer read `root-prefix-integrity.json` (4,038 bytes; SHA-256 `5ba96137e8f1d14f9d35b51379ffe4ecd1629c6503049e07b55f0c3468693c39`) and independently compared each of its eighteen published migration/catalogue paths with raw `git show` bytes from the stated baseline. All eighteen are byte-identical and match the recorded sizes and hashes.

The current suffix also matches that receipt and all three source manifests:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `zobba/migrations/0010_knowledge.sql` | 15,975 | `243ba8519afadf46867aab40e98b8e7fa8cc3b66da25d2508f3fae400a8f3707` |
| `zobba/crates/infrastructure/src/schema-v10.catalog` | 235,566 | `9ee195604f4e31403c6fc64a1f2d2506fc930f2c07d4dcd2474948c237dc3ab7` |

Literal carriage-return counts remain 0 for migration 0010 and 3 for schema-v10.catalog, matching the byte-preserving integrity receipt. This is **file-integrity evidence**, not a substitute for executed migration/catalogue/upgrade validation. The full Rust log separately records `bootstrap_contract ... ok`; no broader runtime or browser-upgrade claim is manufactured from the hash comparison.

The backend source review and its named full-run execution evidence are reconciled without a remaining core repair blocker. Root retains final story closure after the separately pending browser/smoke and other required gates.
