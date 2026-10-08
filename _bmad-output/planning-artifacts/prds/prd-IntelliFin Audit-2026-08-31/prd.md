---
title: "Product Requirements Document: Zobba"
status: final
revision: 5
created: 2026-08-31
updated: 2026-10-01
baseline: "Owner-accepted Zobba product and architecture design, revision 3"
supersedes: "PRD revision 4; all prior active PRD/addendum constraints"
implementation_status: "Target contract; implementation and qualification pending"
---

# Zobba product requirements

## 0. Authority and use

The owner accepted [Zobba design revision 3](../../zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md) as the design to build. This PRD consolidates that decision into the active product contract. It is a planning artifact, not a statement that the product is built, qualified or available for customer data. The accepted design remains the detailed reference; architecture, experience, SPEC and stories derive from the same baseline.

**FR-1–FR-96 and NFR-1–NFR-17 are retired without identifier reuse.** Retirement applies to the new build; it neither rewrites historical records nor discards prior implementation evidence. Their complete text survives in the [dated archive](archive/pre-revision-3-2026-09-30/README.md). [The active addendum](addendum.md) maps useful behavior to its new requirement and explicitly retires contradictory constraints. Historical course-correction papers, compiler-1 contracts and old story completion do not establish acceptance of this product. Downstream artifacts that have not explicitly adopted this baseline require reconciliation before implementation.

This revision replaces the procedure-first Builder and compiler-coexistence assumptions. Engineering uses one Rust backend and agent engine with a fresh schema; the implementation choices and source mappings belong in the architecture and addendum. No application rewrite, deployment, purchase or customer access is performed by publishing this PRD.

## 1. Product and audience

Zobba is a continuing audit working environment. An auditor gives an objective, continues talking while several Tasks progress, inspects sources or the actual computer, supplies decisions when needed, and develops supported work products for accountable human review. The primary coordination surface is the **engagement conversation**. A **Task** remains a distinct, continuing objective with its own history, scope, decisions, work and controls.

The product serves audit teams and independent practitioners. Auditors prepare; assigned Audit managers review, approve and issue. Admin configures people, methods, skills, connections, models and budgets. Multiple roles may be held by one person; Admin alone grants neither client-evidence access nor audit sign-off. Solo work is explicitly configured and truthfully labelled. Team work never silently downgrades to self-review because a reviewer is unavailable.

The first complete experience covers planning and evidence acquisition, supported testing and investigation, working papers, review/issue and a small continuing-assurance proof. It must demonstrate methodology, skills and working knowledge in use from the first substantive Task. A conversation demonstration or a file-only prototype is an engineering increment, not that acceptance boundary.

## 2. Product vocabulary and experience

| Term | Product meaning |
|---|---|
| Engagement | Client, period, objectives, team, methodology, Permissions and audit record. |
| Engagement conversation | One continuing, scoped coordination surface over several Tasks and direct discussion. |
| Task | A continuing objective within one engagement; a new work cycle can resume it without replacing its history. |
| Working brief | Visible current understanding of objective, scope, criteria, approach and intended outputs. |
| Permissions | Current bounded authority by account, resource, purpose and action; connection scope alone is insufficient. |
| Managed computer | A real remote browser/desktop resource with independently controlled observation and input. |
| Evidence | Registered source material with acquisition identity, immutable bytes and known coverage. |
| Assessment basis | Versioned criteria, period, population/selection, facts, method and limitations. |
| Work product | Versioned paper, analysis, finding, report or correspondence with support and actual review state. |
| Check | A reviewed repeatable assurance method; each period or admitted trigger creates a linked Task/result. |

Keep the Pair identity and conversation/workspace layout. Active work, Needs you, Computers, Work products and Permissions remain reachable beside the conversation. Opening an output, selecting text or taking control does not replace the engagement conversation. A task card states its objective, owner, work state, outstanding request and relevant outputs. Commands name the Task or computer they affect.

**Reference journey:** an auditor asks for a supplier-payments review; Zobba binds the relevant saved methodology, selects a completeness skill and recalls authorised system knowledge. It acquires a population, opens the actual application for investigation and requests protected sign-in only when necessary. The auditor adds a shared-account investigation in the same conversation, answers a criterion question, gives a correction and inspects a cited work product while both Tasks remain attributed. The original paper reaches eligible team review or labelled self-review, issuance and a reviewed monthly Check. This journey derives from accepted design §§1.3 and 4.5; no fictional customer research or successful runtime test is implied.

