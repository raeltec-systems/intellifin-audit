---
title: "Product Requirements Document: IntelliFin Audit"
status: draft
revision: 2
created: 2026-08-31
updated: 2026-09-01
supersedes: "revision 1 (finalized 2026-09-01)"
---

# Product Requirements Document: IntelliFin Audit

## 0. Document Purpose

This PRD defines the exploratory proof of concept (PoC) for product, design, engineering, audit, and downstream planning teams. It turns the [IntelliFin Audit product brief](../../briefs/brief-IntelliFin%20Audit-2026-08-31/brief.md) into testable product requirements. Domain and synthetic-data details are in [addendum.md](addendum.md). Inferred decisions are tagged `[ASSUMPTION]` and indexed in §12.

**Revision 2** re-centres the PoC on a clarified product thesis (§1). It supersedes revision 1 in full. Functional requirements are renumbered; addendum §I maps old identifiers to new ones. The architecture spine dated 2026-09-01 and the UX handoff dated 2026-09-01 were derived from revision 1 and must be revised against this document before build.

## 1. Vision and Product Thesis

> **IntelliFin Audit allows an auditor to define an audit procedure once and delegate its repeated execution to an autonomous audit agent. The agent performs the work using the same files, applications, and interfaces available to a human auditor, while every action and conclusion remains observable, replayable, evidence-backed, and subject to human review.**

The central experience is not a set of preconfigured control tests. It is an Auditor configuring an Audit Procedure, delegating it to an Audit Agent — a digital junior auditor working under supervision — and then watching live, or replaying later, as that agent actually performs the audit work: opening the population file, signing in to each Target System with approved audit credentials, looking up each record, inspecting what it finds, capturing evidence, and submitting completed work for review.

This agentic execution experience is not an optional experiment. It is the core product experience and the principal thesis the PoC exists to prove. The PoC proves it only when the Audit Agent's work is trustworthy in both directions: correct where the evidence supports a conclusion, and honestly Inconclusive, escalated, or failed where it does not. Missing, stale, incomplete, contradictory, or inaccessible evidence must never yield a Pass.

The product's primary object is the **Audit Procedure**, not the Control. A Control is what the business must do ("terminated users must have their access revoked"). An Audit Procedure is what the Auditor instructs IntelliFin Audit to do to determine whether that Control operated ("obtain the August leavers population from this file, identify terminated employees, inspect these two systems for each employee, verify account status, capture evidence, and flag active accounts"). The object chain the product is built around is:

```text
CONTROL              What should the business be doing?
   │
AUDIT PROCEDURE      How will we verify it?
   │
RUN                  Perform this test now (or on schedule)
   │
AGENT WORKSPACE      The Audit Agent actually performs the work
   │
WORKPAPERS/EVIDENCE  What did the agent observe?
   │
AUDITOR REVIEW       Can I rely on this work?
```

## 2. Target Users and Jobs

### 2.1 Users and Stakeholders

- **Economic buyer:** Chief Audit Executive or Head of Internal Audit.
- **Primary user:** Auditor, including internal auditors and IT auditors, who authors Audit Procedures, delegates Runs to the Audit Agent, supervises execution, investigates Exceptions, and prepares Results for review.
- **Oversight user:** Audit Manager, who approves Procedure Versions, monitors Runs, and performs Auditor Review.
- **System operator:** PoC Administrator, who manages users, Target System registrations, credential references, and synthetic Sources without changing Procedures, Evidence, or finalized Results.
- **Non-users for the PoC:** Risk, Compliance, audit-services firms, control owners, and external auditors.

### 2.2 Jobs to Be Done

- Describe an audit procedure once — as I would to a junior colleague — and have it executed repeatedly without a developer coding it for me.
- Delegate the mechanical work of looking things up across systems while keeping my name on the conclusion.
- See what the agent is doing right now, step in when it needs me, and otherwise leave it to finish.
- Replay what the agent did, for myself or a reviewer, without re-running it.
- Determine whether the Evidence is sufficient before relying on a Result.
- Trace every Exception to its source records, the agent's actions, and the rule or judgment that flagged it.
- Distinguish a Control Failure from a Run Failed, Inconclusive, or Escalated outcome.
- Review, annotate, approve, or reject Results while preserving professional accountability.

### 2.3 Key User Journeys

`[ASSUMPTION]` These journeys establish the minimum web experience; detailed UX remains downstream work. They follow one hero Audit Procedure — Terminated Users Retaining Access — through the full object chain.

- **UJ-1. Daniel builds the Terminated Users procedure.** Daniel, an IT Auditor at Northstar Financial Group, opens Procedures, chooses the *Terminated Users Retaining Access* Procedure Template, and works through the Procedure Builder. He sets the period to August 2026, uploads the August leavers spreadsheet as the Population Source, sets the inclusion rule to employees marked `Terminated`, selects LoanCore and LedgerDesk as Target Systems, and writes the Audit Instructions in plain language: search for each terminated employee in each Target System and inspect the account. He sets the Compliance Rule — compliant when no account exists or the account is disabled; exception when an active account exists — and the Evidence Requirements: username, account status, roles, and a screenshot of the account page. He sets the Schedule to weekly. The builder shows him the executable plan it derived — the Steps the Audit Agent will take — in language he can check. He submits the Procedure Version for approval.
- **UJ-2. Maya approves the procedure.** Maya, the Audit Manager, opens the submitted Procedure Version, reads the plan, checks that the Target Systems and credentials are read-only audit accounts, and approves it. The version is frozen; the Schedule becomes active.
- **UJ-3. Daniel watches the agent work.** Daniel starts a Run now rather than waiting for the Schedule. IntelliFin Audit creates an isolated Agent Workspace. In the Live View he sees the Audit Agent open the leavers spreadsheet, identify twelve terminated employees, open LoanCore in the workspace browser, sign in with the audit credential, and search for the first employee. The Execution Timeline shows the current Step, the Observation just captured, and the screenshot attached to it. On the seventh employee the agent finds an account whose status is `Suspended`, which the Compliance Rule does not name; it raises an Escalation. Daniel answers that `Suspended` is to be treated as disabled for this Run, the answer is recorded, and the agent continues into LedgerDesk, the desktop finance client. Daniel closes the tab and leaves it to finish.
- **UJ-4. The weekly Run happens without anyone watching.** The following Monday the Schedule starts a Run at 06:00. No one is signed in. The Audit Agent completes all twelve lookups across both Target Systems, captures Evidence, and submits the Result. Daniel opens Replay over coffee, scrubs to the two Exceptions, and sees exactly what the agent saw when it found each active account.
- **UJ-5. Maya refuses an unsafe conclusion.** A later Run is marked Inconclusive: LoanCore's search returned a timeout for three employees and the Evidence Quality Gate refused to count uninspected records as compliant. Maya sees the failed coverage check, the affected records, and confirms that no Pass or Control Failure was issued. She requests a new Run; the original is unchanged.
- **UJ-6. Maya reviews, reproduces, and finalizes.** Maya opens a submitted Result. One record carries an Agent-Judged classification: the agent judged a LedgerDesk role list to be privileged. She inspects the agent's rationale and the screenshot, confirms the judgment, and it now counts toward the System Outcome. She reproduces a sampled Exception from the exported Workpaper Bundle, approves, and finalizes; the platform records her identity, time, and decision.

