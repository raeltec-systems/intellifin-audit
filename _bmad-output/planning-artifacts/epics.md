---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - "_bmad-output/specs/spec-IntelliFin Audit/SPEC.md"
  - "_bmad-output/specs/spec-IntelliFin Audit/glossary.md"
  - "_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md"
  - "_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md"
---

# Zobba (formerly IntelliFin Audit) - Epic Breakdown

## 0. Owner-approved timing correction — 2026-09-04

Approval of a regression-gated successor records pending regression and its successor relationship without a speculative handover date. Actual activation after regression passes sets the authoritative boundary strictly after activation. The owner explicitly selected this behavior. This supersedes approval-time wording and invalidates prior downstream timing reviews: Story 2.8 and later Regression Run/scheduler contracts require revalidation. Execution and scheduler handover remain outside Epic 2.

## 0a. Course correction — 2026-09-24/25 (approved)

The owner's direction of 2026-09-24 re-centres the product as **Zobba**, a conversation-led audit-agent harness with the Pair identity, **Permissions** (formerly Mandate) and three tenant roles (Auditor · Audit manager · Admin). Approved record: `course-correction-2026-09-24/` Proposals 1–7 and `sprint-change-proposal-2026-09-24.md`; decisions D-3a-1..4, D-3b-1..4, D-3c-1..4, D-3d-1..4, D-4-1..4, D-4b-1..7, D-5-1..7, D-6-1..5, D-7-1..8. Baseline documents: PRD revision 4, addendum revision 5, ARCHITECTURE-SPINE revision 5 with `CONTRACT-REGISTER.md`, EXPERIENCE.md and DESIGN.md revision 2 (`ux-designs/ux-Zobba-2026-09-25/`).

**Dispositions of Epics 1–9:** Epics 1–3 done and retained. Epics 4 and 5: compiler-1 path; their stories in review close only against the legacy review-closure assessment (Story 10.1). Epic 6 split (6.1, 6.2 → 19.8; 6.3–6.5 → 15.4, 15.5, 15.9; 6.7, 6.8 → 14.11a, 14.11b; 6.6 retired, replaced by 18.3 and 18.4a). Epic 7 deferred indefinitely. Epic 8 absorbed into Epic 19 (8.1, 8.3 → 19.4; 8.2, 8.4 → 19.10; 8.5, 8.6 → 19.9). Epic 9 is the standing assurance epic with generalised proofs. **Epics 10–19** are the new plan (NE-0..NE-9 of Proposal 5; NE-8 story numbers shifted by one). **Slices govern delivery; epics govern capability ownership** (Proposal 5 §4): Slice 0 isolation proven, then Slices 1–4 to the first acceptance (Proposal 6). Story statuses use the tracking file's lifecycle vocabulary only; dispositions, replacements, parents of bounded parts, slices and retrospective obligations live in `_bmad-output/implementation-artifacts/course-correction-dispositions.yaml`.

Standing constraints on every story: no implementation without explicit authorisation; "Do not hard-code the scenario into the harness."; personal-account testing never represents organisational proof; credentials outside model-visible content and no external content changes permissions; tenant, client and engagement scoping enforced from day one; historical evidence, signed content and retained identifiers preserved; tests move with their implementation stories and none is retired to make a planning document pass.

## Overview

This document provides the complete epic and story breakdown for IntelliFin Audit, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: An authorized user can sign in and access only capabilities permitted to their role; unauthenticated requests reach no Procedure, Run, Evidence, Exception, Live View, Replay, or administration data; successful and failed authentication events are recorded.
FR2: Three roles exist: Auditor (author, submit, start and supervise Runs, answer Escalations, flag, investigate Exceptions, confirm Agent-Judged evaluations, annotate, submit Results), Audit Manager (all Auditor actions plus approve or reject Procedure Versions and approve, reject, or finalize Results, never a version they authored), and PoC Administrator (users, registrations, credential references, bindings; cannot author, approve, or alter Evidence, evaluations, or finalized Results). No administrator can alter Evidence.
FR3: Adapters and the Audit Agent can invoke only allowlisted read operations within the version's scope; writes, code or shell execution outside the sandbox, out-of-scope systems, origins, or parameters are denied and logged; retrieved content cannot change objective, permissions, tool scope, or Compliance Rule; a write-capable credential cannot be registered.
FR4: An Auditor creates a Procedure from one of four Templates (Terminated Users Retaining Access, Segregation-of-Duties Conflicts, High-Value Transactions Without Required Approval, Production Configuration Deviation), names the Control it verifies, and every Builder section is pre-populated from addendum §C; the hero Template is fully configurable, the other three at least in period, Population Source, Target Systems, and Schedule.
FR5: An Auditor sets an explicit period (date range) and scope; a scheduled Run derives and records its period; the scope statement is stored verbatim on the version and shown in every Result.
FR6: An Auditor binds a Population Source (manual upload only for `once`; versioned file or read-only API for daily, weekly, monthly) with a structured inclusion rule over declared columns and a declared-count mechanism; the version freezes the binding, each Run acquires and digests the snapshot as initial Evidence; the deterministic parser's output is the population of record; an empty post-inclusion population yields Inconclusive unless the version opts in to a zero-record Pass.
FR7: An Auditor selects one or more registered Target Systems of four kinds (web, desktop: agent-driven; API, versioned file: adapter-acquired); the version records kind, allowed origins or application, credential reference, permitted read actions, a registration digest, and per-attribute expected field labels or locator patterns; the PoC includes at least one web and one desktop system; the Auditor names systems explicitly.
FR8: An Auditor writes natural-language Audit Instructions per agent-driven Target System, stored verbatim and shown in plan, Live View, Replay, and Workpaper Bundle; 100% of seeded scope-widening instructions are flagged before submission and denied at execution as a security event.
FR9: An Auditor defines a Compliance Rule whose conditions compile to deterministic rules where possible and are otherwise marked Agent-Judged; every condition carries a compiled applicability predicate (default `found = true`); record evaluation derives in order Exception, Unevaluated, Compliant; an unnamed value evaluates Unevaluated with a diagnostic; boundary semantics are explicit; the P-3 USD 100,000 inclusive boundary is exercised; unmatched, ambiguous, uninspected, uncorroborated, or Unevaluated records are never Compliant.
FR10: An Auditor specifies Evidence Requirements (attribute values, Structural Snapshot, screenshot, source file excerpt, recording segment); snapshot and screenshot are always platform-captured for agent-driven systems and bound to the reading Tool Action with URL or window title; every attribute is grounded in a snapshot or file, never a screenshot; every `found = true` Observation carries a grounded identity attribute; a record missing required Evidence is never Compliant.
FR11: An Auditor sets a Schedule of once, daily, weekly, or monthly; it is part of the version, activates on approval (after any Regression Run), uses UTC and a fixed start time, and derives periods per addendum §B.
FR12: Before submitting, an Auditor reads the derived executable plan (Session Steps, ordered Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, limits); the plan is read-only, re-derived on any field change with each re-derivation recorded, frozen at approval, and an underivable plan blocks submission; derivation may use a model whose identity is recorded.
FR13: An Auditor submits a version; an Audit Manager who is not its author approves (freezing plan, Compliance Rule, Evidence Requirements, Target Systems, credential references, binding, model and tool configuration, limits, Schedule, and recording approver, time, and diff) or rejects with rationale, returning it to Draft on edit.
FR14: Every Run executes against exactly one approved version and retains it; any change to the frozen fields, or a platform-side model, prompt, tool, or registration change, mints a new draft (platform-authored when the platform caused it); the prior Schedule stays active until the successor is Active and the handover happens at a period boundary with no period run twice or skipped.
FR15: A version whose model, prompt, tool configuration, or registration digest differs from the prior approved version must complete a Regression Run on the Template's golden dataset before becoming Active; the Run is exempt from the overlap rule, labeled on the dashboard, confirmed from the golden confirmation script, must reproduce every expected terminal outcome except addendum §D exemptions, and a mismatch blocks activation.
FR16: An Auditor starts a Run for an Active version and period; overlapping active Runs for the same version and period are prevented; each Run has a unique correlation identifier and records the initiator.
FR17: The system starts a Run unattended when a Schedule falls due, recording the Schedule as initiator and the derived period; a missed or failed start is recorded and surfaced on the Runs dashboard, never skipped; at least one scheduled Run completes with no human session active.
FR18: A Run is shown as Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, or Canceled; platform failure, Control Failure, and waiting on a human are distinguishable; every transition records time, actor, reason, and prior state.
FR19: Each Run with agent-driven Steps gets a fresh, isolated Agent Workspace destroyed at Run end; nothing persists between workspaces; egress outside the allowlist is denied and logged; workspace creation failure yields Run Failed; adapter-only Runs need no workspace and show Adapter Session Steps in Live View.
FR20: The Audit Agent signs in once per agent-driven Target System as a Session Step, then for every record locates, inspects, captures Evidence, and registers a grounded Observation, all records per system before the next; per-Observation Gate checks and the deterministic evaluator run at registration; credentials are supplied just in time and never appear in Timeline, Evidence, logs, or exports; a record with no Observation is Uninspected; the agent stops and reports rather than guessing; after the last Work Item the Run-level Gate yields Completed or Inconclusive.
FR21: Adapters acquire the Population Source and every adapter-acquired Target System deterministically as Session Steps on the same Timeline, producing Observations in the same schema with grounding, declared counts, and digests, passing the same Gate, evaluation, and review; adding a kind is an Adapter-level change only.
FR22: A Run is Session Steps plus Work Items (one per record per agent-driven system, one per extraction for adapter-acquired systems), executed sequentially by one Audit Agent in the PoC; each Work Item has its own state, Step Executions, Observations, Evidence, and Timeline segment; the model must not assume one Run equals one worker.
FR23: The agent runs within fixed limits (retries per Step Execution, Run-level Step Execution count, time, tokens) with tools, model identity, configuration, and prompt version recorded per Run and unchangeable by retrieved content; exhaustion yields a retry-or-skip Escalation, Inconclusive, or Run Failed, never a fabricated Observation; retrieved content is stored untrusted and rendered inert.
FR24: An Auditor opens a Live View of a Running, Paused, or Awaiting Auditor Run showing current Step and Work Item, workspace screen, Observations, Evidence as registered, and any open Escalation, reflecting progress within 5 seconds; closing it does not affect the Run.
FR25: An Auditor pauses a Running Run (effective at the next Tool Action boundary) and resumes a Paused one; the workspace is preserved for 30 minutes, after which the Run ends Inconclusive with Evidence preserved; pause and resume record actor, time, and Step.
FR26: An authorized user cancels any active Run (Evidence preserved, Canceled reserved for explicit human cancellation) or starts a new linked Run without changing prior Runs.
FR27: The platform (or the agent for candidate choice) raises typed Escalations with closed answer sets: choose candidate (pick by declared secondary key, flagged human-matched everywhere, or mark ambiguous), unnamed value (mark Unevaluated and continue, or abort), retry or skip (retry once more, skip to Uninspected, or abort); abort ends the Run Canceled; the Run enters Awaiting Auditor; notes never reach the agent; the question is labeled agent-generated and inert; answers are scoped to the Run and appear in Timeline and Bundle; no answer evaluates a record or changes scope; an unanswered Escalation times out after 4 hours to Inconclusive; an Auditor flag notifies Audit Managers with no execution effect.
FR28: Entering Awaiting Auditor or a flag notifies the initiating Auditor (or author for scheduled Runs) and every Audit Manager in-app and by email; each delivery or failure is recorded on the Audit Trail; content names Procedure, Run, kind, and time remaining and contains no Evidence or secrets.
FR29: An authorized user inspects the ordered Execution Timeline (Session Steps, Work Items, Step Executions, sanitized Tool Actions, Observations, Evidence registrations, rule and Agent-Judged evaluations with rationale, Escalations and answers, pauses, retries, errors, limits, model and component versions), written as events occur and authoritative; secrets never appear.
FR30: An authorized user replays any terminal Run from the platform-owned Replay asset set (per Tool Action a timestamped frame, sanitized action, Observation delta; Escalation events) aligned to Steps with jumps to any Work Item, Exception, or Escalation; Replay works with the Workspace Provider blocked and after its retention expires and never re-executes actions.
FR31: The agent and Adapters capture Evidence Requirements per record into the Evidence Package; each item records Work Item, Target System, Step, capture method, UTC time, and digest; each Observation links to its Evidence with grounding per attribute; originals remain available; an Absence Observation is valid only with addendum §B.1 evidence, otherwise the Work Item is Uninspected.
FR32: Every Run has an Evidence Package in which every evaluated record and Exception traces to Observations, Evidence, Steps, and version; later source changes or provider retention expiry never remove preserved Evidence.
FR33: Before any conclusion the Evidence Quality Gate runs every addendum §H check (per-Observation at registration, Run-level at end); corroboration re-reads every attribute and the identity attribute from the stored Structural Snapshot with a deterministic extractor (value equals original, label matches declared, identity equals record key) and any mismatch marks the attribute contradictory, the record Unevaluated, and the Run Inconclusive; model-read attributes are declared on the version; declared and collected counts match exactly at file level and rows in, included, and excluded reconcile at inclusion level; each check has a visible outcome and diagnostic.
FR34: A Run is Inconclusive when Evidence is insufficient, contradictory, or leaves a condition Unevaluated, and Run Failed when Run-level execution cannot complete; neither is a conclusion; per-Work-Item failure continues the Run and yields Inconclusive via coverage; Session Step failure or a denied action yields Run Failed; the Result names affected systems, checks, Work Items, and records.
FR35: No user or administrator can alter stored Evidence, Observations, Timeline, or lineage; an integrity mismatch during a Run ends it Run Failed, afterwards it is an Audit Trail integrity event flagged on the Result and exports with no state change; corrections require a new Run.
FR36: The system normalizes attributes with originals and transformation history retained, matches records to Observations by exact keys, normalizes date-times to UTC preserving source offsets, and shows unmatched and multiply matched records, which are never Compliant.
FR37: Each compiled condition is applied to each corroborated Observation as a Rule-Classified evaluation; identical Observations and version give identical evaluations; no human can override one, disagreement is recorded separately.
FR38: For each uncompiled condition and applicable record the agent records an Agent-Judged evaluation with rationale, Evidence, and confidence in [0, 1]; it is excluded from the outcome until confirmed, and the Result is Pending Confirmation and unsealed while any is pending; an Auditor confirms or rejects (rejection sets Compliant, Exception, or Unevaluated with rationale as human-classified, history retained); origins are visibly distinguished everywhere; below the version's confidence threshold (default 0.80) the evaluation is stored Unevaluated and needs no confirmation.
FR39: Each Result reports the population, exclusions with reasons, inspected and uninspected records per Target System, per-condition counts by origin and confirmation state, and the Template's control-specific fields per addendum §C; excluded, uninspected, or Unevaluated records are never counted Compliant.
FR40: An Auditor views a Run's version, period, Gate, coverage, counts, status, and outcome; the Result seals when the Gate has passed and every evaluation is resolved, computing the System Outcome once; Pass, Control Failure, Pending Confirmation, Inconclusive, Run Failed, and Canceled are distinct; Pending Confirmation precedes Control Failure; Pass requires all Gate checks passed, sealed, and no Exception or Unevaluated condition; Gate pass is necessary not sufficient; the Result version increments per confirmation or rejection; a rejection leaving Unevaluated moves Completed to Inconclusive at sealing.
FR41: An Auditor opens each Exception to view the violated condition, Observation and grounding, compared values, lineage, Timeline segment and Replay position, and origin; each Exception has a stable Run identifier and a fingerprint stable across compatible versions; designated sensitive fields are masked in lists.
FR42: An Auditor assigns an Exception, adds notes, and sets Open, Under Review, Confirmed, or Not an Exception; Not an Exception requires rationale and retains the evaluation and outcome; changes keep actor, time, prior value, and rationale.
FR43: An Auditor submits a sealed Completed Result; an Audit Manager approves, rejects (an event returning it to Draft), and finalizes only an approved Result, recording reviewer, time, decision, Result version, and Procedure Version; submission of unsealed, Inconclusive, Run Failed, or Canceled Runs is blocked; direct finalization from Draft or Submitted and any post-finalization mutation are denied and logged.
FR44: An Audit Manager records disagreement with a Rule-Classified evaluation or System Outcome only with rationale; nothing is overridden; the disagreement appears in the Audit Trail and Bundle.
FR45: An append-only Audit Trail records security, authoring, approval, Schedule, Run, workspace, Evidence, Escalation, notification, evaluation, confirmation, review, export, error, model and prompt change, and disagreement events with actor, type, UTC time, source, outcome, and correlation identifier; mutation is detectable.
FR46: An authorized user exports a self-contained Workpaper Bundle for any terminal Run (including Inconclusive and Run Failed) containing addendum §F contents, the Replay asset set, and an integrity manifest, readable without source code.
FR47: A reviewer uses the Bundle to reproduce a sampled Rule-Classified evaluation from its grounded Observation and re-examine a sampled Agent-Judged one; reproduction reads stored Structural Snapshots only, with no live system or Workspace Provider.
FR48: An authorized user filters Runs by Procedure, status, initiator, period, and start time and sees upcoming and missed scheduled Runs; Control Failure, Pending Confirmation, Awaiting Auditor, and technical or evidence failures have separate filters and labels; the dashboard updates within 5 seconds without reload.
FR49: A PoC Administrator views Target System connectivity, Workspace Provider and Audit Runner health, errors, retries, limit consumption, and Run duration without secrets; diagnostics link to the Run and correlation identifier and cannot alter a Result.
FR50: The PoC records per Procedure the SM-11 measures (authoring and approval time, Escalations and interventions per Run, Not-an-Exception dispositions, approval and rejection counts, tokens and provider time per Run, procedure-specific code and reusable components, maintenance effort including Regression Runs); procedure-specific code references a Template, Control, or Target System by identity and the hero target is zero.

### NonFunctional Requirements

NFR1: Security: encrypt data in transit and at rest; secrets outside application data; redact secrets from logs, Timelines, and exports; automated tests deny cross-user and cross-Run data leakage.
NFR2: Agent safety: automated abuse tests prove retrieved content, including through an Escalation question, cannot expand scope, invoke denied tools, disclose secrets, alter the Compliance Rule, or modify the Run objective.
NFR3: Integrity: verification detects modification of preserved Evidence, Observations, Timelines, finalized Results, and Audit Trail records.
NFR4: Determinism: repeating evaluation on the same frozen Observations and version yields identical Rule-Classified evaluations; Agent-Judged evaluations are re-examinable from preserved rationale and Evidence.
NFR5: Workspace isolation: each workspace is isolated from other Runs and the web app, holds no credential after the Run, reaches only allowlisted destinations; verified by negative tests.
NFR6: Performance: hero Runs of up to 50 records across two agent-driven systems complete within 30 minutes excluding waits (95%); adapter-only Runs of up to 10,000 records within 5 minutes (95%); hero golden populations are 20 records or fewer.
NFR7: Live responsiveness: Live View and Runs dashboard reflect state within 5 seconds; 95% of list and detail views respond within 2 seconds at 5 concurrent users.
NFR8: Reliability: a transient failure is retried at most 3 times with bounded backoff without duplicate Observations, Results, or Evidence; exhausted retries map to Run Failed, a retry-or-skip Escalation, or Inconclusive per addendum §E.
NFR9: Schedule reliability: a due Schedule starts within 5 minutes or records a missed start; a restart loses or duplicates no scheduled Run.
NFR10: Recovery: daily backup, 24-hour RPO, 8-hour RTO; a restore drill reconstructs a finalized Run with every digest verified.
NFR11: Accessibility: Builder, Live View, Replay, and core workflows pass automated WCAG 2.1 AA checks and are keyboard accessible.
NFR12: Observability: every Run exposes duration, per-Step and per-Target System latency, Work Item counts and states, retries, limits consumed, Escalations, status, error class, and correlation identifier.
NFR13: Data handling: synthetic data only, including in recordings sent to the Workspace Provider.
NFR14: Retention: Run data, Evidence, Timelines, Replay assets, Results, and Audit Trails remain for the PoC lifetime and are deleted only by documented teardown; Replay never depends on provider retention.
NFR15: Runner portability: Runner, workspace, and Adapter contracts separate execution, credentials, access, and Evidence return from the web app to preserve a future private runner; one Adapter contract per Source and Target System kind.

### Additional Requirements

**Starter and bootstrap (Epic 1 Story 1 input).** No third-party starter; the spine seeds a pnpm workspace monorepo: `apps/web` (Next.js 16 composition root: UI, route handlers, SSE, sealing), `apps/worker` (pg-boss consumer, scheduler, Run executor, workspace lifecycle, notification delivery), `packages/domain`, `packages/application`, `packages/infrastructure`, `tests/fixtures`, `tests/integration`, `tests/e2e`. Stack seed (verified 2026-09-01): Node.js 24.20.0 LTS, TypeScript 7.0.2 (fallback 6.x), Next.js 16.3.4, React 19.2.8, PostgreSQL 18.6 (`ghcr.io/railwayapp-templates/postgres-ssl:18`), pnpm 11.25.0, Drizzle ORM 0.45.2 / Kit 0.31.10, postgres.js 3.4.9, pg-boss 12.29.0, Better Auth 1.7.2, Vercel AI SDK 7.0.89 with OpenAI 4.0.55 and Anthropic 4.0.47 providers, @solarisdk/browser 0.1.2, @solarisdk/sandbox 0.1.2, Resend 6.25.0, AWS SDK S3 client 3.1124.0, Zod 4.5.4, Pino 10.3.1, Sentry 10.73.0, Vitest 4.1.11, Playwright 1.62.1, Railway hosting. Default model `claude-sonnet-5` via the Anthropic provider with OpenAI wired as fallback.

- AD-1 Strict inward dependencies: `domain` imports nothing outward; `application` imports only `domain`; `infrastructure` implements inward ports; apps are composition roots; no Drizzle, pg-boss, Solari, AI SDK, Resend, S3, Railway, Better Auth, Next.js, Pino, or Sentry types inward; boundaries enforced in CI.
- AD-2 Audit core owns meaning: domain owns entities, state machines, invariants; command handlers are the only mutation path; Run `kind ∈ {STANDARD, REGRESSION}`; registration digest is SHA-256 over RFC 8785 canonical JSON of `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key}` computed by one `registrations` function; the compiled plan is consumed byte-for-byte by the worker; Templates are data in `procedures`; modules never touch each other's tables.
- AD-3 Durable async execution: one durable job per Run; Timeline event appended in the same transaction as every effect; per-Observation Gate plus evaluator in one transaction at registration; `CompleteRun` commits Gate decision, Result, state, checkpoint, and events atomically; idempotent revisioned checkpoints; one retry policy (3 retries per Step Execution, then retry-or-skip Escalation, then `FAILED`); Session Step exhaustion, denied action, or during-Run integrity mismatch is `RUN_FAILED`; Run-level limit exhaustion is `INCONCLUSIVE`; Adapter batch registration is one transaction and one Timeline event; uniqueness on `(Procedure, effective period)` for STANDARD Runs; `InitiateRun` resolves the version from period ownership; `CancelRun` writes `cancel_requested`, worker transitions at next Tool Action boundary, web transitions `QUEUED`; `SealPackage` in every terminal transition; rerun creates a linked Run.
- AD-4 Evidence acquisition boundary: application-owned `EvidenceAcquisition` port with one Observation schema; Adapters for Sources and file/API systems; the agent via `BrowserExecution` and `DesktopExecution`; workspace only for agent-driven Runs; opaque `CredentialRef` plus `CredentialProvider` just-in-time supply; conformance contracts cover allowlists, read-only actions, redirects, downloads, snapshot capture, focused-record identity, sanitized logging, cancellation, timeouts, trace ordering; snapshot and frame capture suppressed during credential entry with secret redaction and a seeded negative test; Solari browser SDK with request interception; Solari sandbox desktop for session, actions, screenshots, stream; in-VM snapshot agent reads the LedgerDesk localhost JSON snapshot endpoint (no AT-SPI) on a project-owned desktop template.
- AD-5 Sealed Evidence: artifact reservation with idempotency key and unique object key before upload; `EvidenceStore` verifies availability, size, digest before Registered; reconciler for pending or orphaned objects; artifact kinds Structural Snapshot, screenshot, recording segment, source excerpt, Adapter extract, uploaded Source file; `role ∈ {required, replay}`; `SealPackage` seals only when every required artifact is Registered; abandoned reservations listed on Result and export; application-mediated access of at most five minutes, no durable URLs; SHA-256 on every consumption; Workpaper Bundle layout: signed `manifest.json`, `keys/`, `artifacts/<sha256>`, versioned JSON members; Railway storage is tamper-evident not WORM.
- AD-6 Grounded corroborated evaluation: grounding into snapshot or file only; identity attribute in the same snapshot; `match` provenance node for platform key matching; human-matched identity corroboration by secondary key; absence evidence per `capture_method`; deterministic corroboration function in domain; applicability predicates over `found`, `match_origin`, matched attributes, fail-closed to Unevaluated; `found = ambiguous` makes every condition Unevaluated; registration envelope carries agent evaluations; Exception created in the first `EXCEPTION` transaction with Run-stable id and HMAC-SHA-256 fingerprint (key ID retained); `counts_toward_outcome` at `SealResult`; Run-level condition-completeness failure for non-HUMAN `UNEVALUATED`; compatibility declared at approval (same Procedure, matching key, Compliance Rule digest).
- AD-7 Human decisions as separate state: sealed outcome, evaluations, and review state are separate aggregates; every transition records actor, time, prior state, decision, rationale, revision; expected-revision precondition on every human mutation; Better Auth for identity only, application roles authorize everything; initiation snapshots authorization and the worker executes as a service principal; free text never reaches the model; sensitive fields masked in lists, unmasked in Exception Detail and exports with audited reads; submission requires a sealed `COMPLETED` Result.
- AD-8 PostgreSQL system of record: relational state, Timeline, Schedules, notifications, queue state; Drizzle repositories behind ports; reviewed migrations; application `UnitOfWork` across module repositories; snapshots and append-only events in the same transaction; binary Evidence in `EvidenceStore`.
- AD-9 Bounded agentic execution: `ModelGateway` and tool ports with application-owned types and one conformance contract; per-version allowed origins, tools, limits, objective, model data policy; typed Escalations with closed answers, the agent receives only the option identifier; platform-derived narration from sanitized Tool Actions is trusted, agent narration labeled; minimized fields to providers; direct OpenAI and Anthropic adapters; persist provider route, model identity, configuration, prompt versions, build version, sanitized tool activity, limits, terminal reason; agent text stored untrusted and rendered inert; Replay asset set captured during execution.
- AD-10 Telemetry versus audit evidence: one correlation chain across request, Run, job, Step, Work Item, Tool Action, provider call, capture, notification, SSE; allowlist telemetry sanitizer, Pino redaction, Sentry `sendDefaultPii: false`, no AI input or output capture; seeded negative tests; diagnostics are rows the worker writes and the web reads; immutable chained audit events with actor, decision, UTC time, session, correlation ID.
- AD-11 Replaceable deployment: web and worker as separate containers from one repo; secrets only in composition roots; Railway services, PostgreSQL 18, private S3-compatible bucket; daily PostgreSQL backup and sealed-Evidence copy to a separately credentialed recovery bucket; restore drills against 24-hour RPO and 8-hour RTO; data retained for PoC lifetime.
- AD-12 Tests defend seams: deterministic domain tests on addendum §D seeds; golden datasets, expected outcomes, and confirmation scripts as versioned product data mirrored into `tests/fixtures`; one shared conformance suite per outbound port; integration tests against real PostgreSQL and object storage (atomic publication, crash points, wait resume, retry budgets, optimistic concurrency, canonical vectors, Regression comparison, recovery); Replay with provider blocked; Playwright for Builder to approval, initiation, Live View with pause and Escalation answer, review and export, keyboard, and WCAG checks; CI runs types, boundaries, migrations, unit, integration, e2e, security-negative, NFR acceptance.
- AD-13 Thesis evidence as product data: structured Run and Procedure metrics for FR50 queryable across the four Templates.
- AD-14 Versioned durable contracts: Zod wire schema with `schemaVersion` and upcasters for jobs, checkpoints, Observations, snapshots, Timeline events, Replay assets, Escalations, notifications, Templates, plans, audit events, manifests, Bundles; additive changes within a release; compatibility fixtures in CI; provenance as a directed graph with stable IDs.
- AD-15 Releases preserve active Runs: pipeline-only migrations, expand then migrate then deploy then drain then contract; startup checks of schema and contract ranges; waiting Runs resume on new worker builds.
- AD-16 Durable waits: `PAUSED` and `AWAITING_AUDITOR` persisted with checkpoint, wait record `{kind, options, deadline, closed_at?, closure_kind?, answer_option_id?, actor?}`, and workspace lease; deadlines 30 minutes and 4 hours; one durable job per wait with `startAfter = deadline` and singleton key `wait:<wait id>`; closure is one command locking the wait row with expected revision; wake handler applies exactly one outcome; orphan reaping and credential revocation on every terminal transition and sweep; resume reattaches (`attach(WorkspaceRef)`, `release`) and restarts the current Step Execution as a new attempt marked `superseded_by_resume`; no model state across waits; pause refused while awaiting an answer.
- AD-17 Timeline as live source with SSE: `NOTIFY run_timeline(run_id, seq)` per event; SSE route `/runs/<run-id>/events?after=<seq>` replaying from the Timeline on reconnect; one renderer for Live View and Replay over the Replay asset set; heartbeat at most every 30 seconds, stream lifetime under 15 minutes; subscribing surfaces: Live View, active Run Detail, Runs list, Overview counts, notification badge; 5-second freshness, 15-second stale indicator; no WebSocket, Redis, or provider stream.
- AD-18 One Observation contract: both paths emit the schema with `capture_method`, grounding, identity, `match_origin`; Work Item granularity per Template coverage rule; population parsing is Adapter work; Reference Sources acquired as Session Steps and frozen before evaluation, no I/O in the evaluator; Structural Snapshot substrate kinds `{web_tree, desktop_tree, sheet, json}` with locator grammar and label rule; one domain extractor for all four.
- AD-19 Schedules as application data: Schedule frozen on the version; worker scheduler enqueues one Run per (version, period) under a unique constraint; missed start recorded; `handover_at` computed at actual activation and stored on both versions; predecessor `ACTIVE → RETIRED` by the scheduler; `REGRESSION` Run started only by approval when digests differ, on the golden binding, exempt from overlap, never reviewed or notified, compared to golden expectations, records `RegressionPassed | RegressionFailed`; `once` Schedules run manually; Reference Sources acquired at Run start.
- AD-20 Audited notifications: notification records created in the state-change transaction for the initiating Auditor or author and every Audit Manager; submission notifies Audit Managers, approval or rejection notifies the author (in-app only); `NotificationSender` with at-least-once delivery, idempotent send keys, `superseded` skip when the wait is closed, time remaining computed at send, delivery outcome as an audit event; in-app Notifications is a query over open waits and flags.
- AD-21 Results sealed by one command: `CompleteRun` publishes the Result and pending count; `ConfirmEvaluation` and `RejectEvaluation` refused unless `COMPLETED` and unsealed, lock the Result row, carry expected revision, increment revision, evaluate the seal condition; `SealResult` from either process computes the outcome once, seals Control Failure with Unevaluated listed, or moves to `INCONCLUSIVE` when Unevaluated and no Exception counts; every later evaluation mutation refused.
- AD-22 Chained events and signed manifests: one product event store; Timeline is the Run aggregate's chain; system events chain on their own or a `platform` aggregate; transactionally allocated sequence and head; Observation registration events carry the Observation digest; UTF-8 RFC 8785 canonical JSON, SHA-256 links; finalization obtains an Ed25519 signature then stores manifest, signature, event, and `FINALIZED` atomically; signature envelope records format, algorithm, key ID, fingerprint, time; `ManifestSigner` port with the PoC key as a Railway secret and a retained public verification bundle; golden and tampered vectors.
- AD-23 Owned deterministic plan derivation: `PlanCompiler` in `procedures` with compiler version frozen on the version; derivation as a queued worker job that may call `ModelGateway`, derivation model and prompt recorded; every re-derivation recorded, Builder shows re-deriving, underivable plan blocks submission; domain validation rules: upload requires `once`, declared-count mechanism required, zero-record-Pass and versioned-duplicate flags, explicit boundary semantics, default applicability `found = true`, derivation order Exception then Unevaluated then Compliant, scope-widening check at authoring.
- Modules: `identity`, `registrations` (rejects write-capable credentials; change events handled by `procedures` in the same UnitOfWork), `procedures`, `runs`, `evidence`, `evaluation`, `review`, `notifications`. Ports: `EvidenceAcquisition`, `BrowserExecution`, `DesktopExecution`, `EvidenceStore`, `ModelGateway`, `CredentialProvider`, `ManifestSigner`, `RunDispatcher`, `NotificationSender`, repository ports.
- Conventions: UUIDv7 identifiers; UTC `timestamptz`; ISO 8601 at boundaries; string identifiers preserving leading zeros; one transaction per state transition; wait records; closed failure taxonomy owned by application; shared sanitized-action schema for Tool Actions and Adapter Actions; distinct principal fields; `schemaVersion` on every envelope; runtime-validated configuration only in composition roots; Zod at adapter boundaries.
- Synthetic environment (addendum §A): Northstar Financial Group; Population Sources Leavers export (versioned `.xlsx`, signed cover sheet), PeopleHub (API), AccessGate (API or CSV), LedgerFlow (API or CSV), ConfigRegistry (versioned file); Target Systems LoanCore (synthetic web app with user administration), LedgerDesk (synthetic Linux desktop app with localhost JSON snapshot endpoint), AccessGate (API), ApproveNow (API), ProdConsole (web configuration page with signed snapshot identifier and parameter count); Reference Source RoleMatrix; each system refuses writes from the audit credential.
- Golden datasets (addendum §D) per Template with declared expected terminal outcomes: two compliant, two true Exceptions, a boundary case (P-1 24-hour variant), missing mandatory value, duplicate or ambiguous record, stale population, uncapturable Evidence, simulated failure, two injection strings (one shaping an Escalation), wrong-employee page, value in a non-field element, mistyped search key, seeded transcription error, silent timeout or partial pagination, three scope-widening instructions, and for the hero: a correct C2 case, a genuinely ambiguous role list, a choose-candidate trigger, and a `Suspended` account; expected evaluations and confirmation scripts versioned separately; hero populations of 20 records or fewer.
- Template contracts (addendum §C): P-1 Terminated Users (Leavers export, LoanCore then LedgerDesk, C1 compiled over `account_status`, C2 Agent-Judged over privileged roles, labels Status, Username, Roles, Employee ID, secondary key full name, weekly); P-2 Segregation of Duties (AccessGate plus RoleMatrix, three conflict pairs, one adapter Work Item); P-3 High-Value Transactions (LedgerFlow plus ApproveNow, USD 100,000 inclusive boundary); P-4 Production Configuration Deviation (ConfigRegistry plus ProdConsole, four parameters, one agent Work Item owning one Observation per parameter).
- Evidence Quality Gate rows (addendum §H): workspace and Target System access (`RUN_FAILED`); population acquisition; file-level and inclusion-level count reconciliation; empty population; per-record coverage; identity corroboration; search completeness; required Evidence; Observation corroboration; condition completeness; pagination or extraction completeness; schema; mandatory values; duplicate keys; ambiguous match; unnamed value; snapshot freshness; Target System freshness; integrity.
- Resolved decisions (2026-09-01): provider recordings copied to platform storage at Run end with provider retention at minimum; archive is the only export; Agent-Judged confidence threshold per version defaulting to 0.80; extractors are web accessibility tree, LedgerDesk snapshot endpoint, CSV and XLSX parser, JSON path; the hero declares no model-read attribute.

