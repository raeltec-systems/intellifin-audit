---
title: 'Immutable versions and platform-authored drafts'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '73d577a6fd0eba73f4b07cc71013d313675dd655'
baseline_revision: '73d577a6fd0eba73f4b07cc71013d313675dd655'
deferred: []
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An approved version can still be edited, nothing decides whether it may go straight to `ACTIVE`, and a change to a registration an Active version depends on silently invalidates what was approved.

**Approach:** Make the frozen fields of an approved or active version truly immutable, decide at approval whether the version needs a Regression Run before it activates, and mint a platform-authored Draft automatically — in the same unit of work — whenever a referenced registration or the platform's own model, prompt or tool configuration changes.

## Boundaries & Constraints

**Always:** Treat an `APPROVED` or `ACTIVE` version's frozen fields as immutable, enforced by the database as well as by the command, so nothing — no command, migration or psql session — can edit what was reviewed. Make "New version" the only path to a new definition: a Draft copy of the Active version. At approval, compare the version's configuration tuple (model, prompt version, tool configuration, registration digests) against the prior Active version of the same Procedure; when it differs, record the pending successor relationship without `handover_at` and mark the version as requiring a Regression Run before `ACTIVE`; otherwise move `APPROVED → ACTIVE` immediately. A FIRST version never requires a Regression Run. The activating command sets the authoritative boundary strictly after actual activation; a regression-gated successor receives no date until regression passes and activation occurs. On a `RegistrationChanged` event for a Target System or Population Source an Active version references, mint a new platform-authored Draft in the SAME unit of work as the event, and keep the prior version's Schedule running until the new draft is itself approved. Treat a platform-side model, prompt or tool configuration change identically. Put every platform-authored Draft through the same `DRAFT → SUBMITTED → APPROVED | REJECTED` machine. Warn before a registration save that would ripple into Procedures, naming how many.

**Ask First:** Changes to what the configuration tuple contains, to the Regression-Run rule, or to what "immutable" covers.

**Never:** Shortcut a platform-authored Draft to `ACTIVE`. Execute a Regression Run or a Run, or run a Schedule — the version only carries the requirement. Perform Schedule handover at a period boundary, which is a later epic. Recompute a registration digest here: `registrations` owns it and already publishes when it moves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Immutability | An edit to a frozen field of an `APPROVED` or `ACTIVE` version | Refused with a stated reason | Refused by the database too, not only the command |
| First version approval | No prior Active version | `APPROVED → ACTIVE` immediately; no Regression Run required | Recorded |
| Unchanged tuple | Tuple equals the prior Active version's | `APPROVED → ACTIVE` immediately | Recorded |
| Changed tuple | Tuple differs from the prior Active version's | Pending successor relationship recorded without `handover_at`; the version is marked as requiring a Regression Run and does NOT activate | No activation |
| Registration change | `RegistrationChanged` for a registration an Active version references | A platform-authored Draft is minted in the same unit of work, stating what changed | All or nothing with the event |
| Platform config change | Model, prompt or tool configuration changes | The identical path, through the same state machine | No shortcut to Active |
| New version | "New version" on an Active version | A Draft copy is created, editable | The Active version is untouched |
| Ripple warning | A registration save affecting n Procedures | The count is stated before the save commits | The save still requires confirmation |

</frozen-after-approval>

## Implementation coordination and local verification

Story 2.7 is committed and pushed at the baseline above. The implementation agent owns Story 2.8 source, tests and its reusable CLAUDE.md decisions. The epic coordinator owns formal review artifacts, this specification's final status, sprint status, the delivery report, commits, pushes and PR metadata. Return the implemented change uncommitted for formal review. Do not start a second implementation agent with overlapping files.

On this Windows host, dot-source `C:/Users/opc/AppData/Local/Temp/intellifin-epic2-env.ps1` for pinned Node/pnpm and the isolated TLS PostgreSQL 18.6 database. The valid cluster is `C:/Users/opc/tools/intellifin-epic2-test/pgdata`, loopback port 55433, database `intellifin_ci_story27`; it can be migrated to generation 14. Verify readiness first. The old Temp cluster was removed during disk cleanup and must not be reused. Run heavy checks serially, with Vitest `--maxWorkers=1`, and keep final logs under `C:/Users/opc/tools/intellifin-epic2-test/verification/`. Available disk space is about 4.8 GB; check before generators/builds. Do not accumulate multiple large Next build backups. A disk-full generator may exit zero with a truncated snapshot; validate generated files before continuing.

