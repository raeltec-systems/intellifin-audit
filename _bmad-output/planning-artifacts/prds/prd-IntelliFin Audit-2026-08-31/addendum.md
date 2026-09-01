---
title: "IntelliFin Audit PoC — Product Detail Addendum"
status: draft
revision: 2
created: 2026-08-31
updated: 2026-09-01
---

# IntelliFin Audit PoC — Product Detail Addendum

This addendum preserves inferred product detail needed to make the PoC requirements testable, plus user-contributed depth that belongs downstream. It is not an architecture specification.

**Status legend:** `[ASSUMPTION]` means the product decision awaits explicit confirmation. “Normative” means the rule is binding for implementation and testing of this PoC draft, but it does not convert the underlying product decision into a confirmed long-term requirement.

## A. Synthetic Organization, Population Sources, and Target Systems

The fictional organization is **Northstar Financial Group**, a regulated lender with 500 synthetic employees.

### A.1 Population Sources

| Source | Purpose | Acquisition mode | Core records |
| --- | --- | --- | --- |
| Leavers spreadsheet | Monthly HR leavers export (`.xlsx`), uploaded by the Auditor | Auditor upload; opened by the Audit Agent in the Agent Workspace | Employee ID, name, department, employment status, termination effective date, manager |
| PeopleHub | HR system of record | Read-only API | Employee ID, name, employment status, termination effective time |
| AccessGate | Application identity store (Template P-2) | Read-only API or CSV | Account ID, employee ID, username, status, roles, disabled time |
| RoleMatrix | Approved access policy (Template P-2) | Versioned file | Role, permission, conflicting permission pairs |
| LedgerFlow | Transaction system (Template P-3) | Read-only API or CSV | Transaction ID, amount, currency, initiator, processed time, approval ID |
| ApproveNow | Approval system (Template P-3) | Read-only API or controlled web extraction | Approval ID, transaction ID, approver, decision, time, approval limit |
| ConfigRegistry | Approved configuration baseline (Template P-4) | Versioned file | Parameter, approved value, effective time |

Every synthetic dataset includes a declared record count, generation/version identifier, effective period, and integrity digest so the Evidence Quality Gate can detect truncation or substitution. The leavers spreadsheet carries its declared count and digest on a signed cover sheet generated independently of the Audit Runner.

### A.2 Target Systems

| Target System | Form | What the Audit Agent does | Audit credential |
| --- | --- | --- | --- |
| LoanCore | Synthetic **web application** (loan origination and servicing) with a user-administration area | Sign in, search users by employee ID or name, open the account page, read status, username, roles, last login; capture screenshot | Read-only audit account, no user-admin write rights |
| LedgerDesk | Synthetic **desktop application** (finance ERP client) running in the sandbox desktop `[ASSUMPTION: platform decided by Open Question 3]` | Launch, sign in, open User Maintenance, search by employee ID, read status and role assignments; capture screenshot | Read-only audit account |
| ProdConsole | Synthetic web configuration surface (Template P-4) | Read parameter values and the signed snapshot identifier | Read-only |

Every Target System exposes only synthetic data, publishes an allowlisted origin or application identity, and refuses write actions from the audit credential at the system level, so that FR-3 is enforced by both the workspace and the system.

## B. Shared Data Rules

- All identifiers are strings and preserve leading zeros.
- All timestamps use ISO 8601 and are normalized to UTC; original offsets are retained.
- Money uses decimal amount plus ISO 4217 currency; the PoC avoids foreign-exchange conversion.
- Empty mandatory identifiers, duplicate primary keys, unparseable timestamps, and undeclared schema fields trigger Evidence Quality Gate events.
- Matching uses exact normalized identifiers. Fuzzy identity matching is out of scope; a Target System search that returns more than one candidate for a population record is an ambiguous match and the record is Unevaluated unless the Audit Agent raises an Escalation that resolves it.
- A record that cannot be matched unambiguously is Unevaluated and prevents Pass when it belongs to the declared population.

### B.1 Observation schema (normative)

