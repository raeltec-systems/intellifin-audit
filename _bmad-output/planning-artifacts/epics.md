---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
status: final
workflow: bmad-create-epics-and-stories
accepted_design_revision: 3
implementation_status: not-started
inputDocuments:
  - _bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md
  - _bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - _bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - _bmad-output/specs/spec-IntelliFin Audit/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/CONTRACT-REGISTER.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md
---

# Zobba — Implementation backlog

## Overview

This is the sole active backlog for the owner-accepted design revision 3 and the consolidated PRD/SPEC/architecture/UX. It is a brownfield course correction: reuse selected assets, fixtures and engineering lessons; build the clean Rust authority and fresh schema; retire conflicting legacy paths after replacement proof. No application implementation is claimed.

Historical Epics 1–19 and their statuses are retired from this new build, not marked done. The exact old backlog is retained byte-for-byte in [the legacy archive](zobba-build-plan-2026-09-30/legacy/epics-before-rev3.md). New epic IDs start above the historical maximum. [Build sequence](zobba-build-plan-2026-09-30/BUILD-SEQUENCE.md), [first batch](zobba-build-plan-2026-09-30/FIRST-BATCH.md), [dependency graph](zobba-build-plan-2026-09-30/dependencies.json) and [coverage](zobba-build-plan-2026-09-30/coverage.json) derive from this file. Acceptance criteria live here, not in a competing stories file.

## Requirements Inventory

The linked input documents carry the full normative clauses. Every requirement below has one or more implementing/qualifying stories; linkage means planned coverage, not passed verification. FR-1–96, NFR-1–17 and CAP-1–16 remain retired.

### Functional Requirements and FR Coverage Map

| Requirement | Requirement title | Planned stories |
|---|---|---|
| FR-97 | Organisation, client and engagement scope | 20.1, 20.2, 20.6, 20.7, 25.4, 28.5 |
| FR-98 | Roles and membership | 20.2, 20.6 |
| FR-99 | Coordinating conversation and Task cards | 20.4, 22.2, 25.1, 25.4 |
| FR-100 | Continuing Task lifecycle | 20.3, 22.2, 25.4, 26.2, 26.6, 27.4, 27.7, 28.5 |
| FR-101 | Working brief and useful initiative | 20.4, 22.2, 25.1 |
| FR-102 | Durable guidance | 20.3, 20.4, 22.2, 25.2, 25.4, 27.5 |
| FR-103 | Scoped Pause and Stop | 20.3, 22.2, 22.7, 23.3, 25.4, 27.4 |
| FR-104 | Contextual questions and decisions | 20.3, 20.4, 22.2, 25.2 |
| FR-105 | Real managed computer and honest availability | 23.1, 23.2, 23.5, 23.6, 25.1, 25.4, 28.1 |
| FR-106 | Exclusive control and handback | 23.3 |
| FR-107 | Protected sign-in | 23.1, 23.4, 25.2, 25.4, 27.5, 28.1 |
| FR-108 | Supported application profiles | 23.1, 23.2, 23.5, 28.1, 28.2, 28.3, 28.6 |
| FR-109 | Standing Permissions and operating purposes | 20.5, 20.6, 23.6, 27.7, 28.5 |
| FR-110 | Concrete action decisions | 20.5, 23.6, 25.2 |
| FR-111 | Connections and service delegation | 20.6, 20.7, 21.5, 23.2, 23.4, 23.6, 26.5, 27.1, 27.2, 27.3, 27.6, 28.1, 28.6 |
| FR-112 | Admin methodology Save | 21.2, 22.6, 25.4 |
| FR-113 | Binding and change impact | 21.2, 22.6, 26.1 |
| FR-114 | Trusted installed skills | 21.3, 22.6, 25.4 |
| FR-115 | Scoped working knowledge | 21.4, 22.3, 22.6, 25.4, 27.7 |
| FR-116 | Context, retrieval and long-work continuity | 21.4, 22.3 |
| FR-117 | Models and provenance | 22.1, 28.6 |
| FR-118 | Tools, external effects and receipts | 20.5, 21.3, 21.5, 22.1, 23.3, 23.6, 27.1, 27.2, 27.3, 28.5 |
| FR-119 | Isolated analysis and files | 22.4, 22.5, 23.5, 28.2 |
| FR-120 | Bounded helpers | 27.4, 28.6 |
| FR-121 | Evidence identity and lineage | 21.1, 21.5, 21.6, 22.4, 22.5, 23.5, 25.4, 27.2, 27.3, 28.4, 28.5 |
| FR-122 | Population, sample and coverage | 24.1, 24.2, 25.4 |
| FR-123 | Criteria, assessment basis and typed facts | 22.5, 22.6, 24.1, 24.3 |
| FR-124 | Evaluation revisions and human disposition | 24.1, 24.3, 25.4, 26.3, 26.6 |
| FR-125 | Summaries and honest limitations | 24.2, 24.3, 24.4, 25.3, 25.4, 26.4, 26.6 |
| FR-126 | Evidence requests and arrival | 26.3, 26.6, 27.1, 27.2 |
| FR-127 | Work-product shelf and inspection | 24.4, 25.1, 25.3, 25.4, 28.2 |
| FR-128 | Edits and dependency changes | 24.6, 28.2 |
| FR-129 | Team review and approval | 24.5, 24.6, 25.4 |
| FR-130 | Honest solo use | 24.5, 25.4 |
| FR-131 | Issuance and corrections | 24.5, 24.6, 25.4, 28.4 |
| FR-132 | Reviewed recurring Check | 26.1, 26.6 |
| FR-133 | Logical occurrences and schedules | 26.2, 26.3, 26.5, 26.6 |
| FR-134 | Recurring-method maintenance and drift | 26.1, 26.5, 26.6 |
| FR-135 | Findings and follow-up | 24.3, 26.4, 26.6 |
| FR-136 | Useful notifications | 25.2, 25.3, 26.3, 26.4, 26.5, 26.6, 27.1, 27.2, 27.6 |
| FR-137 | Visible budgets and consumption | 20.7, 22.7, 23.5, 25.4, 26.2, 26.5, 26.6, 27.7, 28.3, 28.4, 28.6 |
| FR-138 | Authorised search and navigation | 21.1, 21.4, 21.6, 24.4, 25.1, 25.3 |
| FR-139 | Speech and later contact channels | 27.5, 27.6, 28.6 |
| FR-140 | Activity, return digest and explanation | 20.4, 20.7, 22.2, 22.6, 22.7, 23.2, 25.1, 25.3, 25.4, 27.4, 28.3, 28.4, 28.5, 28.6 |

### NonFunctional Requirements

| Requirement | Required quality | Planned proof stories |
|---|---|---|
| NFR-18 | Isolation | 20.2, 20.5, 20.6, 20.7, 21.1, 21.2, 21.4, 21.5, 21.6, 22.3, 22.4, 23.2, 23.4, 23.5, 24.5, 25.3, 25.4, 26.3, 26.5, 27.1, 27.2, 27.3, 27.4, 27.6, 27.7, 28.1, 28.4, 28.5, 28.6 |
| NFR-19 | Secret and instruction containment | 20.2, 20.5, 20.6, 20.7, 21.1, 21.3, 21.4, 21.5, 22.1, 22.3, 22.4, 22.5, 22.6, 23.1, 23.2, 23.3, 23.4, 23.6, 25.4, 26.5, 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 28.1, 28.2, 28.4, 28.6 |
| NFR-20 | Integrity | 20.1, 20.7, 21.1, 21.2, 21.3, 21.4, 22.3, 22.4, 22.5, 22.6, 23.5, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 25.2, 25.3, 25.4, 26.1, 26.3, 26.4, 26.6, 28.2, 28.4, 28.5, 28.6 |
| NFR-21 | Recovery and effect certainty | 20.3, 20.5, 20.7, 21.5, 22.1, 22.2, 22.4, 22.7, 23.2, 23.3, 23.4, 23.5, 23.6, 25.4, 26.2, 26.3, 26.5, 26.6, 27.1, 27.2, 27.3, 27.4, 27.6, 28.4, 28.5, 28.6 |
| NFR-22 | Responsive control | 20.3, 20.4, 22.2, 22.7, 23.3, 25.1, 25.2, 25.4, 27.5, 28.3, 28.6 |
| NFR-23 | Computer response targets | 23.1, 23.2, 23.3, 23.5, 25.4, 28.1, 28.3, 28.6 |
| NFR-24 | Bounded resources | 20.3, 20.4, 20.7, 21.6, 22.1, 22.2, 22.3, 22.4, 22.5, 22.7, 23.2, 23.5, 25.1, 25.3, 25.4, 26.2, 26.5, 27.4, 27.7, 28.3, 28.4, 28.6 |
| NFR-25 | Accessibility | 20.4, 21.6, 24.4, 24.6, 25.1, 25.2, 25.3, 25.4, 27.5, 28.6 |
| NFR-26 | Disclosure | 21.5, 22.1, 23.6, 25.4, 27.1, 27.2, 27.3, 27.5, 27.6, 28.6 |
| NFR-27 | Audit quality | 21.2, 22.5, 22.6, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 25.4, 26.1, 26.3, 26.4, 26.6, 28.2, 28.6 |
| NFR-28 | Scheduling and continuation | 26.1, 26.2, 26.3, 26.5, 26.6, 28.6 |
| NFR-29 | Data lifecycle | 20.7, 28.4, 28.6 |
| NFR-30 | Observability and cost | 20.1, 20.7, 22.7, 25.3, 25.4, 28.3, 28.4, 28.5, 28.6 |
| NFR-31 | Supported-profile qualification | 23.1, 23.4, 23.6, 25.4, 28.1, 28.2, 28.3, 28.6 |

### Additional Requirements

- AD-1/8/10/12/14 retain their invariant meaning; AD-35–49 establish the new architecture. One Rust backend with API/control and workers, PostgreSQL 18/SQLx, React/Vite, native OpenAI/Anthropic, S3/KMS, Cognito, EC2/Guacamole and separate credential-free Fargate analysis. No mandatory starter template or dual domain engine. Exact supported dependency pins belong in Story 20.1 lockfiles.
- Create schema only when the owning story first needs it. The sixteen named shared contracts are boundaries, not services or a demand for sixteen upfront documents. Each producer ships versioned executable examples and refusal/failure fixtures before dependent consumers.
- Respect current scope/disclosure, private observation and exact-effect boundaries from their first implementation. Preserve selected evidence registration, idempotency, revocation, fence, receipt and truthful-history behaviours; do not port compiler shapes or synthetic old history.
- Methodology, trusted skills and working knowledge precede substantive first-Task evaluation. Real computer/sign-in, isolated analysis, typed coverage and honest team/solo review are first-Task obligations. A later Check occurrence establishes the recurring baseline.
- Baseline safety/operability gates are Stories 20.2–20.5, 21.1/21.5, 22.3/22.7, 23.1–23.6 and 25.4; later operational qualification extends them. Actual customer app/region/licence/commercial choices constrain offered service, not the local first batch.

### UX Design Requirements

Use the active Pair DESIGN.md tokens/assets and EXPERIENCE.md behaviours. Reference screens are implementation guides, not runtime proof.

