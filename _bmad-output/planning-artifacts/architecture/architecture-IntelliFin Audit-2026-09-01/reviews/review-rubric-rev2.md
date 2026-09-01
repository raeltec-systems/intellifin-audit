---
title: "Architecture Reviewer Gate — Rubric Walk (revision 2)"
artifact: "../ARCHITECTURE-SPINE.md"
revision_reviewed: 2
reviewed: 2026-09-01
review_mode: independent rubric walker; spine not edited
mechanical_lint: "lint_spine.py — 0 findings"
verdict: needs-revision
counts:
  critical: 0
  high: 2
  medium: 6
  low: 8
---

# Rubric Walk — Architecture Spine revision 2

## Verdict

**Needs revision — two narrow, cheap edits.** Revision 2 is a substantially stronger spine than revision 1: every seam the revision-1 gates closed (artifact idempotency, atomic publication, canonical integrity bytes, versioned contracts, provenance graph, retry ownership, provider conformance, release discipline, recovery unit, telemetry sanitizer, credential seam) is still closed, and the five new ADs (AD-16..AD-20) land the PRD revision-2 divergence points — durable waits, live channel, dual acquisition paths, schedules, notifications — as enforceable rules rather than descriptions. Nothing found here reopens a revision-1 finding.

The two High findings are both consistency defects introduced by the revision-2 re-distillation, not design gaps: (1) `SealResult` is bound to the web process but no actor is assigned to seal a Result whose evaluations are all `RULE`, so rule-only and scheduled Runs have no path to a System Outcome; (2) the Consistency Conventions Run state machine, which AD-7 makes normative, omits the timeout, cancel, and failure transitions that AD-3 and AD-16 mandate. Both are one-paragraph fixes. The Medium findings are ownership/acquisition ambiguities that two independent epics could resolve differently; none is load-bearing for the assurance claim.

## Prior-review closure check (revision-1 findings still closed in revision 2)

| Revision-1 finding | Closed by (rev 2 text) | Status |
| --- | --- | --- |
| H-1 / TR-01 / ADV-10 evidence-object recovery | AD-11 recovery unit, recovery bucket, restore drill; AD-12 full recovery test | Still closed |
| H-2 / ADV-01 cross-store sealing protocol | AD-5 reservation/idempotency key/Registered/reconciler; AD-12 crash points | Still closed |
| H-3 / ADV-03 signer trust anchor and canonical bytes | AD-5 RFC 8785, per-aggregate chain, envelope fields, `ManifestSigner`, verification bundle, vectors | Still closed |
| H-4 / ADV-07 credential seam, egress, provider conformance | AD-4 `CredentialRef`/`CredentialProvider`, request interception, conformance contract; AD-9 model data policy | Still closed |
| ADV-02 atomic publication | AD-3 `CompleteRun`; AD-8 `UnitOfWork` | Still closed (but see H-1 below on the sealing side) |
| ADV-04 / ADV-05 versioned contracts, provenance graph | AD-14 (now extended to Timeline, Replay, Snapshots, Escalations, notifications, Templates, plans) | Still closed |
| ADV-06 retry/failure owners | AD-3 one retry policy; Errors convention | Still closed |
| ADV-08 rolling release | AD-15 | Still closed |
| ADV-09 actor/authorization time | AD-7 initiation snapshot, service principal, Principals convention | Still closed |
| M-1 chain scope, M-2 dispatch escape hatch, M-3 tenancy, M-4 access events, M-5 fingerprint HMAC, L-2 finalized correction | AD-5, AD-3, Deferred, AD-10, AD-6, Deferred respectively | Still closed |
| TR-02 telemetry, TR-03 PostgreSQL image, TR-04 provider transport, TR-05 Solari scope | AD-10, AD-11, AD-9, Deferred | Still closed; TR-05 partly reopened by design (sandbox SDK re-added for DesktopExecution, memlog records the re-verification and the open AT-SPI question) |
| Recheck caution: finalization signature over stale head | Not addressed in rev 2 text | Carried as L-7 |

## Good-spine checklist

### 1. Fixes the real divergence points for the level below — **adequate**

