---
title: 'Story 3.1: Initiate a Run for an Active version and period'
type: feature
created: '2026-09-05'
status: done
baseline_revision: 3eddd4943e63bb16a48988d776f104f8a4caae12
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Active Procedures cannot yet be run. An Auditor needs a durable, traceable Run bound to the version that owns the requested effective period, without duplicate active work or a saved Run whose dispatch was lost.

**Approach:** Add the Run aggregate and an authorized InitiateRun command, with period ownership resolved through the Procedures-owned port. Commit its QUEUED state, pg-boss dispatch and first Timeline event together. Wire initiation from Procedure Detail to a persisted queued Run page.

## Boundaries & Constraints

**Always:** Standard Runs reference a verified ACTIVE frozen version. Use the stored activated succession chain and handover boundaries, never maximum version number or activation timestamp ordering. The requested period is inclusive Gregorian date-only from/to, validated using the existing domain contract; ownership uses its UTC start. Pending regression edges do not transfer ownership. UUIDv7 Run/correlation identity, trusted initiator/session and initiation authorization are durable. Recheck roles after the shared configuration lock. Enforce one active STANDARD Run per Procedure and exact effective period in PostgreSQL, including QUEUED, RUNNING, PAUSED and AWAITING_AUDITOR. Preserve immutable plan bytes. State, job and chained Timeline write share one transaction; runtime startup never migrates. Record reusable decisions in CLAUDE.md.

**Block If:** The stored definition or succession cannot establish one eligible owner; refuse initiation with an actionable reason and no Run/job rather than guessing. A genuine product-contract contradiction not resolved by the normative references requires escalation.

**Never:** Trust a client-supplied version, actor, kind or authorization. Rewrite the frozen plan or source/registration contracts at initiation. Execute acquisitions, invent completion, activate regression candidates, retire versions or run a scheduler in this story. Build the full Runs dashboard now (Story 3.11 owns it). Touch production data for verification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Valid start | Auditor or Manager; one owning ACTIVE version; valid period | One STANDARD QUEUED Run, trusted initiator, UUIDv7 correlation, dispatch and sequence-1 Run Timeline event | No error |
| No owner | No ACTIVE version, retired owner, pending approval only, or unreadable frozen definition | No Run/job | Explain that no executable Active version owns that period |
| Handover | Activated predecessor/successor, boundary H | Period start before H uses predecessor; at/after H uses successor; multiple successive boundaries compose | Invalid/ambiguous lineage refuses |
| Null boundary | First Active version or activated once successor with null handover | Unbounded ownership at that chain segment; an activated null-boundary successor replaces its predecessor for all periods | Pending null-activation edges do not supersede |
| Invalid request | Malformed IDs/dates, reversed period, unknown fields | No Run/job | Validation refusal, no framework exception |
| Duplicate race | Two overlapping starts for same Procedure/from/to while first transaction held open | Exactly one active Run and one job; second receives duplicate refusal with existing Run link where authorized | Database constraint remains effective without application precheck |
| Other work | Different Procedure or effective period; previous Run terminal | Fresh independent Run allowed | No accidental global uniqueness |
| Unauthorized/revoked | Administrator, no role/session, or revocation before locked role read | No Run/job | Existing role denial and audit policy; no protected details leaked |
| Atomic rollback | Inject queue failure or Timeline append failure after Run insert | No Run, dispatch or chain head/event survives | Safe failure, never claim queued |
| Reload | Navigate to returned Run URL then reload | Same stored identity, period, selected version and QUEUED state | Unknown ID is safe not-found after authorization |

</intent-contract>

## Code Map

