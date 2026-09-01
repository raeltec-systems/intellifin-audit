---
title: "Product Requirements Document: IntelliFin Audit"
status: final
revision: 2
created: 2026-08-31
updated: 2026-09-01
supersedes: "revision 1 (finalized 2026-09-01)"
---

# Product Requirements Document: IntelliFin Audit

## 0. Document Purpose

This PRD defines the exploratory proof of concept (PoC) for product, design, engineering, audit, and downstream planning teams. It turns the [IntelliFin Audit product brief](../../briefs/brief-IntelliFin%20Audit-2026-08-31/brief.md) into testable product requirements. Domain and synthetic-data details are in [addendum.md](addendum.md). Inferred decisions are tagged `[ASSUMPTION]` and indexed in §12; tensions a decision-maker should see are tagged `[NOTE FOR PM]`.

**Revision 2** re-centers the PoC on a clarified product thesis (§1). It supersedes revision 1 in full. Functional requirements are renumbered; addendum §I maps old identifiers to new ones.

`[NOTE FOR PM]` The architecture spine and the UX handoff dated 2026-09-01 were derived from revision 1 and must be revised against this document before build. That re-derivation is real work: the spine's execution model (which evaluated after sealing and assumed a single acquisition boundary), and the UX handoff's screen set — which has no Builder, Live View, or Replay screens, all three now required — are both invalidated by this revision.

## 1. Vision and Product Thesis

> **IntelliFin Audit allows an auditor to define an audit procedure once and delegate its repeated execution to an autonomous audit agent. The agent performs the work using the same files, applications, and interfaces available to a human auditor, while every action and conclusion remains observable, replayable, evidence-backed, and subject to human review.**

The central experience is not a set of preconfigured control tests. It is an Auditor configuring an Audit Procedure, delegating it to an Audit Agent — a digital junior auditor working under supervision — and then watching live, or replaying later, as that agent actually performs the audit work: opening the population file, signing in to each Target System with approved audit credentials, looking up each record, inspecting what it finds, capturing evidence, and submitting completed work for review.

This agentic execution experience is not an optional experiment. It is the core product experience and the principal thesis the PoC exists to prove. The PoC proves it only when the Audit Agent's work is trustworthy in both directions: correct where the evidence supports a conclusion, and honestly Inconclusive, escalated, or failed where it does not. Missing, stale, incomplete, contradictory, or inaccessible evidence must never yield a Pass.

The product's primary object is the **Audit Procedure**, not the Control. A Control is what the business must do ("terminated users must have their access revoked"). An Audit Procedure is what the Auditor instructs IntelliFin Audit to do to determine whether that Control operated ("obtain the August leavers population from this file, identify terminated employees, inspect these two systems for each employee, verify account status, capture evidence, and flag active accounts"). The object chain the product is built around is:

```text
CONTROL                  What should the business be doing?
   │
AUDIT PROCEDURE          How will we verify it?
   │
AUDIT ASSIGNMENT / RUN   Perform this test now (or on schedule)
   │
AGENT WORKSPACE          The Audit Agent actually performs the work
   │
WORKPAPERS / EVIDENCE    What did the agent observe?
   │
AUDITOR REVIEW           Can I rely on this work?
```

This is not robotic process automation with an audit label. RPA replays a developer's script; IntelliFin Audit executes an Auditor's own instructions, gates every conclusion on evidence quality, keeps a replayable record of what was done, and needs no developer per Procedure. Working through user interfaces is the means, not the differentiation; the differentiation is trusted audit evidence at materially lower setup and operating effort.

### 1.1 Product Principles

These five principles, carried from the product brief, are the tie-break rules for every downstream decision.

1. **No conclusion without sufficient evidence.** A technically correct comparison on stale or incomplete data is not a valid audit result. — FR-33, FR-34, SM-5, SM-C1.
2. **Reproducibility over theatrical autonomy.** A competent reviewer must understand what ran, on which evidence, under which versions, and why. — FR-29, FR-30, FR-47, NFR-4, SM-C2.
3. **Human accountability is part of the workflow.** Procedure approval, material judgment, Exception investigation, risk assessment, professional skepticism, and final assurance remain with authorized people. — FR-13, FR-38, FR-43, FR-44.
4. **Read-only and least privilege by default.** Permissions and credentials are bounded by Procedure and environment. — FR-3, FR-7, FR-19, NFR-5.
5. **Agent uncertainty must be visible.** Ambiguous evidence or unreliable automation produces Escalation or safe failure, never concealed inference. — FR-23, FR-27, FR-38, SM-C4.

### 1.2 The Trust Seam

The thesis holds only if the seam between what the Audit Agent *asserts* and what the deterministic layer *trusts* is closed. Four rules close it and recur throughout the FRs:

- **Observations are grounded, not asserted.** Every attribute value the agent records points into a platform-captured Structural Snapshot that a deterministic extractor can re-read offline, and the Evidence Quality Gate corroborates the value, its field label, and the record's identity against that snapshot before any rule uses it (FR-31, FR-33).
- **Absence is proven, not asserted.** "No account found" is Compliant only when the Evidence shows every declared search key was tried and the Target System's empty result was captured (FR-31, FR-33).
- **Every condition is evaluated for every record.** A Compliance Rule with both compiled and uncompiled conditions yields one evaluation per condition per record; a missing evaluation blocks Pass (FR-9, FR-37, FR-38).
- **Unnamed values are Unevaluated.** A value the Compliance Rule does not name is never mapped to Compliant by a human answer during a Run; the record is Unevaluated, the Run is Inconclusive, and the fix is a new Procedure Version (FR-9, FR-27).

## 2. Target Users and Jobs

### 2.1 Users and Stakeholders

- **Economic buyer:** Chief Audit Executive or Head of Internal Audit.
- **Primary user:** Auditor, including internal auditors and IT auditors, who authors Audit Procedures, delegates Runs to the Audit Agent, supervises execution, investigates Exceptions, and prepares Results for review.
- **Oversight user:** Audit Manager, who approves Procedure Versions, monitors Runs, and performs Auditor Review.
- **System operator:** PoC Administrator, who manages users, Target System registrations, credential references, and synthetic Population Sources without changing Procedures, Evidence, or finalized Results.
- **Non-users for the PoC:** Risk, Compliance, audit-services firms, control owners, and external auditors. Runs initiated by control owners or first- and second-line functions are management monitoring, not independent assurance; the PoC model must not conflate the two.

### 2.2 Jobs to Be Done

- Describe an audit procedure once — as I would to a junior colleague — and have it executed repeatedly without a developer coding it for me.
- Delegate the mechanical work of looking things up across systems while keeping my name on the conclusion.
- See what the agent is doing right now, step in when it needs me, and otherwise leave it to finish.
- Replay what the agent did, for myself or a reviewer, without re-running it.
- Determine whether the Evidence is sufficient before relying on a Result. The Evidence Quality Gate sets the floor; the Auditor's professional judgment sets the ceiling.
- Trace every Exception to its source records, the agent's actions, and the rule or judgment that flagged it.
- Distinguish a Control Failure from a Run that is Inconclusive, Run Failed, or Awaiting Auditor.
- Review, annotate, approve, or reject Results while preserving professional accountability.

### 2.3 Key User Journeys

`[ASSUMPTION]` These journeys establish the minimum web experience; detailed UX remains downstream work. They follow one hero Audit Procedure — Terminated Users Retaining Access — through the full object chain.

- **UJ-1. Daniel builds the Terminated Users procedure.** Daniel, an IT Auditor at Northstar Financial Group, opens Procedures, chooses the *Terminated Users Retaining Access* Procedure Template, and works through the Procedure Builder. He binds the Population Source to the HR leavers export — a versioned file HR publishes to a registered location each week, with a signed cover sheet declaring its row count — and sets the inclusion rule to employees marked `Terminated` whose termination date falls in the period.

  He selects LoanCore and LedgerDesk as Target Systems and writes the Audit Instructions in plain language: search for each terminated employee in each Target System and inspect the account. He sets the Compliance Rule — compliant when no account exists or the account is disabled; exception when an active account exists — and adds one condition in plain language: treat any account whose roles look privileged as an exception even if disabled. The builder shows that the first two conditions compiled to rules and the third will be judged by the agent and confirmed by him.

  He sets the Evidence Requirements — username, account status, roles, and a screenshot of the account page — and the Schedule to weekly. The builder shows him the executable plan it derived, in language he can check; he tightens one instruction, the plan re-derives, and he submits the Procedure Version for approval.
- **UJ-2. Maya approves the procedure.** Maya, the Audit Manager, opens the submitted Procedure Version, reads the plan, checks that the Target Systems and credentials are read-only audit accounts, and approves it. The version is frozen; the Schedule becomes active.
- **UJ-3. Daniel watches the agent work.** Daniel starts a Run now for August 2026 rather than waiting for the Schedule. IntelliFin Audit creates an isolated Agent Workspace and acquires the current leavers export, recording its digest and declared count; the platform parser finds twelve terminated employees in the period. In the Live View Daniel sees the Audit Agent open LoanCore in the workspace browser, sign in with the audit credential, and search for the first employee. The Execution Timeline shows the current Step, the Observation just captured, and the screenshot the platform attached to it.

  On the seventh employee the ID search returns nothing and the name search returns two candidates, neither showing the employee ID. The platform raises an Escalation showing both captured result rows and asks Daniel to choose one by the secondary key the Procedure declares, full name, or mark the record ambiguous. Daniel still sees the workspace screen while the Run waits. He chooses the row whose name and department match the leavers row; the answer is recorded, the record is flagged human-matched, and the agent continues, finishing LoanCore before opening LedgerDesk, the desktop finance client. Daniel closes the tab and leaves it to finish.