| Dimension | Status | Where | Note |
| --- | --- | --- | --- |
| Module boundaries | Decided — strong | AD-1, AD-2, Modules convention | CI-enforced direction; module list named |
| Data ownership | Decided — adequate | AD-2, AD-5, AD-8 | Two aggregates lack a named owning module (M-3, M-4) |
| State mutation paths | Decided — strong | AD-2, AD-7, Commands convention | Command handlers only; expected revision on every human mutation |
| Durable contracts | Decided — strong | AD-14, Durable contracts convention | Extended to all rev-2 boundaries |
| Execution model | Decided — strong | AD-3, AD-16, AD-8 | One job per Run, checkpoints, atomic publication |
| Human-in-the-loop | Decided — strong | AD-16, AD-7, AD-9 | Durable waits, wait records, closed answer sets, worker-owned deadlines |
| Live channel | Decided — adequate | AD-17, Live channel convention | Single source, cursor replay; issuer of NOTIFY for web-side appends unstated (L-3) |
| Acquisition paths | Decided — strong | AD-4, AD-18 | One Observation contract; Reference Sources under-specified (M-2) |
| Evaluation and sealing | Decided — thin | AD-3, AD-6 | Sealing actor for rule-only Runs unassigned (H-1); confidence threshold unused (M-1) |
| Notifications | Decided — adequate | AD-20 | Delivery mechanism (job vs poll) unstated (L-4) |
| Scheduling | Decided — strong | AD-19 | Unique (version, period) constraint; missed starts recorded |
| Security / credentials | Decided — strong | AD-4, AD-7, AD-9, AD-10, AD-11 | Role matrix bound via EXPERIENCE.md |
| Evidence integrity | Decided — strong | AD-5 | PoC threat boundary explicit |
| Deployment and environments | Decided (PoC) / deferred (production) — adequate | AD-11, AD-15, Deferred | Only the PoC environment is named; local/CI object storage and the meaning of "environment" as a scope key are silent (L-5) |
| Operations (backup, monitoring, restore) | Decided — adequate | AD-10, AD-11 | Backup/restore strong; alerting on missed Schedules, stuck waits, reconciler mismatches silent (L-6) |
| Testing | Decided — strong | AD-12 | Names the seams, fixtures, and CI stages |
| Tenancy | Deferred explicitly | Deferred | Single-tenant PoC declared |
| Workspace lifecycle on resume | Silent — thin | AD-16 | Reattach vs recreate after worker crash undefined (M-5) |

No dimension is silent outright; two are thin (evaluation/sealing, workspace lifecycle on resume).

### 2. Every AD's Rule is enforceable and prevents its stated divergence — **adequate**

All twenty Rules are verifiable by at least one of a CI check, a test, a code-review criterion, or a runtime precondition. AD-1, AD-3, AD-5, AD-8, AD-12, AD-14, AD-15, AD-16, AD-17, AD-19, AD-20 are verifiable almost clause by clause. Descriptive clauses (not constraints) that should either be tightened or accepted as framing:

- AD-2 opening sentence ("the domain model owns entities, value objects, lifecycle rules, and deterministic invariants") is framing; the enforceable content follows it.
- AD-9 "Exhaustion or uncertainty fails safely" is enforceable only by reference to addendum E; acceptable because the Errors convention binds addendum E as the closed taxonomy.
- AD-11 "Operations — not Railway — own tuning, backup, monitoring, and restore" is a responsibility assignment, not a testable rule; the restore-drill clause that follows is testable. Acceptable.
- AD-13 is enforceable as "metrics exist and are queryable" but names no acceptance shape; acceptable at feature altitude since FR-50 owns the list.

One Rule does not fully prevent its stated divergence: AD-3 prevents "duplicate business effects" and "irrecoverable partially completed Runs" but leaves a completed Run with no pending confirmations unsealed with no assigned sealer (H-1).

### 3. Nothing under Deferred could let two units diverge now — **adequate, one exception**

Every Deferred item is a production/scale gate or an explicit non-goal except "Workpaper Bundle formats", which is exported in the PoC (FR-46) and verified by an independent verifier (AD-5 golden vectors). AD-14 versions the manifest bytes, not the bundle layout (M-6). The constraint "the Work Item model and wait records must not preclude parallel Work Items" is correctly a present-tense rule inside a Deferred bullet.

### 4. Named technology is verified-current — **adequate**

