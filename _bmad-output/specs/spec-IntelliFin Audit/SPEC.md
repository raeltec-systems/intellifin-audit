---
id: SPEC-intellifin-audit
title: Zobba — continuing audit working environment
status: final
revision: 3-baseline
created: 2026-09-01
updated: 2026-10-01
companions:
  - glossary.md
  - brownfield.md
  - ../../planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ../../planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - ../../planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/CONTRACT-REGISTER.md
  - ../../planning-artifacts/ux-designs/ux-Zobba-2026-09-25/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md
  - ../../planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md
sources: []
---

# Zobba — continuing audit working environment

## 0. Authority and replacement

The owner accepted the product/architecture design **revision 3** on 30 September 2026 and requested this consolidation and implementation planning. This SPEC and its adopted companions are the active build contract. The accepted design carries detailed runtime obligations; the active product, architecture and experience documents express them for implementation. The new operating budget replaces the design's illustrative cost allowances, not its product commitments. The design's earlier “for owner review” and planning-pending statements are historical status, superseded by this acceptance.

CAP-1–16 and the compiler-based specification are retired for the new build, preserved under [archive/pre-revision-3-2026-09-30](archive/pre-revision-3-2026-09-30/README.md). CAP-17–30 are new identities; none reuses an old identifier for a different meaning. Old story completion proves only the old implementation. The active backlog is `planning-artifacts/epics.md`; the standard `implementation-artifacts/sprint-status.yaml` is its single active queue. The historical queue is archived, not marked complete by this change.

This contract authorizes planning under the accepted direction. It does not claim the Rust application is implemented, source applications are qualified, or customer deployment and commercial terms are approved. Do not use old compiler-1/2 coexistence or Builder preservation as requirements for the new work.

## Why

Auditors need to delegate substantial work and keep directing it as evidence, questions and priorities change. Zobba provides a continuing engagement conversation that coordinates distinct Tasks, works through real applications and analytical programs, and produces evidence-supported work products. Methodology, skills, knowledge, current authority and accountable review accompany that work from the first complete task. People can inspect the basis, privately provide access, take over, correct and review while work continues. A convincing conversation or completed run never substitutes for supported audit conclusions.

## Capabilities

- **CAP-17 — Identity and engagement scope**
  - **intent:** People access client work only through their current organisation, engagement assignment and audit role.
  - **success:** Cross-tenant/client/engagement requests and object downloads fail; revocation stops new disclosure and dispatch; Admin configuration alone grants no audit sign-off. Membership changes preserve historical authorship. Each organisation retains at least one active, non-expiring Admin membership linked to an active identity; additional temporary Admins remain allowed. Membership and identity changes enforce this atomically, including concurrent changes (owner-approved safeguard, 1 October 2026).
- **CAP-18 — Coordinating conversation**
  - **intent:** An auditor coordinates several Tasks through one engagement conversation and opens each Task's history or output without losing that conversation.
  - **success:** A second objective creates one linked Task while the first continues; each guidance, answer and control has an exact target and attributable receipt. Ambiguous material direction waits for resolution; inspection stays pinned and returning users see supported changes since their last visit.
- **CAP-19 — Continuing work and responsive control**
  - **intent:** Tasks continue across disconnection, durable waits, corrections and recoverable failures while people can guide, pause and stop them.
  - **success:** Received and Applied are distinct; restart rehydrates committed work without replaying uncertain effects. Task Pause/Stop covers its delegated execution, names other work and enabled schedules outside that scope, and never waits for a provider stream to acknowledge admission.
- **CAP-20 — Standing Permissions and effects**
  - **intent:** Zobba proceeds within standing authority and seeks a precise decision only when required for the actual proposed action.
  - **success:** Effective authority intersects organisation, engagement, member, account, purpose and action limits at dispatch/disclosure. Confirmations bind exact recipients/material/destination/version/expiry. Revocation fences new dispatch; an uncertain send remains unresolved until reconciled. Retrieved text and model proposals grant no authority.