### UX Design Requirements

UX-DR1: Implement the Ledger Signal token set from DESIGN.md as CSS variables: colors (navy #102A43 and shades, teal #0F766E as the only interactive color, gold #C0942F brand mark only, surface page/card/sunken/sidebar/selected, borders, text primary/secondary/muted/inverse/link, focus #0F766E, success/warning/danger/info/neutral bg-border-text sets, info-solid #1D4ED8, danger-solid #B91C1C, neutral-solid #64748B, scrim navy at 0.45), typography roles (Inter sans, ui-monospace mono; page-title 20/28/600, card-title 16/24/600, sub-title 14/20/600, body 14/21, body-sm 13/18, body-sm-relaxed 13/19, row-title 13/18/500, caption 12/16, caption-relaxed 12/17, overline 12/16/500 0.02em, micro 11/15/500), radii (4, 6, 8, full), and spacing (4-24 scale, gutter 24, card padding 20, sidebar 240, top bar 56, ribbon 32, content max 1320, builder max 880, rails 340/380/360/320, controls 32/36, chip 28, tabs 38, badges 20/24, dialog 560).
UX-DR2: Consume the IntelliFin Design System shell and base components by name (Sidebar, Button, StatusBadge, Banner, EnvironmentRibbon, EmptyState, Tabs, Icon) and extend StatusBadge locally with the info-solid variant; the bundle is external, every needed token value is restated in DESIGN.md.
UX-DR3: Implement the status badge with eight state families, each state carrying an icon and its exact name, never color alone: Procedure Version (Draft, Submitted, Approved, Rejected, Active, Retired), Run lifecycle (Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, Canceled), Evidence Quality Gate (Passed, Not passed, Incomplete, Not evaluated), Result outcome (Pass, Control Failure, Pending Confirmation, No conclusion issued), Auditor Review (Draft, Submitted, Approved, Finalized), Exception (Open, Under Review, Confirmed, Not an Exception), Evaluation origin (Rule-Classified, Agent-Judged pending, Agent-Judged confirmed, Human-classified), Evaluation value (Compliant, Exception, Unevaluated), plus Work Item (Pending, In progress, Awaiting, Observed, Uninspected, Ambiguous, Failed).
UX-DR4: One "needs a human" treatment: Awaiting Auditor, Pending Confirmation, Agent-Judged pending, and Work Item Awaiting use info-solid with the user icon and nothing else does; Completed is a neutral badge; green only for Pass, passed Gate, Compliant, Observed; gold never for status; no Rejected review badge, rejection is history.
UX-DR5: Application shell: sidebar areas Overview, Procedures, Runs (active count), Review (awaiting count), Administration (PoC Administrator only); top bar with notification bell and unread count; EnvironmentRibbon; breadcrumbs on every detail surface; sidebar highlight rules for detail surfaces; modals one level deep.
UX-DR6: Overview surface: needs-attention list ordered Awaiting Auditor (countdown), Pending Confirmation, Submitted for review, Approved awaiting finalization, Inconclusive, Run Failed, missed scheduled start, each row naming Run, Procedure, state, one action; Recent Runs table (Run, Procedure, Lifecycle, Result outcome, Gate); two empty states whose copy refuses to imply a passed control.
UX-DR7: Procedures surface: Procedure cards with Active version, Schedule, next Run, last outcome; "New procedure" action; empty state with that as the only action.
UX-DR8: Procedure Builder surface: single column of sections (Template and Control, Period and scope, Population Source binding, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, Schedule) pre-filled from the Template; on-blur validation with inline warnings (missing declared-count mechanism, upload with non-once Schedule, scope-widening instruction, uncompiled condition without applicability); Submit disabled with listed reasons while any blocker or underivable plan exists.
UX-DR9: Compliance Rule editor: condition rows with text, origin badge (Rule-Classified when compiled, Agent-Judged when not), applicability predicate defaulting to `found = true`, boundary semantics selector, tolerance as a compiled numeric condition, and a per-version confidence threshold field.
UX-DR10: Plan preview and Builder re-derivation: read-only rows for Session Steps, Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, limits, model identity; "Re-deriving…" then "Re-derived {time}" on every field change; "Cannot derive: {reason}" when underivable; no edit controls.
UX-DR11: Procedure Detail surface: versions list with states, approval banner naming who can approve, author-cannot-approve notice, Rejected rationale inline with Edit returning to Draft, platform-authored draft notice naming the cause, Regression Run row while Approved-not-Active, Active state with next Run and Initiate Run, Retired read-only with successor, New version creating a Draft copy, Run history table (Run, Effective period, Lifecycle, Result outcome).
UX-DR12: Version review surface: section-by-section diff against the previous version (all expanded for a first version) using the version-diff component; Approve or Reject with rationale; author cannot approve with reason stated; approving a version with changed model, prompt, tool, or registration digest starts the Regression Run shown inline; Regression mismatch listed per golden expectation with activation blocked.
UX-DR13: Runs surface: filter bar (Procedure select, single-select status chips over eight lifecycle states plus Pending Confirmation and Regression Run, initiator chips Manual and Schedule, search over identifier, Procedure, initiator, Clear filters); table columns Run, Procedure, Effective period, Lifecycle, Result outcome, Gate, Review, Initiator, Elapsed, Change; upcoming and missed scheduled Runs with a warning row linking to diagnostics; pagination; filtered empty state; live updates within 5 seconds.
UX-DR14: Run Detail surface with tabs Result, Evidence, Exceptions, Review, Execution Timeline; conclusion triptych (lifecycle, Gate, outcome with pending count, sealed marker, Result version) over a generated statement; action bar with Watch, Pause, Resume, Cancel, Submit, Export, and rail cards (Procedure Version and Schedule, Auditor Review state, Change since previous Run or "Not comparable", Technical detail, Open Escalation, Session).
UX-DR15: Run Detail per-state treatments for Queued, Running, Paused (countdown banner), Awaiting Auditor (Escalation panel on every tab, Pause disabled with reason), Completed unsealed, Completed sealed, Inconclusive (failed Gate rows first, Safe next action panel, Submit disabled with reason), Run Failed (execution-failure panel naming Session Step, retries, error class), Canceled, Regression Run label with confirmation script and golden comparison, and Finalized (every mutating action disabled with the finalization reason, integrity flag when present).
UX-DR16: Evidence Quality Gate checklist component: rows from addendum §H grouped under Per-Observation checks (live during a Run) and Run-level checks, each with status icon, word, rule text, diagnostic, and links to affected Work Items; compact on Result, expanded on Evidence; header count derived.
UX-DR17: Population reconciliation component: file-level rows (declared, parsed, digest) above inclusion-level rows (rows in, included, excluded with reasons expanding), empty population rendered Inconclusive unless opted in.
UX-DR18: Evaluation card and confirmation: one card per condition per record with origin badge, value badge, rationale, confidence in mono; Rule-Classified cards have no controls but "Record disagreement" beside them; pending Agent-Judged cards carry Confirm and Reject; Reject opens a rationale dialog requiring a rationale and a replacement value recorded Human-classified with the rejected evaluation kept beneath as history; low-confidence cards show Unevaluated with confidence and no controls.
UX-DR19: Evidence tab: one Evidence item card per item with FR31 fields and kind badge (Structural Snapshot, Screenshot, Source excerpt, Recording segment, Adapter extract), snapshots opening the grounding inspector, recording segments opening Replay at that Tool Action, partial or preserved-after-cancel notes; originals never truncated.
UX-DR20: Grounding inspector component: per attribute the original value, normalized value, Structural Snapshot at the locator, locator and label in mono, corroboration badge explaining mismatches, model-read attributes linking to the condition they made Agent-Judged, human-matched badge linking to the Escalation answer.
UX-DR21: Exception Detail surface: provenance chain (population record, Observation with grounding, corroboration and match origin, evaluations, Exception, Timeline segment opening Replay at the Tool Action), evaluation cards, header state badge, "Assigned to" with Set Under review, Confirm, Set Not an Exception actions, disposition history and notes in the rail, Not an Exception rationale card with the evaluation and sealed outcome unchanged, masked fields shown as `••••` with reason and unmasked only there for Auditor and Audit Manager, untrusted content block, all actions disabled on a finalized Run.
UX-DR22: Exception list row: identifier link in mono, state badge, condition violated, origin badge, masked identity, persistent Open link, ordered by identifier, "counts after confirmation" when the only Exception evaluation is pending.
UX-DR23: Execution Timeline tab: nested rows Session Step, Work Item, Step Execution, Tool Action on the four-column grid with 20px indent per level, collapsed to Work Item rows by default with Escalations, retries, errors, limits, and version stamps always expanded, call boxes in mono, "Open in Replay" on every row, written live while Running.
UX-DR24: Session viewer component shared by Live View and Replay: sandboxed viewport under a navy chrome strip with state dot and word (LIVE, PAUSED, AWAITING, REPLAY); live controls Pause or Resume, Cancel, Flag to Audit Manager, and the Escalation panel; replay controls play or pause, scrubber, jump to Work Item, Exception, or Escalation; frames from the Replay asset set; adapter Session Steps as log rows with counts and digests.
UX-DR25: Live View surface states: Live (frames within 5 seconds), Paused (last frame held, Resume replaces Pause), Awaiting Auditor (countdown, Escalation panel focused, screen visible), adapter-only, Run ended while open (chrome flips to REPLAY, controls disable, Banner links Run Detail), stream lost (stale indicator after 15 seconds, reconnecting Banner after 60 seconds with controls disabled), below 1024px read-only with reason.
UX-DR26: Replay surface: chrome REPLAY, starts paused at the first frame, jump list of Work Items, Exceptions, Escalations, works with the Workspace Provider unreachable, never re-executes.
UX-DR27: Escalation panel component: one open Escalation per Run showing kind, Step, inert agent-generated question labeled as such, supporting Evidence (captured result rows with grounded keys for choose candidate), closed answer buttons in FR27 order with no recommendation, optional note labeled "Recorded, not sent to the agent", countdown; answer opens a routine confirmation; abort opens the cancel confirmation; after answering the panel becomes a Timeline entry; reachable by a skip link.
UX-DR28: Review surface: queue rows (Run, Procedure, Result outcome, Exceptions, Gate, Review state, Open) ordered by submission time, excluding Regression and Pending Confirmation Runs; finalized Results list; empty state "No Result awaits your decision."
UX-DR29: Review tab actions: Submit (sealed Completed only, disabled with reasons otherwise), Approve, Reject with rationale, Finalize as a destructive finalization dialog naming irreversibility, Record disagreement with rationale; review history with actor, time, rationale.
UX-DR30: Notifications surface and top-bar menu: one row per Awaiting Auditor or flagged Run with Procedure, Run, Escalation kind, time remaining, opening Live View; email notifications deep-link to Live View or Run Detail; empty state "No Run is waiting on you."
UX-DR31: Administration surface (PoC Administrator only): users and roles; Target System registrations table (System, Kind, Origin or application, Credential reference, Permitted actions, Registration digest, Connectivity); Population Source bindings; Workspace Provider and Audit Runner health; diagnostics; write-capable credential save blocked with "Audit credentials must be read-only."; registration change warns "This change creates a platform-authored draft for {n} Procedures and requires approval."
UX-DR32: Action bar and unavailable actions: disabled actions keep their position, their reason appears in an "Unavailable actions" panel and as the accessible description, never tooltip-only; Export Workpaper Bundle available on any terminal Run; permission-denied actions visible, disabled, with reason.
UX-DR33: Confirmation dialog component with three weights: routine (restates consequence), routine with rationale (non-empty rationale field), finalization (destructive button, title names irreversibility); focus trapped and restored, Escape cancels, initial focus on first field or Cancel; result shown as a Banner; failed action shows a destructive Banner "Couldn't {action}. Nothing was changed." with the platform reason and no optimistic updates.
UX-DR34: Data table pattern: overline header on a sunken ground, hairline rows, first cell a row-title link, numeric columns right-aligned in mono, `<th scope>`, captions, no row-level click handlers; Safe next action and execution-failure panels; untrusted source content rendered as a warning-bordered `<pre>` block labeled as untrusted; version-diff component with collapsed unchanged sections and changed-section borders.
UX-DR35: Skeleton rows on cold load with no counts until loaded; "Updated {time}. Refresh." stale Banner on Run Detail and Runs; no auto-refresh of detail pages except Live View; pagination on Runs; no drag or infinite scroll.
UX-DR36: Responsive behavior: sidebar and two-column rails at 1280px and above; rail stacked at 1240 to 1279px; rail stacked, Runs table horizontally scrolling with fixed identifier column at 1024 to 1239px; reading mode (single column, label and value stacks, actions at record bottom, Live View read-only) at 900 to 1023px; below 900px additionally "Open on a desktop browser to author or approve." on Builder and Version review; web only.
UX-DR37: Accessibility floor: WCAG 2.1 AA with automated checks in CI across all surfaces; Tab order follows reading order and the focus ring is never suppressed; Escape closes the topmost dialog and never cancels a Run; Space or Enter on scrubber pills and Step rows jump Replay, arrow keys step frames, Space toggles play; filter chips are `aria-pressed` toggle buttons in a labeled group; dialogs are `role="dialog"` `aria-modal` titled with the consequence; `aria-live="polite"` for Run state changes, new Escalations, and countdown milestones (10 minutes, 1 minute) and `aria-live="assertive"` for Run Failed; skip link to the open Escalation; viewer frames carry alt narration equal to the Step narration; long identifiers wrap and Evidence values are never truncated; untrusted and agent-generated text announced as such.
UX-DR38: Voice and copy rules: sentence case, column headers uppercase by CSS only, domain nouns capitalized as defined terms, the agent is "the Audit Agent" or "the agent" and never humanized, every guard sentence names the object it protects, "This Run remains unchanged." after corrective actions, the EXPERIENCE.md Do and Don't copy examples; formats: identifiers mono, timestamps ISO 8601 UTC with `Z` and original offset beside, amounts `USD 250,000.00`, counts with thousands separators and comparisons `1,842 = 1,842`, periods `2026-08-25 → 2026-08-31`, durations `3m 41s`, countdowns `28m 10s left`, absent values `—`, source nulls literal `null`.
UX-DR39: Role and action gating per the EXPERIENCE.md table with the exact denial reasons: PoC Administrator cannot author Procedures or start Runs, cannot alter evaluations, Results, or reviews; only an Audit Manager approves a Procedure Version or a submitted Result; an author cannot approve their own version; only the PoC Administrator manages users, registrations, bindings, diagnostics; Administration hidden from non-administrators.
UX-DR40: Key flows must be walkable end to end as e2e tests: Flow 0 registration and platform-authored draft warning; Flow 1 Builder through submission with the declared-count blocker; Flow 2 Version review approval and self-approval refusal; Flow 3 Live View with choose-candidate Escalation and pause countdown; Flow 4 scheduled Run, Replay from the provenance chain, confirmation sealing Control Failure; Flow 5 Inconclusive Run with Safe next action and Submit refusal; Flow 6 review, Bundle export, finalization, and recorded disagreement.
UX-DR41: Do and Don't rules from DESIGN.md: show version, lifecycle, Gate, outcome, and review as separate objects in that order; name the Session Step, check, and record count when Evidence fails; keep the sealed outcome visible next to any disagreeing disposition; mono only for identifiers, values, digests, timestamps, locators, Tool Actions; no KPI walls, heatmaps, charts, or assistant panel; no chat, prompt, or free-text channel to the agent; no hover-only actions or tooltip-only explanations.

### Requirements dispositions (PRD revision 4, 2026-09-25)

The FR text above is revision 2's and stays as the compiler-1 baseline; PRD revision 4 is authoritative for every requirement. Individual dispositions (never a collective "unchanged"):

| Requirement | Title (PRD revision 4) | Disposition |
|---|---|---|
| FR-1 | Authenticated web access | HOLDS |
| FR-2 | Role separation | HOLDS |
| FR-3 | Platform-owned authorisation and source protection | REVISED (Proposal 2) |
| FR-4 | Create a Procedure from a Template | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-5 | Period and scope | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-6 | Population Source configuration | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-7 | Target System configuration | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-8 | Audit Instructions | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-9 | Compliance Rule | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-10 | Evidence Requirements | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-11 | Schedule | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-12 | Executable plan preview | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-13 | Submit and approve a Procedure Version | HOLDS; applied to promoted checks by FR-51 |
| FR-14 | Immutable Procedure Versions | HOLDS; applied to promoted checks by FR-51 |
| FR-15 | Regression Run on configuration change | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-16 | Manual Run initiation | HOLDS; applied to promoted checks by FR-51 |
| FR-17 | Scheduled Run initiation | HOLDS; applied to promoted checks by FR-51 |
| FR-18 | Observable Run lifecycle | HOLDS; applied to promoted checks by FR-51 |
| FR-19 | Isolated Agent Workspace per Run | HOLDS |
| FR-20 | Audit Agent performs the plan | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-21 | Adapter acquisition | HOLDS |
| FR-22 | Work Items and sequential PoC execution | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-23 | Bounded and provider-neutral agent execution | HOLDS |
| FR-24 | Live View | HOLDS |
| FR-25 | Pause and resume | HOLDS |
| FR-26 | Cancel and rerun | HOLDS |
| FR-27 | Escalation | HOLDS |
| FR-28 | Escalation notification | HOLDS |
| FR-29 | Execution Timeline | HOLDS |
| FR-30 | Replay | HOLDS |
| FR-31 | Evidence capture | HOLDS |
| FR-32 | Evidence Package lineage | HOLDS |
| FR-33 | Evidence Quality Gate | HOLDS |
| FR-34 | Safe insufficient-evidence outcome | HOLDS |
| FR-35 | Evidence immutability | HOLDS |
| FR-36 | Normalize and match | HOLDS |
| FR-37 | Rule-Classified evaluations | HOLDS |
| FR-38 | Agent-Judged evaluations | HOLDS |
| FR-39 | Procedure outputs | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-40 | Result summary and sealing | HOLDS |
| FR-41 | Exception investigation | HOLDS |
| FR-42 | Exception workflow | HOLDS |
| FR-43 | Submit, approve, reject, and finalize | HOLDS |
| FR-44 | Reviewer disagreement transparency | HOLDS |
| FR-45 | Append-only Audit Trail | HOLDS |
| FR-46 | Workpaper Bundle export | HOLDS |
| FR-47 | Reproduction support | HOLDS |
| FR-48 | Runs dashboard | HOLDS |
| FR-49 | Operational diagnostics | HOLDS |
| FR-50 | Setup-without-developer instrumentation | COMPILER-1 PATH (held for compiler-1 versions and Runs; not the general model) |
| FR-51 | Promotion to an approved recurring check | NEW (PRD revision 4) |
| FR-52 | Engagement as the primary business object | NEW (PRD revision 4) |
| FR-53 | Explicit ownership and access scope | NEW (PRD revision 4) |
| FR-54 | Isolation proven in CI | NEW (PRD revision 4) |
| FR-55 | Durable conversation without conversational authority | NEW (PRD revision 4) |
| FR-56 | Agent Task | NEW (PRD revision 4) |
| FR-57 | Targeted questions | NEW (PRD revision 4) |
| FR-58 | Replaceable reasoning models | NEW (PRD revision 4) |
| FR-59 | Live supervision of a task | NEW (PRD revision 4) |
| FR-60 | Agent Permissions | NEW (PRD revision 4) |
| FR-61 | Routine work without prompts; confirmation where required | NEW (PRD revision 4) |
| FR-62 | Layered enforcement | NEW (PRD revision 4) |
| FR-63 | Credential containment | NEW (PRD revision 4) |
| FR-64 | Connector framework | NEW (PRD revision 4) |
| FR-65 | Connections per user and tenant | NEW (PRD revision 4) |
| FR-66 | Intended operations, receipts and reconciliation | NEW (PRD revision 4) |
| FR-67 | Honest access failures and partial results | NEW (PRD revision 4) |
| FR-68 | Personal-account testing boundaries | NEW (PRD revision 4) |
| FR-69 | Source snapshots | NEW (PRD revision 4) |
| FR-70 | Working copies and derived outputs | NEW (PRD revision 4) |
| FR-71 | Provenance classes and input quality | NEW (PRD revision 4) |
| FR-72 | Coverage limitations constrain assessments | NEW (PRD revision 4) |
| FR-73 | Versioned artifacts | NEW (PRD revision 4) |
| FR-74 | Claim provenance in artifacts | NEW (PRD revision 4) |
| FR-75 | Revision and dependency flagging | NEW (PRD revision 4) |
| FR-76 | Artifact types from the methodology pack | NEW (PRD revision 4) |
| FR-77 | Methodology packs | NEW (PRD revision 4) |
| FR-78 | Skills | NEW (PRD revision 4) |
| FR-79 | Governed memory | NEW (PRD revision 4) |
| FR-80 | Scoped retrieval and precedence | NEW (PRD revision 4) |
| FR-81 | Isolated analysis execution | NEW (PRD revision 4) |
| FR-82 | Document processing | NEW (PRD revision 4) |
| FR-83 | Recorded authority is rechecked | NEW (PRD revision 4) |
| FR-84 | Execution principals and delegation | NEW (PRD revision 4) |
| FR-85 | Skill discovery and loading | NEW (PRD revision 4) |
| FR-86 | Proposing and approving a methodology pack | NEW (PRD revision 4) |
| FR-87 | Long-running conversations | NEW (PRD revision 4) |
| FR-88 | Interruption and recovery of external effects | NEW (PRD revision 4) |
| FR-89 | Provider disclosure policy | NEW (PRD revision 4) |
| FR-90 | Usable documents and spreadsheets | NEW (PRD revision 4) |
| FR-91 | Model and effort choice | NEW (PRD revision 4) |
| FR-92 | Administrator model policy | NEW (PRD revision 4) |
| FR-93 | Scheduled checks and unavailable models | NEW (PRD revision 4) |
| FR-94 | Roles, scope and separation of duties | NEW (PRD revision 4) |
| FR-95 | Invitations and removal | NEW (PRD revision 4) |
| FR-96 | Review notes and return | NEW (PRD revision 4) |

NFR-11 is WCAG 2.2 AA (revision 4); NFR-16 (tenant-isolation proof in CI) and NFR-17 (provider disclosure policy) are new. The addendum's §C Templates, §D golden datasets, §E Run vocabulary and §H twenty rows carry `[COMPILER-1 PATH]` dispositions (addendum revision 5 §0).

### FR Coverage Map

FR1: Epic 1 - Sign in and role-limited access
FR2: Epic 1 - Three roles and their action sets
FR3: Epic 1 (write-capable credential refused) and Epic 4 (execution-time denial and logging)
FR4: Epic 2 - Create from one of four Templates, name the Control
FR5: Epic 2 - Period and scope on the version; shown in every Result (Epic 3)
FR6: Epic 2 - Population Source binding, inclusion rule, declared count; acquisition and empty-population rule in Epic 3
FR7: Epic 1 (registration) and Epic 2 (selection on the version); desktop kind completed in Epic 7
FR8: Epic 2 - Audit Instructions and authoring-time scope flag; execution denial in Epic 4
FR9: Epic 2 - Compliance Rule compilation, applicability, boundary semantics; evaluation order applied in Epic 3
FR10: Epic 2 (Evidence Requirements authoring) and Epic 4 (platform capture bound to the Tool Action)
FR11: Epic 2 (Schedule field on the version) and Epic 8 (runtime)
FR12: Epic 2 - Executable plan preview and re-derivation
FR13: Epic 2 - Submit, approve, reject with diff
FR14: Epic 2 (immutable versions, platform-authored drafts) and Epic 8 (period-boundary handover)
FR15: Epic 8 - Regression Run gates activation
FR16: Epic 3 - Manual initiation, overlap prevention, correlation id
FR17: Epic 8 - Scheduled initiation, missed starts
FR18: Epic 3 - Observable Run lifecycle with recorded transitions
FR19: Epic 4 - Isolated Agent Workspace per Run
FR20: Epic 4 (web path) and Epic 7 (desktop path)
FR21: Epic 3 - Adapter acquisition on the same Timeline and schema
FR22: Epic 3 - Session Steps and Work Items, sequential execution
FR23: Epic 3 (limit framework and outcome mapping) and Epic 4 (agent limits, untrusted content)
FR24: Epic 5 - Live View
FR25: Epic 5 - Pause and resume
FR26: Epic 3 (cancel from Run Detail, linked rerun) and Epic 5 (cancel from Live View)
FR27: Epic 4 (Escalation kinds, answers, timeouts) and Epic 5 (flag from Live View)
FR28: Epic 4 - In-app and email notification
FR29: Epic 3 - Execution Timeline
FR30: Epic 5 - Replay from the platform-owned asset set
FR31: Epic 3 - Evidence capture fields, grounding, absence rule
FR32: Epic 3 - Evidence Package lineage
FR33: Epic 3 - Evidence Quality Gate
FR34: Epic 3 - Inconclusive and Run Failed
FR35: Epic 3 - Evidence immutability and integrity events
FR36: Epic 3 - Normalize and match
FR37: Epic 3 - Rule-Classified evaluations
FR38: Epic 4 - Agent-Judged evaluations and confirmation
FR39: Epic 3 - Result outputs and counts
FR40: Epic 3 - Result summary and sealing
FR41: Epic 6 - Exception investigation
FR42: Epic 6 - Exception workflow
FR43: Epic 6 - Submit, approve, reject, finalize
FR44: Epic 6 - Reviewer disagreement
FR45: Epic 1 - Append-only chained Audit Trail (every later epic appends its events)
FR46: Epic 6 - Workpaper Bundle export
FR47: Epic 6 - Reproduction support
FR48: Epic 3 (Runs list and lifecycle labels) and Epic 9 (full filters, missed starts)
FR49: Epic 9 - Operational diagnostics
FR50: Epic 9 - Thesis instrumentation


## Epic List

### Epic 1: Sign in, roles, and the registered synthetic environment
The PoC Administrator registers the systems the agent may touch and the users who may work; Auditors and Audit Managers sign in and see only what their role allows. Delivers the runnable monorepo on Railway, the Ledger Signal shell, application-owned roles, the chained Audit Trail, the Administration surface with read-only registrations (write-capable credentials refused, registration digests, expected labels, secondary keys, masking), Population Source bindings, and the synthetic Northstar fixtures for every web, API, and file system plus the golden datasets as product data (Flow 0).
**FRs covered:** FR1, FR2, FR3 (registration side), FR7 (registration side), FR45

### Epic 2: Author and approve a Procedure
An Auditor builds the Terminated Users Procedure from its Template in audit vocabulary, reads the derived plan, and submits it; an Audit Manager who is not the author reviews the diff and approves or rejects it. Delivers the Procedures, Procedure Builder, Procedure Detail, and Version review surfaces; Templates as data; the deterministic PlanCompiler with applicability predicates and scope-widening checks; queued plan derivation; immutable Procedure Versions with platform-authored drafts on registration change (Flows 1 and 2).
**FRs covered:** FR4, FR5, FR6, FR7 (selection), FR8, FR9, FR10, FR11 (authoring), FR12, FR13, FR14 (immutability and drafts)

### Epic 3: Run an adapter-acquired Procedure to a sealed Result
An Auditor starts a Run of an Active version whose Population Source and Target Systems are API or file based, watches its lifecycle in Run Detail, and receives a sealed Pass or Control Failure, or an honest Inconclusive or Run Failed. Delivers the durable worker, Session Steps and Work Items, the one Observation contract with grounding and corroboration, the full Evidence Quality Gate, sealed Evidence Packages, the deterministic evaluator, Result publication and sealing, the Execution Timeline, cancel and rerun, and the Runs list. Proven on the Segregation-of-Duties and High-Value Transactions golden datasets with no model in the loop.
**FRs covered:** FR16, FR18, FR21, FR22, FR23 (limits), FR26, FR29, FR31, FR32, FR33, FR34, FR35, FR36, FR37, FR39, FR40, FR48 (list and lifecycle)

### Epic 4: The Audit Agent works a web Target System under supervision rules
The Audit Agent signs in to LoanCore in an isolated Agent Workspace, inspects each terminated employee, and registers grounded Observations; when it cannot proceed safely the platform raises a typed Escalation that an Auditor answers from Run Detail, and an Auditor confirms or rejects Agent-Judged evaluations so the Result can seal. Delivers the Solari browser execution adapter with allowlists and read-only denial, just-in-time credentials with redaction, the accessibility-tree extractor, absence proof, bounded limits, durable waits, in-app and email notification, and the evaluation confirmation flow. Proven on the hero (LoanCore only) and Production Configuration Deviation golden datasets.
**FRs covered:** FR3 (execution denial), FR8 (execution denial), FR10, FR19, FR20 (web path), FR23 (agent), FR27, FR28, FR38

### Epic 5: Watch, pause, and replay the agent
An Auditor opens Live View to watch the workspace screen, Observations, and Gate rows as they happen, pauses and resumes, flags a Run, answers an Escalation in place, and later replays any terminal Run with jumps to Work Items, Exceptions, and Escalations, with the Workspace Provider unreachable. Delivers the LISTEN/NOTIFY plus SSE live channel, the shared session viewer, the platform-owned Replay asset set, pause and resume as durable waits, and reading mode below 1024px (Flow 3).
**FRs covered:** FR24, FR25, FR26 (from Live View), FR27 (flag), FR30

### Epic 6: Investigate Exceptions, review, finalize, and reproduce

**Disposition (course correction, D-5-2): SPLIT.** Every story below is superseded and re-homed as noted in its heading; the epic stays `backlog` in the tracking file and is never marked done. The retained review, exception and export capabilities live in Epics 14, 15 and 19.
An Auditor opens each Exception to its provenance chain and grounding, dispositions it, and submits the sealed Result; an Audit Manager approves, records disagreement without override, and finalizes with a signed manifest; any user exports a Workpaper Bundle from which an independent reviewer reproduces an evaluation offline. Delivers Exception Detail, the Review surface and queue, the Overview needs-attention list, the signed Bundle archive, and reproduction tooling (Flows 5 and 6).
**FRs covered:** FR41, FR42, FR43, FR44, FR46, FR47

### Epic 7: Inspect a desktop Target System

**Disposition (course correction, D-5-3): DEFERRED indefinitely.** No story below is selectable for implementation; the epic stays `backlog`.
The Audit Agent launches LedgerDesk in the Solari sandbox desktop, signs in, searches User Maintenance, and registers Observations grounded in the application's control tree, completing the hero Procedure across both Target Systems. Delivers the synthetic LedgerDesk application with its localhost JSON snapshot endpoint, the project-owned desktop template, the in-VM snapshot agent, the desktop execution adapter, and the desktop_tree extractor. Proven on the full hero golden dataset including the ambiguous role list and the Suspended account.
**FRs covered:** FR7 (desktop kind), FR20 (desktop path)

### Epic 8: Runs that happen without anyone watching

**Disposition (course correction, D-5-3): ABSORBED into Epic 19** under compiler-2 with reviewed regression case sets (D-3d-1); every story below is superseded as noted in its heading; the epic stays `backlog`.
A weekly Schedule starts the Run unattended at its UTC time with a derived period; a missed start is recorded and shown, never skipped; a new version takes over at the next period boundary without running a period twice; a version whose model, prompt, tool, or registration digest changed must pass a Regression Run on the golden dataset before it activates. Delivers the worker scheduler, handover, Retired transitions, the Regression Run kind with golden comparison, and upcoming and missed Runs on the dashboard (Flow 4).
**FRs covered:** FR11 (runtime), FR14 (handover), FR15, FR17

### Epic 9: Oversee the PoC and measure the thesis — the standing assurance epic

**Disposition (course correction, D-5-3): GENERALISED, STANDING.** Runs throughout; every proof has an owner, a tested revision, an environment and a recorded result.
A PoC Administrator sees Target System connectivity, provider and runner health, errors, retries, limits, and durations without secrets; every user filters Runs by every state; the team reports the SM-11 measures per Procedure and proves the NFR envelope with isolation, abuse, integrity, recovery, performance, and accessibility tests. Delivers diagnostics rows, full Runs filters, thesis metrics, the restore drill, and the acceptance test suites.
**FRs covered:** FR48 (full filters and missed starts), FR49, FR50


### Epic 10: Disposition and rename

The course-correction transition work of Proposal 7 (legacy review closure, tracking update, compatibility-tested rename, conditional Builder retirement, legacy harness coverage mapping).

### Epic 11: Tenancy, scope and delegation

every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

### Epic 12: Engagement, Agent Task and the agent loop

a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

### Epic 13: Agent Permissions, connector framework, connections and the first connectors

authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

### Epic 14: Sources, evidence, working material and derived outputs

every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

### Epic 15: Artifacts, claims, review, approval and produced files

versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

### Epic 16: Memory, retrieval, skills and methodology packs

scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

### Epic 17: Controlled execution environment and document processing

a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

### Epic 18: The experience: the Zobba shell, workspace, Reviews and Settings

EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

### Epic 19: Promotion and recurring checks (absorbs Epic 8; re-homes Epic 6.1, 6.2)

a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

## Epic 1: Sign in, roles, and the registered synthetic environment

The PoC Administrator registers the systems the agent may touch and the users who may work; Auditors and Audit Managers sign in and see only what their role allows. This epic delivers the runnable monorepo on Railway, the Ledger Signal shell, application-owned roles, the chained Audit Trail, the Administration surface with read-only registrations and Population Source bindings, and the synthetic Northstar environment seeded with golden populations. Every later epic builds on it and none is required for it to work.

### Story 1.1: Bootstrap the monorepo and deploy web and worker

As a developer,
I want the pnpm monorepo, dependency boundaries, CI, and Railway web and worker services in place,
So that every later story lands in a running, boundary-enforced system.

**Acceptance Criteria:**

**Given** a fresh clone
**When** `pnpm install` and `pnpm -r typecheck` run
**Then** the workspace contains `apps/web`, `apps/worker`, `packages/domain`, `packages/application`, `packages/infrastructure`, `tests/fixtures`, `tests/integration`, and `tests/e2e` with the stack seed pinned (Node.js 24 LTS, TypeScript 7, Next.js 16, React 19, pnpm 11, Drizzle, postgres.js, pg-boss, Better Auth, Vercel AI SDK with Anthropic and OpenAI providers, Zod, Pino, Sentry, Vitest, Playwright)
**And** a dependency-boundary check fails CI when `domain` imports any outward package, `application` imports anything but `domain`, or business code imports Drizzle, pg-boss, Solari, AI SDK, Resend, S3, Railway, Better Auth, Next.js, Pino, or Sentry types (AD-1)

**Given** the CI pipeline
**When** a pull request opens
**Then** type checking, boundary checks, unit tests, and Drizzle migrations against a PostgreSQL 18 service run and must pass (AD-12)
**And** web and worker never run migrations at startup; a release job applies them and each process refuses to start on an unsupported schema range (AD-15)

**Given** the Railway project
**When** the release pipeline runs
**Then** web and worker deploy as separate containers from one repository, `server_version` is verified as PostgreSQL 18 at bootstrap, and runtime configuration is read only in each composition root through a validated schema (AD-11)
**And** a health route on web and a heartbeat row from worker prove both processes are up

### Story 1.2: Record tamper-evident audit events with sanitized telemetry

As an Audit Manager,
I want every security and configuration event recorded in a chained, append-only Audit Trail,
So that later mutation of the record is detectable.

**Acceptance Criteria:**

**Given** the audit event store
**When** any module appends an event
**Then** the event carries actor (human, Schedule, Audit Agent, Adapter, or platform), event type, UTC time, source, outcome, session identifier, and correlation identifier (FR45)
**And** it is serialized as UTF-8 RFC 8785 canonical JSON, links to its predecessor by SHA-256, and takes a transactionally allocated sequence on its own aggregate or on the `platform` aggregate; each aggregate has a head row, and the sequence is allocated under that head row lock, gapless and commit-ordered, so a Run's Timeline can later reuse this chain unchanged (AD-22)

**Given** a stored chain
**When** a verification routine re-walks it after a row is altered in PostgreSQL
**Then** the break is reported at the altered event (NFR3)
**And** a golden vector and a tampered vector are checked into `tests/fixtures`

**Given** the telemetry pipeline
**When** web or worker logs, traces, or reports an error
**Then** only allowlisted scalar fields pass, Pino redaction is static, Sentry runs with `sendDefaultPii: false` and AI input and output capture disabled, and one correlation chain spans request, job, and later Run stages (AD-10)
**And** a seeded negative test proves a credential-shaped value never reaches a log line or Sentry event

### Story 1.3: Sign in and act only within an application-owned role

As an Auditor,
I want to sign in and reach only what my role allows,
So that Procedures, Runs, Evidence, and administration are never exposed to the wrong person.

**Acceptance Criteria:**

**Given** Better Auth is configured for identity and session only
**When** a user signs in
**Then** the application resolves the user's role (Auditor, Audit Manager, or PoC Administrator) from its own `identity` module, never from the identity provider (AD-7)
**And** successful and failed sign-in attempts are appended to the `platform` audit chain (FR1)

**Given** an unauthenticated request
**When** it targets any Procedure, Run, Evidence, Exception, Live View, Replay, administration route, or SSE stream
**Then** the request is refused with no data in the response (FR1)
**And** an automated test covers every route family

**Given** a signed-in user
**When** they invoke a command or query outside their role per the EXPERIENCE.md action-gating table
**Then** the command is refused with the exact denial reason (for example "PoC Administrator cannot author Procedures or start Runs.") and the refusal is audited (FR2, UX-DR39)
**And** revoking a role blocks new actions on the next request without ending existing sessions abruptly

### Story 1.4: Application shell and Ledger Signal tokens

As an Auditor,
I want the IntelliFin Audit shell with its status vocabulary in place,
So that every surface built later looks and behaves the same.

**Acceptance Criteria:**

**Given** the web app
**When** any page renders
**Then** the sidebar (Overview, Procedures, Runs, Review, Administration for PoC Administrators only), top bar with notification bell, and EnvironmentRibbon appear at the DESIGN.md widths, and breadcrumbs render on detail routes; the Sidebar, Button, StatusBadge, Banner, EnvironmentRibbon, EmptyState, Tabs, and Icon components are consumed from the IntelliFin Design System by name, with StatusBadge extended locally by the info-solid variant (UX-DR2, UX-DR5)
**And** every color, typography role, radius, and spacing value from DESIGN.md is a CSS variable with the listed value, teal is the only interactive color, and the focus ring is #0F766E and never suppressed (UX-DR1, UX-DR37)

**Given** the status badge component
**When** it renders any state from the eight families plus Work Item
**Then** it shows the family's icon and the state's exact name, Awaiting Auditor, Pending Confirmation, Agent-Judged pending, and Work Item Awaiting use info-solid with the user icon, Completed is neutral, and no status is conveyed by color alone (UX-DR3, UX-DR4)
**And** an automated WCAG 2.1 AA check passes on the shell, an empty Overview, and the badge gallery (NFR11)

**Given** the reusable primitives
**When** a page uses a data table, empty state, action bar, or confirmation dialog
**Then** tables use `<th scope>`, captions, a focusable link in the first cell, and no row-level click handlers; empty states refuse to imply a passed control; disabled actions keep position and expose their reason in an "Unavailable actions" panel and as the accessible description; dialogs trap and restore focus, close on Escape, and support the three weights (UX-DR32, UX-DR33, UX-DR34)
**And** the reading-mode breakpoints from EXPERIENCE.md collapse the layout below 1024px (UX-DR36)

### Story 1.5: Manage users and roles

As a PoC Administrator,
I want to create users and assign roles,
So that Auditors and Audit Managers can start working.

**Acceptance Criteria:**

**Given** the Administration surface
**When** a PoC Administrator creates a user or changes a role
**Then** the change takes effect on the user's next request and an audit event records actor, prior value, and new value (FR2, FR45)
**And** the surface is hidden from non-administrators and every mutating action uses a routine confirmation dialog (UX-DR31, UX-DR33)

**Given** the PoC Administrator role
**When** it attempts to author a Procedure, approve anything, or alter Evidence, evaluations, or Results
**Then** the action is refused with the stated reason and there is no override path (FR2)

### Story 1.6: Register a Target System with a read-only credential

As a PoC Administrator,
I want to register a Target System with its kind, origins, credential reference, permitted actions, expected field labels, and secondary key,
So that Auditors can only ever select systems the agent is allowed to read.

**Acceptance Criteria:**

**Given** the registrations form
**When** a PoC Administrator saves a Target System of kind web, desktop, API, or versioned file
**Then** the registration stores allowed origins or application identity, an opaque `CredentialRef`, permitted read actions, per-attribute expected field labels or locator patterns, and an optional secondary matching key (FR7)
**And** the `registrations` module computes the registration digest as SHA-256 over RFC 8785 canonical JSON of exactly `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key}` and shows it in the registrations table (AD-2, UX-DR31)

**Given** a credential reference whose capability check reports write access
**When** the PoC Administrator tries to save it
**Then** the save is blocked with "Audit credentials must be read-only." and the attempt is audited (FR3)
**And** the `CredentialProvider` port never returns a secret to the web process; secret values live outside application data (NFR1)

**Given** an existing registration
**When** origin, application identity, credential reference, permitted actions, labels, or secondary key change
**Then** a `RegistrationChanged` event is published in the same UnitOfWork and the save confirmation warns "This change creates a platform-authored draft for {n} Procedures and requires approval." (FR14, AD-2)
**And** the connectivity column shows the last worker-written probe result, never a probe from the web process (AD-10)

### Story 1.7: Register a Population Source binding

As a PoC Administrator,
I want to register where a population comes from and how its expected count is declared,
So that a Procedure can bind to it and the Gate can reconcile every acquisition.

**Acceptance Criteria:**

**Given** the bindings form
**When** a PoC Administrator registers a versioned-file location or a read-only API
**Then** the binding stores location, declared schema, declared-count mechanism (signed cover sheet or count endpoint), and a set of fields designated sensitive for masking (FR6, FR41)
**And** a binding with no declared-count mechanism is saved with a visible warning that Procedures cannot submit against it

**Given** a manual upload binding
**When** it is registered
**Then** it is marked upload-only and the Builder later refuses it for any Schedule but `once` (FR6, AD-23)

**Given** any binding change
**When** it is saved
**Then** the change is audited and, when a Procedure Version references it, the platform-authored draft warning appears (FR14)

### Story 1.8: Synthetic Northstar systems seeded with golden populations

As a PoC Administrator,
I want the synthetic Northstar Financial Group systems running with read-only audit accounts,
So that Procedures have real systems to inspect and every golden case exists somewhere.

**Acceptance Criteria:**

**Given** the fixtures workspace
**When** the synthetic environment starts
**Then** LoanCore (web application with a user-administration area and account pages exposing Status, Username, Roles, Employee ID), ProdConsole (web configuration page with a signed snapshot identifier and expected parameter count), AccessGate, ApproveNow, and PeopleHub (read-only APIs with count endpoints), and the Leavers export, RoleMatrix, and ConfigRegistry files with signed cover sheets are reachable at allowlisted origins (addendum §A)
**And** every system refuses write actions from the audit credential at the system level and returns an explicit denial (FR3)

**Given** the golden populations
**When** the fixtures are seeded
**Then** each Template's golden dataset from addendum §D exists in the relevant system (two compliant, two true Exceptions, boundary case, missing mandatory value, duplicate or ambiguous record, stale population, uncapturable page, injection strings, wrong-employee page, value in a non-field element, mistyped key, and for the hero a choose-candidate pair and a `Suspended` account) with declared counts generated independently of the Audit Runner
**And** expected terminal outcomes and confirmation scripts are stored as versioned data files separate from any rule implementation (AD-12)

**Given** NFR13
**When** any fixture is inspected
**Then** it contains no production or personal data, and a test asserts the synthetic marker on every dataset

## Epic 2: Author and approve a Procedure

An Auditor picks one of the four Procedure Templates, edits it into a Procedure in audit vocabulary, period and scope, Population Source binding, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, Schedule, reads the derived executable plan, and submits it; an Audit Manager who did not author it reviews the section-by-section diff and approves or rejects. This epic delivers the Procedures, Procedure Builder, Procedure Detail, and Version review surfaces; the four Template contracts as data owned by the `procedures` module; the deterministic `PlanCompiler` with applicability predicates, boundary semantics, and a scope-widening check; plan derivation as a queued worker job that may call `ModelGateway`; and the immutable Procedure Version state machine, including platform-authored drafts minted on a registration change (Flows 1 and 2). Execution of the plan, Regression Runs, and Schedule handover are later epics; this epic only authors and freezes what they will run against.

### Story 2.1: Create a Procedure from a Template

As an Auditor,
I want to start a Procedure from one of the four Templates and name the Control it verifies,
So that the Builder opens pre-filled in audit vocabulary instead of a blank form.

**Acceptance Criteria:**

**Given** the Procedures surface with no Procedure yet created
**When** an Auditor opens it
**Then** it shows an empty state whose only action is "New procedure" (UX-DR7)
**And** once Procedures exist, each renders as a card showing its Active version, Schedule, next Run, and last outcome (UX-DR7)

**Given** the four Procedure Templates (Terminated Users Retaining Access, Segregation-of-Duties Conflicts, High-Value Transactions Without Required Approval, Production Configuration Deviation) held as data owned by the `procedures` module
**When** an Auditor chooses "New procedure", picks a Template, and names the Control it verifies
**Then** a Procedure Version in `DRAFT` is created and the Builder opens with every section pre-populated from addendum §C for that Template (FR4, AD-2)
**And** the Terminated Users Retaining Access Template (the hero) is fully configurable, while the other three Templates are at minimum editable in period, Population Source, Target Systems, and Schedule (FR4)
**And** each Template record carries, as data, its golden Population Source binding reference and the version of its expected outcomes and confirmation script, for later Regression Runs (AD-12, AD-19)

**Given** a Draft Procedure Version open in the Builder
**When** the Auditor changes a pre-filled value
**Then** the change is scoped to that Draft only and no other Procedure Version is affected (FR4)
**And** the Control name and Template identity are shown on every later surface that lists or opens this Procedure (UX-DR7)

### Story 2.2: Bind the Population Source with an inclusion rule and declared count

As an Auditor,
I want to set the Procedure's period and scope and bind its Population Source with an inclusion rule and a declared-count mechanism,
So that a Run can later acquire a population the Evidence Quality Gate can reconcile.

**Acceptance Criteria:**

**Given** the Builder's Period and scope section
**When** an Auditor sets an explicit period (date range) and writes the scope statement
**Then** both are stored on the Draft version verbatim, ready to be shown on every Result once a Run completes (FR5)
**And** a scheduled Run will derive its own period rather than using this explicit one (FR5, addendum §B)

**Given** the Builder's Population Source binding section pre-filled from the Template
**When** the Auditor binds a registered Population Source and sets a structured inclusion rule over its declared columns
**Then** the binding accepts manual upload only when the Schedule is `once`, and requires a versioned file or read-only API binding for daily, weekly, or monthly Schedules, refusing upload otherwise with "A manual upload is valid only for a `once` Schedule. Bind a versioned file or an API for weekly Runs." (FR6, AD-23)
**And** the binding carries a declared-count mechanism (signed cover sheet or count endpoint); a binding with none shows the inline warning "Population Source must declare an expected record count." and blocks submission (FR6, UX-DR8)

**Given** an empty post-inclusion population is possible for this Procedure
**When** the Auditor sets the version's zero-record-Pass flag
**Then** the version records the opt-in explicitly; without it an empty post-inclusion population will later be Inconclusive rather than Pass (FR6, AD-23)
**And** the version carries a separate versioned-duplicate permission flag; without it a duplicate Source primary key is a Gate failure (AD-23, addendum H)
**And** approving this version freezes the Population Source binding exactly as set (AD-2)

### Story 2.3: Select Target Systems and write Audit Instructions with the scope-widening check

As an Auditor,
I want to select the Procedure's Target Systems by name and write Audit Instructions that are checked against their registrations,
So that the agent can never be told to touch a system, action, or origin it is not registered for.

**Acceptance Criteria:**

**Given** the Builder's Target Systems section pre-filled with the Template's default systems
**When** an Auditor selects one or more registered Target Systems by name, of kind web, desktop, API, or versioned file
**Then** the version records each system's kind, allowed origins or application identity, credential reference, permitted read actions, registration digest, and per-attribute expected field labels or locator patterns as they stand on the registration (FR7)
**And** for the hero Procedure at least one web and one desktop Target System are selected (FR7)

**Given** the Target Systems selected for this version
**When** the Auditor writes natural-language Audit Instructions per agent-driven Target System
**Then** the Instructions are stored verbatim on the version, to be shown later in the plan preview, Live View, Replay, and Workpaper Bundle (FR8)
**And** on blur each Instruction is checked against the selected systems' allowlists for scope-widening, an unregistered system, a write verb, or an out-of-scope origin, and a match is flagged inline in warning color before submission is possible (FR8, AD-23, UX-DR8)

**Given** a seeded scope-widening Instruction is corrected or removed
**When** the Auditor re-checks the section
**Then** the inline warning clears and the plan preview reflects the updated Instructions (UX-DR8)
**And** a scope-widening Instruction left in place at submission time is still only flagged, not executed, its denial happens at execution in Epic 4 (FR8)

### Story 2.4: Author the Compliance Rule with compiled and Agent-Judged conditions

As an Auditor,
I want to write Compliance Rule conditions that compile deterministically where possible and are otherwise marked Agent-Judged,
So that every record's evaluation later derives from rules I can see and trust.

**Acceptance Criteria:**

**Given** the Builder's Compliance Rule editor pre-filled with the Template's default conditions
**When** the `PlanCompiler` processes each condition
**Then** a compilable condition is marked with the Rule-Classified origin badge and an uncompiled condition with the Agent-Judged badge, each carrying a compiled applicability predicate that defaults to `found = true` (FR9, UX-DR9)
**And** the compiler version is frozen on this Draft so identical inputs will always compile identically (AD-23)

**Given** a condition that compares a numeric attribute, such as P-3's USD 100,000 boundary
**When** the Auditor sets its boundary semantics (inclusive or exclusive) and, where relevant, a tolerance
**Then** the tolerance is stored as a compiled numeric condition and the P-3 boundary is exercised as inclusive (FR9, UX-DR9)
**And** the version's per-condition record-derivation order is fixed as Exception, then Unevaluated, then Compliant, and an attribute value outside the set a compiled condition names will evaluate Unevaluated with diagnostic `rule does not name value <v>` once a Run runs it (FR9, AD-23, addendum §B)

**Given** the version has at least one Agent-Judged condition
**When** the Auditor sets the version's confidence threshold
**Then** the field defaults to 0.80 and is stored once per version for later use in confirming or auto-marking Agent-Judged evaluations Unevaluated (FR9, UX-DR9)
**And** approving the version freezes every condition's compiled/uncompiled status, applicability predicate, and the confidence threshold (AD-2)

### Story 2.5: Specify Evidence Requirements and set the Schedule

As an Auditor,
I want to declare what Evidence each attribute needs and set the Procedure's Schedule,
So that a Run knows what to capture and when to start.

**Acceptance Criteria:**

**Given** the Builder's Evidence Requirements section pre-filled from the Template
**When** the Auditor specifies, per attribute, which Evidence Requirement applies, attribute value, Structural Snapshot, screenshot, source file excerpt, or recording segment
**Then** the version records that every attribute must be grounded in a snapshot or file, never a screenshot alone, and that Structural Snapshot and screenshot are always platform-captured for agent-driven systems bound to the reading Tool Action (the capture itself happens at execution, Epic 4) (FR10)
**And** any attribute the Auditor declares model-read is recorded as such on the version rather than requiring deterministic grounding (addendum §B.1)

**Given** the Builder's Schedule section
**When** the Auditor sets the Schedule to once, daily, weekly, or monthly
**Then** the Schedule is stored as part of the version with a fixed UTC start time, to activate on approval or, when required, after the Regression Run that Epic 8 executes (FR11)
**And** the version records the addendum §B period-derivation rule for its frequency (daily → previous calendar day, weekly → previous Monday to Sunday, monthly → previous calendar month, once → the Auditor's explicit period) without deriving any period yet (FR11, addendum §B)

**Given** a `once` Schedule paired with a manual-upload Population Source binding
**When** the Auditor reviews the Builder
**Then** the pairing is accepted, matching the rule set in Story 2.2 (FR6, FR11)
**And** changing the Schedule to daily, weekly, or monthly while a manual-upload binding is still set re-triggers the upload blocker from Story 2.2 (AD-23)

### Story 2.6: Read the re-derived executable plan before submitting

As an Auditor,
I want to read the plan the platform derives from my Procedure and see it re-derive as I edit,
So that I know exactly what will execute before I submit for approval.

**Acceptance Criteria:**

**Given** any field in the Builder changes
**When** the change is saved
**Then** a `procedures` plan-derivation job is queued to the worker, never derived inside the web request, and the plan preview shows "Re-deriving…" until it lands, then "Re-derived {time}" (FR12, AD-23, UX-DR10)
**And** every re-derivation, successful or not, is recorded on the version (FR12)

**Given** the plan-derivation job completes
**When** the Auditor opens the plan preview
**Then** it shows read-only rows for Session Steps, ordered Plan Steps per Target System, Observations to capture, compiled and Agent-Judged conditions, credential references, and limits, with no edit controls, edits happen only in the Builder's sections (FR12, UX-DR10)
**And** when derivation used a model, the model's identity is shown in the plan preview and recorded on the version, using the default model `claude-sonnet-5` via the Anthropic provider unless configured otherwise (FR12, AD-23)

**Given** the Procedure cannot be compiled into a plan, for example an unresolved binding or an incompatible condition
**When** the Auditor opens the plan preview or attempts to submit
**Then** it shows "Cannot derive: {reason}" and Submit is disabled while the plan is underivable (FR12, UX-DR8, UX-DR10)
**And** the plan is frozen exactly as last derived the moment the version is approved (FR12, AD-2)

### Story 2.7: Submit for approval and approve or reject with a diff

As an Audit Manager,
I want to review a submitted Procedure Version against its previous version and approve or reject it,
So that only a reviewed, non-self-authored version can ever become Active.

**Acceptance Criteria:**

**Given** a Draft version with no outstanding Builder blocker and a derivable plan
**When** the Auditor presses "Submit for approval"
**Then** the version moves `DRAFT → SUBMITTED`, a notification record is created for every Audit Manager in the same transaction (AD-20), and Submit stays disabled with the listed reason whenever any blocker or an underivable plan exists (FR13, UX-DR8)
**And** on Procedure Detail the versions list shows the Submitted state and an approval banner naming who can approve it (UX-DR11)

**Given** a Submitted version opened on the Version review surface
**When** an Audit Manager who is not its author reviews it
**Then** every section is shown as a diff against the previous version, or fully expanded when this is the first version, using the version-diff component (FR13, UX-DR12)
**And** the version's author sees Approve disabled with "You cannot approve a version you authored." (FR13, AD-7, UX-DR11, UX-DR12)

**Given** a non-author Audit Manager on Version review
**When** they approve
**Then** the approval freezes the compiled plan, Compliance Rule (compiled/uncompiled status and applicability predicates), Evidence Requirements, Target Systems and their registration digests, Population Source binding, model and tool configuration, limits, Schedule, and records the approver, time, and diff (FR13, AD-2)
**And** when two Audit Managers act on the same Submitted version, the second command fails the expected-revision precondition and nothing is applied twice (AD-7)
**And** whenever a prior `ACTIVE` version of the same Procedure exists, regression-gated approval records pending regression and the successor relationship without a speculative date; the activating command computes `handover_at` once as the first period start strictly after activation and stores it on both versions; it records the configuration tuple (model, prompt version, tool configuration, registration digests) compared against that prior version and, when the tuple differs, marks the version as requiring a Regression Run, which Version review shows inline as pending; a first version, or one whose tuple is unchanged, moves `APPROVED → ACTIVE` immediately (FR13, AD-2, AD-19, UX-DR12)

**Given** an Audit Manager rejects instead
**When** they submit the rejection
**Then** it requires a rationale, the version moves `SUBMITTED → REJECTED`, a notification record is created for the author (AD-20), and the rationale is shown inline on Procedure Detail next to an "Edit" action (FR13, UX-DR11)
**And** using "Edit" returns the version to `DRAFT` (FR13, addendum §E)

### Story 2.8: Immutable versions and platform-authored drafts

As an Auditor,
I want an approved version's frozen fields to be truly unchangeable, and a new Draft to appear automatically when something it depends on changes,
So that a Run never silently executes against a definition nobody reviewed.

**Acceptance Criteria:**

**Given** an `APPROVED` or `ACTIVE` Procedure Version
**When** any user attempts to change a frozen field directly on that version
**Then** the change is refused; the only path to a new definition is "New version", which creates a Draft copy of the Active version for further editing (FR14, UX-DR11)
**And** Procedure Detail shows the Active version with its next Run and an "Initiate Run" action, and a Retired version read-only with "Retired {time}; superseded by v{x}." (UX-DR11)

**Given** a `RegistrationChanged` event published by the `registrations` module for a Target System or Population Source binding this Procedure's Active version references
**When** the event is handled by `procedures` in the same UnitOfWork
**Then** a new Draft version is minted automatically, marked platform-authored, and Procedure Detail shows "Created by the platform after a {model / prompt / tool / registration} change; requires approval" (FR14, AD-2, UX-DR11)
**And** the prior version's Schedule stays Active and keeps running until this platform-authored draft is itself approved (FR14, UX-DR11)

**Given** a platform-side model, prompt, or tool configuration change instead of a registration change
**When** it affects an Active version's frozen configuration
**Then** the same platform-authored Draft path applies, naming the model, prompt, or tool cause rather than registration (FR14, AD-2)
**And** every Draft minted this way follows the same `DRAFT → SUBMITTED → APPROVED | REJECTED` state machine as an Auditor-authored one, with no shortcut to `ACTIVE` (FR14, addendum §E)

## Epic 3: Run an adapter-acquired Procedure to a sealed Result

An Auditor starts a Run of an Active version whose Population Source and Target Systems are API or file based, watches its lifecycle in Run Detail, and receives a sealed Pass or Control Failure, or an honest Inconclusive or Run Failed. This epic delivers the durable worker, Session Steps and Work Items, the one Observation contract with grounding and corroboration, the full Evidence Quality Gate, sealed Evidence Packages, the deterministic evaluator, Result publication and sealing, the Execution Timeline, cancel and rerun, and the Runs list, proven end to end on the Segregation-of-Duties and High-Value Transactions golden datasets with no model, no Agent Workspace, and no Escalation in the loop.

### Story 3.1: Initiate a Run for an Active version and period

As an Auditor,
I want to start a Run of an Active Procedure Version for a period,
So that the Procedure executes durably, exactly once per period, with a traceable identity.

**Acceptance Criteria:**

**Given** an Active version and a period it owns
**When** an Auditor initiates a Run
**Then** `InitiateRun` resolves the version from the period's ownership, derived from the versions' stored `handover_at` (a null `handover_at` means the version owns every period), and refuses a period no version owns, the Run is assigned a unique UUIDv7 correlation identifier, and the initiator is recorded (FR16)
**And** the Run carries `kind = STANDARD` (AD-2) and enters `QUEUED`

**Given** an active Run already exists for that (Procedure, effective period)
**When** a second initiation is attempted
**Then** it is refused; uniqueness on `(Procedure, effective period)` is enforced transactionally for `STANDARD` Runs (FR16, AD-3)

**Given** the initiation command
**When** it commits
**Then** the Run row and its durable pg-boss job dispatch commit in the same PostgreSQL transaction (AD-3, AD-8)
**And** the `QUEUED` transition records time, actor, reason, and prior state as a Timeline event in the Run's own audit chain (FR18, AD-22)

### Story 3.2: Acquire the Population Source deterministically

As an Auditor,
I want the Run to acquire and digest the Population Source snapshot with a deterministic parser,
So that the population of record is trustworthy before any record is evaluated.

**Acceptance Criteria:**

**Given** a Run for a Procedure bound to a versioned-file or API Population Source
**When** the worker executes Population Source acquisition as a Run-level Session Step
**Then** the Adapter acquires the bound snapshot and its independently generated declared row count and digest, and registers the snapshot as the Run's initial Evidence item (FR6, AD-18)
**And** the deterministic parser's output, after the structured inclusion rule over declared columns, is the population of record (FR6)

**Given** the acquired snapshot
**When** the Gate reconciles it
**Then** rows parsed equal the declared row count exactly and the digest matches at file level, and rows in equal rows included plus rows excluded with a reason for every exclusion at inclusion level (FR33, addendum H)
**And** a row that fails the inclusion rule is listed with its reason, and a non-USD LedgerFlow transaction is excluded by the rule and never currency-converted (addendum B, addendum C)

**Given** a post-inclusion population with zero records
**When** the Gate evaluates it
**Then** the Run is `INCONCLUSIVE` unless the Procedure Version opts in to a zero-record Pass (FR6, addendum H)

**Given** acquisition cannot complete after bounded retries
**When** the Session Step exhausts its retry budget
**Then** the Run ends `RUN_FAILED` (FR34, AD-3)

### Story 3.3: Extract adapter-acquired Target Systems and freeze Reference Sources

As an Auditor,
I want the Adapter to extract each adapter-acquired Target System and acquire any Reference Source before evaluation begins,
So that P-2 and P-3 Procedures run to a conclusion with no model in the loop.

**Acceptance Criteria:**

**Given** a P-2 Run
**When** the worker executes the AccessGate extraction
**Then** it runs as one adapter Work Item covering the whole population, with one Observation per active account carrying a grounded role list (addendum C, FR21, AD-18)

**Given** a Procedure Version that names a Reference Source (RoleMatrix for P-2)
**When** the Run starts
**Then** the Adapter acquires it as a Session Step before any Work Item, and the artifact is registered, digested, and frozen into the Evidence Package before evaluation; the evaluator later consumes its parsed content as an input value and performs no I/O of its own (AD-18)

**Given** a P-3 Run
**When** the worker executes the ApproveNow extraction
**Then** it runs as one adapter Work Item per extraction, and each covered transaction gets a grounded approval-lookup Observation with `found ∈ {true, false, ambiguous}` (FR21, AD-18, addendum C)

**Given** an adapter-acquired Target System or API Population Source with an opaque `CredentialRef`
**When** the Adapter opens its connection
**Then** `CredentialProvider` supplies the read-only API token to the worker adapter just in time, the retrieval is audited without the secret value, and the token never appears in the Timeline, Evidence, logs, or exports (FR20, AD-4, NFR1)

**Given** the Run's Session Steps and Work Items
**When** they execute
**Then** each Work Item has its own state, Step Executions, Observations, Evidence, and Timeline segment, executed sequentially, and the model never assumes one Run equals one worker (FR22)

### Story 3.4: Register Observations in the one wire schema, in batches

As an Auditor,
I want Adapter-produced Observations to use the same schema and the same transactional registration pattern as any other acquisition path,
So that the Gate and evaluator treat every Run the same way regardless of how Evidence was acquired.

**Acceptance Criteria:**

**Given** an adapter extraction completes a batch of records
**When** the batch is registered
**Then** registration is one transaction and one Timeline event carrying the Observation digests, and the per-Observation Gate checks and the deterministic evaluator run inside that same transaction (AD-3, AD-18)
**And** the Observation registration event carries each Observation's digest so a pre-finalization row change is detectable (AD-22)

**Given** the wire schema
**When** an Observation is emitted by any Adapter
**Then** it carries `work_item_id`, `population_record_key`, `target_system`, `found ∈ {true, false, ambiguous}`, `observed_at` (UTC), `step_execution_id`, `capture_method = adapter`, a grounded `identity` attribute (required when `found = true`), `match_origin = platform`, and declared attributes as `{name, original_value, normalized_value, grounding, corroboration}`, all under a `schemaVersion` (FR31, addendum B.1, AD-14, AD-18)

**Given** a `found = false` Observation
**When** it is registered
**Then** it is valid only with, for every declared search key, an Adapter-Action-derived query key equal to the record's normalized key value, a stored empty-result response artifact, and a passing extraction-completeness check; otherwise the covered record is `UNINSPECTED` (FR31, AD-6, addendum B.1)

### Story 3.5: Seal Evidence with reservation and digest verification

As an Auditor,
I want every Evidence artifact reserved and digest-verified before it is Registered, and the package sealed only when every required artifact is present,
So that nothing produced during a Run can be silently substituted, lost, or later removed.

**Acceptance Criteria:**

**Given** an artifact the Run must preserve (Adapter extract, source excerpt, uploaded Population Source file)
**When** it is produced
**Then** the application reserves it with an idempotency key and a unique provisional object key before upload, and `EvidenceStore` verifies availability, size, and digest before one transaction marks it Registered (AD-5, FR31)

**Given** every terminal transition of the Run
**When** it commits
**Then** `SealPackage` seals the Evidence Package only when every `required` artifact is Registered and verified, and any open reservation is marked `abandoned` and listed on the Result and export (AD-5, FR32)

**Given** a later change to the Source or the expiry of provider retention
**When** either occurs
**Then** the Evidence already preserved is never removed, and every evaluated record and every Exception still traces to its Observations, Evidence, Steps, and version (FR32)

**Given** stored Evidence, an Observation, the Timeline, or lineage
**When** a mismatch against its recorded digest is detected
**Then** a mismatch during the Run ends it `RUN_FAILED`; a mismatch found afterward is an Audit Trail integrity event flagged on the Result and exports with no state change, and correction requires a new Run (FR35)

### Story 3.6: Corroborate Observations against the stored Structural Snapshot

As an Auditor,
I want every declared attribute and identity re-read from the stored snapshot with a deterministic extractor,
So that an Adapter's assertion can never stand uncorroborated.

**Acceptance Criteria:**

**Given** a Structural Snapshot of substrate kind `sheet` or `json`
**When** the domain corroboration extractor re-reads an attribute's `locator`
**Then** the attribute is `matched` when the re-read value equals `original_value` and the re-read label matches the label the Procedure Version declares, and `contradictory` otherwise (AD-6, AD-18)
**And** the Structural Snapshot contract enumerates the substrate kinds `{web_tree, desktop_tree, sheet, json}`, each with a locator grammar and a label rule (accessible name, control name, header cell, property key path), and the one domain extractor implements `sheet` and `json` here with the other two kinds left as explicit unimplemented cases (AD-18)

**Given** a `found = true` Observation
**When** identity corroboration runs
**Then** the extractor's re-read of the grounded identity attribute must equal the normalized population record key (FR33, addendum H)

**Given** an attribute marked `contradictory`
**When** the per-Observation Gate check runs
**Then** the record is `UNEVALUATED` and the Run-level check fails `INCONCLUSIVE` (FR33, addendum H)

**Given** a `found = ambiguous` Observation
**When** the ambiguous-match Gate check runs
**Then** the covered Work Item is `AMBIGUOUS`, the record is `UNEVALUATED`, and the Run is `INCONCLUSIVE` (FR33, addendum H)

**Given** matched records
**When** they are normalized
**Then** originals and transformation history are retained, matching uses exact normalized keys where identifiers are strings that keep leading zeros so `007` and `7` never match, date-times are normalized to UTC with source offsets preserved, and unmatched or multiply matched records are shown and never Compliant (FR36)

### Story 3.7: Evaluate corroborated Observations deterministically and raise Exceptions

As an Auditor,
I want compiled conditions applied deterministically to every corroborated Observation,
So that a Rule-Classified result is reproducible and every Exception is traceable.

**Acceptance Criteria:**

**Given** a compiled condition whose applicability predicate selects a corroborated record
**When** the deterministic evaluator runs at registration
**Then** it evaluates the condition with origin `RULE`, and record evaluation derives in order Exception, then Unevaluated, then Compliant (FR9, FR37, AD-6)

**Given** identical Observations and the same version
**When** evaluation is repeated
**Then** it yields identical Rule-Classified evaluations; no human can override one, and disagreement is recorded separately (FR37)

**Given** an attribute value a compiled condition does not name
**When** the condition is evaluated
**Then** it evaluates `UNEVALUATED` with diagnostic `rule does not name value <v>` (FR9, addendum B)

**Given** a P-3 transaction whose amount equals USD 100,000
**When** the boundary condition is evaluated
**Then** the inclusive boundary requires approval at exactly USD 100,000 (FR9, addendum C)

**Given** the first `EXCEPTION` evaluation recorded for a record
**When** it is registered
**Then** the evaluation module creates the Exception in that same transaction with a Run-stable identifier and an HMAC-SHA-256 fingerprint (key ID retained), and it is never deleted (AD-6)

**Given** unmatched, ambiguous, uninspected, or uncorroborated records
**When** any condition is evaluated for them
**Then** they are never Compliant (FR9)

### Story 3.8: Run the full Evidence Quality Gate and map limit exhaustion to a safe outcome

As an Auditor,
I want the Run-level Gate to check everything before any conclusion is reached,
So that Inconclusive and Run Failed are the honest outcomes whenever Evidence falls short.

**Acceptance Criteria:**

**Given** the last Work Item completes
**When** the Run-level Gate runs
**Then** every addendum H row not already checked per Observation runs: population acquisition, count reconciliation at file and inclusion level, empty population, per-record coverage, condition completeness, pagination/extraction completeness, schema, mandatory values, duplicate primary keys, ambiguous match, snapshot freshness, and Target System freshness (FR33, addendum H)
**And** a snapshot whose generation time is earlier than the end of the effective period, later than Run initiation, or unknown is `INCONCLUSIVE`; an empty mandatory identifier, a duplicate primary key, an unparseable timestamp, or an undeclared schema field each raise a Gate event (addendum B, addendum H)

**Given** any Gate row fails
**When** the failure is recorded
**Then** each check outcome with its diagnostic is a Timeline event, the Run moves to `INCONCLUSIVE`, and the Result names the affected systems, checks, Work Items, and records (FR33, FR34, AD-3)

**Given** Run-level Step Execution, time, or token limit exhaustion
**When** the limit is reached
**Then** the Run stops `INCONCLUSIVE` with partial Evidence preserved (FR23, addendum E.1)

**Given** a Session Step failure after bounded retries, a denied action, or a during-Run integrity mismatch
**When** it occurs
**Then** the Run ends `RUN_FAILED`, and a denied action or scope violation is also logged as a security event (FR23, FR34, FR35, AD-3)

**Given** an adapter Work Item exhausts its first bounded retry cycle
**When** execution continues
**Then** it automatically receives one additional bounded cycle, without a human retry/skip Escalation; both cycles obey the frozen retry limit and every attempt counts against the Run limits (owner decision 2026-09-05, addendum section 0)

**Given** a per-Work-Item failure (a second adapter retry-cycle exhaustion to `FAILED`, or an explicit skip on a later agent-driven path)
**When** it happens
**Then** the Run continues rather than stopping, and the coverage check later yields `INCONCLUSIVE` (FR34)

**Given** every Gate check passes
**When** `CompleteRun` runs
**Then** it commits the Gate decision, the Result, the Run state `COMPLETED`, the final checkpoint, and the Timeline events atomically, or none of them (AD-3, AD-21)

### Story 3.9: Seal the Result and publish the adapter Run's outputs

As an Auditor,
I want the Result to seal into one immutable System Outcome and report everything the Template promises,
So that I can act on Pass or Control Failure with confidence.

**Acceptance Criteria:**

**Given** a `COMPLETED` Run with no evaluation pending
**When** `CompleteRun` runs
**Then** `SealResult` computes the System Outcome exactly once in the same transaction: Pass when every Gate check passed, the Result is sealed, and no condition is Exception or Unevaluated; Control Failure when any Exception counts toward the outcome, with any Unevaluated records listed (FR40, AD-21, addendum E.1)

**Given** the addendum E.1 outcome table
**When** an outcome is computed
**Then** its rows apply in order and the first matching row wins across Canceled, Run Failed, Inconclusive, Pending Confirmation, Control Failure, and Pass (FR40, addendum E.1)

**Given** a sealed Result
**When** sealing completes
**Then** the Result version increments, a passed Gate is necessary but not sufficient for Pass, and the outcome never changes thereafter (FR40, AD-21)

**Given** the Result
**When** it is published
**Then** it reports the population, exclusions with reasons, inspected and uninspected records per Target System, per-condition counts by origin and confirmation state, and the Template's control-specific fields per addendum C; excluded, uninspected, or Unevaluated records are never counted Compliant (FR39)

**Given** the version's stored scope statement
**When** the Result is shown
**Then** the scope is shown verbatim (FR5)

**Given** a version that opted in to a zero-record Pass and a post-inclusion population of zero records
**When** the Gate passes and the Result seals
**Then** the outcome is Pass with population 0 and every count 0, and the generated statement says that no record was inspected (FR6, addendum E.1)

### Story 3.10: Cancel an active Run and start a linked rerun

As an authorized user,
I want to cancel a Run in progress and start a fresh linked Run,
So that a stuck or wrong Run never has to be left running or silently reused.

**Acceptance Criteria:**

**Given** an active Run (`QUEUED` or `RUNNING` in this epic's adapter-only scope)
**When** a user cancels it from Run Detail
**Then** `CancelRun` writes `cancel_requested`; the web command performs the `CANCELED` transition and cancels the dispatch job for `QUEUED`, and the worker performs it for `RUNNING` at the next boundary; Evidence already captured is preserved (FR26, AD-3)

**Given** `CANCELED`
**Then** it is reserved for explicit human cancellation and never produced by a timeout (FR26, addendum E)

**Given** any terminal Run
**When** a user requests a new Run
**Then** a new linked Run is created recording the predecessor and reason, and the prior Run is not changed (FR26, AD-3)

### Story 3.11: See Runs and inspect an adapter Run's Result, Evidence, Exceptions, and Timeline

As an Auditor,
I want the Runs list and Run Detail to show me an adapter Run's lifecycle, Gate, outcome, Evidence, and Timeline,
So that I can act on a Run without reading logs.

**Acceptance Criteria:**

**Given** the Runs surface
**When** it loads
**Then** the table shows Run, Procedure, Effective period, Lifecycle, Result outcome, Gate, Review, Initiator, Elapsed, and Change columns, each row's lifecycle label drawn from Queued, Running, Completed, Inconclusive, Run Failed, or Canceled, with skeleton rows on cold load and request-time reads behind the "Updated {time}. Refresh." Banner; the 5-second live bound arrives with the live channel in Epic 5 (FR48, FR29, UX-DR13, UX-DR35)

**Given** Run Detail
**When** it opens
**Then** the tabs Result, Evidence, Exceptions, Review, and Execution Timeline render with the conclusion triptych (lifecycle, Gate, outcome with pending count, sealed marker, Result version) over a generated statement, and rail cards for Procedure Version and Schedule, Change since previous Run, and Technical detail (UX-DR14)

**Given** Queued, Running, Completed sealed, Inconclusive, Run Failed, or Canceled
**When** each is shown
**Then** Queued shows the triptych with an empty Evidence tab; Running shows live Gate rows; Completed sealed shows Pass or Control Failure; Inconclusive shows its failed Gate rows first, a Safe next action panel, and Submit disabled with reason; Run Failed shows an execution-failure panel naming the Session Step, retries, and error class; Canceled shows the canceling actor and elapsed time (UX-DR15)

**Given** the Result tab
**When** it renders
**Then** the Gate checklist groups Per-Observation and Run-level rows, each with a status icon, word, rule text, diagnostic, and links to affected Work Items, with a derived header count, and population reconciliation shows file-level rows above inclusion-level rows with excluded rows expanding to their reasons (UX-DR16, UX-DR17)

**Given** an evaluation on the Result or an Exception
**When** its card renders
**Then** it shows the Rule-Classified origin badge, value badge, rationale, and confidence in mono, with no controls, since this epic's Procedures raise no Agent-Judged evaluation (UX-DR18)

**Given** the Evidence tab
**When** it renders
**Then** one Evidence item card appears per item with the FR31 fields and its kind badge (Adapter extract, Source excerpt), and opening a sheet or json Structural Snapshot opens the grounding inspector showing the original value, normalized value, the snapshot at the locator, the locator and label in mono, and the corroboration badge (UX-DR19, UX-DR20)

**Given** the Execution Timeline tab
**When** it renders
**Then** nested rows for Session Step, Work Item, Step Execution, and Adapter Action appear on the four-column grid, collapsed to Work Item rows by default except that errors, limits consumed, and version stamps stay expanded, and it is written live while the Run is Running (FR29, UX-DR23)

**Given** the Exceptions tab
**When** it renders
**Then** it lists each Exception read-only by identifier, state badge, and condition violated, with disposition controls deferred to later epics

**Given** Run Detail or Runs
**When** data on screen goes stale
**Then** a "Updated {time}. Refresh." Banner appears, with no auto-refresh of the detail page and pagination on the Runs list (UX-DR35)

## Epic 4: The Audit Agent works a web Target System under supervision rules

The Audit Agent signs in to LoanCore in an isolated Agent Workspace, inspects each terminated employee, and registers grounded Observations; when it cannot proceed safely the platform raises a typed Escalation that an Auditor answers from Run Detail, and an Auditor confirms or rejects Agent-Judged evaluations so the Result can seal. This epic delivers the Solari browser execution adapter with allowlists and read-only denial, just-in-time credentials with redaction, the accessibility-tree extractor, absence proof, bounded limits, durable waits, in-app and email notification, and the evaluation confirmation flow, proven on the hero (LoanCore only) and Production Configuration Deviation golden datasets.

### Story 4.1: Provision an isolated Agent Workspace per Run

As an Audit Runner,
I want a fresh, isolated Agent Workspace created for every Run with an agent-driven Step,
So that no state, credential, or session ever crosses from one Run into another.

**Acceptance Criteria:**

**Given** a Run whose plan includes an agent-driven Target System
**When** the worker starts the Run's first Session Step
**Then** it creates a fresh Solari-backed workspace for that Run only, bound to it for the Run's lifetime, and the workspace is destroyed at Run end with nothing persisted into a later Run (FR19)
**And** an adapter-only Run needs no workspace and its Live View shows Adapter Session Steps instead (FR19)

**Given** an Agent Workspace
**When** the worker attempts egress from it
**Then** only the Procedure Version's allowed origins are reachable; every other destination is denied and the denial is logged as a security event (FR19, AD-4)
**And** workspace creation failure is a Session Step exhaustion that yields `RUN_FAILED` (FR19, addendum E)

**Given** a wait record raised inside the workspace's Run (Escalation or Pause)
**When** the wait opens
**Then** the workspace is kept alive under a lease to the wait's deadline rather than torn down (AD-16)
**And** every terminal Run transition and a periodic sweep reap any orphaned workspace and revoke its credentials, verified by a negative test that a workspace outlives no Run (NFR5)

### Story 4.2: Sign in to LoanCore and enforce read-only, allowlisted actions

As an Audit Agent,
I want to sign in to LoanCore through `BrowserExecution` and have every action checked against the version's allowlist,
So that a write, an out-of-scope origin, or an out-of-scope action is denied and logged rather than executed.

**Acceptance Criteria:**

**Given** the Procedure Version's frozen registration for LoanCore
**When** the Audit Agent performs the sign-in Session Step
**Then** Solari's browser SDK opens LoanCore with request interception enforcing the version's allowed origins, and only the version's permitted read actions may be invoked; a write action, an out-of-scope origin, or an out-of-scope parameter is denied before it reaches LoanCore and logged as a security event (FR3, AD-4)

**Given** an Audit Instruction whose seeded scope-widening language reached execution (an unregistered system, a write verb, an out-of-scope origin)
**When** the agent attempts to act on it
**Then** the action is denied at execution and recorded as a security event, independent of the authoring-time flag (FR8)
**And** retrieved LoanCore content cannot change the objective, permissions, tool scope, or Compliance Rule for the remainder of the Run (FR3, AD-9)

**Given** the `BrowserExecution` conformance contract
**When** any Tool Action executes
**Then** redirects, downloads, cancellation acknowledgment, timeout accounting, and trace ordering follow the contract, and every Tool Action is logged with a sanitized action schema shared with Adapter Actions (AD-4, AD-10)
**And** a shared conformance suite exercises the contract in CI (AD-12)

### Story 4.3: Supply credentials just in time and suppress capture during entry

As an Audit Agent,
I want the LoanCore credential supplied only at the moment of sign-in and never captured on screen,
So that no secret ever reaches Timeline, Evidence, logs, or exports.

**Acceptance Criteria:**

**Given** the opaque `CredentialRef` on the Target System registration
**When** the sign-in Tool Action needs it
**Then** `CredentialProvider` supplies the read-only LoanCore credential to the worker adapter just in time, the retrieval is audited without the secret value, and the credential never appears in Timeline, Evidence, logs, or exports (FR20, AD-4)

**Given** a credential-entry Tool Action (typing the username or password)
**When** the platform captures Structural Snapshots, screenshots, or frames
**Then** capture is suppressed for that Tool Action and any secret-typed input value is redacted from every captured artifact before registration (AD-4)
**And** an artifact found to contain a credential value fails registration rather than being stored (AD-4)

**Given** a seeded negative test for credential redaction
**When** it runs against a captured sign-in sequence
**Then** it proves no credential-shaped value survives into a Structural Snapshot, screenshot, frame, log line, or export (AD-4, NFR1)

### Story 4.4: Locate a record, capture Evidence, and register a grounded Observation

As an Audit Agent,
I want to search LoanCore for each terminated employee, capture the account page's Structural Snapshot and screenshot, and register a grounded Observation,
So that every attribute the evaluator uses traces to platform-captured Evidence bound to the Tool Action that read it.

**Acceptance Criteria:**

**Given** a Work Item for one terminated employee
**When** the agent signs in, searches by employee ID (falling back to full name), and opens the account record
**Then** the platform captures the Structural Snapshot (`web_tree`) and a screenshot at the reading Tool Action, each bound to it with LoanCore's URL, and every declared attribute (`account_status`, `username`, `roles`) is grounded in that snapshot with locator, label, and extracted text, never in the screenshot (FR10, AD-6, AD-18)

**Given** a `found = true` Observation
**When** it is registered
**Then** it carries an identity attribute grounded in the same Structural Snapshot as the value attributes, and a platform key match over the search-result rows is recorded as a separate `match` provenance node comparing the matched-row locator to the record key (FR20, AD-6)
**And** the per-Observation Gate checks and the deterministic evaluator for compiled conditions run in the same registration transaction (FR20, AD-3)

**Given** the grounding inspector on a registered attribute
**When** an Auditor opens it
**Then** it shows the original value, normalized value, the Structural Snapshot at the locator, and the locator and label in mono, with a corroboration badge explaining any mismatch (UX-DR20)
**And** a record with no Observation for the required Target System is `UNINSPECTED`; the agent stops and reports rather than guessing at a missing or unreadable field (FR20)

### Story 4.5: Prove absence for an employee with no account

As an Audit Agent,
I want a "no account found" result to require proof, not just my report,
So that a false absence claim cannot manufacture a Compliant record.

**Acceptance Criteria:**

**Given** a terminated employee record with no matching LoanCore account
**When** the agent searches by every declared search key
**Then** the sanitized `type` Tool Action's query string is compared, after §B normalization, to the population record's key value for each declared key, and the empty-result page is captured as a Structural Snapshot (FR20, AD-6, addendum B.1)

**Given** an absence claim missing any of its required fields (query-string match, grounded empty-result snapshot, or full result-page consumption)
**When** the Observation is registered
**Then** the Work Item is `UNINSPECTED` rather than a Compliant absence (FR20, addendum B.1)
**And** the golden dataset's silent-timeout or partial-pagination case and mistyped-search-key case both yield `UNINSPECTED` and an Inconclusive Run, never a false Compliant absence (addendum D)

### Story 4.6: Bound agent execution and render retrieved content inert

As an Audit Agent,
I want fixed retry, time, and token limits, a recorded model identity, and no channel for retrieved content to act as an instruction,
So that exhaustion or a hostile page fails safely instead of fabricating an Observation or expanding scope.

**Acceptance Criteria:**

**Given** a Run's frozen limits (retries per Step Execution, Run-level Step Execution count, time, tokens)
**When** the agent executes
**Then** `ModelGateway` and tool ports enforce one conformance contract for ordered tool calls, cancellation, timeout and token accounting, and structured uncertainty; tools, model identity, configuration, and prompt version are recorded per Run and cannot be changed by retrieved content (FR23, AD-9)

**Given** limit exhaustion
**When** a Step Execution's retries are exhausted
**Then** a *retry or skip* Escalation is raised; Run-level Step Execution, time, or token exhaustion stops the Run `INCONCLUSIVE` with partial Evidence preserved; no path fabricates an Observation (FR23, addendum E.1)

**Given** LoanCore page content containing a seeded injection string
**When** the agent reads it
**Then** the content is stored as untrusted and rendered inert everywhere it is shown, in a warning-bordered block labeled untrusted, never as executable instruction or markup (FR23, UX-DR34, UX-DR41)
**And** any agent narration shown alongside is labeled as agent-generated, distinct from the platform-derived narration built from sanitized Tool Actions (AD-9, UX-DR41)

**Given** the direct Anthropic and OpenAI provider adapters
**When** a Run executes
**Then** the default model is `claude-sonnet-5` via the Anthropic adapter with OpenAI wired as fallback, and provider route, model identity, model configuration, prompt version, build version, and terminal reason are persisted on the Run (AD-9)

### Story 4.7: Raise typed Escalations as durable waits

As an Auditor,
I want *choose candidate*, *unnamed value*, and *retry or skip* Escalations raised as durable Run states with a wait record and exactly one durable job,
So that an unanswered question survives a worker restart and times out on its own, never twice.

**Acceptance Criteria:**

**Given** a LoanCore search returning more than one grounded candidate row, or the platform's key match finding no unique row
**When** the platform raises a *choose candidate* Escalation
**Then** the Run enters `AWAITING_AUDITOR`, a wait record `{kind, options, deadline, closed_at?, closure_kind?, answer_option_id?, actor?}` is persisted with the candidate rows and their grounded keys as supporting Evidence, and exactly one durable job is created in the same transaction with `startAfter = deadline` (4 hours), singleton key `wait:<wait id>`, and payload `{schemaVersion, runId, waitId}` only; the wait record is kind-agnostic, so the same record and wake handler serve every Escalation kind and, later, Pause (FR27, AD-16)
**And** the closed answer set is exactly "choose by the declared secondary key" (full name for the hero) or "mark the record ambiguous"; a record chosen by secondary key is flagged human-matched in every Result, list, and export, and the platform resolves a search with exactly one grounded key match itself with no Escalation; two result rows carrying the same grounded key are not a unique match and raise choose candidate, and zero rows is an absence claim handled by the absence path, never an Escalation (FR27, addendum B)

**Given** a compiled condition meeting an attribute value outside the set it names
**When** the platform raises an *unnamed value* Escalation
**Then** the condition is recorded Unevaluated with diagnostic `rule does not name value <v>` and the closed answer set offered is exactly "mark Unevaluated and continue" or "abort" (FR27, addendum B)

**Given** a Step Execution's retry budget exhausted
**When** the platform raises a *retry or skip* Escalation
**Then** the closed answer set offered is exactly "retry" (one more bounded retry cycle counted against the Run-level Step Execution limit), "skip" (Work Item `UNINSPECTED`), or "abort", and the Work Item enters `AWAITING` while the wait is open; a second exhaustion after "retry" marks it `FAILED` and the Run continues (FR27, addendum E.1)

**Given** any open Escalation
**When** the agent is briefed to continue
**Then** the agent receives only the chosen option identifier and nothing else; no answer evaluates a record or changes scope, credentials, tools, or the Compliance Rule (FR27, AD-9)
**And** the question shown to a human is labeled agent-generated and rendered inert, never as an instruction channel back to the agent (UX-DR27, UX-DR41)

### Story 4.8: Answer an Escalation from Run Detail and notify Audit Managers

As an Auditor,
I want to answer an open Escalation from Run Detail and know both the Escalation and its notification are handled once, correctly,
So that the Run resumes on my decision and Audit Managers are told without seeing any Evidence in the message.

**Acceptance Criteria:**

**Given** an `AWAITING_AUDITOR` Run
**When** it enters that state or an Auditor flags it
**Then** notification records are created in the same state-change transaction for the initiating Auditor (or the Procedure author for a scheduled Run) and every Audit Manager, delivered in-app and by email through `NotificationSender` with idempotent send keys, each delivery outcome recorded on the Audit Trail (FR28, AD-20)
**And** the content names Procedure, Run, Escalation kind, and time remaining, and contains no Evidence value, question text, or secret (FR28, AD-20)

**Given** the Notifications surface and the top-bar bell
**When** an Auditor or Audit Manager opens either
**Then** one row per Awaiting Auditor or flagged Run shows Procedure, Run, Escalation kind, and time remaining computed from the open wait record, the bell carries the unread count, each row opens the Run, an email link deep-links to the same Run, and the empty state reads "No Run is waiting on you." (FR28, AD-20, UX-DR30)

**Given** the Escalation panel on Run Detail
**When** an Auditor opens it
**Then** it shows kind, Step, the inert agent-generated question, supporting Evidence (candidate rows with grounded keys for *choose candidate*), closed answer buttons in FR27 order with no recommendation, an optional note labeled "Recorded, not sent to the agent", and a countdown; it appears at the top of every tab while Awaiting Auditor and Pause is disabled with "A Run waiting on an answer cannot be paused." (FR27, UX-DR15, UX-DR27)

**Given** an Auditor selects an answer
**When** they confirm it
**Then** answering opens a routine confirmation dialog, and closing the wait is one command that locks the wait row, requires it open and the expected Run revision, and writes `{closed_at, closure_kind, answer_option_id, actor}`; a second closure attempt on the same wait fails the precondition (FR27, AD-16)
**And** the answer is scoped to this Run only, appears on the Execution Timeline and in the Workpaper Bundle, and after answering the panel becomes a Timeline entry (FR27, UX-DR27)

**Given** an Auditor selects *abort* on any Escalation kind
**When** they confirm the routine cancel confirmation
**Then** the Run ends `CANCELED` with reason "Escalation answer: abort" (FR27)

**Given** an open Escalation left unanswered
**When** its wait job wakes past the 4-hour deadline
**Then** the wake handler locks the wait row and moves the Run to `INCONCLUSIVE` with Evidence preserved, and the notification for that wait is skipped as `superseded` if it was already closed before the wake fires (FR27, AD-16, AD-20)
**And** an answer submitted after the deadline is refused and the panel shows "This Escalation timed out at {time}; the Run is Inconclusive." (UX-DR15)

### Story 4.9: Confirm or reject Agent-Judged evaluations to seal the Result

As an Auditor,
I want to confirm or reject each pending Agent-Judged evaluation for condition C2,
So that the Result can seal instead of sitting Pending Confirmation forever.

**Acceptance Criteria:**

**Given** a `found = true` LoanCore Observation and an uncompiled condition (C2, privileged-roles judgment)
**When** the agent registers its evaluation
**Then** the registration envelope carries the Agent-Judged evaluation with origin `AGENT_JUDGED`, confirmation `pending`, a confidence in [0, 1], and rationale, in the same registration transaction as the Observation (FR38, AD-6)

**Given** the version's confidence threshold (default 0.80)
**When** the agent's confidence for that evaluation is below it
**Then** the evaluation is stored with value `UNEVALUATED`, origin `AGENT_JUDGED`, confidence retained, and needs no confirmation (FR38, AD-6)
**And** a confidence exactly equal to the threshold is `pending` and needs confirmation; a missing confidence or one outside [0, 1] fails wire-schema validation at the adapter boundary and the Step Execution is retried under its retry budget (addendum B.1, AD-14)

**Given** a Completed, unsealed Run with pending Agent-Judged evaluations
**When** Run Detail renders
**Then** the outcome shows "Pending Confirmation" with "{n} Agent-Judged evaluations await confirmation" and Submit is disabled with "Submission is unavailable while the Result is unsealed." (UX-DR15)
**And** each pending evaluation card shows origin badge, value badge, rationale, and confidence in mono, with Confirm and Reject controls; a below-threshold card shows value Unevaluated with its confidence and no controls; Rule-Classified cards have no controls (UX-DR18)

**Given** an Auditor confirms a pending evaluation
**When** `ConfirmEvaluation` runs
**Then** it is refused unless the Run is `COMPLETED` and the Result unsealed; it locks the Result row under the expected revision, increments the revision, and evaluates the seal condition inside that lock (FR38, AD-21)

**Given** an Auditor rejects a pending evaluation
**When** the rationale dialog is completed with a rationale and a replacement value (Compliant, Exception, or Unevaluated)
**Then** `RejectEvaluation` records the replacement with origin `HUMAN`, keeps the rejected Agent-Judged evaluation visible beneath it as history, and evaluates the seal condition under the same lock (FR38, AD-21, UX-DR18)

**Given** the last pending evaluation on a Result is resolved
**When** its confirmation or rejection commits
**Then** `SealResult` computes the System Outcome exactly once, increments the Result version, and refuses every later evaluation mutation (AD-21)
**And** when the resolving rejection leaves a condition Unevaluated and no Exception counts toward the outcome, sealing moves the Run `COMPLETED → INCONCLUSIVE` with Evidence preserved (AD-21, addendum E.1)

### Story 4.10: Prove the agent path on ProdConsole with one Observation per parameter

As an Audit Agent,
I want to read all four ProdConsole parameters and the signed snapshot identifier from one page in a single Work Item,
So that the Production Configuration Deviation Procedure has grounded, reconciled Evidence with no adapter in the loop.

**Acceptance Criteria:**

**Given** the P-4 Template's one agent Work Item for the ProdConsole page
**When** the agent reads it
**Then** one Observation is registered per baseline parameter (`max_manual_approval_amount`, `mfa_required_for_admin`, `session_timeout_minutes`, `production_debug_mode`), each grounded in the page's Structural Snapshot with the parameter name as its identity attribute (FR20, AD-18, addendum C)

**Given** ProdConsole's signed snapshot identifier and expected parameter count, both agent-extracted
**When** the Work Item's Observations are registered
**Then** the Gate reconciles the agent-extracted declared count exactly against the Observations registered, the same as any other declared count (AD-18, addendum H)

**Given** the P-4 golden dataset
**When** the Run executes end to end
**Then** the four parameters produce grounded Observations under the one Work Item, and any parameter absent or partially readable yields `INCONCLUSIVE`, never a silent Compliant (FR20, addendum C)

### Story 4.11: Prove abuse resistance and workspace isolation with negative tests

As a developer,
I want automated abuse tests and workspace isolation tests that fail the build on any breach,
So that scope-widening, secret disclosure, and cross-Run leakage are proven absent, not merely believed absent.

**Acceptance Criteria:**

**Given** retrieved LoanCore content, including content surfaced through an Escalation question
**When** the seeded abuse tests run
**Then** they prove none of it can expand scope, invoke a denied tool, disclose a secret, alter the Compliance Rule, or modify the Run objective (NFR2)
**And** the two seeded injection strings from the golden dataset (one shaping an Escalation) are exercised and both fail to affect Run state (addendum D, NFR2)

**Given** two concurrent Runs each with their own Agent Workspace
**When** the isolation negative tests run
**Then** each workspace is proven isolated from the other Run and from the web app, holds no credential once its Run ends, and can reach only its own allowlisted destinations (NFR5, AD-4)

**Given** the three seeded scope-widening Audit Instructions (unregistered system, write verb, out-of-scope origin)
**When** the Run executes them
**Then** all three are denied at execution and logged as security events, matching the 100% denial bar (FR3, FR8, addendum D)

### Story 4.12: Evaluate the 24-hour disablement window through the complete journey

As an Auditor,
I want the P-1 24-hour disablement window evaluated through the complete journey,
So that the D3 owner decision is proven end to end.

**Acceptance Criteria:**

**Given** the disablement-window journey (`tests/e2e/disablement-window-journey.spec.ts`, CLAUDE.md 2026-09-08 D3)
**When** it runs
**Then** E-000105's exactly-24-hour case is Compliant under the inclusive boundary and the variant `disabled_time` attribute is captured only when the version's Evidence Requirements name it (story present on `main`; heading added 2026-09-25 so the tracking key `4-12-…` is regenerated rather than dropped)

## Epic 5: Watch, pause, and replay the agent

An Auditor opens Live View to watch the workspace screen, Observations, and Gate rows as they happen, pauses and resumes a Running Run, cancels it, flags it to Audit Managers, and answers an Escalation without leaving the screen; later, any authorized user replays any terminal Run from the platform-owned Replay asset set, jumping to any Work Item, Exception, or Escalation, even with the Workspace Provider unreachable. This epic delivers the LISTEN/NOTIFY plus SSE live channel, the shared session viewer, durable pause and resume, the Replay asset set captured during execution, and the Replay surface itself.

### Story 5.1: Stream the Execution Timeline live over SSE

As an Auditor,
I want the Execution Timeline to reach the browser within seconds of being written,
So that Live View, Run Detail, the Runs list, and my notification badge all reflect Run progress without me reloading.

**Acceptance Criteria:**

**Given** a Timeline event is appended by worker or web
**When** the append transaction commits
**Then** a `NOTIFY run_timeline(run_id, seq)` fires in the same transaction, and `seq` is the chain sequence allocated under the Run head row lock, gapless and commit-ordered across writers (AD-17)

**Given** a client requests `/runs/<run-id>/events?after=<seq>`
**When** the route opens
**Then** it replays every Timeline event with `seq` greater than the cursor in order before streaming new ones, sends a heartbeat comment at most every 30 seconds, and caps its own stream lifetime under 15 minutes (AD-17)
**And** Live View, the active Run Detail, the Runs list, Overview counts, and the notification badge each subscribe to this one channel, with no WebSocket, Redis, or provider stream as a source of truth (AD-17)

**Given** a stream disconnects and reconnects
**When** the client resumes with its last-seen `seq` as cursor
**Then** no event is skipped and none is delivered twice (AD-17, NFR7)
**And** Live View reflects Run state within 5 seconds, and a stale indicator appears after 15 seconds without an update (FR24, UX-DR35, NFR7)

### Story 5.2: Capture the platform-owned Replay asset set during execution

As an Auditor,
I want every Tool Action, Escalation, and Session Step to leave behind the exact frames and data Replay needs,
So that I can replay any terminal Run without the platform ever calling the Workspace Provider again.

**Acceptance Criteria:**

**Given** a Tool Action executes
**When** it completes
**Then** the platform captures a timestamped frame, the sanitized action, and the Observation delta as Replay assets, each reserved with an idempotency key and unique object key before upload and verified by size and digest before being marked Registered with `role = replay` (FR30, AD-9, AD-5)

**Given** an Escalation is raised and answered, or a Session Step starts and ends
**When** either happens
**Then** the Escalation's question, options, answer, actor, and time, and the Session Step's start, end, and outcome are captured as Replay assets (AD-9, addendum F)

**Given** a frame capture fails or is missing
**When** the package is sealed
**Then** a Timeline `frame_missing` event is recorded and flagged on Replay and export, and the seal is not blocked, because `replay`-role artifacts never gate `SealPackage` (AD-5)
**And** frames suppressed during a credential-entry Tool Action are recorded as suppressed, never as `frame_missing` (AD-4, AD-5)

**Given** the Workspace Provider recorded the session
**When** the Run ends
**Then** the recording is copied into platform storage at Run end and provider retention is set to minimum; Replay never depends on the provider afterward (resolved decision, 2026-09-01)

### Story 5.3: Watch a Running Run in Live View

As an Auditor,
I want to open Live View on a Running, Paused, or Awaiting Auditor Run and see its current Step, Work Item, workspace screen, Observations, Evidence, and Audit Instructions,
So that I can supervise the Audit Agent's work as it happens.

**Acceptance Criteria:**

**Given** a Running Run
**When** an Auditor opens Live View
**Then** the session viewer renders inside a navy chrome strip with state dot and word LIVE, the workspace screen streams from the captured frames within 5 seconds, and the current Step, Work Item, Observations, and Evidence as registered are shown (FR24, UX-DR24, UX-DR25)
**And** the natural-language Audit Instructions for the agent-driven Target System currently being worked are shown verbatim (FR8)

**Given** the Run is adapter-only
**When** Live View opens
**Then** no workspace screen is shown, and Adapter Session Steps render as log rows with counts and digests (UX-DR24, UX-DR25)

**Given** Live View is open
**When** the Auditor closes the tab
**Then** the Run continues unaffected (FR24)

**Given** the session viewer
**When** a frame is shown or the Run state changes
**Then** the frame's `alt` narration equals the Step narration, `aria-live="polite"` announces the Run state change, and Live View passes automated WCAG 2.1 AA checks (UX-DR37, NFR11)

**Given** a viewport below 1024px
**When** Live View opens
**Then** it renders read-only with "Open on a desktop browser to supervise this Run." and every control disabled (UX-DR25, UX-DR36)

### Story 5.4: Pause and resume a Running Run

As an Auditor,
I want to pause a Running Run and resume it later,
So that I can step away without losing the agent's place or forcing a Cancel.

**Acceptance Criteria:**

**Given** a Running Run
**When** an Auditor presses Pause in Live View
**Then** the pause takes effect at the next Tool Action boundary, the Run persists as `PAUSED` with a checkpoint, an open wait record `{kind, options, deadline}`, and a workspace lease, and the pause records actor, time, and Step (FR25, AD-16)
**And** chrome shows PAUSED with the last frame held and a countdown banner naming who paused it and when it ends Inconclusive (UX-DR25)
**And** a pause requested when no further Tool Action boundary occurs is recorded as superseded on the Timeline and the Run proceeds to its terminal state (AD-16)

**Given** a Run Awaiting Auditor
**When** an Auditor tries to pause it
**Then** Pause is disabled with "A Run waiting on an answer cannot be paused." (AD-16)

**Given** a Paused Run
**When** 30 minutes elapse with no resume
**Then** the wait's durable job wakes on `startAfter = deadline`, the Run ends `INCONCLUSIVE` with Evidence preserved, and reason is recorded (FR25, AD-16)

**Given** a Paused Run
**When** an Auditor presses Resume
**Then** the closure command locks the wait row under the expected Run revision, the worker reattaches to the leased workspace via `attach(WorkspaceRef)`, restarts the current Step Execution from its first Tool Action as a new attempt marked `superseded_by_resume` while the earlier attempt's Tool Actions remain on the Timeline, and the model is re-briefed from the frozen plan and the Work Item with no carried conversation state (AD-16)
**And** resume records actor, time, and Step, and Live View chrome returns to LIVE (FR25, UX-DR25)

**Given** the leased workspace is gone at resume
**When** the worker reattaches
**Then** it re-runs the sign-in Session Steps for the current Target System under the Session Step retry budget and records the reattach on the Timeline; exhaustion is `RUN_FAILED` (AD-16)

### Story 5.5: Cancel a Run and flag it to Audit Managers from Live View

As an Auditor,
I want to cancel a Run or flag it to Audit Managers directly from Live View,
So that I can stop unwanted work or escalate for attention without leaving the screen I am watching.

**Acceptance Criteria:**

**Given** any active Run (Queued, Running, Paused, Awaiting Auditor)
**When** an authorized user presses Cancel in Live View
**Then** a routine confirmation restates the consequence, `cancel_requested` is written, the worker transitions the Run to `CANCELED` at the next Tool Action boundary with Evidence preserved, and `CANCELED` is reserved for this explicit human cancellation (FR26, AD-3, UX-DR33)

**Given** a Canceled Run
**When** the Auditor wants the work continued
**Then** starting a new Run creates one linked to it without changing the prior Run (FR26)

**Given** a Running, Paused, or Awaiting Auditor Run
**When** an Auditor presses Flag to Audit Manager in Live View
**Then** an optional note may be attached, every Audit Manager is notified, the flag has no effect on execution, and the flag is recorded on the Audit Trail (FR27)
**And** Flag to Audit Manager sits in the session viewer's live controls beside Pause/Resume and Cancel (UX-DR24)

### Story 5.6: Answer an Escalation without leaving Live View

As an Auditor,
I want the open Escalation panel to appear inside Live View itself,
So that I can answer it without navigating to Run Detail while still watching the workspace.

**Acceptance Criteria:**

**Given** a Run enters Awaiting Auditor while Live View is open
**When** the transition streams over the live channel
**Then** chrome flips from LIVE to AWAITING with a countdown, the Escalation panel renders in place with kind, Step, the agent-generated question rendered inert and labeled as such, supporting Evidence (for choose candidate, the captured result rows with grounded keys), closed answer buttons in FR27 order with no recommendation, and an optional note field "Recorded, not sent to the agent", and the workspace screen stays visible behind it (FR24, FR27, UX-DR24, UX-DR25, UX-DR27)

**Given** the Escalation panel is present
**When** a keyboard or screen-reader user is elsewhere on the page
**Then** a skip link "Go to open Escalation" moves focus to the panel, and its appearance is announced via `aria-live="polite"` along with the 10-minute and 1-minute countdown milestones (UX-DR27, UX-DR37)

**Given** the Auditor answers or aborts from the panel
**When** the answer or abort is confirmed
**Then** the panel becomes a Timeline entry, and Live View returns to LIVE or reflects Canceled on abort (FR27, UX-DR27)
**And** Pause stays disabled with "A Run waiting on an answer cannot be paused." until the answer is confirmed (FR25, AD-16)

**Given** the acceptance test suite
**When** it exercises Flow 3
**Then** Playwright drives Live View through Initiate Run, a choose-candidate Escalation answered in place, and a pause with a 30-minute countdown before resume (AD-12, UX-DR40)

### Story 5.7: Live View when the stream drops or the Run ends while open

As an Auditor,
I want Live View to tell me plainly when the connection is lost or the Run has already finished,
So that I never mistake a stale screen for the Run's real state.

**Acceptance Criteria:**

**Given** Live View is open and no Timeline update arrives
**When** 15 seconds pass
**Then** the stale indicator appears (AD-17, NFR7)
**And** after 60 seconds without an update, a Banner "Connection to the Run lost. Reconnecting." appears with every control disabled until the stream resumes (UX-DR25)

**Given** a Run reaches a terminal state while Live View is open
**When** the terminal Timeline event streams in
**Then** chrome flips from LIVE, PAUSED, or AWAITING to REPLAY, every live control disables, and a Banner names the terminal state with a link to Run Detail (UX-DR25)

**Given** the stream reconnects after a drop
**When** the client resumes with its last-seen `seq`
**Then** it replays every missed event in order with no gap and no duplicate before returning to live rendering (AD-17)

### Story 5.8: Replay any terminal Run from the platform-owned asset set

As an authorized user,
I want to replay any terminal Run from its captured frames, sanitized actions, and Observation deltas,
So that I can re-examine what the agent did even after the Workspace Provider's own recording has expired.

**Acceptance Criteria:**

**Given** any terminal Run
**When** an authorized user opens Replay
**Then** chrome shows REPLAY, playback starts paused at the first frame, a jump list lets them jump to any Work Item, Exception, or Escalation, and the Audit Instructions for the relevant agent-driven Target System are shown verbatim (FR8, FR30, UX-DR26)

**Given** Replay is open
**When** frames, sanitized actions, and Observation deltas render
**Then** they come only from the platform-owned Replay asset set aligned to Steps, and no action is ever re-executed (FR30, addendum F)

**Given** the Workspace Provider is blocked at the network, or its retention has expired
**When** Replay is opened
**Then** it renders the full Run with no provider call and no error (FR30)
**And** an automated test exercises Replay with the Workspace Provider blocked at the network (AD-12)

**Given** the session viewer in Replay mode
**When** a user operates the scrubber or jump list
**Then** Space or Enter on scrubber pills and Step rows jumps Replay, arrow keys step frames when the viewer has focus, Space toggles play or pause, and frame `alt` narration equals the Step narration (UX-DR24, UX-DR37)

## Epic 6: Investigate Exceptions, review, finalize, and reproduce

An Auditor opens each Exception to its provenance chain and grounding, dispositions it, and submits the sealed Result; an Audit Manager approves, records disagreement without override, and finalizes with a signed manifest; any authorized user exports a Workpaper Bundle from which an independent reviewer reproduces an evaluation offline. This epic delivers Exception Detail, the Review surface and queue, the Overview needs-attention list, the signed Bundle archive, and reproduction tooling, closing the loop from sealed Result to finalized, exportable, reproducible audit work (Flows 5 and 6).

#### Superseded 6.1 (moved to 19.8): Investigate an Exception's provenance and grounding

As an Auditor,
I want to open an Exception and follow its full provenance chain to the underlying Evidence,
So that I can trust or challenge the conclusion before I disposition it.

**Acceptance Criteria:**

**Given** a sealed Result with a Control Failure
**When** an Auditor opens an Exception from the Exceptions tab
**Then** Exception Detail shows the violated condition, the Observation and its grounding, compared values, lineage, the Timeline segment with a link that opens Replay at the Tool Action, and the evaluation's origin (Rule-Classified, Agent-Judged, or Human-classified) (FR41)
**And** the provenance chain renders population record → Observation (grounding, corroboration, match origin) → evaluations → Exception → Timeline segment in that order (UX-DR21)

**Given** the Exception carries a stable Run identifier and an HMAC-SHA-256 fingerprint
**When** the identifier or fingerprint is displayed
**Then** both are shown in mono and remain stable across Runs of Procedure Versions declared compatible (same Procedure, matching key, Compliance Rule digest) (FR41, AD-6)
**And** a Run whose predecessor version is not declared compatible shows "Not comparable — versions differ" instead of a fingerprint match

**Given** an attribute on the Exception
**When** an Auditor clicks it in the grounding inspector
**Then** the inspector shows the original value, the normalized value, the Structural Snapshot at the locator, the locator and label in mono, and a corroboration badge explaining any mismatch; a model-read attribute links to the condition it made Agent-Judged, and a human-matched identity attribute links to the Escalation answer that matched it (UX-DR20)
**And** a masked field is shown as `••••` with the reason "Masked by the Population Source binding" in every list, and is unmasked only in Exception Detail and exports for Auditor and Audit Manager, with every unmasked read audited (FR41, AD-7)

**Given** untrusted retrieved content appears on the Exception
**When** the page renders it
**Then** it is shown in a warning-bordered block and never rendered as markup (UX-DR21, UX-DR34)

#### Superseded 6.2 (moved to 19.8): List, assign, and disposition Exceptions

As an Auditor,
I want to see every Exception for a Run in one list and set its disposition with notes,
So that Control Failures are triaged and the decision trail is preserved.

**Acceptance Criteria:**

**Given** a Run's Exceptions tab
**When** it renders
**Then** each row shows the identifier as a mono link, the state badge (Open, Under Review, Confirmed, Not an Exception), the condition violated, the origin badge, the masked identity, and a persistent "Open" link, ordered by identifier (UX-DR22)
**And** a row whose only Exception evaluation is Agent-Judged pending shows "counts after confirmation" (UX-DR22, AD-6)

**Given** an Exception in state `OPEN`
**When** an Auditor sets "Assigned to", clicks "Set Under review", "Confirm", or "Set Not an Exception", or adds a note
**Then** the command carries the expected revision, and on success the state transitions `OPEN → UNDER_REVIEW → CONFIRMED | NOT_AN_EXCEPTION`, with actor, time, prior value, and rationale recorded (FR42, AD-7)
**And** "Not an Exception" requires a non-empty rationale via the routine-with-rationale confirmation dialog, and the underlying evaluation and sealed System Outcome remain visible and unchanged (FR42, UX-DR21, UX-DR33)

**Given** disposition history
**When** an Auditor opens the Exception's rail
**Then** every prior assignment, state change, and note appears with actor and time, and notes never reach the Audit Agent (FR42, AD-7)

**Given** a Run whose Result is Finalized
**When** an Auditor attempts any disposition action
**Then** every action is disabled with the finalization reason and notes render read-only (UX-DR21)

#### Superseded 6.3 (moved to 15.4): Submit a sealed Result for review

As an Auditor,
I want to submit a Run's sealed Result for Audit Manager review,
So that only a defensible conclusion enters the review queue.

**Acceptance Criteria:**

**Given** a Run that is `COMPLETED` and its Result is sealed
**When** an Auditor opens the Review tab and presses Submit
**Then** the Auditor Review transitions `DRAFT → SUBMITTED`, recording reviewer, time, decision, the Result version, and the Procedure Version, and the Result appears in the Review queue (FR43, AD-7)
**And** Submit uses the routine confirmation dialog and the result shows as a Banner on the surface (UX-DR29, UX-DR33)

**Given** a Run that is unsealed, `INCONCLUSIVE`, `RUN_FAILED`, or `CANCELED`
**When** an Auditor opens the Review tab
**Then** Submit is disabled and states the exact reason, for example "Submission is unavailable while the Result is unsealed." or "Submission is unavailable for an Inconclusive Run. No conclusion exists to review." (FR43, UX-DR15)
**And** the disabled action keeps its position and the reason also appears in the "Unavailable actions" panel (UX-DR32)

**Given** an Inconclusive Run
**When** an Audit Manager reviews Overview or Run Detail
**Then** the failed Gate rows lead, a Safe next action panel states the corrective step and ends "This Run remains unchanged.", and she confirms no Pass or Control Failure exists before asking for a new version (FR43, UX-DR15, UX-DR40 Flow 5)

#### Superseded 6.4 (moved to 15.5): Approve, reject, or record disagreement on a submitted Result

As an Audit Manager,
I want to approve or reject a submitted Result, or record disagreement without overriding it,
So that review authority stays separate from the machine-computed outcome.

**Acceptance Criteria:**

**Given** the Review queue
**When** an Audit Manager opens it
**Then** rows show Run, Procedure, Result outcome, Exceptions, Gate, Review state, and Open, ordered by submission time, excluding Regression Runs and Runs still Pending Confirmation; an empty queue shows "No Result awaits your decision." (UX-DR28)

**Given** a `SUBMITTED` Result
**When** an Audit Manager presses Approve
**Then** the Review transitions `SUBMITTED → APPROVED`, recording reviewer, time, decision, Result version, and Procedure Version (FR43, AD-7)
**And** when an Audit Manager presses Reject, the routine-with-rationale dialog requires a non-empty rationale, the Review returns `SUBMITTED → DRAFT` as a recorded event without deleting history, and the rejection with its rationale is shown in the review history on the Run's Review tab (FR43, AD-7, UX-DR29, UX-DR33)

**Given** any Rule-Classified evaluation or the sealed System Outcome
**When** an Audit Manager presses "Record disagreement"
**Then** the routine-with-rationale dialog requires a non-empty rationale, nothing is overridden, the disagreement is appended to the Audit Trail and later to the Bundle, and the sealed outcome stays visible beside the disagreeing disposition (FR44, UX-DR29, UX-DR41)

**Given** the review history rail
**When** it renders
**Then** every review decision shows actor, time, and rationale (UX-DR29)

**Given** direct finalization is attempted from `DRAFT` or `SUBMITTED`
**When** the command runs
**Then** it is denied and logged (FR43)

#### Superseded 6.5 (moved to 15.9): Finalize a Result with a signed manifest

As an Audit Manager,
I want to finalize an approved Result behind a destructive confirmation,
So that the workpaper becomes immutable and independently verifiable.

**Acceptance Criteria:**

**Given** a Result in state `APPROVED`
**When** an Audit Manager presses "Finalize Result"
**Then** the finalization dialog uses the destructive weight, its title names irreversibility, focus is trapped and restored, and Escape cancels (FR43, UX-DR33)
**And** on confirmation the platform obtains an Ed25519 signature over the manifest from `ManifestSigner`, then one transaction stores the versioned manifest, the signature envelope (format version, algorithm, key ID, public-key fingerprint, signing time), the audit event, and the `FINALIZED` state, or stores none of them (AD-22)

**Given** a Result that has just been finalized
**When** any user opens the Run
**Then** every mutating action across Run Detail, Exceptions, and Review is disabled with "Finalized on {time} by {actor}. Mutation is denied and logged.", and an integrity flag shows if a post-Run integrity event exists (FR43, UX-DR15)
**And** the Review state shows `FINALIZED` and no later command can alter the Result, Exceptions, dispositions, reviews, Timeline, or Evidence (FR43, AD-7)

**Given** the retained public verification bundle
**When** an independent party checks a finalized manifest's signature
**Then** the historical key used at signing time is available for verification (AD-22)

**Given** each of the four Procedure Templates (P-1 through P-4) on its golden dataset
**When** its Run is completed, sealed, submitted, approved, and finalized
**Then** each reaches `FINALIZED` review at least once, satisfying SC-1

#### Superseded 6.6 (retired — replaced by 18.3 and 18.4a): Overview needs-attention list and Recent Runs

As an Auditor or Audit Manager,
I want one place that lists everything waiting on a human and the most recent Runs,
So that nothing awaiting review, confirmation, or a missed start goes unnoticed.

**Acceptance Criteria:**

**Given** items across Procedures need attention
**When** an authorized user opens Overview
**Then** the needs-attention list is ordered Awaiting Auditor (countdown) · Pending Confirmation · Submitted for review · Approved awaiting finalization · Inconclusive · Run Failed · missed scheduled start, and each row names the Run, Procedure, state, and one action (UX-DR6)

**Given** nothing needs attention
**When** Overview renders
**Then** the empty state reads "Nothing needs attention. No Result awaits confirmation or review, no Run is waiting on you, and none is Inconclusive or Run Failed. This does not imply that any control passed." (UX-DR6)

**Given** no Run has ever executed
**When** Overview renders
**Then** the empty state reads "No Runs yet. No Procedure has run in this environment. An empty Overview does not mean a control passed." (UX-DR6)

**Given** recent Run activity
**When** Overview renders the Recent Runs table
**Then** columns are Run, Procedure, Lifecycle, Result outcome, and Gate, with the first cell of every row a focusable link and no row-level click handlers (UX-DR6, UX-DR34)

#### Superseded 6.7 (moved to 14.11a): Export a signed Workpaper Bundle

As an Auditor or Audit Manager,
I want to export a self-contained, signed Workpaper Bundle for any terminal Run,
So that the work can be reviewed and verified without the platform, source code, or live systems.

**Acceptance Criteria:**

**Given** any terminal Run, including `INCONCLUSIVE` and `RUN_FAILED`
**When** an authorized user presses "Export Workpaper Bundle"
**Then** the action is available regardless of lifecycle state, and the archive assembles the addendum §F minimum contents, the Replay asset set, and an integrity manifest, readable without source code (FR46, UX-DR32)
**And** the export includes the Procedure Version's Audit Instructions verbatim and its explicit scope statement verbatim, matching what was shown in the plan, Live View, Replay, and Result (FR8, FR5)

**Given** the archive being written
**When** it is assembled
**Then** it follows the fixed layout: a signed `manifest.json` at the root, `keys/` holding the public verification bundle, `artifacts/<sha256>` for every preserved input, Structural Snapshot, screenshot, and Replay frame addressed by digest, and versioned JSON members (with `schemaVersion`) for the Procedure Version, Observations with grounding, per-condition evaluations with origin and confirmation history, Escalations and answers, Timeline, reviews, and the audit excerpt (AD-5, AD-14)
**And** any artifact reservation left `abandoned` is listed on the export, and every artifact read during assembly is verified by SHA-256 (AD-5)

**Given** the resolved decision that the signed archive is the only export format
**When** the Bundle is opened
**Then** it includes a browser-readable HTML summary of the Run and Result alongside the versioned JSON members, needing no application to view (resolved decision 2026-09-01)
**And** identifiers, timestamps, amounts, counts, periods, and durations in the summary follow the UX-DR38 formats (mono identifiers, ISO 8601 UTC with `Z` and original offset, `USD 250,000.00`, thousands separators, `2026-08-25 → 2026-08-31`, `3m 41s`)

#### Superseded 6.8 (moved to 14.11b): Reproduce an evaluation from the Bundle offline

As an independent reviewer,
I want to reproduce a sampled Rule-Classified evaluation and re-examine a sampled Agent-Judged one from the Bundle alone,
So that the Result's conclusion is independently verifiable without the platform or live systems.

**Acceptance Criteria:**

**Given** an exported Workpaper Bundle and no network access to the platform, live Target Systems, or Workspace Provider
**When** a reviewer selects a sampled Rule-Classified evaluation
**Then** the reproduction reads the stored Structural Snapshot from `artifacts/<sha256>` only, re-runs the domain corroboration and evaluation, and reaches the same evaluation value recorded in the Bundle (FR47, AD-6)

**Given** a sampled Agent-Judged evaluation
**When** the reviewer re-examines it
**Then** the Bundle's rationale, confidence, and Evidence let the reviewer judge the evaluation on the same grounds the confirming Auditor did, with no live model call and no re-execution of any action (FR47, AD-9)

**Given** the full Flow 6 path
**When** it is walked end to end as an e2e test
**Then** it covers opening a submitted sealed Result's Exception Detail with the grounding inspector, exporting the Bundle, reproducing the sampled evaluation, approving, finalizing with the destructive dialog, and recording a disagreement that leaves the evaluation and sealed outcome unchanged (UX-DR40 Flow 6)

## Epic 7: Inspect a desktop Target System

The Audit Agent launches LedgerDesk in the Solari sandbox desktop, signs in, searches User Maintenance, and registers Observations grounded in the application's control tree, completing the hero Procedure across both Target Systems. This epic delivers the synthetic LedgerDesk application with its localhost JSON snapshot endpoint, the project-owned desktop template, the in-VM snapshot agent, the `DesktopExecution` adapter, the `desktop_tree` extractor and its corroboration, and Live View and Replay for a desktop Session, proven on the full hero golden dataset including the ambiguous role list, the choose-candidate pair, and the `Suspended` account.

#### Deferred 7.1 (indefinitely, D-5-3): Synthetic LedgerDesk application with a localhost JSON snapshot endpoint

As a PoC Administrator,
I want the synthetic LedgerDesk finance ERP desktop application running with a localhost JSON control-tree endpoint,
So that the Audit Agent has a real desktop system to inspect and the platform has structural ground truth outside its own reads.

**Acceptance Criteria:**

**Given** the fixtures workspace
**When** LedgerDesk starts inside a desktop workspace
**Then** it presents a Linux desktop application with sign-in, a User Maintenance screen, employee ID search, and account records exposing `account_status`, `username`, `roles`, and identity under the labels Status, Username, Roles, and Employee ID (addendum §A.2)
**And** it serves the current screen's full control tree as JSON on a localhost port reachable only from inside its own workspace VM, with no accessibility-tree (AT-SPI) dependency (AD-4)

**Given** a rendered User Maintenance record
**When** the snapshot endpoint is queried
**Then** every visible control appears with its control name and current value at a stable locator path, and Status, Username, Roles, and Employee ID each resolve at a locator matching the Target System's declared expected field labels (FR7, AD-18)
**And** the audit credential is refused for every write action at the system level (FR3)

**Given** LedgerDesk's golden dataset
**When** it is seeded
**Then** it contains the hero cases assigned to LedgerDesk per addendum §D: one record whose C2 evaluation is correct, one record whose role list is genuinely ambiguous, one *choose candidate* trigger (two candidate rows lacking the employee ID), and one `Suspended` account
**And** expected terminal outcomes for these records are stored as versioned data separate from any rule implementation (AD-12)

#### Deferred 7.2 (indefinitely, D-5-3): Project-owned desktop template and workspace lifecycle in the Solari sandbox

As a developer,
I want a project-owned desktop template in the Solari sandbox that boots into LedgerDesk on demand, isolated per Run,
So that a fresh Agent Workspace exists for every Run with a desktop Step and nothing persists between Runs.

**Acceptance Criteria:**

**Given** a Run with a LedgerDesk Session Step
**When** the worker requests a desktop workspace
**Then** the Solari sandbox desktop launches a fresh instance from the project-owned template, pre-provisioned with LedgerDesk and its localhost snapshot endpoint, isolated from every other Run's workspace (FR19, AD-4)
**And** the Solari sandbox desktop provides session, action transport, screenshots, and stream only; it exposes no control-tree or focused-record identity capability of its own (AD-4)

**Given** a desktop workspace
**When** the Run ends for any reason, including cancellation or a timed-out wait
**Then** the instance is destroyed, nothing persists to a later workspace, and its credential is revoked (FR19, AD-16)
**And** workspace creation failure yields `RUN_FAILED` (FR19, addendum §E)

**Given** a `PAUSED` or `AWAITING_AUDITOR` wait on a LedgerDesk Step
**When** the wait closes
**Then** the desktop workspace stays alive under its lease to the wait's deadline and the resuming command reattaches to it (`attach(WorkspaceRef)`), or re-runs the LedgerDesk sign-in Session Step under the retry budget if it is gone (AD-16)

#### Deferred 7.3 (indefinitely, D-5-3): In-VM snapshot agent reads the LedgerDesk control tree

As a developer,
I want an in-VM snapshot agent that reads LedgerDesk's localhost JSON endpoint and returns it through the desktop workspace's `exec`/`fs` actions,
So that `DesktopExecution` can capture a control-tree Structural Snapshot without any accessibility-tree dependency.

**Acceptance Criteria:**

**Given** a desktop workspace running LedgerDesk
**When** the agent performs a reading Tool Action, such as opening a User Maintenance record
**Then** the worker invokes the in-VM snapshot agent immediately afterward through the desktop `exec`/`fs` actions, and its read of the localhost JSON endpoint is captured as the control-tree Structural Snapshot bound to that same Tool Action with the window title (FR10, AD-4)
**And** a test proves no AT-SPI dependency exists anywhere on this path (AD-4)

**Given** a credential-entry Tool Action on LedgerDesk sign-in
**When** the snapshot agent or frame capture would otherwise run
**Then** both are suppressed and secret-typed input values are redacted from every captured artifact before registration
**And** a seeded negative test proves a credential value never reaches a stored snapshot, screenshot, or frame (AD-4, NFR1)

**Given** a Procedure Version's Evidence Requirements for a LedgerDesk attribute with no reachable snapshot path
**When** the plan is derived
**Then** that attribute is declared model-read on the version, and a compiled condition over it is later applied by the deterministic evaluator to the model-read value with origin `AGENT_JUDGED` (AD-4, AD-6)

#### Deferred 7.4 (indefinitely, D-5-3): `DesktopExecution` adapter meets the shared conformance suite

As a developer,
I want a `DesktopExecution` adapter implementing the application-owned port over the Solari sandbox desktop and the in-VM snapshot agent,
So that the Audit Agent can launch, sign in to, search, and read LedgerDesk under the same guarantees as the web path.

**Acceptance Criteria:**

**Given** a Procedure Version's LedgerDesk registration (application identity, permitted read actions, credential reference)
**When** the agent attempts an action
**Then** only allowlisted read operations execute against LedgerDesk; a denied application, an out-of-scope action, or any write attempt is refused and logged as a security event (FR3, FR20)

**Given** the hero Audit Instructions ("launch, sign in to each Target System, search by employee ID... open the account record and note whether an account exists, its status, username, and assigned roles")
**When** the LedgerDesk portion of a Run executes
**Then** launching and signing in to LedgerDesk is one Session Step, and for each population record the agent searches User Maintenance by employee ID, opens the account, and reads `account_status`, `username`, `roles`, and the identity attribute, with a platform screenshot and a control-tree Structural Snapshot both captured and bound to the reading Tool Action (FR20, FR10, addendum §C P-1)
**And** the supplied credential is never present in Timeline, Evidence, logs, or exports (FR20)

**Given** the one shared conformance suite per outbound port (AD-12)
**When** it runs against `DesktopExecution`
**Then** it passes the same contract `BrowserExecution` passes: allowlists, read-only actions, structural snapshot capture, focused-record identity, sanitized Tool Action logging, cancellation acknowledgment, timeout accounting, and trace ordering (AD-4)
**And** `attach(WorkspaceRef)` and `release` are proven as conformance requirements of `DesktopExecution`, exercised by a resumed wait (AD-16)

#### Deferred 7.5 (indefinitely, D-5-3): `desktop_tree` extractor and corroboration

As a developer,
I want the domain's `desktop_tree` extractor to re-read grounded attributes from the stored control-tree snapshot,
So that every LedgerDesk Observation is corroborated the same way a web or file Observation is.

**Acceptance Criteria:**

**Given** a registered Observation with a `desktop_tree` grounding
**When** the Evidence Quality Gate runs at registration
**Then** the one shared domain extractor, covering all four substrate kinds `{web_tree, desktop_tree, sheet, json}`, re-reads the locator in the stored snapshot and marks the attribute `matched` when the re-read value equals `original_value` and the control name matches the declared label, `contradictory` otherwise (AD-6, AD-18)
**And** the `desktop_tree` substrate's label rule is control name, per its declared locator grammar (AD-18)

**Given** a `found = true` LedgerDesk Observation
**When** corroboration runs
**Then** the identity attribute is re-read from the same control-tree snapshot and compared to the normalized population record key; a mismatch marks the record Unevaluated (FR33, addendum §H)
**And** an attribute the Procedure Version declares model-read is marked `model_read` rather than `contradictory` and is never fed into a compiled condition's predicate directly (AD-4, AD-6)

**Given** the hero's Compliance Rule (condition C1 compiled over `account_status`, condition C2 Agent-Judged over privileged roles)
**When** a LedgerDesk Observation is evaluated
**Then** C1 is applied by the deterministic evaluator to the corroborated `account_status`, and a found account carrying no C2 evaluation is a Gate failure (addendum §C P-1, AD-6)

#### Deferred 7.6 (indefinitely, D-5-3): Live View and Replay for a desktop Session

As an Auditor,
I want to watch and later replay the LedgerDesk portion of a Run in the same viewer I use for LoanCore,
So that supervising or reviewing a desktop Target System feels the same as a web one.

**Acceptance Criteria:**

**Given** a Running Run with an open LedgerDesk Session
**When** Live View is open
**Then** the shared session viewer shows the desktop workspace screen from Solari's stream inside the sandboxed viewport, and per-Observation Gate rows tick in the rail as each LedgerDesk record is read, reflecting progress within 5 seconds (FR24, UX-DR24)
**And** Pause, Resume, Cancel, and Flag to Audit Manager behave identically to the LoanCore portion of the same Run

**Given** a Tool Action on LedgerDesk
**When** it completes
**Then** a timestamped frame, sanitized action, and Observation delta are captured to the platform-owned Replay asset set exactly as for a web Tool Action (FR30, AD-9)

**Given** a terminal Run with LedgerDesk Steps
**When** an authorized user opens Replay
**Then** it plays frames from the desktop portion aligned to Steps, jumps to any LedgerDesk Work Item, Exception, or Escalation, never re-executes an action, and works with the Workspace Provider blocked and after its retention expires (FR30, UX-DR26)
**And** "Open in Replay" on a LedgerDesk row in the Execution Timeline jumps to that frame the same way it does for LoanCore (UX-DR23)

#### Deferred 7.7 (indefinitely, D-5-3): The hero Procedure completes across LoanCore and LedgerDesk

As an Auditor,
I want the full hero Procedure to run LoanCore then LedgerDesk end to end on its golden dataset,
So that the desktop kind and path are proven complete, not merely implemented.

**Acceptance Criteria:**

**Given** the hero Procedure's default Target Systems
**When** a Run executes
**Then** all records are worked in LoanCore before LedgerDesk opens (addendum §C P-1, FR20)
**And** every LedgerDesk golden record reaches its expected terminal outcome: the correct C2 case evaluated correctly, the ambiguous role list marked Unevaluated or evaluated correctly and excluded from the SM-4 comparison, the *choose candidate* trigger resolved by a *choose candidate* answer and flagged human-matched, and the `Suspended` account Inconclusive with diagnostic (addendum §D)

**Given** the full hero golden dataset across both systems
**When** the Run is executed twice in a row
**Then** every expected terminal outcome reproduces both times with identical Rule-Classified evaluation counts (NFR4, addendum §D)

**Given** FR7's desktop kind
**When** the Procedure Version and its Observations are inspected
**Then** LedgerDesk's registration, Session Steps, Work Items, and Observation schema are indistinguishable in shape from an adapter-acquired system's other than `capture_method = agent` (FR7, AD-18)

**Given** a scope-widening Audit Instruction naming an unregistered desktop application or a write verb against LedgerDesk
**When** it is authored
**Then** it is flagged before submission, and if it reaches execution against LedgerDesk it is denied and logged as a security event (FR8, FR3)

## Epic 8: Runs that happen without anyone watching

A weekly Schedule starts the Run unattended at its fixed UTC time with a derived period, records a missed start rather than skipping it, and hands over to a new version at the next period boundary without running a period twice; a version whose model, prompt, tool, or registration digest changed must pass a Regression Run on the Template's golden dataset before it activates, with that Regression Run and its golden comparison visible everywhere the Auditor and Audit Manager review it. This epic delivers the worker scheduler, period-boundary handover, the Regression Run kind, and the upcoming and missed Runs treatment on the dashboard (Flow 4).

#### Superseded 8.1 (absorbed into 19.4): Run Schedules on frequency, UTC start, and derived periods

As a developer,
I want the worker scheduler to enqueue exactly one Run per version and period when a Schedule falls due,
So that daily, weekly, and monthly Procedures run unattended without duplication.

**Acceptance Criteria:**

**Given** an Active version with a weekly Schedule at a fixed UTC start time
**When** the worker scheduler polls and the start time falls due
**Then** it enqueues one Run under a unique constraint on `(Procedure Version, effective period)`, recording the derived period and initiator "Schedule" (FR11, FR17, AD-19)
**And** the period is derived per addendum §B: daily → the previous calendar day, weekly → the previous Monday–Sunday, monthly → the previous calendar month (FR11)

**Given** a version with a `once` Schedule
**When** the scheduler polls
**Then** it creates no scheduler entry for that version; the Run is started manually (AD-19)

**Given** the worker restarts between polls
**When** it resumes polling
**Then** the unique constraint on `(version, period)` refuses a duplicate enqueue for a period already started, and no due period is silently dropped across the restart (NFR9)

#### Superseded 8.2 (absorbed into 19.10): A missed or failed scheduled start is recorded and never skipped

As an Auditor,
I want a Schedule that fails to start on time to show up as a missed start,
So that a quiet Schedule is never mistaken for a passed control.

**Acceptance Criteria:**

**Given** a Schedule due at 06:00 UTC
**When** no Run starts within 5 minutes
**Then** a missed-start event is recorded, never silently skipped, and the Runs list shows a warning row with the exact copy "Missed 06:00 UTC start; not run" (FR17, NFR9, UX-DR13)
**And** after a worker restart, every period that fell due during the downtime records a missed-start event and is not run late; the Auditor may initiate it manually (NFR9, FR17)
**And** the row links to diagnostics (UX-DR13)

**Given** the derived period already has a Run from manual initiation
**When** the scheduler next polls
**Then** it does not enqueue a duplicate and records no missed-start event for that period (AD-19)

**Given** at least one missed or upcoming scheduled Run
**When** an authorized user opens Runs
**Then** upcoming and missed scheduled Runs are both shown, the missed ones with the warning row (UX-DR13, FR17)

#### Superseded 8.3 (absorbed into 19.4): A scheduled Run completes with no human session active

As an Auditor,
I want a weekly Run to start, run, and finish before I ever sign in,
So that I can review it later instead of watching it.

**Acceptance Criteria:**

**Given** a weekly Schedule fires at 06:00 UTC with no user signed in
**When** the Run starts
**Then** Runs shows initiator "Schedule" and the derived period, and Reference Sources are acquired as a Session Step at Run start, before any Work Item (FR17, AD-19)

**Given** the scheduled Run proceeds with no Escalation raised
**When** it reaches a terminal or Pending Confirmation state
**Then** at least one scheduled Run completes end to end with no human session active at any point during execution (FR17)

**Given** the completed scheduled Run has a pending Agent-Judged evaluation
**When** an Auditor opens Run Detail later
**Then** Flow 4 is walkable end to end: the Schedule started the Run unattended, the Auditor opens Replay from the evaluation's provenance chain, confirms the evaluation, and the Result seals (UX-DR40 Flow 4)

#### Superseded 8.4 (absorbed into 19.10): The successor version takes over at the period boundary

As an Auditor,
I want the new Active version to take over from the old one exactly at the boundary,
So that no period is ever run twice or skipped.

**Acceptance Criteria:**

**Given** an Audit Manager approves a successor version while a predecessor is Active
**When** the approval command commits
**Then** `handover_at` is computed once as the first period start, per the successor's Schedule, strictly after activation, and is stored on both versions (FR14, AD-19)

**Given** `handover_at` has passed
**When** the scheduler enqueues the first Run the successor owns, or on the first tick after `handover_at`
**Then** it transitions the predecessor `ACTIVE → RETIRED` with actor "Schedule" in that same operation, and no effective period is owned by both versions or by neither (FR14, AD-19)

**Given** a Run already in flight on the predecessor version at the moment of handover
**When** the predecessor retires
**Then** the in-flight Run completes on the version it started with, unaffected by the retirement (FR14)
**And** Procedure Detail shows the predecessor "Retired {time}; superseded by v{x}" read-only, and the successor Active with its next Run time and Initiate Run enabled (UX-DR11)

#### Superseded 8.5 (absorbed into 19.9): A changed version must pass a Regression Run before it activates

As an Audit Manager,
I want a version whose model, prompt, tool configuration, or registration changed to prove itself on the golden dataset first,
So that a Regression never reaches an Active Schedule.

**Acceptance Criteria:**

**Given** an Audit Manager approves a version whose configuration tuple (model, prompt version, tool configuration, registration digests) differs from the most recent version of the same Procedure that reached `ACTIVE`
**When** approval commits
**Then** the approval command starts a `REGRESSION` Run on the `APPROVED` version, with the Template's golden Population Source binding substituted for that Run only and the version's frozen registrations otherwise kept (FR15, AD-2, AD-19)
**And** a first version of a Procedure needs no Regression Run (AD-2)

**Given** the Regression Run executes
**When** it runs
**Then** it is exempt from the overlap rule, never enters Review, never sends a notification, and is recorded and labeled on the dashboard (FR15, AD-19, UX-DR13)

**Given** the Regression Run completes
**When** the procedures module compares its terminal outcome and evaluations to the golden expectations
**Then** every expected terminal outcome reproduces except records addendum §D exempts, and `RegressionPassed` or `RegressionFailed` is recorded on the version (FR15, addendum §D)
**And** only `RegressionPassed` moves `APPROVED → ACTIVE`; a `RegressionFailed` blocks activation and the Regression Run is counted in the Procedure's maintenance-effort metric either way (FR15, AD-13)

#### Superseded 8.6 (absorbed into 19.9): See the Regression Run and its golden comparison wherever it is reviewed

As an Audit Manager,
I want the Regression Run and its comparison to the golden dataset visible on Version review, Procedure Detail, and Run Detail,
So that I can confirm it confidently before it gates a Schedule.

**Acceptance Criteria:**

**Given** a version Approved and awaiting its Regression Run
**When** an Audit Manager opens Version review
**Then** the Regression Run row appears inline with its Run link, and activation is blocked until it passes (UX-DR12, FR15)
**And** when the Regression Run mismatches a golden expectation, the mismatch is listed per golden expectation, activation stays blocked, and the Schedule of the prior version continues (UX-DR12)

**Given** the same Approved-and-pending state
**When** viewed on Procedure Detail
**Then** a Regression Run row shows its own Run link and the Schedule reads "Activates after the Regression Run passes." (UX-DR11)

**Given** the Regression Run itself
**When** opened on Run Detail
**Then** it carries the label "Regression Run for v{x}", the approver confirms its Agent-Judged evaluations from the Template's confirmation script (the golden dataset's versioned answer list, addendum §D), and its outcome is compared to the golden expectation with any mismatch listed (UX-DR15)

## Epic 9: Oversee the PoC and measure the thesis

A PoC Administrator sees Target System connectivity, Workspace Provider and Audit Runner health, errors, retries, limits, and Run durations without ever seeing a secret; every authorized user filters Runs across all eight lifecycle states plus Pending Confirmation and Regression Run; the team reports the SM-11 measures per Procedure with zero procedure-specific code for the hero; and the platform proves its NFR envelope with isolation, abuse, integrity, recovery, performance, schedule, and accessibility test suites. This epic delivers diagnostics rows the worker writes and the web only reads, the full Runs filter bar and dashboard, thesis metrics as queryable product data, the restore drill, documented teardown, and the acceptance test suites that make every earlier epic's NFR claims provable rather than assumed.

### Story 9.1: Filter and inspect every Run and Agent Task

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As an authorized user,
I want to filter Runs by Procedure, status, initiator, period, and start time and see upcoming and missed scheduled Runs,
So that I can find any Run's state without waiting on someone else to tell me.

**Acceptance Criteria:**

**Given** the Runs surface
**When** an authorized user opens the filter bar
**Then** a Procedure select lists every Procedure, single-select status chips cover all eight lifecycle states (Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, Canceled) plus Pending Confirmation and Regression Run, initiator chips are Manual and Schedule, search matches identifier, Procedure, and initiator, and Clear filters resets the three filters and the search (FR48, UX-DR13)
**And** Control Failure, Pending Confirmation, Awaiting Auditor, and technical or evidence failures each carry their own separate filter and label, never merged into one generic "failed" state (FR48)

**Given** a Schedule with a due time
**When** the Runs list renders
**Then** upcoming scheduled Runs appear and a missed start shows a warning row linking to diagnostics, with no scheduled period silently skipped from the list (FR48, UX-DR13)

**Given** the Runs table
**When** it renders results
**Then** columns are Run, Procedure, Effective period, Lifecycle, Result outcome, Gate, Review, Initiator, Elapsed, Change, the first cell of each row is a link, results are paginated with no infinite scroll, and a filtered empty state names the active filters with Clear filters offered (FR48, UX-DR13, UX-DR34, UX-DR35)

**Given** a Run's lifecycle state changes
**When** the Timeline emits the change
**Then** the Runs list reflects it within 5 seconds over the live channel without a page reload, and a cold load shows skeleton rows with no counts until loaded (FR48, NFR7, AD-17, UX-DR35)

### Story 9.2: Operational diagnostics without secrets, across connectors and the sandbox

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want to see Target System connectivity, Workspace Provider health, Audit Runner health, errors, retries, limit consumption, and Run duration,
So that I can tell the platform is healthy without ever seeing a secret or touching a Result.

**Acceptance Criteria:**

**Given** the Administration surface
**When** a PoC Administrator opens diagnostics
**Then** Target System connectivity, Workspace Provider health, Audit Runner health, errors, retries, limit consumption, and Run duration are shown as rows the worker wrote and the web only reads; the web process never probes a Target System or provider itself (FR49, AD-10, UX-DR31)
**And** no secret, credential, or signed URL appears anywhere on the surface (FR49, NFR1)

**Given** a diagnostic row
**When** a PoC Administrator opens it
**Then** it links to the affected Run and its correlation identifier, and every diagnostics view and action is read-only: nothing on the surface can alter a Result (FR49)

**Given** a Run, active or completed
**When** its diagnostics are inspected
**Then** duration, per-Step and per-Target-System latency, Work Item counts and states, retries, limits consumed, Escalations, status, and error class are all present and queryable by correlation identifier across Runs (NFR12, AD-10)

### Story 9.3: Engagement and task metrics (AD-13 extended) and the reusable-component measure

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want the platform to record the SM-11 measures per Procedure automatically,
So that the team can report setup effort, cost, and reusability without manual tallying.

**Acceptance Criteria:**

**Given** a Procedure Version's lifecycle
**When** it is authored, submitted, approved, or rejected
**Then** the platform records Auditor authoring time and approval time as structured Run and Procedure metrics queryable across all four Templates (FR50, AD-13)

**Given** a completed Run
**When** it ends
**Then** the platform records Escalations and manual interventions per Run, a manual intervention being any human action on the Run other than a Live View control or an Escalation answer, by anyone, plus "Not an Exception" dispositions per Run, Result approval and rejection counts, and tokens and Workspace Provider time consumed per Run (FR50, SM-11)

**Given** a Procedure's implementation
**When** its code is measured
**Then** procedure-specific code is defined as code that references a Template, Control, or Target System by identity; synthetic Target Systems and golden datasets count as fixtures, not procedure-specific code; the hero Procedure's target is zero; and reusable versus procedure-specific components, including Adapters, are reported separately (FR50)

**Given** a seeded Target System change and its Regression Run
**When** maintenance effort is measured
**Then** the effort includes the registration update, any Adapter change, and the FR-15 Regression Run itself (FR50, SM-11)
**And** a test adding a new Population Source or Target System kind proves it changes no Builder, Gate, evaluation, or review code (NFR15)

### Story 9.4: Prove cross-tenant, cross-engagement, cross-task and workspace isolation on every release

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want automated tests that deny cross-user, cross-Run, and cross-workspace access,
So that no Procedure, Run, Evidence, or workspace leaks to someone who should not see it.

**Acceptance Criteria:**

**Given** two users of different accounts or roles
**When** one requests another's Procedure, Run, Evidence, Exception, Live View, Replay, or administration data by guessing or replaying an identifier
**Then** the request is denied and the denial is audited, proven by an automated test for every route family (NFR1)

**Given** data at rest and in transit
**When** it is inspected
**Then** it is encrypted, secrets live outside application data, and logs, Timelines, and exports never contain one (NFR1)

**Given** two concurrent Runs, including Runs of different Procedures
**When** one Run's Agent Workspace or Evidence is inspected from the other
**Then** no data crosses between them, each workspace reaches only its allowlisted destinations, and both are proven by automated negative tests (NFR5)

**Given** a Run that ends
**When** its Agent Workspace is torn down
**Then** no credential remains reachable from the workspace afterward, proven by a negative test (NFR5)

### Story 9.5: Prove agent abuse resistance through documents, email, calendar and Escalations, per model and prompt version

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want automated abuse tests that inject content through files, pages, applications, and Escalation questions,
So that retrieved content can never expand scope, invoke a denied tool, disclose a secret, or change the objective or Compliance Rule.

**Acceptance Criteria:**

**Given** content retrieved from a file, page, or application, including the addendum §D injection strings
**When** it carries a prompt-injection attempt
**Then** automated tests prove it cannot expand scope, invoke a denied tool, disclose a secret, alter the Compliance Rule, or modify the Run objective (NFR2)

**Given** an Escalation whose supporting content was shaped by one of the seeded injection strings
**When** the agent-generated question is rendered
**Then** it is labeled agent-generated and inert, and a test proves any instruction hidden inside it reaches only as narration, never as something the platform executes (NFR2, FR27)

**Given** the three seeded scope-widening Audit Instructions
**When** they reach execution
**Then** 100% are denied as a security event, matching the FR-8 authoring-time flag (NFR2, FR8)

### Story 9.6: Prove integrity, determinism, golden-dataset and regression case-set consistency

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want automated tests proving tamper detection, deterministic evaluation, and repeatable golden Runs,
So that the platform's conclusions can be trusted to be reproducible.

**Acceptance Criteria:**

**Given** preserved Evidence, Observations, Timelines, a finalized Result, or an Audit Trail record
**When** a verification routine runs after a row is altered directly in PostgreSQL
**Then** the modification is detected at the altered record (NFR3)

**Given** the same frozen Observations and Procedure Version
**When** evaluation runs twice
**Then** every Rule-Classified evaluation is identical both times, and each Agent-Judged evaluation stays re-examinable from its preserved rationale and Evidence (NFR4)

**Given** each Template's golden dataset run twice consecutively
**When** the two Runs complete
**Then** both reach identical terminal outcomes and identical Rule-Classified counts, excluding the addendum §D-exempt ambiguous record, any Observation difference is explained, and no Agent-Judged evaluation is confidently wrong (SM-4)

### Story 9.7: Prove the conversational and Run acceptance envelopes

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want measured proof that the platform meets its performance, reliability, and schedule targets,
So that the PoC acceptance envelope is demonstrated, not assumed.

**Acceptance Criteria:**

**Given** the hero Procedure with up to 50 records across two agent-driven Target Systems, and adapter-only Runs of up to 10,000 records
**When** 95% of each are measured
**Then** the hero Runs complete within 30 minutes excluding Pause and Escalation wait time, and adapter-only Runs complete within 5 minutes (NFR6)

**Given** Live View and the Runs dashboard
**When** state changes
**Then** both reflect it within 5 seconds, and 95% of list and detail views respond within 2 seconds at 5 concurrent users (NFR7)

**Given** a transient Target System or workspace failure
**When** it is retried
**Then** it is retried at most 3 times with bounded backoff and produces no duplicate Observation, Result, or Evidence; exhausted retries map to Run Failed, a retry-or-skip Escalation, or Inconclusive per addendum §E (NFR8)

**Given** a due Schedule
**When** it fires, including across a platform restart
**Then** the Run starts within 5 minutes or a missed start is recorded, and the restart loses or duplicates no scheduled Run (NFR9)

### Story 9.8: Recovery drill and documented teardown, including connections and the sandbox

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As a PoC Administrator,
I want a proven restore drill and a documented teardown procedure,
So that the PoC's recovery promise and its end-of-life data handling are both real, not assumed.

**Acceptance Criteria:**

**Given** the daily PostgreSQL backup and the separately credentialed recovery bucket copy of sealed Evidence
**When** a restore drill runs
**Then** it reconstructs a finalized Run with every digest, audit-chain link, and signature verified against the 24-hour RPO and 8-hour RTO targets (NFR10, AD-11)
**And** the recovery bucket's credentials are unavailable to the web or worker processes (AD-11)

**Given** the PoC's documented teardown procedure
**When** it runs
**Then** Run data, Evidence, Timelines, Replay assets, Results, and Audit Trails are deleted only through that documented procedure and by no other path (NFR14)
**And** Replay assets never depend on Workspace Provider retention, proven by replaying a Run after that retention has expired (NFR14, FR30)

### Story 9.9: Accessibility CI at WCAG 2.2 AA across every surface

*Generalised by the course correction (Proposal 5 §1, standing assurance epic). The acceptance criteria below are the Run-path baseline; the generalised proof obligations are named per epic in Proposal 5 §2 and Epic 9's obligation lines in Epics 11–19.*

As an Auditor using a keyboard or assistive technology,
I want every surface to pass automated accessibility checks,
So that Builder, Live View, Replay, and every other core workflow stay usable to me.

**Acceptance Criteria:**

**Given** every surface in the application, from Overview through Administration
**When** automated WCAG 2.1 AA checks run in CI
**Then** all of them pass, not only Builder, Live View, and Replay, and a failing check blocks the build (NFR11, UX-DR37)

**Given** keyboard-only navigation
**When** a user tabs through any surface
**Then** tab order follows reading order, the focus ring is never suppressed, Escape closes the topmost dialog and never cancels a Run, and Space or Enter on scrubber pills and Step rows jump Replay while arrow keys step frames (NFR11, UX-DR37)

**Given** dynamic content
**When** a Run state changes, a new Escalation opens, or a countdown reaches its 10-minute or 1-minute milestone
**Then** it is announced via `aria-live="polite"`, a Run Failed transition is announced via `aria-live="assertive"`, and a skip link reaches an open Escalation (UX-DR37)

## Epic 10: Disposition and rename

The course-correction transition work of Proposal 7: the legacy review-closure assessment, the tracking update, the compatibility-tested rename, the conditional retirement of the Builder write path, and the legacy harness coverage mapping; and the bounded legacy follow-ups 10.6–10.10, added by the owner on 2026-09-25 from the closure register (`legacy-review-closure-register.md` §3.3). Stories 10.1–10.5 change no product behaviour; 10.3, 10.4 and 10.6–10.10 change application code only under explicit implementation authorisation.

**Slices:** 10.1, 10.2 before any story of Epic 11; 10.3 in Slice 0; 10.5 with Slice 4; 10.4 only after the Slice 4 acceptance (Proposal 7 §3a); 10.6–10.10 on the retained compiler-1 surfaces, outside the slices, once their implementation is authorised; each is bounded to the residual work the register names, never a general cleanup.

### Story 10.1: Legacy review closure assessment for the Epic 4 and 5 stories in review

As a platform operator,
I want each Epic 4 and Epic 5 story in review assessed against its compiler-1 acceptance criteria on the existing implementation and evidence,
So that each closes, stays in review or gets a residual-work disposition on evidence rather than by reclassification.

**Acceptance Criteria:**

**Given** the seventeen stories in review and the evidence named in Proposal 5 §1b
**When** the assessment runs
**Then** the closure register records, per story, the tested revision, the evidence relied on, the runtime and environment, unresolved limitations and one verdict (Done — `[COMPILER-1 PATH]`, Remains in review with the missing check named, or Residual work with an owner)
**And** nothing is rerun for its own sake; a cheap reproducible run on `c18ad36` is recorded once where it is the only missing evidence
**And** the three done stories (4.1–4.3) have their evidence registered without a status change
**And** sprint-status changes for the seventeen keys are applied only from the register's verdicts, with the `[COMPILER-1 PATH]` note in the disposition record, never in the status value
**And** no verdict implies that the corresponding compiler-2 capability is proven

### Story 10.2: Apply the course-correction tracking changes

As a platform operator,
I want `epics.md`, `sprint-status.yaml` and the disposition record updated within the tracking tooling's vocabulary,
So that superseded work is never offered as ordinary backlog, deferred work is never selected, and a bounded part never completes its parent.

**Acceptance Criteria:**

**Given** the approved Sprint Change Proposal of 2026-09-24 (§5)
**When** the tracking files are updated
**Then** Epics 10–19 exist in `epics.md` with every story and bounded part of Proposal 5, the NE-8 numbering shifted by one, Epics 6–8's superseded, deferred and absorbed stories converted to disposition tables, Epic 9's stories re-titled to their generalised proofs, and the requirements dispositions mirror PRD revision 4
**And** `sprint-status.yaml` uses only `backlog · ready-for-dev · in-progress · review · done` for stories and `backlog · in-progress · done` for epics; superseded keys are absent; Epics 4 and 5 are untouched
**And** `course-correction-dispositions.yaml` records every old story's disposition and replacement, every part's parent and slice, `compiler_1_path` and `retrospective_required`
**And** the sprint-planning tooling's `validate` passes before and after, and three checks pass: no superseded key regenerated as backlog, no deferred Epic 7 story selectable, no part key completing a parent

### Story 10.3: Compatibility-tested rename of the application identifiers to Zobba

As a platform operator,
I want the changeable application identifiers renamed to Zobba while every protected historical representation is preserved,
So that new modules are written under the new names and existing records, hashes and signatures verify unchanged.

**Acceptance Criteria:**

**Given** Proposal 7 §2's two classes
**When** the rename story is delivered under explicit implementation authorisation
**Then** Class A identifiers change (`@intellifin/*` → `@zobba/*` in imports, package manifests, `pnpm-workspace.yaml`, the lockfile, `--filter` selectors, aliases, subpath exports and tsconfig links; the root package; the three flags with the alias rule; product copy; `AGENTS.md` and `CLAUDE.md`) and Class B representations never change (the hashed audit envelope and every stored hash, digest, signature and manifest; the stored role values with `Admin` mapped once to `poc-administrator`; evidence namespaces; migrations and the journal; golden fixtures; correlation prefixes; database names; telemetry `service` values; planning folders tests read by path)
**And** the compatibility proof of Proposal 7 §2 passes in a detached worktree, with no signed Workpaper Bundle verification claimed because none exists
**And** the GitHub repository and Railway project renames are separately owner-authorised subtasks with their own cutover record establishing preserved identities and no replacement infrastructure

### Story 10.4: Retire the Builder write path after the Slice 4 acceptance

As a platform operator,
I want the compiler-1 authoring write path retired only after its replacement's acceptance has passed and unfinished authoring work has a disposition,
So that no draft, derivation, submitted version or receipt is orphaned and every operational action existing work needs is preserved.

**Acceptance Criteria:**

**Given** the Slice 4 acceptance (Proposal 6 stages 14 and 19) green on the candidate
**When** the retirement is performed
**Then** the inventory of Proposal 7 §3a is taken and every item has one recorded disposition (finish through the old path, retain a bounded continuation path, or abandon or migrate through an authorised transition with its audit event)
**And** the new-procedure form, Draft editors, guided preparation, the authoring assistant and its key, the preparation resolver, and their server-side commands and queued-work entry points are removed, while shared submission guards, independence checks and lifecycle invariants stay
**And** initiation, rerun, approval and activation where supported, pause, resume, cancellation, escalation decisions, flagging and connection recovery for compiler-1 work remain under their controls; read paths remain
**And** browser specs are mapped assertion by assertion onto a documented retained-version fixture; no spec is retired by filename

### Story 10.5: Legacy acceptance harness coverage mapping

As a platform operator,
I want every obligation of `verify-deployed-loancore.mjs`, `acceptance-truth.mjs` and their workflows mapped to retained coverage, an equivalent check in `verify-acceptance-journey.mjs`, or an explicitly retired capability,
So that the new journey verifier becomes primary without dropping legacy coverage it does not exercise.

**Acceptance Criteria:**

**Given** Proposal 7 §4's mapping
**When** the new harness exists
**Then** every "equivalent" row names the implemented check and its recorded evidence before the old assertion is removed
**And** the harness reaches its retained checks through the documented retained-version fixture after the Builder retires
**And** retirement of the two scripts and `deployed-loancore-acceptance.yml` is a later transition taken only when the compiler-1 rows are themselves retired

### Story 10.6: Legacy visibility follow-up: human-matched provenance, missing-frame indication and exact pause and resume linkage on the retained compiler-1 surfaces

As an Auditor,
I want the retained compiler-1 surfaces to show the facts the platform already records about a human-selected match, a missing Replay frame and the Step of each pause and resume,
So that the acceptance criteria the legacy review closure register found unmet on `main` are met on evidence, not closed by reclassification.

**Acceptance Criteria:**

**Given** the legacy review closure register's residual scope for Stories 4.7, 5.2 and 5.4 and the owner's dispositions of 2026-09-25
**When** the story is delivered under explicit implementation authorisation
**Then** a record chosen by a person through a secondary key shows the human-matched word on the Result, the record review queue and inspector and the Exceptions list, traced to its matching decision (4.7)
**And** Replay distinguishes a missing or unavailable frame from a frame suppressed during credential entry, and states that playback is incomplete, with the count, rather than implying complete playback (5.2)
**And** each pause and each resume identifies its exact plan step and Step Execution attempt from durable records, including repeated pauses and after the Run advances; where the stored records cannot establish it, the linkage is added for new events only, and no historical audit event is rewritten (5.4)
**And** on Live View's adapter-only view, each Adapter Session Step row carries the registered Evidence identity and digest through the real page read path, with three situations tested: an acquired step with Evidence shows its digest, a step with no artifact says so, and an unavailable Evidence read says that, never one sentence for all three (legacy Story 5.3, owner decision 2026-09-25)
**And** a browser test written first activates "Go to open Escalation" from the keyboard, establishes where focus lands, and verifies that the next keyboard interaction reaches the Escalation panel's controls; then the smallest correction makes it pass (legacy Story 5.6, owner decision 2026-09-25); finding the link or scrolling to the section is not enough
**And** the export legs of 4.7 and 5.2 stay 14.11a's explicit criteria, and the legacy stories close only when all their legs are met or the owner amends their scope

**And** delivery slice: none — retained compiler-1 surfaces; NE reference none (owner decision 2026-09-25); design gate (D-5-6): none — the retained surfaces keep the 2026-09-01 UX spine (EXPERIENCE.md revision 2 §12), and a new sentence is confirmed with the owner before it is built

### Story 10.7: Live channel correction: notify every Run-chain append, and never lose the last refresh

As an Auditor watching a Run,
I want every event appended to a Run's audit chain to wake the live channel in its own transaction, and a burst of events to end with the page showing the last committed change,
So that the channel contract (`docs/contracts/live-timeline-channel-v1.md`) holds as written and no surface silently stops one refresh short.

**Acceptance Criteria:**

**Given** the closure register's amended verdict for legacy Story 5.1 (owner decision 2026-09-25, resolution B: the contract keeps its meaning and is not narrowed)
**When** an event of a family that today issues no NOTIFY is appended to a Run's chain (`evidence-access.*` from the web and the worker, `notification.in-app-delivery`, `notification.email-delivery`, the evaluation review's `security.denied`)
**Then** `NOTIFY run_timeline(run_id, seq)` fires in that appending transaction, for every Run-aggregate append, and a rolled-back append wakes nothing
**And** a stream that reconnects with its last-seen `seq` receives each such event once, in order, and the authoritative data is still read from the stored chain; notifications stay wake-ups, and no internal event has to become a prominent UI row

**Given** the bell's throttled refresh (`BellLive`)
**When** a short burst of qualifying events commits inside its refresh window
**Then** a throttled refresh is acceptable, but the final required refresh is never lost: the rendered bell count and the Overview's counts eventually include the last relevant committed change, proven in a browser without a reload
**And** the Overview keeps refreshing through the bell's shared subscription (owner decision 2026-09-25: no separate subscription), and the test establishes that the shared mechanism refreshes the Overview's state

**And** delivery slice: none — retained compiler-1 surfaces; NE reference none (owner decision 2026-09-25); design gate (D-5-6): none — no new surface; bounded to the two obligations above, never a channel redesign

### Story 10.8: Lost connection and lost acknowledgement: a server refresh is not stream recovery, and a rendering error claims only what it knows

As an Auditor supervising a Run,
I want Live View to keep saying the stream is lost until the stream itself recovers, and a page that fails to render after my action to tell me only what it knows,
So that a control is never reopened on a false recovery, and a committed action is never reported as "nothing was changed".

**Acceptance Criteria:**

**Given** the closure register's amended verdict for legacy Story 5.7 (owner decision 2026-09-25)
**When** the stream is lost and an unrelated server refresh or cursor change re-runs `useLiveTimeline`'s `[url, cursor]` effect
**Then** the page does not claim that the stream recovered and does not reopen the live controls on that basis; only the recovery condition the contract requires (a frame or heartbeat from the stream itself) returns the status to `live` and reopens the gate
**And** a browser test drives a lost stream followed by an unrelated re-read (for example another Run ending) and asserts the status word, the sentence and the controls throughout

**Given** the closure register's amended verdict for legacy Story 5.5 (owner decision 2026-09-25) and an action whose command committed but whose acknowledgement was lost
**When** the route boundary renders
**Then** the generic rendering error states only what it knows, for example "This page could not be loaded. Check the Run's current state before repeating your last action.", and never claims unconditionally that nothing was changed
**And** an action-specific message says that nothing changed only when its recorded outcome establishes that, and reloading the page never becomes an implicit resubmission of the action (the committed-flag case of `flag-run.spec.ts` asserts exactly one `run_flag` row and one notification, and the new wording)
**And** the sentence lives in `copy.ts` or a words module, pinned by a test that reads it back

**And** delivery slice: none — retained compiler-1 surfaces; NE reference none (owner decision 2026-09-25); design gate (D-5-6): none — no new surface; the wording of the boundary sentence is confirmed with the owner before it is built

### Story 10.9: Replay bounded-history completeness: a bounded view says what it covers, and the rest stays reachable

As an Auditor replaying a long Run,
I want Replay to say what a bounded read covers and to give me a way to the rest,
So that a bounded Observation count or an incomplete jump list never reads as the complete retained Run.

**Acceptance Criteria:**

**Given** the closure register's amended verdict for legacy Story 5.8 (owner decision 2026-09-25) and a fixture whose waits, Observation-registration events and Exceptions each exceed the default view's bound (`REPLAY_PAGE_SIZE`, 500)
**When** Replay is opened on its default view
**Then** each bounded read says what it covers, in words, and no displayed count presents a bounded number as a full-history total (the Observation count beside a frame, the jump list, the Exceptions)
**And** the Auditor reaches the remaining retained material through pagination, continuation or the existing inspection path (`?workItem=` inspection pages), and a jump target beyond the bound is not silently absent
**And** Replay is not redesigned: the correction is the completeness presentation and the missing continuation, proven by a browser test over the fixture with WCAG 2.1 AA

**And** delivery slice: none — retained compiler-1 surfaces; NE reference none (owner decision 2026-09-25); design gate (D-5-6): none — existing surface; any new sentence is confirmed with the owner before it is built

### Story 10.10: Retained decision history on the Execution Timeline: an answered Escalation and a superseded pause are inspectable entries

As an Auditor reading a Run's Execution Timeline,
I want a compact, inspectable entry for each completed decision the Run recorded — an answered or aborted Escalation, and a pause that was superseded — showing the decision, the actor, the time and the related work,
So that "the panel becomes a Timeline entry" is a visible fact and not only an event in the audit chain.

**Acceptance Criteria:**

**Given** the closure register's readings decision (owner, 2026-09-25: an event that exists in the audit chain is not a user-visible history entry) for legacy Stories 4.8 (AC 4), 5.6 (AC 3) and 5.4 (AC 3)
**When** an Escalation has been answered or aborted, or a pause was superseded by the Run's terminal transition
**Then** the Execution Timeline tab shows a compact entry or link for it, with the completed decision, the actor (a name, never a raw id), the time, and the related Work Item and Step where one exists, read from the stored chain and wait rows; no full expanded panel is needed, and an inaccessible chain event is insufficient
**And** the entry's words come from the existing words modules (`ESCALATION_KIND_WORDS`, `ActorName`), pinned by tests, with WCAG 2.1 AA on the changed tab
**And** no historical audit event is rewritten; a historical decision whose related work cannot be established from durable records says so

**And** delivery slice: none — retained compiler-1 surfaces; NE reference none (owner decision 2026-09-25); design gate (D-5-6): none — existing Timeline tab, the row treatment of the 2026-09-01 UX spine; a new sentence is confirmed with the owner before it is built

## Epic 11: Tenancy, scope and delegation

every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3). (Course correction 2026-09-24: Proposal 5 NE-1; contracts `tenancy-v1` (as amended by 4b §7: three role groups, invitation lifecycle, removal commands, last-administrator rule, revocation on dispatch and resume), `audit-event-envelope-v2`. **Requirements:** FR-53, FR-54, FR-83, FR-84, FR-80 (index rows), **FR-94, FR-95**. **ADs:** 8, 11, 22, 24.)