- **UJ-4. The weekly Run happens without anyone watching.** The following Monday the Schedule starts a Run at 06:00 for the previous week. No one is signed in. The platform acquires that week's leavers export, the Audit Agent completes every lookup across both Target Systems and captures Evidence, and the Run completes with its Result in Draft. Had the agent raised an Escalation, Daniel and Maya would have been notified in-app and by email. Daniel opens Replay over coffee, scrubs to the two Exceptions, and sees exactly what the agent saw when it found each active account.
- **UJ-5. Maya refuses an unsafe conclusion.** A later Run is marked Inconclusive for two reasons. LoanCore's search timed out for three employees, and the Evidence Quality Gate refused to count uninspected records as compliant.

  And one LedgerDesk account carried the status `Suspended`, which the Compliance Rule does not name; the platform raised an Escalation with two answers — mark the record Unevaluated and continue, or abort — and, with no answer before the timeout, the record stayed Unevaluated. Maya sees the failed coverage check, the affected records, and the diagnostic suggesting that the rule should name `Suspended`; she confirms that no Pass or Control Failure was issued. Daniel drafts a new Procedure Version that adds `Suspended` to the disabled set; Maya approves it; the original Run is unchanged.
- **UJ-6. Maya reviews, reproduces, and finalizes.** Daniel opens a Completed Result in Draft. One record carries an Agent-Judged evaluation: the agent judged a LedgerDesk role list to be privileged. He inspects the agent's rationale and the grounded structural snapshot and screenshot, confirms the judgment, and the Result seals with that Exception counting toward the System Outcome; he submits it. Maya opens the submitted Result, reproduces a sampled Exception from the exported Workpaper Bundle, approves, and finalizes; the platform records her identity, time, and decision.

## 3. Glossary

- **Absence Observation** — An Observation with `found = false`. Valid only with the Evidence required by addendum §B.1; otherwise the Work Item is Uninspected.
- **Adapter** — A platform component that acquires a Population Source or an API- or file-form Target System deterministically, without a model. Adapter actions are Session Steps on the Execution Timeline.
- **Agent-Judged evaluation** — A per-condition evaluation produced by the Audit Agent for an uncompiled condition; flagged, and counted only after Auditor confirmation (FR-38).
- **Agent Workspace** — Isolated execution environment created for one Run in which the Audit Agent opens files, drives browsers and applications, and captures Evidence. Torn down when the Run ends; its session recording feeds Replay.
- **Audit Agent** — The autonomous executor that performs a Run's agent-driven Steps inside an Agent Workspace under the Procedure Version's scope, credentials, tools, and limits (FR-20, FR-23).
- **Audit Assignment** — The work handed to an Audit Agent by a Run. One Run is one Audit Assignment in the PoC; the model permits a Run to decompose into several (FR-22).
- **Audit Instructions** — Natural-language description, written by the Auditor, of what the Audit Agent should do in the Target Systems.
- **Audit Manager** — Authorized human who approves Procedure Versions and performs Auditor Review.
- **Audit Procedure (Procedure)** — The product's primary object: an Auditor's instruction set for determining whether a Control operated, comprising scope, Population Source, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, and Schedule. Its executable definitions are preserved as Procedure Versions.
- **Audit Runner** — Background execution service that hosts Adapters, the Audit Agent, and its Agent Workspace for a Run, and evaluates compiled conditions as Observations arrive.
- **Audit Trail** — System-wide, append-only record of security, authoring, approval, Schedule, Run, Evidence, review, export, and error events (FR-45). Execution Timeline events are also Audit Trail events; the Timeline is the per-Run view.
- **Auditor** — Authorized human who authors Procedures, starts and supervises Runs, investigates Exceptions, confirms Agent-Judged evaluations, and prepares Results for review.
- **Auditor Review** — Human approval or rejection of a Result. Despite the name, Auditor Review is performed by the Audit Manager; it is not an automated assurance opinion. The Auditor's own pre-submission work is the Result's review state Draft, not Auditor Review.
- **Compiled condition / uncompiled condition** — A Compliance Rule condition the builder could express as a deterministic rule over declared Observation attributes, or one it could not; uncompiled conditions are evaluated Agent-Judged (FR-9).
- **Compliance Rule** — The Auditor-authored set of conditions defining what constitutes a Compliant record and what constitutes an Exception; each condition is compiled or uncompiled and carries an applicability predicate.
- **Control** — A business obligation the Procedure tests. Reference data in the PoC; a Procedure names the Control it verifies.
- **Control Failure** — The System Outcome issued when one or more Exceptions count toward it; the counterpart of Pass.
- **Escalation** — A typed question with a closed set of answers that the Audit Agent, or the platform on its behalf, raises to an Auditor when execution cannot proceed safely; the Run waits until answered or times out. An answer is recorded and scoped to that Run and never classifies a record.
- **Evidence** — Source data, Observation, screenshot, recording segment, or artifact captured for a Run.
- **Evidence Package** — Immutable Run-specific collection of original Evidence, Observations, metadata, transformations, and integrity information.
- **Evidence Quality Gate (Gate)** — The checks tabulated in addendum §H that must pass before a control conclusion is issued. Per-Observation checks run at Observation registration; Run-level checks run at end of execution.
- **Evidence Requirement** — The Auditor-specified set of attributes and artifacts the Audit Agent must capture for each inspected record.
- **Exception** — A record or matched record set with at least one condition evaluated as violating the Compliance Rule, whether Rule-Classified or confirmed Agent-Judged.
- **Executable plan (plan)** — The ordered Plan Steps, Observations to capture, compiled conditions, Agent-Judged conditions, credential references, and limits the builder derives from a Procedure's fields and Audit Instructions; frozen into the Procedure Version at approval.
- **Execution Timeline (Timeline)** — Ordered, timestamped record of every Step, Tool Action, Observation, Evidence registration, rule evaluation, Escalation, and state change in a Run. The authoritative execution record; Replay renders it.
- **Golden dataset** — A Procedure's versioned synthetic population and Target System fixtures with expected terminal outcomes (addendum §D), used for acceptance and regression Runs.
- **Grounding** — For each Observation attribute, a pointer into a Structural Snapshot or file Evidence item (locator plus field label) from which a deterministic extractor can re-read the value offline (addendum §B.1).
- **Identity attribute** — The matching key as displayed by the Target System, captured and grounded on every `found = true` Observation so the Gate can prove the Evidence belongs to the population record.
- **Human-classified evaluation** — An evaluation set by an Auditor after rejecting an Agent-Judged evaluation, with rationale; always flagged.
- **Inconclusive** — Run state meaning no control conclusion is issued because the Evidence Quality Gate failed, a timeout expired, or a condition is Unevaluated (FR-34, addendum §E).
- **Live View** — Web surface showing a Run in progress: current Step, workspace screen, Observations, and Evidence as captured, with pause, cancel, and Escalation controls.
- **Observation** — A structured, grounded record of what was found for one population record in one Target System (attributes, original and normalized values, grounding, timestamp, and linked Evidence). Observations from agent-driven Target Systems are made by the Audit Agent; those from adapter-acquired Target Systems by the Adapter.
- **Pending Confirmation** — Result outcome of a Completed Run while any Agent-Judged evaluation is unconfirmed. Not a System Outcome; the Result seals once every evaluation is resolved.
- **Plan Step** — See *Step*.
- **PoC Administrator** — User who manages PoC access, Target System registrations, credential references, and synthetic Population Sources.
- **Population Source (Source)** — The file, system, or surface from which a Run obtains the population to test, with its inclusion rule. A Procedure Version freezes the Source *binding*; each Run acquires the current snapshot.
- **Procedure Builder (Builder)** — The web surface in which an Auditor authors a Procedure (§4.2).
- **Procedure Template (Template)** — A pre-authored, partially configured Procedure supplied with the PoC from which an Auditor creates a Procedure.
- **Procedure Version** — Immutable definition of a Procedure at approval time, including its executable plan, model and tool configuration, and Schedule.
- **Reference Source** — A versioned file or API the platform consults deterministically during evaluation (for example an approved role matrix). Not a Target System; produces no Work Items.
- **Replay** — Playback of a completed or stopped Run from its Execution Timeline, Evidence, and platform-owned Replay assets, without re-executing it.
- **Result** — Run output containing the System Outcome once sealed, summary, Exceptions, Evidence lineage, and separate Auditor Review state (FR-40).
- **Rule-Classified evaluation** — A per-condition evaluation produced deterministically from a grounded, corroborated Observation by a compiled condition.
- **Run** — One governed execution of one Procedure Version against a defined effective period, started manually or by Schedule. A Run is composed of Session Steps and Work Items. *Active* Run states are Queued, Running, Paused, and Awaiting Auditor.
- **Run Failed** — Run state for a Run-level technical failure that prevents valid execution (FR-34, addendum §E).
- **Schedule** — Frequency attached to a Procedure Version: once, daily, weekly, or monthly. An active Schedule starts Runs unattended.
- **Session Step** — A Run-level Step outside any Work Item: acquire the Population Source, sign in to a Target System, run an Adapter extraction.
- **Step** — Used at three levels. A **Plan Step** is one frozen unit of the executable plan (per Target System: locate, inspect, capture). A **Step Execution** is one runtime instance of a Plan Step inside one Work Item, or a Session Step feeding several Work Items (addendum §C P-4). A **Tool Action** is one sandbox action (click, type, read, screenshot) inside a Step Execution.
- **Step Execution** — See *Step*.
- **Structural Snapshot** — Platform-captured Evidence item holding the accessibility tree or DOM serialization (web), control tree (desktop), or parsed sheet (file) at the Tool Action that read the attributes; the only substrate grounding may point into.
- **System Outcome** — Deterministic control conclusion of Pass or Control Failure computed at Result sealing (FR-40); not changed by human disposition. Inconclusive, Run Failed, and Canceled are Run states, not System Outcomes.
- **Tool Action** — See *Step*.
- **Target System** — An approved system the Run inspects, registered with a read-only audit credential reference. Web and desktop Target Systems are agent-driven; API and file Target Systems are adapter-acquired.
- **Uninspected** — Work Item state (capitalized) for a record that received no valid Observation in a Target System; as a lowercase adjective, "uninspected records" are such records. Never Compliant.
- **Unevaluated** — Evaluation value of a condition, or of a record, for which no valid evaluation exists: unmatched, ambiguous, uninspected, uncorroborated, unnamed value, low confidence, or set by a human on rejection. Never Compliant; blocks Pass.
- **Work Item** — The unit of work within a Run: one per population record per agent-driven Target System, and one per extraction for an adapter-acquired Target System, owning one Observation per population record (FR-22). Owns its Step Executions, Observations, Evidence, and Timeline segment.
- **Workpaper Bundle** — Export containing enough information for a competent reviewer to understand, replay, and reproduce a Result.
- **Workspace Provider** — The service supplying the Agent Workspace's browser and desktop sandbox and its session recording; Solari in the PoC (addendum §J).

