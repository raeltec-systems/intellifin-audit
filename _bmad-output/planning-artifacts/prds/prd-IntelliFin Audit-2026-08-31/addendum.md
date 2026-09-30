---
title: "Zobba product contract — disposition and downstream detail"
status: final
revision: 6
created: 2026-08-31
updated: 2026-09-30
baseline: "Owner-accepted Zobba product and architecture design, revision 3"
supersedes: "Product detail addendum revision 5 as an active new-build contract"
---

# Zobba product contract addendum

## 0. Authority, history and downstream use

This addendum supports [PRD revision 5](prd.md), the course correction of the existing product toward the owner's accepted design revision 3. It does not reopen discovery or erase prior work. All previously allocated FR/NFR identifiers retain their historical meanings. Their retirement means they no longer govern the new implementation independently of the reconciled requirements; past records and completed-story evidence remain historical facts.

The [archived PRD revision 4 and addendum revision 5](archive/pre-revision-3-2026-09-30/README.md) preserve every prior requirement, Template table, golden dataset, Gate rule, state model and owner decision byte-for-byte. The archive manifest gives original hashes. Existing `review-*.md` and `reconcile-*.md` files in this folder predate this consolidation and are historical reviews unless explicitly marked revision 5; they do not verify the new build.

The active product contract is `prd.md` plus this addendum. The [accepted integrated design](../../zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md) supplies detailed mechanism semantics. The [architecture spine](../../architecture/architecture-IntelliFin%20Audit-2026-09-01/ARCHITECTURE-SPINE.md), [Pair design](../../ux-designs/ux-Zobba-2026-09-25/DESIGN.md), [experience](../../ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md), [SPEC](../../../specs/spec-IntelliFin%20Audit/SPEC.md) and [epics](../../epics.md) must explicitly adopt that same baseline. Historical companion text is not a second active contract. This update defines requirements; production qualification and implementation remain pending.

## 1. Requirement disposition

New active identifiers are **FR-97–FR-140 and NFR-18–NFR-31**. No old ID is renamed or reassigned. The following maps preservation by meaning, not old table/service ownership. An old automated check may be ported after its expectation is reconciled; passing the old suite is not proof of the new behavior.

| Retired FR IDs | Behavior preserved in the new contract | Removed constraint or changed ownership |
|---|---|---|
| FR-1–FR-3 | FR-97–FR-98 authentication, roles and scope; FR-109–FR-111 current authority/source protection. | Universal read-only operation becomes purpose-specific protection: live inspection, verified synthetic test workflows and audit coordination. |
| FR-4–FR-12 | FR-101 brief; FR-121–FR-125 source/criteria/evidence/evaluation; FR-132–FR-134 repeatable method. | Procedure Builder, fixed Template-driven authoring and executable-plan preview stop being the required front door or general runtime model. |
| FR-13–FR-18 | FR-100 continuing lifecycle; FR-128–FR-133 immutable versions, exact review and scheduled occurrence. | Ordinary investigation needs no pre-approved Procedure. Check activation reviews its assurance method; each occurrence uses the same Task engine. |
| FR-19–FR-23 | FR-105–FR-108 managed computer/control; FR-117–FR-120 bounded models/tools/analysis/helpers. | Run-bound workspace identity, plan interpreter and mandatory sequential record × system execution do not constrain the new engine. |
| FR-24–FR-30 | FR-102–FR-107 supervision/control/private entry; FR-136 and FR-140 meaningful activity, notifications and honest replay. | Screenshot proxy cannot substitute for a real computer. Pause/Stop, computer takeover, model cancellation and historical replay have distinct scopes. |
| FR-31–FR-35 | FR-121 immutable evidence/lineage; FR-122–FR-126 coverage, evaluation limits and evidence requests; NFR-20. | Fixed compiler-1 Gate rows are no longer a universal schema. Their safety meanings survive through typed basis, evidence, coverage and evaluation. |
| FR-36–FR-40 | FR-122–FR-125 matching, exact rules, judgment and summaries. | One compressed result enum cannot conflate applicability, execution, verdict, origin, coverage and review. Universal model-confidence thresholds are retired. |
| FR-41–FR-47 | FR-127–FR-135 investigation, versioned products, reproducible support, attributable review/issue and continuing findings. | Approval binds exact dependencies. Honest solo review is supported; template-only result outputs and universal signed-archive-only export are retired. |
| FR-48–FR-50 | FR-99, FR-137–FR-140 task navigation, usage, explanation and qualification metrics. | Runs dashboard and Builder instrumentation are not the primary product experience or success measure. |
| FR-51 | FR-132–FR-134 reviewed recurring method and versioned execution. | No compiler-1/compiler-2 coexistence requirement; one Rust Task engine executes occurrences. |
| FR-52–FR-59 | FR-97–FR-104 scoped engagement conversation and Tasks; FR-117 provider choice. | Engagement-level conversation now coordinates multiple distinct Tasks; opening a Task is inspection, not a requirement to maintain separate chats. |
| FR-60–FR-68 | FR-109–FR-111 standing authority/connections; FR-118 receipts; NFR-18–NFR-19 and NFR-26. | Authority is rechecked across all routes. A personal test-account connection never authorises unrelated personal/employer material. |
| FR-69–FR-76 | FR-121–FR-128 original/derived evidence, coverage and versioned work products. | Evidence, facts, summaries and human review remain separately attributable; methodology-specific artifacts use the general work-product mechanism. |
| FR-77–FR-82 | FR-112–FR-116 method/skill/knowledge; FR-119 analysis; FR-121 and FR-127 document processing. | No late-stage memory/skill deferral. First substantive work binds applicable configuration and uses authorised working knowledge. |
| FR-83–FR-89 | FR-102, FR-111, FR-114–FR-118 authority/delegation, skills, context and uncertain effects; NFR-21 and NFR-26. | FR-86's methodology proposal approval mechanism is superseded by Admin's ordinary versioned Save (FR-112); interpretation remains an editable sourced proposal until Save. |
| FR-90–FR-96 | FR-98, FR-108, FR-117, FR-127–FR-131 usable Office output, model policy and attributable review. | Admin-only audit sign-off is disallowed; honest solo eligibility replaces any universal independent-review-only constraint. Qualified profile support replaces blanket Office promises. |