## 3. Functional requirements

### 3.1 People, conversation and continuing work

#### FR-97 — Organisation, client and engagement scope

Every Task, conversation, source, computer and work product has explicit ownership and access scope. A Task belongs to one engagement. Resolve ambiguous engagement identity before acquiring or disclosing client material. Cross-client search may locate authorised labelled items but cannot silently combine their content; cross-engagement work requires an explicit authorised scope change.

#### FR-98 — Roles and membership

Support Auditor, Audit manager and Admin with engagement assignments, invitations, role changes and removal. Each organisation must retain at least one active, non-expiring Admin membership linked to an active identity; additional temporary Admins remain allowed. Membership and identity deactivation/removal must enforce this atomically, including concurrent changes. Establishing a qualifying replacement permits ordinary Save without another approver. This safeguard was owner-approved on 1 October 2026. Removal ends current sessions and control/dispatch authority while preserving authorship. Only an eligible assigned Audit manager may review, approve or issue; an independent reviewer cannot have materially prepared the submitted version.

#### FR-99 — Coordinating conversation and Task cards

Accept and persist messages while several Tasks or model calls run. Relate a request to its explicit Task/decision, create a Task when warranted, or answer without creating one. Return attributed work cards and allow direct Task inspection without losing the engagement conversation. Multi-Task direction receives a separate accepted/applied outcome per target. Retry of one message cannot create duplicate Tasks or effects; ambiguous material direction is resolved before application.

#### FR-100 — Continuing Task lifecycle

Preserve work through tab closure, waiting, interruption and new evidence. Distinguish activity, human attention, connectivity and work-product review state. A blocked branch identifies what waits and what continues; completion may retain limitations. Resuming a stopped objective creates a new recorded work cycle. Assigned work, scheduled work and optional read-only proactive discovery remain distinct; optional discovery cannot itself send, mutate applications or control a computer.

#### FR-101 — Working brief and useful initiative

Expose objective, scope, applicable period/method, approach, expected outputs and material assumptions. Begin authorised discovery without a pre-task wizard; request missing criteria only before the dependent evaluation or issuance. Investigate relevant leads within objective, current authority and budget. Present a material scope expansion before applying it.

#### FR-102 — Durable guidance

Persist guidance and acknowledge Received independently of a busy model. Show Applied only after the named work changes; preserve each receipt and consequential decision. Offer Interrupt now for urgent correction. A stale proposal must be reconsidered against new guidance, not silently executed. Contradictory material instructions from collaborators become a named decision.

#### FR-103 — Scoped Pause and Stop

Pause/Stop accepts through a path independent of model/media streams and covers the named Task's delegated execution. Show Pausing/Stopping until executors quiesce or unresolved state is disclosed. Preserve work and reconcile already dispatched effects; unknown effects remain unknown. Other Tasks continue unless included. Stopping a Check occurrence does not disable its future schedule; provide a distinct schedule control.

#### FR-104 — Contextual questions and decisions

Keep a durable Needs you request linked to its Task, blocked work, eligible respondent and exact source/action versions. Explain a criterion conflict and its consequence, with a recommendation where supported. Resolve a short conversational answer to that exact current question; stale answers cannot authorise changed actions or override required methodology. Independent work may proceed while waiting.

### 3.2 Computer, access and authority

#### FR-105 — Real managed computer and honest availability

Provide the actual authorised browser/desktop, account/environment, controller and freshness state. Opening or watching does not transfer control, and closing the panel does not stop assigned work. Show Preparing, Reconnecting, privacy cover and unsupported cases truthfully; no reconstructed screen substitutes for a disconnected computer. Persist Task/evidence state separately from the computer. Safe idle shutdown preserves saved work and never promises RAM or valid-login restoration.

#### FR-106 — Exclusive control and handback

Several authorised people may watch, but one controller owns input. Take over fences all old agent input, including retries and held keys, before enabling human input. Hand back releases human input, freshly inspects the session and revalidates account/purpose/pending work. Input is refused on lost or stale control; losing the human connection never silently hands control to the agent. Independent, nonconflicting analysis may continue.

#### FR-107 — Protected sign-in

