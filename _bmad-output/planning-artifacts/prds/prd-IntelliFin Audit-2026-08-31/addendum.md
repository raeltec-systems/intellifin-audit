---
title: "IntelliFin Audit PoC — Product Detail Addendum"
status: draft
revision: 2
created: 2026-08-31
updated: 2026-09-01
---

# IntelliFin Audit PoC — Product Detail Addendum

This addendum preserves inferred product detail needed to make the PoC requirements testable, plus user-contributed depth that belongs downstream. It is not an architecture specification.

**Status legend:** `[ASSUMPTION]` means the product decision awaits explicit confirmation. "Normative" means the rule is binding for implementation and testing of this PoC draft, but it does not convert the underlying product decision into a confirmed long-term requirement.

## A. Synthetic Organization, Population Sources, and Target Systems

The fictional organization is **Northstar Financial Group**, a regulated lender with 500 synthetic employees.

### A.1 Population Sources

Every Population Source is acquired by a platform Adapter (FR-21) at the start of each Run; the Procedure Version freezes only the binding (FR-6). Every snapshot carries a declared row count, generation or version identifier, effective period, and integrity digest generated independently of the Audit Runner, so the Evidence Quality Gate can detect truncation or substitution.

| Source | Purpose | Binding | Declared count | Core records |
| --- | --- | --- | --- | --- |
| Leavers export | Weekly HR leavers export (`.xlsx`) published by HR to a registered location (Template P-1) | Versioned file; manual upload permitted for a `once` Schedule | Signed cover sheet (row count and digest) | Employee ID, name, department, employment status, termination effective date, manager |
| PeopleHub | HR system of record (alternative P-1 binding) | Read-only API | Count endpoint | Employee ID, name, employment status, termination effective time |
| AccessGate | Application identity store (Template P-2) | Read-only API or versioned CSV | Count endpoint or cover sheet | Account ID, employee ID, username, status, roles, disabled time |
| LedgerFlow | Transaction system (Template P-3) | Read-only API or versioned CSV | Count endpoint or cover sheet | Transaction ID, amount, currency, initiator, processed time, approval ID |
| ConfigRegistry | Approved configuration baseline (Template P-4) | Versioned file | Cover sheet | Parameter, approved value, effective time |

The Audit Agent may open a file Source in the workspace for the recording (UJ-3), but the Adapter's parse is the population of record.

### A.2 Target Systems and Reference Sources

| System | Role | Kind and acquisition path | What is done | Audit credential |
| --- | --- | --- | --- | --- |
| LoanCore | Target System (P-1) | Synthetic **web application** (loan origination and servicing) with a user-administration area; **agent-driven** | Sign in, search users by employee ID or name, open the account page, read status, username, roles, last login; platform captures screenshot bound to the read | Read-only audit account, no user-admin write rights |
| LedgerDesk | Target System (P-1) | Synthetic **desktop application** (finance ERP client) running in the sandbox desktop `[ASSUMPTION: platform decided by Open Question 3]`; **agent-driven** | Launch, sign in, open User Maintenance, search by employee ID, read status and role assignments; platform captures screenshot | Read-only audit account |
| AccessGate | Target System (P-2) | Read-only **API**; **adapter-acquired** | Extract role detail per active account in one extraction | Read-only API token |
| RoleMatrix | Reference Source (P-2) | Versioned file; consulted by the evaluator | Expand roles to permissions; no Work Items | None |
| ApproveNow | Target System (P-3) | Read-only **API**; **adapter-acquired** (`[ASSUMPTION]` controlled web extraction is an optional agent-driven variant) | Extract approval decisions for the transaction population | Read-only API token |
| ProdConsole | Target System (P-4) | Synthetic **web** configuration surface; **agent-driven** | Read parameter values and the signed snapshot identifier | Read-only |

Every Target System exposes only synthetic data, publishes an allowlisted origin or application identity, and refuses write actions from the audit credential at the system level, so that FR-3 is enforced by both the workspace and the system.

