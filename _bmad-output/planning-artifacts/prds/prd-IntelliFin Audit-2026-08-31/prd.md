---
title: "Product Requirements Document: IntelliFin Audit"
status: final
created: 2026-08-31
updated: 2026-09-01
---

# Product Requirements Document: IntelliFin Audit

## 0. Document Purpose

This PRD defines the exploratory proof of concept (PoC) for product, design, engineering, audit, and downstream planning teams. It turns the [IntelliFin Audit product brief](../../briefs/brief-IntelliFin%20Audit-2026-08-31/brief.md) into testable product requirements. The PoC must prove four preconfigured audit procedures through a web application and background Audit Runners while establishing reusable product foundations. Domain and synthetic-data details are in [addendum.md](addendum.md). Inferred decisions are tagged `[ASSUMPTION]` and indexed in §12.

## 1. Vision and Product Thesis

IntelliFin Audit is an audit-native execution and evidence platform that turns auditor-approved procedures into repeatable, governed tests across enterprise systems. It gathers read-only evidence, validates its quality, performs deterministic control tests, identifies exceptions, and gives auditors a traceable basis for review.

The PoC tests one thesis: IntelliFin Audit can reduce repetitive audit execution work without weakening professional judgment or evidence standards. Its value is not generic AI or continuous monitoring. Its value is a reproducible chain from approved procedure to source evidence, transformation, result, exception, and Auditor Review.

The PoC succeeds only when it demonstrates trustworthy failure behavior as well as correct results. Missing, stale, incomplete, contradictory, or inaccessible evidence must never yield a Pass.

## 2. Target Users and Jobs

### 2.1 Users and Stakeholders

- **Economic buyer:** Chief Audit Executive or Head of Internal Audit.
- **Primary user:** Auditor, including internal auditors and IT auditors, who runs procedures, investigates Exceptions, and reviews Results.
- **Oversight user:** Audit Manager, who monitors Runs and performs Auditor Review.
- **System operator:** PoC Administrator, who manages synthetic Sources and user access without changing finalized Results.
- **Non-users for the PoC:** Risk, Compliance, audit-services firms, control owners, and external auditors.

### 2.2 Jobs to Be Done

- Execute approved control tests consistently without manually collecting and comparing every item of Evidence.
- Determine whether the Evidence is sufficient before relying on a Result.
- See why a Result was reached and trace every Exception to its source records and rule.
- Distinguish a Control Failure from a Run Failed or Inconclusive outcome.
- Review, annotate, approve, or reject Results while preserving professional accountability.
- Reproduce a Run from its frozen Evidence Package without reviewing the implementation code.

### 2.3 Key User Journeys

`[ASSUMPTION]` These journeys establish the minimum web experience; detailed UX remains downstream work.

- **UJ-1. Daniel reviews a completed access-control test.** Daniel, an IT Auditor, opens the Runs list, selects the terminated-user Procedure, and triggers a Run. The web application shows progress while the Audit Runner gathers the HR and application-account populations. Daniel opens the completed Run, confirms the Evidence Quality Gate passed, reviews each Exception and its lineage, adds a note, and submits the Result for Auditor Review.
- **UJ-2. Maya refuses an unsafe conclusion.** Maya, an Audit Manager, opens a Run marked Inconclusive because the active-account population was truncated. She sees the failed completeness check and affected Source, confirms that no Pass or Fail conclusion was issued, corrects the synthetic Source, and requests a new Run. The original Run remains unchanged.
- **UJ-3. Maya reproduces and finalizes a result.** Maya opens a submitted Result, inspects the Procedure Version, Evidence Package, transformations, and rule evaluation, then reproduces a sampled Exception from the exported Workpaper Bundle. She approves and finalizes the Result; the platform records her identity, time, and decision.

## 3. Glossary