## 3. Glossary

- **Agent-Judged classification** — A per-record classification produced by the Audit Agent for a record the Compliance Rule cannot evaluate deterministically. It carries the agent's rationale and supporting Evidence, is visibly flagged, and counts toward the System Outcome only after Auditor confirmation.
- **Agent Workspace** — Isolated execution environment created for one Run in which the Audit Agent opens files, drives browsers and applications, and captures Evidence. Torn down when the Run ends; its session recording feeds Replay.
- **Audit Agent** — The autonomous executor that performs a Run inside an Agent Workspace under the Procedure Version's scope, credentials, tools, and limits. One Audit Agent executes a Run sequentially in the PoC.
- **Audit Instructions** — Natural-language description, written by the Auditor, of what the Audit Agent should do in the Target Systems.
- **Audit Manager** — Authorized human who approves Procedure Versions and performs Auditor Review.
- **Audit Procedure (Procedure)** — The product's primary object: an Auditor's instruction set for determining whether a Control operated, comprising scope, Population Source, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, and Schedule. Its executable definitions are preserved as Procedure Versions.
- **Audit Runner** — Background execution service that hosts the Audit Agent and its Agent Workspace for a Run.
- **Auditor** — Authorized human who authors Procedures, starts and supervises Runs, investigates Exceptions, confirms Agent-Judged classifications, and prepares Results for review.
- **Auditor Review** — Human approval or rejection of a Result; it is not an automated assurance opinion.
- **Compliance Rule** — The Auditor-authored conditions defining what constitutes a compliant record and what constitutes an Exception. Conditions that can be expressed structurally are compiled to deterministic rules.
- **Control** — A business obligation the Procedure tests. Reference data in the PoC; a Procedure names the Control it verifies.
- **Control Failure** — A valid Fail outcome caused by one or more Exceptions that count toward the System Outcome.
- **Escalation** — A question the Audit Agent raises to an Auditor when it cannot proceed safely; the Run waits until answered or times out. The answer is recorded and scoped to that Run.
- **Evidence** — Source data, Observation, screenshot, recording segment, or artifact captured for a Run.
- **Evidence Package** — Immutable Run-specific collection of original Evidence, Observations, metadata, transformations, and integrity information.
- **Evidence Quality Gate** — Checks for source authority, scope, freshness, population completeness, per-record coverage, schema validity, duplicates, nulls, and retrieval failures that must pass before a control conclusion is issued.
- **Evidence Requirement** — The Auditor-specified set of attributes and artifacts the Audit Agent must capture for each inspected record.
- **Exception** — A record or matched record set classified as violating the Compliance Rule, whether Rule-Classified or confirmed Agent-Judged.
- **Execution Timeline** — Ordered, timestamped record of every Step, Observation, tool action, Escalation, and state change in a Run. The authoritative execution record; Replay renders it.
- **Live View** — Web surface showing a Run in progress: current Step, workspace screen, Observations, and Evidence as captured, with pause, cancel, and Escalation controls.
- **Observation** — A structured record of what the Audit Agent found for one population record in one Target System (attributes, values, timestamp, and linked Evidence).
- **PoC Administrator** — User who manages PoC access, Target System registrations, credential references, and synthetic Sources.
- **Population Source** — The file, system, or surface from which the Audit Agent obtains the population to test, with its inclusion rule.
- **Procedure Template** — A pre-authored, partially configured Procedure supplied with the PoC from which an Auditor creates a Procedure.
- **Procedure Version** — Immutable definition of a Procedure at approval time, including its compiled executable plan, model and tool configuration, and Schedule.
- **Replay** — Playback of a completed or stopped Run from its Execution Timeline, Evidence, and workspace session recording, without re-executing it.
- **Result** — Run output containing an immutable System Outcome, summary, Exceptions, Evidence lineage, and separate Auditor Review state.
- **Rule-Classified classification** — A per-record classification produced deterministically from Observations by the compiled Compliance Rule.
- **Run** — One governed execution of one Procedure Version against a defined effective period, started manually or by Schedule. A Run is composed of Work Items.
- **Run Failed** — Technical failure that prevents valid execution.
- **Schedule** — Frequency attached to a Procedure Version: once, daily, weekly, or monthly. An active Schedule starts Runs unattended.
- **Step** — One unit of the executable plan the Audit Agent performs (open file, sign in, search, inspect, capture).
- **System Outcome** — Deterministic control conclusion of Pass or Control Failure computed from Rule-Classified and confirmed Agent-Judged classifications after the Evidence Quality Gate passes; it is not changed by human disposition.
- **Target System** — An approved application, web surface, or desktop application the Audit Agent inspects, registered with a read-only audit credential reference.
- **Work Item** — The unit of work within a Run; in the PoC one Work Item per population record per Target System, executed sequentially by one Audit Agent. The model permits future parallel execution.
- **Workpaper Bundle** — Export containing enough information for a competent reviewer to understand, replay, and reproduce a Result.

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
- An Auditor can author Procedures, submit Procedure Versions for approval, start and supervise Runs, answer Escalations, investigate Exceptions, confirm Agent-Judged classifications, annotate Results, and submit Results for review.
- An Audit Manager can perform all Auditor actions and can approve or reject Procedure Versions and approve, reject, or finalize a Result. An Audit Manager cannot approve a Procedure Version they authored.
- A PoC Administrator can manage users, Target System registrations, credential references, and Source configuration but cannot author or approve Procedures or alter Evidence, classifications, or finalized Results.