## 4. Features and Functional Requirements

### 4.1 Identity, Roles, and Read-Only Boundaries

**Description:** The PoC limits access by role and prevents the Audit Agent from modifying any Population Source or Target System. Realizes all journeys.

#### FR-1: Authenticated web access

An authorized user can sign in and access only capabilities permitted to their assigned role.

**Consequences (testable):**
- Unauthenticated requests cannot access Procedure, Run, Evidence, Exception, Live View, Replay, or administration data.
- The system records successful and failed authentication events.

#### FR-2: Role separation

The system supports Auditor, Audit Manager, and PoC Administrator roles.

**Consequences (testable):**
- An Auditor can author Procedures, submit Procedure Versions for approval, start and supervise Runs, answer Escalations, flag a Run to an Audit Manager, investigate Exceptions, confirm Agent-Judged evaluations, annotate Results, and submit Results for review.
- An Audit Manager can perform all Auditor actions and can approve or reject Procedure Versions and approve, reject, or finalize a Result. An Audit Manager cannot approve a Procedure Version they authored. `[ASSUMPTION]` In the PoC an Audit Manager may confirm Agent-Judged evaluations on, or submit, a Result they later approve; production separation of these duties is deferred (§8.3).
- A PoC Administrator can manage users, Target System registrations, credential references, and Population Source configuration but cannot author or approve Procedures or alter Evidence, evaluations, or finalized Results. No administrator can alter Evidence; there is no extraordinary path in the PoC.

#### FR-3: Enforced read-only execution

Adapters and the Audit Agent can invoke only allowlisted read operations within the Procedure Version's Population Source and Target System scope.

**Consequences (testable):**
- Write operations, arbitrary code or shell execution outside the Agent Workspace sandbox, out-of-scope systems or origins, and out-of-scope parameters (for example a search outside the declared population) are denied and logged.
- Content retrieved from any file, page, or application cannot change the Run objective, permissions, tool scope, or Compliance Rule.
- Audit credentials are read-only accounts; a credential with write capability cannot be registered for a Target System.

### 4.2 Procedure Builder

**Description:** The Auditor creates an Audit Procedure through a hybrid authoring experience: structured fields for the parameters execution depends on, and natural-language Audit Instructions for what the agent should do, written as the Auditor would brief a colleague. The builder derives a readable executable plan the Auditor checks before submission. The PoC proves that an Auditor can create an executable Procedure without a developer coding it for them; it is not a universal no-code automation platform. Realizes UJ-1.

#### FR-4: Create a Procedure from a Template

An Auditor can create a Procedure from one of the four Procedure Templates and name the Control it verifies.

**Consequences (testable):**
- The four Templates are Terminated Users Retaining Access, Segregation-of-Duties Conflicts, High-Value Transactions Without Required Approval, and Production Configuration Deviation.
- A Template pre-populates every builder section with editable defaults defined in addendum §C.
- The Terminated Users Template is fully configurable in every section; `[ASSUMPTION]` the other three Templates are configurable in period, Population Source, Target Systems, and Schedule, with their Audit Instructions and Compliance Rule editable but not required to be re-authored for PoC acceptance.
- `[NOTE FOR PM]` With that assumption, SM-8 proves that the *engine* generalizes across four Procedures; Auditor authoring without a developer is proven only for the hero. Requiring the SM-1 Auditor to re-author one non-hero Template would prove both and is recommended as a stretch acceptance case.

#### FR-5: Period and scope

An Auditor can set the effective period and scope the Procedure tests.

**Consequences (testable):**
- The period is an explicit date range; a scheduled Run derives its period from the Schedule (addendum §B) and records the derivation.
- Scope statements are recorded verbatim on the Procedure Version and shown in every Result.

#### FR-6: Population Source configuration

An Auditor can bind the Procedure to where the population is found and specify which records are included.

**Consequences (testable):**
- The PoC supports a manually uploaded spreadsheet or CSV, a versioned file at a registered location, and a read-only API as Population Source bindings. A manual upload is valid only for a `once` Schedule; daily, weekly, and monthly Schedules require a versioned-file or API binding.
- The Procedure Version freezes the binding — location, schema, declared-count mechanism — not the snapshot. Each Run acquires the current snapshot and records its digest, generation time, and declared count. The acquired snapshot is captured into the Evidence Package as the Run's initial Evidence.
- The population is parsed and the inclusion rule applied by a deterministic platform parser; the parsed population is the population of record. The Audit Agent may additionally open the file in the workspace so that the action appears in the session recording, but its reading never replaces the parser's.
- The inclusion rule is a structured filter over declared columns or fields (for example `status = Terminated and termination_date within period`).
- The binding must supply an independently declared expected row count (for example a signed cover sheet or an API count endpoint); its absence is surfaced at authoring time.
- An empty post-inclusion population yields Inconclusive unless the Procedure Version explicitly opts in to a zero-record Pass.

#### FR-7: Target System configuration

An Auditor can select one or more registered Target Systems the Run must inspect.

**Consequences (testable):**
- Only Target Systems registered by a PoC Administrator with a read-only credential reference and an allowlisted origin or application identity can be selected.
- Target Systems are one of four kinds: web application and desktop application (agent-driven inside the Agent Workspace) or read-only API and versioned file (together, adapter-acquired). The PoC includes at least one web Target System and one desktop Target System (addendum §A).
- The Procedure Version records, per Target System, its kind, the allowed origins or application, the credential reference, the read-only actions permitted, a digest of the registration, and, per declared attribute, the expected field label or locator pattern that grounding must match (addendum §B.1).
- Target System discovery is explicit in the PoC: the Auditor names the systems. `[NON-GOAL for PoC]` Agent-recommended or agent-discovered scope.

#### FR-8: Audit Instructions

An Auditor can write natural-language Audit Instructions describing what the Audit Agent should do in each agent-driven Target System.

**Consequences (testable):**
- Instructions are stored verbatim on the Procedure Version and displayed in the plan, Live View, Replay, and Workpaper Bundle.
- Instructions cannot widen scope. 100% of the seeded scope-widening instructions in addendum §D (an unregistered system, a write verb, an out-of-scope origin) are flagged before submission. The authoring flag is advisory; execution-time denial (FR-3) is the enforced control, and any instruction that escapes the flag is denied at execution and recorded as a security event.

#### FR-9: Compliance Rule

An Auditor can define the conditions under which an inspected record is compliant and the conditions under which it is an Exception.

**Consequences (testable):**
- Conditions expressed over declared Observation attributes (for example `account_status in {none, disabled}`) compile to deterministic rules; the builder shows which conditions compiled.
- Conditions the builder cannot compile are retained as natural language and marked Agent-Judged; the Auditor sees this before submission.
- Every condition carries an applicability predicate: a compiled expression over Observation fields (default `found = true`) that the builder derives, records on the Procedure Version, and shows in the plan. The agent never decides applicability.
- A record's evaluation derives from its conditions, in this order: (1) **Exception** if any applicable condition evaluates to Exception (after confirmation for Agent-Judged conditions); (2) **Unevaluated** if any applicable condition lacks an evaluation or evaluates to Unevaluated; (3) **Compliant** only if every applicable condition has a Compliant evaluation that is Rule-Classified, confirmed Agent-Judged, or human-classified. An uncompiled condition with no Agent-Judged evaluation for an applicable record is an Evidence Quality Gate failure, never a Pass.
- A compiled condition that meets an attribute value it does not name evaluates the record Unevaluated with a diagnostic naming the value; no Run-time answer can map that value (addendum §B).
- Boundary semantics (inclusive or exclusive) are explicit for every comparison. A numeric tolerance or materiality threshold is expressed as a compiled condition; the PoC exercises at least the P-3 USD 100,000 boundary (addendum §C). `[NON-GOAL for PoC]` Materiality-based Exception suppression, Exception ownership defaults, and cross-Run aggregation; every Exception is material in the PoC.
- Unmatched, ambiguous, uninspected, uncorroborated, or Unevaluated records never satisfy the compliant condition.

