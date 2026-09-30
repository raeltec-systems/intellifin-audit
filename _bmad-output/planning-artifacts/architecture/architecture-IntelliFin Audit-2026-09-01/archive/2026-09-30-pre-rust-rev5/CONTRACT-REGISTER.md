---
name: 'Zobba contract register'
type: architecture-companion
companion_of: 'ARCHITECTURE-SPINE.md (revision 5)'
status: final
created: 2026-09-25
updated: 2026-09-25
sources:
  - '../../course-correction-2026-09-24/proposal-3d-architecture-spine-revision-and-contracts.md (§6)'
  - '../../course-correction-2026-09-24/proposal-4b-zobba-design-reconciliation.md (§6, §7)'
  - 'docs/contracts/ on main c18ad36'
---

# Contract register — Zobba (revision 5 companion)

This register is the planning-time inventory of the durable contracts under `docs/contracts/`, as approved in Proposal 3d §6 and amended by Proposal 4b §6 and §7. The file of each NEW or EXTENDED contract is authored by the implementation story that establishes it (Proposal 5 names the story; the column below holds a `[Proposal 5]` placeholder until it does); until then, the row here is that contract's specification home, read together with the AD it traces to in `ARCHITECTURE-SPINE.md`. HOLDS, SUPERSEDED and RETIRED rows describe files and paths that already exist and are not edited by this revision. A companion test that reads `docs/contracts/` and this table, and fails on a contract present in one and not the other, is an **implementation obligation**; no such test exists yet, and this document authorises no implementation.

Legend: **NEW**; **EXTENDED** (a new schema version; the old one stays readable — a row "EXTENDED → x" is the existing file that `x` extends); **HOLDS**; **SUPERSEDED** (kept for the compiler-1 path, not used by the task path); **RETIRED** (write side; read side retained per D-3d-4). "(amended by 4b §6/§7)" marks content Proposal 4b added to a row approved in 3d.

## Contracts

