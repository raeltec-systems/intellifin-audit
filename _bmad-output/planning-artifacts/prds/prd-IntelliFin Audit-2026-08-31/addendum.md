---
title: "IntelliFin Audit PoC — Product Detail Addendum"
status: final
created: 2026-08-31
updated: 2026-09-01
---

# IntelliFin Audit PoC — Product Detail Addendum

This addendum preserves inferred product detail needed to make the PoC requirements testable. It is not an architecture specification.

**Status legend:** `[ASSUMPTION]` means the product decision awaits explicit confirmation. “Normative” means the rule is binding for implementation and testing of this PoC draft, but it does not convert the underlying product decision into a confirmed long-term requirement.

## A. Synthetic Organization and Sources

The fictional organization is **Northstar Financial Group**, a regulated lender with 500 synthetic employees.

| Source | Purpose | Minimum acquisition mode | Core records |
| --- | --- | --- | --- |
| PeopleHub | HR system of record | Read-only API or controlled web export | Employee ID, name, employment status, termination effective time |
| AccessGate | Application identity store | Read-only API or CSV | Account ID, employee ID, username, status, roles, disabled time |
| RoleMatrix | Approved access policy | Versioned file | Role, permission, conflicting permission pairs |
| LedgerFlow | Transaction system | Read-only API or CSV | Transaction ID, amount, currency, initiator, processed time, approval ID |
| ApproveNow | Approval system | Read-only API or controlled web extraction | Approval ID, transaction ID, approver, decision, time, approval limit |
| ConfigRegistry | Approved configuration baseline | Versioned file | Parameter, approved value, effective time |
| ProdConsole | Production configuration surface | Controlled web extraction or API | Parameter, observed value, observation time |

Every synthetic dataset includes a declared record count, generation/version identifier, effective period, and integrity digest so that the Evidence Quality Gate can detect truncation or substitution.

## B. Shared Data Rules

- All identifiers are strings and preserve leading zeros.
- All timestamps use ISO 8601 and are normalized to UTC; original offsets are retained.
- Money uses decimal amount plus ISO 4217 currency; the PoC avoids foreign-exchange conversion.
- Empty mandatory identifiers, duplicate primary keys, unparseable timestamps, and undeclared schema fields trigger Evidence Quality Gate events.
- Matching uses exact normalized identifiers. Fuzzy identity matching is out of scope.
- A record that cannot be matched unambiguously is unevaluated and prevents Pass when it belongs to the declared population.

## C. Procedure Contracts

### P-1: Terminated Users Retaining Access

- **Objective:** Determine whether accounts belonging to terminated employees were disabled within 24 hours of termination.
- **Sources:** PeopleHub and AccessGate.
- **Population:** Employees whose status is `TERMINATED` and termination time falls within the Run’s effective period.
- **Matching key:** Exact employee ID.
- **Compliant:** Every matched account is disabled no later than 24 hours after termination.
- **Exception:** An account is active after the deadline or was disabled more than 24 hours after termination.
- **Inconclusive:** Missing termination time, ambiguous employee match, missing account-population completeness evidence, or inaccessible Source.
- **Boundary:** Exactly 24 hours is Compliant.

### P-2: Segregation-of-Duties Conflicts

- **Objective:** Determine whether any active account contains an explicitly prohibited permission pair.
- **Sources:** AccessGate and RoleMatrix.
- **Population:** Active accounts and their effective roles at the Run observation time.
- **Matching:** Role name to the versioned RoleMatrix; expand roles to permissions before comparison.
- **Compliant:** No prohibited pair exists for the account.
- **Exception:** At least one prohibited permission pair exists; report every pair.
- **Inconclusive:** Unknown role, incomplete role expansion, duplicate conflicting policy entries, or incomplete account population.
- **PoC conflict pairs:** `CREATE_VENDOR` + `APPROVE_VENDOR`; `CREATE_PAYMENT` + `RELEASE_PAYMENT`; `CONFIGURE_LIMITS` + `APPROVE_LOAN`.

### P-3: High-Value Transactions Without Required Approval

- **Objective:** Determine whether processed high-value transactions had valid approval before processing.
- **Sources:** LedgerFlow and ApproveNow.
- **Population:** Processed transactions in USD with amount greater than or equal to USD 100,000 during the Run’s effective period.
- **Matching key:** Exact transaction ID, with approval ID used as corroboration.
- **Compliant:** A matching `APPROVED` decision exists before processing and the approver's limit is at least the transaction amount.
- **Exception:** No approval, approval after processing, rejected approval, or insufficient approver limit.
- **Inconclusive:** Duplicate or contradictory approval decisions, missing transaction time, missing approval limit, or incomplete population.
- **Boundary:** USD 100,000 requires approval.

### P-4: Production Configuration Deviation

- **Objective:** Determine whether observed production parameters equal the approved baseline in effect at the observation time.
- **Sources:** ConfigRegistry and ProdConsole.
- **Population:** Every required parameter in the baseline effective at observation time.
- **Matching key:** Exact parameter name.
- **Compliant:** Observed and approved normalized values are equal.
- **Exception:** Value differs or an extra production parameter is explicitly prohibited by the baseline.
- **Inconclusive:** Required parameter is absent from the observation, multiple effective baselines apply, observation is stale, or extraction is partial.
- **PoC parameters:** `max_manual_approval_amount`, `mfa_required_for_admin`, `session_timeout_minutes`, and `production_debug_mode`.

## D. Golden Dataset Requirements

Each Procedure’s golden dataset must include:

