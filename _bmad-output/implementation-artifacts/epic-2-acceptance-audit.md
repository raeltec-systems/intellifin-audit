# Epic 2 — completion evidence audit

Scope: the eight stories in `planning-artifacts/epics.md`, their frozen implementation specifications, the build contract and architecture invariants. Checked 5 September 2026. **All implementation, local verification, review and implementation-CI requirements are complete.**

| Requirement group | Evidence surface to execute and inspect |
|---|---|
| 2.1: all four Templates, defaults, golden references, Draft creation/isolation, names and empty/populated surfaces | Domain Template tests, `procedure-templates.test.ts`, persisted Procedure integration, and `procedures.spec.ts` creation loop for every Template, differing pre-fills, rename/refusal and accessibility checks. |
| 2.2: explicit period/scope, structured inclusion, declared-count and upload/frequency blockers, zero-record and duplicate flags | Population domain/command/storage tests; actual Builder period/binding edits and persisted blocker browser journey; later approval snapshot tests protect the authored binding. |
| 2.3: frozen Target contracts, hero web+desktop, verbatim instructions and scope warnings | Target domain tests, transactional Procedure integration, actual Target/Instruction authoring browser journey, and complete P-1 review journey with both Target kinds. |
| 2.4: compiled/Agent-Judged conditions, applicability, compiler identity, exact numeric boundaries/tolerance and confidence | Compiler and executable-plan contract tests; persisted condition integration; browser condition/boundary authoring; approval freezes the resulting contract. Evaluation during a Run remains later-epic work. |
| 2.5: grounding, mandatory capture metadata, model-read declarations, UTC frequencies/period rules, upload compatibility | Evidence/Schedule domain and integration tests, prior 96 upgrade combinations, actual Evidence/Schedule browser edits, target capture normalization and concurrency/unknown-outcome checks. |
| 2.6: queued derivation, visible read-only plan, provenance, failures/retries/recovery, frozen bytes and blockers | Executable-plan and both SDK conformance tests; PostgreSQL queue/recovery tests; preview SSR/browser checks; actual installed worker plus synthetic provider HTTP in P-1 author/derive/review journey. |
| 2.7: submission guard, independent approval, previous/current diff, rationale/Edit, atomic notifications and conflicting decisions | Unit/integration decision and notification suites, review rendering tests, actual P-1 reject/edit/resubmit/approve browser journey and self-approval refusal. Story 2.7 CI run 51 passed. |
| 2.8: immutable definitions, first/unchanged activation, pending regression, lineage/boundaries, same-transaction automatic Drafts, replay, human New version and ripple warnings | `review-2-8-matrix.md`, 17 focused lifecycle integration scenarios, actual Target/Source warning forms, lifecycle/browser history/response-loss journey, operational model publication through queued derivation and submission, and raw-SQL frozen-column refusals. |
| Authority and cross-module invariants | Transaction role revocation proof; affected-version corruption isolation; concurrency/rollback tests; full typecheck and dependency boundaries. |
| Delivery obligations | Every story committed/pushed only after verification; no push to main; readable HTML and Markdown reports linked from PR; reusable decisions in CLAUDE.md. Story 2.8 implementation commit `b432741` was pushed with a clean worktree and passed CI run 52. |

## Explicit scope resolutions

- Owner selected handover at actual activation, including after regression passes; pending regression has no speculative date. This is recorded in the architecture, story and shared decision log.
- Run execution, Regression Run execution and scheduler handover are later epics. UI preserves saved Schedule/lifecycle facts and explains that execution is unavailable; it does not invent next-run times or running jobs.
- Platform model publication is explicit. This compiler supports prompt 1 and executable-plan-v1 only, and refuses unsupported prompt/tool publications. Credentials remain external; a worker must honor a version's frozen supported model or fail clearly.
- SQL immutability means ordinary updates cannot change reviewed definitions; privileged removal of database protection is not an enforceable application guarantee.
- Story 2.5's earlier editor-concurrency audit is resolved by the completed authoring/response-loss repairs, as recorded in its specification. Its original deferred entry remains historical evidence, not outstanding work.
- Provider HTTP verification is synthetic. It proves application/SDK wiring and semantic contract enforcement, not live credential acceptance or model quality.

## Current evidence

All eight specifications and the epic's sprint status are done. After all twelve independently cleared Story 2.8 repairs, final full checks passed 1,950 unit, 209 integration and 96 browser tests. Typecheck, boundaries (307 modules), generation-14 migration/no drift, package and production builds passed. The HTML/Markdown reports record the behavior, evidence, decisions and remaining deployment action. Implementation commit `b432741fc3498239ee0cbd0c4036b9ccb821db51` was pushed and all four jobs in [CI run 52](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33956593754) passed. Subsequent changes finalize this evidence report only.