#### FR-10: Evidence Requirements

An Auditor can specify the attributes and artifacts that must be captured for each inspected record.

**Consequences (testable):**
- The PoC supports attribute values, a Structural Snapshot, a screenshot of the relevant screen, the source file excerpt, and the workspace recording segment as Evidence Requirement types. The Structural Snapshot and screenshot are always captured for agent-driven Target Systems.
- Every attribute value carries grounding into a Structural Snapshot or file Evidence item (§3 *Grounding*), never into a screenshot or recording; an attribute without grounding is treated as not captured.
- Every `found = true` Observation carries a grounded identity attribute (§3).
- Structural Snapshots and screenshots for agent-driven Target Systems are captured by the platform, bound to the Tool Action that read the attributes, with the URL or window title recorded; the agent does not choose what to capture.
- A record whose required Evidence was not captured is not evaluated Compliant and is reported by the Evidence Quality Gate.

#### FR-11: Schedule

An Auditor can set the Procedure to run once, daily, weekly, or monthly.

**Consequences (testable):**
- The Schedule is part of the Procedure Version and activates only on approval (and, where FR-15 applies, after the regression Run).
- `[ASSUMPTION]` The PoC uses a single time zone (UTC) and a fixed start time per Schedule; period derivation follows addendum §B.

#### FR-12: Executable plan preview

Before submitting, an Auditor can read the executable plan the builder derived from the structured fields and Audit Instructions.

**Consequences (testable):**
- The plan lists the Session Steps, the ordered Plan Steps per Target System, the Observations to capture, the compiled conditions, the Agent-Judged conditions, the credentials referenced, and the execution limits.
- The plan is readable by an Auditor without inspecting code or prompts and is frozen into the Procedure Version at approval.
- The Auditor cannot edit the plan directly; changing any structured field or Audit Instruction re-derives the plan, and each re-derivation is recorded. A plan that cannot be derived blocks submission with the reason shown.
- `[ASSUMPTION]` Plan derivation may use a model; the derived plan is data the Auditor reviews, and the model's identity and version are recorded on the Procedure Version.

### 4.3 Procedure Approval and Versioning

**Description:** A Procedure executes only as an approved, immutable Procedure Version. Realizes UJ-2.

#### FR-13: Submit and approve a Procedure Version

An Auditor can submit a Procedure for approval, and an Audit Manager who is not its author can approve or reject it.

**Consequences (testable):**
- Approval freezes the Procedure Version, including its plan, Compliance Rule, Evidence Requirements, Target Systems, credential references, Population Source binding, model and tool configuration, limits, and Schedule.
- Rejection sets the version Rejected with the reviewer's rationale recorded; editing returns it to Draft (addendum §E).
- Approval records approver, time, and a diff against the previous version where one exists.

#### FR-14: Immutable Procedure Versions

The system executes every Run against exactly one approved Procedure Version.

**Consequences (testable):**
- A Run retains its Procedure Version even if a newer version is approved.
- Any change to scope, Population Source binding, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, Schedule, model, prompt, or tool configuration creates a new draft Procedure Version requiring approval. A platform-side model, prompt, or tool change, or a change to a referenced Target System registration (origin, application identity, credential reference, permitted actions, attribute labels), creates a platform-authored draft for every affected Procedure, requiring the same approval.
- The prior version's Schedule remains active until the new version is approved and, where FR-15 applies, has passed its regression Run; the handover happens at a period boundary so no period is run twice or skipped (addendum §E). In-flight Runs complete on their own version.

#### FR-15: Regression Run on configuration change

A Procedure Version whose model, prompt, tool configuration, or referenced Target System registration digest differs from the prior approved version must complete a golden-dataset Run before it becomes Active.

**Consequences (testable):**
- The regression Run is permitted on an Approved, not yet Active, version; it binds to the golden Population Source declared on the Template rather than the version's own binding, is exempt from the FR-16 overlap rule, and is labeled as a regression Run on the Runs dashboard.
- The approver confirms its Agent-Judged evaluations from the golden dataset's confirmation script; the Run must reproduce every expected terminal outcome, except records addendum §D excludes from the identity comparison. A mismatch blocks activation and is surfaced to the approver.
- The regression Run is recorded on the Procedure Version and counted in FR-50 maintenance effort.

### 4.4 Run Initiation and Scheduling

**Description:** Runs start manually or by Schedule and are governed identically. Realizes UJ-3 and UJ-4.

#### FR-16: Manual Run initiation

An Auditor can start a Run for an Active Procedure Version and effective period.

**Consequences (testable):**
- The system prevents overlapping active Runs for the same Procedure Version and effective period.
- Each accepted request creates one Run with a unique correlation identifier and records the initiating Auditor.

#### FR-17: Scheduled Run initiation

The system starts a Run unattended when an active Schedule falls due.

**Consequences (testable):**
- A scheduled Run records the Schedule as initiator and the derived effective period.
- A missed or failed scheduled start is recorded and surfaced on the Runs dashboard (FR-48); it is never silently skipped.
- At least one scheduled Run in PoC acceptance completes with no human session active.

#### FR-18: Observable Run lifecycle

The system shows a Run as Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, or Canceled.

**Consequences (testable):**
- Users can distinguish platform failure from Control Failure and from waiting on a human.
- Every state transition records time, actor (human, Schedule, Audit Agent, Adapter, or platform), reason, and prior state.

### 4.5 Agent Workspace and Autonomous Execution

**Description:** When a Run begins, IntelliFin Audit creates an isolated Agent Workspace and the Audit Agent performs the Procedure through the relevant files, browsers, and applications — the Population Sources and Target Systems registered on the Procedure Version — much like a human auditor would. Adapter-acquired Target Systems and Population Sources are acquired deterministically on the same Timeline; web and desktop Target Systems are driven by the Audit Agent. The Workspace Provider supplies the browser and desktop sandbox and its session observability in the PoC. Realizes UJ-3 and UJ-4.

`[NOTE FOR PM]` Solari is named as the PoC Workspace Provider (addendum §J) while FR-29, FR-30, and NFR-15 require provider neutrality. The cost of that neutrality is that IntelliFin Audit must own its Replay assets (FR-30) rather than link to the provider's recording; accept that cost or accept provider lock-in for Replay.

#### FR-19: Isolated Agent Workspace per Run

The system creates a fresh, isolated Agent Workspace for each Run whose Procedure Version has agent-driven Steps, and destroys it when the Run ends. A Run with only adapter-acquired Steps needs no workspace, and its Live View shows the Adapter Session Steps.

**Consequences (testable):**
- No file, session, cookie, or credential persists from one Run's workspace to another.
- The workspace can reach only the Procedure Version's allowlisted origins and applications; other network egress is denied and logged.
- Workspace creation failure results in Run Failed before any Step executes.

#### FR-20: Audit Agent performs the plan

The Audit Agent executes the Procedure Version's agent-driven Plan Steps. For each agent-driven Target System it signs in with the referenced audit credential, then for each population record locates the record, inspects it, captures the required Evidence, and records a grounded Observation. When every Target System is done, the Run runs the Gate's Run-level checks and, on pass, transitions to Completed with its Result in Draft (FR-40).

**Consequences (testable):**
- The PoC ordering is per Target System, all records: sign in once per Target System as a Session Step, execute every Work Item for that Target System, then the next.
- Every Step Execution and Tool Action records its start, end, and outcome on the Execution Timeline.
- Credentials are supplied to the workspace just in time and never appear in the Execution Timeline, Evidence, logs, or exports.
- At Observation registration the platform runs the per-Observation Gate checks (grounding, identity and value corroboration, absence completeness, unnamed value, required Evidence) and then a deterministic evaluator inside the Audit Runner applies the compiled conditions, so the agent never decides Compliant or Exception for a compiled condition; Agent-Judged conditions are evaluated by the agent per applicable record (FR-38).
- A population record with no Observation for a required Target System is reported as Uninspected to the Evidence Quality Gate.
- The Audit Agent stops and reports rather than guessing when a Step Execution cannot be completed within its retry and time limits; addendum §D seeds the cases that prove it.
- After the last Work Item the Run-level Gate checks run: pass → Completed with the Result in Draft; fail → Inconclusive.

#### FR-21: Adapter acquisition

Adapters acquire the Population Source and every adapter-acquired Target System deterministically, as Session Steps on the same Execution Timeline, producing Observations in the same schema as the Audit Agent's.

**Consequences (testable):**
- Adapter Observations carry grounding (row or field reference), declared counts, and integrity digests and pass through the same Evidence Quality Gate, evaluation, and review components as agent Observations.
- Adapter Work Items may cover a batch of population records when acquisition is a single extraction; per-Template coverage rules are in addendum §C.
- Adding a Population Source or Target System kind is an Adapter-level change and does not change Builder, Gate, evaluation, or review code (NFR-15).

#### FR-22: Work Items and sequential PoC execution

A Run is composed of Session Steps and Work Items — one Work Item per population record per agent-driven Target System, and one per extraction for an adapter-acquired Target System — executed sequentially by one Audit Agent in the PoC.

