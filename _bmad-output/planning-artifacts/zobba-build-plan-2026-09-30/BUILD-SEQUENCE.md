# Zobba build sequence

This plan derives from the owner-accepted design revision 3 and the consolidated active [PRD](../prds/prd-IntelliFin%20Audit-2026-08-31/prd.md), [SPEC](../../specs/spec-IntelliFin%20Audit/SPEC.md), [architecture](../architecture/architecture-IntelliFin%20Audit-2026-09-01/ARCHITECTURE-SPINE.md) and [Pair experience](../ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md). It authorises a practical planning handoff, not code execution or a customer launch. The canonical acceptance criteria are in [epics.md](../epics.md): **9 new epics, 55 stories, IDs 20.1–28.6**. Existing history reached Epic 19, so no IDs are reused.

This is a brownfield course correction with a replacement runtime. We keep selected assets, methodology examples, evidence/integrity fixtures, useful control and recovery behaviours, and the lessons in existing code. We replace domain authority, schema and execution around the accepted product. We do not preserve the compiler, Builder entry point or Node orchestration merely to avoid changing code; we also do not delete valuable reference work before its replacement obligation is understood.

## Sequence and useful exits

Story dependencies, not epic numbers or calendar dates, control what can start. [dependencies.json](dependencies.json) provides all 143 directed dependency edges and gate closures. Work on independent ready stories may proceed together when file ownership and interface contracts are clear. No fictional delivery dates or staffing estimates are assigned. The deliberate forward-number edge **27.4 → 25.4** preserves assigned IDs while scheduling actual helper execution before the first-Task gate. Its prerequisites (22.3, 22.7, 24.3) are earlier work, so this is not a cycle or a requirement to finish all of Epic 27.

| Slice | Stories and dependency rule | Demonstrable exit |
|---|---|---|
| Foundation — first batch | **20.1 → 20.2 → 20.3 → 20.4** | New Rust/web workspace, scoped identity, durable commands and an engagement conversation with explicit Task cards. No functioning audit-agent claim. |
| Current authority and trusted material | 20.5–20.7; 21.1–21.6 according to their edges | Exact operation receipts; membership and standing Permissions; recoverable AWS qualification substrate; verified evidence; ordinary Admin method/skill Save; scoped working knowledge; one real firm document connection. |
| Early computer feasibility, in parallel | **23.1 as soon as 20.1, 20.2 and 20.5 are complete** | Actual Linux/app sign-in and streaming path exercised. Exposes authentication, source-read-only and infrastructure risks before the rest of the product is invested in. |
| Useful investigation | 22.1–22.7 | Native providers and tool catalog, continuing Task loop, exact context, isolated analysis/extraction, real method/skill use, budgets and responsive controls. |
| Actual computer work | 23.2–23.6; depends on qualified computer spine and admitted model/tools where stated | Scoped live desktop, complete input fencing, private sign-in, file transfer, recovery and adaptive browser actions under standing Permissions. |
| Supported audit output | 24.1–24.6 | Typed basis and facts, reproducible denominators, evaluation revisions, firm-shaped work products, independent team or labelled solo review and immutable issue/corrections. |
| First complete Task gate | 25.1–25.4 plus their full ancestor set, including **27.4 helpers executed early** | One coherent first audit Task, two-Task coordination, return digest and actual source/computer/analysis/review proof with baseline fault, budget, tenant and restore tests. |
| First complete recurring baseline | 26.1–26.6 | A reviewed semantic Check performs a later logical period under current delegation; incomplete and late evidence revise the right occurrence and preserve continuing findings. |
| Remaining accepted input and integration breadth | 27.1–27.3 and 27.5; 27.4 is already required before 25.4 | Qualified Microsoft mail/calendar, Google, GitHub/task tools, bounded helpers and speech into the same command system. These are accepted scope, although not dependencies of the first-Task demonstration. |
| Named profile and operating qualification | 28.1–28.6 with conditional Windows/Office gates | Supported profile evidence, measured load/readiness/cost, retention/restores, legacy cutover and an explicit offered launch scope. Baseline safeguards are already built earlier. |
| Explicit later extensions | 27.6 calls/Slack/Teams; 27.7 opt-in discovery | Additional channel/discovery proof when enabled; these are not hidden prerequisites of the first complete web baseline. |

### Gates are different claims

- **G0 / 20.4 — Foundation:** the first batch is dependency-valid and bounded. It proves no source access, computer capability, judgment or review.
- **Q1 / 23.1 — Feasibility:** an actual named Linux/application/authentication path works through the intended gateway. A mock cannot pass it. Missing test accounts or unsupported MFA remain explicit qualification blockers.
- **G1 / 25.4 — First complete Task:** methodology, trusted skills, working knowledge, native model, real connector and computer/private sign-in, isolated analysis, typed evaluation, evidence, editing and human review are present together. This includes tenant-negative tests, budgets, stale controls, restore and uncertain-effect reconciliation.
- **G2 / 26.6 — First complete baseline:** G1 plus a later Check occurrence, incomplete input, current service delegation, deduplication, method drift and late correction.
- **G3 / 28.6 — Declared release readiness:** the accepted core/input/connection breadth and operating proofs are complete for the profiles offered. Windows/Office adds 28.1/28.2 when offered. The remaining commercial commitments must be settled for actual customer launch.

A gate fails when its required evidence is missing; an earlier passing gate remains useful but does not rename the incomplete later one. Planning validation only checks this plan and its contracts. It is not runtime, security, audit-quality, accessibility, licensing or customer qualification.

## Dependencies that shape the work