| Requirement | Contract | Planned stories |
|---|---|---|
| UX-DR42 | Coordinating conversation | 20.4, 22.2, 25.1, 25.4 |
| UX-DR43 | Persistent attention and return | 25.2, 25.3 |
| UX-DR44 | Inspection ownership | 24.4, 25.1, 25.3 |
| UX-DR45 | Private access and exact receipts | 23.3, 23.4, 25.2, 27.5 |
| UX-DR46 | Scoped control | 20.3, 23.3, 25.2, 26.2 |
| UX-DR47 | Method, skills and knowledge | 21.2, 21.3, 21.4, 22.6 |
| UX-DR48 | Honest review and recurrence | 24.5, 24.6, 26.1, 26.6 |
| UX-DR49 | Accessible continuing work | 20.4, 25.1, 25.2, 25.3, 25.4 |

## Delivery outcomes

### Epic 20: Open an engagement and keep accepted work safe

An authorised person can establish scope, continue a conversation and rely on accepted commands and explicit Permissions. This is a foundation, not the complete audit product.

### Epic 21: Use firm methods and trustworthy working material

Auditors can acquire attributable evidence and find the firm’s applicable methods and knowledge. Admin configuration remains an ordinary validated Save.

### Epic 22: Let Zobba investigate and analyse within the brief

A continuing Task can reason through native providers, use admitted techniques and analyse isolated material while remaining steerable and bounded.

### Epic 23: Watch, sign in and take over the real computer

A qualified Linux computer is visible and controllable through Zobba. Early vertical qualification establishes actual application and authentication feasibility before the complete-Task gate.

### Epic 24: Receive supported audit work and review it honestly

A Task produces evidence-linked typed assessments and editable work products whose coverage, review and issue state remain honest.

### Epic 25: Complete several pieces of audit work in one conversation

The integrated Pair workspace supports the full first Task and multiple simultaneous Tasks. Completion proves the first Task journey; recurring assurance and the remaining accepted input/connection scope have separate full-product gates.

### Epic 26: Continue assurance between visits

The same Task engine runs reviewed recurring methods under current authority, with exact periods, truthful evidence waits and continuing issue history.

### Epic 27: Work through firm connections and additional channels

Additional named connections, bounded helpers and speech use the same command and permission model. Calls, Slack/Teams and proactive discovery remain explicit later extensions.

### Epic 28: Rely on qualified customer profiles and a recoverable service

Named customer profiles and operational evidence establish the limits of supported promises. Baseline identity, budget, recovery and private-access controls already precede the first-Task gate.

Epic numbers preserve identity, not execution order. One deliberate cross-epic edge schedules helper Story 27.4 before 25.4; its prerequisites are all earlier work and the graph remains acyclic. This preserves assigned IDs while making actual descendant proof part of the first complete Task. Explicit story dependencies govern admission. Optional profile/channel work is labelled; qualification evidence is required for every offered profile.


## Epic 20: Open an engagement and keep accepted work safe

An authorised person can establish scope, continue a conversation and rely on accepted commands and explicit Permissions. This is a foundation, not the complete audit product.

### Story 20.1: Start the new application from one reproducible workspace

As an implementation maintainer,
I want a reproducible new application foundation,
So that subsequent work has one Rust backend and a reviewable development path.

**Requirements:** FR-97, CAP-17, CAP-30, NFR-20, NFR-30.

**Depends on:** None.

**Scope:** Create the minimal Rust/Axum/Tokio/SQLx workspace, React/Vite shell, OpenAPI client seam, PostgreSQL migration runner and CI smoke path. Create only bootstrap metadata; new application entrypoints are explicit.

**Non-goals:** No audit engine, production deployment, full schema, Node domain bridge or wholesale legacy deletion.

**Acceptance Criteria:**

1. **Given** a clean supported development environment, **when** documented bootstrap is run, **then** the Rust API, worker executable and Pair-labelled web shell build and health-check using pinned tools.

2. **Given** an unsupported or unmigrated database, **when** a process starts, **then** it refuses safely; migrations run only through the explicit migration command.

3. **Given** the repository retains old code, **when** new development and CI commands run, **then** they use the new entrypoints and no compiler-1 execution dependency.

4. **Given** an upstream utility is reused, **when** it enters the new workspace, **then** its exact source revision, license/notice and adapted tests are recorded.

**Validation:** Build/type/lint and dependency-boundary checks; migrate an empty throwaway PostgreSQL database; verify image/process health and failure against wrong schema.

### Story 20.2: Sign in to an explicitly scoped engagement

As an auditor,
I want sign-in and organisation/client/engagement isolation,
So that my account reaches only assigned work.

**Requirements:** FR-97, FR-98, CAP-17, NFR-18, NFR-19.

**Depends on:** 20.1.

**Scope:** Rust OIDC login/session and local test IdP; organisation, client, engagement, membership/role records, scoped SQLx transactions/RLS and a minimal engagement chooser.

**Non-goals:** No customer SSO qualification, invitations, connector tokens or bulk creation of future domain tables.

**Acceptance Criteria:**

1. **Given** a valid OIDC response with issuer/audience/state/nonce/PKCE checks, **when** login completes, **then** a secure server session is created and current application membership determines access.

2. **Given** two clients and pooled connections, **when** requests alternate or guess another client ID, **then** API, SQL/RLS and scope-bound joins refuse cross-scope reads/writes.

3. **Given** a signed-in principal is removed or demoted, **when** they next request work, **then** current authorisation denies access and invalid sessions terminate.

4. **Given** an Admin lacks engagement assignment, **when** they open client evidence or audit actions, **then** administrative identity grants no evidence access or audit sign-off.

**Validation:** OIDC conformance fixtures plus real PostgreSQL pooled-scope negative tests; browser login/logout/CSRF tests. Cognito connection is a live qualification check, never replaced by a production test-auth bypass.

### Story 20.3: Accept task commands once and recover them after restart

As an auditor,
I want durable Task and command receipts,
So that accepted objectives and controls survive process or tab loss.

**Requirements:** FR-100, FR-102, FR-103, FR-104, CAP-18, CAP-19, NFR-21, NFR-22, NFR-24, UX-DR46.

**Depends on:** 20.2.

**Scope:** Task/work-cycle/command/event/wakeup records; atomic admission, lease/epoch claims and deterministic command state transitions. Use a bounded inert activity executor for foundation tests. Record intent revision separately from owner/execution epoch; all resulting proposals bind the producing intent.

**Non-goals:** No model/tool dispatch, audit conclusions or browser automation.

**Acceptance Criteria:**

1. **Given** the same command key and payload arrive twice, **when** admission commits, **then** one command exists and both callers obtain the original receipt; changed meaning conflicts.

2. **Given** commit fails or a worker restarts, **when** delivery retries, **then** uncommitted work has no accepted acknowledgement and committed work reconstructs without duplicate transitions.

3. **Given** two workers or an expired owner compete, **when** they advance task state, **then** only the valid epoch commits and the stale owner cannot revive stopped work.

4. **Given** a task is busy or waiting, **when** Pause/Stop is accepted, **then** the control receipt names its scope, advances execution authority and remains distinct from executor quiescence.

5. **Given** the owner epoch is still valid but guidance has changed, **when** a contradictory old-intent proposal or unconsumed claim is considered, **then** it is rejected, rebased or revalidated before dispatch; an already consumed claim remains possibly dispatched and must reconcile.

**Validation:** Real PostgreSQL concurrency/rollback tests and crash injection at admission/claim/commit; a stalled inert child proves priority control admission without model access. Include same-owner/new-intent races and late receipt-only admission.

### Story 20.4: Keep one engagement conversation with attributed task cards

As an auditor,
I want a conversation that coordinates several Tasks,
So that I can return to accepted work and know what each message controls.

**Requirements:** FR-99, FR-101, FR-102, FR-104, FR-140, CAP-18, CAP-19, NFR-22, NFR-24, NFR-25, UX-DR42, UX-DR49.

**Depends on:** 20.3.

**Scope:** Conversation/message/task-link projections, explicit new-task/guide commands, Pair shell, task cards, narrow layout and resumable event cursor. Start with explicit target selection; model interpretation arrives in 22.2.

**Non-goals:** No fake agent answers, inference-based routing, real desktop or completed audit-work claim.

**Acceptance Criteria:**

1. **Given** an engagement has two Tasks, **when** I submit a new objective or selected-task guidance, **then** the message and binding commit together and cards retain the correct task/owner/scope.

2. **Given** the acknowledgement is lost, **when** the client reconnects using its key/cursor, **then** it recovers the original receipt and ordered durable history without duplicate cards.

3. **Given** I inspect another Task or resize to a narrow screen, **when** new events arrive, **then** the composer remains usable, current scope is visible and controls name their target.

4. **Given** a stream is slow or unavailable, **when** delivery exceeds bounds, **then** the client reports reconnecting and resynchronises from durable state rather than inventing progress.

**Validation:** Browser keyboard/focus/narrow-width checks; stream burst/reconnect/backpressure tests; two-client isolation and two-task attribution scenarios.

### Story 20.5: Apply standing Permissions to exact recorded operations

As an auditor,
I want clear standing Permissions and concrete decisions when needed,
So that routine work proceeds while external effects remain attributable.

**Requirements:** FR-109, FR-110, FR-118, CAP-19, CAP-20, NFR-18, NFR-19, NFR-21.

**Depends on:** 20.3.

**Scope:** Pure purpose/account/resource/action policy; policy/grant/delegation revisions; operation/attempt/one-use dispatch claim and result/reconciliation receipt; a fake external endpoint for fault tests.

**Non-goals:** No generic domain-wide allow, production source write, live connector catalog or exactly-once promise for remote systems.

**Acceptance Criteria:**

1. **Given** an operation is within current standing authority, **when** the trusted gateway consumes its bound claim, **then** it dispatches once through the gateway without a second user ceremony.

2. **Given** an action exceeds authority, **when** a person reviews it, **then** the decision binds exact account/destination/content/resource/purpose/expiry; a material edit invalidates it.

3. **Given** Stop or revocation races with dispatch, **when** the claim boundary is reached, **then** unconsumed claims are refused; possibly dispatched effects remain uncertain and reconcile without blind retry.

4. **Given** the external effect succeeds but acknowledgement is lost, **when** the worker recovers, **then** operation identity, attempts and observed outcomes remain separate and the endpoint is queried before resubmission.

**Validation:** Policy table tests for all three operating purposes; actual transaction/cutoff race tests; fault endpoint tests before/after effect/receipt; secret-free audit projections.

### Story 20.6: Administer membership without granting audit authority

As an auditor,
I want ordinary invitations and engagement assignments,
So that the right people can work and departed members lose current authority.

**Requirements:** FR-97, FR-98, FR-109, FR-111, CAP-17, CAP-20, NFR-18, NFR-19.

**Depends on:** 20.2, 20.5.

**Scope:** Admin users/roles/invitations, verified invitation acceptance, engagement assignment, last-Admin protection and session/control/delegation revocation hooks.

**Non-goals:** No fourth role, hidden evidence access for Admin, or automatic connector impersonation.

**Acceptance Criteria:**

1. **Given** an Admin invites or changes a role, **when** Save succeeds, **then** the change is attributable and invitation acceptance rechecks current authority and verified identity.

2. **Given** the last active Admin is targeted, **when** removal is attempted, **then** the product prevents an ownerless organisation.

3. **Given** membership or an assignment is removed, **when** dependent sessions/leases/grants are used, **then** new access and dispatch are refused while historical authorship stays intact.

4. **Given** one person holds several roles, **when** they open review/configuration, **then** capabilities stay explicit and Admin alone never supplies audit-review eligibility.