#### FR-3: Enforced read-only execution

The Audit Agent can invoke only allowlisted read operations within the Procedure Version's Population Source and Target System scope.

**Consequences (testable):**
- Write operations, arbitrary code or shell execution outside the Agent Workspace sandbox, out-of-scope systems or origins, and parameter-scope violations are denied and logged.
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

#### FR-5: Period and scope

An Auditor can set the effective period and scope the Procedure tests.

**Consequences (testable):**
- The period is an explicit date range; a scheduled Run derives its period from the Schedule (addendum §C) and records the derivation.
- Scope statements are recorded verbatim on the Procedure Version and shown in every Result.

#### FR-6: Population Source configuration

An Auditor can specify where the population is found and which records are included.

**Consequences (testable):**
- The PoC supports an uploaded spreadsheet or CSV, a versioned file Source, and a read-only API Source as Population Sources.
- The inclusion rule is a structured filter over declared columns or fields (for example `status = Terminated`) and is applied deterministically.
- The Population Source must supply or be accompanied by an independently declared expected record count; its absence is surfaced at authoring time.

#### FR-7: Target System configuration

An Auditor can select one or more registered Target Systems the Audit Agent must inspect.

**Consequences (testable):**
- Only Target Systems registered by a PoC Administrator with a read-only credential reference and an allowlisted origin or application identity can be selected.
- The PoC includes at least one web Target System and one desktop Target System (addendum §A).
- The Procedure Version records, per Target System, the allowed origins or application, the credential reference, and the read-only actions permitted.
- Target System discovery is explicit in the PoC: the Auditor names the systems. `[NON-GOAL for PoC]` Agent-recommended or agent-discovered scope.

#### FR-8: Audit Instructions

An Auditor can write natural-language Audit Instructions describing what the Audit Agent should do in each Target System.

**Consequences (testable):**
- Instructions are stored verbatim on the Procedure Version and displayed in the plan, Live View, Replay, and Workpaper Bundle.
- Instructions cannot widen scope: an instruction referencing an unregistered system, a write action, or an out-of-scope origin is flagged at authoring and denied at execution.

#### FR-9: Compliance Rule

An Auditor can define the conditions under which an inspected record is compliant and the conditions under which it is an Exception.

**Consequences (testable):**
- Conditions expressed over declared Observation attributes (for example `account_status in {none, disabled}`) compile to deterministic rules; the builder shows which conditions compiled.
- Conditions the builder cannot compile are retained as natural language and marked as requiring Agent-Judged classification; the Auditor sees this before submission.
- Boundary semantics (inclusive or exclusive) are explicit for every comparison.
- Unmatched, ambiguous, uninspected, or unevaluated records never satisfy the compliant condition.

#### FR-10: Evidence Requirements

An Auditor can specify the attributes and artifacts the Audit Agent must capture for each inspected record.

**Consequences (testable):**
- The PoC supports attribute values, a screenshot of the relevant screen, the source file excerpt, and the workspace recording segment as Evidence Requirement types.
- A record whose required Evidence was not captured is not classified compliant and is reported by the Evidence Quality Gate.

#### FR-11: Schedule

An Auditor can set the Procedure to run once, daily, weekly, or monthly.

**Consequences (testable):**
- The Schedule is part of the Procedure Version and activates only on approval.
- `[ASSUMPTION]` The PoC uses a single time zone (UTC) and a fixed start time per Schedule; the effective period for each scheduled Run is the preceding day, week, or month.

#### FR-12: Executable plan preview

Before submitting, an Auditor can read the executable plan the builder derived from the structured fields and Audit Instructions.

**Consequences (testable):**
- The plan lists the ordered Steps per Target System, the Observations to capture, the compiled rules, the conditions requiring Agent-Judged classification, the credentials referenced, and the execution limits.
- The plan is readable by an Auditor without inspecting code or prompts and is frozen into the Procedure Version at approval.
- `[ASSUMPTION]` Plan derivation may use a model; the derived plan is data the Auditor reviews, and the model's identity and version are recorded on the Procedure Version.

### 4.3 Procedure Approval and Versioning

**Description:** A Procedure executes only as an approved, immutable Procedure Version. Realizes UJ-2.

#### FR-13: Submit and approve a Procedure Version

An Auditor can submit a Procedure for approval, and an Audit Manager who is not its author can approve or reject it.

**Consequences (testable):**
- Approval freezes the Procedure Version, including its plan, Compliance Rule, Evidence Requirements, Target Systems, credential references, model and tool configuration, limits, and Schedule.
- Rejection returns the Procedure to draft with the reviewer's rationale recorded.
- Approval records approver, time, and a diff against the previous version where one exists.

#### FR-14: Immutable Procedure Versions

The system executes every Run against exactly one approved Procedure Version.

**Consequences (testable):**
- A Run retains its Procedure Version even if a newer version is approved.
- Any change to scope, Population Source, Target Systems, Audit Instructions, Compliance Rule, Evidence Requirements, Schedule, model, or tool configuration creates a new draft Procedure Version requiring approval.
- Approving a new version retires the prior version's Schedule; in-flight Runs complete on their own version.