- **CAP-21 — Managed computer and private access**
  - **intent:** People inspect and control the real computer used by the Task, privately sign into the required application and return verified access to Zobba.
  - **success:** Watch grants no input; transfer fences the prior controller. During protected sign-in every model observation, extraction, recording and clipboard path is suspended. Submitted details are not verified access; automation resumes only after the account/environment check. Disconnect or stale generation never creates silent handback or invented frames.
- **CAP-22 — Analysis and file movement**
  - **intent:** Zobba analyses selected material and registers useful outputs without exposing acquisition credentials to programs.
  - **success:** Analysis runs with bounded resources and scoped inputs; it has no browser sessions or broad connector credentials. Input, code/environment, parameters and output identities are recorded. Controlled file transfer scans and verifies outputs before evidence/work-product registration; untrusted output cannot execute as interface content.
- **CAP-23 — Methodology and skills**
  - **intent:** Admin configures the firm's methodology and permitted skills through ordinary versioned Save, and Tasks use the applicable requirements from the outset.
  - **success:** Save validates and creates an attributable immutable version without a default second approver. New/active/reviewed work observes the documented binding and impact rules. Required controls cannot be overridden by preferences or task replies. A neutral starter is labelled; missing criteria block only the dependent conclusion or issuance.
- **CAP-24 — Working knowledge and context**
  - **intent:** Zobba uses relevant authorised prior material, exact decisions and corrections to continue coherent work through long conversations and interruptions.
  - **success:** Context manifests identify method/skill versions, source lineage and freshness. Corrections invalidate dependent claims and summaries; revocation is rechecked before disclosure. Compaction preserves unresolved decisions/effects and authority from durable records. No client material silently enters another engagement's context.
- **CAP-25 — Evidence and requests**
  - **intent:** Acquired and derived material remains attributable, inspectable and linked to the claims and requests it supports.
  - **success:** Immutable content identities, source versions, acquisition receipts and derivations reconstruct the evidence chain. Population/selection coverage is explicit. A supplier's “done” or a webhook does not fulfill a request: actual authorised content is reacquired and checked; late evidence creates a traced reconsideration or successor.
- **CAP-26 — Audit evaluation**
  - **intent:** Zobba evaluates an explicit assertion and criterion using an established basis and reports supported findings, limitations and human judgment separately.
  - **success:** Facts and evaluations bind subject, source, criterion, method and period. Applicability, execution, verdict, coverage and disposition remain distinct; qualified absence requires coverage evidence. Deterministic predicates, rubric-assisted proposals and human judgments retain their actual origin. Duplicate failures on one subject do not inflate distinct-subject counts; missing material never becomes a pass or fabricated failure.
- **CAP-27 — Work products and review**
  - **intent:** Auditors develop cited work products, inspect changes and complete the engagement's team or solo review and authorised issuance.
  - **success:** The shelf and conversation open the same stable versioned objects. Edits have version checks; approval binds exact content and dependencies. Team review uses a different eligible person; permitted solo review is explicitly Self-reviewed. Admin alone cannot sign off. Issuance identifies recipients/package and remains a separate authorised human action; new evidence never rewrites an issued record.
- **CAP-28 — Recurring methods and continuing assurance**
  - **intent:** Suitable reviewed work becomes a Check that repeats its assurance method over new periods while ordinary requests and evidence arrivals can resume Tasks.
  - **success:** A Check freezes semantic criteria/selection/coverage, not clicks; versions bind sources, service delegation, owner, budget and escalation. Logical-period deduplication prevents duplicate occurrences. Late evidence, expired decisions, missed triggers and changed methods follow explicit contracts; uncertain dispatched effects remain reconcilable. Each occurrence produces a draft assessment, never human sign-off.
- **CAP-29 — Models, tools, connections and helpers**
  - **intent:** Zobba chooses qualified models and work routes, and delegates bounded independent work without making the auditor prescribe every step.
  - **success:** Native provider adapters record requested/actual model, effort, context and usage; only complete validated proposals become operations. API, vetted MCP and computer routes share authority semantics. Connection owners/consent and revocation are explicit. Helpers receive bounded context/budgets and cannot compete for a computer or silently merge conflicting outputs.