**Validation:** Invitation replay/expiry, concurrent last-Admin removal and fresh-authority tests; browser role/assignment flow and dependent-token revocation contract tests.

### Story 20.7: Deploy a recoverable qualification environment

As an operator,
I want a real shared substrate for qualification,
So that integrated audit and recovery proof runs on the accepted deployment boundary.

**Requirements:** FR-97, FR-111, FR-137, FR-140, CAP-17, CAP-19, CAP-20, CAP-30, NFR-18, NFR-19, NFR-20, NFR-21, NFR-24, NFR-29, NFR-30.

**Depends on:** 20.1, 20.5.

**Scope:** Versioned Terraform for an isolated two-zone AWS qualification environment: ECS/Fargate Rust API/control and workers, RDS PostgreSQL Multi-AZ with backups/PITR, private network and IAM boundaries, S3/KMS/Secrets, Cognito OIDC, release-only migrations and a documented restore/reconciliation runbook.

**Non-goals:** No customer production launch, broad service-level promise, fleet/application profile qualification or automatic recreation of possible external effects after restore.

**Acceptance Criteria:**

1. **Given** designated qualification accounts and a bounded cloud allowance exist, **when** the pinned infrastructure and release workflow run, **then** isolated API/control and worker deployments use the fresh scoped database, approved identity, secret custody and explicit migrations with no legacy worker authority.

2. **Given** the qualification database is restored to a separate environment, **when** the recovery runbook is exercised, **then** restored scope/receipts are verified and potential effects after the restored horizon are held for reconciliation before work is enabled.

3. **Given** a release fails or qualification capacity is no longer needed, **when** operators follow the bounded runbook, **then** rollback limits, retained evidence/backups, deletion boundaries and actual spend are visible without exposing secrets.

**Validation:** Terraform plan/policy and disposable apply/destroy evidence; actual Cognito login, release-only migration refusal at startup, backup/PITR restore and beyond-horizon effect fixture. Missing cloud permission/budget blocks this qualification story, not the local first batch.


## Epic 21: Use firm methods and trustworthy working material

Auditors can acquire attributable evidence and find the firm’s applicable methods and knowledge. Admin configuration remains an ordinary validated Save.

### Story 21.1: Acquire and inspect immutable scoped evidence

As an auditor,
I want evidence with a verified identity and source,
So that later claims can point to what was actually acquired.

**Requirements:** FR-121, FR-138, CAP-25, NFR-18, NFR-19, NFR-20.

**Depends on:** 20.2, 20.5.

**Scope:** Scoped evidence/object schema, reserve/upload/read-back/register, source metadata, safe download and bounded previews. Preserve useful legacy upload and integrity behaviours as contract fixtures.

**Non-goals:** No parser execution, arbitrary object access or successful registration before verification.

**Acceptance Criteria:**

1. **Given** an authorised upload or connector acquisition, **when** registration completes, **then** the server records measured digest, size, source, actor and immutable object identity after read-back verification.

2. **Given** another tenant or revoked member has an old object handle, **when** read or download is requested, **then** current scope denies access without exposing object existence.

3. **Given** an upload is partial, replaced or has a mismatched digest, **when** registration retries, **then** no trusted evidence record is published and replay cannot replace an immutable object.

**Validation:** Object-store contract tests plus real PostgreSQL scope tests; interrupted and substituted upload fixtures; safe content-disposition and preview limits.

### Story 21.2: Save and bind applicable firm methodology

As an auditor,
I want Admin to save firm methodology and assignments,
So that audit work starts with the firm’s chosen approach.

**Requirements:** FR-112, FR-113, CAP-23, NFR-18, NFR-20, NFR-27, UX-DR47.

**Depends on:** 20.6.

**Scope:** Versioned methodology, templates and applicability assignments; validated Save; explicit future-task versus active-task impact preview; deterministic binding to a Task.

**Non-goals:** No second configuration approver, click-script compiler or retroactive replacement of issued work.

**Acceptance Criteria:**

1. **Given** Admin edits a valid method, **when** Save succeeds, **then** a attributed immutable version and current assignment are recorded without another approval ceremony.

2. **Given** a Task begins under an assignment, **when** its method is resolved, **then** the bound version and applicable criteria/templates are recorded with an inspectable reason.

3. **Given** a saved edit could change active conclusions, **when** Admin chooses its activation scope, **then** existing bindings remain explicit and affected work receives impact information instead of silent mutation.

4. **Given** a package has inherited mandatory rules and business effective dates, **when** an override or Undo is saved, **then** required inherited constraints remain effective, Undo creates a successor, and business applicability is not replaced by save time.

**Validation:** Version and applicability fixtures; role-negative tests; active/new-task change matrix; browser Save and validation feedback.

### Story 21.3: Install and select trusted skills

As an auditor,
I want available techniques with known authority and inputs,
So that Zobba can use firm skills without treating arbitrary files as instructions.

**Requirements:** FR-114, FR-118, CAP-23, CAP-29, NFR-19, NFR-20, UX-DR47.

**Depends on:** 21.2.

**Scope:** Versioned installed-skill manifests, validated catalog, Admin enable/disable and method applicability; inspectable origin and declared tool needs.

**Non-goals:** No skill-provided permission escalation, arbitrary evidence-as-skill discovery or agent invocation yet.

**Acceptance Criteria:**

1. **Given** a vetted skill package is installed, **when** Admin enables its valid version, **then** catalog discovery returns its inputs, provenance and applicable methods.

2. **Given** a source document resembles an instruction package, **when** it is acquired, **then** it remains untrusted evidence and is never installed automatically.

3. **Given** a skill is disabled or its requested tool is forbidden, **when** discovery or admission runs, **then** the current catalog and policy prevent use despite an older task context.

**Validation:** Manifest validation, catalog revision/revocation and hostile-file fixtures; keep upstream license/revision provenance for reused skill code.

### Story 21.4: Remember scoped working knowledge with its basis

As an auditor,
I want useful engagement facts and decisions to persist,
So that I do not repeat context on every Task.

**Requirements:** FR-115, FR-116, FR-138, CAP-24, NFR-18, NFR-19, NFR-20, UX-DR47.

**Depends on:** 20.4, 21.1, 21.2.

**Scope:** Knowledge assertions, source-backed facts, user decisions, harmless preferences with undo, dependency links and scoped retrieval; explicit promotion across permitted scopes.

**Non-goals:** No memory-approval inbox, cross-client inference or unsupported assertions presented as evidence.

**Acceptance Criteria:**

1. **Given** a user decision or supported fact is recorded, **when** a later Task retrieves context, **then** its source, attribution, scope and status accompany the result.

2. **Given** a harmless preference is inferred, **when** it is saved, **then** the user can inspect and undo it without a new approval ceremony.

3. **Given** a source is corrected or permission is removed, **when** dependent knowledge is queried, **then** stale support is invalidated or re-evaluated and inaccessible material is excluded.

**Validation:** Two-client retrieval isolation, revocation and dependency invalidation fixtures; unsupported assertion and user-correction cases.

### Story 21.5: Acquire documents through a firm-owned connection

As an auditor,
I want a supported Microsoft document connection,
So that Zobba can read authorised working material without receiving credentials.

**Requirements:** FR-111, FR-118, FR-121, CAP-20, CAP-25, CAP-29, NFR-18, NFR-19, NFR-21, NFR-26.

**Depends on:** 20.5, 20.6, 21.1.

**Scope:** Credential broker and Microsoft Graph document acquisition with a real test tenant; account/resource/purpose grants, service delegation metadata, source identity and receipts.

**Non-goals:** No mail/calendar writes, arbitrary impersonation or granting every Task the connector’s full token scope.

**Acceptance Criteria:**

1. **Given** a valid delegated connection exists, **when** an allowed document is acquired, **then** the broker uses a short scoped handle and records exact account/resource and evidence lineage.

2. **Given** the owner leaves or consent expires, **when** a queued acquisition is admitted, **then** current delegation is checked; invalid consent blocks with a repair action instead of impersonating the owner.

3. **Given** the provider times out or returns duplicate results, **when** acquisition resumes, **then** receipts and source versions prevent unverified duplicate evidence and credentials never enter logs or context.

**Validation:** Graph sandbox qualification with recorded consent/account conditions plus deterministic expiry/retry fixtures; missing real credentials leave qualification explicitly blocked.

### Story 21.6: Find working material without losing provenance

As an auditor,
I want one scoped source library,
So that I can inspect the material behind audit work.

**Requirements:** FR-121, FR-138, CAP-24, CAP-25, NFR-18, NFR-24, NFR-25.

**Depends on:** 21.1, 21.4.

**Scope:** Scoped source search, evidence detail, provenance links, bounded previews and accessible open/download navigation.

**Non-goals:** No global search across inaccessible engagements or parser-dependent claims before extraction.

**Acceptance Criteria:**

1. **Given** multiple authorised sources match a query, **when** results render, **then** each shows source/version, scope and acquisition status with bounded pagination.

2. **Given** the user opens a result, **when** the evidence inspector appears, **then** source lineage and safe original download remain distinguishable from a preview.

3. **Given** access changes during navigation, **when** the next request occurs, **then** results and cached previews are invalidated and focus returns to a useful permitted surface.

**Validation:** Keyboard/narrow-layout checks; pagination/backpressure; revoked search and safe-preview tests.


## Epic 22: Let Zobba investigate and analyse within the brief

A continuing Task can reason through native providers, use admitted techniques and analyse isolated material while remaining steerable and bounded.

### Story 22.1: Route native models through a current tool catalog

As an auditor,
I want model and tool use with explicit provenance,
So that each Task can use qualified capabilities under current authority.

**Requirements:** FR-117, FR-118, CAP-20, CAP-29, NFR-19, NFR-21, NFR-24, NFR-26.

**Depends on:** 20.5, 21.2, 21.3.

**Scope:** Native OpenAI Responses and Anthropic Messages adapters, portable streamed events, provider profiles, canonical tool identities and exact catalog admission; deterministic provider fakes for faults.

**Non-goals:** No Codex subprocess authority, opaque provider-owned conversation state or unqualified silent fallback.

**Acceptance Criteria:**

1. **Given** a Task selects a qualified provider profile, **when** a model request runs, **then** model/version, disclosed input classes and tool-catalog revision are attributable to the invocation.

2. **Given** model output requests a tool, **when** admission runs, **then** the canonical tool/account/arguments are checked against current permissions before any operation is claimed.

3. **Given** streaming fails or the provider changes capabilities, **when** the call ends or retries, **then** partial output remains identifiable; retries do not blindly replay external effects and unsupported fallback is explicit.

**Validation:** Native adapter contract fixtures and live minimal smoke calls for both providers with cost ceilings; timeout, malformed call and hostile tool-result cases.

### Story 22.2: Continue a real Task under changing guidance

As an auditor,
I want Zobba to work from a persistent brief,
So that I can guide useful work without starting a new chat each time.

**Requirements:** FR-99, FR-100, FR-101, FR-102, FR-103, FR-104, FR-140, CAP-18, CAP-19, CAP-24, NFR-21, NFR-22, NFR-24, UX-DR42.

**Depends on:** 22.1, 21.4, 20.4.

**Scope:** Agent work-cycle loop, working-brief revisions, semantic message routing with ambiguity questions, task-local context, tool/result steps and accepted/applied guidance.

**Non-goals:** No global chat implicitly controlling every Task or model-owned durable state.

