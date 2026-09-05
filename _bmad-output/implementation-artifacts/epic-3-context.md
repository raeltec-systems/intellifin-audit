# Epic 3 Context: Run an adapter-acquired Procedure to a sealed Result

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Run an Active Procedure version against API- or file-backed Population Sources and Target Systems, with durable worker progress, deterministic adapter evidence, a complete Evidence Quality Gate, and one immutable sealed Result. Auditors must be able to trace every outcome through the Run, Work Items, Observations, Evidence, evaluations, and Timeline, including safe Inconclusive or Run Failed outcomes. Epic 3 proves the Segregation-of-Duties and High-Value Transactions procedures on their golden datasets without a model, Agent Workspace, or Escalation in the execution path.

## Stories

- Story 3.1: Initiate a Run for an Active version and period
- Story 3.2: Acquire the Population Source deterministically
- Story 3.3: Extract adapter-acquired Target Systems and freeze Reference Sources
- Story 3.4: Register Observations in the one wire schema, in batches
- Story 3.5: Seal Evidence with reservation and digest verification
- Story 3.6: Corroborate Observations against the stored Structural Snapshot
- Story 3.7: Evaluate corroborated Observations deterministically and raise Exceptions
- Story 3.8: Run the full Evidence Quality Gate and map limit exhaustion to a safe outcome
- Story 3.9: Seal the Result and publish the adapter Run's outputs
- Story 3.10: Cancel an active Run and start a linked rerun
- Story 3.11: See Runs and inspect an adapter Run's Result, Evidence, Exceptions, and Timeline

## Requirements & Constraints

Runs resolve the Active version that owns the requested effective period, use a UUIDv7 correlation ID, remain unique per Procedure and period for `STANDARD` Runs, and commit the Run plus durable dispatch atomically. Population adapters preserve the source snapshot, independently declared count, digest, parsed rows, inclusion set, and exclusion reasons. File-level and inclusion-level reconciliation, freshness, schema, mandatory-value, duplicate-key, pagination, and empty-population rules must pass before a conclusion; a zero-record Pass requires an explicit version opt-in.

API/file adapters and reference-source adapters run as ordered Session Steps and Work Items. They use just-in-time opaque credentials, never expose secrets in product data, and emit the same versioned Observation contract: grounded identity and attributes, exact `found` state, UTC capture time, adapter capture method, match origin, and linked Evidence. `found = false` requires a platform-derived query key, stored empty response, and complete extraction; otherwise coverage is Uninspected. Grounding is re-read from preserved Structural Snapshots, with exact string matching (including leading zeroes), UTC normalization, retained originals, and transformation history. Ambiguous, unmatched, uninspected, contradictory, stale, or incomplete records can never be Compliant.

Every declared condition is evaluated deterministically at Observation registration, in Exception → Unevaluated → Compliant order, with origin `RULE`; the first Exception creates a permanent Run-stable Exception and fingerprint. The Run-level Gate records every check and diagnostic in the Timeline. Any failed Gate yields Inconclusive with preserved partial Evidence; Session Step failure, denied action, or in-Run integrity mismatch yields Run Failed. Bounded retries and Run-level step/time/token limits follow the safe mappings, and Work Item failures do not stop the Run. A terminal transition atomically records Gate, Result, state, checkpoint, and Timeline. Result publication includes population, exclusions, coverage, condition counts, template fields, verbatim scope, and the first matching normative outcome; sealing increments the Result version and makes the outcome immutable. Cancel preserves captured Evidence; rerun creates a linked new Run.

## Technical Decisions

The domain owns Run, Session Step, Work Item, Observation, Evidence Package, Gate, Evaluation, Exception, Result, and lifecycle invariants. Application commands own mutations and ports; infrastructure owns PostgreSQL, pg-boss, and object storage. PostgreSQL is the system of record. Every state/effect and Timeline event commits together through a shared UnitOfWork; dispatch is transactional, and worker stages use revisioned checkpoints and idempotent retries. Standard Run uniqueness is transactional, and queue delivery must not be treated as exactly-once business execution.

Evidence uses stable idempotency keys and unique provisional object keys. `EvidenceStore` verifies availability, size, and SHA-256 before registration; `SealPackage` runs on every terminal transition, abandons open reservations, and preserves required artifacts. Observation registration carries digests and performs per-Observation Gate checks plus deterministic evaluation in one transaction. Run-level completion and Result sealing are one application command, serialized on the Result revision; no later mutation can change a sealed outcome. Durable contracts, schemas, provenance, Timeline events, and manifests are explicitly versioned and canonicalized. Adapter acquisition is the only source-specific seam; evaluators consume frozen parsed reference data and perform no I/O.

## UX & Interaction Patterns

The Runs list is paginated and filterable by Procedure, lifecycle, initiator, and period, with the required lifecycle, Gate, outcome, Review, and elapsed columns. Cold loads use skeleton rows; stale request-time data shows an “Updated {time}. Refresh.” banner. Run Detail uses Result, Evidence, Exceptions, Review, and Execution Timeline tabs and a conclusion triptych for lifecycle, Gate, and outcome/sealed marker/Result version. Queued, Running, Completed, Inconclusive, Run Failed, and Canceled states have distinct labels and safe next actions; submission is disabled where no authoritative sealed conclusion exists.

The Result view groups Gate rows into Per-Observation and Run-level checks, shows diagnostics and affected Work Items, and places file reconciliation before inclusion reconciliation with expandable exclusion reasons. Evidence cards expose adapter extracts and Structural Snapshots; the grounding inspector shows original/normalized values, locator, label, and corroboration. The Timeline nests Session Step, Work Item, Step Execution, and Adapter Action rows, collapsed to Work Items by default. Rule-Classified evaluations show origin and value badges without controls; this epic has no Agent-Judged evaluation.

## Owner decision — 2026-09-05

Adapter Work Items automatically receive one additional bounded retry cycle after first exhaustion. The second exhaustion marks the item FAILED; the Run continues and incomplete coverage yields INCONCLUSIVE. No human retry/skip Escalation is required. Frozen retry and Run limits still apply. This owner-approved exception supersedes the general shared Escalation wording for this path; agent-driven Escalations and Session Step mapping are unchanged. See addendum revision 3, architecture revision 4, SPEC section 0 and updated Story 3.8.

## Cross-Story Dependencies

Epic 3 requires the Active Procedure version, period ownership, frozen registration/source digests, declared labels and coverage rules, and the CredentialProvider established by earlier procedure and registration work. It depends on shared queue/UnitOfWork, Timeline, EvidenceStore, integrity, and canonical-contract infrastructure. P-2 acquires the RoleMatrix before evaluation and emits AccessGate role observations; P-3 acquires the LedgerFlow population and performs ApproveNow approval lookups. Golden fixtures must include the expected Pass, Control Failure, Inconclusive, and Run Failed cases. The live-channel bound for the Runs list arrives with the later live-channel epic, so this epic must keep request-time reads and the stated stale-data behavior compatible with that integration.