### 4.4 Run Initiation and Scheduling

**Description:** Runs start manually or by Schedule and are governed identically. Realizes UJ-3 and UJ-4.

#### FR-15: Manual Run initiation

An Auditor can start a Run for an approved Procedure Version and effective period.

**Consequences (testable):**
- The system prevents overlapping active Runs for the same Procedure Version and effective period.
- Each accepted request creates one Run with a unique correlation identifier and records the initiating Auditor.

#### FR-16: Scheduled Run initiation

The system starts a Run unattended when an active Schedule falls due.

**Consequences (testable):**
- A scheduled Run records the Schedule as initiator and the derived effective period.
- A missed or failed scheduled start is recorded and surfaced on the Runs dashboard; it is never silently skipped.
- At least one scheduled Run in PoC acceptance completes with no human session active.

#### FR-17: Observable Run lifecycle

The system shows a Run as Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, or Canceled.

**Consequences (testable):**
- Users can distinguish platform failure from Control Failure and from waiting on a human.
- Every state transition records time, actor (human, Schedule, or Audit Agent), reason, and prior state.

### 4.5 Agent Workspace and Autonomous Execution

**Description:** When a Run begins, IntelliFin Audit creates an isolated Agent Workspace and the Audit Agent performs the Procedure through the relevant files, browsers, and applications, much like a human auditor would. Solari supplies the browser and desktop sandbox and its session observability in the PoC. Realizes UJ-3 and UJ-4.

#### FR-18: Isolated Agent Workspace per Run

The system creates a fresh, isolated Agent Workspace for each Run and destroys it when the Run ends.

**Consequences (testable):**
- No file, session, cookie, or credential persists from one Run's workspace to another.
- The workspace can reach only the Procedure Version's allowlisted origins and applications; other network egress is denied and logged.
- Workspace creation failure results in Run Failed before any Step executes.

#### FR-19: Audit Agent performs the plan

The Audit Agent executes the Procedure Version's plan Step by Step: opens the Population Source, applies the inclusion rule, signs in to each Target System with the referenced audit credential, locates each population record, inspects it, and captures the required Evidence and an Observation.

**Consequences (testable):**
- Every Step records its start, end, tool actions, and outcome on the Execution Timeline.
- Credentials are supplied to the workspace just in time and never appear in the Execution Timeline, Evidence, logs, or exports.
- A population record with no Observation for a required Target System is reported as uninspected to the Evidence Quality Gate.
- The Audit Agent stops and reports rather than guessing when a Step cannot be completed within its retry and time limits.

#### FR-20: Work Items and sequential PoC execution

A Run is composed of Work Items — one per population record per Target System in the PoC — executed sequentially by one Audit Agent.

**Consequences (testable):**
- Each Work Item has its own state, Observation, Evidence, and Timeline segment.
- Run-level completeness is computed from Work Item states.
- The data model does not assume one Run equals one worker; `[NON-GOAL for PoC]` parallel Work Item execution.

#### FR-21: Bounded and provider-neutral agent execution

The Audit Agent operates within the Procedure Version's fixed limits and configuration.

**Consequences (testable):**
- Step, time, token, and retry limits, allowed tools and actions, model identity and configuration, and prompt version are recorded per Run and cannot be changed by retrieved content.
- Exhausting a limit produces Escalation, Inconclusive, or Run Failed according to addendum §E, never a fabricated Observation.
- Retrieved markup and prompt-like content are stored as untrusted data and rendered inert in every surface.

### 4.6 Live Supervision

**Description:** The Auditor can watch the Audit Agent work, see what it is doing, inspect Evidence as it is collected, intervene, or leave it to finish. Realizes UJ-3.

#### FR-22: Live View

An Auditor can open a Live View of a Running or Paused Run.

**Consequences (testable):**
- The Live View shows the current Step, current Work Item, the workspace screen, Observations captured so far, and Evidence as it is registered.
- `[ASSUMPTION]` The view reflects agent progress within five seconds.
- Closing the Live View does not affect the Run.

#### FR-23: Pause and resume

An Auditor can pause a Running Run and resume a Paused Run.

**Consequences (testable):**
- Pause takes effect at the next Step boundary; no new Target System action starts while Paused.
- The workspace is preserved while Paused up to a bounded timeout, after which the Run is Canceled with reason recorded. `[ASSUMPTION]` Timeout is 30 minutes.
- Pause and resume record actor, time, and Step.

#### FR-24: Cancel and rerun

An authorized user can cancel an active Run or start a new Run without changing prior Runs.

**Consequences (testable):**
- Cancellation stops further Target System actions and preserves Evidence already collected with a Canceled status.
- A rerun creates a new Run linked to, but not overwriting, the prior Run.

#### FR-25: Escalation

The Audit Agent can raise an Escalation when it cannot proceed safely, and an Auditor can answer it.

**Consequences (testable):**
- An Escalation states the Step, the question, the options the agent considered, and the supporting Evidence; the Run enters Awaiting Auditor.
- An answer is recorded with actor and time, applies only to that Run, and appears in the Execution Timeline and Workpaper Bundle.
- An unanswered Escalation times out to Inconclusive with the question preserved. `[ASSUMPTION]` Timeout is four hours for scheduled Runs.
- Escalation cannot change scope, credentials, tools, or the Compliance Rule.

### 4.7 Execution Timeline and Replay

**Description:** Every Run has an authoritative, ordered record of what the agent did, and any completed or stopped Run can be replayed without re-executing it. Realizes UJ-4 and UJ-6.

#### FR-26: Execution Timeline

An authorized user can inspect the ordered Execution Timeline for any Run.