**Acceptance Criteria:**

1. **Given** a user starts audit work, **when** the first cycle runs, **then** the Task shows its objective, bound method, current work and an attributable next action.

2. **Given** guidance arrives while a provider or tool call is running, **when** it is accepted, **then** the receipt identifies target Tasks; application at a safe boundary is reported separately and superseded guidance remains inspectable.

3. **Given** routing is ambiguous or Pause/Stop arrives, **when** the independent control path handles it, **then** Zobba asks only the necessary targeting question or applies the named control without waiting for a stalled model.

4. **Given** the first objective needs a new engagement, **when** the authorised client and period are resolved, **then** Zobba establishes the scoped engagement/assignment before acquiring material without requiring a procedure or skill-selection wizard.

**Validation:** Two-Task routing and reconnect scenarios; stalled provider with responsive Pause/Stop; restart resumes from durable facts, not chat reconstruction.

### Story 22.3: Compact context without inventing authority or evidence

As an auditor,
I want long-running work to retain important context,
So that continuity survives model limits and access changes.

**Requirements:** FR-115, FR-116, CAP-24, NFR-18, NFR-19, NFR-20, NFR-24.

**Depends on:** 22.2, 21.4.

**Scope:** Context budgets, source-aware compaction, retrieval tiers and reconstruction from durable events; explicit omission and stale-support markers.

**Non-goals:** No summary replacing evidence, permanent hidden prompt authority or replaying private sign-in observations.

**Acceptance Criteria:**

1. **Given** a Task exceeds its context budget, **when** compaction runs, **then** the brief, unresolved decisions, source IDs and limitations remain attributable while raw history stays inspectable.

2. **Given** a compacted source is revoked or corrected, **when** context is rebuilt, **then** dependent excerpts and claims are removed or marked stale before disclosure.

3. **Given** untrusted material contains instructions, **when** retrieval includes it, **then** it is labelled data and cannot redefine permissions, system rules or tool admission.

**Validation:** Adversarial context fixtures, repeated compaction with support checks, scoped retrieval negative tests and bounded token accounting.

### Story 22.4: Run measured analysis in an isolated workspace

As an auditor,
I want Zobba to analyse files with real tools,
So that large or technical work can be checked without exposing credentials.

**Requirements:** FR-119, FR-121, CAP-22, CAP-25, NFR-18, NFR-19, NFR-20, NFR-21, NFR-24.

**Depends on:** 20.5, 21.1.

**Scope:** Fargate analysis job lifecycle, separate staging/result exchange, no analysis task role, immutable inputs, terminal receipts and validated output descendants.

**Non-goals:** No privileged sidecar sharing a trust boundary, broker secrets in containers, host shell or automatic trust in generated output.

**Acceptance Criteria:**

1. **Given** admitted analysis begins, **when** the sandbox executes, **then** only declared staged inputs and bounded compute are available; model-controlled programs receive no cloud credentials.

2. **Given** analysis finishes or is stopped, **when** outputs are collected, **then** the container is terminated and path/link/type/size constraints and measured hashes determine registrable descendants.

3. **Given** a job is lost or returns hostile paths, **when** recovery inspects it, **then** durable status distinguishes retryable computation from unknown external effects and rejects unsafe outputs.

**Validation:** Actual isolated job qualification; credential/metadata endpoint denial, symlink/hardlink/traversal and resource exhaustion fixtures; terminate/restart receipt reconciliation.

### Story 22.5: Extract usable facts with stable source locations

As an auditor,
I want documents and tables to be readable with citations,
So that analysis can explain where each observation came from.

**Requirements:** FR-119, FR-121, FR-123, CAP-22, CAP-25, CAP-26, NFR-19, NFR-20, NFR-24, NFR-27.

**Depends on:** 22.4.

**Scope:** PDF/image OCR and Office/email extraction in isolated jobs; tabular normalization, page/cell/message locators, full-result artifacts and bounded previews.

**Non-goals:** No macro execution, lossless arbitrary Office editing or confidence-free OCR claims.

**Acceptance Criteria:**

1. **Given** a supported source is parsed, **when** structured output is registered, **then** extractor version, input digest and stable locators accompany facts and full output remains separately accessible.

2. **Given** OCR or parsing is uncertain, **when** a value is offered for evaluation, **then** uncertainty and unavailable structure are explicit rather than silently converted into authoritative facts.

3. **Given** a hostile or oversized file is encountered, **when** processing reaches a limit, **then** the job fails safely with a useful limitation and no accepted fabricated output.

**Validation:** Representative PDF/scanned table/XLSX/DOCX/email fixtures plus malformed/zip-bomb boundaries and source-locator round trips.

### Story 22.6: Use methods and installed skills during investigation

As an auditor,
I want the applicable method to shape real work,
So that Zobba’s approach is firm-specific from the first complete Task.

**Requirements:** FR-112, FR-113, FR-114, FR-115, FR-123, FR-140, CAP-23, CAP-24, CAP-26, CAP-29, NFR-19, NFR-20, NFR-27, UX-DR47.

**Depends on:** 22.2, 22.5, 21.2, 21.3.

**Scope:** Method interpretation over supported evidence, skill selection/invocation, relevant knowledge retrieval and brief updates with method/model/tool provenance.

**Non-goals:** No compiled action graph, arbitrary document instructions promoted into skills or claiming a method step complete solely because a model said so.

**Acceptance Criteria:**

1. **Given** a Task has a method and enabled relevant skills, **when** investigation begins, **then** Zobba explains the applicable basis and records the specific method/skill versions it uses.

2. **Given** a method requires unavailable evidence or a prohibited action, **when** the agent reaches that step, **then** it records the gap or asks a contextual question while continuing independent permitted work.

3. **Given** Admin saves a new method version, **when** an active Task reaches an affected boundary, **then** its explicit binding and impact rule govern continuation; no silent rebinding changes prior conclusions.

4. **Given** Admin supplies a methodology document, **when** Zobba derives an editable proposal, **then** sources, interpretation conflicts and missing criteria remain visible; only Admin validated Save makes a version effective.

**Validation:** Method-specific AP fixture with at least one installed skill and retrieved knowledge; unsupported-step and active-change cases.

### Story 22.7: Keep work within budgets and responsive under contention

As an auditor,
I want bounded work with timely controls,
So that one expensive Task cannot consume the service or prevent me stopping it.

**Requirements:** FR-103, FR-137, FR-140, CAP-19, CAP-30, NFR-21, NFR-22, NFR-24, NFR-30.

**Depends on:** 22.2, 22.4.

**Scope:** Per-organisation/Task/provider/analysis admission, reservations and measured usage receipts; fair queues, bounded streams, cancellation and user-visible budget waits.

**Non-goals:** No silent unlimited retries, misleading progress counters or deferring baseline resource protection to launch testing.

**Acceptance Criteria:**

1. **Given** several tenants compete for limited capacity, **when** admission runs, **then** fair scoped limits and budget reservations prevent starvation and overspend beyond documented in-flight bounds.

2. **Given** a task is waiting on capacity or budget, **when** its card renders, **then** the reason and safe next options appear while Pause/Stop and guidance stay available.

3. **Given** a provider or analysis job ends, fails or loses its lease, **when** usage is settled, **then** actual/estimated cost and uncertainty are recorded once and leaked reservations reconcile.

**Validation:** Concurrent admission and usage-settlement fixtures; stalled provider/analysis/slow consumer control-latency tests; cancellation and reservation recovery proof.


## Epic 23: Watch, sign in and take over the real computer

A qualified Linux computer is visible and controllable through Zobba. Early vertical qualification establishes actual application and authentication feasibility before the complete-Task gate.

### Story 23.1: Prove the first real computer and sign-in profile

As an auditor,
I want a tested path to the first supported application,
So that the product does not depend on an assumed remote-desktop or authentication capability.

**Requirements:** FR-105, FR-107, FR-108, CAP-21, CAP-30, NFR-19, NFR-23, NFR-31.

**Depends on:** 20.1, 20.2, 20.5.

**Scope:** A bounded AWS Ubuntu 24.04/Chromium/VNC/guacd qualification harness through the Rust gateway and Guacamole browser client; named test app/account and authentication conditions.

**Non-goals:** No production fleet, universal app support, model-driven browsing or credential recording.

**Acceptance Criteria:**

1. **Given** a named supported-profile candidate and permitted test account exist, **when** qualification is run, **then** a real desktop renders through the intended gateway and the authorised tester can complete its sign-in flow.

2. **Given** MFA, SSO, bot restrictions or desktop licensing prevents use, **when** the attempt ends, **then** the exact unsupported condition and fallback boundary are recorded as a blocker rather than replaced by a fake screenshot.

3. **Given** the reference and degraded network profiles are exercised, **when** measurements are captured, **then** attach/input/frame behaviour, failure evidence and environment details are reproducible and clearly distinguished from acceptance targets.

**Validation:** Record actual cloud/app qualification and cost; use the design’s reference network. Credentials or entitlements unavailable means blocked qualification, not passed via mocks.

### Story 23.2: Attach to a scoped computer with honest lifecycle state

As an auditor,
I want a live computer attached to my Task,
So that I can see where work is happening.

**Requirements:** FR-105, FR-108, FR-111, FR-140, CAP-19, CAP-21, NFR-18, NFR-19, NFR-21, NFR-23, NFR-24.

**Depends on:** 23.1, 20.3.

**Scope:** Provision/attach/reconnect/stop state machine, scoped viewer sessions, Rust media gateway, profile identity and bounded incremental protocol forwarding.

**Non-goals:** No direct browser access to CDP, RDP, VNC credentials or host shell.

**Acceptance Criteria:**

1. **Given** a Task requests an allowed profile, **when** a computer is assigned, **then** its tenant/account/profile and lease are bound durably and viewers receive short scoped gateway access.

2. **Given** the desktop is starting, unavailable or reconnecting, **when** the UI renders, **then** the actual state and last-observed timestamp are clear without synthetic live progress.

3. **Given** a viewer is slow or loses access, **when** the stream changes, **then** bounded buffering and protocol-safe resynchronisation protect service health and revoked viewers receive no further frames.

**Validation:** Real gateway attach/reconnect and two-tenant viewer isolation; slow consumer and protocol resynchronisation tests; revoked-session denial.

### Story 23.3: Take over and hand back all computer input safely

As an auditor,
I want exclusive human control when I take over,
So that agent actions cannot race my input.

**Requirements:** FR-103, FR-106, FR-118, CAP-19, CAP-20, CAP-21, NFR-19, NFR-21, NFR-22, NFR-23, UX-DR45, UX-DR46.

**Depends on:** 23.2, 20.5.

**Scope:** One input authority covering pointer, keyboard, clipboard, file interactions and complete browser operations; epoch-fenced tool admissions, takeover barrier and handback acknowledgement.

**Non-goals:** No fencing only the final mouse click or claiming cooperative interruption preempts an already dispatched remote operation.

**Acceptance Criteria:**

1. **Given** the agent has queued browser or input operations, **when** Take over is accepted, **then** new admissions stop, prior possibilities are settled or exposed, held inputs release and human control begins only at the reported barrier.

2. **Given** a stale agent or viewer tries input, **when** its epoch is checked, **then** the entire operation is rejected without partial DOM, clipboard or navigation execution.

3. **Given** the human hands control back, **when** the new authority is granted, **then** Zobba re-observes the current page and confirms the new epoch before acting.