- **CAP-30 — Measured operation and qualification**
  - **intent:** Operators and firms can understand usage, limits, readiness, failure and recovery for the service they actually run.
  - **success:** Budget admission and measured settlement distinguish shared capacity from customer consumption. Response and computer-readiness targets are qualified through the stated representative conditions. Backups, restore, retention, secret-safe telemetry, support profiles and cost assumptions are demonstrable; unavailable capacity and incomplete work are honestly labelled.

## Constraints

- One own Rust backend/agent authority, a fresh PostgreSQL schema, real isolated managed computers, separate disposable analysis, S3 content and React/TypeScript Pair web UI. Existing code supplies reusable components and verified behavior, not a second domain backend or mandatory schema bridge.
- A Task belongs to one engagement. The conversation coordinates exact Task commands; it is not another execution authority. Work product audience, task scope, source access and computer control are independently checked.
- Live inspection preserves source-side read-only or a qualified narrow adapter restriction. Test workflows and audit coordination have distinct purpose grants. Human takeover cannot defeat those restrictions.
- Methodology, necessary skills and working knowledge are dependencies of the first complete task, along with native models/tools, real computer/private access, evidence, analysis, evaluation and truthful review. A file-only or static-chat foundation does not satisfy that gate.
- Task/operation identity, owner epochs, one-use dispatch claims and reconciliation govern retries. Neither transcript completion nor a timeout establishes whether an external effect happened.
- Tenant/client boundaries, data-destination checks, prompt-injection resistance, immutable evidence, exact-version review and protected sign-in apply from their first implementation slice, not only a late hardening phase.
- Performance targets are acceptance goals under declared conditions, not measured claims. The architecture's two-zone service, managed-computer and recovery contracts remain binding; a cheaper pilot does not silently waive them.
- Audit findings and evidence remain reviewable when negative, incomplete or stopped. Model confidence never proves completeness. Human judgment and product execution status cannot overwrite the recorded evidence or computation.
- Stable historical identifiers and signed/issued records are preserved. New Rust-domain migrations do not replay the old Drizzle schema. Retirement/reuse decisions follow the active contract register and brownfield companion.

## Non-goals

- Preserving compiler-1, building compiler-2 coexistence, maintaining the Procedure Builder as the entry point, or retaining Node as a second domain authority.
- Autonomous issuance or a model impersonating an independent reviewer; chat overrides of mandatory methodology; approval ceremonies for ordinary Admin configuration or permitted draft edits.
- General unrestricted desktop agents, unsupported native applications, universal login automation or unqualified unattended Office operation.
- Launching every connector, voice/contact channel, proactive discovery feature or Windows profile before the first complete supported Linux/browser Task. The backlog distinguishes required support from qualified expansion.
- Copying Dots' internal architecture or treating screenshots, source studies or prototype interactions as runtime performance/security evidence.

## Success signal

An assigned auditor starts an engagement objective in conversation. Zobba binds the firm's method and required skills/knowledge, acquires permitted real material, uses its actual computer and isolated analysis, accepts corrections and survives a forced interruption. A second Task proceeds without stealing scope or control. The auditor privately signs in, verifies the account, inspects a supported exception and an explicit evidence limitation, then completes the permitted team or labelled solo review/issue path. The same reviewed method can subsequently produce a correctly scoped recurring draft with period deduplication and late-evidence handling.

The demonstration includes negative and recovery cases: cross-client denial, prompt injection, revocation during work, lost sign-in control, uncertain external effect, incomplete population, late correction and exact-version review invalidation. It measures response/control/readiness targets and actual usage; it does not claim customer qualification from a mock or a single successful happy path.

## Planning assumptions and remaining commercial gates

The budget uses a proposed region and explicit one-, five- and twenty-person workloads; rates and model consumption are estimates for qualification, not contracts. Before customer launch, the owner must select the supported applications/accounts/authentication and service promise, approve residency/processing/retention terms, and set prices/included usage/overage. Those choices gate customer commitments and affected qualification stories; they do not block recording the first engineering batch.