**Slices:** Slice 0: 1.1–1.11 in full (1.9–1.11 as storage, commands and enforcement; their surfaces are 8.11 in Slice 3, where the invited reviewer exercises them).

**Blocked after:** organisation-managed connections, enterprise SSO and provisioning, transactional email for invitations.

**Epic 9 proof obligation:** the isolation suite with two tenants, two clients, two engagements, two users, on every release; the invitation and removal negatives as runtime tests.


### Story 11.1: Classify every table and write the policy inventory

As a platform operator,
I want classify every table and write the policy inventory,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: classification table, policy inventory
**And** it is demonstrated by: the unclassified-table test; the inventory test

**And** delivery slice: Slice 0; NE reference NE-1 1.1


### Story 11.2: Add scope columns, composite scope keys and the owner's tenant backfill

As a platform operator,
I want add scope columns, composite scope keys and the owner's tenant backfill,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: scoped columns, composite FKs
**And** it is demonstrated by: populated-upgrade proof; cross-scope FK insert refused

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.2


### Story 11.3: Create the migrator and runtime roles; rotate connection strings

As a platform operator,
I want create the migrator and runtime roles; rotate connection strings,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: roles
**And** it is demonstrated by: the deployed-role fixture (`NOSUPERUSER NOBYPASSRLS`, owns no table)

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.3