4. **Given** the human controller disconnects, **when** its input lease expires, **then** input is fenced and the agent does not gain control without an explicit handback and fresh observation.

**Validation:** Race tests spanning multi-step browser actions, key release, reconnection and queued input; measured cooperative takeover response under qualified conditions.

### Story 23.4: Sign in privately and verify the intended account

As an auditor,
I want private human authentication on the actual computer,
So that credentials and sensitive sign-in material stay out of agent observations.

**Requirements:** FR-107, FR-111, CAP-20, CAP-21, NFR-18, NFR-19, NFR-21, NFR-31, UX-DR45.

**Depends on:** 23.3, 20.6.

**Scope:** Private sign-in for account owner or authorised delegate; mask other viewers; suspend model observations, DOM/OCR/screenshots/recording/clipboard/voice capture and queued frames; explicit handback/account verification.

**Non-goals:** No arbitrary user impersonation, cookie-only account proof or forcing sign-in before unrelated work can continue.

**Acceptance Criteria:**

1. **Given** an application needs authentication, **when** an authorised person enters private sign-in, **then** all observation and capture paths stop before private input and other viewers see only the protected state.

2. **Given** the user selects Not now or leaves midway, **when** the Task resumes coordination, **then** authentication remains waiting and independent permitted work can continue without pretending the account is ready.

3. **Given** the user completes sign-in and hands back, **when** observation resumes, **then** queued private data is discarded and the expected account/tenant/role is verified before agent actions are admitted.

**Validation:** End-to-end capture inventory with canary secrets, queued-frame and concurrent-viewer tests; real named-account sign-in and mismatch cases.

### Story 23.5: Move files and recover a computer without fabricating continuity

As an auditor,
I want safe transfers and recoverable computer work,
So that desktop loss does not lose evidence or trigger blind replay.

**Requirements:** FR-105, FR-108, FR-119, FR-121, FR-137, CAP-21, CAP-22, CAP-25, CAP-30, NFR-18, NFR-20, NFR-21, NFR-23, NFR-24.

**Depends on:** 23.2, 23.4, 21.1, 22.7.

**Scope:** Scoped staged upload/download, immutable evidence registration, readiness/idle policy, restart/VM-loss recovery and unsaved-work handling.

**Non-goals:** No shared cross-tenant home directories, arbitrary host mounts or claiming unsaved desktop state survived VM loss.

**Acceptance Criteria:**

1. **Given** a permitted file crosses the computer boundary, **when** transfer completes, **then** source identity, scope and measured output are recorded before reuse as evidence.

2. **Given** a computer idles with unsaved work or loses its VM, **when** policy runs, **then** Zobba preserves what is durably known, reports unsaved loss honestly and requires reconciliation before repeating possible effects.

3. **Given** readiness policy retains or reuses capacity, **when** another Task attaches, **then** account/profile isolation and revoke/delete rules hold; actual readiness is measured against the accepted target.

**Validation:** Transfer tampering and cross-tenant tests; stopped-instance and VM-loss drills; bounded warm retention, unsaved-work and fresh-account cases.

### Story 23.6: Use the computer adaptively under the same Permissions

As an auditor,
I want Zobba to operate a qualified application,
So that real investigation can combine visual actions and APIs without changing authority.

**Requirements:** FR-105, FR-109, FR-110, FR-111, FR-118, CAP-20, CAP-21, CAP-29, NFR-19, NFR-21, NFR-26, NFR-31.

**Depends on:** 22.1, 23.3, 23.4, 23.5.

**Scope:** Admitted observe/browser/input tools and source-account verification; purpose-aware write policy; exact effect receipts; semantic recovery after layout change; qualified read-only account or narrow adapter restrictions.

**Non-goals:** No UI-coordinate scripts as the method, unrestricted write-capable account labelled read-only, or browser tools bypassing the broker.

**Acceptance Criteria:**

1. **Given** a qualified source-read-only account is available, **when** Zobba investigates visually, **then** permitted observations and acquisitions work while source mutations are denied by an effective boundary.

2. **Given** the Task is explicitly performing a control test or an authorised execution purpose, **when** a matching operation is requested, **then** standing Permissions admit the allowed write without a routine second ceremony and record its exact account/payload/receipt.

3. **Given** the page changes or the result of a click is uncertain, **when** the agent replans, **then** it re-observes semantically, reconciles potential effects and reports unsupported paths instead of blindly repeating clicks.

**Validation:** Real application read-only and authorised test-write scenarios in separate qualified accounts; mixed API/UI permission equivalence and uncertain-dispatch fixtures.


## Epic 24: Receive supported audit work and review it honestly

A Task produces evidence-linked typed assessments and editable work products whose coverage, review and issue state remain honest.

### Story 24.1: Bind typed criteria and facts to an assessment basis

As an auditor,
I want explicit criteria and inspectable facts,
So that an audit judgment has a stable and testable basis.

**Requirements:** FR-122, FR-123, FR-124, CAP-23, CAP-25, CAP-26, NFR-20, NFR-27.

**Depends on:** 21.2, 22.5, 22.6.

**Scope:** Criterion/version and assessment-basis records, typed values, supported source locations, applicability and missing-input states; deterministic evaluator interface separate from model judgment.

**Non-goals:** No floating-point money shortcuts, free-text verdict schema or treating execution failure as control failure.

**Acceptance Criteria:**

1. **Given** a method criterion is evaluated, **when** the assessment basis is created, **then** criterion version, period, population/sample references and source facts are pinned with typed units and source support.

2. **Given** required input is absent or analysis failed, **when** the criterion runs, **then** missing evidence, technical failure and observed exception are distinguishable and cannot manufacture a pass or fail.

3. **Given** a deterministic rule and a judgment criterion coexist, **when** each is executed, **then** the former has reproducible rule output and the latter records its model/human reasoning and uncertainty.

**Validation:** Typed date/currency/timezone/null fixtures; deterministic reproducibility; source support and applicability boundary checks.

### Story 24.2: Show exact population, sample and coverage denominators

As an auditor,
I want coverage that can be recomputed,
So that I can tell what was tested and what remains unknown.

**Requirements:** FR-122, FR-125, CAP-25, CAP-26, NFR-20, NFR-27.

**Depends on:** 24.1.

**Scope:** Immutable population and sample manifests, deduplication grain, inclusion/exclusion reasons, selection metadata and per-criterion coverage summaries.

**Non-goals:** No extrapolating unqualified samples or reporting no activity as successful control operation.

**Acceptance Criteria:**

1. **Given** the AP fixture has 1,250 unique records, **when** period and criterion applicability are applied, **then** 50 out-of-period and 200 at-or-below-threshold records leave 1,000 applicable records with separately inspectable exclusions.

2. **Given** two criteria find 15 and 12 failures with 7 overlapping records, **when** the summary is calculated, **then** it shows 20 distinct failing records, 27 failing criterion opportunities, 960 meeting both and 20 unknown; unknown coverage can coexist with known exceptions.

3. **Given** the period has zero applicable records or a non-exhaustive search, **when** coverage is summarised, **then** no activity and unproven absence remain explicit and neither becomes a control pass.

**Validation:** Exact set-arithmetic fixtures including duplicates, partial history, changed grain, zero population and sample limitations; generated summaries checked against manifests.

### Story 24.3: Revise evaluations without overwriting facts or exceptions

As an auditor,
I want traceable conclusions and human dispositions,
So that new evidence and corrections preserve what was known before.

**Requirements:** FR-123, FR-124, FR-125, FR-135, CAP-26, CAP-28, NFR-20, NFR-27.

**Depends on:** 24.2, 22.2.

**Scope:** Immutable evaluation revisions, deterministic/judgment provenance, finding links, limitations and attributed human override/disposition with rationale and evidence.

**Non-goals:** No deleting contrary evidence, conflating override with changed observation or closing an exception because a later run did not observe it.

**Acceptance Criteria:**

1. **Given** late evidence changes a criterion, **when** a new evaluation is produced, **then** it references its predecessor and changed basis while prior facts/verdicts remain inspectable.

2. **Given** an authorised auditor disagrees with an agent judgment, **when** a disposition is saved, **then** identity, rationale and exact evaluation version are recorded separately from the underlying observation.

3. **Given** some records fail and others remain unsupported, **when** the work is summarised, **then** known exceptions and overall inconclusive or limited coverage appear together with the correct denominators.

**Validation:** Override authority and immutable-history tests; same-period new-evidence revision; deterministic versus judgment review fixtures.

### Story 24.4: Create firm-shaped work products with supported claims

As an auditor,
I want editable working papers and exports,
So that useful audit output carries its evidence into review.

**Requirements:** FR-125, FR-127, FR-138, CAP-25, CAP-26, CAP-27, NFR-20, NFR-25, NFR-27, UX-DR44.

**Depends on:** 24.3, 21.2.

**Scope:** Structured documents/claim blocks, work-product shelf, bound firm templates and DOCX/XLSX/PDF exports; exact evaluation/evidence links and export version identity.

**Non-goals:** No arbitrary Office round-trip guarantee, uncited generated findings or screenshot-only working papers.

**Acceptance Criteria:**

1. **Given** a Task assembles a working paper, **when** a draft is published to the shelf, **then** claims link to exact supporting evaluations and evidence with coverage and limitations visible.

2. **Given** the user exports a supported format, **when** rendering completes, **then** the export identifies the source revision and retains usable citations and required template sections.

3. **Given** a supporting evaluation changes, **when** the draft is opened, **then** affected claims are marked for refresh rather than silently presenting an old conclusion as current.

**Validation:** Representative AP template exports inspected for pagination/formulas/citations; source links, accessible structured editor and export-version checks.

### Story 24.5: Review and issue the exact work honestly

As an auditor,
I want team review or clearly labelled solo review,
So that issued work accurately represents who checked it.

**Requirements:** FR-129, FR-130, FR-131, CAP-17, CAP-27, NFR-18, NFR-20, NFR-27, UX-DR48.

**Depends on:** 24.4, 20.6.

**Scope:** Review packages binding document/evaluation/method/evidence versions, contributor independence, return-for-changes, explicit solo attestation, issue snapshots and correction successors.

**Non-goals:** No Admin-only audit sign-off, self-review labelled independent, routine methodology Save approval or mutable issued reports.

**Acceptance Criteria:**

1. **Given** a team review package is submitted, **when** a reviewer accepts it, **then** current authority and contributor independence are checked against the exact bound versions.

2. **Given** an auditor works alone, **when** solo review and issue are completed, **then** the record explicitly says Self-reviewed with no independent review, requires the configured solo mode and necessary Auditor/Audit manager authority, and cannot relax a method requiring independence.

3. **Given** an accepted package changes or an issued error is corrected, **when** a new version is created, **then** review is invalidated for affected bindings and issue produces an immutable linked successor without rewriting the original.

4. **Given** a person accepts responsibility for agent-prepared content without editing it, **when** they seek independent review of that version or a materially inherited successor, **then** they count as a preparer and cannot independently review their own contribution.

**Validation:** Independent/team and honest-solo end-to-end cases; contributor changes, role revocation and export-hash binding; issued successor lineage.

### Story 24.6: Reconcile concurrent edits and stale review packages

As an auditor,
I want safe collaboration on live work products,
So that my edits and review decisions cannot silently overwrite another person’s work.

**Requirements:** FR-128, FR-129, FR-131, CAP-27, NFR-20, NFR-25, NFR-27, UX-DR48.