**Consequences (testable):**
- Each Work Item has its own state, Step Executions, one Observation per population record it covers, Evidence, and Timeline segment.
- Run-level completeness is computed over Observations, per addendum §H per-record coverage.
- The data model does not assume one Run equals one worker or one Audit Assignment; `[NON-GOAL for PoC]` parallel Work Item execution.

#### FR-23: Bounded and provider-neutral agent execution

The Audit Agent operates within the Procedure Version's fixed limits and configuration.

**Consequences (testable):**
- Limits are: retries per Step Execution; a Run-level count of Step Executions; Run-level time and tokens. Allowed tools and actions, model identity and configuration, and prompt version are recorded per Run; none can be changed by retrieved content.
- Exhausting a limit produces a *retry or skip* Escalation, Inconclusive, or Run Failed according to addendum §E, never a fabricated Observation. A fabricated Observation is one whose attribute value the corroboration check (FR-33) cannot read from its grounding; every such value is detected.
- Retrieved markup and prompt-like content are stored as untrusted data and rendered inert in every surface.

### 4.6 Live Supervision

**Description:** The Auditor can watch the Audit Agent work, see what it is doing, inspect Evidence as it is collected, intervene, or leave it to finish. Realizes UJ-3.

#### FR-24: Live View

An Auditor can open a Live View of a Running, Paused, or Awaiting Auditor Run.

**Consequences (testable):**
- The Live View shows the current Step, current Work Item, the workspace screen, Observations captured so far, Evidence as it is registered, and any open Escalation.
- `[ASSUMPTION]` The view reflects agent progress within 5 seconds.
- Closing the Live View does not affect the Run.

#### FR-25: Pause and resume

An Auditor can pause a Running Run and resume a Paused Run.

**Consequences (testable):**
- Pause takes effect at the next Tool Action boundary; no new Target System action starts while Paused.
- The workspace is preserved while Paused up to a bounded timeout, after which the Run ends Inconclusive with reason recorded and Evidence preserved. `[ASSUMPTION]` Timeout is 30 minutes, shorter than the Escalation timeout because a Pause has no one waiting to be asked.
- Pause and resume record actor, time, and Step.

#### FR-26: Cancel and rerun

An authorized user can cancel an active Run (Queued, Running, Paused, or Awaiting Auditor) or start a new Run without changing prior Runs.

**Consequences (testable):**
- Cancellation stops further Target System actions and preserves Evidence already collected with a Canceled status. Canceled is reserved for explicit human cancellation.
- A rerun creates a new Run linked to, but not overwriting, the prior Run.

#### FR-27: Escalation

The Audit Agent, or the platform on its behalf, can raise a typed Escalation when execution cannot proceed safely, and an Auditor can answer it. An Auditor can also flag a Run to an Audit Manager.

**Consequences (testable):**
- The PoC Escalation kinds and their closed answer sets are:
  - *choose candidate* — raised by the platform when a search's captured result rows contain no row whose grounded identity attribute equals the record key. When exactly one row's grounded key equals the key, the platform resolves the match with no Escalation. The human may pick a row only by a secondary key the Procedure Version declares (for example full name); the record is then flagged human-matched in every Result, list, and export. Otherwise: mark the record ambiguous.
  - *unnamed value* — raised by the platform when a corroborated value is outside the set a compiled condition names: mark the record Unevaluated and continue, or abort the Run (addendum §B).
  - *retry or skip* — raised by the platform when a Step Execution's retry limit is exhausted, before the Work Item is marked Failed: retry (one more bounded retry cycle, counted against the Run-level Step Execution limit), skip (Work Item Uninspected), or abort.
- *abort* ends the Run Canceled with reason "Escalation answer: abort" and the actor recorded.
- An Escalation states the Step, the kind, the supporting Evidence, and the options; the Run enters Awaiting Auditor.
- Free-text notes on an answer are recorded but never enter the agent's instruction context; the agent receives only the chosen option. The rendered question is labeled as agent-generated content and rendered inert.
- An answer is recorded with actor and time, applies only to that Run, and appears in the Execution Timeline and Workpaper Bundle. No answer evaluates a record Compliant or Exception, or changes scope, credentials, tools, or the Compliance Rule.
- An unanswered Escalation times out to Inconclusive with the question preserved and Evidence retained. `[ASSUMPTION]` Timeout is 4 hours for both manual and scheduled Runs; the workspace is preserved for the full timeout.
- An Auditor-raised flag attaches a note to the Run, notifies every Audit Manager (FR-28), and has no execution effect.

#### FR-28: Escalation notification

When a Run enters Awaiting Auditor, or an Auditor flags a Run, the system notifies the initiating Auditor — or the Procedure's author for scheduled Runs — and every Audit Manager.

**Consequences (testable):**
- Notification is delivered in-app and by email; each delivery, or delivery failure, is recorded on the Audit Trail.
- Notification content names the Procedure, Run, Escalation kind, and time remaining before timeout, and contains no Evidence values or secrets.

### 4.7 Execution Timeline and Replay

**Description:** Every Run has an authoritative, ordered record of what was done, and any completed or stopped Run can be replayed without re-executing it. Realizes UJ-4 and UJ-6.

#### FR-29: Execution Timeline

An authorized user can inspect the ordered Execution Timeline for any Run.

**Consequences (testable):**
- The Timeline includes Session Steps, Work Items, Step Executions, sanitized Tool Actions, Observations, Evidence registrations, rule evaluations, Agent-Judged evaluations with rationale, Escalations and answers, pauses, retries, errors, limits consumed, and model and component versions.
- The Timeline is written by IntelliFin Audit as events occur and is the authoritative execution record; the Workspace Provider's own recording is supplementary.
- Secrets and credentials never appear in the Timeline.

#### FR-30: Replay

An authorized user can replay a Completed, Inconclusive, Run Failed, or Canceled Run.

**Consequences (testable):**
- Replay renders the Timeline with the platform-owned Replay asset set — per Tool Action a timestamped screenshot or frame, the sanitized action, Observation deltas, and Escalation events (addendum §F) — aligned to Steps, and lets the user jump to any Work Item, Exception, or Escalation. Workspace Provider video is supplementary.
- Replay of a golden Run succeeds with Workspace Provider access disabled at the network level, and after the provider's retention expires.
- Replay never re-executes actions against a Target System.

### 4.8 Evidence Capture and Quality

**Description:** Evidence is captured as the work proceeds, and IntelliFin Audit proves the population was fully inspected and every Observation is true to its Evidence before issuing a conclusion. Realizes UJ-3, UJ-5.

#### FR-31: Evidence capture

The Audit Agent and Adapters capture the Evidence Requirements for each inspected record into the Run's Evidence Package.

**Consequences (testable):**
- Each Evidence item records Work Item, Target System, Step, capture method, capture time in UTC, and integrity digest.
- Each Observation links to its Evidence and carries grounding for every attribute; original artifacts remain available after any transformation.
- An Absence Observation (`found = false`) is valid only with the Evidence required by addendum §B.1, its query strings derived from the sanitized Tool Action log; otherwise the Work Item is Uninspected.

#### FR-32: Evidence Package lineage

The system creates an Evidence Package for every Run.

**Consequences (testable):**
- Every evaluated record and Exception traces to its Observations, Evidence, Steps, and Procedure Version.
- Later Population Source or Target System changes and Workspace Provider retention expiry do not remove preserved PoC Evidence.

#### FR-33: Evidence Quality Gate

Before a conclusion, the system runs every check tabulated in addendum §H — source authority and completeness, per-record coverage, absence, identity and value corroboration, condition completeness, schema, mandatory values, duplicates, freshness, and integrity. Per-Observation checks run at registration; Run-level checks run at end of execution.

**Consequences (testable):**
- A missing Population Source, population-count mismatch, uninspected record, missing required Evidence, uncorroborated attribute, unproven absence, schema change, or partial extraction cannot yield Pass.
- Corroboration re-reads every declared attribute, and the identity attribute, from its grounding in the stored Structural Snapshot with a deterministic extractor; the value must equal `original_value`, the field label must match the declared label, and the identity attribute must equal the population record key. Any mismatch marks the attribute contradictory, the record Unevaluated, and the Run Inconclusive. Corroboration never reads the live workspace. An attribute only a model can read must be declared *model-read* on the Procedure Version; a compiled condition over it is applied by the deterministic evaluator to the model-read value and recorded with origin Agent-Judged, carrying the agent's confidence for that read.
- Declared and collected counts must match exactly at file level; at inclusion level the Result lists rows in, rows included, and rows excluded with reason.
- Each check produces a visible outcome and diagnostic detail; rules follow addendum §H.

#### FR-34: Safe insufficient-evidence outcome

The system marks a Run Inconclusive when Evidence is available but insufficient, contradictory, or leaves any condition Unevaluated, and Run Failed when Run-level execution cannot complete.

**Consequences (testable):**
- Neither state is presented as a control conclusion.
- Per-Work-Item failure after bounded retries and a *retry or skip* Escalation marks the Work Item Failed or Uninspected and the Run continues; the resulting coverage failure yields Inconclusive. Run-level failure — a Session Step failing after bounded retries, or a denied action — yields Run Failed. Addendum §E is the normative home for both.
- The Result identifies affected Target Systems, checks, Work Items, and records where known.

#### FR-35: Evidence immutability

The system prevents users and administrators from altering a Run's stored Evidence, Observations, Timeline, or lineage.

**Consequences (testable):**
- Any integrity mismatch is detected and surfaced: during the Run it ends the Run as Run Failed; afterwards it is recorded as an integrity event on the Audit Trail and flagged on the Result and any export, with no state change.
- Corrections require a new Run.