| Contract | Status | Owner module | Content | Trace | Establishing story |
|---|---|---|---|---|---|
| `tenancy-v1` | NEW | tenancy | classification table, roles, policy inventory, ownership-immutability trigger, draft-binding function hardening, principal wrapper, delegations, service principals and column privileges, migration plan, ownership binding, residual threat. (amended by 4b §6/§7) Three tenant role groups — Auditor, Audit manager, Admin — with no methodology-owner role; invitation lifecycle (bound to recipient, tenant, role assignments and proposed engagement access; expiring, revocable, single-use; recipient identity verified and inviter authority rechecked at acceptance; secret excluded from model context and logs; copied-link delivery; no open sign-up); removal commands (engagement, tenant, separate global account action); last-administrator rule enforced transactionally; revocation enforced on subsequent requests and on agent dispatch, resume and retry | 3a C1, D-3a-1, D-3d-2, 4b §7 (FR-94, FR-95), D-4b-5; AD-24 | [Proposal 5] |
| `audit-event-envelope-v2` | EXTENDED | evidence/audit | `tenantId`, `engagementId` inside the hash; v1 upcaster; export verification | 3a C1; AD-22 | [Proposal 5] |
| `engagement-task-v1` | NEW | engagements, tasks | draft engagement, client binding, task machine, budget, lease, step ledger, operation and attempt identities, dispatch claim, outcomes, waits, receipts | 3a C2, D-3a-2, D-3d-3; AD-25 | [Proposal 5] |
| `permissions-v1` | NEW | permissions | policy and Engagement Permissions documents, intersection rule, gate order and outcomes, canonical resource identity, source-wins, source protection, Permissions Summary. (amended by 4b §6/§7) Reviews visibility by assigned review responsibility and required capability, never by role label alone | 3a C3, D-3a-3, 4b §7; AD-26 | [Proposal 5] |
| `connector-v1` | NEW | connections | descriptor, effect classes, idempotency and reconciliation capabilities, two-axis result, provider references and read-back, conformance suite | 3a C4; AD-27 | [Proposal 5] |
| `connection-v1` | NEW | connections | connection states, disconnect ordering, connection attempt, PKCE and sealed handoff, callback validation, mix-up defence per provider, broker, exchange attempt states, refresh recovery, secret storage and rotation | 3a C4, D-3a-4, D-4b-3; AD-27 | [Proposal 5] |
| `disclosure-policy-v1` | NEW | connections | tenant policy, engagement narrowing, inheritance by derived material, application before every outbound model request, fallback rule. (amended by 4b §6/§7) Model availability per engagement expressed in this policy (no second policy); one enforcement path shared with `model-policy-v1` — a model-picker toggle cannot override the engagement's data policy and the picker offers only what this policy permits | 3a C4, 4b §6 (FR-92); AD-27 | [Proposal 5] |
| `model-policy-v1` | NEW | connections | administrator model configuration, versioned and audited: enabled provider deployments and their supported capabilities, default model and effort, whether auditors may change the model or choose the highest effort; no declared region or data-handling guarantee the configured service has not established; closed effort vocabulary with per-adapter mapping, no budget or evidential effect; a tenant default change alters no active task and no scheduled check's approved configuration; no automatic task-based routing; cost and usage visible to administrators by engagement. Owned by `connections` beside `disclosure-policy-v1` because both decide which provider deployment may receive a request and FR-92 requires one authoritative enforcement path; placing it in `permissions` would split that decision across two modules | 4b §6 (FR-91, FR-92), §6a (Q13, Q15), D-4b-4; AD-27 | [Proposal 5] |
| `evidence-package-v2` | EXTENDED | evidence | owner namespace, new kinds, limitations vocabulary, three sealing units, task manifest, supplements, grants by owner | 3b C5, D-3b-1; AD-5, AD-28 | [Proposal 5] |
| `acquisition-v1` | NEW | evidence | content versus acquisition identity, retry versus new observation, deduplication boundary, source-evolution relationships, impact records versus notifications | 3b C5; AD-28 | [Proposal 5] |
| `derivation-v1` | NEW | evidence | working material, provenance classes, derivation record with retained method objects, four check kinds, validation records, reproducibility comparators, recoverable registration | 3b C6, D-3b-4; AD-28 | [Proposal 5] |
| `input-quality-v1` | NEW | evidence | independent dimensions, `unknown`, assessment versions, basis and rule, dependency-specific propagation | 3b C6; AD-28 | [Proposal 5] |
| `retention-v1` | NEW | evidence | retention decision, holds, retained dependencies, availability status, export representation of deleted items | 3b C5; AD-28 | [Proposal 5] |
| `artifact-version-v1` | NEW | artifacts | immutable content, lifecycle records, claim classes, citation rule, support-status transitions, revision-bound decisions, approval binding, reconsideration, issuance. (amended by 4b §6/§7) `review-requested` (shown "In review") and `returned` (shown "Returned · n notes") lifecycle records; review notes anchored to a location with author, exact version, location, response and disposition; returning never mutates the submitted version and a revised submission keeps earlier notes; export rule — notes excluded from ordinary client-facing renderings by default, retained in the review record, includable in an authorised workpaper, archive or verification export; marking reviewed neither approves nor issues | 3b C7, 4b §5 row 6, §7 (FR-96); AD-29 | [Proposal 5] |
| `rendering-v1` | NEW | artifacts | `.docx`/`.xlsx` production in the sandbox, validation layers, feature matrix, blocking defects, PDF export, output-location write | 3b C7, D-3b-3; AD-29 | [Proposal 5] |
| `code-execution-v1` | NEW | execution | port, backend and profile record, isolation boundary, supervisor versus program trust, mounts and collection, limits, `local` conditions, network-disabled first delivery | 3b C8, D-3b-2; AD-30 | [Proposal 5] |
| `document-extraction-v1` | NEW | execution | formats, region binding, content status, OCR rules, spreadsheet calculation rules, substrates and locator grammars (extends `structural-snapshot-v1`) | 3b C8; AD-30 | [Proposal 5] |
| `agent-loop-v1` | NEW | tasks | invocation model, response contract, call identity, parameter binding, gate call site, boundary, resumption, provider continuity, instruction categories, self-review scope. (amended by 4b §6/§7) Invocation record: requested selection and actual provider, deployment or endpoint, model identifier, prompt version and effort parameters as mapped and sent, per model call and linked to its step; boundary rule for model changes — a changed selection applies from the next safe boundary and never regenerates completed work, repeats completed operations or modifies earlier records | 3c C9, D-3c-1, 4b §6 (FR-91, FR-93); AD-31 | [Proposal 5] |
| `working-context-v1` | NEW | memory | bounded context, compaction record, retrieval coverage, re-evaluation on permission change | 3c C10; AD-32 | [Proposal 5] |
| `memory-v1` | NEW | memory | scopes, ownership and delegation, lifecycle and verification statuses, authoritative-record references, configured precedence, currency | 3c C10, D-3c-2; AD-32 | [Proposal 5] |
| `skill-v1` | NEW | packs | descriptor, admission and approval, loading and recording. (amended by 4b §6/§7) Admin creates, maintains, approves, activates and retires skills as configuration approval; creator, maintainer and approver recorded as accountability records; configuration-change controls apply | 3c C11, D-3c-3, 4b §7, D-4b-5; AD-33 | [Proposal 5] |
| `methodology-pack-v1` | NEW | packs | schema, mandatory minimum, activation, proposal, example pack. (amended by 4b §6/§7) Admin creates, maintains, approves, activates and retires packs and templates as configuration approval, never audit approval; creator, maintainer and approver recorded; configuration-change controls; approved checks keep their pack version until a separate reviewed rebinding; a methodology change cannot bypass a platform-mandatory safeguard, an independent approval or an access restriction; a minimal neutral example template for bootstrap, distinguished from an adopted firm methodology | 3c C11, D-3c-3, 4b §6a (Q12), §7, D-4b-5; AD-33 | [Proposal 5] |
| `promotion-v1` | NEW | procedures | `promotable-method` schema, selection rule, compiler-2 vocabulary with `assist`, mapping, unresolved issues, Procedure Version binding, FR-51 change classes, minimum recurring safety, blocked transitions, investigation impact path. (amended by 4b §6/§7) Approved model and effort configuration bound on the version; a replacement is a proposed configuration change (platform-authored draft) through independent approval and regression as required, never an in-place amendment; "Awaiting approval" and "Pending regression" block the next run | 3c C12, D-3c-4, 4b §5 rows 2–3, §6 (FR-93); AD-34 | [Proposal 5] |
| `run-level-gate-v2` | EXTENDED | evaluation | rule classification (platform-mandatory, methodology-configurable, legacy-template-specific), pack-declared check sets over the closed diagnostic mechanism | 3c C11, C12; AD-33, AD-34 | [Proposal 5] |
| `live-channel-v2` | EXTENDED | runs, tasks | per-aggregate streams | 3a C2; AD-17 | [Proposal 5] |
| `export-v2` | EXTENDED | evidence | engagement bundle beside the Run bundle | AD-5 | [Proposal 5] |
| `run-pause-v1` | HOLDS | runs | Run path; reader and writer retained; the pause-at-boundary rule reused by tasks | — | existing |
| `run-flag-v1` | HOLDS | runs | Run path; reader and writer retained | — | existing |
| `run-request-token-v1` | HOLDS | runs | Run path; its "first use decides" rule is the model for external-effect idempotency (`connector-v1`) | — | existing |
| `run-result-v1` | HOLDS | evaluation | Run path, both compilers; reader and writer retained | — | existing |
| `evaluation-review-sealing-v1` | HOLDS | evaluation | Run path; reader and writer retained | — | existing |
| `replay-v1` | HOLDS | runs | Run path; reader retained for every historical Run | — | existing |
| `replay-asset-set-v1` | HOLDS | runs, evidence | Run path; reader retained | — | existing |
| `live-view-v1` | HOLDS | runs | Run path (browser sessions); reader retained | — | existing |
| `live-timeline-channel-v1` | EXTENDED → `live-channel-v2` | runs, tasks | per-aggregate streams | 3a C2 | existing (v2 by [Proposal 5]) |
| `evidence-package-v1` | EXTENDED → `evidence-package-v2` | evidence | Run-path package, sealing and read rules; retained and readable under its original envelope per the version verification rule. [added in consolidation; 3d did not enumerate it — 3d listed only the v2 row, so its status follows that row rather than the default HOLDS] | 3b C5, D-3b-1 | existing (v2 by [Proposal 5]) |
| `workspace-capability-v1` | HOLDS, applied by name to OAuth tokens and connector session URLs | connections | both paths | 3a C4 | existing |
| `credential-containment-v1` | HOLDS, extended by name for the sandbox (no mounts carry a credential; program output guard-scanned) | connections, execution | both paths | 3b C8 | existing |
| `agent-workspace-v1` | HOLDS; the browser is one connector under the Agent Permissions on the task path | connections | both paths | 3a C4 | existing |
| `agent-limits-recovery-v1` | HOLDS | runs | compiler-1 Run path; reader and writer retained while such work exists. (amended by 4b §6/§7) Three distinct model-unavailability causes — temporary provider failure, model retirement, policy revocation — each recorded with its actual cause and blocking or interrupting execution under this contract; a replacement is never applied in place (`promotion-v1`) | D-3d-4, 4b §6 (FR-93) | existing (amendment by [Proposal 5]) |
| `durable-escalation-v1` | HOLDS | runs | Run path closed-option waits; reader and writer retained | — | existing |
| `adapter-extraction-v1` | HOLDS | runs | compiler-1 Run path; retained for active work | D-3d-4 | existing |
| `deterministic-evaluation-v1` | HOLDS | evaluation | compiler-1 conditions; reused by compiler-2 `evaluate` where the grammar applies | 3c C12 | existing |
| `observation-registration-v1` | HOLDS | evidence | Run path; single write path for record Observations | — | existing |
| `population-acquisition-v1` | HOLDS | runs | compiler-1 Run path; retained for active work | D-3d-4 | existing |
| `run-level-gate-v1` | EXTENDED → `run-level-gate-v2` | evaluation | v1 rows retained as the compiler-1 set and classified | 3c C11 | existing (v2 by [Proposal 5]) |
| `capture-grounding-absence-v1` | HOLDS | evidence | reused for folder and mailbox searches | — | existing |
| `structural-snapshot-v1` | HOLDS | evidence | extended by `document-extraction-v1` | — | existing |
| `tool-action-v1` | SUPERSEDED | permissions | gate shape kept; scope source and vocabulary replaced by `permissions-v1` and `connector-v1` for the task path; in force for compiler-1 Runs | 3a C3 | existing |
| `agent-execution-v1` | SUPERSEDED | tasks | replaced by `agent-loop-v1` for the task path; in force for compiler-1 Runs | 3c C9 | existing |
| `executable-plan-v1` | HOLDS | procedures | compiler-1 output, unchanged; read and executed for retained versions | — | existing |
| `executable-plan-v2` (`docs/contracts/executable-plan-v2.md`) | NEW | procedures | compiler-2 output: closed step vocabulary with `assist`, bound acquisition rules, retained method references, mapping, regression case-set binding. (amended by 4b §6/§7) The approved model and effort configuration is part of the frozen definition; a replacement is a proposed configuration change with the regression the platform minimum and methodology require | 3c C12, D-3d-1, 4b §6 (FR-93); AD-34 | [Proposal 5] |
| `regression-case-set-v1` | NEW | procedures | purpose, input snapshots, period and criteria, expected results or properties, comparator, required validations, limitations, approval basis, expected-difference review for successors, exclusion of live sources and external effects | D-3d-1; AD-19, AD-34 | [Proposal 5] |
| Builder authoring contracts (guided preparation, section review, authoring receipts) | RETIRED (write side) | procedures | read paths retained for existing versions per D-3d-4. Not files under `docs/contracts/`: their rules are recorded in `_bmad-output/implementation-artifacts/` (guided preparation, conversational preparation actions) and in code | Proposal 7 | — |