- at least two Compliant records;
- at least two true Exceptions;
- one exact boundary case;
- one missing mandatory value;
- one duplicate or ambiguous record;
- one stale or incomplete population;
- one simulated Source or connector failure;
- one prompt-like malicious string in retrieved content that must be treated as data.

Expected classifications are versioned separately from the executable rules so tests do not validate against the implementation that produced the Result.

## E. Result and Exception State Models

**Run states:** `QUEUED → RUNNING → COMPLETED | INCONCLUSIVE | RUN_FAILED | CANCELED`.

- `COMPLETED` means execution finished and can produce a Result of Pass or Control Failure.
- `INCONCLUSIVE` means Evidence exists but is insufficient or contradictory.
- `RUN_FAILED` means technical execution could not complete.

**Review states:** `DRAFT → SUBMITTED → APPROVED → FINALIZED`. Rejection creates a new review event and returns the Result from `SUBMITTED` to `DRAFT` without deleting history.

- Only an `APPROVED` Result may be finalized.
- A Result cannot move directly from `SUBMITTED` or `REJECTED` to `FINALIZED`.
- After finalization, the system must not allow changes to Results, Exceptions, reviews, or Evidence.

**Exception states:** `OPEN → UNDER_REVIEW → CONFIRMED | NOT_AN_EXCEPTION`.

- `NOT_AN_EXCEPTION` is a human disposition and never erases the deterministic rule outcome.

### Normative Outcome Rules

| Evidence or execution state | Deterministic evaluation | System Outcome | Permitted human action |
| --- | --- | --- | --- |
| Evidence Quality Gate passes | No Exceptions | Pass | Approve, reject with rationale, or record disagreement |
| Evidence Quality Gate passes | One or more Exceptions | Control Failure | Disposition Exceptions, approve, reject, or record disagreement |
| Evidence collected but insufficient, stale, incomplete, ambiguous, or contradictory | Not authoritative | Inconclusive | Diagnose and request a new Run; cannot submit for approval |
| Required Source cannot be accessed or execution cannot complete after bounded retries | Not completed | Run Failed | Diagnose and request a new Run; cannot submit for approval |
| Run canceled | Not completed | Canceled | Request a new Run; cannot submit for approval |

Human dispositions and disagreements never alter the System Outcome in the PoC. They add accountable review context. Any future ability to override the System Outcome requires a new product decision and a Procedure governance model.

## F. Workpaper Bundle Minimum Contents

- Human-readable Run summary and Result.
- Procedure and Procedure Version definition.
- Scope and effective period.
- Evidence inventory and preserved original synthetic artifacts.
- Evidence Quality Gate results and population reconciliation.
- Transformation and matching steps.
- Compliant, Exception, excluded, unmatched, and unevaluated record counts.
- Exception-level source lineage.
- Ordered execution trace with sanitized tool calls and component versions.
- Notes, dispositions, reviews, reviewer disagreements, and finalization record.
- Audit Trail excerpt and integrity manifest.

## G. Standards and Research Basis

The PRD requirements were informed by:

- [IIA Global Internal Audit Standards](https://www.theiia.org/en/standards/2024-standards/global-internal-audit-standards/) for relevant, reliable, sufficient, and reproducible audit evidence.
- [NIST AI Risk Management Framework Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) for defined human oversight, monitoring, change control, and accountability.
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) for scoped tools, least privilege, memory isolation, bounded execution, and auditability.
- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) for treating retrieved content as untrusted data.
- [NIST SP 800-171 Rev. 3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/800-171r3/NIST.SP.800-171r3.html) for security event logging, protection, and retention principles.

These sources guide product behavior but do not assert that the exploratory PoC is certified or compliant with any standard.

## H. Normative Evidence Quality Gate

These rules apply to every PoC Source unless a Procedure contract is stricter.

| Check | PoC rule | Failure outcome |
| --- | --- | --- |
| Source access | Required Source responds and acquisition completes within bounded retries | `RUN_FAILED` when access or execution cannot complete |
| Declared population | Source artifact or response supplies an independently generated expected record count | `INCONCLUSIVE` when the declaration is absent or contradictory |
| Record-count reconciliation | Collected count equals declared count exactly; tolerance is zero | `INCONCLUSIVE` on any mismatch |
| Pagination | All declared pages or continuation tokens are consumed once, without gaps or loops | `INCONCLUSIVE` when partial data is available; `RUN_FAILED` when acquisition cannot complete |
| Schema | Required fields and supported types match the Procedure Version | `INCONCLUSIVE` for missing or incompatible fields |
| Mandatory values | Every population record contains its Procedure's matching key and required evaluation fields | `INCONCLUSIVE`; affected records are not classified Compliant |
| Duplicate primary keys | No duplicate Source primary key unless the Procedure contract explicitly permits versioned records | `INCONCLUSIVE` |
| Freshness—snapshot Sources | Snapshot generation time is within the requested effective period and no earlier than 24 hours before Run initiation | `INCONCLUSIVE` when stale or unknown |
| Freshness—ProdConsole | Observation is captured during the Run and no more than five minutes before its quality check | `INCONCLUSIVE` when stale |
| Integrity | Stored Evidence digest matches the digest computed at collection and export | `RUN_FAILED` when mutation or corruption is detected |

For synthetic file and API Sources, the declared count is generated independently from the test runner. For ProdConsole, the controlled web page exposes a signed synthetic snapshot identifier and expected parameter count; the Audit Runner must extract both and reconcile them exactly.
