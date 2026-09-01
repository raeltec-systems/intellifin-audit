# Glossary — IntelliFin Audit

Defined terms used across SPEC.md and its companions. Capitalized in every artifact. Lifted from PRD revision 2 §3; the PRD glossary remains the narrative source.

| Term | Meaning |
| --- | --- |
| Absence Observation | An Observation with `found = false`, valid only with the per-path absence evidence in addendum §B.1. |
| Adapter | Platform component that deterministically acquires a Population Source or an API/file Target System; its actions are Session Steps and Adapter Actions on the Timeline. |
| Agent-Judged evaluation | Per-condition evaluation by the Audit Agent for an uncompiled condition; flagged; counts only after Auditor confirmation. |
| Agent Workspace | Isolated execution environment created per Run for agent-driven Steps; torn down when the Run ends. |
| Audit Agent | The autonomous executor of a Run's agent-driven Steps inside the Agent Workspace, within the version's scope, credentials, tools, and limits. |
| Audit Assignment | The work a Run hands to an Audit Agent; one per Run in the PoC. |
| Audit Instructions | Auditor-written natural-language description of what the agent does in each agent-driven Target System. |
| Audit Manager | Human who approves Procedure Versions and performs Auditor Review. |
| Audit Procedure (Procedure) | The primary object: the Auditor's instruction set for verifying a Control; executed as Procedure Versions. |
| Audit Runner | Background service hosting Adapters, the Audit Agent, its workspace, and incremental evaluation. |
| Audit Trail | System-wide append-only, hash-chained event record; Timeline events are Audit Trail events. |
| Auditor | Human who authors Procedures, starts and supervises Runs, confirms evaluations, investigates Exceptions, and submits Results. |
| Auditor Review | Approval or rejection of a Result, performed by the Audit Manager. |
| Compiled / uncompiled condition | A Compliance Rule condition the Builder could express deterministically, or could not (evaluated Agent-Judged). |
| Compliance Rule | Auditor-authored conditions defining Compliant and Exception; each with an applicability predicate. |
| Control | The business obligation a Procedure tests; reference data. |
| Control Failure | The System Outcome issued when one or more Exceptions count toward it. |
| Escalation | Typed question with a closed answer set raised by the platform (or the agent for candidate choice); the Run waits until answered or times out. |
| Evidence / Evidence Package | Captured artifacts, Observations, metadata, and integrity information for a Run; immutable once sealed. |
| Evidence Quality Gate (Gate) | The checks in addendum §H that must pass before a conclusion; per-Observation at registration, Run-level at end. |
| Evidence Requirement | Attributes and artifacts the agent must capture per inspected record. |
| Exception | A record with at least one condition evaluated as violating the Compliance Rule. |
| Executable plan | Session Steps, Plan Steps, Observations to capture, conditions, credentials, and limits derived by the Builder and frozen at approval. |
| Execution Timeline (Timeline) | Ordered, authoritative record of every Step, Tool Action, Observation, evaluation, Escalation, and state change in a Run. |
| Golden dataset | Per-Template fixture with known expected outcomes per record, used by Regression Runs and acceptance; a Run against it must reproduce every expected terminal outcome. |
| Grounding | Pointer from an attribute into a Structural Snapshot or file (locator, label, extracted text) that a deterministic extractor can re-read. |
| Human-classified evaluation | Evaluation set by an Auditor after rejecting an Agent-Judged one. |
| Identity attribute | The matching key as displayed by the Target System, grounded on every `found = true` Observation. |
| Inconclusive | Run state: no conclusion because the Gate failed, a timeout expired, or a condition is Unevaluated. |
| Live View | Surface showing a Run in progress with pause, cancel, flag, and Escalation controls. |
| Observation | Grounded record of what was found for one population record in one Target System. |
| Pending Confirmation | Result outcome of a Completed Run while any Agent-Judged evaluation is unconfirmed; not a System Outcome. |
| PoC Administrator | Manages users, registrations, bindings, and diagnostics; cannot alter Procedures, Evidence, or Results. |
| Population Source (Source) | Where the population comes from, with its inclusion rule; the version freezes the binding, each Run acquires a snapshot. |
| Procedure Builder (Builder) | The authoring surface that turns a Template into a Procedure Version and derives its executable plan; the only authoring path in the PoC. |
| Procedure Template (Template) | Pre-authored Procedure an Auditor starts from; four in the PoC. |
| Procedure Version | Immutable approved definition including plan, bindings, registration digests, conditions, configuration, limits, Schedule. |
| Procedure-specific code | Code that references a Template, Control, or Target System by identity; synthetic Target Systems and golden datasets are fixtures, not procedure-specific code. |
| Reference Source | Versioned file or API consulted by the evaluator, acquired as a Session Step; no Work Items. |
| Regression Run | Run on an Approved version against the Template's golden dataset that gates activation. |
| Replay | Playback of a terminal Run from the Timeline and the platform-owned Replay asset set. |
| Result | Run output holding the System Outcome once sealed, summary, Exceptions, lineage, and review state. |
| Rule-Classified evaluation | Per-condition evaluation produced deterministically from a corroborated Observation. |
| Run | One governed execution of a Procedure Version for a period; active states are Queued, Running, Paused, Awaiting Auditor. |
| Run Failed | Run state for a Run-level technical failure. |
| Schedule | Frequency on a version: once, daily, weekly, monthly. |
| Session Step | Run-level Step outside Work Items: workspace creation, Population Source acquisition, sign-in, Adapter extraction. |
| Step (Plan Step, Step Execution, Tool Action) | Frozen plan unit; its runtime instance in a Work Item; one sandbox action within it. |
| Structural Snapshot | Platform-captured accessibility/DOM tree, control tree, sheet, or JSON substrate that grounding points into. |
| System Outcome | Pass or Control Failure, computed once at sealing; unchanged by human disposition. |
| Target System | Registered system a Run inspects: web and desktop (agent-driven), API and file (adapter-acquired). |
| Unevaluated | Evaluation value with an origin: no valid evaluation exists; never Compliant; blocks Pass. |
| Uninspected | Work Item state for a record with no valid Observation in a Target System. |
| Work Item | Unit of work within a Run: per record per agent-driven Target System, or per extraction; owns Observations. |
| Workpaper Bundle | Signed, self-contained export sufficient to understand, replay, and reproduce a Result. |
| Workspace Provider | Service supplying the workspace browser/desktop sandbox and recording; Solari in the PoC. |