| Retired NFR IDs | Successor and disposition |
|---|---|
| NFR-1–NFR-5 | NFR-18–NFR-21, NFR-26–NFR-27 preserve isolation, secret handling, injection resistance, integrity, determinism and re-examinability. Computer identity is scoped beyond one Run; bounded retained credentials/session material are controlled by custody and retention rather than a universal Run-end destruction rule. |
| NFR-6–NFR-7 | NFR-22–NFR-23 replace assumed Run-duration/dashboard latency with relevant control/computer qualification boundaries. Old 30-minute/5-minute completion assumptions are retired, not silently promised for a different product. |
| NFR-8–NFR-10 | NFR-21 and NFR-28 retain bounded recovery and reliable scheduled records. No universal three retries, five-minute start promise, 24-hour RPO or eight-hour RTO is inherited without an explicit new service qualification. |
| NFR-11–NFR-15 | NFR-25, NFR-29–NFR-31 preserve accessibility, diagnostics, safe test data and explicit lifecycle/profile boundaries. Synthetic acceptance remains required; commercial real-data terms need qualification. Lifetime-of-PoC retention and old Adapter/compiler ownership are not the future service contract. |
| NFR-16–NFR-17 | NFR-18 and NFR-26 preserve negative plus positive isolation proof and disclosure/fallback restrictions. They apply to the new database, context, computer and subscriber paths. |

Prior UJ/RJ/SM identifiers are preserved in the archive and are not repurposed. The active PRD uses a concise accepted reference journey and testable first-complete acceptance without inventing new customer interviews or silently renumbering old journeys.

## 2. Preserved engineering lessons and replaced architecture

The user's course correction explicitly permits rebuilding code or removing architecture that obstructs the accepted design. Preserve lessons and useful tests from old evidence acquisition, exact timestamp/decimal boundaries, grounded identity, evidence insufficiency, review dependencies, durable decisions, lost-response retry, scope enforcement and replay gaps. Their expected behavior is evaluated against the new FRs before reuse.

Use **one Rust modular backend/agent engine, fresh PostgreSQL schema, durable relational state with an append-only event/receipt ledger, scoped objects and managed execution**. Keep a React/TypeScript frontend and the Pair identity. Retire the old TypeScript worker/compiler ownership, old queues and compatibility schema assumptions as constraints on new construction. This is an architecture correction within an existing repository, not a claim that legacy history or implementation evidence can be deleted indiscriminately. Existing operational records would require explicit export/migration treatment if they become migration inputs.