## B. Shared Data Rules

- All identifiers are strings and preserve leading zeros.
- All timestamps use ISO 8601 and are normalized to UTC; original offsets are retained.
- Money uses decimal amount plus ISO 4217 currency; the PoC avoids foreign-exchange conversion.
- Empty mandatory identifiers, duplicate primary keys, unparseable timestamps, and undeclared schema fields trigger Evidence Quality Gate events.
- Matching uses exact normalized identifiers. Fuzzy identity matching is out of scope; a Target System search that returns more than one candidate for a population record is an ambiguous match, and the record is Unevaluated unless a *choose candidate* Escalation resolved it to exactly one.
- A record that cannot be matched unambiguously is Unevaluated and prevents Pass when it belongs to the declared population.
- **Unnamed values (normative):** when a compiled condition meets an attribute value outside the set it names, the condition evaluates Unevaluated with diagnostic `rule does not name value <v>`; the platform raises an *unnamed value* Escalation (answers: mark Unevaluated and continue; abort). No answer maps the value.
- **Exception fingerprint compatibility (normative):** two Procedure Versions are compatible for cross-Run fingerprints when they share the Procedure, the matching key, and the Compliance Rule digest. Compatibility is declared by the builder on approval and shown on the version.

### B.1 Observation schema (normative)

Each Observation records: `work_item_id`, `population_record_key`, `target_system`, `found` (`true` / `false` / `ambiguous`), `observed_at` (UTC), `step_execution_id`, `capture_method` (`agent` / `adapter`), linked Evidence identifiers, and declared attributes.

Each declared attribute is `{name, original_value, normalized_value, grounding, corroboration}` where:

- `grounding` is `{evidence_id, locator, extracted_text}`; `locator` is an accessibility-tree or DOM path (web), a window and control identifier (desktop), or a sheet and cell reference (file). An attribute without grounding is absent.
- `corroboration` is set by the Evidence Quality Gate: `matched` when the deterministic extractor's re-read of `locator` equals `original_value`; `contradictory` otherwise; `model_read` when the Procedure Version declares the attribute readable only by a model, in which case any condition over it is Agent-Judged.

**Absence Observation (normative):** `found = false` requires Evidence of every declared search key tried, the exact query string used for each, and the Target System's captured empty-result response for each, plus a passing search-completeness check (§H). Otherwise the Work Item is `UNINSPECTED`.

**Per-condition evaluations (normative):** each record carries one evaluation per Compliance Rule condition: `{condition_id, origin ∈ {RULE, AGENT_JUDGED, HUMAN, UNEVALUATED}, value ∈ {COMPLIANT, EXCEPTION, UNEVALUATED}, confirmation (Agent-Judged only) ∈ {pending, confirmed, rejected}, confidence ∈ [0,1] (Agent-Judged only), rationale, evidence_ids, diagnostic}`. Record evaluation derives from the conditions per FR-9.

## C. Procedure Template Contracts

Each Template pre-populates the Procedure Builder. Auditors edit Templates into Procedures; the values below are defaults, not fixed logic. Scheduled periods derive as: daily → previous calendar day; weekly → previous Monday–Sunday; monthly → previous calendar month; once → the period the Auditor set. Work Item coverage per Template is stated so §H per-record coverage is testable for each.

### P-1: Terminated Users Retaining Access (hero, fully configurable)