Each Observation records: `work_item_id`, `population_record_key`, `target_system`, `found` (`true` / `false` / `ambiguous`), declared attributes as `{name, original_value, normalized_value}`, `observed_at` (UTC), `step_id`, linked Evidence identifiers, and `capture_method`. Attributes the Procedure Version declares as required and which are absent make the Observation incomplete; an incomplete Observation is reported to the Evidence Quality Gate.

## C. Procedure Template Contracts

Each Template pre-populates the Procedure Builder. Auditors edit Templates into Procedures; the values below are defaults, not fixed logic. Scheduled periods derive as: daily → previous calendar day; weekly → previous Monday–Sunday; monthly → previous calendar month; once → the period the Auditor set.

### P-1: Terminated Users Retaining Access (hero, fully configurable)

- **Control:** Terminated employees must have their system access revoked.
- **Objective default:** Determine whether employees terminated in the period retain an active account in any Target System.
- **Population Source default:** Leavers spreadsheet; inclusion rule `employment_status = Terminated` and `termination_date within period`.
- **Target Systems default:** LoanCore and LedgerDesk.
- **Audit Instructions default:** “For each terminated employee, sign in to each Target System, search by employee ID (fall back to full name if no ID match), open the account record, and note whether an account exists, its status, username, and assigned roles. Capture a screenshot of the account page.”
- **Compliance Rule default (compiles deterministically):** Compliant when `found = false` or `account_status = disabled`; Exception when `account_status = active`.
- **Uncompiled condition supplied for golden testing:** “Treat any account whose roles look privileged as an Exception even if disabled.” This condition requires Agent-Judged classification and is present so SM-4 and FR-35 are exercised.
- **Escalation triggers seeded:** an account status value the rule does not name (`Suspended`), and a name-only match with two candidates.
- **Evidence Requirements default:** username, account_status, roles, screenshot of account page, source spreadsheet row.
- **Schedule default:** weekly.
- **Inconclusive:** any population record uninspected in any Target System, declared-count mismatch, missing required Evidence, or unresolved ambiguous match.
- **Template variant retained:** a 24-hour disablement-window rule (`disabled_time - termination_time <= 24h`, exactly 24 hours Compliant) is available as an alternative Compliance Rule when a Target System exposes `disabled_time`.

### P-2: Segregation-of-Duties Conflicts

- **Objective:** Determine whether any active account contains an explicitly prohibited permission pair.
- **Population Source:** AccessGate active accounts. **Target Systems:** AccessGate role detail; RoleMatrix as reference file.
- **Matching:** Role name to the versioned RoleMatrix; expand roles to permissions before comparison.
- **Compliant:** No prohibited pair exists for the account. **Exception:** At least one prohibited pair exists; report every pair.
- **Inconclusive:** Unknown role, incomplete role expansion, duplicate conflicting policy entries, or incomplete account population.
- **PoC conflict pairs:** `CREATE_VENDOR` + `APPROVE_VENDOR`; `CREATE_PAYMENT` + `RELEASE_PAYMENT`; `CONFIGURE_LIMITS` + `APPROVE_LOAN`.

### P-3: High-Value Transactions Without Required Approval

- **Objective:** Determine whether processed high-value transactions had valid approval before processing.
- **Population Source:** LedgerFlow processed transactions in USD ≥ 100,000 in the period. **Target System:** ApproveNow.
- **Matching key:** Exact transaction ID, with approval ID used as corroboration.
- **Compliant:** A matching `APPROVED` decision exists before processing and the approver's limit is at least the transaction amount.
- **Exception:** No approval, approval after processing, rejected approval, or insufficient approver limit.
- **Inconclusive:** Duplicate or contradictory approval decisions, missing transaction time, missing approval limit, or incomplete population.
- **Boundary:** USD 100,000 requires approval.

### P-4: Production Configuration Deviation