### 4.9 Evaluation

**Description:** Grounded, corroborated Observations are evaluated against every condition of the Compliance Rule. Deterministic evaluators apply wherever the Auditor's conditions compiled; where they did not, the Audit Agent's judgment is recorded, flagged, and counted only after an Auditor confirms it. Agent judgment never silently becomes a conclusion. Realizes UJ-6.

#### FR-36: Normalize and match

The system normalizes the attributes the Compliance Rule uses while retaining original values and transformation history, and matches population records to Observations using exact keys.

**Consequences (testable):**
- Date/time normalization uses UTC and preserves the source time zone where provided.
- Unmatched and multiply matched records are visible and never evaluated Compliant.

#### FR-37: Rule-Classified evaluations

The system applies each compiled condition to each corroborated Observation and records a Rule-Classified evaluation per condition.

**Consequences (testable):**
- Identical Observations and Procedure Version produce identical Rule-Classified evaluations.
- A Rule-Classified evaluation cannot be overridden by any human; disagreement is recorded separately (FR-44). The non-override applies to the compiled condition, not to the record, whose other conditions may be Agent-Judged.

#### FR-38: Agent-Judged evaluations

For each uncompiled condition and each applicable record, the Audit Agent records an evaluation with rationale, the grounded Evidence relied on, and a confidence signal in [0, 1], flagged Agent-Judged.

**Consequences (testable):**
- An Agent-Judged evaluation is excluded from the System Outcome until an Auditor confirms it; while any remains unconfirmed the Result's outcome is Pending Confirmation and the Result is unsealed.
- An Auditor can confirm or reject each Agent-Judged evaluation; rejection requires the Auditor to set the condition Compliant, Exception, or Unevaluated with rationale, recorded as human-classified. The rejected evaluation is retained as history; the human one is the current evaluation.
- Agent-Judged and human-classified evaluations are visibly distinguished from Rule-Classified evaluations in every Result, list, and export.
- `[ASSUMPTION]` Agent-Judged evaluations below a confidence threshold recorded on the Procedure Version are stored as evaluations with value Unevaluated and the confidence recorded, and need no confirmation.

#### FR-39: Procedure outputs

Each Result reports the population, exclusions with reasons, inspected and uninspected records per Target System, and per-condition counts of Compliant, Exception, Agent-Judged (pending, confirmed, rejected), human-classified, unmatched, and Unevaluated evaluations, plus the Template's control-specific fields.

**Consequences (testable):**
- Outputs conform to addendum §C.
- Excluded, uninspected, or Unevaluated records are never counted as Compliant.

### 4.10 Results, Exceptions, and Auditor Review

**Description:** Auditors understand Results, investigate Exceptions, and retain accountable human review. Realizes UJ-5, UJ-6.

#### FR-40: Result summary and sealing

An Auditor can view a Run's Procedure Version, period, Evidence Quality Gate, coverage, evaluation counts, status, and outcome summary. A Result seals when the Gate has passed and every evaluation is resolved; the System Outcome is computed once, at sealing.

**Consequences (testable):**
- Pass, Control Failure, Pending Confirmation, Inconclusive, Run Failed, and Canceled are visually and semantically distinct.
- Pending Confirmation takes precedence over Control Failure while any Agent-Judged evaluation is unconfirmed.
- A Pass is available only after all Evidence Quality Gate checks pass, the Result is sealed, and no condition on any record is Exception or Unevaluated. Gate pass is necessary, not sufficient, for reliance; the Auditor still judges sufficiency.
- The Result version increments on each confirmation or rejection before sealing; the sealed System Outcome is immutable, and human dispositions and Auditor Review decisions do not rewrite it. If a rejection leaves a condition Unevaluated, the Run moves from Completed to Inconclusive at sealing (addendum §E).

#### FR-41: Exception investigation

An Auditor can open each Exception and view the violated condition, the Observation and its grounding, compared values, source lineage, the Timeline segment and Replay position where it was found, and the evaluation origin.

**Consequences (testable):**
- Every Exception has a stable identifier within its Run and a stable fingerprint across Runs of compatible Procedure Versions (addendum §B).
- Sensitive fields designated by the Population Source contract are masked in list views.

#### FR-42: Exception workflow

An Auditor can assign an Exception, add notes, and classify it as Open, Under Review, Confirmed, or Not an Exception.

**Consequences (testable):**
- "Not an Exception" requires a rationale, records human disagreement, and retains the original Exception and System Outcome.
- Changes retain actor, timestamp, prior value, and rationale.

#### FR-43: Submit, approve, reject, and finalize

An Auditor can submit a sealed Completed Result to an Audit Manager; the Audit Manager can approve or reject it and finalize only an approved Result.

**Consequences (testable):**
- Submission is blocked for unsealed (Pending Confirmation), Inconclusive, Run Failed, or Canceled Runs.
- Finalization records the reviewer, timestamp, decision, Result version, and Procedure Version; finalized Results, reviews, Exceptions, and Evidence cannot be overwritten.
- Direct finalization from Draft (including after a rejection) or Submitted, and any mutation after finalization, are denied and logged.

#### FR-44: Reviewer disagreement transparency

An Audit Manager can record a disagreement with a Rule-Classified evaluation or the System Outcome only with a rationale; the PoC permits no override of Rule-Classified evaluations.

**Consequences (testable):**
- The System Outcome and Rule-Classified evaluations remain unchanged and visible.
- The disagreement and rationale appear in the Audit Trail and Workpaper Bundle.

### 4.11 Audit Trail, Reproduction, and Export

**Description:** Enough provenance is preserved for an independent reviewer to follow, replay, and reproduce the work — and for a customer's own auditor to audit the platform. Realizes UJ-6.

#### FR-45: Append-only Audit Trail

The system records security, Procedure authoring and approval, Schedule, Run, workspace, Evidence, Escalation, notification, evaluation, confirmation, review, export, error, model and prompt change, and disagreement events.

**Consequences (testable):**
- Each event includes actor (human, Schedule, Audit Agent, Adapter, or platform), event type, UTC time, source, outcome, and correlation identifier.
- Audit Trail mutation is detectable.

#### FR-46: Workpaper Bundle export

An authorized user can export a self-contained Workpaper Bundle for any terminal Run, including Inconclusive and Run Failed Runs for diagnosis.

**Consequences (testable):**
- The bundle contains the contents in addendum §F, including the Execution Timeline, Escalations, Agent-Judged rationales and confirmations, and the Replay asset set.
- The bundle includes an integrity manifest and is readable without access to source code.

#### FR-47: Reproduction support

An authorized reviewer can use the Workpaper Bundle to reproduce a sampled Rule-Classified evaluation from its grounded Observation and to re-examine a sampled Agent-Judged evaluation against its preserved Evidence.

**Consequences (testable):**
- The bundle identifies exact Observations, grounding, Structural Snapshots, transformations, conditions, and Procedure Version; reproduction re-reads the stored Structural Snapshots only.
- Reproduction does not depend on live Target System state or the Workspace Provider.

### 4.12 Web Oversight

**Description:** Run monitoring and bounded operational diagnostics without allowing operational users to alter Results. Realizes UJ-4 and UJ-5.

#### FR-48: Runs dashboard

An authorized user can filter and inspect Runs by Procedure, status, initiator (manual or Schedule), period, and start time, and see upcoming scheduled Runs.

**Consequences (testable):**
- Control Failures, Pending Confirmation, Awaiting Auditor, and technical or evidence failures use separate filters and labels.
- The dashboard reflects the latest state within the NFR-7 bound without a page reload.

#### FR-49: Operational diagnostics

A PoC Administrator can view Target System connectivity, Workspace Provider health, Audit Runner health, errors, retries, limit consumption, and Run duration without viewing secrets.

**Consequences (testable):**
- Diagnostics link to the affected Run and correlation identifier.
- Diagnostics cannot alter a Result.

### 4.13 PoC Product-Thesis Instrumentation

**Description:** The PoC measures whether an Auditor can create and delegate a Procedure without a developer, whether the model generalizes, and what the work costs. Realizes UJ-1.

#### FR-50: Setup-without-developer instrumentation

The PoC records the human effort, roles involved, cost, and procedure-specific engineering work required to author, approve, execute, review, and maintain each Procedure.

**Consequences (testable):**
- The team can report, per Procedure, the measures SM-11 lists:
  - Auditor authoring time and approval time;
  - Escalations and manual interventions per Run;
  - "Not an Exception" dispositions per Run (false-positive rate);
  - Result approval and rejection counts;
  - tokens and Workspace Provider time consumed per Run (cost per completed test);
  - lines of procedure-specific code, and reusable versus procedure-specific components including Adapters;
  - maintenance effort after a seeded Target System change, including the FR-15 regression Run.
- Procedure-specific code means code that references a Template, Control, or Target System by identity; the target is zero for the hero Procedure. Synthetic Target Systems and golden datasets are test fixtures, not procedure-specific code.
- Measurement does not require production telemetry or customer data.

## 5. Cross-Cutting Non-Functional Requirements