**Depends on:** 24.5.

**Scope:** Optimistic document revisions, claim-aware conflicts, change comparison, refresh operations and review invalidation propagated through dependent outputs.

**Non-goals:** No silent last-writer-wins, full generic Office coediting suite or approval of a moving target.

**Acceptance Criteria:**

1. **Given** two people edit the same base revision, **when** both save, **then** non-conflicting changes are preserved where supported and conflicting blocks require an explicit merge decision.

2. **Given** the agent refreshes supported claims while a human edits, **when** changes are compared, **then** human edits remain attributable and changed evidence cannot silently rewrite accepted prose.

3. **Given** a reviewer opens a stale package, **when** they try to accept or issue, **then** the operation is refused with a precise changed-version explanation and a new review package is required.

**Validation:** Concurrent save/refresh tests; keyboard-accessible change comparison with focus return; exact review bindings and stale issue race.


## Epic 25: Complete several pieces of audit work in one conversation

The integrated Pair workspace supports the full first Task and multiple simultaneous Tasks. Completion proves the first Task journey; recurring assurance and the remaining accepted input/connection scope have separate full-product gates.

### Story 25.1: Coordinate work through the Pair companion workspace

As an auditor,
I want one useful view of work, computer and results,
So that I can stay in the engagement conversation without losing orientation.

**Requirements:** FR-99, FR-101, FR-105, FR-127, FR-138, FR-140, CAP-18, CAP-21, CAP-27, NFR-22, NFR-24, NFR-25, UX-DR42, UX-DR44, UX-DR49.

**Depends on:** 20.4, 22.2, 23.4, 24.4.

**Scope:** Active work, Needs you, Computers, Work products and Permissions companion surfaces; Pin/Follow Zobba, selected Task inspector and actual privacy/readiness states.

**Non-goals:** No second competing task inbox, attention-stealing automatic navigation or decorative computer thumbnails presented as live.

**Acceptance Criteria:**

1. **Given** several Tasks are active, **when** Zobba changes its active surface, **then** Follow updates useful context while Pin preserves the user’s selected surface and composer focus.

2. **Given** a computer is private, stale or starting, **when** its companion tile renders, **then** the state and recency are clear and no protected or fake frame is shown.

3. **Given** the viewport narrows or the user navigates by keyboard, **when** companion content is opened and closed, **then** conversation, target labels, controls and focus return remain usable.

**Validation:** Pair design-token and accessibility checks at desktop/narrow sizes; real Task/computer projections and Pin/Follow interaction tests.

### Story 25.2: Answer durable questions where the work needs them

As an auditor,
I want persistent contextual decisions,
So that I can unblock one Task without losing the rest of the conversation.

**Requirements:** FR-102, FR-104, FR-107, FR-110, FR-136, CAP-18, CAP-19, CAP-20, CAP-21, NFR-20, NFR-22, NFR-25, UX-DR43, UX-DR45, UX-DR46, UX-DR49.

**Depends on:** 20.5, 22.2, 23.4, 25.1.

**Scope:** Durable question/answer records and Needs you projections for targeting, missing inputs, sign-in and exact action decisions; resume dependencies and multi-target summaries.

**Non-goals:** No generic permission popup for already permitted actions or accepting an answer against a stale question basis.

**Acceptance Criteria:**

1. **Given** a Task needs a decision, **when** the question is emitted, **then** it survives reconnect, names its Task and affected action/version and lets unrelated work continue.

2. **Given** a valid answer arrives twice, **when** the command is accepted, **then** one answer is recorded and only its current dependent work resumes.

3. **Given** the question basis has changed or the user declines for now, **when** the user responds, **then** the stale decision cannot authorise a new effect and the remaining wait or next options are explicit.

**Validation:** Reconnection and stale-answer races; exact action hash binding; accessible question-to-context focus and notification deduplication.

### Story 25.3: Return to a truthful digest and stable work shelf

As an auditor,
I want a clear account of what changed while I was away,
So that I can resume without rereading every event.

**Requirements:** FR-125, FR-127, FR-136, FR-138, FR-140, CAP-18, CAP-24, CAP-25, CAP-27, CAP-30, NFR-18, NFR-20, NFR-24, NFR-25, NFR-30, UX-DR43, UX-DR44, UX-DR49.

**Depends on:** 22.7, 24.6, 25.2.

**Scope:** Since last visit digest, stable shelf and How it ran views joining commands, methods, models, evidence, human-control intervals, costs and limitations; in-app notifications. Authorised search spans labelled engagements, Tasks, work products and sources as navigation, without combining client context.

**Non-goals:** No digest claiming unverified success or privileged log exposure.

**Acceptance Criteria:**

1. **Given** a user returns after several Tasks advanced, **when** the digest is shown, **then** accepted/applied guidance, completed work, unresolved needs and new work-product versions are distinguished.

2. **Given** the user inspects How it ran, **when** a step is expanded, **then** permitted provenance and receipts explain the method/model/tool/human basis without credentials or another client’s data.

3. **Given** events repeat or the user reconnects, **when** the shelf and notifications update, **then** stable identities prevent duplicate products/alerts and bounded pagination preserves responsive controls.

4. **Given** a search returns authorised work from several clients, **when** a result is opened, **then** its client and period remain labelled, current access is rechecked and no other client material enters the selected Task context.

**Validation:** Multi-Task absence/reconnect fixture; evidence and cost provenance checks; scoped redaction and keyboard navigation.

### Story 25.4: Qualify the first complete audit Task and concurrent work

As an auditor,
I want the whole promised audit journey to work together,
So that the foundation is tested as a useful product before expansion.

**Requirements:** FR-97, FR-99, FR-100, FR-102, FR-103, FR-105, FR-107, FR-112, FR-114, FR-115, FR-121, FR-122, FR-124, FR-125, FR-127, FR-129, FR-130, FR-131, FR-137, FR-140, CAP-17, CAP-18, CAP-19, CAP-20, CAP-21, CAP-22, CAP-23, CAP-24, CAP-25, CAP-26, CAP-27, CAP-29, CAP-30, NFR-18, NFR-19, NFR-20, NFR-21, NFR-22, NFR-23, NFR-24, NFR-25, NFR-26, NFR-27, NFR-30, NFR-31, UX-DR42, UX-DR49.

**Depends on:** 21.5, 21.6, 22.3, 22.6, 22.7, 23.6, 24.6, 25.3, 20.7, 27.4.

**Scope:** Integrated AP journey with Admin-saved method, trusted skill, working knowledge, real provider and firm document connection, actual computer/private sign-in, isolated analysis, typed coverage, draft, team and solo review; two concurrent Tasks and baseline restore/reconciliation.

**Non-goals:** No declaring a file-only flow, mocked sign-in, build success or this first-Task gate to be the complete accepted product.

**Acceptance Criteria:**

1. **Given** qualified test accounts and the AP fixture are available, **when** the full journey is exercised, **then** the record shows real method/skill/knowledge use, verified acquisitions, actual private computer use, exact exception/unknown coverage and both honest review modes.

2. **Given** another Task runs while guidance, Pause, Stop and takeover occur, **when** the user directs the named work, **then** targets and descendants are correct, the independent composer remains responsive and unrelated work continues.

3. **Given** workers or the VM fail and a supported backup is restored, **when** recovery drills run, **then** accepted commands and scoped evidence remain consistent, uncertain effects reconcile without blind replay and tenant-negative, revoked-access and budget controls still hold.

**Validation:** Publish an evidence-linked acceptance report with actual environment/provider/app versions, measured response results and failures. Real credentials, cloud capability or baseline restore gaps block this gate; mocks alone cannot pass it. Includes actual helper Stop propagation and the qualification environment from 20.7; 27.4 is scheduled before this gate despite its preserved numeric ID.


## Epic 26: Continue assurance between visits

The same Task engine runs reviewed recurring methods under current authority, with exact periods, truthful evidence waits and continuing issue history.

### Story 26.1: Promote useful work to a reviewed Check

As an auditor,
I want a recurring method derived from work we understand,
So that future occurrences repeat the audit intent without replaying clicks.

**Requirements:** FR-113, FR-132, FR-134, CAP-23, CAP-27, CAP-28, NFR-20, NFR-27, NFR-28, UX-DR48.

**Depends on:** 25.4, 24.5, 21.2.

**Scope:** Semantic Check definition, pinned criteria/method/templates and qualified routing set, method review/activation, activation boundaries and drift impact classification.

**Non-goals:** No compiler-1 graph, freezing authority with the method or a second approval for ordinary Admin configuration Save.

**Acceptance Criteria:**

1. **Given** a completed Task suggests repeatable assurance, **when** a Check draft is prepared, **then** the method states objective, population/period, criteria, required evidence, limits and qualified execution options with inspectable versions.

2. **Given** an authorised reviewer or permitted solo owner activates it, **when** review is recorded, **then** the exact semantic method is bound with truthful review mode and a prospective activation period.

3. **Given** an edit changes criteria, population or judgment materially, **when** the next occurrence is considered, **then** semantic version review and explicit rebinding are required; ordinary labels or due-time changes remain ordinary configuration edits.

**Validation:** Draft-to-activation team/solo fixtures; material-versus-operational change matrix and stale activation race.

### Story 26.2: Schedule one logical occurrence with bounded catch-up

As an auditor,
I want predictable period-based work,
So that retries and schedule edits do not duplicate an audit period.

**Requirements:** FR-100, FR-133, FR-137, CAP-19, CAP-28, CAP-30, NFR-21, NFR-24, NFR-28, UX-DR46.

**Depends on:** 26.1, 20.3, 22.7.

**Scope:** Occurrence identity unique on check_id plus logical_period_key; explicit UTC bounds/timezone; deadlines, one-active-occurrence default, overlap policy and explicit bounded backfill.

**Non-goals:** No schedule revision in dedup identity, unbounded missed-period storm or hiding incomplete periods.

**Acceptance Criteria:**

1. **Given** a due time changes or a scheduler retries, **when** the same logical period is admitted, **then** one occurrence identity remains and schedule revision is metadata rather than a new dedup key.

2. **Given** a material window definition changes, **when** activation is requested, **then** an explicit period mapping or superseding revision resolves overlap instead of silently creating a duplicate period.

3. **Given** an old occurrence waits past the next due deadline or several periods were missed, **when** scheduling resumes, **then** the defined incomplete-close/next-period rule applies; catch-up admits only the bounded eligible latest window and older periods require explicit backfill.

4. **Given** an event-only occurrence has no next due time or a user stops one occurrence, **when** the continuation deadline or control applies, **then** the event-only default expires after 24 hours; stopping an occurrence retains evidence and does not disable the separately editable schedule.

**Validation:** DST, leap dates, timezone edits, duplicate scheduling, long waits and bounded backfill fixtures against a real database.

### Story 26.3: Receive evidence without pretending the request is satisfied

As an auditor,
I want evidence requests tied to the work they support,
So that arrival triggers useful work while preserving completeness checks.

**Requirements:** FR-124, FR-126, FR-133, FR-136, CAP-25, CAP-26, CAP-28, NFR-18, NFR-20, NFR-21, NFR-27, NFR-28.

**Depends on:** 26.2, 21.1, 24.3, 25.2.

**Scope:** Request definitions, secure scoped submission/connector arrival, received/verified/request-satisfied states, matching criteria, notifications and same-period evaluation revisions.

**Non-goals:** No attachment receipt automatically closing an audit request or late evidence creating another logical occurrence.