**Consequences (testable):**
- The Timeline includes Steps, Work Items, sanitized tool actions, Observations, Evidence registrations, Escalations and answers, pauses, retries, errors, limits consumed, model and component versions, rule evaluations, and Agent-Judged classifications with rationale.
- The Timeline is written by IntelliFin Audit as events occur and is the authoritative execution record; the workspace provider's own recording is supplementary.
- Secrets and credentials never appear in the Timeline.

#### FR-27: Replay

An authorized user can replay a Completed, Inconclusive, Run Failed, or Canceled Run.

**Consequences (testable):**
- Replay renders the Timeline with the workspace session recording and screenshots aligned to Steps, and lets the user jump to any Work Item, Exception, or Escalation.
- Replay is available from IntelliFin Audit's preserved Evidence after the workspace provider's retention expires.
- Replay never re-executes actions against a Target System.

### 4.8 Evidence Capture and Quality

**Description:** The Audit Agent captures Evidence as it works, and IntelliFin Audit proves the population was fully inspected before issuing a conclusion. Realizes UJ-3, UJ-5.

#### FR-28: Evidence capture

The Audit Agent captures the Evidence Requirements for each inspected record into the Run's Evidence Package.

**Consequences (testable):**
- Each Evidence item records Work Item, Target System, Step, capture method, capture time in UTC, and integrity digest.
- Each Observation links to its Evidence; original artifacts remain available after any transformation.

#### FR-29: Evidence Package lineage

The system creates an Evidence Package for every Run.

**Consequences (testable):**
- Every classified record and Exception traces to its Observations, Evidence, Steps, and Procedure Version.
- Later Source or Target System changes and workspace-provider retention expiry do not remove preserved PoC Evidence.

#### FR-30: Evidence Quality Gate

Before a conclusion, the system evaluates population authority, freshness, declared-versus-collected population count, per-record coverage across every Target System, schema validity, missing mandatory fields and Evidence, duplicates, nulls, and retrieval failures.

**Consequences (testable):**
- A missing Population Source, population-count mismatch, uninspected record, missing required Evidence, schema change, or partial extraction cannot yield Pass.
- Declared and collected population counts must match exactly in the PoC; per-record coverage must be complete across all Target Systems.
- Each check produces a visible outcome and diagnostic detail; rules follow addendum §H.

#### FR-31: Safe insufficient-evidence outcome

The system marks a Run Inconclusive when Evidence is available but insufficient or contradictory, and Run Failed when execution cannot complete.

**Consequences (testable):**
- Neither state is presented as a control conclusion.
- The Result identifies affected Target Systems, checks, Work Items, and records where known.

#### FR-32: Evidence immutability

The system prevents users and ordinary administrators from altering a Run's stored Evidence, Observations, Timeline, or lineage.

**Consequences (testable):**
- Any integrity mismatch is detected and surfaced.
- Corrections require a new Run.

### 4.9 Classification

**Description:** Observations are classified against the Compliance Rule. Deterministic rules classify wherever the Auditor's conditions could be compiled; where they could not, the Audit Agent's judgment is recorded, flagged, and counted only after an Auditor confirms it. Agent judgment never silently becomes a conclusion. Realizes UJ-6.

#### FR-33: Normalize and match

The system normalizes the attributes the Compliance Rule uses while retaining original values and transformation history, and matches population records to Observations using exact keys.

**Consequences (testable):**
- Date/time normalization uses UTC and preserves the source time zone where provided.
- Unmatched and multiply matched records are visible and never classified compliant.

#### FR-34: Rule-Classified records

The system applies the compiled Compliance Rule to each Observation and classifies the record Compliant or Exception.

**Consequences (testable):**
- Identical Observations and Procedure Version produce identical Rule-Classified results.
- A Rule-Classified result cannot be overridden by any human; disagreement is recorded separately (FR-41).

#### FR-35: Agent-Judged records

For conditions the builder could not compile, the Audit Agent records a classification with rationale, the Evidence relied on, and a confidence signal, flagged Agent-Judged.

**Consequences (testable):**
- An Agent-Judged classification is excluded from the System Outcome until an Auditor confirms it; while any remains unconfirmed the Result's outcome is Pending Confirmation.
- An Auditor can confirm or reject each Agent-Judged classification; rejection requires the Auditor to classify the record Compliant, Exception, or Unevaluated with rationale, recorded as human-classified.
- Agent-Judged and human-classified records are visibly distinguished from Rule-Classified records in every Result, list, and export.
- `[ASSUMPTION]` Low-confidence Agent-Judged classifications below a Procedure-Version threshold are recorded as Unevaluated rather than as a classification.

#### FR-36: Procedure outputs

Each Result reports the population, exclusions, inspected and uninspected records per Target System, compliant, Exception, Agent-Judged, human-classified, unmatched, and Unevaluated counts, and the Template's control-specific fields.

**Consequences (testable):**
- Outputs conform to addendum §C.
- Excluded, uninspected, or Unevaluated records are never counted as compliant.

### 4.10 Results, Exceptions, and Auditor Review

**Description:** Auditors understand Results, investigate Exceptions, and retain accountable human review. Realizes UJ-5, UJ-6.

#### FR-37: Result summary

An Auditor can view a Run's Procedure Version, period, Evidence Quality Gate, coverage, classification counts, status, and outcome summary.

**Consequences (testable):**
- Pass, Control Failure, Pending Confirmation, Inconclusive, Run Failed, and Canceled are visually and semantically distinct.
- A Pass is available only after all Evidence Quality Gate checks pass, no Agent-Judged classification is unconfirmed, and no Exception counts toward the outcome.
- Human dispositions and Auditor Review decisions do not rewrite the System Outcome.

#### FR-38: Exception investigation

An Auditor can open each Exception and view the violated condition, the Observation, compared values, source lineage, the Timeline segment and Replay position where it was found, and the classification origin.

**Consequences (testable):**
- Every Exception has a stable identifier within its Run and a stable fingerprint across Runs of compatible Procedure Versions.
- Sensitive fields designated by the Source contract are masked in list views.