Memlog `(version)` entries support 14 of 22 Stack rows: Node.js 24 LTS (major only), Next.js 16.3.4, React 19.2.8, PostgreSQL 18.6, pnpm 11.25.0, pg-boss 12.29.0, Drizzle 0.45.2 / Kit 0.31.10, Better Auth 1.7.2, Vercel AI SDK 7 (major only), @solarisdk/browser 0.1.2, @solarisdk/sandbox 0.1.2, @aws-sdk/client-s3 3.1123.0, @ai-sdk/openai 4.0.53, @ai-sdk/anthropic 4.0.46, @sentry/node 10.73.0, resend 6.25.0. Not supported by any memlog version entry: TypeScript 7.0.2, postgres.js 3.4.9, Zod 4.5.4, Pino 10.3.1, Vitest 4.1.11, Playwright 1.62.1, exact `ai` 7.0.87, @sentry/nextjs 10.73.0, exact Node 24.20.0. All nine are, however, verified against official sources in `reviews/review-technology-reality.md` (same date, verification matrix), so the "verified 2026-09-01" claim is evidenced in the workspace but not in the decision log (L-1). No web re-verification was performed in this pass. The sandbox SDK re-addition is supported by a memlog version entry and an open question with owner and revisit trigger.

### 5. IDs, additivity, contradictions, conventions, capability map, mermaid — **adequate, one contradiction**

- AD-1..AD-20 unique and monotonic (lint pass); AD-16..AD-20 are additive and reference only existing ports/modules.
- Amended ADs (AD-2, AD-3, AD-4, AD-6, AD-7, AD-9, AD-14) do not contradict one another. Escalation semantics are restated consistently in AD-7, AD-9, and AD-16.
- **Consistency Conventions disagree with the ADs on the Run state machine** (H-2): the table omits `PAUSED → INCONCLUSIVE`, `AWAITING_AUDITOR → INCONCLUSIVE` (AD-16 deadline), `{QUEUED, RUNNING, PAUSED, AWAITING_AUDITOR} → CANCELED` (AD-3 cancel from any active state), and `RUNNING → RUN_FAILED` (AD-3 Session Step exhaustion). Addendum E has all of them.
- Work Item, Procedure Version, Review, Exception machines match addendum E and DESIGN.md's eight families. Evaluation: the spine models `UNEVALUATED` as a value with an origin, where addendum E lists it among origins; the spine's choice is coherent but should be stated as a deliberate resolution (L-8).
- Ports: the nine named ports all appear in ADs and in the ports diagram; the modules in the map all appear in the Modules convention, except registrations/bindings (M-3).
- Capability map: FR-1..FR-50 fully covered by contiguous ranges; every "Governed by" AD exists; NFR row is a catch-all (acceptable).
- Mermaid: all four blocks parse by inspection (flowchart BT/TD/LR, cylinder nodes, dotted labeled edge, chained edge). The `\n` inside quoted labels in the first diagram renders as literal text in standard mermaid; use `<br/>` (L-9, cosmetic). No CLI validation was available in this environment.

### 6. Long Rules — should any be split? — **two splits recommended**

- **AD-3 — yes, split the publication/sealing clause out.** AD-3 mixes worker-owned execution (plan, Timeline append, per-Observation evaluation, retries, dispatch atomicity, overlap, cancel, rerun) with the cross-process Result lifecycle (`CompleteRun` in the worker, `SealResult` in the web). A worker epic and a web/review epic each own one side and will each read only their half; the unassigned sealing trigger (H-1) is exactly the cherry-pick that results. Recommend a new AD "Result publication and sealing" carrying `CompleteRun`, `SealResult`, the sealing trigger, `COMPLETED → INCONCLUSIVE`, and the threshold rule from M-1.
- **AD-5 — yes, split the integrity chain/signing paragraph out.** Paragraph 2 (per-aggregate audit hash chain, canonical bytes, signature envelope, `ManifestSigner`, verification bundle) binds every module that writes audit events — procedures, runs, review, notifications — none of which would naturally read an AD titled "Evidence is sealed". AD-10 enumerates audit events without referencing the chain. A unit building `procedures` audit events could write unchained rows and still satisfy AD-10. Recommend a new AD "Audit events are hash-chained and finalization is signed", referenced from AD-10's Binds.
- **AD-6 — no.** One evaluation unit consumes it whole; splitting would separate grounding from the evaluator that depends on it.
- **AD-9 — no.** Its clauses all bind the single agent-execution unit; the Escalation and Replay clauses are duplicated in AD-16/AD-17 consistently, which is acceptable redundancy rather than a cherry-pick risk.

### 7. Operational/environmental envelope — **adequate: decided for the PoC, deferred for production**