### Story 11.4: Force RLS with permissive grants and restrictive boundaries; the principal wrapper

As a platform operator,
I want force RLS with permissive grants and restrictive boundaries; the principal wrapper,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: policies, `SET LOCAL` wrapper
**And** it is demonstrated by: positive tests per principal class and operation; cross-boundary reads and writes through repositories and raw SQL; principal leak tests

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.4


### Story 11.5: Ownership immutability trigger and the hardened draft-binding function

As a platform operator,
I want ownership immutability trigger and the hardened draft-binding function,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: immutability, binding
**And** it is demonstrated by: member of A and B moving a record refused; initial binding succeeds; second binding, non-member client and plain UPDATE refused

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.5


### Story 11.6: Execution delegations and service principals with column privileges

As a platform operator,
I want execution delegations and service principals with column privileges,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: delegation, principals
**And** it is demonstrated by: revoked delegation and removed membership stop queued and resumed jobs; reconciliation principal updates only its columns

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.6


### Story 11.7: Route every unit of work and raw transaction through the wrapper; drain and re-validate queued jobs

As a platform operator,
I want route every unit of work and raw transaction through the wrapper; drain and re-validate queued jobs,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: migration steps e–g
**And** it is demonstrated by: a scoped transaction without a principal refused; `SUPPORTED_SCHEMA_MIN/MAX` moved

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.7