Request the verified origin/environment, required account/role and reason. Only the account owner or an explicitly permitted delegate can enter/control protected sign-in. Use protected takeover for arbitrary applications/MFA; allow a private form only for a qualified integration with the same containment. Suppress every agent/other-viewer observation, capture, recording, clipboard retention and voice path for that computer during private entry. Show Waiting → Handed back/Details submitted → Verifying → verified account/role, or Needs attention. Not now preserves the wait. Secrets never enter chat, memory or task receipts; a cookie alone is not successful verification.

#### FR-108 — Supported application profiles

Make the Linux/browser experience standard. General reading, analysis and templated exports are supported through qualified applications. Native Office/macros/exact layout require a separately qualified licensed Windows profile or an explicit unsupported result. Distinguish interactive access, unattended access, initial enablement and restart. Do not promise arbitrary application compatibility, device-bound authentication or lossless Office round trips.

#### FR-109 — Standing Permissions and operating purposes

Compute authority as the intersection of organisation limits, engagement scope, membership, actual connection/account, accepted Task authority and bounded delegation. Each operation binds Live inspection, Test workflows or Audit coordination. Live inspection cannot modify audited records; require source-enforced read-only identities or a qualified narrow adapter, including during takeover. Test writes require a verified test environment and bounded synthetic scope. Routine actions within standing authority proceed without another prompt. Show Can read, Can write, Asks first, Never and applicable limits.

#### FR-110 — Concrete action decisions

When standing authority is insufficient, present actual account, purpose, destination/recipients, content/attachments, resource version, effect and expiry. Offer Allow this action and, where permitted, a scoped revocable standing rule. Material changes invalidate the old confirmation. Default new external recipients, broad sharing, financial/legal commitments and issued reports to explicit authority. No unexplained domain-wide Always allow choice or blanket approval for ordinary edits.

#### FR-111 — Connections and service delegation

Bind OAuth/sign-in to initiating identity and verified returned account, allowed scopes and expected organisation. Distinguish personal consent from firm service consent. Refresh preserves identity; account change requires attributable rebind. Checks receive narrow revocable service delegation. Member removal or withdrawn consent blocks dependent work and requests an explicit replacement; it never impersonates the departed owner. An app connection alone creates no monitoring schedule.

### 3.3 Methodology, skills, knowledge and execution

#### FR-112 — Admin methodology Save

Admin can edit or derive an editable proposal from uploaded methodology, inspect sources/conflicts, validate and Save. A successful Save creates one immutable attributable version and assignment; invalid input leaves the prior version effective, and Undo creates a successor. No second approver or publication ceremony is required for ordinary configuration. Packages define applicable areas/periods, criteria, populations, evidence checks, ratings, templates, review and skills. Demonstration packs are opt-in; a neutral template never masquerades as firm methodology.

#### FR-113 — Binding and change impact

Bind applicable method/template versions before substantive evaluation. Admin Save names scope and effective assignment, defaulting to new Tasks; optional Apply to active tasks changes bindings at a safe boundary and recomputes affected drafts. Inherited requirements survive incomplete overrides. Configuration date does not replace a criterion's business effective period. Preserve in-flight basis and reviewed/issued versions; recalls/current restrictions block affected new work. Material Check method changes use its review rule without making Admin Save itself an approval process.

#### FR-114 — Trusted installed skills

Use relevant skills during the first complete Task, selected from a scoped trusted catalog with immutable purpose, compatibility, tools/effects, input/output and resource versions. Explain the selected technique/version. Auditors may choose a skill or override optional advice; skills cannot grant access. Scripts use ordinary isolated analysis. A retrieved SKILL.md is evidence until deliberately installed. Disable stops new selection; recall blocks faulty-version use and identifies affected work.

#### FR-115 — Scoped working knowledge

Preserve exact attributable direction, source-backed facts, uncertainties and reversible low-risk preferences without approval paperwork for every memory. Keep personal, firm, client and engagement scopes distinct. Expose What Zobba is using so eligible people can correct, exclude, update or forget items. Material conflicts become focused questions. Assertions and summaries cannot fabricate evidence, review or cross-client authority.

#### FR-116 — Context, retrieval and long-work continuity

Apply current scope/access/period filters before retrieval ranking and recheck disclosure before sending. Record included source/configuration versions and meaningful omissions. Recover exact decisions, unresolved operations/questions and review state from durable records after compaction/restart. Empty search is not proof of absence. Corrections/revocations invalidate dependent summaries, embeddings, previews, knowledge and pending disclosures; retained restricted evidence is not thereby available to a current viewer/model.

#### FR-117 — Models and provenance