## Code Map

- `packages/domain/src/procedures/procedure-version.ts` — `PROCEDURE_VERSION_TRANSITIONS` already carries `APPROVED → ACTIVE` and `ACTIVE → RETIRED`; this story supplies the trigger for the first, not a new edge.
- `packages/application/src/procedures/decide-version.ts` (Story 2.7) — approval is where the tuple comparison hooks in; extend it rather than adding a parallel approval path.
- `packages/domain/src/registrations/target-system.ts` — the digest is `registrations`' to compute. Story 1.6 publishes `configuration.registration-changed` ONLY when one of the six digest-bearing fields moves, and `configuration.registration-annotated` otherwise, precisely so a rename does not mint a draft. Consume the first; ignore the second.
- `packages/infrastructure/src/registrations/registration-repository.ts` and the registrations unit of work — the platform-authored Draft is minted inside the SAME unit of work that records the registration change, so the two commit together.
- `packages/application/src/procedures/create-procedure.ts` — `procedureVersionRowVersion` and the Draft-creation shape a "New version" copy reuses.
- `apps/web/app/procedures/[id]/` and `apps/web/app/administration/registrations/` — the Procedure Detail states and the pre-save ripple warning.

## Tasks & Acceptance

**Execution:**
- [x] Enforce immutability in the database as well as the domain: a generation-14 constraint or trigger that refuses an update to a frozen field when the row's state is `APPROVED` or `ACTIVE`, asserted with RAW SQL in the integration suite — a constraint tested only through the command proves nothing about the constraint.
- [x] `packages/domain/src/procedures/configuration-tuple.ts` — the tuple (model, prompt version, tool configuration, registration digests), its comparison, the first-version rule, and the `handover_at` computation as pure functions.
- [x] Extend the approval command: compare against the prior Active version, then either activate immediately or mark the version as requiring a Regression Run with a pending successor relationship and no `handover_at`; only actual activation sets its authoritative boundary. Record which, and why, on the version.
- [x] `packages/application/src/procedures/mint-platform-draft.ts` — the handler that consumes `RegistrationChanged` and the platform model/prompt/tool configuration change, and mints a platform-authored Draft copy in the same unit of work, recording what changed and that it requires approval. Idempotent per (version, change), so one change mints one draft.
- [x] "New version": a Draft copy of the Active version, leaving the Active version untouched.
- [x] `apps/web` — Procedure Detail states for Draft, Submitted, Rejected, Active, Retired and platform-authored Draft, each with its stated sentence; and the registration-save ripple warning naming the affected Procedure count before the save commits.
- [x] Domain, application, integration and e2e tests — every matrix row, raw-SQL immutability, the same-unit-of-work minting proved by rolling the event back and finding no draft, idempotent minting, a held-open-transaction concurrency case, keyboard access and a WCAG scan. Record reusable decisions in `CLAUDE.md`.

**Acceptance Criteria:**
- Given an `APPROVED` or `ACTIVE` version, when any frozen field is edited through the command OR through raw SQL, then it is refused and nothing changes.
- Given a first version, when it is approved, then it becomes `ACTIVE` immediately and is not marked as requiring a Regression Run.
- Given a version whose configuration tuple equals the prior Active version's, when it is approved, then it becomes `ACTIVE` immediately.
- Given a version whose tuple differs, when it is approved, then the pending successor relationship is recorded without `handover_at`, the version is marked as requiring a Regression Run, and it does NOT become `ACTIVE`.
- Given a `RegistrationChanged` event for a registration an Active version references, when it is recorded, then a platform-authored Draft is minted in the same unit of work — and when that transaction rolls back, no draft exists.
- Given a platform-authored Draft, when it is read, then it states it was created by the platform after the named change and requires approval, and it can only reach `ACTIVE` through the normal machine.
- Given a registration save that would ripple into n Procedures, when it is saved, then the count is stated before the save commits.

## Spec Change Log

- 2026-09-04 — Owner explicitly selected authoritative handover at actual activation after regression passes. Renegotiated frozen intent and matrix; approval retains pending regression and successor relationship without a speculative date. AD-19 and linked planning contracts updated; downstream timing reviews require revalidation.

## Design Notes

Story 1.6 already split `registration-changed` from `registration-annotated` for exactly this story, so a display-name change must NOT mint a draft. That split is the contract; do not widen the trigger.