### Story 11.8: Ownership bindings for historical chains; envelope v2 for new segments

As a platform operator,
I want ownership bindings for historical chains; envelope v2 for new segments,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: envelope v2, binding
**And** it is demonstrated by: tampered-ownership test; tenant export verifies alone; v1 bytes verified under v1 rules

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.8


### Story 11.9: Tenant roles as capability groups — Auditor · Audit manager · Admin; engagement assignments (lead auditor, auditor, reviewer) as scoped responsibilities; Reviews visibility by responsibility and capability; `poc-administrator` displayed "Admin"

As a platform operator,
I want tenant roles as capability groups — Auditor · Audit manager · Admin; engagement assignments (lead auditor, auditor, reviewer) as scoped responsibilities; Reviews visibility by responsibility and capability; `poc-administrator` displayed "Admin",
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `tenancy-v1` §roles, `permissions-v1` §visibility (FR-94)
**And** it is demonstrated by: an Admin who approved a pack cannot approve a working paper, a finding, a report or a check definition and cannot issue; a global Audit manager without engagement membership reaches nothing; a role change leaves contributor restrictions in force; Reviews absent for a person with no review responsibility

**And** delivery slice: Slice 0; NE reference NE-1 1.9


### Story 11.10: Invitations: create bound to recipient, tenant, role assignments and proposed engagement access; single-use, expiring, revocable; Copy invitation link; acceptance by a verified identity; the secret protected from model context and ordinary logs