- **Audit Runner** — Background executor that performs a Run within an approved Procedure Version and read-only scope.
- **Auditor** — Authorized human who investigates and prepares a Result for review.
- **Auditor Review** — Human approval or rejection of a Result; it is not an automated assurance opinion.
- **Control Failure** — A valid Fail outcome caused by one or more confirmed Exceptions.
- **Evidence** — Source data or artifact collected for a Run.
- **Evidence Package** — Immutable Run-specific collection of original Evidence, metadata, transformations, and integrity information.
- **Evidence Quality Gate** — Checks for authority, scope, freshness, completeness, schema validity, duplicates, nulls, and retrieval failures that must pass before a control conclusion is issued.
- **Exception** — A record or matched record set that violates a Procedure Version's criteria.
- **PoC Administrator** — User who manages PoC access and synthetic Sources.
- **Procedure** — Named control test whose executable definitions are preserved as Procedure Versions.
- **Procedure Version** — Immutable definition of objective, scope, Sources, Evidence requirements, matching logic, criteria, tolerances, and expected outputs.
- **Result** — Run output containing an immutable System Outcome, summary, Exceptions, Evidence lineage, and separate Auditor Review state.
- **System Outcome** — Deterministic control conclusion of Pass or Control Failure issued only after the Evidence Quality Gate passes; it is not changed by human disposition.
- **Run** — One execution of one Procedure Version against a defined effective period.
- **Run Failed** — Technical failure that prevents valid execution.
- **Source** — Authorized synthetic system, file, or web surface from which Evidence is collected.
- **Workpaper Bundle** — Export containing enough information for a competent reviewer to understand and reproduce a Result.

## 4. Features and Functional Requirements

### 4.1 Identity, Roles, and Read-Only Boundaries

**Description:** The PoC limits access by role and prevents the Audit Runner from modifying a Source. Realizes UJ-1 through UJ-3.

#### FR-1: Authenticated web access

An authorized user can sign in and access only capabilities permitted to their assigned role.

**Consequences (testable):**
- Unauthenticated requests cannot access Run, Evidence, Exception, or administration data.
- The system records successful and failed authentication events.

#### FR-2: Minimal role separation

The system supports Auditor, Audit Manager, and PoC Administrator roles.

**Consequences (testable):**
- An Auditor can trigger Runs, investigate Exceptions, annotate Results, and submit Results for review.
- An Audit Manager can perform all Auditor actions and approve, reject, or finalize a Result.
- A PoC Administrator can manage users and Source configuration but cannot alter Evidence, rule outcomes, or finalized Results.

#### FR-3: Enforced read-only execution

The Audit Runner can invoke only allowlisted read operations within the Procedure Version's Source scope.

**Consequences (testable):**
- Write operations, arbitrary code or shell execution, out-of-scope Sources, and parameter-scope violations are denied and logged.
- Retrieved content cannot change the Run objective, permissions, or tool scope.

### 4.2 Preconfigured Procedures and Run Control

**Description:** The PoC exposes four immutable, preconfigured Procedures and supports manual, repeatable execution. Procedure authoring and scheduling are deferred.

#### FR-4: Four preconfigured Procedures

An Auditor can view and select the terminated-access, segregation-of-duties, high-value-approval, and configuration-deviation Procedures.

**Consequences (testable):**
- Each Procedure displays its objective, Sources, population, criteria, tolerance, expected Evidence, and Procedure Version.
- Users cannot create or edit Procedures in the PoC.

#### FR-5: Immutable Procedure Versions

The system executes every Run against one immutable Procedure Version.

**Consequences (testable):**
- A Run retains its Procedure Version even if a newer version is deployed.
- A change to the logic, Source mapping, Evidence requirements, model, or tool configuration creates a new Procedure Version.

#### FR-6: Manual Run initiation

An Auditor can initiate a Run for a selected Procedure and effective period.

**Consequences (testable):**
- The system prevents overlapping active Runs for the same Procedure Version and effective period.
- Each accepted request creates one Run with a unique correlation identifier.

#### FR-7: Observable Run lifecycle

The system shows a Run as Queued, Running, Completed, Inconclusive, Run Failed, or Canceled.

**Consequences (testable):**
- Users can distinguish platform failure from Control Failure.
- Every state transition records time, actor, reason, and prior state.

#### FR-8: Safe cancellation and rerun

An authorized user can cancel an active Run or initiate a new Run without changing prior Runs.

**Consequences (testable):**
- Cancellation stops further tool calls and preserves Evidence already collected with a Canceled status.
- A rerun creates a new Run linked to, but not overwriting, the prior Run.

### 4.3 Evidence Acquisition and Quality

**Description:** The Audit Runner collects read-only Evidence and proves that the population is fit for testing before issuing a conclusion.

#### FR-9: Evidence collection

The Audit Runner collects required Evidence from each Source specified by the Procedure Version.

**Consequences (testable):**
- Each Evidence item records Source, collection method, collection time in UTC, effective period, record count, and integrity digest.
- Original Evidence remains available after transformations.