**Acceptance Criteria:**

1. **Given** requested material arrives, **when** acquisition completes, **then** received is recorded separately from verified integrity/source and satisfaction of required scope/period/completeness.

2. **Given** a submission is partial or unrelated, **when** request matching runs, **then** the request stays open with a precise gap while independent assessment can use verified relevant parts.

3. **Given** verified late evidence belongs to a closed period, **when** evaluation resumes, **then** it creates a linked correction/evaluation revision within the existing occurrence and alerts affected reviewers.

**Validation:** Partial/duplicate/wrong-period and malicious submission fixtures; same-period late evidence and notification deduplication.

### Story 26.4: Keep findings and follow-up continuous across periods

As an auditor,
I want a stable issue history,
So that recurring observations do not multiply or erase unresolved exceptions.

**Requirements:** FR-125, FR-135, FR-136, CAP-26, CAP-28, NFR-20, NFR-27.

**Depends on:** 26.3, 24.3.

**Scope:** Finding identity and matching basis, period observations, owner/follow-up actions, closure evidence and reopen lineage; current authority for any external follow-up.

**Non-goals:** No heuristic silent merge, not-observed equals remediated or auto-sending messages without a permitted purpose/action.

**Acceptance Criteria:**

1. **Given** a known exception is observed next period, **when** matching is reliable, **then** the existing finding gains an attributable occurrence observation instead of an unrelated duplicate.

2. **Given** a later period lacks enough evidence or does not observe it, **when** the summary runs, **then** the original finding remains unresolved unless supported remediation and authorised disposition close it.

3. **Given** matching is ambiguous or a closed issue recurs, **when** follow-up is prepared, **then** the ambiguity or reopen relation is explicit and human changes retain their rationale.

**Validation:** Stable/ambiguous match fixtures, missing-period evidence, supported closure and recurrence; scoped notification/action admission.

### Story 26.5: Run unattended work only with current delegation

As an auditor,
I want Checks to continue safely between visits,
So that they use firm authority without depending on silent impersonation.

**Requirements:** FR-111, FR-133, FR-134, FR-136, FR-137, CAP-20, CAP-28, CAP-29, CAP-30, NFR-18, NFR-19, NFR-21, NFR-24, NFR-28.

**Depends on:** 26.2, 21.5, 20.6, 25.3.

**Scope:** Check service delegation, accountable owner/backup, current account consent and purpose grants, revocation/owner-departure handling, unattended budgets and notification routing.

**Non-goals:** No inheriting a departed owner’s identity, converting interactive MFA into service consent or auto-approving a new write purpose.

**Acceptance Criteria:**

1. **Given** a due Check has valid service delegation, **when** admission evaluates it, **then** current tenant/account/resource/purpose and budget checks apply independently of who originally created it.

2. **Given** the owner departs or consent expires, **when** the next or in-flight action reaches admission, **then** revoked authority blocks affected work with an accountable repair route; valid separate firm delegation is assessed explicitly.

3. **Given** unattended work needs a new interactive sign-in or exact action decision, **when** it reaches that boundary, **then** it waits with a durable Need and bounded deadline without impersonation or repeated notifications.

**Validation:** Owner departure with and without valid separate delegation, consent revocation, absent backup, quota wait and current grant tests.

### Story 26.6: Qualify a later occurrence and incomplete-period correction

As an auditor,
I want proof that assurance continues after the first Task,
So that recurring work is useful and honest under real delay and change.

**Requirements:** FR-100, FR-124, FR-125, FR-126, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, CAP-19, CAP-25, CAP-26, CAP-28, CAP-30, NFR-20, NFR-21, NFR-27, NFR-28, UX-DR48.

**Depends on:** 26.4, 26.5.

**Scope:** Integrated second-period Check acceptance over the first AP journey, overlap/deadline, incomplete evidence, late correction, method drift and continuing findings.

**Non-goals:** No calling schedule-row creation or a duplicate first-period replay a complete recurring product.

**Acceptance Criteria:**

1. **Given** the first complete Task has passed and its method is activated, **when** a later logical period becomes due, **then** one new occurrence runs under current authority with pinned semantic method and its own evidence/coverage.

2. **Given** required evidence arrives late and an exception remains, **when** the period closes and later re-evaluates, **then** the incomplete limitation and known finding coexist; late evidence adds an exact-version correction without duplicating the occurrence or issued output.

3. **Given** schedule and method changes race with retries, **when** the acceptance drill runs, **then** period identity, activation boundaries, review invalidation and effect receipts remain correct.

**Validation:** Evidence-linked full baseline acceptance report, including next-period real acquisition and deterministic deadline/DST/drift fault fixtures. This adds recurring proof to the first-Task gate; it does not waive remaining launch qualification.


## Epic 27: Work through firm connections and additional channels

Additional named connections, bounded helpers and speech use the same command and permission model. Calls, Slack/Teams and proactive discovery remain explicit later extensions.

### Story 27.1: Coordinate through Microsoft mail and calendar

As an auditor,
I want authorised Microsoft communication tools,
So that evidence requests and follow-up can use the firm’s actual account.

**Requirements:** FR-111, FR-118, FR-126, FR-136, CAP-20, CAP-25, CAP-29, NFR-18, NFR-19, NFR-21, NFR-26.

**Depends on:** 21.5, 26.3.

**Scope:** Graph mail/calendar read and explicit send/create/update operations, recipient/payload admission and provider-specific reconciliation; connection settings extend the document broker.

**Non-goals:** No implied send authority from read consent, tenant-wide mailbox discovery or conversation mirroring.

**Acceptance Criteria:**

1. **Given** a scoped mail/calendar connection is permitted, **when** an admitted read runs, **then** source account, message/event identity and disclosure are attributable.

2. **Given** a send or event mutation is permitted, **when** dispatch occurs, **then** the exact recipients, content and purpose bind the one-use claim and provider receipt.

3. **Given** the provider outcome is uncertain, **when** recovery runs, **then** provider-specific lookup reconciles before resend and unresolved uncertainty remains visible.

**Validation:** Real Graph test-tenant read/send/calendar qualification plus recipient change, token expiry and uncertain-send fixtures.

### Story 27.2: Use Google documents, mail and calendar through qualified accounts

As an auditor,
I want equivalent Google working tools,
So that our permitted account can support the same audit journey.

**Requirements:** FR-111, FR-118, FR-121, FR-126, FR-136, CAP-20, CAP-25, CAP-29, NFR-18, NFR-19, NFR-21, NFR-26.

**Depends on:** 21.5, 27.1.

**Scope:** Google Drive acquisition and Gmail/Calendar tool adapters on the existing broker; granular scopes, resource restrictions and endpoint-specific effect contracts.

**Non-goals:** No unverified equivalence between Google and Microsoft endpoints or broader authority from a consent screen.

**Acceptance Criteria:**

1. **Given** a Google connection is installed, **when** Drive/mail/calendar operations are discovered, **then** only qualified scopes and canonical account/resource actions enter the current catalog.

2. **Given** a supported document is acquired or permitted message/event sent, **when** the operation completes, **then** evidence lineage or exact-effect receipt matches the actual Google source.

3. **Given** consent is revoked or mutation response is lost, **when** recovery runs, **then** the broker denies new admission and uses the endpoint’s tested reconciliation rule.

**Validation:** Real named Google tenant qualification for each offered endpoint; unsupported scopes displayed explicitly; shared cross-provider authority contract suite.

### Story 27.3: Use GitHub and task-system tools with exact repository scope

As an auditor,
I want supported engineering and task-system connections,
So that relevant evidence and follow-up can include these systems.

**Requirements:** FR-111, FR-118, FR-121, CAP-20, CAP-25, CAP-29, NFR-18, NFR-19, NFR-21, NFR-26.

**Depends on:** 22.1, 21.5.

**Scope:** GitHub App installation/repository scoping and Todoist or specifically vetted MCP task tools; manifest/payload schemas, exact accounts and admitted effects.

**Non-goals:** No arbitrary MCP server installation, model-selected unreviewed tool names or repository permission escalation.

**Acceptance Criteria:**

1. **Given** an authorised installation or vetted task adapter is enabled, **when** tools are discovered, **then** the catalog exposes only qualified account/repository/project scopes with revisioned canonical identities.

2. **Given** Zobba reads evidence or performs a permitted mutation, **when** the action runs, **then** its source/effect receipt and exact payload follow the common admission rules.

3. **Given** a server changes its tool schema or an installation loses access, **when** the next action is attempted, **then** stale catalog authority is rejected and requalification or reconnection is explicit.

**Validation:** Real sandbox GitHub App and named task adapter qualification; schema drift, revoked installation and uncertain mutation contract fixtures.

### Story 27.4: Delegate bounded subtasks to helpers

As an auditor,
I want focused assistance within the Task,
So that parallel analysis stays attributable and under my controls.

**Requirements:** FR-100, FR-103, FR-120, FR-140, CAP-19, CAP-24, CAP-29, CAP-30, NFR-18, NFR-19, NFR-21, NFR-24.

**Depends on:** 22.3, 22.7, 24.3.

**Scope:** Parent/child work records, bounded helper budgets, inherited narrower authority, result review/merge and descendant cancellation; helpers use the same tool broker.

**Non-goals:** No independent hidden engagement, helper self-escalation or accepting a child answer as supported evidence without its basis.

**Acceptance Criteria:**

1. **Given** a parent delegates a bounded subproblem, **when** the helper is admitted, **then** its objective, scope, authority ceiling and cost reservation are recorded beneath the parent.

2. **Given** the helper returns, **when** the parent uses its result, **then** source support, limitations and provenance are inspectable and conflicting conclusions require reconciliation.

3. **Given** the parent is stopped or loses permission, **when** descendant work advances, **then** current fencing cancels or denies the helper consistently and possible external effects reconcile.

**Validation:** Concurrent helpers with different scopes, parent Stop races, duplicate completion and cost settlement; unsupported/conflicting result tests.

### Story 27.5: Speak into the same conversation safely

As an auditor,
I want speech as an ordinary input option,
So that I can guide work hands-free without creating a second command system.

**Requirements:** FR-102, FR-107, FR-139, CAP-18, CAP-21, CAP-29, NFR-19, NFR-22, NFR-25, NFR-26, UX-DR45.

**Depends on:** 25.2, 23.4.

**Scope:** Explicit microphone capture, transcript preview/edit/submit, attribution and the existing command route; capture status and accessible typed alternative.

**Non-goals:** No always-listening capture, voice biometric authority or speech capture during private sign-in.

**Acceptance Criteria:**

1. **Given** the user starts speech input, **when** transcription is ready, **then** the visible editable text goes through the same explicit Task targeting and durable command receipt as typed input.

2. **Given** private sign-in begins or permission to capture is withdrawn, **when** capture is active, **then** microphone and pending sensitive audio/transcripts stop and are discarded according to the privacy contract.

3. **Given** transcription fails or the device is unavailable, **when** the user continues, **then** the typed composer remains usable and no guessed command is dispatched.

4. **Given** a clear spoken Stop names a Task or a consequential transcript is ambiguous, **when** speech is admitted, **then** Stop uses the independent control path while consequential ambiguity is resolved before the dependent action.

**Validation:** Real microphone/transcription browser qualification, keyboard alternatives, permission denial and private-sign-in capture canary. Required for complete accepted input scope, though not the first-Task demo prerequisite.