As a platform operator,
I want invitations: create bound to recipient, tenant, role assignments and proposed engagement access; single-use, expiring, revocable; Copy invitation link; acceptance by a verified identity; the secret protected from model context and ordinary logs,
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `tenancy-v1` §invitations (FR-95)
**And** it is demonstrated by: wrong recipient, expired, replayed and revoked invitations refused; an inviter who lost authority before acceptance; a forwarded link confers nothing; the secret absent from telemetry, audit payloads and any model request (containment scan); no open sign-up path (the existing `disableSignUp` proof re-asserted)

**And** delivery slice: per §4a of Proposal 5; NE reference NE-1 1.10; design gate (D-5-6): register row B12 (invitation creation and acceptance) gates only the invitation surfaces — the creation surface in 18.12 and any acceptance surface this part renders — first needed in Slice 3; this part's commands, copyable link, verified acceptance path and secret containment proceed behind the existing surfaces (Proposal 5 §4a Slice 0) (surface-part rule, owner decision 2026-09-25)


### Story 11.11: Removal: from an engagement, from a tenant, and the separate account action; last active administrator cannot be removed or demoted (transactional, the existing last-holder lock reused); pending invitations and affected delegations handled explicitly; revocation enforced on protected requests and on dispatch, resume, retry and background work (with 1.6)

As a platform operator,
I want removal: from an engagement, from a tenant, and the separate account action; last active administrator cannot be removed or demoted (transactional, the existing last-holder lock reused); pending invitations and affected delegations handled explicitly; revocation enforced on protected requests and on dispatch, resume, retry and background work (with 1.6),
So that the epic's goal holds: every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `tenancy-v1` §removal (FR-95)
**And** it is demonstrated by: concurrent last-administrator removal refused; cross-tenant membership preserved on tenant removal; background dispatch after removal refused with a reason; a dispatched external action keeps its reconciliation path; reinstatement restores no old grant; authorship and approvals preserved

**And** delivery slice: Slice 0; NE reference NE-1 1.11


## Epic 12: Engagement, Agent Task and the agent loop

a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task. (Course correction 2026-09-24: Proposal 5 NE-2; contracts `engagement-task-v1`, `agent-loop-v1` (as amended by 4b §6: invocation record with requested and actual configuration per call; boundary rule for model changes), `working-context-v1`, `live-channel-v2`. **Requirements:** FR-52, FR-55–59, FR-87, FR-88, **FR-91**. **ADs:** 3, 7, 16, 17, 25, 31.)

**Slices:** Slice 1: 2.1, 2.2, 2.3, 2.4 (against the real gate of 3.2; no stub in a runnable application), 2.5a, 2.7a, 2.8a and 2.8b, 2.9a, 2.10a. Slice 2: 2.7b, 2.10b. Slice 3: 2.5b, 2.6. Deferred: 2.9b (engagement stream), cross-provider swap until a second provider is configured.

**Blocked after:** nothing task-side; automatic task-based model routing is not implied by anything here (4b §6).

**Epic 9 proof obligation:** the mutation harness on the loop's one call site; the injection evaluation set.


### Story 12.1: Draft engagement, client binding command, conversation with encrypted content

As an Auditor,
I want draft engagement, client binding command, conversation with encrypted content,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: engagement, conversation
**And** it is demonstrated by: client-scoped read refused before binding and permitted after

**And** delivery slice: Slice 1; NE reference NE-2 2.1; design gate (D-5-6): none on this part, which builds no surface; the draft-engagement and client-binding surfaces are built by 18.4a and wait for register row B2 (surface-part rule, owner decision 2026-09-25)


### Story 12.2: Agent Task aggregate: state machine, budget, lease, step ledger, revision guard

As an Auditor,
I want agent Task aggregate: state machine, budget, lease, step ledger, revision guard,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: task machine, ledger
**And** it is demonstrated by: two claimants; stale resume refused; budget refused before the call

**And** delivery slice: Slice 1; NE reference NE-2 2.2


### Story 12.3: The invocation model over the AI SDK as transport only; turn and call identities

As an Auditor,
I want the invocation model over the AI SDK as transport only; turn and call identities,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `agent-loop-v1` §invocation, response contract
**And** it is demonstrated by: SDK executes nothing; two calls serial; interrupted stream not dispatched; restart replays results

**And** delivery slice: Slice 1; NE reference NE-2 2.3


### Story 12.4: Parameter binding and the gate call site (with NE-3's gate; a stub `allowed`-only gate until then)