#### FR-10: Evidence Package lineage

The system creates an Evidence Package for every Run.

**Consequences (testable):**
- Every concluded record and Exception traces to original Evidence, transformations, and the Procedure Version.
- Expired links or later Source changes do not remove the preserved PoC Evidence.

#### FR-11: Evidence Quality Gate

Before testing, the system evaluates the Evidence for source authority, freshness, completeness, schema validity, missing mandatory fields, duplicates, nulls, and retrieval failures.

**Consequences (testable):**
- A missing Source, pagination gap, any record-count mismatch, schema change, missing mandatory field, or partial extraction cannot yield Pass.
- Each check produces a visible outcome and diagnostic detail.
- For the PoC, declared and collected population counts must match exactly; there is no nonzero completeness tolerance.
- Freshness and completeness rules follow the normative Source contract in addendum.md §H.

#### FR-12: Safe insufficient-evidence outcome

The system marks a Run Inconclusive when collected Evidence is available but insufficient or contradictory, and Run Failed when execution cannot complete.

**Consequences (testable):**
- Neither state is presented as a control conclusion.
- The Result identifies affected Sources, checks, and records where known.

#### FR-13: Evidence immutability

The system prevents users and ordinary administrators from altering a Run's stored original Evidence or lineage.

**Consequences (testable):**
- Any integrity mismatch is detected and surfaced.
- Corrections require a new Source artifact and new Run.

### 4.4 Deterministic Control Testing

**Description:** Shared execution components normalize, reconcile, and test Evidence with deterministic rules. Agentic behavior may acquire or extract Evidence but does not decide the final assurance conclusion.

#### FR-14: Normalize and validate records

The system normalizes the fields required by each Procedure while retaining the original value and transformation history.

**Consequences (testable):**
- Date/time normalization uses UTC and preserves the source time zone where provided.
- Untransformable mandatory values are reported to the Evidence Quality Gate.

#### FR-15: Match records across Sources

The system reconciles records using the Procedure Version's matching keys and ambiguity rules.

**Consequences (testable):**
- Unmatched and multiply matched records are visible.
- Ambiguous matches cannot silently become compliant records.

#### FR-16: Execute deterministic rules

The system applies the Procedure Version's criteria and classifies evaluated records as Compliant or Exception.

**Consequences (testable):**
- Identical Evidence and Procedure Versions produce identical deterministic classifications.
- Boundary values are evaluated according to explicit inclusive or exclusive rules.

#### FR-17: Procedure-specific outputs

Each Procedure reports the evaluated population, exclusions, compliant count, Exception count, and its required control-specific fields.

**Consequences (testable):**
- Outputs conform to the contracts in addendum.md.
- Excluded or unevaluated records are never counted as compliant.

### 4.5 Results, Exceptions, and Auditor Review

**Description:** The web application lets Auditors understand Results, investigate Exceptions, and retain accountable human review.

#### FR-18: Result summary

An Auditor can view a Run's Procedure Version, effective period, Evidence Quality Gate, population reconciliation, status, and outcome summary.

**Consequences (testable):**
- Pass, Control Failure, Inconclusive, Run Failed, and Canceled are visually and semantically distinct.
- A Pass is available only after all required Evidence Quality Gate checks pass and deterministic evaluation produces no Exceptions.
- Human Exception dispositions and Auditor Review decisions do not rewrite the System Outcome.

#### FR-19: Exception investigation

An Auditor can open each Exception and view the violated criterion, compared values, source lineage, transformation history, and relevant Evidence.

**Consequences (testable):**
- Every Exception has a stable identifier within its Run.
- Sensitive fields designated by the Source contract are masked in list views.

#### FR-20: Exception workflow

An Auditor can assign an Exception, add notes, and classify it as Open, Under Review, Confirmed, or Not an Exception.

**Consequences (testable):**
- A “Not an Exception” disposition requires a rationale, records human disagreement, and retains the original Exception and System Outcome.
- Changes retain actor, timestamp, prior value, and rationale where required.

#### FR-21: Submit for Auditor Review

An Auditor can submit a completed Result to an Audit Manager.

**Consequences (testable):**
- Submission is blocked for Inconclusive, Run Failed, or Canceled Runs.
- Submission records the Auditor identity and time.

#### FR-22: Approve, reject, and finalize

An Audit Manager can approve or reject a submitted Result, and can finalize only an approved Result.