- **Control:** Terminated employees must have their system access revoked.
- **Objective default:** Determine whether employees terminated in the period retain an active account in any Target System.
- **Population Source default:** Leavers export (versioned file); inclusion rule `employment_status = Terminated and termination_date within period`, applied by the Adapter.
- **Target Systems default:** LoanCore (web, agent-driven) and LedgerDesk (desktop, agent-driven). Execution order: all records in LoanCore, then all records in LedgerDesk (FR-20).
- **Work Item coverage:** one Work Item per population record per Target System.
- **Audit Instructions default:** "For each terminated employee, sign in to each Target System, search by employee ID, and if there is no ID match search by full name. Open the account record and note whether an account exists, its status, username, and assigned roles."
- **Compliance Rule default:** condition C1 (compiles): Compliant when `found = false` (proven absence) or `account_status = disabled`; Exception when `account_status = active`; any other status → Unevaluated (unnamed value). Condition C2 (Agent-Judged): "Treat any account whose roles look privileged as an Exception even if disabled." C2 applies to every found account; a found account with no C2 evaluation is a Gate failure.
- **Escalation triggers seeded:** a name-only match with two candidates (*choose candidate*); an account with status `Suspended` (*unnamed value*; expected terminal outcome Inconclusive with diagnostic); a search timeout (*retry or skip*).
- **Evidence Requirements default:** username, account_status, roles (each grounded), platform screenshot of the account page bound to the read, source export row.
- **Schedule default:** weekly.
- **Inconclusive:** any population record uninspected in any Target System, declared-count mismatch at file or inclusion level, missing required Evidence, contradictory corroboration, unproven absence, unresolved ambiguous match, unnamed value, or missing C2 evaluation.
- **Template variant retained:** a 24-hour disablement-window rule (`disabled_time - termination_time <= 24h`, exactly 24 hours Compliant) is available as an alternative C1 when a Target System exposes `disabled_time`; the §D boundary case for P-1 targets this variant.

### P-2: Segregation-of-Duties Conflicts

- **Objective:** Determine whether any active account contains an explicitly prohibited permission pair.
- **Population Source:** AccessGate active accounts (Adapter). **Target System:** AccessGate role detail (Adapter). **Reference Source:** RoleMatrix.
- **Work Item coverage:** one adapter Work Item covering the whole population; per-record coverage is satisfied when every population account appears in the extraction with a grounded role list.
- **Matching:** Role name to the versioned RoleMatrix; expand roles to permissions before comparison.
- **Compliant:** No prohibited pair exists for the account. **Exception:** At least one prohibited pair exists; report every pair.
- **Inconclusive:** Unknown role, incomplete role expansion, duplicate conflicting policy entries, or incomplete account population.
- **PoC conflict pairs:** `CREATE_VENDOR` + `APPROVE_VENDOR`; `CREATE_PAYMENT` + `RELEASE_PAYMENT`; `CONFIGURE_LIMITS` + `APPROVE_LOAN`.

### P-3: High-Value Transactions Without Required Approval

- **Objective:** Determine whether processed high-value transactions had valid approval before processing.
- **Population Source:** LedgerFlow processed transactions in USD ≥ 100,000 in the period (Adapter). **Target System:** ApproveNow (Adapter).
- **Work Item coverage:** one adapter Work Item per extraction; per-record coverage is satisfied when every population transaction has a grounded approval lookup result (found or proven absent).
- **Matching key:** Exact transaction ID, with approval ID used as corroboration.
- **Compliant:** A matching `APPROVED` decision exists before processing and the approver's limit is at least the transaction amount.
- **Exception:** No approval, approval after processing, rejected approval, or insufficient approver limit.
- **Inconclusive:** Duplicate or contradictory approval decisions, missing transaction time, missing approval limit, or incomplete population.
- **Boundary:** USD 100,000 requires approval (inclusive); this is the PoC's exercised tolerance boundary (FR-9).

### P-4: Production Configuration Deviation