Use Admin-approved routing with inspectable allowed model/effort choices and actual per-invocation model, destination, context and usage. Preserve required capabilities and destination policy during fallback. Switch between committed work cycles without replaying effects. A partial model response cannot authorise a tool action; a second model is assistance, never independent human review.

#### FR-118 — Tools, external effects and receipts

Use suitable direct APIs, qualified MCP or real computer operations through common admission and Permissions. Bind complete validated arguments to canonical tool/account/resource/effect and one logical operation before I/O. Preserve attempts, completion evidence and uncertain outcomes. An HTTP success/job ID may mean pending. Reconcile possible effects before retry; a tool's read-only label is not trusted authority, and a failed source read is not an empty source.

#### FR-119 — Isolated analysis and files

Run selected programs against admitted file/evidence inputs in bounded disposable analysis without acquisition credentials or browser sessions. Preserve program/environment/parameter/input/output identity. Register verified outputs and transfer only authorised files; reject path escape, unsafe outputs and truncated-result claims. Use full-data processing for large populations and label bounded previews.

#### FR-120 — Bounded helpers

Delegate scoped context, authority, budget and outputs under the parent Task. A helper cannot widen its permissions, outlive cancellation authority or bypass aggregate limits. Keep exclusive resources exclusive; reconcile concurrent document changes. Parent synthesis cites returned evidence and remains accountable for the final explanation.

### 3.4 Evidence and audit evaluation

#### FR-121 — Evidence identity and lineage

Register immutable original bytes with source/account/time, source version where available, selection/query, content digest and known coverage. Derived data/annotations are separate attributable objects. Preserve source → acquisition → extraction/analysis → claim → work-product version → issued manifest links. Retain spreadsheet formulas/cell locators and original scans/OCR coordinates. Hash identity does not prove source truth or completeness.

#### FR-122 — Population, sample and coverage

Record population unit, period/query, source snapshots, end-of-stream/pagination and reconciliation, duplicates, exclusions and unknowns. Separate rows, subjects, selected subjects and criterion opportunities; show denominator scope/unit/knownness before percentages. Preserve sample frame, method, strata, selected identities/seed and substitutions. Only a validated pinned statistical method permits statistical inference. Unknown counts are not zero, and incomplete acquisition cannot support a population-wide clean result.

#### FR-123 — Criteria, assessment basis and typed facts

Version authoritative criterion/source/location, business effective period, applicability, required facts, method/rubric, missing-input treatment and review rules. Bind objective, period, population/sample and dependencies into the assessment basis. Facts preserve identity, exact decimals/units, dates/zone-aware instants, unavailable/ambiguous states and acquisition/effective times. Matching and conversion rules are explicit; no silent currency or date substitution.

#### FR-124 — Evaluation revisions and human disposition

Keep applicability, execution state, valid criterion verdict, origin and human disposition separate. Exact rules/programs preserve inputs and outputs; judgment proposals retain rubric, contrary/supporting evidence and actual model/rationale. Calculation failure is not control failure. Missing access differs from verified authoritative absence. Human replacement or waiver is attributable and preserves the original; corrections recalculate, never rewrite past arithmetic or invent coverage.

#### FR-125 — Summaries and honest limitations

Version the exact included evaluations, coverage, distinct affected subjects and aggregation rule. Preserve supported exceptions even when wider assurance is inconclusive. Unknown applicability, missing material inputs or incomplete coverage cannot become unqualified No exception found. Verified zero activity says No eligible items; operating effectiveness was not demonstrated unless the methodology explicitly defines another disposition. Completion, evidence quality, assessment and approval stay independently visible.

#### FR-126 — Evidence requests and arrival

Track owner, expected content/period, allowed locations, due/reminder rules and sufficiency. Distinguish requested, received, checked, partially sufficient/sufficient and fulfilled. Supplier confirmation alone is insufficient. Reacquire and validate notification-referenced objects; deduplicate arrivals and resume only current admitted work. Late material after review/issue creates a successor or follow-up with affected claims marked for reconsideration.

### 3.5 Work products and accountable review

#### FR-127 — Work-product shelf and inspection

Keep stable outputs reachable from conversation and a shelf showing title, version, originating Task and actual review status. Open documents, tables, evidence and Changes beside conversation. Preserve claim → citation → preview → full evidence → return focus. Pin or selection suspends automatic following; Follow Zobba explicitly resumes it. Produce firm-templated DOCX/PDF/XLSX with limitations and attributable preparation/review, without exporting interface chrome.