**Consequences (testable):**
- Finalization records the reviewer, timestamp, decision, Result version, and Procedure Version.
- Finalized Results, reviews, and Exceptions cannot be overwritten.
- Direct finalization from Submitted or Rejected is denied and logged.
- Any mutation attempt after finalization is denied and logged.

#### FR-23: Reviewer disagreement transparency

An Audit Manager can record a disagreement with a System Outcome or Exception only with a rationale; the PoC does not permit classification override.

**Consequences (testable):**
- The System Outcome and deterministic classification remain unchanged and visible.
- The disagreement and rationale appear in the Audit Trail and Workpaper Bundle.

### 4.6 Audit Trail, Reproduction, and Export

**Description:** The platform preserves enough provenance for an independent reviewer to follow and reproduce the work.

#### FR-24: Append-only Audit Trail

The system records security, configuration, execution, Evidence, transformation, review, export, error, and reviewer-disagreement events.

**Consequences (testable):**
- Each event includes the actor or agent identity, event type, UTC time, source, outcome, and correlation identifier.
- Audit Trail mutation is detectable.

#### FR-25: Execution trace

An Auditor can inspect the ordered execution trace for a Run.

**Consequences (testable):**
- The trace includes sanitized tool calls, retries, errors, versions, transformations, and rule evaluations.
- Secrets and credentials never appear in the trace.

#### FR-26: Workpaper Bundle export

An authorized user can export a self-contained Workpaper Bundle for a completed or finalized Result.

**Consequences (testable):**
- The bundle contains Procedure Version, scope, Evidence inventory, quality checks, transformations, population reconciliation, Results, Exceptions, notes, reviews, reviewer disagreements, and Audit Trail excerpt.
- The bundle includes an integrity manifest and is readable without access to source code.

#### FR-27: Reproduction support

An authorized reviewer can use the Workpaper Bundle to reproduce a sampled deterministic classification.

**Consequences (testable):**
- The bundle identifies exact input records, transformations, criteria, and Procedure Version.
- Reproduction does not depend on live Source state.

### 4.7 Web Oversight

**Description:** The web application provides Run monitoring and bounded operational diagnostics without allowing operational users to alter Results.

#### FR-28: Runs dashboard

An authorized user can filter and inspect Runs by Procedure, status, effective period, and initiation time.

**Consequences (testable):**
- Control Failures and technical or evidence failures use separate filters and labels.
- The dashboard shows the most recent state without requiring a page reload.

#### FR-29: Operational diagnostics

A PoC Administrator can view Source connectivity, runner health, errors, retries, and Run duration without viewing secrets.

**Consequences (testable):**
- Diagnostics link to the affected Run and correlation identifier.
- Operational diagnostics cannot alter a Result.

### 4.8 PoC Product-Thesis Instrumentation

**Description:** The PoC proves one bounded agentic acquisition path and measures whether the execution foundation is reusable.

#### FR-30: Bounded agentic acquisition proof

`[ASSUMPTION]` The production-configuration Procedure uses the Audit Runner to navigate and extract Evidence from the controlled ProdConsole web Source, whose content is treated as untrusted; deterministic rules still classify the records. Other PoC Sources acquire real synthetic data from files or read-only APIs instead of using mocked success responses.

**Consequences (testable):**
- The demonstration records navigation and extraction steps, versions, and Evidence lineage.
- Layout changes, prompt-like source content, low-confidence extraction, or scope violations produce a safe error or Inconclusive outcome rather than fabricated Evidence.

#### FR-31: Setup and reuse instrumentation

The PoC records the human effort and procedure-specific work required to configure, execute, and maintain each Procedure.

**Consequences (testable):**
- The team can report setup hours, number of reusable versus procedure-specific components, manual interventions per Run, and maintenance effort after a seeded Source change.
- Measurement does not require production telemetry or customer data.

## 5. Cross-Cutting Non-Functional Requirements