- **Objective:** Determine whether observed production parameters equal the approved baseline in effect at the observation time.
- **Population Source:** ConfigRegistry baseline parameters (Adapter). **Target System:** ProdConsole (web, agent-driven).
- **Work Item coverage:** one agent Work Item per parameter; the ProdConsole page read is one Step Execution whose grounded parameter values populate each Work Item's Observation.
- **Matching key:** Exact parameter name.
- **Compliant:** Observed and approved normalized values are equal. **Exception:** Value differs or an extra production parameter is explicitly prohibited by the baseline.
- **Inconclusive:** Required parameter absent from the observation, multiple effective baselines apply, observation is stale, or extraction is partial.
- **PoC parameters:** `max_manual_approval_amount`, `mfa_required_for_admin`, `session_timeout_minutes`, and `production_debug_mode`.

## D. Golden Dataset Requirements

Each Procedure's golden dataset must include, each with a declared expected **terminal** outcome (Pass, Control Failure, Inconclusive, or Run Failed) so SM-5 is measured on terminal outcomes, not on whether an Escalation was raised:

- at least two compliant records;
- at least two true Exceptions;
- one exact boundary case (for P-1 the 24-hour variant);
- one missing mandatory value;
- one duplicate or ambiguous record;
- one stale or incomplete population;
- one record whose required Evidence cannot be captured (for example, account page fails to render);
- one simulated Target System, workspace, or Adapter failure;
- one prompt-like malicious string in retrieved content (file cell, page text, or desktop field) that must be treated as data, and one that attempts to shape an Escalation question;
- one seeded transcription error (the screen shows `Active`; the agent is induced to record `disabled`) that must be caught by corroboration and yield Inconclusive;
- one silent-timeout or partial-pagination case for a search that must yield an Uninspected Work Item and Inconclusive, never a Compliant absence;
- three seeded scope-widening Audit Instructions (an unregistered system, a write verb, an out-of-scope origin) that must be flagged at authoring and denied at execution;
- for the hero Procedure: one record whose C2 evaluation is correct; one record whose role list is genuinely ambiguous, accepted as Unevaluated, escalated, or correctly evaluated and failed only if confidently wrong; one *choose candidate* trigger; and one `Suspended` account (expected terminal outcome Inconclusive).

Expected evaluations are versioned separately from the executable rules so tests do not validate against the implementation that produced the Result. Every golden dataset is run at least twice for SM-4 consistency. Hero-Procedure golden populations are deliberately small (≤ 20 records) so live execution is easy to observe.

## E. State Models and Outcome Rules

**Procedure Version states:** `DRAFT → SUBMITTED → APPROVED | REJECTED`; `REJECTED → DRAFT` on edit; `APPROVED → ACTIVE` immediately, or after the FR-15 regression Run where required; `ACTIVE → RETIRED` at the first period boundary after a later version becomes `ACTIVE`. Only `ACTIVE` versions run or schedule. Platform-authored drafts (model, prompt, or tool change) follow the same states.

**Run states:** `QUEUED → RUNNING`; `RUNNING ⇄ PAUSED`; `RUNNING → AWAITING_AUDITOR → RUNNING` (Escalation answered); terminal `COMPLETED | INCONCLUSIVE | RUN_FAILED | CANCELED`. *Active* = `QUEUED`, `RUNNING`, `PAUSED`, `AWAITING_AUDITOR`; cancel is permitted from any active state. Pause is permitted from `RUNNING` only.

- `COMPLETED` means execution finished; its Result is Pending Confirmation until sealed, then Pass or Control Failure.
- `INCONCLUSIVE` means Evidence exists but is insufficient, contradictory, uncorroborated, or leaves a record Unevaluated; or a Pause or Escalation timed out.
- `RUN_FAILED` means Run-level technical execution could not complete: workspace creation, Target System sign-in, Population Source acquisition, or a denied action.
- `PAUSED` and `AWAITING_AUDITOR` beyond their timeouts transition to `INCONCLUSIVE` with reason recorded and Evidence preserved; `CANCELED` is reserved for explicit human cancellation.

**Work Item states:** `PENDING → IN_PROGRESS → OBSERVED | UNINSPECTED | AMBIGUOUS | FAILED`; `AMBIGUOUS → IN_PROGRESS` when a *choose candidate* answer resolves it; `FAILED` and `UNINSPECTED` feed the §H coverage check.