### Story 27.6: Add later contact channels without widening authority

As an auditor,
I want selected future channels to carry scoped work,
So that communication remains deliberate and attributable.

**Requirements:** FR-111, FR-136, FR-139, CAP-18, CAP-20, CAP-29, NFR-18, NFR-19, NFR-21, NFR-26.

**Depends on:** 27.1, 27.5, 26.5.

**Scope:** Later calls and Slack/Teams adapters with explicit audience/channel binding, consent/capture indicators and conversion to the existing command/notification model.

**Non-goals:** No first-baseline dependency, default transcript mirroring, outbound contact without an admitted action or channel membership replacing engagement authority.

**Acceptance Criteria:**

1. **Given** a later channel is explicitly enabled and qualified, **when** a message or call event arrives, **then** account, audience and authorised engagement association are verified before it can become a command.

2. **Given** an outbound contact is proposed, **when** admission runs, **then** current recipient/content/purpose constraints and exact-effect receipt apply.

3. **Given** a channel participant lacks audit scope or capture is private, **when** content would be forwarded, **then** disclosure is denied and no protected transcript or sign-in material is mirrored.

**Validation:** Provider sandbox audience/consent/replay and uncertain-send tests; explicit extension qualification report.

### Story 27.7: Offer opt-in proactive suggestions without beginning unauthorised work

As an auditor,
I want useful suggestions from permitted sources,
So that I can choose relevant work without granting background execution authority.

**Requirements:** FR-100, FR-109, FR-115, FR-137, CAP-18, CAP-20, CAP-24, CAP-30, NFR-18, NFR-19, NFR-24.

**Depends on:** 22.3, 22.7, 26.5.

**Scope:** Later opt-in discovery within a declared read-only source/scope/budget; attributable suggestions and explicit user acceptance into Tasks.

**Non-goals:** No first-baseline dependency, autonomous computer use, external writes or new recurring methods activated from a suggestion.

**Acceptance Criteria:**

1. **Given** an authorised user opts into a bounded discovery scope, **when** a discovery cycle runs, **then** only permitted reads occur and suggestions cite their basis and cost.

2. **Given** a useful suggestion is accepted, **when** the command is submitted, **then** a normal Task with current method/permissions is created and provenance remains linked.

3. **Given** the opt-in is revoked or budgets end, **when** the next boundary is reached, **then** discovery stops and cannot continue through a helper or computer route.

**Validation:** Read-only authority, revocation, budget and duplicate suggestion fixtures; clearly labelled later-extension acceptance.


## Epic 28: Rely on qualified customer profiles and a recoverable service

Named customer profiles and operational evidence establish the limits of supported promises. Baseline identity, budget, recovery and private-access controls already precede the first-Task gate.

### Story 28.1: Qualify a named Windows and private-network profile

As an auditor,
I want supported access to applications that need Windows or a private network,
So that the product can state which customer environments actually work.

**Requirements:** FR-105, FR-107, FR-108, FR-111, CAP-20, CAP-21, CAP-30, NFR-18, NFR-19, NFR-23, NFR-31.

**Depends on:** 23.6, 26.5.

**Scope:** Per-organisation Windows profile enrollment, identity/domain requirements and licences; approved private connectivity, DNS/egress boundaries and isolated desktop lifecycle.

**Non-goals:** No generic Windows promise, shared cross-tenant domain identity or credentialed access before customer/network qualification.

**Acceptance Criteria:**

1. **Given** a customer has the required licences and network approvals, **when** a named profile is enrolled, **then** the actual Windows/identity/network combination and allowed account roles are recorded.

2. **Given** the intended application signs in and reconnects, **when** the full private-access flow is exercised, **then** viewer isolation, input fencing, protected authentication and source restrictions hold as they do for Linux.

3. **Given** licensing, connectivity or authentication is unsupported, **when** qualification ends, **then** the profile remains unavailable with its exact limitation rather than being offered as generally ready.

**Validation:** Actual named Windows/domain/private-route test with cold/stopped/reconnect measurements and account revocation; owner-supplied entitlements are explicit external prerequisites.

### Story 28.2: Qualify Office operations and their unattended limits

As an auditor,
I want honest support for native Office work,
So that I know which edits and unattended operations are permitted.

**Requirements:** FR-108, FR-119, FR-127, FR-128, CAP-21, CAP-22, CAP-27, CAP-30, NFR-19, NFR-20, NFR-27, NFR-31.

**Depends on:** 28.1, 24.6.

**Scope:** Named native Office profile qualification, supported template/export/import interactions and separation of interactive desktop use from vendor-supported unattended operations.

**Non-goals:** No universal lossless Office coediting, assuming desktop licences allow unattended automation or unsupported server-side COM guarantees.

**Acceptance Criteria:**

1. **Given** the licensed Office profile is available, **when** supported document operations run, **then** the qualification records application/version/licence, interaction mode and resulting evidence/export integrity.

2. **Given** a requested unattended operation is outside vendor support or licence, **when** admission checks its profile, **then** Zobba reports the supported alternative or blocks it instead of relying on interactive credentials.

3. **Given** a document contains macros or external links, **when** it is opened for work, **then** the qualified isolation and content policy applies and unsupported content cannot escape the boundary.

**Validation:** Actual named DOCX/XLSX/PDF workflows plus macro/external-link cases; compare exported claim/citation integrity and interactive versus unattended limitations.

### Story 28.3: Measure readiness and capacity before promising a service level

As an auditor,
I want qualified response and cost limits,
So that the offered service matches observed conditions.

**Requirements:** FR-108, FR-137, FR-140, CAP-21, CAP-30, NFR-22, NFR-23, NFR-24, NFR-30, NFR-31.

**Depends on:** 25.4, 26.6, 27.5.

**Scope:** Launch load and slow-network qualification, warm-capacity policy, media/control metrics, per-profile readiness and measured cost calibration against the operating budget.

**Non-goals:** No converting design targets into measured SLAs, unlimited warm desktops or deferring basic budget enforcement from 22.7.

**Acceptance Criteria:**

1. **Given** the reference network and declared concurrency are applied, **when** qualification runs, **then** p95 attach/input/takeover/readiness results and active-frame rates are compared with the accepted targets using reproducible evidence.

2. **Given** degraded links and slow consumers are introduced, **when** load continues, **then** control paths stay bounded and desktop protocol resynchronises safely rather than dropping arbitrary incremental updates.

3. **Given** observed cloud/provider costs are reconciled, **when** capacity settings are reviewed, **then** warm retention and admission limits match an explicit operating envelope and remaining commercial commitments are recorded separately.

**Validation:** Reference RTT≤80ms/loss≤1%/10-down-2-up Mbps and design degraded profiles; accepted targets include attach≤2s, input≤200ms and cooperative takeover≤1s. Report actual sample sizes and failures, not a pass by assertion.

### Story 28.4: Enforce retention, deletion and durable operational recovery

As an auditor,
I want data handling and recovery that can be explained,
So that the service preserves required records and removes what it no longer may retain.

**Requirements:** FR-121, FR-131, FR-137, FR-140, CAP-25, CAP-27, CAP-30, NFR-18, NFR-19, NFR-20, NFR-21, NFR-24, NFR-29, NFR-30.

**Depends on:** 25.4, 26.6, 20.1.

**Scope:** Retention policies, deletion/hold precedence, scoped object and log lifecycle, backup/restore drills, release-only migrations and incident observability; expand baseline recovery proof to the supported deployment envelope.

**Non-goals:** No deleting held issued evidence, secret-rich logs or treating backup creation as proof of restorability.

**Acceptance Criteria:**

1. **Given** retention expires or deletion is authorised, **when** lifecycle work runs, **then** dependent objects and indexes are handled consistently, holds take precedence and a scoped disposition record remains.

2. **Given** a supported backup is restored into an isolated environment, **when** verification runs, **then** scope, evidence hashes, issued snapshots and operation reconciliation remain correct before resuming work.

3. **Given** a release or incident occurs, **when** operators use the runbook, **then** migrations are explicit, telemetry is tenant-safe, stuck work/effect uncertainty is diagnosable and rollback limits are honest.

**Validation:** Deletion/hold dependency fixtures, isolated restore and release rollback drill, log/trace secret scan and alert-to-reconciliation exercises.

### Story 28.5: Cut over to the new product and retire conflicting legacy paths

As an auditor,
I want one active application and one authority model,
So that the clean implementation is not undermined by compatibility engines.

**Requirements:** FR-97, FR-100, FR-109, FR-118, FR-121, FR-140, CAP-17, CAP-19, CAP-20, CAP-25, CAP-30, NFR-18, NFR-20, NFR-21, NFR-30.

**Depends on:** 25.4, 26.6, 28.4.

**Scope:** Brownfield disposition ledger, selected fixture/code provenance, deployment/entrypoint cutover and removal or archive of compiler-1/Builder/Node runtime/schema surfaces after replacement proof.

**Non-goals:** No blanket deletion before proof, copying legacy authority/schema constraints into Rust or marking historical backlog delivered by supersession.

**Acceptance Criteria:**

1. **Given** a legacy behaviour is considered for retirement, **when** the ledger is reviewed, **then** its keep/adapt/rebuild/remove decision and replacement contract or explicit retirement are recorded with test/source provenance.

2. **Given** the new deployment is selected, **when** cutover checks run, **then** only the new Rust authority and fresh schema serve active product routes; conflicting legacy workers/schedulers cannot accept new work.

3. **Given** historical evidence and planning remain in the repository, **when** obsolete runtime paths are removed or archived, **then** history stays attributable, IDs stay retired and neither old sprint statuses nor old contracts become active accidentally.

**Validation:** Entrypoint/dependency/deployment scan, preserved integrity/revocation/fence/receipt regression contracts and isolated cutover rehearsal. Production data transfer, if later required, needs its own explicit scoped migration design.

### Story 28.6: Declare supported launch scope from completed qualification

As an auditor,
I want a clear release decision based on evidence,
So that customers receive the exact product and profiles we have qualified.

**Requirements:** FR-108, FR-111, FR-117, FR-120, FR-137, FR-139, FR-140, CAP-21, CAP-29, CAP-30, NFR-18, NFR-19, NFR-20, NFR-21, NFR-22, NFR-23, NFR-24, NFR-25, NFR-26, NFR-27, NFR-28, NFR-29, NFR-30, NFR-31.

**Depends on:** 26.6, 27.1, 27.2, 27.3, 27.4, 27.5, 28.3, 28.4, 28.5.

**Scope:** Release-readiness evidence index covering full baseline, accepted speech/helpers/connectors, retention/recovery and named supported profiles; commercial/app/region/licensing gates are explicit.

**Non-goals:** No treating planning PASS, finished foundation stories or a Linux profile as qualification for every customer and region.

**Acceptance Criteria:**

1. **Given** all declared release capabilities have implementation evidence, **when** readiness is assembled, **then** the index links passing qualification, known limits and exact supported account/app/region combinations.

2. **Given** a commercial, licence or customer authentication commitment is unresolved, **when** launch is considered, **then** that offered scope remains blocked without preventing unrelated local implementation work.

3. **Given** a Windows/Office profile is included in the offer, **when** release scope is approved, **then** 28.1 and 28.2 qualification are additionally required; later channels/proactive discovery remain separately opt-in extensions.

**Validation:** Independent evidence review against PRD/SPEC and operating budget; verify no unimplemented accepted capability or unqualified named profile is advertised as complete.