#### FR-128 — Edits and dependency changes

Direct draft edits create attributable versions without a second approval ceremony. Detect stale concurrent changes and support resolution without lost updates. Show meaningful diffs; preserve stable claim/block/table identity. A material change to reviewed content or its required support invalidates affected review and creates a successor/reconsideration record rather than silently retaining approval.

#### FR-129 — Team review and approval

An eligible assigned Audit manager can challenge anchored claims, request work and Review and approve the exact submitted version and required dependencies. Record human contributors; a material preparer cannot independently review that version. Taking responsibility for agent-prepared work makes a person its preparer. A firm may configure a separate approver, but the product does not impose an extra ceremony by default.

#### FR-130 — Honest solo use

Admin may configure eligible solo work. The practitioner holds required audit roles and uses Self-review and approve. Interface, record and export state Self-reviewed by [name]; no independent review. A task requiring independent review cannot fall back to solo through chat, reviewer absence or a changed label.

#### FR-131 — Issuance and corrections

Issue is an authorised human action separate from approval, bound to recipients, exact versions, evidence manifest and limitations. Issued records are immutable. Corrections preserve the original, reason and changed claims and obtain the applicable successor review. Review/issue facts cannot be fabricated or erased by configuration edits.

### 3.6 Continuing assurance and operations

#### FR-132 — Reviewed recurring Check

Promote useful work into one readable definition pinning assertion, effective-policy selection, source/population meaning, facts/program/rubric, qualified model profile, outputs/review, narrow authority, owner, budget and timing. Save drafts ordinarily; review/activation binds the exact assurance method under team or labelled solo rules. Each occurrence produces a draft assessment, never an invented human sign-off. A schedule does not confer unattended authority.

#### FR-133 — Logical occurrences and schedules

Deduplicate calendar work by Check plus logical period; version/due-time changes cannot create a second automatic occurrence. Record zone and UTC boundaries, event identity/windows, late/missed periods and explicit bounded catch-up. Default to one active occurrence including waits; release compute, retain its slot, and expire at the next due time or 24 hours for event-only work without a due time. Late answers require an admitted correction; uncertain effects still reconcile under original receipts. Provide timezone/DST-aware inspect/edit/disable controls.

#### FR-134 — Recurring-method maintenance and drift

Record same-account refresh, layout change, replacement computer and compatible metadata as maintenance after validation. Material criterion/source meaning, analysis/rubric, sample, evidence/review, authority/destination or covered-window changes withhold affected work and require revised Check review. Pins cannot preserve revoked access or a known invalid method. Qualify model substitutions; do not silently change judgment meaning. Historical periods use the applicable historical basis.

#### FR-135 — Findings and follow-up

Separate continuing finding identity from each period's supported occurrence. Match criterion lineage, subject/system and issue kind before merging. Show new, continuing, changed, resolved and reopened issues without duplicate notifications. Not observed is not proof of remediation; closure requires supporting follow-up or accountable disposition.

#### FR-136 — Useful notifications

Notify on decisions, blocked access, material exceptions, results and budget limits under a saved permitted destination/audience rule. Use safe summaries and authenticated links; avoid unapproved evidence/client disclosure. Show what waits and what continues. Ordinary reminders/evidence triggers can resume Tasks without pretending to be reviewed assurance Checks.

#### FR-137 — Visible budgets and consumption

Meter model, computer, analysis and storage usage by organisation/Task/Check. Reserve before costly work and retain unknown charges pending reconciliation. At a ceiling withhold new cost, preserve work and explain remaining work. Stop, sign-out and access to earned results remain available. Separate platform spare/shared overhead from customer-specific consumption; Keep ready and Windows entitlement are explicit.

#### FR-138 — Authorised search and navigation

Search authorised engagements, Tasks, work products and supporting material with client labels and current access checks. A cross-client result is navigation, not implicit combined context. Opening a Task/object cannot broaden its audience. Preserve the inspected selection and keyboard focus through citation/detail navigation and reconnect.

#### FR-139 — Speech and later contact channels

Speech uses the same command system with a visible transcript. Confirm consequential transcription ambiguity before the action; spoken Stop uses control admission. Raw-audio retention is optional and policy-bound. Later calls/Slack/Teams share authorised continuity, not mirrored transcripts or new source access; ending a call does not stop assigned work. Calls and messaging-channel extensions are not dependencies of the first complete web experience.