Deployment (two containers, one repo, Railway services, pinned PostgreSQL image, `server_version` check), release discipline (AD-15), backup/restore unit and drill (AD-11), telemetry (AD-10), and teardown/retention are decided. Production storage, tenancy, residency, key custody, and customer-hosted topology are explicitly deferred with triggers. Thin spots: environment topology below the PoC deployment (local, CI) and the alerting side of monitoring (L-5, L-6). Recovery-target provider independence remains accepted at PoC scope per the revision-1 recheck.

## Findings

### High

**H-1 — Sealing has no actor for Runs whose evaluations are all `RULE`** (AD-3, AD-6, paradigm diagram; FR-40, addendum E)
AD-3: "`SealResult` is a separate web-side unit of work that computes the System Outcome once every evaluation is resolved." FR-40 and addendum E make sealing a *condition* (Gate passed, nothing pending), not a human action. For a Run with no uncompiled conditions — P-2, P-3, any scheduled Run whose conditions all compile — every evaluation is resolved at `CompleteRun`, yet the worker may not seal (web-side) and no web command fires without a human. Two compliant builds: (a) `CompleteRun` seals inline when nothing is pending (violates "web-side"); (b) the Result stays Pending Confirmation until an Auditor opens it, so scheduled Runs never reach Pass/Control Failure unattended, contradicting UJ-4 and the Result-outcome state family. Fix: make sealing an application command invocable from either process, triggered by `CompleteRun` when no evaluation is pending and by the last confirmation/rejection otherwise; keep the "computed once, immutable" rule. Include in the AD-3 split (item 6).

**H-2 — The normative Run state machine omits transitions AD-3 and AD-16 require** (Consistency Conventions; AD-7)
AD-7 says transitions "follow the state machines in Consistency Conventions". The Run row lacks `PAUSED → INCONCLUSIVE` and `AWAITING_AUDITOR → INCONCLUSIVE` (AD-16 deadline), `→ CANCELED` from `QUEUED`, `RUNNING`, `PAUSED`, `AWAITING_AUDITOR` (AD-3), and `RUNNING → RUN_FAILED` (AD-3, addendum E). A domain state machine coded from the table rejects the timeout transition the worker must make on wake. Fix: copy addendum E's Run row verbatim, including the *Active* set and "cancel from any active state".

### Medium

**M-1 — The frozen confidence threshold has no rule** (AD-2, AD-6; FR-38 assumption)
AD-2 freezes a "confidence threshold" and AD-6 records every uncompiled-condition evaluation as `AGENT_JUDGED / pending`. FR-38 (bound assumption) stores below-threshold evaluations as `UNEVALUATED` needing no confirmation. One unit gates every agent evaluation on a human; another applies the threshold; the two produce different Pending Confirmation counts and different sealing times for the same Run. Add one sentence to AD-6: below the version's threshold the evaluation is stored with value `UNEVALUATED`, origin `AGENT_JUDGED`, confidence retained, confirmation not required.

**M-2 — Reference Sources are "consulted by the evaluator" but not acquired or preserved** (AD-18, AD-5, AD-6; addendum A.2 RoleMatrix, addendum F)
The evaluator is a deterministic domain function with no I/O. The spine does not say that a Reference Source is acquired through `EvidenceAcquisition` as a Session Step, registered as an artifact under AD-5, digest-recorded, and frozen into the Evidence Package before evaluation. One unit reads the file at evaluation time through an infrastructure shortcut (no provenance, no digest, not in the Workpaper Bundle); another treats it as Evidence. Bind it: Reference Sources are adapter-acquired Session Steps producing Registered artifacts; the evaluator receives their parsed content as an input value.

**M-3 — Target System registrations and Population Source bindings have no owning module** (Modules convention, AD-2, capability map; FR-7, Administration surface)
Procedure Versions freeze "registration digests" and the Administration surface manages registrations, bindings, and diagnostics, but the module list (`identity`, `procedures`, `runs`, `evidence`, `evaluation`, `review`, `notifications`) has no home for them and the FR-1..FR-3 row points to "acquisition policies". Registrations hold `CredentialRef`s, allowlists, and expected labels used by AD-4 and AD-6. Name the owner (a `registrations` module, or explicitly `procedures`) so digests, change events that mint platform-authored drafts, and admin authorization land in one place.

**M-4 — The Exception aggregate is created in `evaluation` and mutated in `review`** (AD-2, AD-3, AD-6, capability map)
`CompleteRun` commits Exceptions with the Result (evaluation module); assignment and disposition live in the review module (FR-41..44). AD-2 forbids cross-module table access; AD-8's `UnitOfWork` permits cross-module transactions but not shared ownership. Two units can each own the `exceptions` table. State the owner (recommend `evaluation` owns creation and fingerprint; `review` owns a separate disposition/assignment aggregate keyed by Exception id, matching the "separate aggregates" rule in AD-7).