- **Objective:** Determine whether observed production parameters equal the approved baseline in effect at the observation time.
- **Population Source:** ConfigRegistry baseline parameters. **Target System:** ProdConsole.
- **Matching key:** Exact parameter name.
- **Compliant:** Observed and approved normalized values are equal. **Exception:** Value differs or an extra production parameter is explicitly prohibited by the baseline.
- **Inconclusive:** Required parameter absent from the observation, multiple effective baselines apply, observation is stale, or extraction is partial.
- **PoC parameters:** `max_manual_approval_amount`, `mfa_required_for_admin`, `session_timeout_minutes`, and `production_debug_mode`.

## D. Golden Dataset Requirements

Each Procedure's golden dataset must include:

- at least two compliant records;
- at least two true Exceptions;
- one exact boundary case;
- one missing mandatory value;
- one duplicate or ambiguous record;
- one stale or incomplete population;
- one record whose required Evidence cannot be captured (for example, account page fails to render);
- one simulated Target System, workspace, or connector failure;
- one prompt-like malicious string in retrieved content (file cell, page text, or desktop field) that must be treated as data;
- for the hero Procedure: one record requiring Agent-Judged classification that is correct, one that must be Unevaluated for low confidence, and one Escalation trigger.

Expected classifications are versioned separately from the executable rules so tests do not validate against the implementation that produced the Result. Hero-Procedure golden populations are deliberately small (≤ 20 records) so live execution is easy to observe.

## E. State Models and Outcome Rules

**Procedure Version states:** `DRAFT → SUBMITTED → APPROVED | REJECTED`; `REJECTED → DRAFT` on edit; `APPROVED → RETIRED` when a later version is approved. Only `APPROVED` versions can be run or scheduled.

**Run states:** `QUEUED → RUNNING`; `RUNNING ⇄ PAUSED`; `RUNNING → AWAITING_AUDITOR → RUNNING` (Escalation answered); terminal `COMPLETED | INCONCLUSIVE | RUN_FAILED | CANCELED`.

- `COMPLETED` means execution finished and can produce a Result of Pass, Control Failure, or Pending Confirmation.
- `INCONCLUSIVE` means Evidence exists but is insufficient or contradictory, or an Escalation timed out.
- `RUN_FAILED` means technical execution, including workspace creation, could not complete.
- `PAUSED` beyond its timeout and `AWAITING_AUDITOR` beyond its timeout transition to `CANCELED` and `INCONCLUSIVE` respectively, with reason recorded.

**Work Item states:** `PENDING → IN_PROGRESS → OBSERVED | UNINSPECTED | AMBIGUOUS | FAILED`.

**Review states:** `DRAFT → SUBMITTED → APPROVED → FINALIZED`. Rejection creates a new review event and returns the Result from `SUBMITTED` to `DRAFT` without deleting history. Only an `APPROVED` Result may be finalized; after finalization nothing on the Result, Exceptions, reviews, Timeline, or Evidence changes.

**Exception states:** `OPEN → UNDER_REVIEW → CONFIRMED | NOT_AN_EXCEPTION`. `NOT_AN_EXCEPTION` is a human disposition and never erases the classification that raised it.

**Classification origins:** `RULE_CLASSIFIED`, `AGENT_JUDGED` (with `confirmation: pending | confirmed | rejected`), `HUMAN_CLASSIFIED` (only after rejecting an Agent-Judged classification), `UNEVALUATED`.

### Normative Outcome Rules

| Evidence or execution state | Classification state | System Outcome | Permitted human action |
| --- | --- | --- | --- |
| Evidence Quality Gate passes | All records Rule-Classified or confirmed; no Exception counts | Pass | Approve, reject with rationale, or record disagreement |
| Evidence Quality Gate passes | Any Exception counts toward the outcome | Control Failure | Disposition Exceptions, approve, reject, or record disagreement |
| Evidence Quality Gate passes | Any Agent-Judged classification unconfirmed | Pending Confirmation | Confirm or reject each; cannot submit for approval |
| Evidence collected but insufficient, stale, incomplete, uninspected, ambiguous, or contradictory; or Escalation timed out | Not authoritative | Inconclusive | Diagnose and request a new Run; cannot submit |
| Workspace or Target System cannot be accessed, or execution cannot complete after bounded retries | Not completed | Run Failed | Diagnose and request a new Run; cannot submit |
| Run canceled | Not completed | Canceled | Request a new Run; cannot submit |