#### FR-140 — Activity, return digest and explanation

Show meaningful progress, outstanding requests and a Since your last visit digest linked to support. How it ran exposes method/skill versions, knowledge, sources, analyses, requested/actual model, authority basis and human intervention. Distinguish pending/uncertain effects and verified results. Hide routine tool chatter by default; explain support without exposing private model reasoning. Historical replay is clearly historical, records gaps and excludes protected sign-in.

## 4. Non-functional requirements

All numerical performance thresholds below are **proposed qualification targets**, inherited from accepted design §7.3; none is a measured result or customer SLA. The implementation plan must name workloads and record actual distributions before a service promise is sold.

- **NFR-18 — Isolation:** Positive and negative tests cover current tenant/client/engagement/user scope across database, pooled connections, search, objects, context, subscribers, computer and background work. A denied-everything system does not pass. No real customer material is admitted before isolation and the supported access profile are qualified.
- **NFR-19 — Secret and instruction containment:** Encrypt in transit/at rest; use scoped secret custody. Injected source/skill-like text cannot grant authority or redirect disclosure. Protected sign-in tests with multiple viewers prove no private input/frame reaches models, logs, replay, voice, analysis or memory.
- **NFR-20 — Integrity:** Verify byte identity and immutable version/receipt relationships for evidence, evaluations, review and issuance. Tampering, missing objects and invalid dependency references are detectable. Integrity does not assert source truth.
- **NFR-21 — Recovery and effect certainty:** Fault tests cover admission, dispatch cutoff, provider acceptance, receipt registration, owner expiry, restart and restore. Duplicate commands admit one logical operation; stale owners/descendants cannot dispatch. Unknown remote effects are reconciled, never blindly replayed. Restore proof includes the possible effects beyond the restored database horizon.
- **NFR-22 — Responsive control:** Guidance and Pause/Stop admission remain independent of stalled models, media and ordinary work. Acceptance and actual application/quiescence are separately visible. At load, reserved control capacity and gateway lease expiry remain effective; qualification records admission, quiescence and paint separately. No unmeasured end-to-end control latency is promised.
- **NFR-23 — Computer response targets:** At RTT ≤80 ms, loss ≤1%, ≥10/2 Mbps down/up: p95 useful frame ≤2 seconds for an already-ready computer; ordinary input response ≤200 ms; cooperative safe takeover ≤1 second. Linux clean-pool hit ≤30 seconds; stopped Linux restart ≤90 seconds; cold Linux and enrolled Windows restart ≤180 seconds, excluding third-party sign-in and named application preparation. Fresh Windows enablement is a separate preparation case. At 150–250 ms RTT and 3/1 Mbps, target ordinary visible response ≤500 ms with explicit degraded state. Measure freshness and readable text at 1440×900; aim for ≥15 displayed fps during ordinary movement without pretending a stale preview is live control.
- **NFR-24 — Bounded resources:** Bound active Tasks/helpers, calls, computers, analysis, subscriptions, DB use and bytes separately. Waiting releases general execution capacity; retained uncertain calls/effects keep relevant reservations. Slow viewers cannot exhaust memory or corrupt a media stream. Complete durable output remains recoverable when preview/stream delivery truncates.
- **NFR-25 — Accessibility:** Target WCAG 2.2 AA for core conversation, task cards, requests, Permissions, documents, review and Admin, with keyboard/focus and screen-reader checks. Narrow screens retain conversation/workspace access and scoped controls. Target application accessibility is qualified separately and not implied by accessible Zobba chrome.
- **NFR-26 — Disclosure:** Recheck current permitted model/connector destinations after asynchronous context assembly and immediately before dispatch. Relevant revocation invalidates derivatives and reauthorises pending output/subscribers; fallback cannot silently broaden disclosure or weaken required capability.
- **NFR-27 — Audit quality:** Qualified synthetic cases include known populations, exact boundaries, ambiguous joins, conflicting policies, missing/stale sources, supported failures, verified absence and unsupported allegations. Deterministic results reproduce from preserved inputs/method; judgment remains re-examinable. No seeded unsupported clean conclusion or fabricated failure is accepted. Model/rubric changes require applicable case qualification.
- **NFR-28 — Scheduling and continuation:** Duplicate/missed triggers, restarts, schedule edits, DST and delayed evidence produce one logical occurrence or an explicit missed/delayed record. Catch-up is bounded and current authority rechecked. Scheduled controls never rely on a continuously running model/computer.
- **NFR-29 — Data lifecycle:** Agree organisation region, processing destinations, retention/deletion and legal hold before real-data service. Retained evidence and issued history follow the agreed audit policy; computer profiles/replay have separately bounded lifetimes. The initial recoverable idle-profile retention is seven days, adjustable by Admin; revocation remains immediate. Test actual restore/deletion and include object versions, credentials, derived indexes and backups in the documented lifecycle.
- **NFR-30 — Observability and cost:** Record scoped identities, queue/control latency, provider usage, paid computer time, analysis/storage, errors and effect uncertainty. General telemetry excludes prompts/evidence/secrets/raw input. Explain customer consumption separately from shared regional overhead and record measured qualification evidence rather than inferred performance.
- **NFR-31 — Supported-profile qualification:** Qualify actual app/account/consent/authentication, interactive/unattended access, region, computer image, reconnection, licensing and data routes. Published limitations match tested profiles; inability to support a profile yields an honest blocked/unsupported result and an authorised alternative, not simulated success.