#### FR-39: Exception workflow

An Auditor can assign an Exception, add notes, and classify it as Open, Under Review, Confirmed, or Not an Exception.

**Consequences (testable):**
- “Not an Exception” requires a rationale, records human disagreement, and retains the original Exception and System Outcome.
- Changes retain actor, timestamp, prior value, and rationale.

#### FR-40: Submit, approve, reject, and finalize

An Auditor can submit a Completed Result to an Audit Manager; the Audit Manager can approve or reject it and finalize only an approved Result.

**Consequences (testable):**
- Submission is blocked for Pending Confirmation, Inconclusive, Run Failed, or Canceled Runs.
- Finalization records the reviewer, timestamp, decision, Result version, and Procedure Version; finalized Results, reviews, Exceptions, and Evidence cannot be overwritten.
- Direct finalization from Submitted or Rejected, and any mutation after finalization, are denied and logged.

#### FR-41: Reviewer disagreement transparency

An Audit Manager can record a disagreement with a Rule-Classified result or the System Outcome only with a rationale; the PoC permits no override of Rule-Classified results.

**Consequences (testable):**
- The System Outcome and Rule-Classified results remain unchanged and visible.
- The disagreement and rationale appear in the Audit Trail and Workpaper Bundle.

### 4.11 Audit Trail, Reproduction, and Export

**Description:** Enough provenance is preserved for an independent reviewer to follow, replay, and reproduce the work.

#### FR-42: Append-only Audit Trail

The system records security, Procedure authoring and approval, Schedule, Run, workspace, Evidence, Escalation, classification, confirmation, review, export, error, and disagreement events.

**Consequences (testable):**
- Each event includes actor (human, Schedule, Audit Agent, or service), event type, UTC time, source, outcome, and correlation identifier.
- Audit Trail mutation is detectable.

#### FR-43: Workpaper Bundle export

An authorized user can export a self-contained Workpaper Bundle for a Completed or finalized Result.

**Consequences (testable):**
- The bundle contains the contents in addendum §F, including the Execution Timeline, Escalations, Agent-Judged rationales and confirmations, and Replay assets.
- The bundle includes an integrity manifest and is readable without access to source code.

#### FR-44: Reproduction support

An authorized reviewer can use the Workpaper Bundle to reproduce a sampled Rule-Classified result and to re-examine a sampled Agent-Judged classification against its preserved Evidence.

**Consequences (testable):**
- The bundle identifies exact Observations, transformations, conditions, and Procedure Version.
- Reproduction does not depend on live Target System state or the workspace provider.

### 4.12 Web Oversight

**Description:** Run monitoring and bounded operational diagnostics without allowing operational users to alter Results.

#### FR-45: Runs dashboard

An authorized user can filter and inspect Runs by Procedure, status, initiator (manual or Schedule), period, and start time, and see upcoming scheduled Runs.

**Consequences (testable):**
- Control Failures, Pending Confirmation, Awaiting Auditor, and technical or evidence failures use separate filters and labels.
- The dashboard reflects the latest state without a page reload.

#### FR-46: Operational diagnostics

A PoC Administrator can view Target System connectivity, workspace provider health, Audit Runner health, errors, retries, limit consumption, and Run duration without viewing secrets.

**Consequences (testable):**
- Diagnostics link to the affected Run and correlation identifier.
- Diagnostics cannot alter a Result.

### 4.13 PoC Product-Thesis Instrumentation

**Description:** The PoC measures whether an Auditor can create and delegate a Procedure without a developer, and whether the model generalizes.

#### FR-47: Setup-without-developer instrumentation

The PoC records the human effort, roles involved, and procedure-specific engineering work required to author, approve, execute, and maintain each Procedure.

**Consequences (testable):**
- The team can report, per Procedure: Auditor authoring time, approval time, Escalations per Run, manual interventions per Run, lines of procedure-specific code (target: zero for the hero Procedure), reusable versus procedure-specific components, and maintenance effort after a seeded Target System change.
- Measurement does not require production telemetry or customer data.

## 5. Cross-Cutting Non-Functional Requirements

- **NFR-1 — Security:** Encrypt data in transit and at rest; store secrets outside application data; redact secrets from logs, Timelines, and exports; deny cross-user or cross-Run data leakage in automated tests.
- **NFR-2 — Agent safety:** Automated abuse tests must prove that content retrieved from files, pages, or applications cannot expand scope, invoke denied tools, disclose secrets, alter the Compliance Rule, or modify the Run objective.
- **NFR-3 — Integrity:** Integrity verification must detect modification of preserved Evidence, Observations, Timelines, finalized Results, and Audit Trail records.
- **NFR-4 — Determinism:** Repeating classification against the same frozen Observations and Procedure Version must produce identical Rule-Classified results; Agent-Judged classifications must be reproducibly re-examinable from their preserved rationale and Evidence.
- **NFR-5 — Workspace isolation:** Each Agent Workspace is isolated from other Runs and from the web application, holds no credential after the Run ends, and can reach only allowlisted destinations; isolation is verified by negative tests.
- **NFR-6 — Performance:** `[ASSUMPTION]` For the hero Procedure with a population of up to 50 records across two Target Systems, 95% of Runs complete within 30 minutes excluding Escalation wait time and simulated outages; for file and API Sources with up to 10,000 records, 95% of Runs complete within five minutes.
- **NFR-7 — Live responsiveness:** `[ASSUMPTION]` Live View reflects agent state within five seconds; 95% of authenticated list and detail views respond within two seconds under five concurrent users.
- **NFR-8 — Reliability:** A transient Target System or workspace failure is retried at most three times with bounded backoff; exhausted retries produce Run Failed without duplicate Observations, Results, or Evidence.
- **NFR-9 — Schedule reliability:** A due Schedule starts its Run within five minutes of the scheduled time or records a missed start; a platform restart does not lose or duplicate scheduled Runs.
- **NFR-10 — Recovery:** `[ASSUMPTION]` PoC data is backed up daily with a recovery-point objective of 24 hours and recovery-time objective of eight hours.
- **NFR-11 — Accessibility:** Core web workflows, including the Procedure Builder, Live View, and Replay controls, pass automated WCAG 2.1 AA checks and are keyboard accessible.
- **NFR-12 — Observability:** Every Run exposes duration, per-Step and per-Target System latency, Work Item counts and states, retries, limits consumed, Escalations, status, error class, and correlation identifier.
- **NFR-13 — Data handling:** Synthetic data only; no production or personal data in the PoC environment, including in workspace recordings sent to the workspace provider.
- **NFR-14 — Retention:** `[ASSUMPTION]` Run data, Evidence Packages, Timelines, Replay assets, Results, and Audit Trails remain available for the life of the PoC and can be deleted only through documented teardown; Replay must not depend on workspace-provider retention.
- **NFR-15 — Runner portability:** `[ASSUMPTION]` Audit Runner and Agent Workspace contracts separate execution, credentials, Target System access, and Evidence return from the web application sufficiently to preserve a future private or customer-hosted runner and workspace path; the PoC need not deploy outside its own environment.