- **NFR-1 — Security:** Encrypt data in transit and at rest; store secrets outside application data; redact secrets from logs, Timelines, and exports; deny cross-user or cross-Run data leakage in automated tests.
- **NFR-2 — Agent safety:** Automated abuse tests must prove that content retrieved from files, pages, or applications — including through an Escalation's rendered question — cannot expand scope, invoke denied tools, disclose secrets, alter the Compliance Rule, or modify the Run objective.
- **NFR-3 — Integrity:** Integrity verification must detect modification of preserved Evidence, Observations, Timelines, finalized Results, and Audit Trail records.
- **NFR-4 — Determinism:** Repeating evaluation against the same frozen Observations and Procedure Version must produce identical Rule-Classified evaluations; Agent-Judged evaluations must be reproducibly re-examinable from their preserved rationale and Evidence.
- **NFR-5 — Workspace isolation:** Each Agent Workspace is isolated from other Runs and from the web application, holds no credential after the Run ends, and can reach only allowlisted destinations; isolation is verified by negative tests.
- **NFR-6 — Performance:** `[ASSUMPTION]` For the hero Procedure with a population of up to 50 records across two agent-driven Target Systems, 95% of Runs complete within 30 minutes excluding Pause and Escalation wait time and simulated outages. For Runs whose Population Source and Target Systems are all adapter-acquired, with up to 10,000 records, 95% complete within 5 minutes. Golden populations for the hero are ≤ 20 records (addendum §D) so live execution is easy to observe.
- **NFR-7 — Live responsiveness:** `[ASSUMPTION]` Live View and the Runs dashboard reflect state within 5 seconds; 95% of authenticated list and detail views respond within 2 seconds under 5 concurrent users.
- **NFR-8 — Reliability:** A transient Target System or workspace failure is retried at most 3 times with bounded backoff, without duplicate Observations, Results, or Evidence. Exhausted retries map to Run Failed, a *retry or skip* Escalation, or Inconclusive per FR-34 and addendum §E.
- **NFR-9 — Schedule reliability:** A due Schedule starts its Run within 5 minutes of the scheduled time or records a missed start; a platform restart does not lose or duplicate scheduled Runs.
- **NFR-10 — Recovery:** `[ASSUMPTION]` PoC data is backed up daily with a recovery-point objective of 24 hours and recovery-time objective of 8 hours, and a restore drill reconstructs a finalized Run with every digest verified. Kept in the PoC because platform recoverability is part of the platform-assurance evidence a customer's auditor will ask for (§10).
- **NFR-11 — Accessibility:** Core web workflows, including the Procedure Builder, Live View, and Replay controls, pass automated WCAG 2.1 AA checks and are keyboard accessible; the SM-1 authoring subject may depend on it.
- **NFR-12 — Observability:** Every Run exposes duration, per-Step and per-Target System latency, Work Item counts and states, retries, limits consumed, Escalations, status, error class, and correlation identifier.
- **NFR-13 — Data handling:** Synthetic data only; no production or personal data in the PoC environment, including in workspace recordings sent to the Workspace Provider.
- **NFR-14 — Retention:** `[ASSUMPTION]` Run data, Evidence Packages, Timelines, Replay assets, Results, and Audit Trails remain available for the life of the PoC and can be deleted only through documented teardown; Replay must not depend on Workspace Provider retention.
- **NFR-15 — Runner portability and adapter contract:** `[ASSUMPTION]` Audit Runner and Agent Workspace contracts separate execution, credentials, Target System access, and Evidence return from the web application sufficiently to preserve a future private or customer-hosted runner and workspace path; Population Source and Target System kinds are implemented behind one Adapter contract so that adding a kind changes no Builder, Gate, evaluation, or review code. The PoC need not deploy outside its own environment.

## 6. Constraints and Guardrails

- The PoC is a web application with background Audit Runners hosting Adapters and Audit Agents in isolated Agent Workspaces.
- All Population Source and Target System access is read-only and uses synthetic data.
- Rule-Classified evaluations are authoritative for every compiled condition; Agent-Judged evaluations are always flagged and count only after human confirmation; every condition is evaluated for every record.
- Observations are grounded and corroborated before evaluation; absence is proven; unnamed values are Unevaluated (§1.2).
- One Audit Agent executes a Run sequentially in the PoC; the domain model must not assume this permanently.
- The Auditor names Target Systems explicitly in the PoC; the agent does not choose scope.
- Reusable domain objects, audit events, Evidence lineage, Timeline, Adapter, and Procedure Version contracts must not be hardcoded into presentation screens.
- Execution, workspace, and Evidence contracts must not assume that all future Audit Runners or Agent Workspaces share the web application's hosting boundary or provider.
- The PoC must favor truthful Inconclusive, Escalation, or Run Failed outcomes over apparent completion.

## 7. Non-Goals

These are never PoC goals. Items the PoC designs for but does not build are listed once, in §8.3.

- Autonomous assurance opinions or replacement of professional audit judgment.
- A universal no-code automation platform or free-form conversational procedure authoring; the PoC proves hybrid structured-plus-instruction authoring for one hero Procedure and Templates for three others.
- Automated remediation or any write access to a Population Source or Target System.
- Human override of Rule-Classified evaluations, including Run-time mapping of values the Compliance Rule does not name.
- Production-data use, enterprise deployment certification, or customer-hosted deployment.
- A broad Adapter catalog, commercial GRC integration, or cross-industry control library.
- General-purpose RPA or arbitrary desktop automation beyond the registered PoC Target Systems.
- Root-cause analysis, finding management, or audit-plan management.

## 8. PoC Scope

### 8.1 In Scope

- Three roles and the web workflows in UJ-1 through UJ-6.
- Procedure Builder with hybrid authoring, plan preview, approval, versioning, and regression Runs; one fully configurable hero Procedure (Terminated Users Retaining Access) and three Templates.
- Synthetic Northstar Financial Group Population Sources and Target Systems, including one web application and one desktop application driven inside the Agent Workspace and API and file Target Systems acquired by Adapters (addendum §A).
- Manual and scheduled Runs; isolated Agent Workspace; sequential Audit Agent execution; Adapter acquisition; Live View; pause, cancel, Escalation, and notification; Execution Timeline; Replay.
- Evidence capture with grounding, Evidence Packages, Evidence Quality Gate with corroboration, matching, per-condition Rule-Classified and Agent-Judged evaluation with confirmation, Result sealing, and Results.
- Exception investigation, Auditor Review, finalization, Audit Trail, and Workpaper Bundle export.
- Golden datasets covering compliant records, Exceptions, boundary cases, Agent-Judged conditions, Escalation triggers, transcription errors, unproven absence, bad Evidence, injection, and technical failure.

**P0 capability map.** PoC acceptance requires all sixteen capabilities named in the product owner's revision-2 directive (logged in `.memlog.md`, 2026-09-01); the directive's label is shown in quotes where it differs from the PRD term:

| P0 capability | FRs |
| --- | --- |
| 1 Procedure Builder | FR-4, FR-12, FR-13, FR-14, FR-15 |
| 2 Population Source configuration ("Evidence/Population Source Configuration") | FR-6 |
| 3 Target System Configuration | FR-7 |
| 4 Audit Instructions | FR-8 |
| 5 Compliance Rule ("Compliance/Exception Rules") | FR-9, FR-37, FR-38 |
| 6 Evidence Requirements | FR-10 |
| 7 Period/Scope | FR-5 |
| 8 Schedule ("Frequency") | FR-11, FR-16, FR-17, FR-18 |
| 9 Agent Workspace ("Autonomous Audit Workspace") | FR-19, NFR-5 |
| 10 Agent execution and Live View ("Live Agent Execution") | FR-20, FR-22, FR-23, FR-24 |
| 11 Execution Timeline | FR-29 |
| 12 Replay | FR-30 |
| 13 Evidence Capture | FR-21, FR-31, FR-32, FR-33 |
| 14 Results and Exceptions | FR-39 to FR-42 |
| 15 Auditor Review | FR-43, FR-44 |
| 16 Pause/Cancel/Escalation | FR-25 to FR-28 |

### 8.2 Maturity Paths Beyond the PoC

| Dimension | PoC | Next | Vision |
| --- | --- | --- | --- |
| Target System discovery | Auditor specifies systems | Agent recommends systems for approval | Agent discovers scope; Auditor approves before execution |
| Procedure authoring | Structured fields + natural-language instructions + plan preview | Conversational drafting into the same structured Procedure | Auditor delegates conversationally — "Every Monday, check all employees terminated in the previous week and verify that they no longer have access to the systems they were assigned. Escalate any active privileged accounts immediately." — and the product translates that intent into a reviewable executable Procedure, including finding-triggered immediate escalation |
| Execution model | One Audit Agent, sequential Work Items | Parallel Work Items within one governed Run | Large Procedures decompose into many Audit Assignments across workers or agents in one Run |
| Evidence sources | Files, APIs, web and desktop applications | Unstructured documents (approvals, policies, tickets) | Any source a human auditor could inspect |
| Procedure library | Four Templates | Tenant-authored Templates | Reusable regulated-industry control packs and third-party integrations |
| Execution cadence | Once, daily, weekly, monthly Schedules | Event- and risk-driven cadence | Risk-appropriate continuous execution with Exception aggregation and ownership |

### 8.3 Deferred Beyond the PoC

The PoC designs for these but does not build them; inline `[NON-GOAL for PoC]` tags point here.

- Agent-recommended or agent-discovered scope; conversational authoring; parallel Work Item execution or multiple Audit Agents per Run; finding-triggered escalation; unstructured documents as Population Sources or Target Systems; control packs (§8.2).
- Continuous monitoring, alerts, trends, materiality-based suppression, default Exception ownership, default reviewers per Procedure, and cross-Run Exception aggregation beyond stable fingerprints.
- Separation of the Audit Manager who confirms Agent-Judged evaluations from the one who approves the Result.
- A platform-assurance evidence pack (change control, model and prompt change log, incident log, restore-drill records) for a customer's own auditor.
- Design-partner Population Sources and integrations.
- Private cloud or customer-hosted runners and workspaces, SSO, tenant administration, and enterprise retention policies.
- Commercial-scale performance, availability, recovery, support, and regulatory certification.