## 5. First complete experience and success evidence

Acceptance uses synthetic audit material and designated accounts; access to an owner's personal account is permission for those designated resources, not unrelated personal or employer data. The accepted supplier-payments example is the reference; demonstration rules are not universal methodology.

The first complete Task proves items 1–6 below; baseline acceptance adds the dependent continuing-assurance proof in item 7 and the cross-cutting failure checks in item 8. Demonstrate these as one coherent workflow:

1. Admin saves a firm method/template and trusted skill without an approval ceremony; an assigned auditor starts the engagement conversation with scoped Permissions.
2. Zobba binds the applicable method, uses a relevant skill and authorised working knowledge, starts one Task and accepts a second objective without disabling conversation or losing attribution.
3. It acquires real synthetic source material, proves its population grain and coverage, uses the actual managed computer, handles protected sign-in/control and performs isolated analysis.
4. It presents a material criterion conflict, persists a correction as Received then Applied, survives interruption/reconnect and continues independent work while a branch waits.
5. It produces typed evaluations and a cited work product with complete and incomplete evidence cases distinguished. The reference arithmetic reconciles 1,000 applicable payments: 20 distinct supported exceptions, 20 unresolved and 960 meeting both criteria; 27 failed criterion opportunities are not misreported as 27 payments.
6. Exact-version team review requires a different eligible human contributor; the solo variant visibly self-reviews. Both preserve limitations and support authorised issuance and a successor correction.
7. A reviewed Check performs one later logical occurrence with current delegated authority, duplicate-trigger resistance, a deliberately incomplete input and late evidence; historical results and continuing finding identity remain intact.
8. Failures in isolation, private sign-in, stale control, revoked access, unknown effects, coverage or review integrity block acceptance. Runtime and audit-quality obligations are separately demonstrated.

Measure task completion quality, supported-claim rate, seeded-error outcomes, recovery correctness, control/readiness distributions and consumption. Record human interventions and time to review against the manual example. Counter-metrics are unsupported certainty, lost/duplicated work, unnecessary prompts, false sign-off, hidden scope expansion, cross-client disclosure and cost growth. Do not use message count, animation or a finished model run as evidence of completed audit work.

## 6. Boundaries and remaining business commitments

**In the baseline:** full web conversation/workspace, multi-Task coordination, real Linux computer and qualified connections, ordinary Admin methodology/skill Save, working knowledge, evaluation/coverage, supported work products, team/solo review and a recurring-method proof. Advanced catalogs and retrieval can grow after the necessary first-task capability exists.

**Not implied by acceptance:** production operational-record writes; arbitrary desktop/application support; universally lossless Office editing; automated human sign-off; universal demonstration criteria; unlimited always-on computers; compiler-1 compatibility; customer-hosted deployment; calls/Slack/Teams, optional proactive research or advanced scheduling breadth as first-complete dependencies. Native Windows remains a defined, separately qualified profile whose launch entitlement depends on customer requirements.

The remaining commercial commitments are the supported customer applications/authentication and staffed-service promise; launch-region/data-processing/retention terms; and seat prices, included usage, overage ceilings and Windows entitlement. The [operating budget](../../zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md) supplies scenario assumptions, not a residency decision or SLA. These do not reopen the accepted product or architecture. Ordinary firm-specific criteria and review rules are Admin configuration within this product.