The architecture owns identity and resource leases; accepted commands and applied receipts; one-use dispatch and reconciliation; trusted tool/provider contracts; computer input/observation fencing; analysis isolation; and evidence, evaluation, work-product and Check storage. The PRD states observable outcomes. The [code-disposition evidence](../../zobba-product-architecture-2026-09-30/notes/code-disposition.md) identifies inspected reuse candidates and superseded seams; source research is reference material, not executable instructions or a dependency installation plan.

## 3. Detailed contracts to carry into SPEC and stories

| Contract family | Governing accepted-design sections | Critical product consequence |
|---|---|---|
| Engagement conversation and Tasks | §§1.1–1.3, 2.1–2.2, 5.3–5.5 | Exact target, scope and accepted/applied outcome remain visible during concurrent work. A model stream does not own conversation/control admission. |
| Permissions and connections | §§3.1–3.2, 6.4, 8.1–8.4 | Current account, purpose, recipient/content and effect are enforced at dispatch. Source-side read-only restrictions survive human takeover. Unknown send state is reconciled. |
| Computer and private entry | §§2.3, 7.1–7.5, 8.2 | Real screen, exclusive input, privacy cover, account verification and honest recovery; retained disk is not retained RAM. Pool hit, restart and initial Windows enablement are distinct. |
| Admin, skills and knowledge | §§3.3–3.4, 6.3 | Ordinary Save atomically versions and assigns; business effective periods stay distinct. Relevant skill and scoped knowledge are used from the first Task. Recalls/revocations constrain pinned versions. |
| Evidence and assessment | §§4.1–4.3, 4.5 | Exact facts, qualified absence, right-grain coverage, immutable revisions, contrary evidence and separate human disposition. A complete model run proves no audit conclusion. |
| Work products and review | §4.2 | Stable claim/citation navigation; exact-version independence check; labelled solo mode; separate authorised issue; material successor changes reopen review. |
| Continuing assurance | §§4.4–4.5 | Reviewed semantic method, logical-period identity, bounded catch-up, current delegation, late-evidence admission and persistent finding identity. Routine maintenance is not a new methodology ceremony. |
| Operating guarantees | §§7.3–7.6, 8.5–8.6 | Declared response goals need regional qualification. Budgeting, backup/restore and effect reconciliation include uncertain states and do not turn estimates into sales claims. |

The old Northstar/P-1–P-4 procedure contracts and golden datasets remain useful optional regression material. They cannot silently define a universal methodology. The supplier-payments example is the accepted first-complete reference, and the leaver-access example remains a suitable additional method/application proof when its source and criterion contracts are configured.

## 4. Acceptance and dependency boundary

Identity, scope, authority, durable Task/control and source registration precede actual acquisition. Methodology/skills and working knowledge/context are parallel prerequisites to substantive evaluation, not polish after the first Task. Managed computer and analysis depend on admitted tools and receipts. Typed coverage/evaluation and evidence dependencies precede meaningful work-product review. The first complete **Task** culminates in the supported review/issue path; the first complete **baseline acceptance** then adds promotion and one later Check occurrence. This ordering prevents a tiny chat/file prototype being called the whole product while keeping recurring execution dependent on proven task work.

The implementation plan may release internal engineering slices, but each marks what it does and does not prove. A first batch that establishes identity, schema and durable conversations is not a validated audit assistant. No old story status, broad test count or screenshot is substituted for the new acceptance obligations. Structural checks on these planning documents are likewise not runtime verification.

## 5. Commercial assumptions and constraints

The PRD preserves three remaining commercial decisions: supported applications/authentication and service hours/concurrency; launch region plus allowed processing destinations and retention/deletion/legal hold; and pricing/allowances/overage/Windows entitlement. Engineering estimates may use named defaults while those terms remain uncontracted. The [sized operating budget](../../zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md) owns region/scenario/rate/model-usage assumptions and distinguishes platform overhead from customer-specific consumption. It supersedes the accepted design's explicitly temporary $300 shared-platform allowance for budgeting, without changing the accepted product.

Methodology criteria, field mappings, sampling conventions and eligible review modes are ordinary firm configuration or scoped engagement decisions. They are not extra business approvals imposed on every Task. Broader real-data service and native Windows support require the declared profile, data and commercial commitments before being represented as available.