**Session Steps:** Population Source acquisition, Target System sign-in, and Adapter extraction are Run-level Session Steps; their failure after bounded retries yields `RUN_FAILED`.

**Review states:** `DRAFT → SUBMITTED → APPROVED → FINALIZED`. Rejection creates a new review event and returns the Result from `SUBMITTED` to `DRAFT` without deleting history. Only an `APPROVED` Result may be finalized; after finalization nothing on the Result, Exceptions, reviews, Timeline, or Evidence changes.

**Exception states:** `OPEN → UNDER_REVIEW → CONFIRMED | NOT_AN_EXCEPTION`. `NOT_AN_EXCEPTION` is a human disposition and never erases the evaluation that raised it.

**Evaluation origins (per condition):** `RULE`, `AGENT_JUDGED` (with `confirmation: pending | confirmed | rejected`), `HUMAN` (only after rejecting an Agent-Judged evaluation), `UNEVALUATED`.

**Result sealing (normative):** a Result seals when the Evidence Quality Gate has passed and no condition evaluation is `pending`. The Result version increments on each confirmation or rejection before sealing. The System Outcome is computed once at sealing and is immutable thereafter.

### Normative Outcome Rules

Rows apply in order; the first matching row wins.

| Evidence or execution state | Evaluation state | Result outcome | Permitted human action |
| --- | --- | --- | --- |
| Run canceled | Not completed | Canceled (Run state) | Request a new Run; cannot submit |
| Run-level failure after bounded retries, or denied action | Not completed | Run Failed (Run state) | Diagnose and request a new Run; cannot submit |
| Evidence Quality Gate fails (coverage, count, corroboration, absence, schema, freshness, ambiguity, unnamed value, missing C2 evaluation); or Pause or Escalation timed out | Not authoritative | Inconclusive (Run state) | Diagnose and request a new Run; cannot submit |
| Gate passes | Any Agent-Judged evaluation `pending` | Pending Confirmation (unsealed) | Confirm or reject each; cannot submit |
| Gate passes, sealed | Any condition on any record `UNEVALUATED` and no Exception counts | Inconclusive (Run state) | Diagnose and request a new Run; cannot submit |
| Gate passes, sealed | Any Exception counts toward the outcome | Control Failure, with any Unevaluated records listed | Disposition Exceptions, approve, reject, or record disagreement |
| Gate passes, sealed | Every condition on every record Compliant | Pass | Approve, reject with rationale, or record disagreement |

**Limit exhaustion mapping (normative):** exhausting retries or the time limit on one Step Execution marks its Work Item `FAILED` and the Run continues to a coverage-failure `INCONCLUSIVE`; exhausting the Run-level Step Execution, time, or token limit stops the Run as `INCONCLUSIVE` with partial Evidence preserved; a limit breach caused by a denied action or scope violation stops the Run as `RUN_FAILED` and is logged as a security event.

Human dispositions and disagreements never alter Rule-Classified evaluations or the sealed System Outcome. Confirming or rejecting an Agent-Judged evaluation is not an override: it is the human decision the evaluation was waiting for, and it is recorded as such.

## F. Workpaper Bundle Minimum Contents and Replay Asset Set