**M-5 — Resume after workspace loss is undefined** (AD-16, AD-3; addendum E Session Steps)
AD-16 keeps the workspace alive to the deadline under a lease and resumes "from the checkpointed Tool Action". It does not say whether the provider session identifier is checkpointed for reattachment, nor what happens when the workspace is gone on wake (worker crash past provider expiry, provider restart): re-run the sign-in Session Steps and continue, or `RUN_FAILED`. Both are defensible; they differ in Timeline shape, retry accounting, and the Evidence Quality Gate's workspace row. Decide one and bind the checkpoint to carry the workspace lease identity.

**M-6 — "Workpaper Bundle formats" is deferred while the PoC exports and independently verifies bundles** (Deferred; AD-5, AD-14; FR-46)
AD-14 versions the manifest and Workpaper contract as Zod schemas, which fixes bytes for JSON members but not the physical bundle: archive type, member naming, where the signed manifest and public-key bundle sit, and how the verifier locates artifacts by digest. The exporter epic and the verifier/golden-vector epic will each choose. Either bind a minimal layout now (one archive, a root manifest at a fixed path, members addressed by digest) or narrow the Deferred bullet to "additional export formats".

### Low

**L-1 — Memlog version entries do not cover nine Stack rows** (Stack; memlog). TypeScript, postgres.js, Zod, Pino, Vitest, Playwright, exact `ai`, @sentry/nextjs, exact Node are evidenced only in `reviews/review-technology-reality.md`. Add one memlog `(version)` line so the decision log stands alone.

**L-2 — Stack row "Railway | managed PoC platform" contradicts AD-11's operator-owned database** (Stack, AD-11). Relabel "PoC hosting platform; PostgreSQL and buckets operator-managed per AD-11".

**L-3 — NOTIFY issuer for web-side Timeline appends** (AD-17). AD-17 says "the worker issues one `NOTIFY` per appended Timeline event", but AD-3 makes every state change append a Timeline event, and Escalation answers, cancel requests, confirmations, and sealing are web-side appends. Bind NOTIFY to the Timeline repository (or a trigger) rather than to the worker so Live View reflects human actions within the 5-second budget. Also state that the per-Run Timeline sequence is allocated under the Run aggregate's revision lock so cursor replay cannot skip an event that commits out of sequence order.

**L-4 — Notification delivery mechanism** (AD-20). "A worker delivers them" — say whether delivery is a pg-boss job enqueued in the same transaction (consistent with AD-3) or a poll of undelivered rows; the idempotent send key suggests the former.

**L-5 — Environment topology below the PoC deployment** (AD-11, AD-12, Configuration convention). Only the PoC environment is named. "Environment" is also a scope key for `CredentialProvider` and the Exception HMAC; define its identity (an environment id in configuration) and name the object-storage-compatible store used locally and in CI so fixtures and conformance tests share one target.

**L-6 — Alerting** (AD-10, AD-11, FR-49). Monitoring names Sentry and structured logs but no alert conditions. At minimum: missed Schedule start, wait past deadline without wake, reconciler pending/orphan/missing count > 0, worker heartbeat lost, post-Run integrity mismatch.

**L-7 — Finalization signature over a stale chain head** (AD-5; carried from revision-1 recheck). AD-5 signs before the storing transaction; bind that the final audit event and head are computed under the Review aggregate's expected-revision lock and the transaction aborts if the head changed, and add that fixture to AD-12's optimistic-concurrency list.

**L-8 — `UNEVALUATED` as value versus origin** (State machines convention; addendum E). The spine models it as a value with an origin; addendum E lists it among origins. State the resolution explicitly so the evaluation schema and the addendum are read as agreeing.

**L-9 — Mermaid label newlines** (Design Paradigm diagram 1). `\n` inside quoted labels renders literally in standard mermaid; use `<br/>`.

## Recommended gate action

Apply H-1 and H-2 as direct spine edits (they are the AD-3 split plus one table row). Apply M-1 through M-6 as one-sentence bindings or a named owner each; none requires new infrastructure. Consider the AD-5 split when applying M-6. Address L-1 and L-2 in the memlog and Stack table. Re-run `lint_spine.py` and an adversarial recheck focused on the sealing path and the Run state machine after amendment.