- `packages/application/src/procedures/ports.ts`: Procedures owns version readers; extend a narrow period-ownership port rather than reading its tables from runs infrastructure.
- `packages/infrastructure/src/procedures/procedure-repository.ts`: DrizzleProcedureWriter and activated succession reads. `recordSuccession` stores incoming/outgoing edges separately; current-tip queries are not sufficient for historical periods.
- `packages/domain/src/procedures/configuration-tuple.ts`: handoverAt is strictly the next calendar period start; null is once. `population-draft.ts`: isExplicitPeriod validates date-only inclusive boundaries.
- `packages/application/src/procedures/decide-version.ts`: authorize before access, acquire shared UOW lock, recheck role on transaction, preserve denial outside rollback.
- `packages/infrastructure/src/procedures/procedures-unit-of-work.ts`: advisory lock `(20428,1)` precedes module locks. Run initiation joins that ordering to serialize against activation.
- `packages/infrastructure/src/procedures/derivation-queue.ts`: transaction-bound pg-boss adapter and JSON parameter bridge, runtime migrations disabled, release-only queue creation. Reuse the bridge through a shared infrastructure helper if needed.
- `packages/application/src/audit/ports.ts`, `packages/infrastructure/src/db/audit-events.ts`: append-only chained writer, locked head, UUIDv7/clock ports. Run Timeline is this event store with aggregateId=Run ID, never a duplicate store.
- `apps/web/src/correlation.ts` creates request UUIDv4 values; generate a separate UUIDv7 durable Run correlation. The existing audit appender has no NOTIFY: the Run Timeline writer must emit the AD-17 `run_timeline` notification with Run id and sequence on the same transaction; delivery/replay UI remains Epic 5.
- `packages/infrastructure/src/db/schema.ts`, `db/migrate.ts`, `db/compat.ts`, `packages/infrastructure/drizzle/`: migration, pg-boss provisioning and fixed schema compatibility must advance together.
- `apps/web/app/procedures/[id]/page.tsx`, `app/procedures/version-actions.ts`, `src/server-session.ts`: Detail initiation entry point, server command wiring, trusted session and safe unknown-outcome responses.
- `apps/web/src/design/`: use existing controls, banners and lifecycle StatusBadge; forms explicitly POST and actions authorize independently.
- `apps/web/src/procedures/VersionStatus.tsx`: replace the current unavailable initiation message consistently with the real Detail entry point; avoid contradictory enabled/disabled controls on the same page.
- `tests/integration/procedures.test.ts`, `tests/integration/immutable-versions.test.ts`, `tests/integration/derive-plan.test.ts`, `tests/e2e/procedures.spec.ts`: existing real database/version/queue/browser setup patterns; isolate test rows and preserve audit-head consistency.
- Normative read-only references: Story 3.1 in `../planning-artifacts/epics.md`, AD-2/3/7/8/19/22 in architecture spine, and executable-plan-v1. Story 3.2 adds the consumer; this story must leave its durable job queued rather than acknowledge it with a no-op worker.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/runs/` and Procedures-owned period resolver: typed Run lifecycle/kind/period contract and conservative ownership selection; unit tests for matrix boundaries and lineage (including equal activation times/out-of-number approvals).
- [x] `packages/application/src/runs/ports.ts`, `initiate-run.ts`: command, reader/writer/dispatch ports, trusted identity and locked authorization; expose supported barrels.
- [x] `packages/infrastructure/src/runs/`: transactional repository/UOW/queue and bounded authorized detail read; join Procedures-owned reader on same transaction.
- [x] `packages/infrastructure/src/db/schema.ts`, migrations, `db/compat.ts`, `db/migrate.ts`: generations 15–17 Run and initiation-request tables with valid states/kinds/periods, FK to frozen version, partial uniqueness and dispatch provisioning. Include Drizzle snapshot/journal drift correctness.
- [x] `apps/web/app/procedures/[id]/page.tsx`, new `apps/web/src/runs/InitiateRunForm.tsx`, `apps/web/app/runs/actions.ts`, `apps/web/app/runs/[id]/page.tsx`: real initiation with date inputs, clear failure/duplicate handling and accessible persisted queued Detail; safe retry behavior after unknown response.
- [x] `tests/integration/runs.test.ts`: real PostgreSQL 18 transaction rollback, active uniqueness, period ownership, frozen-byte preservation and chain verification. Prove overlap by holding first transaction open and observing competing lock wait.
- [x] `tests/e2e/runs.spec.ts`: Auditor starts a seeded Active version from UI and reloads the queued Run; refusal/duplicate path and automated accessibility check. Unit-test Server Action hostile shapes/authorization and unknown-outcome handling.
- [x] `CLAUDE.md`, this spec and `sprint-status.yaml`: record ownership/transaction decisions and actual test evidence; no unverified completion claims.

**Acceptance Criteria:**
- Given an owning Active version, when an Auditor submits the Procedure Detail Run form, then navigation opens a stored QUEUED Run showing its selected version, requested period and initiator, and reload preserves it.
- Given an existing active Run for that Procedure and period, when another initiation reaches the server, then the UI explains the refusal and exactly one Run/job exists, including concurrent requests.
- Given a successful initiation, when its database records are inspected, then its own chain starts with a QUEUED transition containing prior state null, reason, actor, UTC time and correlation, and verifies against the shared hash-chain reader.
- Given queue or event persistence fails, when initiation returns, then no partial Run/job/event is visible and the UI does not report success.

## Spec Change Log

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 7, low 5)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Persisted trusted-user/request-token associations, including duplicate refusals, so acknowledgement retries recover the same Run after completion. The form preserves the token and period through rerenders and repeated failed recoveries; fresh initiation receives a fresh token.
  - `[medium]` `[patch]` Added composite Procedure/version ownership FK in migration 16.
  - `[low]` `[patch]` Narrowed conflict suppression to active-period uniqueness; unexpected identity conflicts now fail.
  - `[medium]` `[patch]` Added real LISTEN/NOTIFY commit and rollback assertions.
  - `[medium]` `[patch]` Asserted the committed revocation denial audit identity and policy fields.
  - `[medium]` `[patch]` Extended browser coverage for direct unauthorized Run access, malformed/missing IDs and displayed persisted facts.
  - `[low]` `[patch]` Removed unrestricted CI bypass from Run integration database guarding.
  - `[low]` `[patch]` Compared parsed epoch timestamps for succession and added offset/fractional representation cases.
  - `[low]` `[patch]` Marked preflight RAM reporting informational rather than claiming a memory readiness guarantee.
  - `[low]` `[patch]` Separated executed verification evidence from required command descriptions.
  - `[medium]` `[patch]` Added persisted lifecycle/succession disagreement refusal coverage.
  - `[medium]` `[patch]` Recover authorized existing active Runs before resolving mutable ownership availability.

Follow-up score: `3 × 7 + 5 = 26`; recommendation is true. The focused independent follow-up on token scope and repeated recovery returned no findings. No intent repair or code re-derivation was needed: the changes enforce the existing durable initiation and safe recovery requirements. The separately owner-approved adapter retry policy remains authorized by the recorded user answer, not inferred from this story.

## Design Notes

Review hardening added migrations 16 and 17 after generation 15 had been exercised locally: the composite ownership key, initial request token, and multi-token request association are now schema 17. Applied migration history was preserved. The request token is deduplication data only, scoped to the authenticated initiator; Run and correlation identities remain generated by the server. Replay validates the exact Procedure/period and still rechecks current authorization. Recovery may return a terminal Run, while a fresh token permits an intentional new initiation after terminal state.

The activated succession edge is the authoritative handover record. The first version has no lower bound even if its lifecycle carries a prospective date. Each incoming activated non-null edge adds an inclusive lower bound and each outgoing edge an exclusive upper bound. An activated null-boundary edge transfers unbounded ownership to its successor; pending edges are ignored. This reconciles Story 3.1's null rule with Epic 2's durable succession chain and avoids selecting both still-Active versions. Corrupt/forked chains refuse; no timestamp tie-breaker.

The period remains a separate Run execution input; this story does not mutate the frozen definition or acquire data. Story 3.2 must bind it explicitly in the interpreter while preserving plan bytes. Duplicate uniqueness excludes terminal Runs so the linked rerun contract remains possible in Story 3.10. Queue delivery alone is not business execution.

## Verification

### Executed evidence (2026-09-05; final reviewed implementation)

- Full unit suite passed: 1,995 tests in 83 files (`pnpm test --maxWorkers=1 --testTimeout=30000`).
- Full PostgreSQL 18 suite passed: 229 tests in 15 files (`pnpm test:integration --maxWorkers=1`), including 15 Run contracts. Database migrations reached generation 17; schema generation reports no drift.
- All 10 browser checks executed and passed across the final full run (9 passed, one cold-route timeout) and the focused rerun (4 passed including auth setup and that route). The timeout budget was increased only for local cache-disabled cold compilation. This is not a claim of a single 10/10 run. Tests cover repeated lost acknowledgements, terminal-Run recovery, native JavaScript-disabled POST, direct authorization, invalid URLs, duplicate refusal and persisted details. Axe found zero violations; hydration errors were empty. The final screenshot was visually inspected.
- Package/worker build, final typecheck, dependency boundaries (317 modules), and production web build passed. The existing middleware-convention deprecation warning remains. Generated-only next-env changes were restored.
- Focused independent follow-up on request identity and recovery returned no findings.
- Detailed logs and the inspected screenshot are retained outside the repository at `C:/Users/opc/tools/intellifin-epic2-test/verification/epic3/` under `story31-reviewed-*`.
### Matrix coverage audit

| Matrix row | Executed covering tests |
|---|---|
| Valid start | Integration identity/dispatch/chain and Audit Manager cases; browser initiation |
| No owner | Integration unreadable frozen owner and unknown-owner refusals; domain retired ownership |
| Handover | Domain inclusive composed boundaries/equal activation times; integration historical ownership |
| Null boundary | Domain pending edge and activated null-boundary replacement |
| Invalid request | Action malformed/forged input table; integration invalid date; domain Gregorian boundaries |
| Duplicate race | Integration observed advisory-lock contention and direct database uniqueness; browser duplicate refusal |
| Other work | Integration different period, separate seeded Procedures and terminal rerun |
| Unauthorized/revoked | Action authorization before hostile input; integration locked revocation; browser administrator denial |
| Atomic rollback | Integration injected queue and Timeline failures assert no Run/job/event/head |
| Reload | Browser persisted queued identity/period/version and lost-response recovery |

### Required verification commands

These are the verification requirements, not additional claims of executed results. Actual outcomes are recorded above. Use pinned Node 24.20.0/pnpm 11.25.0 and the existing isolated PostgreSQL 18 TLS test environment. Keep heavyweight checks serial; no Docker or production dependency.

- `pnpm test --maxWorkers=1 --testTimeout=30000` — all unit tests pass, including matrix cases and boundaries.
- `pnpm db:migrate` — isolated test database reaches generation 17 with queues provisioned.
- `pnpm test:integration --maxWorkers=1` — full database suite passes including new Run race/rollback tests.
- `pnpm typecheck` and `pnpm boundaries` — package/root-test types and architecture constraints pass.
- `pnpm build` then `pnpm test:e2e tests/e2e/runs.spec.ts --workers=1` — real initiation journey and axe pass.
- `pnpm db:generate` — no unexpected schema drift after generated migration.
- Production web build after browser verification at the story gate; preserve known environment controls and inspect generated-only next-env changes.

## Auto Run Result

Story 3.1 is complete: authorized initiation persists an immutable version reference, exact period, trusted identity, durable dispatch and chained Timeline atomically. Duplicate submissions and lost acknowledgements recover the same Run, including after it becomes terminal.

Changed files: domain `runs/` defines ownership and Run contracts; application `runs/` owns initiation; infrastructure `runs/`, schema and migrations 15–17 implement persistence, request deduplication and dispatch. Procedures ports/readers supply frozen ownership. Web Procedure Detail, Run form/actions/detail and styles expose the journey. Unit, integration and browser suites verify it. The preflight script and Next cache settings support the constrained local environment. Planning artifacts record the owner-approved retry policy and shared decisions.

Review: 12 patches applied (0 high, 7 medium, 5 low), 0 deferred, 2 rejected. Follow-up score 26; recommendation true. The focused follow-up was completed without findings. Verification outcomes are recorded above.

Residual scope: the durable job deliberately remains queued until Story 3.2 supplies the consumer. Full execution and the Runs dashboard belong to the remaining Epic 3 stories. No production migration or deployment was performed. The owner-approved adapter retry clarification revises upstream contracts; downstream Epic 3 implementation must use that rule.