## 6. Constraints and Guardrails

- The PoC is a web application with background Audit Runners hosting Audit Agents in isolated Agent Workspaces.
- All Population Source and Target System access is read-only and uses synthetic data.
- Rule-Classified results are authoritative wherever the Compliance Rule compiles; Agent-Judged classifications are always flagged and count only after human confirmation.
- One Audit Agent executes a Run sequentially in the PoC; the domain model must not assume this permanently.
- The Auditor names Target Systems explicitly in the PoC; the agent does not choose scope.
- Reusable domain objects, audit events, Evidence lineage, Timeline, and Procedure Version contracts must not be hardcoded into presentation screens.
- Execution, workspace, and Evidence contracts must not assume that all future Audit Runners or Agent Workspaces share the web application's hosting boundary or provider.
- The PoC must favor truthful Inconclusive, Escalation, or Run Failed outcomes over apparent completion.

## 7. Non-Goals

- Autonomous assurance opinions or replacement of professional audit judgment.
- A universal no-code automation platform or free-form conversational procedure authoring; the PoC proves hybrid structured-plus-instruction authoring for one hero Procedure and Templates for three others.
- Agent-recommended or agent-discovered Target System scope.
- Parallel Work Item execution or multiple Audit Agents per Run.
- Automated remediation or any write access to a Population Source or Target System.
- Human override of Rule-Classified results.
- Production-data use, enterprise deployment certification, or customer-hosted deployment.
- A broad connector catalog, commercial GRC integration, or cross-industry control library.
- General-purpose RPA or arbitrary desktop automation beyond the registered PoC Target Systems.
- Root-cause analysis, finding management, or audit-plan management.

## 8. PoC Scope

### 8.1 In Scope

- Three roles and the web workflows in UJ-1 through UJ-6.
- Procedure Builder with hybrid authoring, plan preview, approval, and versioning; one fully configurable hero Procedure (Terminated Users Retaining Access) and three Templates.
- Synthetic Northstar Financial Group Population Sources and Target Systems, including one web application and one desktop application driven inside the Agent Workspace (addendum §A).
- Manual and scheduled Runs; isolated Agent Workspace; sequential Audit Agent execution; Live View; pause, cancel, and Escalation; Execution Timeline; Replay.
- Evidence capture, Evidence Packages, Evidence Quality Gate, matching, Rule-Classified and Agent-Judged classification with confirmation, and Results.
- Exception investigation, Auditor Review, finalization, Audit Trail, and Workpaper Bundle export.
- Golden datasets covering compliant records, Exceptions, boundary cases, conditions requiring Agent-Judged classification, Escalation triggers, bad Evidence, and technical failure.

### 8.2 Maturity Paths Beyond the PoC

| Dimension | PoC | Next | Vision |
| --- | --- | --- | --- |
| Target System discovery | Auditor specifies systems | Agent recommends systems for approval | Agent discovers scope; Auditor approves before execution |
| Procedure authoring | Structured fields + natural-language instructions + plan preview | Conversational drafting into the same structured Procedure | Auditor delegates conversationally; product translates intent into a reviewable executable Procedure |
| Execution model | One Audit Agent, sequential Work Items | Parallel Work Items within one governed Run | Large Procedures decompose across many workers or agents in one Run |

### 8.3 Deferred Beyond the PoC

- Agent-recommended scope; conversational authoring; parallel execution (§8.2).
- Continuous monitoring, alerts, trends, and cross-Run Exception aggregation beyond stable fingerprints.
- Design-partner Sources and integrations.
- Private cloud or customer-hosted runners and workspaces, SSO, tenant administration, and enterprise retention policies.
- Commercial-scale performance, availability, recovery, support, and regulatory certification.

## 9. Success Metrics

### Primary

- **SM-1 — Delegation without a developer:** An Auditor authors, submits, and obtains approval for the hero Procedure using only the Procedure Builder, with zero procedure-specific code written, and its Run completes end to end. Validates FR-4 through FR-14 and FR-47.
- **SM-2 — Observable autonomous execution:** For the hero Procedure, a Run is watched live, paused, escalated, resumed, and later replayed, with every Step, Observation, and Escalation visible in the Timeline. Validates FR-18 through FR-27.
- **SM-3 — Unattended scheduled execution:** At least one scheduled Run completes with no human session active and its Result is available for review the next working day. Validates FR-16.
- **SM-4 — Classification correctness:** All four golden datasets identify every expected compliant record and Exception with no unexplained discrepancies; every Agent-Judged classification in the golden set is either correct or is escalated or Unevaluated. Validates FR-33 through FR-36.
- **SM-5 — Safe evidence failure:** 100% of seeded missing, stale, truncated, uninspected, malformed, contradictory, or inaccessible Evidence cases produce Inconclusive, Escalation, or Run Failed; none produce Pass. Validates FR-30, FR-31, FR-25.
- **SM-6 — Complete lineage and replay:** 100% of classified records and Exceptions trace to Observations, Evidence, Timeline Steps, and Procedure Version, and are reachable in Replay. Validates FR-26 through FR-29, FR-38.
- **SM-7 — Reproducibility:** An independent audit reviewer reproduces a sampled Rule-Classified result and re-examines a sampled Agent-Judged classification for each Procedure using its Workpaper Bundle without access to source code. Validates FR-43, FR-44.