The `ACTIVE → RETIRED` edge exists in the machine, but retirement at the first period boundary after a successor is Active is Schedule handover, which the epic places in a later epic. This story records the successor relationship; it does not run a scheduler.

A Regression Run is not executed here either (FR-15, a later epic). This epic records the requirement and pending successor relationship. A regression-gated successor has no authoritative date until later activation after regression passes. Immediate activation computes its boundary now. Pure boundary rules are tested here without executing a scheduler.

Minting must be idempotent: a registration change that fans out to several Active versions mints one draft per version, and re-delivering the same change mints nothing further.

## Verification

- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` — all pass.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm test:integration` — migrates to generation 14, no drift, PostgreSQL 18 checks pass, including the raw-SQL immutability assertions.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — builds and every Procedure Detail state pass, including every WCAG 2.1 AA scan.

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 1, medium 7, low 4)
- defer: 0
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` P1: direct version lookup, newest-Draft discovery and paginated history preserve access beyond 100 versions.
  - `[high]` `[patch]` P2: New version rechecks authorization under the transaction lock and audits concurrent revocation without creating a Draft/job.
  - `[medium]` `[patch]` P3: affected-subset queries isolate unrelated corrupt Active versions while refusing affected corruption.
  - `[low]` `[patch]` P4: unsupported prompt/tool publication kinds explicitly refuse under the fixed supported compiler contract.
  - `[medium]` `[patch]` P5: new Procedures read the authoritative published model and revision inside their transaction.
  - `[low]` `[patch]` P6: complete runtime publication validation precedes property access and writes.
  - `[low]` `[patch]` P7: replay checks complete publication identity and preserves the real current revision without historical pointer reset.
  - `[medium]` `[patch]` P8: both detail and review resolve actual succession independently of history pagination.
  - `[low]` `[patch]` P9: New version failures record safe correlated telemetry before returning unknown outcome.
  - `[medium]` `[patch]` P10: synchronous request guard plus duplicate and committed-response-loss coverage prevents accidental repeated creation.
  - `[medium]` `[patch]` P11: recurring approval asserts the exact stored lifecycle/succession boundary and its display.
  - `[medium]` `[patch]` P12: owner snapshot assertions and queued derivation prove exact Target/Source changes propagate without rewriting predecessors.
- Repair status: all twelve implemented and independently cleared; see `review-2-8-triage.md` and `review-2-8-followup.md`. Final full verification passed 1,950 unit, 209 integration and 96 browser tests, plus all required static/schema/build checks.

## Auto Run Result

Implemented database-protected reviewed definitions; first/unchanged-configuration activation and regression-gated successors; separate succession boundaries; audited human New version; atomic, replay-safe platform Draft creation for owner registration/source changes and supported model publication; exact changed snapshots and queued derivation; truthful lifecycle surfaces, paginated history and pre-save ripple warnings. New creation reads the published model/revision under its transaction. Unsupported prompt/tool publication fails before any write.

Changed files by responsibility:

- `packages/domain/src/procedures/configuration-tuple.ts` and its tests: tuple comparison, UTC period boundaries and strict lifecycle/origin metadata. Domain exports and population validation support validated platform Drafts.
- `packages/application/src/procedures/{apply-platform-configuration,configuration-change-ports,mint-platform-draft,new-version}.ts`: typed publication/change contracts, exact snapshot copies, atomic replay and authorized human creation. Creation/decision/port/export changes wire published configuration, activation, lineage and audit. Registration/source commands classify changes and validate confirmed impact.
- `packages/infrastructure/drizzle/0014_young_vance_astro.sql`, its snapshot/journal and database schema/compatibility files: generation 14, frozen-definition protection, publication/replay storage and succession integrity.
- Procedure repository/unit-of-work/configuration adapters and registration/source adapters: consistent serialization, affected-subset discovery, strict reads, real revision pointer, direct version access and history pagination. Telemetry adds the safe New version failure message.
- `scripts/apply-platform-configuration.mts`: explicit release-file operation; no startup publication or migration.
- Procedure pages/actions, NewVersionButton, VersionStatus, existing decision controls and both registration forms/actions: lifecycle visibility, successor history, guarded creation, safe failures and exact ripple confirmation.
- Domain/application/web tests, `tests/integration/immutable-versions.test.ts`, `tests/e2e/immutable-versions.spec.ts`, and adjusted existing integration/review suites: contract, rollback, concurrency, provenance, migration, browser and accessibility evidence.
- `CLAUDE.md`, story/sprint status, review artifacts, acceptance audit and HTML/Markdown delivery reports: shared decisions, review disposition and human delivery evidence. Story 2.5's deferred audit is recorded as resolved; Story 2.7's CI evidence is recorded as green.

Review: 12 patches applied (high 1, medium 7, low 4), 0 deferred, 2 rejected. Follow-up recommended: true; weighted score `3 × 7 + 4 = 25`, also required by the high finding. Independent follow-up completed and cleared every repair. Coordinator separately reviewed the subsequent test-only navigation bound, fixture digest and main-region selector corrections.

Final verification (2026-09-05):

| Gate | Observed outcome |
|---|---|
| Full unit | 81 files, 1,950 passed; single worker and established 15-second local test bound; exit 0 |
| Full PostgreSQL integration | 14 files, 209 passed; PostgreSQL 18.6 over TLS; exit 0 |
| Full browser | 96 passed, no skips/failures; 7.1 minutes; exit 0 |
| Focused repaired checks | 26 unit, 17 integration, 4 browser cases passed |
| Typecheck and boundaries | Passed; 307 modules checked |
| Migration and schema generation | Generation 14 confirmed; no schema changes |
| Package and production web builds | Passed; optimized compile, TypeScript and all routes generated |
| Whitespace | `git diff --check` passed |

Durable command evidence: `C:/Users/opc/tools/intellifin-epic2-test/verification/story28-reviewfix-*`, notably `unit-full4.log`, `integration-full.log`, `browser-full.log` and `production.log` with that prefix. Failed/interrupted attempts are retained as diagnostics, never counted as acceptance. Build-generated next-env import-path churn was omitted, restoring the already-tested repository convention.

Residual boundaries: the PoC serializes Procedure/configuration writes; old generation-13 approvals stay unactivated; supported publication is model-only under prompt 1/interpreter v1; provider HTTP is synthetic. Actual Runs, Regression Runs and scheduler handover remain later epics. The user-selected activation-time handover rule is preserved. Commit/push and final branch CI are recorded in the delivery report and PR.

Delivery confirmed: implementation commit `b432741fc3498239ee0cbd0c4036b9ccb821db51` was pushed after all local gates and a clean-worktree check. [CI run 52](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33956593754) passed all four jobs, including fresh PostgreSQL migration, browser/accessibility and built-container startup checks. The later report-only commit records this evidence without changing implementation.

## Pre-implementation concurrency and lineage audit


- Immutability protects the reviewed definition throughout its history, including after retirement. Raw SQL tests must attempt changing frozen fields directly, changing state and fields together, and changing an already retired definition. Permitted operational fields must be explicit; a state change must not be a bypass.
- The authoritative comparison version is the most recently activated version of this Procedure, not merely the greatest version number or newest approved draft. An approved version awaiting regression is not the prior Active baseline. Handle more than one ACTIVE row during a future handover explicitly.
- Store incoming and outgoing succession relationships without overwriting a prior boundary when a third version is approved. A single reused handover timestamp cannot represent both distinct lineage boundaries. Actual retirement and scheduled execution remain outside this epic.
- Registration/source change handling must be synchronous inside the writer's UnitOfWork. A queued event after commit does not satisfy atomic minting. Pass a typed public change contract to the procedure-owned handler; infrastructure binds both module writers and the audit/queue writers to the same transaction.
- Plan lock order before adding the cross-module callback. Current Target save locks the version before reading registrations FOR SHARE. A registration update locks the registration before minting a Draft, which would lock that version: this creates a lock inversion. Resolve by acquiring selected registration/source locks before version locks on authoring paths, or another explicit consistent protocol; verify with held-open competing transactions. Preserve deterministic ordering of multiple registration IDs and affected version IDs.
- Reuse the stored registration/source digest and update only the changed snapshot in the successor Draft. Do not recompute another module's digest or silently refresh unrelated frozen contracts. Annotation-only changes must mint nothing. Test both Target and Population Source changes, not only one.
- Idempotency needs a durable unique key for the originating version and change, including repeated delivery after commit. Version-number allocation must serialize at the Procedure aggregate, including concurrent New version and platform minting. A rollback must leave neither the registration event nor any successor Draft/job.
- The pre-save warning must count affected Procedures from the same meaning the handler uses. Validate count drift before confirmation commits if another active version can change the impact; do not show an estimate as a guaranteed exact count.
- Keep platform creation provenance separate from human review ownership. Do not let a platform-created Draft bypass normal submission or self-approval rules after human edits. Resolve ownership/notification semantics before handoff.
- Set Procedure card/detail display names from the active version, otherwise the newest Draft, instead of rewriting immutable history or retaining the original creation-only name.
- Detail states must be truthful about this epic's delivery boundary: display the saved Schedule and activation/regression status, but do not invent a next Run time, scheduled job or working Initiate Run action before the later execution epic provides it. If showing that future action, use the existing unavailable-action pattern with a stated reason. Platform Drafts and pending regression must remain visible alongside an older Active version.

Owner timing decision resolved 2026-09-04: authoritative handover is set only at actual activation after regression passes; approval records pending regression and successor relationship without a speculative date. See the Spec Change Log and AD-19 revision 3.

### Platform configuration change entry point

A pure minting helper exercised only by tests is insufficient for the platform-change matrix row. Wire an explicit application command from an operational composition-root entry point that applies model/prompt/tool configuration changes, records a durable configuration revision and publishes/mints within one transaction. Document how deployment invokes it; a restart or repeated application of the same revision must mint no duplicates. Do not let differently configured web/worker instances silently alternate the authoritative revision on startup. Runtime processes still never migrate. Keep API keys outside the durable tuple and events. Test the actual entry point with synthetic configuration, not only a direct mint helper.

The new configuration must govern the successor's actual derivation and submitted review, not just its change label. Preserve the originating configuration revision on the Draft and ensure the worker either uses that supported model/prompt/tool contract or reports a clear unavailable configuration. A worker with an older environment must never silently compile the successor under its own old tuple. Prove the configuration command through minting, queued derivation and the stored review tuple with synthetic provider HTTP. Unsupported interpreter/prompt contracts must be refused before publishing a configuration that the deployed compiler cannot honor.

Version-number allocation, activation and registration-change fan-out must share a deterministic Procedure-level serialization protocol. Confirm how a save/approval racing the ripple-count confirmation behaves; stale confirmation must be refused before mutation so the stated impact remains true. Operational fields such as derivation attempt history are distinct from the frozen definition; late worker attempts may be recorded without replacing an approved plan.

Calendar-boundary review must include `once`: the addendum gives it the Auditor's explicit period and AD-19 gives it no scheduler entry. Do not silently treat it as daily or invent a recurring next period. Represent the absence of an automatic scheduled boundary explicitly and preserve the authored period for later manual initiation; explain that case in the review/detail surface and tests. If implementing period ownership requires a new product rule beyond these contracts, surface that precise decision before inventing one.

For recurring schedules, AD-19 says first **period start**, not next launch time: use UTC calendar day starts, Monday week starts and first-of-month starts as defined by the frozen period-derivation rule. Test activation exactly on a boundary (the stored boundary must be strictly later), month/year changes and a non-midnight configured launch time. Do not implement or infer retirement/enqueue ordering here; the downstream scheduler must revalidate period ownership and delayed starts under the corrected activation-time contract.

### Additional transaction and replay audit

- A change has an immutable identity (event ID/configuration revision), not merely `(source, newDigest)`: A→B→A contains two distinct changes to A. Pass the exact post-change snapshot through the typed internal transaction contract; do not put sensitive registration contracts into audit payloads or reconstruct an old event from today's registration row. Check an existing idempotency result before resolving current state. Replaying a historical change must retain its originating affected version set rather than discover and mint against versions activated later.
- Discover and lock/recheck affected Active versions within the registration/source change transaction. The serialization protocol must also cover activation entering that referencing set, so it prevents phantoms as well as row-level lock inversion. State, referenced identity and digest are rechecked before minting; define membership at the committed configuration change.
- Replace the old counter's "approved versions" semantics with distinct affected Procedures, parameterized by source/registration identity and kind. Classify the proposed edit before displaying ripple consequences: annotation-only renames/notes/retirement must not promise that they will mint Drafts. Both Target and Population Source forms currently append their warning from a preloaded count; test the actual edited form, not only the counter.
- Activation, both lineage endpoints, authoritative boundary and lifecycle/audit/notification effects commit atomically. Enforce same-Procedure endpoints, no self-links and unambiguous activated succession relationships, preserving prior boundaries. Keep pending regression candidates distinct from the authoritative activated chain; do not infer a new one-Draft-per-Procedure product restriction. Add a forced rollback and repeated activation/decision proof so a failure cannot leave one-sided lineage.