## 9. Success Metrics

### 9.1 Primary

- **SM-1 — Delegation without a developer:** An Auditor authors, submits, and obtains approval for the hero Procedure using only the Procedure Builder, with zero procedure-specific code written, and its Run completes end to end. Validates FR-4 through FR-14 and FR-50.
- **SM-2 — Observable autonomous execution:** For the hero Procedure, a Run is watched live, paused, escalated, resumed, and later replayed, with every Step, Observation, and Escalation visible in the Timeline. Validates FR-19, FR-20, FR-22 through FR-27, FR-29, FR-30.
- **SM-3 — Unattended scheduled execution:** At least one scheduled Run completes with no human session active and its Result is available for review the next working day. Validates FR-17.
- **SM-4 — Evaluation correctness and consistency:** All four golden datasets identify every expected compliant record and Exception with no unexplained discrepancies; every Agent-Judged evaluation in the golden set is correct or Unevaluated, and none is confidently wrong. Two consecutive Runs of each golden dataset yield identical terminal outcomes and identical Rule-Classified counts, excluding the ambiguous record addendum §D exempts, with any Observation difference explained. Validates FR-36 through FR-39, NFR-4.
- **SM-5 — Safe evidence failure:** 100% of seeded missing, stale, truncated, uninspected, uncorroborated, unproven-absence, malformed, contradictory, or inaccessible Evidence cases reach their expected *terminal* outcome of Inconclusive or Run Failed; none reach Pass, including after an Escalation is answered. Validates FR-27, FR-33, FR-34.
- **SM-6 — Complete lineage and replay:** 100% of evaluated records and Exceptions trace to grounded Observations, Evidence, Timeline Steps, and Procedure Version, and are reachable in Replay with the Workspace Provider unreachable. Validates FR-29 through FR-32, FR-41.
- **SM-7 — Reproducibility:** An independent audit reviewer reproduces a sampled Rule-Classified evaluation and re-examines a sampled Agent-Judged evaluation for each Procedure using its Workpaper Bundle without access to source code. Validates FR-46, FR-47.

### 9.2 Secondary

- **SM-8 — Generalization:** The three non-hero Templates execute through the same Builder, Timeline, Evidence, Gate, evaluation, and review components as the hero, differing only in which Adapters and Target System kinds they use; procedure-specific logic is isolated and measured. Validates FR-4, FR-21, FR-50.
- **SM-9 — Review completeness:** 100% of finalized Results have a named Audit Manager, timestamp, Procedure Version, sealed System Outcome, confirmed Agent-Judged evaluations, and preserved decision history. Validates FR-38, FR-43 through FR-45.
- **SM-10 — Scope enforcement:** Automated security tests deny all seeded write attempts, out-of-scope destinations, credential disclosure, and tool-use attempts caused by injected content in files, pages, applications, or Escalation questions. Validates FR-3, FR-19, FR-23, FR-27, NFR-2, NFR-5.
- **SM-11 — Implementation baseline:** Authoring time, approval time, Escalations, manual interventions, false-positive rate, approval and rejection counts, cost per completed test, procedure-specific code, reusable components, and seeded Target System-change maintenance effort are recorded for all four Procedures, and compared for the hero against a manual or scripted baseline (Open Question 9). Validates FR-50.

### 9.3 Counter-Metrics

- **SM-C1 — No false confidence:** Do not reduce Inconclusive, Escalation, or Run Failed rates by weakening the Evidence Quality Gate, corroboration, or the Agent-Judged confirmation requirement.
- **SM-C2 — No autonomy theater:** Do not optimize for fewer Escalations, more agent actions, or faster Runs at the expense of correct, bounded, reproducible completion.
- **SM-C3 — No hidden services burden:** Track procedure-specific code and manual setup; a demo that needs a developer per Procedure does not prove the thesis.
- **SM-C4 — No silent judgment:** Do not increase the share of conditions evaluated by the agent rather than by compiled rules unless the Auditor chose it in the Compliance Rule, and never let an unevaluated condition pass.

## 10. Risks and Mitigations

- **False Pass from uncorroborated Observations, unproven absence, or uninspected records:** Ground every attribute, corroborate against Evidence, prove absence, and make per-record coverage a hard Gate prerequisite; seed transcription-error and silent-timeout cases.
- **Agent judgment mistaken for assurance:** Flag Agent-Judged evaluations everywhere, exclude them from the outcome until confirmed, evaluate every condition for every record, and record rationale and Evidence.
- **Non-repeatability and model drift:** Freeze Evidence Packages, Observations, and Timelines; bind Runs to immutable Procedure Versions and component versions; require a regression Run when model, prompt, tool, or Target System registration changes (FR-15); measure Run-to-Run consistency (SM-4).
- **Prompt injection through files, pages, desktop applications, or Escalation questions:** Treat all retrieved content as untrusted, type Escalations with closed answers, enforce origin and action allowlists in the workspace, isolate credentials, and test denied behavior.
- **Desktop automation fragility:** Limit the PoC desktop Target System to a stable synthetic application; treat layout failures as Escalation or Inconclusive, never as fabricated Observations.
- **Workspace Provider dependency:** Keep the Timeline and Evidence authoritative and provider-neutral; own the Replay asset set in IntelliFin Audit storage.
- **Escalation fatigue:** Measure Escalations per Run; refine Templates and Compliance Rules rather than suppressing Escalation.
- **Exception fatigue on scheduled Runs:** A weekly Schedule re-raises unchanged Exceptions every Run; stable fingerprints (FR-41) identify them and aggregation is deferred (§8.3), which the PoC accepts because populations are small.
- **Platform not itself auditable:** A customer's auditor will ask for evidence over IntelliFin Audit's own access, changes, models, logs, completeness controls, tamper resistance, incidents, and data handling. The PoC seeds this through FR-23, FR-29, FR-45, NFR-3, and NFR-10; a platform-assurance evidence pack is deferred (§8.3).
- **Builder becomes a developer tool:** Measure SM-1 with a real Auditor; keep the plan preview readable without code.
- **Disposable-demo architecture:** Require shared domain and Adapter contracts and measure reuse across Templates.

## 11. Open Questions

1. Which model and provider should power plan derivation (FR-12) and Agent-Judged evaluation (FR-38)? **Owner:** Engineering. **Revisit:** after the hero-Procedure benchmark on golden and adversarial cases.
2. What confidence threshold applies to Agent-Judged evaluations, and who sets it per Procedure Version? **Owner:** Product. **Revisit:** before the FR-38 threshold is fixed for acceptance.
3. What is the retention and region configuration for workspace session recordings at the Workspace Provider, given that the Replay asset set (addendum §F) is owned by IntelliFin Audit? **Owner:** Architecture. **Revisit:** before Replay implementation.
4. Which synthetic desktop application is built for the PoC, and on which desktop platform in the sandbox? **Owner:** Engineering. **Revisit:** when defining addendum §A Target System contracts.
5. What export formats must the Workpaper Bundle support beyond a human-readable package with Replay assets? **Owner:** Product and UX. **Revisit:** during Workpaper Bundle interaction design.
6. Who acts as the independent reviewer for SM-7, and what reproduction checklist will they follow? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.
7. Which Auditor performs SM-1 as the authoring subject, and what counts as a manual intervention? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.
8. Which deterministic extractors ground each Target System kind (accessibility tree, DOM, desktop control tree), and which hero attributes, if any, must be declared model-read because no Structural Snapshot exposes them? **Owner:** Engineering. **Revisit:** when defining addendum §A Target System contracts.
9. Who establishes the manual or scripted baseline for the hero Procedure that SM-11 compares against? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.

## 12. Assumptions Index

- §2.3 — Six inferred user journeys define the minimum web experience pending UX work.
- FR-2 — An Audit Manager may confirm Agent-Judged evaluations on, or submit, a Result they later approve.
- FR-4 — Non-hero Templates are configurable in period, Population Source, Target Systems, and Schedule; their instructions and rules are editable but not re-authored for acceptance.
- FR-11 — Single UTC time zone and fixed start time per Schedule; period derived as preceding day, week, or month.
- FR-12 — Plan derivation may use a model; the plan is reviewed data and the model identity is recorded.
- FR-24, NFR-7 — Live View and dashboard reflect agent state within 5 seconds.
- FR-25 — Paused workspace timeout of 30 minutes.
- FR-27 — Unanswered Escalation timeout of 4 hours for manual and scheduled Runs; workspace preserved for the full timeout.
- FR-38 — Low-confidence Agent-Judged evaluations are stored with value Unevaluated and need no confirmation.
- NFR-6 — Hero Procedure: 95% of Runs within 30 minutes for up to 50 records across two agent-driven Target Systems; adapter-acquired Runs: 95% within 5 minutes for up to 10,000 records.
- NFR-10 — Daily backup, 24-hour recovery-point objective, and 8-hour recovery-time objective.
- NFR-14 — PoC artifacts remain available for the PoC lifetime; Replay independent of provider retention.
- NFR-15 — Runner, workspace, and Adapter contracts preserve a future private-runner path without deploying one.
- addendum.md — Additional inferred product detail is tagged inline.