- Human-readable Run summary and Result, with initiator (Auditor or Schedule).
- Control reference, Procedure, and Procedure Version definition including Audit Instructions, compiled conditions, Agent-Judged conditions, Evidence Requirements, Target Systems and kinds, Population Source binding, and the executable plan.
- Scope and effective period, with derivation for scheduled Runs.
- Acquired Population Source snapshot with digest, generation time, declared count, and inclusion reconciliation (rows in, included, excluded with reason).
- Evidence inventory and preserved original synthetic artifacts, screenshots, and the Replay asset set.
- Observations per Work Item, with grounding and corroboration results.
- Evidence Quality Gate results, population reconciliation, and per-Target System coverage.
- Transformation and matching steps.
- Evaluation counts by condition and origin: Rule-Classified, Agent-Judged (pending / confirmed / rejected), human-classified, Unevaluated, unmatched, uninspected, excluded.
- Exception-level source lineage with Timeline position.
- Ordered Execution Timeline with Session Steps, Work Items, sanitized Tool Actions, Escalations and answers, notifications, pauses, and component, model, and prompt versions.
- Agent-Judged rationales and their confirmations or rejections with rationale.
- Notes, dispositions, reviews, reviewer disagreements, and finalization record.
- Audit Trail excerpt and integrity manifest.

**Replay asset set (normative, platform-owned):** per Tool Action, a timestamped screenshot or frame, the sanitized action, and the Observation delta; per Escalation, the question, options, answer, actor, and time; per Session Step, start, end, and outcome. This set is sufficient to render FR-30 Replay with no Workspace Provider call. Provider video is supplementary and may be linked while retained.

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
| Workspace and Target System access | Agent Workspace is created and each required Target System sign-in succeeds within bounded retries | `RUN_FAILED` |
| Population acquisition | The Adapter acquires the bound Population Source snapshot and its independently generated declared count and digest | `RUN_FAILED` when acquisition cannot complete; `INCONCLUSIVE` when the declaration is absent or contradictory |
| Record-count reconciliation — file level | Rows parsed equal the declared row count exactly; digest matches; tolerance is zero | `INCONCLUSIVE` on any mismatch |
| Record-count reconciliation — inclusion level | Rows in = rows included + rows excluded, every exclusion carries a reason, and the included set is the population of record | `INCONCLUSIVE` on any unaccounted row |
| Empty population | Post-inclusion population is non-empty, unless the Procedure Version opts in to a zero-record Pass | `INCONCLUSIVE` |
| Per-record coverage | Every population record has an Observation with `found ∈ {true, false}` for every required Target System, per the Template's coverage rule (§C) | `INCONCLUSIVE`; uninspected records are never Compliant |
| Search completeness (absence) | Every `found = false` Observation carries every declared search key, its query string, and the captured empty result; all result pages were consumed | `INCONCLUSIVE`; the Work Item is `UNINSPECTED` |
| Required Evidence | Every Observation carries every Evidence Requirement, each attribute grounded | `INCONCLUSIVE`; affected records are not Compliant |
| Observation corroboration | For every attribute not declared model-read, the deterministic extractor's re-read of the grounding equals `original_value` | `INCONCLUSIVE`; attribute `contradictory`, record Unevaluated |
| Condition completeness | Every applicable condition has an evaluation for every record; no uncompiled condition is silently skipped | `INCONCLUSIVE` |
| Pagination / extraction completeness | All declared pages, rows, or search results are consumed once, without gaps or loops | `INCONCLUSIVE` when partial data is available; `RUN_FAILED` when acquisition cannot complete |
| Schema | Required fields and supported types match the Procedure Version | `INCONCLUSIVE` for missing or incompatible fields |
| Mandatory values | Every population record contains its matching key and required evaluation fields | `INCONCLUSIVE`; affected records are not Compliant |
| Duplicate primary keys | No duplicate Source primary key unless the Procedure Version explicitly permits versioned records | `INCONCLUSIVE` |
| Ambiguous match | A Target System search resolves to exactly one candidate, or a *choose candidate* Escalation answer resolved it | `INCONCLUSIVE`; record Unevaluated |
| Unnamed value | Every compiled condition met only values it names | `INCONCLUSIVE`; record Unevaluated, diagnostic names the value |
| Freshness — snapshot Sources | The acquired snapshot's generation time is no earlier than the end of the effective period and no later than Run initiation, so the snapshot covers the period | `INCONCLUSIVE` when stale, future-dated, or unknown |
| Freshness — Target System Observations | Observation is captured during the Run | `INCONCLUSIVE` when stale |
| Integrity | Stored Evidence digest matches the digest computed at capture and export | `RUN_FAILED` when mutation or corruption is detected |