The rule classification that 3c's dependency list called `gate-classification` is carried inside `run-level-gate-v2` (its checked-in classification table and test), not as a separate contract.

**Version verification rule (all EXTENDED contracts):** legacy bytes are verified using their original envelope and canonicalisation rules before any projection or upcast for reading. A v1-to-v2 reader never manufactures a historical tenant binding and never verifies transformed bytes as though they were the original signed material; the ownership binding (3a C1) is the only thing that authenticates a historical aggregate's tenant.

## Totals

Computed from the table above: 54 rows — **23 NEW**, **8 EXTENDED** (5 new-version contracts and 3 existing files marked "EXTENDED →"), **20 HOLDS**, **2 SUPERSEDED**, **1 RETIRED**.

## Existing files on `main` `c18ad36`

`ls docs/contracts/` on this branch lists the same 25 files as `git ls-tree c18ad36 docs/contracts/`. Each has exactly one row:

| File | Status in this register |
|---|---|
| `adapter-extraction-v1.md` | HOLDS |
| `agent-execution-v1.md` | SUPERSEDED |
| `agent-limits-recovery-v1.md` | HOLDS (amended by 4b §6) |
| `agent-workspace-v1.md` | HOLDS |
| `capture-grounding-absence-v1.md` | HOLDS |
| `credential-containment-v1.md` | HOLDS |
| `deterministic-evaluation-v1.md` | HOLDS |
| `durable-escalation-v1.md` | HOLDS |
| `evaluation-review-sealing-v1.md` | HOLDS |
| `evidence-package-v1.md` | EXTENDED → `evidence-package-v2` [added in consolidation] |
| `executable-plan-v1.md` | HOLDS |
| `live-timeline-channel-v1.md` | EXTENDED → `live-channel-v2` |
| `live-view-v1.md` | HOLDS |
| `observation-registration-v1.md` | HOLDS |
| `population-acquisition-v1.md` | HOLDS |
| `replay-asset-set-v1.md` | HOLDS |
| `replay-v1.md` | HOLDS |
| `run-flag-v1.md` | HOLDS |
| `run-level-gate-v1.md` | EXTENDED → `run-level-gate-v2` |
| `run-pause-v1.md` | HOLDS |
| `run-request-token-v1.md` | HOLDS |
| `run-result-v1.md` | HOLDS |
| `structural-snapshot-v1.md` | HOLDS |
| `tool-action-v1.md` | SUPERSEDED |
| `workspace-capability-v1.md` | HOLDS |

Check results:

- Every existing file has a row. One file, `evidence-package-v1.md`, had no row of its own in 3d §6 (3d listed only `evidence-package-v2`); it is added above.
- Every HOLDS, SUPERSEDED and "EXTENDED →" row names an existing file.
- Two EXTENDED new-version rows have no predecessor file under `docs/contracts/`: `audit-event-envelope-v2` (the v1 envelope is defined by AD-22, `packages/domain/src/audit-event.ts` and `tests/fixtures/audit-chain-golden.json`) and `export-v2` (the v1 Workpaper Bundle layout is defined by AD-5 only). They stay EXTENDED because they version an existing durable format; the establishing story writes the v2 file and states where v1 is defined.
- The RETIRED row names no file under `docs/contracts/`; the retired Builder authoring rules live in implementation artifacts and code, as the row says.
- `agent-limits-recovery-v1` keeps HOLDS although 4b amends its content: the amendment adds recorded causes to the existing Run-path recovery rules. If the establishing story finds that it changes the file's closed diagnostic vocabulary in a way an older reader cannot accept, the row becomes EXTENDED with a v2 file.