Durable message/command admission precedes the agent loop. Scope and current Permissions precede acquiring client material or dispatching an effect. Evidence registration precedes parsing or claiming support. Saved methodology/skills and scoped knowledge precede substantive assessment. Actual computer qualification begins early; adaptive agent use joins only once the admission and provider contracts exist. Typed facts and coverage precede work-product review. A Check is promoted from proven Task work and adds a semantic method/version and period contract, not another engine.

Each story introduces only the tables and versioned contract fields it needs. Shared contracts have one owner as specified in the [contract register](../architecture/architecture-IntelliFin%20Audit-2026-09-01/CONTRACT-REGISTER.md). Contract producers include executable examples and refusal/failure cases before consumers use them. API/worker separation serves control availability; it is not two domain backends.

The main repeated touchpoints are Task authority, Permissions, evidence registration and UI projections. We retain the separate stories because they create early executable seams and validate a growing integration rather than rewriting one module from unrelated epics. A later story extends an owned port/schema with versioned fixtures; it cannot independently write another module's tables. Before parallel implementation, the build orchestrator must assign non-overlapping file ownership or serialize work on a shared contract.

## Early risks and proof

| Risk | Earliest proof and later acceptance | Response when the proof fails |
|---|---|---|
| Rust/React/toolchain or fresh-schema bootstrap | 20.1; pinned commands and disposable database | Resolve supported pins and bootstrap before extending the workspace. Do not bridge to the Node domain as a shortcut. |
| Scope leaks, stale roles, duplicate acceptance | 20.2–20.5; real pooled database and crash/race fixtures | Block further real-source admission; retain failing cases as contract tests. |
| Actual sign-in, account verification or live read-only constraint | 23.1; complete privacy/input proof 23.3–23.6 | Name the unsupported profile and supported fallback. Do not substitute a screenshot or model assertion. |
| Model and connector consent/destination limits | 21.5 and 22.1; revocation and exact endpoint qualification | Local fixtures can continue; the corresponding live qualification stays blocked until a designated account/profile is available. |
| Analysis isolation or output escape | 22.4–22.5 | Block untrusted execution/output registration until the credential and file boundary passes. |
| Unsupported clean conclusions or wrong exception arithmetic | 24.1–24.3; AP reference and adverse synthetic cases | Fix typed basis, completeness or aggregation; a polished paper cannot waive an audit-quality failure. |
| Review falsely labelled independent | 24.5–24.6 | Record responsibility/contribution and exact versions; deny self-review under an independent label even with zero manual edits. |
| Restore, stale guidance or uncertain external effects | 20.3/20.5, 22.2; integrated 25.4; deployment breadth 28.4 | Reconcile possible remote effects beyond the restore horizon before any retry. Applied guidance invalidates conflicting old-intent claims. |
| Recurring duplicate periods or expired consent | 26.2–26.6 | Preserve one Check + logical-period identity; withhold affected actions, retain limitations and repair delegation explicitly. |
| Service costs or response targets do not qualify | 22.7 admission, 25.4 baseline measurements, 28.3 load/cost | Bound the supported envelope and update the named profile/commercial offer using actual evidence. |

## Brownfield cutover and preserved value

Before reusing a legacy or Codex unit, record exact source/revision, destination, purpose, adaptation, validation and licence/notice obligations. Keep reusable Pair tokens/assets, selected harmless rendering utilities and synthetic audit fixtures. Adapt the behaviour behind reserve/upload/read-back/register, command idempotency, leased ownership/fencing, current-role checks, exact receipts, revocation and honest event history. Rebuild these as owned Rust contracts where their old types or ownership conflict. Retire compiler-1/2 contracts, the Procedure Builder entry point, Node/AI-SDK domain orchestration, pg-boss ownership and the old Drizzle schema from active runtime authority.

Story 20.7 owns the first recoverable AWS qualification deployment and baseline restore runbook; its designated cloud allowance is a build/qualification cost, not customer launch approval. Story 28.5 records and verifies cutover after replacement proof. Existing application code remains historical/reference material until that implementation story acts on it. No production data migration or legacy cleanup is executed by this planning handoff. If later discovery finds customer data requiring transfer, create a bounded migration design instead of silently copying old schema/history.

Historical epics and old sprint tracking are preserved in their archives. The default `implementation-artifacts/sprint-status.yaml` is the sole active queue for Epics 20–28 because the installed `bmad-build` reads that path. Old completion states prove only old code; supersession does not mark it delivered. Old story-spec folders are historical inputs, not automatically ready new stories.

## Remaining owner commitments

The product/architecture, standing Permissions, Admin Save and team/solo model are settled. Three commercial choices remain before commitments to customer service:

1. **Recommended initial offer:** named Linux/browser profiles using customer-owned application accounts, with actual authentication and source-read-only qualification. Offer only measured concurrency and staffed-service coverage; avoid an unqualified response/service promise.
2. **Recommended pilot baseline:** US East, contingent on the firm accepting that region and the actual model/connector processing destinations. Agree firm evidence-retention/deletion/legal-hold terms before customer data; this plan does not invent a legal retention period.
3. **Recommended charging structure:** a platform fee plus pooled metered consumption with explicit budgets, included allowances and overage ceilings. Price Windows separately; avoid an unlimited seat promise. Final prices depend on observed workloads and the budget sensitivity, not an invented sale price.

Use the [operating budget](../zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md) for explicit planning assumptions. Ordinary field mappings, criteria and firm review configuration stay ordinary Admin/engagement work. These commercial choices do not prevent the first local engineering batch; they constrain later real-data qualification and the offer that can be launched.