- **NFR-1 — Security:** Encrypt data in transit and at rest; store secrets outside application data; redact secrets from logs and exports; deny cross-user or cross-Run data leakage in automated tests.
- **NFR-2 — Agent safety:** Automated abuse tests must prove that retrieved instructions cannot expand Source scope, invoke denied tools, disclose secrets, or modify the Procedure objective.
- **NFR-3 — Integrity:** Integrity verification must detect modification of preserved Evidence, finalized Results, and Audit Trail records.
- **NFR-4 — Determinism:** Repeating a Run against the same frozen Evidence Package and Procedure Version must produce identical deterministic classifications.
- **NFR-5 — Performance:** `[ASSUMPTION]` For each PoC Procedure with up to 10,000 records per Source, 95% of Runs complete within five minutes, excluding intentionally simulated Source outages.
- **NFR-6 — Web responsiveness:** `[ASSUMPTION]` For the PoC dataset, 95% of authenticated list and detail views respond within two seconds under five concurrent users.
- **NFR-7 — Reliability:** A transient Source failure is retried at most three times with bounded backoff; exhausted retries produce Run Failed without duplicate Results.
- **NFR-8 — Recovery:** `[ASSUMPTION]` PoC data is backed up daily with a recovery-point objective of 24 hours and recovery-time objective of eight hours.
- **NFR-9 — Accessibility:** Core web workflows pass automated WCAG 2.1 AA checks and are keyboard accessible.
- **NFR-10 — Observability:** Every Run exposes duration, Source latency, record counts, retries, status, error class, and correlation identifier.
- **NFR-11 — Data handling:** Synthetic data only; no production or personal data is permitted in the PoC environment.
- **NFR-12 — Retention:** `[ASSUMPTION]` Run data, Evidence Packages, Results, and Audit Trails remain available for the life of the PoC and can be deleted only through a documented environment teardown process.
- **NFR-13 — Runner portability:** `[ASSUMPTION]` Audit Runner contracts separate execution, credentials, Source access, and Evidence return from the web application sufficiently to preserve a future private or customer-hosted runner path; the PoC need not deploy outside its own environment.

## 6. Constraints and Guardrails

- The PoC is a web application with background Audit Runners.
- All Source access is read-only and uses synthetic data.
- Deterministic rules issue record classifications; agentic components are bounded to approved acquisition, navigation, extraction, or interpretation tasks.
- No customer integrations or production credentials are required.
- Reusable domain objects, audit events, Evidence lineage, and Procedure Version contracts must not be hardcoded solely into presentation screens.
- Execution and Evidence contracts must not assume that all future Audit Runners share the web application's hosting boundary.
- The PoC must favor truthful Inconclusive or Run Failed outcomes over apparent completion.

## 7. Non-Goals

- Autonomous assurance opinions or replacement of professional audit judgment.
- Procedure authoring, editing, or natural-language generation.
- Scheduled or continuous unattended execution.
- Automated remediation or any write access to a Source.
- Production-data use, enterprise deployment certification, or customer-hosted deployment.
- A broad connector catalog, commercial GRC integration, or cross-industry control library.
- General-purpose RPA or arbitrary desktop automation.
- Root-cause analysis, finding management, or audit-plan management.

## 8. PoC Scope

### 8.1 In Scope

- Three roles and the web workflows in UJ-1 through UJ-3.
- Four preconfigured Procedures and their Procedure Versions.
- Synthetic HR, access, finance, approval, and configuration Sources.
- Controlled web acquisition from ProdConsole for the configuration-deviation Procedure; versioned file and read-only synthetic API acquisition for the remaining Sources.
- Manual Runs, background execution, safe cancellation, and rerun.
- Evidence Packages, Evidence Quality Gate, matching, deterministic rules, and Results.
- Exception investigation, Auditor Review, finalization, Audit Trail, and Workpaper Bundle export.
- Golden datasets covering compliant records, Exceptions, boundary cases, bad Evidence, and technical failure.

### 8.2 Deferred Beyond the PoC

- Procedure builder and approval lifecycle.
- Scheduling, continuous monitoring, alerts, trends, and duplicate Exceptions across Runs.
- Design-partner Sources and integrations.
- Private cloud or customer-hosted runners, SSO, tenant administration, and enterprise retention policies.
- Model-assisted classification beyond tightly bounded extraction experiments.
- Commercial-scale performance, availability, recovery, support, and regulatory certification.

## 9. Success Metrics

### Primary

- **SM-1 — Classification correctness:** All four golden datasets identify every expected Compliant record and Exception with no unexplained discrepancies. Validates FR-14 through FR-19.
- **SM-2 — Safe evidence failure:** 100% of seeded missing, stale, truncated, malformed, contradictory, or inaccessible Evidence cases produce Inconclusive or Run Failed; none produce Pass. Validates FR-11 and FR-12.
- **SM-3 — Complete lineage:** 100% of concluded records and Exceptions trace to original Evidence, transformations, and Procedure Version. Validates FR-9, FR-10, FR-19, and FR-25.
- **SM-4 — Reproducibility:** An independent audit reviewer reproduces a sampled classification for each Procedure using its Workpaper Bundle without access to the source code. Validates FR-26 and FR-27.