For synthetic file and API Sources, the declared count is generated independently from the Audit Runner. For ProdConsole, the controlled web page exposes a signed synthetic snapshot identifier and expected parameter count; the Audit Agent must extract both and the Gate reconciles them exactly.

## I. FR and NFR Migration Map (revision 1 → revision 2)

| Rev 1 | Rev 2 | Note |
| --- | --- | --- |
| FR-1, FR-2, FR-3 | FR-1, FR-2, FR-3 | Roles extended with authoring, approval, Escalation, confirmation, flagging |
| FR-4 | FR-4 | Preconfigured Procedures become Procedure Templates |
| FR-5 | FR-14 | Immutable Procedure Versions |
| FR-6 | FR-16 | Manual Run initiation |
| FR-7 | FR-18 | Run lifecycle gains Paused and Awaiting Auditor |
| FR-8 | FR-26 | Cancel and rerun |
| FR-9 | FR-31 | Evidence capture, now grounded |
| FR-10 | FR-32 | Evidence Package lineage |
| FR-11 | FR-33 | Gate gains per-record coverage, corroboration, absence, condition completeness |
| FR-12 | FR-34 | Safe insufficient-evidence outcome |
| FR-13 | FR-35 | Evidence immutability |
| FR-14, FR-15 | FR-36 | Normalize and match |
| FR-16 | FR-37, FR-38 | Deterministic rules retained per condition; Agent-Judged path added |
| FR-17 | FR-39 | Procedure outputs |
| FR-18 – FR-20 | FR-40 – FR-42 | Result summary and sealing, Exception investigation, Exception workflow |
| FR-21, FR-22 | FR-43 | Submit, approve, reject, finalize |
| FR-23 | FR-44 | Reviewer disagreement |
| FR-24 | FR-45 | Audit Trail |
| FR-25 | FR-29 | Execution trace becomes Execution Timeline |
| FR-26, FR-27 | FR-46, FR-47 | Workpaper Bundle and reproduction |
| FR-28, FR-29 | FR-48, FR-49 | Dashboard and diagnostics |
| FR-30 | FR-20, FR-23 | Bounded agentic acquisition proof is now the core execution model |
| FR-31 | FR-50 | Instrumentation reframed around setup-without-developer and cost |
| — | FR-5 – FR-13, FR-15, FR-17, FR-19, FR-21, FR-22, FR-24, FR-25, FR-27, FR-28, FR-30 | New: Builder, approval, regression Run, scheduling, workspace, Adapter acquisition, Work Items, Live View, pause, Escalation, notification, Replay |
| NFR-1 – NFR-4 | NFR-1 – NFR-4 | NFR-4 now distinguishes Rule-Classified determinism from Agent-Judged re-examinability |
| NFR-5, NFR-6 | NFR-6, NFR-7 | Performance split for agent-driven versus adapter-acquired Runs; live responsiveness added |
| NFR-7 | NFR-8 | Reliability, scoped by Run level versus Work Item level |
| NFR-8 – NFR-13 | NFR-10 – NFR-15 | Renumbered; NFR-15 gains the Adapter contract |
| — | NFR-5, NFR-9 | New: workspace isolation, Schedule reliability |

## J. Execution Environment Rationale (user-contributed)

Solari is important to the PoC specifically because it gives the Audit Agent the browser, desktop/sandbox environment, and session observability needed to actually perform the audit work rather than simply analyze data that has already been extracted. Its role is confined to providing the Agent Workspace and its recording; IntelliFin Audit's Execution Timeline, Replay asset set, and preserved Evidence remain the authoritative record, and the workspace contract must stay provider-replaceable (NFR-15). Revisit before any customer data: region, recording retention, maturity, and a private-runner path.