### Secondary

- **SM-8 — Generalization:** The three non-hero Templates execute through the same Builder, Runner, Workspace, Timeline, Evidence, classification, and review components; procedure-specific logic is isolated and measured. Validates FR-4 and FR-47.
- **SM-9 — Review completeness:** 100% of finalized Results have a named Audit Manager, timestamp, Procedure Version, confirmed Agent-Judged classifications, and preserved decision history. Validates FR-35, FR-40 through FR-42.
- **SM-10 — Scope enforcement:** Automated security tests deny all seeded write attempts, out-of-scope destinations, credential disclosure, and tool-use attempts caused by injected content in files, pages, or applications. Validates FR-3, FR-18, FR-21, NFR-2, NFR-5.
- **SM-11 — Implementation baseline:** Authoring time, approval time, Escalations, manual interventions, procedure-specific code, reusable components, and seeded Target System-change maintenance effort are recorded for all four Procedures. Validates FR-47.

### Counter-Metrics

- **SM-C1 — No false confidence:** Do not reduce Inconclusive, Escalation, or Run Failed rates by weakening the Evidence Quality Gate or the Agent-Judged confirmation requirement.
- **SM-C2 — No autonomy theater:** Do not optimize for fewer Escalations, more agent actions, or faster Runs at the expense of correct, bounded, reproducible completion.
- **SM-C3 — No hidden services burden:** Track procedure-specific code and manual setup; a demo that needs a developer per Procedure does not prove the thesis.
- **SM-C4 — No silent judgment:** Do not increase the share of records classified by the agent rather than by compiled rules unless the Auditor chose it in the Compliance Rule.

## 10. Risks and Mitigations

- **False Pass from bad Evidence or uninspected records:** Make the Evidence Quality Gate, including per-record coverage, a hard prerequisite and seed adversarial datasets.
- **Agent judgment mistaken for assurance:** Flag Agent-Judged classifications everywhere, exclude them from the outcome until confirmed, and record rationale and Evidence.
- **Non-repeatability:** Freeze Evidence Packages, Observations, and Timelines; bind Runs to immutable Procedure Versions and component versions; keep Replay independent of the workspace provider.
- **Prompt injection through files, pages, or desktop applications:** Treat all retrieved content as untrusted, enforce origin and action allowlists in the workspace, isolate credentials, and test denied behavior.
- **Desktop automation fragility:** Limit the PoC desktop Target System to a stable synthetic application; treat layout failures as Escalation or Inconclusive, never as fabricated Observations.
- **Workspace provider dependency:** Keep the Timeline and Evidence authoritative and provider-neutral; preserve Replay assets in IntelliFin Audit storage.
- **Escalation fatigue:** Measure Escalations per Run; refine Templates and Compliance Rules rather than suppressing Escalation.
- **Builder becomes a developer tool:** Measure SM-1 with a real Auditor; keep the plan preview readable without code.
- **Disposable-demo architecture:** Require shared domain contracts and measure reuse across Templates.

## 11. Open Questions

1. Which model and provider should power plan derivation (FR-12) and Agent-Judged classification (FR-35), and what confidence threshold applies? **Owner:** Product and Engineering. **Revisit:** after the hero-Procedure benchmark on golden and adversarial cases.
2. What is the retention and region configuration for workspace session recordings at the workspace provider, and what must be copied into IntelliFin Audit storage for Replay? **Owner:** Architecture. **Revisit:** before Replay implementation.
3. Which synthetic desktop application is built for the PoC, and on which desktop platform in the sandbox? **Owner:** Engineering. **Revisit:** when defining addendum §A Target System contracts.
4. What export formats must the Workpaper Bundle support beyond a human-readable package with Replay assets? **Owner:** Product and UX. **Revisit:** during Workpaper Bundle interaction design.
5. Who acts as the independent reviewer for SM-7, and what reproduction checklist will they follow? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.
6. Which Auditor performs SM-1 as the authoring subject, and what counts as a manual intervention? **Owner:** Product sponsor. **Revisit:** before PoC acceptance testing begins.

## 12. Assumptions Index

- §2.3 — Six inferred user journeys define the minimum web experience pending UX work.
- FR-4 — Non-hero Templates are configurable in period, Population Source, Target Systems, and Schedule; their instructions and rules are editable but not re-authored for acceptance.
- FR-11 — Single UTC time zone and fixed start time per Schedule; period derived as preceding day, week, or month.
- FR-12 — Plan derivation may use a model; the plan is reviewed data and the model identity is recorded.
- FR-22, NFR-7 — Live View reflects agent state within five seconds.
- FR-23 — Paused workspace timeout of 30 minutes.
- FR-25 — Unanswered Escalation timeout of four hours for scheduled Runs.
- FR-35 — Low-confidence Agent-Judged classifications become Unevaluated rather than a classification.
- NFR-6 — Hero Procedure: 95% of Runs within 30 minutes for up to 50 records across two Target Systems; file and API Sources: 95% within five minutes for up to 10,000 records.
- NFR-10 — Daily backup, 24-hour recovery-point objective, and eight-hour recovery-time objective.
- NFR-14 — PoC artifacts remain available for the PoC lifetime; Replay independent of provider retention.
- NFR-15 — Runner and workspace contracts preserve a future private or customer-hosted path without implementing it.
- addendum.md — Synthetic system names, data contracts, matching rules, Template defaults, and outcome rules are inferred for build planning.