### Secondary

- **SM-5 — Reuse:** The four Procedures use shared components for Run control, Evidence metadata, quality checks, Results, Exceptions, and Audit Trail; procedure-specific logic is isolated. Validates FR-4 through FR-17 and FR-24.
- **SM-6 — Review completeness:** 100% of finalized Results have a named Audit Manager, timestamp, Procedure Version, and preserved decision history. Validates FR-21 through FR-24.
- **SM-7 — Scope enforcement:** Automated security tests deny all seeded write attempts, out-of-scope tool-use attempts, and tool-use attempts caused by prompt injection. Validates FR-3 and NFR-2.
- **SM-8 — Agentic acquisition proof:** ProdConsole controlled-web Evidence acquisition completes with full lineage, while seeded layout, confidence, prompt-injection, and scope failures safely stop or become Inconclusive. Validates FR-30.
- **SM-9 — Implementation baseline:** Setup hours, manual interventions, reusable components, procedure-specific components, and seeded Source-change maintenance effort are recorded for all four Procedures. Validates FR-31.

### Counter-Metrics

- **SM-C1 — No false confidence:** Do not reduce Inconclusive or Run Failed rates by weakening the Evidence Quality Gate.
- **SM-C2 — No autonomy theater:** Do not optimize the number of agent actions; optimize correct, bounded, reproducible completion.
- **SM-C3 — No hidden services burden:** Track procedure-specific code and manual setup; a successful demo that requires custom rebuilding for every Procedure does not prove the product thesis.

## 10. Risks and Mitigations

- **False Pass from bad Evidence:** Make the Evidence Quality Gate a hard prerequisite and seed adversarial datasets.
- **Non-repeatability:** Freeze Evidence Packages and bind Runs to immutable Procedure Versions and component versions.
- **Prompt injection or tool abuse:** Treat Source content as untrusted, enforce allowlists, validate parameters, isolate secrets, and test denied behavior.
- **Ambiguous identity matching:** Expose unmatched and ambiguous records; never default them to Compliant.
- **Approval theater:** Require exception-level lineage, named review, rationale for reviewer disagreement, and reproducible Workpaper Bundles.
- **Disposable-demo architecture:** Require shared domain contracts and measure reuse, while deferring premature enterprise infrastructure.
- **Scope creep:** Keep authoring, scheduling, production data, and commercial integrations explicitly out of scope.

## 11. Open Questions

1. Which identity provider and authentication approach should the PoC use? **Owner:** Architecture. **Revisit:** before authentication implementation.
2. Which specific Sources use file-based acquisition, and which use read-only API acquisition? ProdConsole controlled-web acquisition is fixed. **Owner:** Architecture and Engineering. **Revisit:** when defining Source contracts.
3. What extraction-confidence threshold should ProdConsole use? **Owner:** Product and Engineering. **Revisit:** after baseline extraction evaluation and before FR-30 acceptance tests are locked.
4. What export formats must the Workpaper Bundle support beyond a human-readable package? **Owner:** Product and UX. **Revisit:** during Workpaper Bundle interaction design.
5. Who acts as the independent reviewer for SM-4, and what reproduction checklist will they follow? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.
6. What evidence demonstrates that shared components are ready for the design-partner pilot? **Owner:** Product and Architecture. **Revisit:** at the PoC exit review using SM-5 and SM-9 results.

## 12. Assumptions Index

- §2.3 — Three inferred user journeys define the minimum web experience pending UX work.
- NFR-5 — PoC Run performance target: 95% within five minutes for up to 10,000 records per Source.
- NFR-6 — Web target: 95% of core views within two seconds under five concurrent users.
- NFR-8 — Daily backup, 24-hour recovery-point objective, and eight-hour recovery-time objective.
- NFR-12 — PoC artifacts remain available for the PoC lifetime and are removed only through documented teardown.
- FR-30 — The production-configuration Procedure proves bounded agentic acquisition from the controlled ProdConsole web Source; other Sources use real synthetic file or API acquisition.
- NFR-13 — PoC runner contracts preserve a future private or customer-hosted execution path without implementing that deployment.
- addendum.md — Minimal synthetic system names, data contracts, matching rules, and procedure criteria are inferred for build planning.