**Limit exhaustion mapping (normative):** exhausting a per-Step retry or time limit on one Work Item marks that Work Item `FAILED` and the Run continues; exhausting the Run-level step, time, or token limit stops the Run as `INCONCLUSIVE` with partial Evidence preserved; a limit breach caused by a denied action or scope violation stops the Run as `RUN_FAILED` and is logged as a security event.

Human dispositions and disagreements never alter Rule-Classified results or the System Outcome. Confirming or rejecting an Agent-Judged classification is not an override: it is the human decision the classification was waiting for, and it is recorded as such.

## F. Workpaper Bundle Minimum Contents

- Human-readable Run summary and Result, with initiator (Auditor or Schedule).
- Control reference, Procedure, and Procedure Version definition including Audit Instructions, compiled Compliance Rule, uncompiled conditions, Evidence Requirements, Target Systems, and the executable plan.
- Scope and effective period, with derivation for scheduled Runs.
- Evidence inventory and preserved original synthetic artifacts, screenshots, and Replay assets.
- Observations per Work Item.
- Evidence Quality Gate results, population reconciliation, and per-Target System coverage.
- Transformation and matching steps.
- Classification counts by origin: Rule-Classified, Agent-Judged (confirmed / rejected), human-classified, Unevaluated, unmatched, uninspected, excluded.
- Exception-level source lineage with Timeline position.
- Ordered Execution Timeline with sanitized tool actions, Escalations and answers, pauses, and component, model, and prompt versions.
- Agent-Judged rationales and their confirmations or rejections with rationale.
- Notes, dispositions, reviews, reviewer disagreements, and finalization record.
- Audit Trail excerpt and integrity manifest.

## G. Standards and Research Basis

The PRD requirements were informed by:

- [IIA Global Internal Audit Standards](https://www.theiia.org/en/standards/2024-standards/global-internal-audit-standards/) for relevant, reliable, sufficient, and reproducible audit evidence and for supervision of delegated work.
- [NIST AI Risk Management Framework Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) for defined human oversight, monitoring, change control, and accountability.
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) for scoped tools, least privilege, memory isolation, bounded execution, and auditability.
- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) for treating retrieved content as untrusted data.
- [NIST SP 800-171 Rev. 3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/800-171r3/NIST.SP.800-171r3.html) for security event logging, protection, and retention principles.

These sources guide product behavior but do not assert that the exploratory PoC is certified or compliant with any standard.

## H. Normative Evidence Quality Gate

These rules apply to every PoC Population Source and Target System unless a Procedure Version is stricter.

| Check | PoC rule | Failure outcome |
| --- | --- | --- |
| Workspace and Target System access | Agent Workspace is created and each required Target System sign-in succeeds within bounded retries | `RUN_FAILED` when access or execution cannot complete |
| Declared population | Population Source supplies an independently generated expected record count | `INCONCLUSIVE` when the declaration is absent or contradictory |
| Record-count reconciliation | Collected population count equals declared count exactly; tolerance is zero | `INCONCLUSIVE` on any mismatch |
| Per-record coverage | Every population record has an Observation with `found ∈ {true, false}` for every required Target System | `INCONCLUSIVE`; uninspected records are never Compliant |
| Required Evidence | Every Observation carries every Evidence Requirement | `INCONCLUSIVE`; affected records are not Compliant |
| Pagination / search completeness | All declared pages, rows, or search results are consumed once, without gaps or loops | `INCONCLUSIVE` when partial data is available; `RUN_FAILED` when acquisition cannot complete |
| Schema | Required fields and supported types match the Procedure Version | `INCONCLUSIVE` for missing or incompatible fields |
| Mandatory values | Every population record contains its matching key and required evaluation fields | `INCONCLUSIVE`; affected records are not Compliant |
| Duplicate primary keys | No duplicate Source primary key unless the Procedure Version explicitly permits versioned records | `INCONCLUSIVE` |
| Ambiguous match | A Target System search resolves to exactly one candidate, or an Escalation answer resolved it | `INCONCLUSIVE`; record Unevaluated |
| Freshness — snapshot Sources | Snapshot generation time is within the requested effective period and no earlier than 24 hours before Run initiation | `INCONCLUSIVE` when stale or unknown |
| Freshness — Target System Observations | Observation is captured during the Run | `INCONCLUSIVE` when stale |
| Integrity | Stored Evidence digest matches the digest computed at capture and export | `RUN_FAILED` when mutation or corruption is detected |