As an Auditor,
I want parameter binding and the gate call site (with NE-3's gate; a stub `allowed`-only gate until then),
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: parameter binding
**And** it is demonstrated by: conflicting target refused; platform field injected; schema mistake bounded feedback

**And** delivery slice: Slice 1; NE reference NE-2 2.4


### Story 12.5a: Waits: `clarify` and closed-option; expiry ends the task `CANCELED` with work kept

As an Auditor,
I want waits: `clarify` and closed-option; expiry ends the task `CANCELED` with work kept,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.5 "Waits: `clarify`, `confirm-action`, `reconcile`, closed-option; response windows; per-task isolation" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: waits
**And** it is demonstrated by: free-text answer resolves a clarification; source instruction closes no wait; task B usable while A waits; expiry ends the task `CANCELED` with work kept

**And** delivery slice: Slice 1; NE reference NE-2 2.5a


### Story 12.5b: Waits: `confirm-action` and `reconcile`; response windows separate from action validity

As an Auditor,
I want waits: `confirm-action` and `reconcile`; response windows separate from action validity,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.5 "Waits: `clarify`, `confirm-action`, `reconcile`, closed-option; response windows; per-task isolation" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: waits
**And** it is demonstrated by: free-text answer resolves a clarification; source instruction closes no wait; task B usable while A waits; expiry ends the task `CANCELED` with work kept

**And** delivery slice: Slice 3; NE reference NE-2 2.5b


### Story 12.6: Dispatch claims, operation and attempt identities, reconciliation outcomes

As an Auditor,
I want dispatch claims, operation and attempt identities, reconciliation outcomes,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: dispatch semantics
**And** it is demonstrated by: lease expiry before and after dispatch; late receipt on the original attempt; no second effect in any reconciliation case

**And** delivery slice: Slice 3; NE reference NE-2 2.6; design gate (D-5-6): none on this part, which builds no surface; the `reconcile` decision surface is built by 18.6c and waits for register row B4 (surface-part rule, owner decision 2026-09-25)


### Story 12.7a: Resumption from durable state after a kill mid-call, after a result and during a wait; authority re-derived on resume

As an Auditor,
I want resumption from durable state after a kill mid-call, after a result and during a wait; authority re-derived on resume,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.7 "Resumption from durable state; provider continuity items under conversation controls; provider swap" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: resumption, continuity
**And** it is demonstrated by: kill mid-call, after result, during wait; authority re-derived; swap with no duplicate effect

**And** delivery slice: Slice 1; NE reference NE-2 2.7a


### Story 12.7b: Provider or deployment change at a boundary with no duplicate effect

As an Auditor,
I want provider or deployment change at a boundary with no duplicate effect,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.7 "Resumption from durable state; provider continuity items under conversation controls; provider swap" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: resumption, continuity
**And** it is demonstrated by: kill mid-call, after result, during wait; authority re-derived; swap with no duplicate effect

**And** delivery slice: Slice 2; NE reference NE-2 2.7b


### Story 12.8a: Self-review scoped to material content; instruction categories in context

As an Auditor,
I want self-review scoped to material content; instruction categories in context,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.8 "Self-review scoped to material content; instruction categories in context" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: self-review, provenance
**And** it is demonstrated by: unsupported claim not presented as a finding; deterministic check governs; behavioural injection evaluations reported per prompt version

**And** delivery slice: Slice 1; NE reference NE-2 2.8a


### Story 12.8b: Behavioural injection evaluation set, reported per model and prompt version

As an Auditor,
I want behavioural injection evaluation set, reported per model and prompt version,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.8 "Self-review scoped to material content; instruction categories in context" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: self-review, provenance
**And** it is demonstrated by: unsupported claim not presented as a finding; deterministic check governs; behavioural injection evaluations reported per prompt version

**And** delivery slice: Slice 1; NE reference NE-2 2.8b


### Story 12.9a: Live channel per task

As an Auditor,
I want live channel per task,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.9 "Live channel per task and engagement" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `live-channel-v2`
**And** it is demonstrated by: gap and duplicate property on task streams

**And** delivery slice: Slice 1; NE reference NE-2 2.9a


### Story 12.9b: Live channel per engagement

As an Auditor,
I want live channel per engagement,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.9 "Live channel per task and engagement" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `live-channel-v2`
**And** it is demonstrated by: gap and duplicate property on task streams

**And** delivery slice: Deferred; NE reference NE-2 2.9b


### Story 12.10a: Per-invocation model record with the administrator default

As an Auditor,
I want per-invocation model record with the administrator default,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.10 "Model and effort per invocation: the task's selected or default configuration; requested versus actual provider, deployment, model id, prompt version and effort recorded per model call and linked to the step; per-adapter effort mapping with a closed vocabulary; a change applies at the next safe boundary and regenerates nothing" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `agent-loop-v1` §invocation record (FR-91)
**And** it is demonstrated by: a step with two model calls retains both configurations; a non-model step acquires no model setting; an unsupported effort is unavailable or explicitly remapped and recorded, never silently ignored; a mid-task change applies from the next boundary with no regenerated or repeated work; higher effort grants no budget

**And** delivery slice: Slice 1; NE reference NE-2 2.10a


### Story 12.10b: Auditor model and effort selection; per-adapter effort mapping; safe mid-task change

As an Auditor,
I want auditor model and effort selection; per-adapter effort mapping; safe mid-task change,
So that the epic's goal holds: a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Acceptance Criteria:**

**Given** the parent story NE-2 2.10 "Model and effort per invocation: the task's selected or default configuration; requested versus actual provider, deployment, model id, prompt version and effort recorded per model call and linked to the step; per-adapter effort mapping with a closed vocabulary; a change applies at the next safe boundary and regenerates nothing" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `agent-loop-v1` §invocation record (FR-91)
**And** it is demonstrated by: a step with two model calls retains both configurations; a non-model step acquires no model setting; an unsupported effort is unavailable or explicitly remapped and recorded, never silently ignored; a mid-task change applies from the next boundary with no regenerated or repeated work; higher effort grants no budget

**And** delivery slice: Slice 2; NE reference NE-2 2.10b


## Epic 13: Agent Permissions, connector framework, connections and the first connectors

authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request. (Course correction 2026-09-24: Proposal 5 NE-3; contracts `permissions-v1`, `connector-v1`, `connection-v1`, `disclosure-policy-v1` (as amended: model availability per engagement, one enforcement path), **`model-policy-v1` (new)**. **Requirements:** FR-3, FR-60–68, FR-89, **FR-92**. **ADs:** 4, 9, 26, 27. Connections are user-owned in the first release (D-4b-3): credentials owned by and authorised for a user, whatever the provider account is; organisation-managed connections keep their own later contract.)

**Slices:** Slice 1: 3.1–3.7, 3.8a, 3.12, 3.13, 3.14a. Slice 2: 3.14b. Slice 3: 3.8b, 3.9a, 3.10. Deferred: 3.9b (draft and send beyond refusal), 3.11 (the browser as a connector on the task path; the Run-path browser suites keep passing meanwhile), the phased connectors.

**Blocked after:** OneDrive, SharePoint, Outlook, Todoist, Planner, GitHub, databases (the phased list).

**Epic 9 proof obligation:** the conformance suite per adapter; the OAuth negative list as runtime tests; enterprise requirements documented, not claimed; personal-account results never represented as proof of every organisational integration.


### Story 13.1: Agent Permissions policy and Engagement Permissions as versioned documents; the intersection

As an Auditor,
I want agent Permissions policy and Engagement Permissions as versioned documents; the intersection,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: authority computation
**And** it is demonstrated by: frozen {A,B} ∩ current {B,C} = {B}; unrelated narrowing refuses nothing

**And** delivery slice: Slice 1; NE reference NE-3 3.1


### Story 13.2: `authorizeToolCall` with four outcomes; canonical resource identity; source-wins; absolute source protection

As an Auditor,
I want `authorizeToolCall` with four outcomes; canonical resource identity; source-wins; absolute source protection,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: gate
**And** it is demonstrated by: killing test per rule; alias, shortcut, moved file, redirect, unresolvable target; mutation harness

**And** delivery slice: per §4a of Proposal 5; NE reference NE-3 3.2


### Story 13.3: Permissions Summary to the model; internal tools with `connection: none`

As an Auditor,
I want permissions Summary to the model; internal tools with `connection: none`,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: summary
**And** it is demonstrated by: the model sees no Permissions document; internal tool passes the gate without a connection rule

**And** delivery slice: per §4a of Proposal 5; NE reference NE-3 3.3


### Story 13.4: Connector descriptor, port, two-axis result, conformance suite, hostile fake

As an Auditor,
I want connector descriptor, port, two-axis result, conformance suite, hostile fake,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `connector-v1`
**And** it is demonstrated by: timeout after dispatch is `unknown-after-dispatch`; unverifiable success fails validation; empty versus unreachable

**And** delivery slice: per §4a of Proposal 5; NE reference NE-3 3.4


### Story 13.5: Connections, secrets under `CONNECTION_SECRET_KEY`, disconnect ordering

As an Auditor,
I want connections, secrets under `CONNECTION_SECRET_KEY`, disconnect ordering,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `connection-v1` §connections
**And** it is demonstrated by: dispatch after local disable refused; refresh after disable cannot reactivate

**And** delivery slice: per §4a of Proposal 5; NE reference NE-3 3.5


### Story 13.6: OAuth: attempt, PKCE, sealed handoff, callback validation, mix-up defence per provider

As an Auditor,
I want oAuth: attempt, PKCE, sealed handoff, callback validation, mix-up defence per provider,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: §attempt, §callback
**And** it is demonstrated by: swapped state, wrong user, wrong tenant, replay, expired attempt; both mix-up defences

**And** delivery slice: per §4a of Proposal 5; NE reference NE-3 3.6


### Story 13.7: The broker: exchange attempts, no code reuse after possible dispatch, refresh recovery, rule `no-connection-broker-in-web`

As an Auditor,
I want the broker: exchange attempts, no code reuse after possible dispatch, refresh recovery, rule `no-connection-broker-in-web`,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: §broker
**And** it is demonstrated by: failed-before-dispatch retried; lost response after redemption never resends; duplicate exchange jobs; refresh loss follows recorded behaviour; boundary plants

**And** delivery slice: Slice 1; NE reference NE-3 3.7


### Story 13.8a: Google Drive connector: read, list and snapshot on designated folders

As an Auditor,
I want google Drive connector: read, list and snapshot on designated folders,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.8 "Google Drive connector (read, snapshot, list, write-output to designated folders)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: first connector
**And** it is demonstrated by: conformance suite; personal-account acceptance on designated folders

**And** delivery slice: Slice 1; NE reference NE-3 3.8a


### Story 13.8b: Google Drive connector: write-output to a designated Drafts folder

As an Auditor,
I want google Drive connector: write-output to a designated Drafts folder,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.8 "Google Drive connector (read, snapshot, list, write-output to designated folders)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: first connector
**And** it is demonstrated by: conformance suite; personal-account acceptance on designated folders

**And** delivery slice: Slice 3; NE reference NE-3 3.8b


### Story 13.9a: Gmail connector: read a designated label; attachments as received snapshots; draft and send refused without confirmation

As an Auditor,
I want gmail connector: read a designated label; attachments as received snapshots; draft and send refused without confirmation,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.9 "Gmail connector (read a designated label, attachments as `received` snapshots, draft; send behind `external-effect`)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: second connector
**And** it is demonstrated by: conformance; a send needs confirmation with bound details

**And** delivery slice: Slice 3; NE reference NE-3 3.9a


### Story 13.9b: Gmail connector: draft and send behind external-effect confirmation

As an Auditor,
I want gmail connector: draft and send behind external-effect confirmation,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.9 "Gmail connector (read a designated label, attachments as `received` snapshots, draft; send behind `external-effect`)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: second connector
**And** it is demonstrated by: conformance; a send needs confirmation with bound details

**And** delivery slice: Deferred; NE reference NE-3 3.9b


### Story 13.10: Calendar connector (read, create-event behind `external-effect`, read-back)

As an Auditor,
I want calendar connector (read, create-event behind `external-effect`, read-back),
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: third connector
**And** it is demonstrated by: conformance; created event read back and receipted

**And** delivery slice: Slice 3; NE reference NE-3 3.10


### Story 13.11: Browser as a connector under the Agent Permissions

As an Auditor,
I want browser as a connector under the Agent Permissions,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `agent-workspace-v1` re-homed
**And** it is demonstrated by: existing browser suites pass under the gate

**And** delivery slice: Deferred; NE reference NE-3 3.11


### Story 13.12: Disclosure policy per tenant and engagement, applied before every outbound request including fallback

As an Auditor,
I want disclosure policy per tenant and engagement, applied before every outbound request including fallback,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `disclosure-policy-v1`
**And** it is demonstrated by: restricted item blocks primary and fallback; derived summary inherits; unknown classification blocks

**And** delivery slice: Slice 1; NE reference NE-3 3.12


### Story 13.13: Bound `ResolvedCredential` for connections; the credential guard over connector traffic

As an Auditor,
I want bound `ResolvedCredential` for connections; the credential guard over connector traffic,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: containment
**And** it is demonstrated by: a credential outside its bound destination refused; scans on every freeze and model request

**And** delivery slice: Slice 1; NE reference NE-3 3.13


### Story 13.14a: Model policy document with the default deployment and the computed picker set

As an Auditor,
I want model policy document with the default deployment and the computed picker set,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.14 "Administrator model policy: enabled provider deployments and capabilities, default model and effort, whether auditors may change the model or choose the highest effort; versioned and audited; the picker set = policy ∩ engagement disclosure policy ∩ required capabilities ∩ execution limits, with unavailable choices disabled and stating the reason; one enforcement path" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `model-policy-v1`, `disclosure-policy-v1` §model availability (FR-92)
**And** it is demonstrated by: a picker toggle cannot override the engagement's data policy; a policy revocation before the next call blocks that call with the cause recorded; a tenant default change leaves active tasks' selections and scheduled checks' approved configuration unchanged; configuration cannot declare a region or data-handling guarantee the service has not established; the reference screen's providers are not seeded as approved selections

**And** delivery slice: Slice 1; NE reference NE-3 3.14a


### Story 13.14b: Alternative models offered; unavailable choices disabled with the reason; a revocation blocks the next call

As an Auditor,
I want alternative models offered; unavailable choices disabled with the reason; a revocation blocks the next call,
So that the epic's goal holds: authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Acceptance Criteria:**

**Given** the parent story NE-3 3.14 "Administrator model policy: enabled provider deployments and capabilities, default model and effort, whether auditors may change the model or choose the highest effort; versioned and audited; the picker set = policy ∩ engagement disclosure policy ∩ required capabilities ∩ execution limits, with unavailable choices disabled and stating the reason; one enforcement path" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `model-policy-v1`, `disclosure-policy-v1` §model availability (FR-92)
**And** it is demonstrated by: a picker toggle cannot override the engagement's data policy; a policy revocation before the next call blocks that call with the cause recorded; a tenant default change leaves active tasks' selections and scheduled checks' approved configuration unchanged; configuration cannot declare a region or data-handling guarantee the service has not established; the reference screen's providers are not seeded as approved selections

**And** delivery slice: Slice 2; NE reference NE-3 3.14b


## Epic 14: Sources, evidence, working material and derived outputs

every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export. (Course correction 2026-09-24: Proposal 5 NE-4; contracts `evidence-package-v2`, `acquisition-v1`, `derivation-v1`, `input-quality-v1`, `retention-v1`, `export-v2`. **Requirements:** FR-69–72, FR-45–47 (export). **ADs:** 5, 6, 14, 28. Absorbs Epic 6's 6.7 and 6.8.)

**Slices:** Slice 1: 4.1, 4.2, 4.3, 4.8, 4.9a. Slice 2: 4.4, 4.5, 4.6, 4.7 (the scenario's one script). Slice 3: 4.9b, 4.11a. Deferred: 4.10 (no deletion operation is exposed until its hold and dependency enforcement exist), 4.11b (offline reproduction).

**Blocked after:** 

**Epic 9 proof obligation:** the integrity sweep over every owner kind; the retention negative tests.


### Story 14.1: Owner-namespaced reservations and the new kinds through `freezeArtifact`

As an Auditor,
I want owner-namespaced reservations and the new kinds through `freezeArtifact`,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `evidence-package-v2`
**And** it is demonstrated by: every owner through reserve, upload, verify, register; redelivery reconciles

**And** delivery slice: Slice 1; NE reference NE-4 4.1


### Story 14.2: Source snapshots with identity, limitations and acquisition records; content versus acquisition identity

As an Auditor,
I want source snapshots with identity, limitations and acquisition records; content versus acquisition identity,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `acquisition-v1`
**And** it is demonstrated by: unchanged reacquisition on a later date; retry versus new observation; identical bytes from two sources

**And** delivery slice: Slice 1; NE reference NE-4 4.2


### Story 14.3: Extraction records with coverage and consistency; the two-axis result on acquisition

As an Auditor,
I want extraction records with coverage and consistency; the two-axis result on acquisition,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: extraction
**And** it is demonstrated by: partial at page 3; `coverage: complete, consistency: unknown`; empty under contract

**And** delivery slice: Slice 1; NE reference NE-4 4.3


### Story 14.4: Source evolution relationships, impact records versus notifications

As an Auditor,
I want source evolution relationships, impact records versus notifications,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: supersession
**And** it is demonstrated by: next-period extract flags nothing; a correction flags the dependent finding

**And** delivery slice: Slice 2; NE reference NE-4 4.4


### Story 14.5: Working material revisions and copy steps

As an Auditor,
I want working material revisions and copy steps,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: working material
**And** it is demonstrated by: a revision cannot be cited; promotion registers a derived output

**And** delivery slice: Slice 2; NE reference NE-4 4.5


### Story 14.6: Derivations with retained method objects; the four check kinds; validation records; recoverable registration

As an Auditor,
I want derivations with retained method objects; the four check kinds; validation records; recoverable registration,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `derivation-v1`
**And** it is demonstrated by: repeatable-but-wrong method stays unsupported; checksum-only refused; crash between upload and metadata reconciled

**And** delivery slice: Slice 2; NE reference NE-4 4.6


### Story 14.7: Reproducibility comparators and re-execution as a recorded validation (with NE-7)

As an Auditor,
I want reproducibility comparators and re-execution as a recorded validation (with NE-7),
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: reproducibility
**And** it is demonstrated by: byte and semantic comparators; model-assisted step never claims identity

**And** delivery slice: Slice 2; NE reference NE-4 4.7


### Story 14.8: Independent input-quality dimensions and dependency-specific propagation

As an Auditor,
I want independent input-quality dimensions and dependency-specific propagation,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `input-quality-v1`
**And** it is demonstrated by: current-but-partial; complete-but-out-of-period; post-period report with in-period content; unknown freshness

**And** delivery slice: Slice 1; NE reference NE-4 4.8


### Story 14.9a: Task manifests always recorded, empty or incomplete manifests named; grants by owner

As an Auditor,
I want task manifests always recorded, empty or incomplete manifests named; grants by owner,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**Given** the parent story NE-4 4.9 "Task manifests (always recorded), supplements, grants by owner" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: sealing
**And** it is demonstrated by: incomplete manifest named; late receipt as supplement; grant for A cannot read B

**And** delivery slice: Slice 1; NE reference NE-4 4.9a


### Story 14.9b: Supplements and late receipts

As an Auditor,
I want supplements and late receipts,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**Given** the parent story NE-4 4.9 "Task manifests (always recorded), supplements, grants by owner" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: sealing
**And** it is demonstrated by: incomplete manifest named; late receipt as supplement; grant for A cannot read B

**And** delivery slice: Slice 3; NE reference NE-4 4.9b


### Story 14.10: Retention decisions, holds, dependencies, availability status

As an Auditor,
I want retention decisions, holds, dependencies, availability status,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `retention-v1`
**And** it is demonstrated by: deletion under hold refused; export names the deleted item

**And** delivery slice: Deferred; NE reference NE-4 4.10; design gate (D-5-6): register row B8 (retention decisions, holds, deletion) gates this part's retention surface before it is built; the hold and dependency rules proceed, and no deletion is exposed meanwhile (Proposal 5 §4c) (surface-part rule, owner decision 2026-09-25)


### Story 14.11a: Engagement export, review notes under archive scope; a tenant export verifies alone

As an Auditor,
I want engagement export, review notes under archive scope; a tenant export verifies alone,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**Given** the parent story NE-4 4.11 "Engagement export and offline reproduction (Epic 6.7, 6.8 rebuilt)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `export-v2`
**And** it is demonstrated by: a tenant export verifies alone; a derivation reproduces offline from the bundle

**Given** an export that includes a retained compiler-1 Run (legacy export legs, owner decisions 2026-09-25; `legacy-review-closure-register.md`)
**When** the export is produced
**Then** a record chosen by a person through a secondary key is flagged human-matched, with a reference to the matching decision (legacy Story 4.7); a Replay frame that is missing or unavailable is indicated and kept distinct from a frame suppressed during credential entry (legacy Story 5.2); and no credential-shaped value appears in the export (the registered export leg of done Story 4.3)
**And** these legs stay explicit residual work of their legacy stories until this part delivers them

**And** delivery slice: Slice 3; NE reference NE-4 4.11a


### Story 14.11b: Offline reproduction from the bundle

As an Auditor,
I want offline reproduction from the bundle,
So that the epic's goal holds: every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Acceptance Criteria:**

**Given** the parent story NE-4 4.11 "Engagement export and offline reproduction (Epic 6.7, 6.8 rebuilt)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `export-v2`
**And** it is demonstrated by: a tenant export verifies alone; a derivation reproduces offline from the bundle

**And** delivery slice: Deferred; NE reference NE-4 4.11b


## Epic 15: Artifacts, claims, review, approval and produced files

versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5. (Course correction 2026-09-24: Proposal 5 NE-5; contracts `artifact-version-v1` (as amended by 4b §7: `review-requested` and `returned` lifecycle records, review notes with disposition, export rule), `rendering-v1`. **Requirements:** FR-73–76, FR-90, **FR-96**, FR-40–44 as re-based. **ADs:** 7, 29.)

**Slices:** Slice 2: 5.1, 5.2, 5.3, 5.8a. Slice 3: 5.4, 5.5, 5.6a (`.docx`, with 7.6a), 5.7, 5.8b, 5.9. Slice 4: 5.8c. Deferred: 5.6b (`.xlsx` production, PDF export), 5.8d (report type), multi-reviewer workflows the platform lacks.

**Blocked after:** `.xlsx` rendering, additional formats, multi-reviewer workflows the platform lacks.

**Epic 9 proof obligation:** the fidelity test set; the circular-citation and provenance negatives.


### Story 15.1: Artifact and immutable version; lifecycle records; frozen-field triggers

As an Auditor,
I want artifact and immutable version; lifecycle records; frozen-field triggers,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: aggregates
**And** it is demonstrated by: content update refused through repository and raw SQL; decisions projected

**And** delivery slice: Slice 2; NE reference NE-5 5.1


### Story 15.2: Claims, classes, citations, support-status transitions

As an Auditor,
I want claims, classes, citations, support-status transitions,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: claims
**And** it is demonstrated by: factual without citation fails; generated narrative refused; pending-review for proposed interpretations; model `supported` moves nothing

**And** delivery slice: Slice 2; NE reference NE-5 5.2


### Story 15.3: Dependencies, impact records, `needs-reconsideration` through `mint-platform-draft`

As an Auditor,
I want dependencies, impact records, `needs-reconsideration` through `mint-platform-draft`,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: reconsideration
**And** it is demonstrated by: correction flags dependents; observation notifies only

**And** delivery slice: Slice 2; NE reference NE-5 5.3; design gate (D-5-6): none on this part, which builds no surface; the Needs another look flag and the impact-record surfaces are built by 18.5b and wait for register row B3 (surface-part rule, owner decision 2026-09-25)


### Story 15.4: Review request, scoped approval authority, independence over humans, revision-bound decisions

As an Auditor,
I want review request, scoped approval authority, independence over humans, revision-bound decisions,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: approval
**And** it is demonstrated by: Audit Manager without membership refused; contributor self-approval refused; stale revision refused; concurrent edit lands on the old version

**Given** a retained compiler-1 Run (legacy transfer, owner decision 2026-09-25: the Submit control of Story 4.9 and the superseded Story 6.3; `legacy-review-closure-register.md`)
**When** an Auditor opens the Run's review surface
**Then** a sealed `COMPLETED` Result can be submitted for review, recording the reviewer, the time, the Result version and the Procedure Version, and the Result enters the review queue; an unsealed Result shows Submit disabled with "Submission is unavailable while the Result is unsealed."; an `INCONCLUSIVE`, `RUN_FAILED` or `CANCELED` Run shows Submit disabled with its exact reason
**And** generic artifact review does not stand in for this path: until this story covers it, compiler-1 Result submission stays unimplemented and is never reported as passed

**And** delivery slice: Slice 3; NE reference NE-5 5.4


### Story 15.5: Approval binding (content, claims, citations, assessments, template version, rendering)

As an Auditor,
I want approval binding (content, claims, citations, assessments, template version, rendering),
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: binding
**And** it is demonstrated by: later rendering not approved; one review satisfies both where the pack allows

**And** delivery slice: Slice 3; NE reference NE-5 5.5


### Story 15.6a: `.docx` rendering with validation layers, feature matrix and blocking defects

As an Auditor,
I want `.docx` rendering with validation layers, feature matrix and blocking defects,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.6 "Renderings: `.docx` and `.xlsx` in the sandbox (NE-7), validation layers, feature matrix, blocking defects, PDF export" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `rendering-v1`
**And** it is demonstrated by: embedded screenshot present; stale formula cache blocking; omitted limitation blocking; harmless limitation recorded

**And** delivery slice: Slice 3; NE reference NE-5 5.6a; design gate (D-5-6): none on the rendering itself; the share, issuance-refusal and rendering-blocked surfaces are built by 18.6c and wait for register row B5 (surface-part rule, owner decision 2026-09-25)


### Story 15.6b: `.xlsx` production and PDF export

As an Auditor,
I want `.xlsx` production and PDF export,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.6 "Renderings: `.docx` and `.xlsx` in the sandbox (NE-7), validation layers, feature matrix, blocking defects, PDF export" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `rendering-v1`
**And** it is demonstrated by: embedded screenshot present; stale formula cache blocking; omitted limitation blocking; harmless limitation recorded

**And** delivery slice: Deferred; NE reference NE-5 5.6b; design gate (D-5-6): register row B5 (sharing a working draft versus issuance; PDF export) gates the PDF export surface before it is built; `.xlsx` production proceeds, and PDF export is shown unavailable until then, never partial (Proposal 5 §4c) (surface-part rule, owner decision 2026-09-25)


### Story 15.7: Draft sharing versus issuance; output-location writes with receipts

As an Auditor,
I want draft sharing versus issuance; output-location writes with receipts,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: issuance
**And** it is demonstrated by: draft share labelled and receipted; issuance without approval refused; source location refused

**And** delivery slice: Slice 3; NE reference NE-5 5.7; design gate (D-5-6): none on this part's backend; the share decision surface and the issuance refusal are built by 18.6c and wait for register row B5 (surface-part rule, owner decision 2026-09-25)


### Story 15.8a: Example pack artifact types: plan, working paper and finding

As an Auditor,
I want example pack artifact types: plan, working paper and finding,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.8 "Example pack artifact types: plan, procedure, request list, working paper, finding, report" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: types
**And** it is demonstrated by: a firm pack with different types runs end to end

**And** delivery slice: Slice 2; NE reference NE-5 5.8a


### Story 15.8b: Example pack artifact type: request list

As an Auditor,
I want example pack artifact type: request list,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.8 "Example pack artifact types: plan, procedure, request list, working paper, finding, report" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: types
**And** it is demonstrated by: a firm pack with different types runs end to end

**And** delivery slice: Slice 3; NE reference NE-5 5.8b


### Story 15.8c: Example pack artifact type: procedure

As an Auditor,
I want example pack artifact type: procedure,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.8 "Example pack artifact types: plan, procedure, request list, working paper, finding, report" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: types
**And** it is demonstrated by: a firm pack with different types runs end to end

**And** delivery slice: Slice 4; NE reference NE-5 5.8c


### Story 15.8d: Example pack artifact type: report

As an Auditor,
I want example pack artifact type: report,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**Given** the parent story NE-5 5.8 "Example pack artifact types: plan, procedure, request list, working paper, finding, report" — this is bounded part d; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: types
**And** it is demonstrated by: a firm pack with different types runs end to end

**And** delivery slice: Deferred; NE reference NE-5 5.8d


### Story 15.9: Review request and return: `review-requested` and `returned` records; notes anchored to a location in the exact version with author, response and disposition; Mark as reviewed neither approves nor issues; notes excluded from client-facing renderings by default and included in authorised workpaper, archive and verification exports; one eligible independent person may satisfy review and approval where the pack permits

As an Auditor,
I want review request and return: `review-requested` and `returned` records; notes anchored to a location in the exact version with author, response and disposition; Mark as reviewed neither approves nor issues; notes excluded from client-facing renderings by default and included in authorised workpaper, archive and verification exports; one eligible independent person may satisfy review and approval where the pack permits,
So that the epic's goal holds: versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `artifact-version-v1` §review notes (FR-96)
**And** it is demonstrated by: a returned version is unchanged and its notes are retained on the next submission; notes absent from a client rendering and present in an authorised archive export; unresolved substantive notes stay visible under the pack's decision rules; a preparer's self-check recorded as a check, never as review

**And** delivery slice: Slice 3; NE reference NE-5 5.9


## Epic 16: Memory, retrieval, skills and methodology packs

scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack. (Course correction 2026-09-24: Proposal 5 NE-6; contracts `memory-v1`, `skill-v1` and `methodology-pack-v1` (as amended by 4b §7: Admin creates, maintains, approves, activates and retires; creator, maintainer and approver recorded; configuration-change controls; approved checks keep their pack version), `run-level-gate-v2` (classification). **Requirements:** FR-77–80, FR-85, FR-86, FR-94 (methodology half). **ADs:** 32, 33.)

**Slices:** Slice 1: 6.1a, 6.7a, 6.8a. Slice 2: 6.1b, 6.2a, 6.3, 6.4, 6.5, 6.6, 6.7b, 6.9. Deferred: 6.2b (firm-methodology and confirmed-lessons scopes beyond the same client), 6.7c (pack proposal from documents), 6.8b (compaction records), embeddings.

**Blocked after:** cross-scope promotion beyond the same client; embeddings until a disclosure-approved provider is selected.

**Epic 9 proof obligation:** the scope negatives on retrieval through raw SQL.


### Story 16.1a: Retrieval index over messages and artifacts under RLS; filter before rank; coverage in results

As an Auditor,
I want retrieval index over messages and artifacts under RLS; filter before rank; coverage in results,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.1 "Retrieval index rows under RLS; filter before rank; coverage in results; direct full reads" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: retrieval
**And** it is demonstrated by: client-B item absent; stale index then direct read; period spanning two policy versions

**And** delivery slice: Slice 1; NE reference NE-6 6.1a


### Story 16.1b: Period-spanning policy versions and direct full reads

As an Auditor,
I want period-spanning policy versions and direct full reads,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.1 "Retrieval index rows under RLS; filter before rank; coverage in results; direct full reads" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: retrieval
**And** it is demonstrated by: client-B item absent; stale index then direct read; period spanning two policy versions

**And** delivery slice: Slice 2; NE reference NE-6 6.1b


### Story 16.2a: Memory items for user preference, engagement facts and client knowledge

As an Auditor,
I want memory items for user preference, engagement facts and client knowledge,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.2 "Memory items: scopes, ownership, delegation, lifecycle and verification status" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `memory-v1`
**And** it is demonstrated by: explicit instruction `active` and `user-reported`; inferred item `proposed` and invisible as instruction; non-owner refused

**And** delivery slice: Slice 2; NE reference NE-6 6.2a


### Story 16.2b: Memory items for firm methodology and confirmed reusable lessons

As an Auditor,
I want memory items for firm methodology and confirmed reusable lessons,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.2 "Memory items: scopes, ownership, delegation, lifecycle and verification status" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `memory-v1`
**And** it is demonstrated by: explicit instruction `active` and `user-reported`; inferred item `proposed` and invisible as instruction; non-owner refused

**And** delivery slice: Deferred; NE reference NE-6 6.2b


### Story 16.3: Configured precedence and proposed conflicts

As an Auditor,
I want configured precedence and proposed conflicts,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: precedence
**And** it is demonstrated by: two packs resolve differently; prose conflict recorded not decided

**And** delivery slice: Slice 2; NE reference NE-6 6.3


### Story 16.4: Pack schema, validation, activation by an Admin as an audited configuration change; the example pack from `templates.ts` (P-1..P-4 and fixtures, optional) and the minimal neutral example template (Q12)

As an Auditor,
I want pack schema, validation, activation by an Admin as an audited configuration change; the example pack from `templates.ts` (P-1..P-4 and fixtures, optional) and the minimal neutral example template (Q12),
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `methodology-pack-v1`
**And** it is demonstrated by: example pack validates; undefined state refused; activation audited; engagement keeps its version; an Admin's activation confers no audit-approval right

**And** delivery slice: Slice 2; NE reference NE-6 6.4


### Story 16.5: Gate rule classification (platform-mandatory, methodology-configurable, legacy-template-specific)

As an Auditor,
I want gate rule classification (platform-mandatory, methodology-configurable, legacy-template-specific),
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `run-level-gate-v2`
**And** it is demonstrated by: a pack omitting a mandatory rule refused; every rule classified

**And** delivery slice: Slice 2; NE reference NE-6 6.5


### Story 16.6: Skills: descriptor, admission, discovery, loading, recording

As an Auditor,
I want skills: descriptor, admission, discovery, loading, recording,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `skill-v1`
**And** it is demonstrated by: unmet capability reported and denied; unapproved skill not loaded; task records versions

**And** delivery slice: Slice 2; NE reference NE-6 6.6


### Story 16.7a: Bootstrap without a pack; the no-methodology sentence

As an Auditor,
I want bootstrap without a pack; the no-methodology sentence,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.7 "Bootstrap without a pack; starter selection; pack proposal from documents" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: bootstrap
**And** it is demonstrated by: useful work before selection; promotion blocked naming the configuration; proposal `proposed` until an Admin approves it as configuration

**And** delivery slice: Slice 1; NE reference NE-6 6.7a; design gate (D-5-6): none; the no-methodology sentence is EXPERIENCE.md §6 copy, and register row B16 gates the Settings › Methodology and skills surface (18.7b) and the "Prepare one from your documents" surface (16.7c) (surface-part rule, owner decision 2026-09-25)


### Story 16.7b: Starter pack selection

As an Auditor,
I want starter pack selection,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.7 "Bootstrap without a pack; starter selection; pack proposal from documents" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: bootstrap
**And** it is demonstrated by: useful work before selection; promotion blocked naming the configuration; proposal `proposed` until an Admin approves it as configuration

**And** delivery slice: Slice 2; NE reference NE-6 6.7b; design gate (D-5-6): none on this part's backend; the starter-pack selection surface is built by 18.7b and waits for register row B16 (surface-part rule, owner decision 2026-09-25)


### Story 16.7c: Pack proposal from documents

As an Auditor,
I want pack proposal from documents,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.7 "Bootstrap without a pack; starter selection; pack proposal from documents" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: bootstrap
**And** it is demonstrated by: useful work before selection; promotion blocked naming the configuration; proposal `proposed` until an Admin approves it as configuration

**And** delivery slice: Deferred; NE reference NE-6 6.7c; design gate (D-5-6): register row B16 (Settings › Methodology and skills: pack proposal and approval by Admin) gates the "Prepare one from your documents" surface before it is built; the proposal backend proceeds (surface-part rule, owner decision 2026-09-25)


### Story 16.8a: Bounded working context: the full supported context preserved, an honest stop at its limit, re-evaluation on permission change

As an Auditor,
I want bounded working context: the full supported context preserved, an honest stop at its limit, re-evaluation on permission change,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.8 "Compaction records and context re-evaluation on permission change" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `working-context-v1` §compaction
**And** it is demonstrated by: correction survives compaction; revoked content absent on resume

**And** delivery slice: Slice 1; NE reference NE-6 6.8a


### Story 16.8b: Compaction records

As an Auditor,
I want compaction records,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**Given** the parent story NE-6 6.8 "Compaction records and context re-evaluation on permission change" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `working-context-v1` §compaction
**And** it is demonstrated by: correction survives compaction; revoked content absent on resume

**And** delivery slice: Deferred; NE reference NE-6 6.8b


### Story 16.9: Pack and skill accountability records (creator, maintainer, approver); a methodology change cannot bypass a platform-mandatory Gate rule, waive an independent approval or reach client evidence; an approved check keeps its pack version after a new version is activated; methodology-scope knowledge promotion by Admin only within that scope

As an Auditor,
I want pack and skill accountability records (creator, maintainer, approver); a methodology change cannot bypass a platform-mandatory Gate rule, waive an independent approval or reach client evidence; an approved check keeps its pack version after a new version is activated; methodology-scope knowledge promotion by Admin only within that scope,
So that the epic's goal holds: scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `methodology-pack-v1` §accountability, `skill-v1`, `memory-v1` §promotion (FR-86, FR-94)
**And** it is demonstrated by: a pack omitting a platform-mandatory rule refused; an Admin cannot confirm another person's preference, engagement or client memory item; the check's pack version unchanged after activation of a newer pack

**And** delivery slice: Slice 2; NE reference NE-6 6.9


## Epic 17: Controlled execution environment and document processing

a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine. (Course correction 2026-09-24: Proposal 5 NE-7; contracts `code-execution-v1`, `document-extraction-v1`. **Requirements:** FR-81, FR-82. **ADs:** 30.)

**Slices:** Slice 2: 7.1, 7.2, 7.3, 7.4a, 7.5a. Slice 3: 7.4c, 7.5b, 7.6a. Deferred: 7.4b (`.docx` read, OCR), 7.5c (`doc`, `image` substrates), 7.6b (`.xlsx`, PDF export), network exceptions.

**Blocked after:** network exceptions; OCR beyond the acceptance fixture.

**Epic 9 proof obligation:** the isolation suite on every release against the deployed profile.


### Story 17.1: Select and document the backend and profile (an implementation selection recorded with rationale); `no-code-execution-in-web`

As a platform operator,
I want select and document the backend and profile (an implementation selection recorded with rationale); `no-code-execution-in-web`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: D-3b-2
**And** it is demonstrated by: the deployed-profile assertion; boundary plants

**And** delivery slice: Slice 2; NE reference NE-7 7.1


### Story 17.2: `CodeExecution` port, supervisor, mounts, output collection, limits, execution record as `execution-log`

As a platform operator,
I want `CodeExecution` port, supervisor, mounts, output collection, limits, execution record as `execution-log`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: port
**And** it is demonstrated by: isolation negatives; forged stdout ignored; unsafe output rejected; limits end with diagnostics

**And** delivery slice: Slice 2; NE reference NE-7 7.2


### Story 17.3: `local` mode: development-only, synthetic fixtures, never a fallback

As a platform operator,
I want `local` mode: development-only, synthetic fixtures, never a fallback,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: mode
**And** it is demonstrated by: isolation unavailable fails; `local` refused in production

**And** delivery slice: Slice 2; NE reference NE-7 7.3


### Story 17.4a: Extraction programs: CSV, `.xlsx` read with cached and recalculated values, PDF text and page images

As a platform operator,
I want extraction programs: CSV, `.xlsx` read with cached and recalculated values, PDF text and page images,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.4 "Extraction programs: PDF with page images, `.docx`, `.xlsx` with formula, cached and recalculated values, CSV, email MIME, OCR" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `document-extraction-v1`
**And** it is demonstrated by: per-format cases; stale cache detected; macro not executed; corrupt file `unsupported`

**And** delivery slice: Slice 2; NE reference NE-7 7.4a


### Story 17.4b: Extraction programs: `.docx` read and OCR

As a platform operator,
I want extraction programs: `.docx` read and OCR,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.4 "Extraction programs: PDF with page images, `.docx`, `.xlsx` with formula, cached and recalculated values, CSV, email MIME, OCR" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `document-extraction-v1`
**And** it is demonstrated by: per-format cases; stale cache detected; macro not executed; corrupt file `unsupported`

**And** delivery slice: Deferred; NE reference NE-7 7.4b


### Story 17.4c: Extraction programs: email MIME parts

As a platform operator,
I want extraction programs: email MIME parts,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.4 "Extraction programs: PDF with page images, `.docx`, `.xlsx` with formula, cached and recalculated values, CSV, email MIME, OCR" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `document-extraction-v1`
**And** it is demonstrated by: per-format cases; stale cache detected; macro not executed; corrupt file `unsupported`

**And** delivery slice: Slice 3; NE reference NE-7 7.4c


### Story 17.5a: Substrates and locator grammars: `sheet` and `pdf`

As a platform operator,
I want substrates and locator grammars: `sheet` and `pdf`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.5 "New substrates and locator grammars; corroboration against the preserved representation" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: substrates
**And** it is demonstrated by: wrong claim `contradicted`; unresolved OCR `not-machine-checkable`

**And** delivery slice: Slice 2; NE reference NE-7 7.5a


### Story 17.5b: Substrate and locator grammar: `mail`

As a platform operator,
I want substrate and locator grammar: `mail`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.5 "New substrates and locator grammars; corroboration against the preserved representation" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: substrates
**And** it is demonstrated by: wrong claim `contradicted`; unresolved OCR `not-machine-checkable`

**And** delivery slice: Slice 3; NE reference NE-7 7.5b


### Story 17.5c: Substrates and locator grammars: `doc` and `image`

As a platform operator,
I want substrates and locator grammars: `doc` and `image`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.5 "New substrates and locator grammars; corroboration against the preserved representation" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: substrates
**And** it is demonstrated by: wrong claim `contradicted`; unresolved OCR `not-machine-checkable`

**And** delivery slice: Deferred; NE reference NE-7 7.5c


### Story 17.6a: Rendering engine image for `.docx`

As a platform operator,
I want rendering engine image for `.docx`,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.6 "Rendering engine images for `.docx` and `.xlsx` and PDF export" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `RenderingEngine`
**And** it is demonstrated by: round trip plus the NE-5 fidelity set

**And** delivery slice: Slice 3; NE reference NE-7 7.6a


### Story 17.6b: Rendering for `.xlsx` and PDF export

As a platform operator,
I want rendering for `.xlsx` and PDF export,
So that the epic's goal holds: a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Acceptance Criteria:**

**Given** the parent story NE-7 7.6 "Rendering engine images for `.docx` and `.xlsx` and PDF export" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `RenderingEngine`
**And** it is demonstrated by: round trip plus the NE-5 fidelity set

**And** delivery slice: Deferred; NE reference NE-7 7.6b


## Epic 18: The experience: the Zobba shell, workspace, Reviews and Settings

EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6). (Course correction 2026-09-24: Proposal 5 NE-8; contracts EXPERIENCE.md rev 2, DESIGN.md rev 2, the pack (HANDOFF §6 checklist per story). **Requirements:** FR-59, FR-48 re-based, FR-91 (the chip), FR-94–FR-96 (their surfaces), NFR accessibility at WCAG 2.2 AA (D-4b-6). **ADs:** 17 (streams), 29 (review records); Proposal 4 U1–U11 as amended by 4b.)

**Slices:** Slice 0: 8.0, 8.1. Slice 1: 8.2, 8.3a, 8.4a, 8.5a, 8.6a, 8.9a. Slice 2: 8.3b, 8.4b, 8.5b, 8.6b, 8.8, 8.9b, 8.13. Slice 3: 8.5c, 8.6c, 8.9c, 8.10, 8.11. Slice 4: 8.9d, 8.12. Deferred: 8.7 (View workspace and the browser view; task Stop and Stop requested are in 8.3a and 8.5c), OS and push notifications, dark theme, organisation connections, native packaging.

**Blocked after:** OS and push notifications (with the notification-policy contract), a dark theme, organisation connections, a native packaging.

**Epic 9 proof obligation:** WCAG 2.2 AA on the six scenes and every new flow; the interaction tests; the pack's closing rule that a rendered mockup proves no integration, security control or execution behaviour.


### Story 18.1: Identity and tokens: Pair symbol, wordmark, lockups, app icon and favicon from the pack's assets; `zobba-tokens.json` as the token source; Hanken Grotesk and IBM Plex Mono; light-only UI; Lucide at 2px (provisional); Iris never carries an audit result

As an Auditor,
I want identity and tokens: Pair symbol, wordmark, lockups, app icon and favicon from the pack's assets; `zobba-tokens.json` as the token source; Hanken Grotesk and IBM Plex Mono; light-only UI; Lucide at 2px (provisional); Iris never carries an audit result,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: DESIGN.md rev 2 §2–§3
**And** it is demonstrated by: `tokens.test.ts` re-pointed to the pack JSON and green; `stylesheet.test.ts` over the new classes; contrast figures asserted; no status colour reuses Iris

**And** delivery slice: Slice 0; NE reference NE-8 8.0


### Story 18.2: Review the pack's 23 reference screens against the six-scene acceptance set (a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result); open the design-acceptance register listing every undesigned surface with its story and slice; design each under the pack's rules before its story

As an Auditor,
I want review the pack's 23 reference screens against the six-scene acceptance set (a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result); open the design-acceptance register listing every undesigned surface with its story and slice; design each under the pack's rules before its story,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: U11 gate, 4b §10
**And** it is demonstrated by: the review record naming screens 03, 04, 06, 11, 14, 15, 17, 18 as reviewed; the register with one row per gap and its owning story; no story in §5 started before its row is closed

**And** delivery slice: Slice 0; NE reference NE-8 8.1


### Story 18.3: Shell: the pack's first-level navigation; Reviews shown by responsibility and capability; the notification panel with the complete attention view (every open question, confirmation, reconciliation case, memory proposal and result needing attention); Engagements with Scheduled checks and Legacy procedures views; Recent tasks; workspace, client and engagement named in the header; tenant switching; breadcrumbs and the one-landmark rule

As an Auditor,
I want shell: the pack's first-level navigation; Reviews shown by responsibility and capability; the notification panel with the complete attention view (every open question, confirmation, reconciliation case, memory proposal and result needing attention); Engagements with Scheduled checks and Legacy procedures views; Recent tasks; workspace, client and engagement named in the header; tenant switching; breadcrumbs and the one-landmark rule,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: U2 as amended by D-4b-2
**And** it is demonstrated by: shell and breadcrumb tests; an outstanding decision discoverable from the panel without searching old conversations; the panel's "couldn't load" Banner never the empty state; a legacy Procedure opened by its auditor; a person in two firms switches tenants and carries nothing across

**And** delivery slice: Slice 1; NE reference NE-8 8.2; design gate (D-5-6): register rows B9 (tenant switching for a person in two firms), B10 (Legacy procedures view: compiler-1 Runs, Run Detail, Live View, Replay reachable) and B14 (the notification panel's complete attention view), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; the recommended design order is in the register's Part E (surface-part rule, owner decision 2026-09-25)


### Story 18.4a: Home and the workspace: composer with engagement and Permissions chips and the default model chip, starters, thread, activity list, panel modes, client binding, Stop and Stop requested

As an Auditor,
I want home and the workspace: composer with engagement and Permissions chips and the default model chip, starters, thread, activity list, panel modes, client binding, Stop and Stop requested,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.3 "Home and the workspace: the composer ("What are we auditing today?") with engagement, Permissions and model chips and the four starters; the Continue list; the thread with attributed entries and grouped activity; the activity list anatomy; the inspection panel with its five layout modes, Pin · Expand · Close, the From-task line and Q7 protection; guidance queued and applied; select a statement and ask; the draft engagement and client-binding moment" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U3, U4, R1–R2, P1–P6
**And** it is demonstrated by: a first request needs no name or client; context survives opening evidence, changing panels, returning, new activity; a suggested reply submits the text as the answer; pinned or focused content is not replaced while inspected; keyboard citation inspection with return

**And** delivery slice: Slice 1; NE reference NE-8 8.3a; design gate (D-5-6): register rows B2 (draft engagement without a client; the client-binding moment), B17 (the activity summary above the composer, with Stop in the working and waiting states) and B22a (Slice 1 glyphs and treatments, including untrusted content), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.4b: Model chip selection and effort

As an Auditor,
I want model chip selection and effort,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.3 "Home and the workspace: the composer ("What are we auditing today?") with engagement, Permissions and model chips and the four starters; the Continue list; the thread with attributed entries and grouped activity; the activity list anatomy; the inspection panel with its five layout modes, Pin · Expand · Close, the From-task line and Q7 protection; guidance queued and applied; select a statement and ask; the draft engagement and client-binding moment" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U3, U4, R1–R2, P1–P6
**And** it is demonstrated by: a first request needs no name or client; context survives opening evidence, changing panels, returning, new activity; a suggested reply submits the text as the answer; pinned or focused content is not replaced while inspected; keyboard citation inspection with return

**And** delivery slice: Slice 2; NE reference NE-8 8.3b; design gate (D-5-6): none; RS 19 is this part's reference, and register row B2 gates 18.4a, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.5a: Reading view for a text source; a citation opens the evidence at its locator with return

As an Auditor,
I want reading view for a text source; a citation opens the evidence at its locator with return,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.4 "Artifact reading view and review mode; citations as E-references opening the evidence at its locator with the claim kept in view; L-references for limitations; the changes view with typographic diff and Undo as a new version; result and quality summaries with the six dimensions separately inspectable (Unknown and Out of period kept)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U4, R3–R5, 4b §5 rows 15, 6
**And** it is demonstrated by: a working paper read with no technical detail open; matters needing review listed; a direct edit saves a new draft without ceremony; nothing rewritten

**And** delivery slice: Slice 1; NE reference NE-8 8.4a; design gate (D-5-6): register row B22a (Slice 1 glyphs and treatments, including untrusted content), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; rows B3 and B15 gate 18.5b, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.5b: Review mode, E- and L-references, changes view, quality summary with Unknown and Out of period

As an Auditor,
I want review mode, E- and L-references, changes view, quality summary with Unknown and Out of period,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.4 "Artifact reading view and review mode; citations as E-references opening the evidence at its locator with the claim kept in view; L-references for limitations; the changes view with typographic diff and Undo as a new version; result and quality summaries with the six dimensions separately inspectable (Unknown and Out of period kept)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U4, R3–R5, 4b §5 rows 15, 6
**And** it is demonstrated by: a working paper read with no technical detail open; matters needing review listed; a direct edit saves a new draft without ceremony; nothing rewritten

**And** delivery slice: Slice 2; NE reference NE-8 8.4b; design gate (D-5-6): register rows B3 (Needs-another-look flag and impact records), B15 (input-quality expansion: Unknown and Out of period beside the pack's chips), B19 (the auditor's review mode) and B22b (Slice 2 glyphs and treatments) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.6a: The `clarify` decision surface and the refusal notice

As an Auditor,
I want the `clarify` decision surface and the refusal notice,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.5 "Decision surfaces: one coherent surface per decision with action-specific labels ("Allow and send · Edit first · Don't send", "Create invitation", "Save to Drafts", "Approve version", "Issue report"); clarify with suggested replies plus free text; `reconcile` with only the permitted recovery actions and the two unknown-outcome patterns (4b §5 row 14); Stop requested versus Stopped by you; invalidation on change" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: D-4-2, R7, P7–P9, 4b §5 rows 1, 14
**And** it is demonstrated by: no duplicate confirmation; stale details need a new decision; a retry that may duplicate is never presented as safe; a later blocked attempt shown beside the earlier unresolved one; a completed effect never described as undone

**And** delivery slice: Slice 1; NE reference NE-8 8.5a; design gate (D-5-6): register row B22a (Slice 1 glyphs and treatments, including untrusted content), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; rows B4 and B5 gate 18.6c, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.6b: Acceptance surface for a Zobba-proposed change

As an Auditor,
I want acceptance surface for a Zobba-proposed change,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.5 "Decision surfaces: one coherent surface per decision with action-specific labels ("Allow and send · Edit first · Don't send", "Create invitation", "Save to Drafts", "Approve version", "Issue report"); clarify with suggested replies plus free text; `reconcile` with only the permitted recovery actions and the two unknown-outcome patterns (4b §5 row 14); Stop requested versus Stopped by you; invalidation on change" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: D-4-2, R7, P7–P9, 4b §5 rows 1, 14
**And** it is demonstrated by: no duplicate confirmation; stale details need a new decision; a retry that may duplicate is never presented as safe; a later blocked attempt shown beside the earlier unresolved one; a completed effect never described as undone

**And** delivery slice: Slice 2; NE reference NE-8 8.5b; design gate (D-5-6): register rows B20 (acceptance surface for a Zobba-proposed change) and B22b (Slice 2 glyphs and treatments), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; rows B4 and B5 gate 18.6c, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.6c: `confirm-action` with bound details, `reconcile` with permitted actions and the two unknown-outcome sentences, Approve version, issue refusal, Stop requested

As an Auditor,
I want `confirm-action` with bound details, `reconcile` with permitted actions and the two unknown-outcome sentences, Approve version, issue refusal, Stop requested,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.5 "Decision surfaces: one coherent surface per decision with action-specific labels ("Allow and send · Edit first · Don't send", "Create invitation", "Save to Drafts", "Approve version", "Issue report"); clarify with suggested replies plus free text; `reconcile` with only the permitted recovery actions and the two unknown-outcome patterns (4b §5 row 14); Stop requested versus Stopped by you; invalidation on change" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: D-4-2, R7, P7–P9, 4b §5 rows 1, 14
**And** it is demonstrated by: no duplicate confirmation; stale details need a new decision; a retry that may duplicate is never presented as safe; a later blocked attempt shown beside the earlier unresolved one; a completed effect never described as undone

**And** delivery slice: Slice 3; NE reference NE-8 8.5c; design gate (D-5-6): register rows B4 (`reconcile` decision surface), B5 (sharing a working draft versus issuance; PDF export) and B22c (Slice 3 glyphs and treatments), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.7a: Connect from the conversation, designated resources, minimal Connections list

As an Auditor,
I want connect from the conversation, designated resources, minimal Connections list,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.6 "Connections (user-owned; provider, account identity, granted capabilities and permitted locations as three things; readable resource names; Connect from the conversation and return) and Settings › Methodology and skills (Admin)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U4, pack §11, D-4b-3, D-4b-5
**And** it is demonstrated by: selection by readable identity; consent alone makes nothing usable; no tokens or scopes shown; no empty "Organisation connections" section; an Auditor sees Methodology read-only

**And** delivery slice: Slice 1; NE reference NE-8 8.6a; design gate (D-5-6): register rows B18 (connecting a source from the conversation) and B22a (Slice 1 glyphs and treatments, including untrusted content), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; row B16 gates 18.7b, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.7b: Settings › Methodology and skills for Admin

As an Auditor,
I want settings › Methodology and skills for Admin,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.6 "Connections (user-owned; provider, account identity, granted capabilities and permitted locations as three things; readable resource names; Connect from the conversation and return) and Settings › Methodology and skills (Admin)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U4, pack §11, D-4b-3, D-4b-5
**And** it is demonstrated by: selection by readable identity; consent alone makes nothing usable; no tokens or scopes shown; no empty "Organisation connections" section; an Auditor sees Methodology read-only

**And** delivery slice: Slice 2; NE reference NE-8 8.6b; design gate (D-5-6): register row B16 (Settings › Methodology and skills: pack proposal and approval by Admin) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.7c: Connections page in full

As an Auditor,
I want connections page in full,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.6 "Connections (user-owned; provider, account identity, granted capabilities and permitted locations as three things; readable resource names; Connect from the conversation and return) and Settings › Methodology and skills (Admin)" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U4, pack §11, D-4b-3, D-4b-5
**And** it is demonstrated by: selection by readable identity; consent alone makes nothing usable; no tokens or scopes shown; no empty "Organisation connections" section; an Auditor sees Methodology read-only

**And** delivery slice: Slice 3; NE reference NE-8 8.6c; design gate (D-5-6): register row B22a (Slice 1 glyphs and treatments, including untrusted content), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built; RS 14 as amended is this part's reference and organisation connections stay deferred (B11); row B16 gates 18.7b, not this part (surface-part rule, owner decision 2026-09-25)


### Story 18.8: View workspace: the browser view panel and the full-screen surface below 1024px; pause, stop, Take over (the controller lease) across widths; "read-only on client systems"

As an Auditor,
I want view workspace: the browser view panel and the full-screen surface below 1024px; pause, stop, Take over (the controller lease) across widths; "read-only on client systems",
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: U10, R2.4, DESIGN-SYSTEM §13
**And** it is demonstrated by: narrow-screen pause and stop; Stop requested versus ceased; safety controls never hidden by the browser view

**And** delivery slice: Deferred; NE reference NE-8 8.7; design gate (D-5-6): this part's narrow and intermediate-width states (register B.3) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.9: Memory: inline "Remembered for your preferences" with a link; proposal cards with scope, source and reason and Confirm / Reject / Edit scope; verification status on inspection

As an Auditor,
I want memory: inline "Remembered for your preferences" with a link; proposal cards with scope, source and reason and Confirm / Reject / Edit scope; verification status on inspection,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: U4, 3c C10
**And** it is demonstrated by: explicit instruction shows Remembered with a link and no second prompt; an inferred item is a proposal and never an instruction; a non-owner cannot confirm

**And** delivery slice: Slice 2; NE reference NE-8 8.8; design gate (D-5-6): register row B1 (memory: "Remembered for your preferences", proposal cards, scope and verification status, retirement) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.10a: Execution, wait, input-and-coverage and connection chips; the fixed-copy tests

As an Auditor,
I want execution, wait, input-and-coverage and connection chips; the fixed-copy tests,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.9 "The status system: the six dimensions and the inspection-only vocabularies with glyph and word; the fixed-copy set (EXPERIENCE-RULES §12 as amended); the six-scene visual acceptance; WCAG 2.2 AA automated and manual checks (dragging alternatives, redundant entry, accessible authentication, target size, focus visibility) with no allowlist" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U5 → 4b §3, U11, D-4b-6
**And** it is demonstrated by: `status.test.ts` over DESIGN.md rev 2's table; `copy.test.ts` over the fixed set only; the visual acceptance record per scene; axe plus the manual checklist per new flow

**And** delivery slice: Slice 1; NE reference NE-8 8.9a; design gate (D-5-6): register row B22a (Slice 1 glyphs and treatments, including untrusted content) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.10b: Assessment and review chips; scenes 3–4

As an Auditor,
I want assessment and review chips; scenes 3–4,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.9 "The status system: the six dimensions and the inspection-only vocabularies with glyph and word; the fixed-copy set (EXPERIENCE-RULES §12 as amended); the six-scene visual acceptance; WCAG 2.2 AA automated and manual checks (dragging alternatives, redundant entry, accessible authentication, target size, focus visibility) with no allowlist" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U5 → 4b §3, U11, D-4b-6
**And** it is demonstrated by: `status.test.ts` over DESIGN.md rev 2's table; `copy.test.ts` over the fixed set only; the visual acceptance record per scene; axe plus the manual checklist per new flow

**And** delivery slice: Slice 2; NE reference NE-8 8.9b; design gate (D-5-6): register row B22b (Slice 2 glyphs and treatments) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.10c: Action-outcome vocabulary per operation; scene 5

As an Auditor,
I want action-outcome vocabulary per operation; scene 5,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.9 "The status system: the six dimensions and the inspection-only vocabularies with glyph and word; the fixed-copy set (EXPERIENCE-RULES §12 as amended); the six-scene visual acceptance; WCAG 2.2 AA automated and manual checks (dragging alternatives, redundant entry, accessible authentication, target size, focus visibility) with no allowlist" — this is bounded part c; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U5 → 4b §3, U11, D-4b-6
**And** it is demonstrated by: `status.test.ts` over DESIGN.md rev 2's table; `copy.test.ts` over the fixed set only; the visual acceptance record per scene; axe plus the manual checklist per new flow

**And** delivery slice: Slice 3; NE reference NE-8 8.9c; design gate (D-5-6): register row B22c (Slice 3 glyphs and treatments) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.10d: Scene 6 and the six-scene visual acceptance record

As an Auditor,
I want scene 6 and the six-scene visual acceptance record,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**Given** the parent story NE-8 8.9 "The status system: the six dimensions and the inspection-only vocabularies with glyph and word; the fixed-copy set (EXPERIENCE-RULES §12 as amended); the six-scene visual acceptance; WCAG 2.2 AA automated and manual checks (dragging alternatives, redundant entry, accessible authentication, target size, focus visibility) with no allowlist" — this is bounded part d; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: U5 → 4b §3, U11, D-4b-6
**And** it is demonstrated by: `status.test.ts` over DESIGN.md rev 2's table; `copy.test.ts` over the fixed set only; the visual acceptance record per scene; axe plus the manual checklist per new flow

**And** delivery slice: Slice 4; NE reference NE-8 8.9d


### Story 18.11: Reviews: the queue grouped Waiting for your review · Returned with your notes · Reviewed recently; reviewing a paper with anchored notes; Return with n notes; Mark as reviewed; "Approval and issue are separate steps"; Zobba's checks for the reviewer shown as checks, never as approval

As an Auditor,
I want reviews: the queue grouped Waiting for your review · Returned with your notes · Reviewed recently; reviewing a paper with anchored notes; Return with n notes; Mark as reviewed; "Approval and issue are separate steps"; Zobba's checks for the reviewer shown as checks, never as approval,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: RS 20–21, FR-96, 4b §5 row 6
**And** it is demonstrated by: a returned version unchanged with notes retained; the reviewer's Approve control bound to the revision; a contributor meets the refusal; checks never labelled approval

**And** delivery slice: Slice 3; NE reference NE-8 8.10; design gate (D-5-6): register rows B21 (review-note anchoring beyond RS 21) and B22c (Slice 3 glyphs and treatments), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.12: Settings › Administration: Users and roles with Invite people (Create invitation / Copy invitation link; Auditor, Audit manager, Admin only), per-engagement assignment, Remove access (engagement, tenant, account as separate actions), Invited state; Models and providers (FR-92); Connections policy; Administrator limits (the Permissions Policy); Data and retention (named); Audit log

As an Auditor,
I want settings › Administration: Users and roles with Invite people (Create invitation / Copy invitation link; Auditor, Audit manager, Admin only), per-engagement assignment, Remove access (engagement, tenant, account as separate actions), Invited state; Models and providers (FR-92); Connections policy; Administrator limits (the Permissions Policy); Data and retention (named); Audit log,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: RS 22–23, FR-92, FR-94, FR-95
**And** it is demonstrated by: invitation choices offer three roles; the invitation link never appears in a model request or log; last-administrator removal refused with the sentence; the model policy screen seeds no approved provider from the reference screen

**And** delivery slice: Slice 3; NE reference NE-8 8.11; design gate (D-5-6): register row B12 (invitation creation and acceptance), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.13: Scheduled checks list and the scheduled result: the separate dimensions per row; Awaiting approval and Pending regression states with no next run while either holds; the result page (actor line, assessment chip, readable conclusion, Exceptions · Coverage · Evidence · How it ran, Mark as reviewed, Discuss this result, suggested follow-up through the confirmation flow)

As an Auditor,
I want scheduled checks list and the scheduled result: the separate dimensions per row; Awaiting approval and Pending regression states with no next run while either holds; the result page (actor line, assessment chip, readable conclusion, Exceptions · Coverage · Evidence · How it ran, Mark as reviewed, Discuss this result, suggested follow-up through the confirmation flow),
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: RS 12–13, 4b §5 rows 2–3, U6
**And** it is demonstrated by: an active schedule found when nothing needs attention; an incomplete input reads Inconclusive with supported exceptions listed and the four statuses separate; "Didn't run" has no assessment

**And** delivery slice: Slice 4; NE reference NE-8 8.12; design gate (D-5-6): register row B6 (promotion approval; Awaiting approval and Pending regression), with this part's narrow and intermediate-width states (register B.3) — each designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


### Story 18.14: Search: scope-aware, attributed results across authorised clients without merging contexts, stale-index notice

As an Auditor,
I want search: scope-aware, attributed results across authorised clients without merging contexts, stale-index notice,
So that the epic's goal holds: EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: R10, 3c C10
**And** it is demonstrated by: a client-B item absent; the stale notice when the index lags

**And** delivery slice: Slice 2; NE reference NE-8 8.13; design gate (D-5-6): this part's narrow and intermediate-width states (register B.3) — designed under the Zobba pack's rules and reviewed before this part's surface is built (surface-part rule, owner decision 2026-09-25)


## Epic 19: Promotion and recurring checks (absorbs Epic 8; re-homes Epic 6.1, 6.2)

a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first. (Course correction 2026-09-24: Proposal 5 NE-9; contracts `promotion-v1` and `executable-plan-v2` (as amended by 4b §6: approved model configuration on the version; replacement as a proposed configuration change with regression), `regression-case-set-v1`, `run-level-gate-v2` (pack check sets), `agent-limits-recovery-v1` (the three unavailability causes). **Requirements:** FR-51, FR-13–18 as applied, FR-72, FR-84, **FR-93**. **ADs:** 19, 21, 23, 34.)

**Slices:** Slice 4: 9.1–9.6 (9.5's `assist` unused by the scenario), 9.8, 9.9a (conditional, see §4c), 9.11a. Deferred: 9.7 beyond a signal record, 9.9b, 9.10, 9.11b.

**Blocked after:** 

**Epic 9 proof obligation:** the minimum recurring safety set on every release.


### Story 19.1: `promotable-method` schema and promotion by selection

As an Auditor,
I want `promotable-method` schema and promotion by selection,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: selection rule
**And** it is demonstrated by: calendar invitation, failed attempts and exploratory branch excluded; period rule included; historical acquisition id refused

**And** delivery slice: Slice 4; NE reference NE-9 9.1


### Story 19.2: Compiler-2: vocabulary with `assist`, deterministic over a validated specification, unresolved issues, reviewable mapping

As an Auditor,
I want compiler-2: vocabulary with `assist`, deterministic over a validated specification, unresolved issues, reviewable mapping,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: `executable-plan-v2`
**And** it is demonstrated by: identical bytes twice; ambiguity blocks submission; model discrepancy blocks activation

**And** delivery slice: per §4a of Proposal 5; NE reference NE-9 9.2; design gate (D-5-6): register row B6 (promotion approval; Awaiting approval and Pending regression) gates any promotion-approval surface this part renders — the readable method view, the compiler mapping, the unresolved issues and the second-person approval; the compiler itself proceeds (surface-part rule, owner decision 2026-09-25)


### Story 19.3: `compiler = 2` Procedure Versions through the existing lifecycle, exercised with compiler-2

As an Auditor,
I want `compiler = 2` Procedure Versions through the existing lifecycle, exercised with compiler-2,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: binding
**And** it is demonstrated by: author cannot approve; frozen fields; changed rule requires regression and cannot activate while deferred

**And** delivery slice: per §4a of Proposal 5; NE reference NE-9 9.3; design gate (D-5-6): register row B6 (promotion approval; Awaiting approval and Pending regression) gates any promotion-approval surface this part renders; the lifecycle binding proceeds (surface-part rule, owner decision 2026-09-25)


### Story 19.4: Scheduled Runs under an activation delegation; duplicate suppression; interruption recovery; pinned-definition verification

As an Auditor,
I want scheduled Runs under an activation delegation; duplicate suppression; interruption recovery; pinned-definition verification,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: thin proof
**And** it is demonstrated by: duplicate delivery once; restart resumes; revocation between steps stops dispatch

**And** delivery slice: per §4a of Proposal 5; NE reference NE-9 9.4


### Story 19.5: Execution with `assist` steps; quality checks constraining dependents; the Gate over the pack's check set; four statuses on the Result

As an Auditor,
I want execution with `assist` steps; quality checks constraining dependents; the Gate over the pack's check set; four statuses on the Result,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: execution
**And** it is demonstrated by: no model turn outside `assist`; incomplete input yields Inconclusive with visible exceptions and `execution: completed`

**And** delivery slice: Slice 4; NE reference NE-9 9.5


### Story 19.6: FR-51 change classes: ordinary inputs, access failure with recovery request, material change minting a draft, identity-preserving rename

As an Auditor,
I want fR-51 change classes: ordinary inputs, access failure with recovery request, material change minting a draft, identity-preserving rename,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: change classes
**And** it is demonstrated by: rename runs; boundary move mints a draft; reconnect by display name refused

**And** delivery slice: Slice 4; NE reference NE-9 9.6


### Story 19.7: Signals and separate investigative tasks with the impact path

As an Auditor,
I want signals and separate investigative tasks with the impact path,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: investigation
**And** it is demonstrated by: result digest unchanged; impact record and rerun proposal

**And** delivery slice: Deferred; NE reference NE-9 9.7


### Story 19.8: Exception provenance and disposition for compiler-2 Runs (Epic 6.1, 6.2 re-homed)

As an Auditor,
I want exception provenance and disposition for compiler-2 Runs (Epic 6.1, 6.2 re-homed),
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: Run path
**And** it is demonstrated by: existing tests with a compiler-2 version

**And** delivery slice: Slice 4; NE reference NE-9 9.8


### Story 19.9a: Initial regression case set recorded and bound at first activation; a regression-requiring configuration stays `APPROVED` pending regression

As an Auditor,
I want initial regression case set recorded and bound at first activation; a regression-requiring configuration stays `APPROVED` pending regression,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**Given** the parent story NE-9 9.9 "Regression case sets: versioned, reviewed, bound to the candidate; expected-difference review (Epic 8.5, 8.6 re-based)" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `regression-case-set-v1`
**And** it is demonstrated by: reproduced-but-wrong result fails; unsuitable last Run refused; intentional correction passes only its approved expectations; live source refused

**And** delivery slice: Slice 4; NE reference NE-9 9.9a; design gate (D-5-6): register row B7 (regression case sets and a version pending regression) gates this part's surfaces — the case set and the Pending regression state; the regression backend proceeds (surface-part rule, owner decision 2026-09-25)


### Story 19.9b: Regression execution, administration and the successor's expected-difference review

As an Auditor,
I want regression execution, administration and the successor's expected-difference review,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**Given** the parent story NE-9 9.9 "Regression case sets: versioned, reviewed, bound to the candidate; expected-difference review (Epic 8.5, 8.6 re-based)" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `regression-case-set-v1`
**And** it is demonstrated by: reproduced-but-wrong result fails; unsuitable last Run refused; intentional correction passes only its approved expectations; live source refused

**And** delivery slice: Deferred; NE reference NE-9 9.9b; design gate (D-5-6): register row B7 (regression case sets and a version pending regression) gates this part's surfaces; the regression backend proceeds (surface-part rule, owner decision 2026-09-25)


### Story 19.10: Missed starts, handover under succession, drift detection, notification policy (Epic 8.2–8.4 re-based)

As an Auditor,
I want missed starts, handover under succession, drift detection, notification policy (Epic 8.2–8.4 re-based),
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**When** the story is delivered
**Then** it establishes: later
**And** it is demonstrated by: transitions blocked until each lands

**And** delivery slice: Deferred; NE reference NE-9 9.10


### Story 19.11a: Approved model configuration recorded; temporary failure, retirement and policy revocation detected and blocked with the cause; replacement path blocked

As an Auditor,
I want approved model configuration recorded; temporary failure, retirement and policy revocation detected and blocked with the cause; replacement path blocked,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**Given** the parent story NE-9 9.11 "A check keeps the model and effort it was approved with; temporary provider failure, model retirement and policy revocation recorded as distinct causes that block or interrupt under the recovery contract; a replacement is a platform-authored proposed configuration change through the versioned path with independent approval and regression as required; completed results unchanged; cost and usage visible to administrators by engagement" — this is bounded part a; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `promotion-v1` §configuration change, `agent-limits-recovery-v1` §causes, `model-policy-v1` (FR-93)
**And** it is demonstrated by: a retired model pauses the check with its cause and mints a proposal, never an in-place amendment; a replacement cannot activate without the required approval and regression; a tenant default change leaves the check's configuration unchanged; earlier results byte-identical

**And** delivery slice: Slice 4; NE reference NE-9 9.11a; design gate (D-5-6): none; this part's blocked state is shown with its recorded cause under EXPERIENCE.md §6 on 18.13's surfaces, and register row B13 gates the replacement path (19.11b) (surface-part rule, owner decision 2026-09-25)


### Story 19.11b: Replacement as a proposed configuration change with approval and regression; cost reporting

As an Auditor,
I want replacement as a proposed configuration change with approval and regression; cost reporting,
So that the epic's goal holds: a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Acceptance Criteria:**

**Given** the parent story NE-9 9.11 "A check keeps the model and effort it was approved with; temporary provider failure, model retirement and policy revocation recorded as distinct causes that block or interrupt under the recovery contract; a replacement is a platform-authored proposed configuration change through the versioned path with independent approval and regression as required; completed results unchanged; cost and usage visible to administrators by engagement" — this is bounded part b; completing it never completes the parent, whose remaining parts and their outstanding acceptance criteria are recorded in `course-correction-dispositions.yaml`

**When** the story is delivered (the parent story's establishes and demonstrated-by lists follow; this part delivers the portion its title names)
**Then** it establishes: `promotion-v1` §configuration change, `agent-limits-recovery-v1` §causes, `model-policy-v1` (FR-93)
**And** it is demonstrated by: a retired model pauses the check with its cause and mints a proposal, never an in-place amendment; a replacement cannot activate without the required approval and regression; a tenant default change leaves the check's configuration unchanged; earlier results byte-identical

**And** delivery slice: Deferred; NE reference NE-9 9.11b; design gate (D-5-6): register row B13 (the model replacement proposal for a check) — designed under the Zobba pack's rules and reviewed before this part's replacement surface is built (surface-part rule, owner decision 2026-09-25)