For synthetic file and API Sources, the declared count is generated independently from the Audit Runner. For ProdConsole, the controlled web page exposes a signed synthetic snapshot identifier and expected parameter count; the Audit Agent must extract both and reconcile them exactly.

## I. FR and NFR Migration Map (revision 1 → revision 2)

| Rev 1 | Rev 2 | Note |
| --- | --- | --- |
| FR-1, FR-2, FR-3 | FR-1, FR-2, FR-3 | Roles extended with authoring, approval, Escalation, confirmation |
| FR-4 | FR-4 | Preconfigured Procedures become Procedure Templates |
| FR-5 | FR-14 | Immutable Procedure Versions |
| FR-6 | FR-15 | Manual Run initiation |
| FR-7 | FR-17 | Run lifecycle gains Paused and Awaiting Auditor |
| FR-8 | FR-24 | Cancel and rerun |
| FR-9 | FR-28 | Evidence capture |
| FR-10 | FR-29 | Evidence Package lineage |
| FR-11 | FR-30 | Gate gains per-record coverage |
| FR-12 | FR-31 | Safe insufficient-evidence outcome |
| FR-13 | FR-32 | Evidence immutability |
| FR-14, FR-15 | FR-33 | Normalize and match |
| FR-16 | FR-34, FR-35 | Deterministic rules retained; Agent-Judged path added |
| FR-17 | FR-36 | Procedure outputs |
| FR-18 – FR-20 | FR-37 – FR-39 | Result, Exception investigation, Exception workflow |
| FR-21, FR-22 | FR-40 | Submit, approve, reject, finalize |
| FR-23 | FR-41 | Reviewer disagreement |
| FR-24 | FR-42 | Audit Trail |
| FR-25 | FR-26 | Execution trace becomes Execution Timeline |
| FR-26, FR-27 | FR-43, FR-44 | Workpaper Bundle and reproduction |
| FR-28, FR-29 | FR-45, FR-46 | Dashboard and diagnostics |
| FR-30 | FR-19, FR-21 | Bounded agentic acquisition proof is now the core execution model |
| FR-31 | FR-47 | Instrumentation reframed around setup-without-developer |
| — | FR-5 – FR-13, FR-16, FR-18, FR-20, FR-22, FR-23, FR-25, FR-27 | New: Builder, approval, scheduling, workspace, Work Items, Live View, pause, Escalation, Replay |
| NFR-1 – NFR-4 | NFR-1 – NFR-4 | NFR-4 now distinguishes Rule-Classified determinism from Agent-Judged re-examinability |
| NFR-5, NFR-6 | NFR-6, NFR-7 | Performance split for agentic versus file/API Runs; live responsiveness added |
| NFR-7 | NFR-8 | Reliability |
| NFR-8 – NFR-13 | NFR-10 – NFR-15 | Renumbered |
| — | NFR-5, NFR-9 | New: workspace isolation, Schedule reliability |

## J. Execution Environment Rationale (user-contributed)

Solari is important to the PoC specifically because it gives the Audit Agent the browser, desktop/sandbox environment, and session observability needed to actually perform the audit work rather than simply analyze data that has already been extracted. Its role is confined to providing the Agent Workspace and its recording; IntelliFin Audit's Execution Timeline and preserved Evidence remain the authoritative record, and the workspace contract must stay provider-replaceable (NFR-15). Revisit before any customer data: region, recording retention, maturity, and a private-runner path.
