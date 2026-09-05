---
id: SPEC-intellifin-audit
title: IntelliFin Audit — Delegated Agentic Audit Execution (PoC)
status: final
created: 2026-09-01
updated: 2026-09-04
companions:
  - glossary.md
  - ../../planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md
  - ../../planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md
sources:
  - ../../planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md
  - ../../planning-artifacts/briefs/brief-IntelliFin Audit-2026-08-31/brief.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# IntelliFin Audit — Delegated Agentic Audit Execution (PoC)

## 0. Owner-approved timing correction — 2026-09-04

Approval of a regression-gated successor records pending regression and its successor relationship without a speculative handover date. Actual activation after regression passes sets the authoritative boundary strictly after activation. The owner explicitly selected this behavior. This supersedes approval-time wording and invalidates prior downstream timing reviews: Story 2.8 and later Regression Run/scheduler contracts require revalidation. Execution and scheduler handover remain outside Epic 2.

## Why

A vision to realize, with a pain behind it. Internal audit teams spend skilled hours on mechanical evidence work — pulling populations, signing in to systems, comparing records, keeping screenshots — and the result is slow, sample-blind, hard to reproduce, and hard to review. IntelliFin Audit lets an Auditor define an Audit Procedure once and delegate its repeated execution to an autonomous Audit Agent that works through the same files, browsers, and applications a human would, while every action and conclusion stays observable live, replayable, evidence-backed, and subject to human review. The PoC exists to prove that thesis on four synthetic procedures: that an Auditor can create an executable Procedure without a developer, and that the agent's work is trustworthy in both directions — correct where the Evidence supports a conclusion, honestly Inconclusive, escalated, or failed where it does not. Missing, stale, incomplete, contradictory, or inaccessible evidence must never yield a Pass.

The primary object is the Audit Procedure (how the auditor verifies a Control), not the Control: Control → Audit Procedure → Run → Agent Workspace → Evidence → Auditor Review.

Five principles are the tie-break rules for every downstream decision, in this order: no conclusion without sufficient evidence; reproducibility over theatrical autonomy; human accountability in the workflow; read-only, least-privilege access; agent uncertainty made visible.

## Capabilities

- **CAP-1** — Roles and read-only boundary
  - **intent:** Auditors, Audit Managers, and a PoC Administrator sign in and act only within their role, while the Audit Agent and Adapters can invoke only allowlisted read operations within the Procedure Version's scope.
  - **success:** Unauthenticated requests reach no Procedure, Run, Evidence, or Live View data; successful and failed sign-ins are recorded; every seeded write, out-of-scope destination, out-of-scope parameter (a search beyond the declared population), code or shell execution outside the Agent Workspace sandbox, credential disclosure, or injected-content tool attempt is denied and logged (SM-10); a write-capable credential cannot be registered.

- **CAP-2** — Procedure Builder
  - **intent:** An Auditor creates a Procedure from a Template by naming the Control it verifies, setting period and scope, binding a Population Source with an inclusion rule and declared count, selecting registered Target Systems, writing Audit Instructions, defining a Compliance Rule whose conditions are compiled or marked Agent-Judged with applicability, choosing Evidence Requirements and a Schedule, and reading a re-deriving executable plan before submitting.
  - **success:** The hero Procedure (Terminated Users Retaining Access) is authored, submitted, and approved using only the Builder with zero procedure-specific code, and its Run completes end to end (SM-1); seeded scope-widening instructions are flagged before submission; an underivable plan blocks submission.

- **CAP-3** — Approval, versioning, and Regression Run
  - **intent:** An Audit Manager who is not the author approves or rejects a submitted Procedure Version; approval freezes it; any change or a platform-side model, prompt, tool, or registration change mints a new draft; a Regression Run against the Template's golden dataset gates activation when configuration digests differ.
  - **success:** A Run always retains its version; self-approval is refused with a stated reason; a Regression Run that does not reproduce every expected terminal outcome blocks activation and is surfaced to the approver; version handover never runs one period twice or skips it.

- **CAP-4** — Run initiation and lifecycle
  - **intent:** An Auditor starts a Run for an Active version and period, or a Schedule starts it unattended with a derived period; the Run is visible as Queued, Running, Paused, Awaiting Auditor, Completed, Inconclusive, Run Failed, or Canceled.
  - **success:** At least one scheduled Run completes with no human session active and its Result is reviewable the next working day (SM-3); a missed scheduled start is recorded and shown, never skipped; every transition records time, actor, reason, and prior state.

- **CAP-5** — Execution in an isolated Agent Workspace on two acquisition paths
  - **intent:** For each Run the platform creates an isolated Agent Workspace where the Audit Agent signs in once per web or desktop Target System and works through every record in that system before the next, capturing each record as Session Steps, Work Items, Step Executions, and Tool Actions, while Adapters acquire the Population Source and API or file Target Systems deterministically on the same Timeline, all within frozen limits.
  - **success:** No file, session, cookie, or credential persists between workspaces and egress outside the allowlist is denied (NFR-5); credentials never appear in Timeline, Evidence, logs, or exports; exhausting a limit yields an Escalation, Inconclusive, or Run Failed and never a fabricated Observation; the three non-hero Templates execute through the same components (SM-8).

- **CAP-6** — Live supervision
  - **intent:** An Auditor watches a Running, Paused, or Awaiting Auditor Run — the Audit Instructions, current Step and Work Item, workspace screen, Observations, Evidence as registered, any open Escalation — and can pause, resume, cancel, or leave it to finish.
  - **success:** For the hero Procedure a Run is watched live, paused, escalated, resumed, and later replayed with every Step, Observation, and Escalation visible (SM-2); Live View reflects state within 5 seconds; closing the view does not affect the Run; a Pause that times out ends Inconclusive with Evidence preserved.

- **CAP-7** — Escalation and notification
  - **intent:** The platform, or the agent for candidate choice, raises typed Escalations with closed answer sets (choose candidate, unnamed value, retry or skip); the initiating Auditor and every Audit Manager are notified in-app and by email; an Auditor can flag a Run to Audit Managers.
  - **success:** No answer evaluates a record Compliant or Exception or changes scope, credentials, tools, or the Compliance Rule; free-text notes never reach the agent; an unanswered Escalation times out to Inconclusive with the question preserved; every delivery is recorded on the Audit Trail and carries no Evidence values.

- **CAP-8** — Execution Timeline and Replay
  - **intent:** Every Run has an ordered, authoritative Timeline written as events occur, and any terminal Run can be replayed from the platform-owned Replay asset set with jumps to any Work Item, Exception, or Escalation.
  - **success:** Replay of a golden Run succeeds with the Workspace Provider unreachable and after its retention expires; Replay never re-executes an action; secrets never appear in the Timeline (SM-6).

- **CAP-9** — Grounded, immutable Evidence
  - **intent:** Every Observation attribute is grounded in a platform-captured Structural Snapshot or file with a locator and field label; `found = true` Observations carry a grounded identity attribute; absence is proven from platform-derived query strings and captured empty results; Evidence Packages preserve lineage and cannot be altered.
  - **success:** 100% of evaluated records and Exceptions trace to grounded Observations, Evidence, Timeline Steps, and Procedure Version (SM-6); an attribute without grounding is treated as not captured; integrity mismatches are detected and surfaced; corrections require a new Run.

- **CAP-10** — Evidence Quality Gate
  - **intent:** Before any conclusion the platform runs per-Observation checks (grounding, required Evidence, identity and value corroboration, absence completeness, unnamed value, ambiguous match, freshness) at registration and Run-level checks (population reconciliation at file and inclusion level, per-record coverage, condition completeness, schema, duplicates, integrity) at the end, and marks the Run Inconclusive or Run Failed when they fail.
  - **success:** 100% of seeded missing, stale, truncated, uninspected, uncorroborated, unproven-absence, malformed, contradictory, or inaccessible Evidence cases reach Inconclusive or Run Failed, none reach Pass, including after an Escalation is answered (SM-5); each check produces a visible outcome and diagnostic.

- **CAP-11** — Per-condition evaluation, confirmation, and sealing
  - **intent:** The deterministic evaluator applies every compiled condition to every applicable record; the agent evaluates uncompiled conditions with rationale and confidence, flagged Agent-Judged; an Auditor confirms or rejects each; the Result seals once nothing is pending, computes the System Outcome exactly once, and shows the version's scope statement.
  - **success:** Identical Observations and version produce identical Rule-Classified evaluations; two consecutive Runs of each golden dataset yield identical terminal outcomes and identical Rule-Classified counts, every Observation difference between them is explained, and every Agent-Judged evaluation in the golden set is correct or Unevaluated, never confidently wrong (SM-4); Pending Confirmation takes precedence over Control Failure while any evaluation is pending; a Rule-Classified evaluation cannot be overridden by any human; an unconfirmed or Unevaluated condition never yields a Pass.

- **CAP-12** — Exception investigation and workflow
  - **intent:** An Auditor opens each Exception to see the violated condition, the Observation and its grounding, compared values, evaluation origin, lineage, and Replay position, then assigns, annotates, and dispositions it (Open, Under Review, Confirmed, Not an Exception).
  - **success:** Every Exception has a stable Run identifier and a fingerprint stable across compatible versions; "Not an Exception" requires a rationale and leaves the evaluation and sealed outcome visible and unchanged; designated sensitive fields are masked in lists.

- **CAP-13** — Auditor Review and finalization
  - **intent:** An Auditor submits a sealed Result; an Audit Manager approves, rejects (an event returning it to Draft), and finalizes only an approved Result; disagreement with a Rule-Classified evaluation or the outcome is recorded with rationale, never as an override. A Gate pass is necessary, not sufficient: the Auditor judges whether the Evidence is sufficient.
  - **success:** 100% of finalized Results carry a named Audit Manager, timestamp, version, sealed outcome, confirmed evaluations, and decision history (SM-9); each of the four Procedures reaches a finalized review on its golden dataset; submission of an unsealed, Inconclusive, Run Failed, or Canceled Run is denied; any mutation after finalization is denied and logged.

- **CAP-14** — Audit Trail, Workpaper Bundle, and reproduction
  - **intent:** The platform keeps an append-only, hash-chained Audit Trail and exports a self-contained, signed Workpaper Bundle for any terminal Run from which an independent reviewer reproduces a Rule-Classified evaluation and re-examines an Agent-Judged one without live systems, the Workspace Provider, or source code.
  - **success:** An independent audit reviewer reproduces a sampled evaluation for each Procedure from its bundle (SM-7); Audit Trail and Evidence mutation is detectable (NFR-3); the bundle verifies against the retained public keys.

- **CAP-15** — Oversight
  - **intent:** Users filter and inspect Runs by Procedure, status (including Awaiting Auditor and Pending Confirmation), initiator, period, and time, see upcoming and missed scheduled Runs, and a PoC Administrator views connectivity, provider and runner health, errors, retries, limits, durations, per-Step and per-Target-System latency, and Work Item counts by state per Run, without secrets or the power to alter a Result.
  - **success:** The dashboard reflects state within 5 seconds without reload; diagnostics link to the affected Run by correlation identifier and cannot mutate a Result.

- **CAP-16** — Thesis instrumentation
  - **intent:** The PoC records, per Procedure, authoring and approval time, Escalations and interventions per Run, false-positive dispositions, approval and rejection counts, tokens and provider time per Run, procedure-specific code, reusable components, and maintenance effort including Regression Runs.
  - **success:** All measures are reported for the four Procedures and the hero is compared against a manual or scripted baseline (SM-11); the hero's procedure-specific code is zero, where procedure-specific code is code that references a Template, Control, or Target System by identity (synthetic Target Systems and golden datasets are test fixtures, not procedure-specific code).

## Constraints

- The trust seam is absolute: Observations are grounded and corroborated before any rule uses them; absence is proven, not asserted; every condition is evaluated for every applicable record; a value the Compliance Rule does not name is Unevaluated, ends the Run Inconclusive, and is never mapped by a human answer during a Run.
- Only versioned deterministic evaluators issue Pass or Control Failure; agent output is Evidence and evaluation input, never the System Outcome; Agent-Judged evaluations count only after human confirmation; Rule-Classified evaluations are never overridden.
- All Population Source and Target System access is read-only and uses synthetic data; no production or personal data anywhere, including provider recordings.
- No free text from humans or retrieved content reaches the agent as instruction; Escalations have closed answer sets; retrieved and agent-generated text is stored untrusted and rendered inert.
- One Audit Agent executes a Run sequentially in the PoC, and the domain model must not assume this permanently; the Auditor names Target Systems explicitly.
- Every unit obeys the architecture spine's invariants AD-1..23: ports-and-adapters modular monolith with strict inward dependencies, PostgreSQL as the single system of record and live source, durable human-in-the-loop waits, sealed and signed Evidence, one Observation contract across Adapters and the agent, versioned durable contracts, releases that preserve active and waiting Runs.
- Security baseline: data is encrypted in transit and at rest; secrets live outside application data and are redacted from logs; automated tests deny cross-user and cross-Run data access.
- Acceptance envelope: hero Runs of up to 50 records across two agent-driven Target Systems complete within 30 minutes excluding waits (95%); adapter-only Runs of up to 10,000 records within 5 minutes (95%); Live View within 5 seconds; core views within 2 seconds at 5 users; Schedule start within 5 minutes; daily backup with 24-hour RPO and 8-hour RTO; WCAG 2.1 AA and keyboard access on Builder, Live View, Replay, and review.
- The UI follows DESIGN.md and EXPERIENCE.md: eight state families never confused, one "needs a human" treatment, no chat or assistant surface, no status by color alone, no hover-only actions.
- Runtime majors are Node.js 24 LTS, Next.js 16, PostgreSQL 18; the Workspace Provider (Solari), queue (pg-boss), auth (Better Auth), ORM (Drizzle), and hosting (Railway) must remain replaceable without redefining what a Run means.

## Non-goals

- Autonomous assurance opinions or replacement of professional audit judgment; a Run initiated by a control owner is management monitoring, not independent assurance.
- A universal no-code automation platform or free-form conversational authoring; the PoC proves hybrid authoring for one hero Procedure and Templates for three others.
- Human override of Rule-Classified evaluations, including Run-time mapping of values the Compliance Rule does not name.
- Automated remediation or any write access to a Population Source or Target System.
- Production data, enterprise deployment certification, customer-hosted deployment, multi-tenancy, SSO.
- A broad Adapter catalog, commercial GRC integration, or cross-industry control library.
- General-purpose RPA or desktop automation beyond the registered PoC Target Systems.
- Root-cause analysis, finding management, or audit-plan management.
- Designed-for but not built (spine Deferred lists the architectural side): agent-recommended scope, conversational authoring, parallel Work Items, finding-triggered escalation, documents as Sources, control packs, materiality suppression, separation of confirm and approve roles, notification on Run completion, additional export formats, continuous monitoring with alerts and trends, default Exception ownership and reviewer assignment, cross-Run aggregation beyond Exception fingerprints, a platform-assurance evidence pack, design-partner integrations, and commercial-scale performance, availability, or certification.

## Success signal

An Auditor builds the Terminated Users procedure in the Builder without a developer, an Audit Manager approves it, and a Run is watched live — paused, escalated, resumed — then completes unattended on its Schedule the following week; every golden dataset reaches the expected outcome twice in a row, every seeded bad-evidence case ends Inconclusive or Run Failed and never Pass, and an independent reviewer reproduces a sampled evaluation from the exported Workpaper Bundle with no live system, provider, or code. Guards: no reduction of Inconclusive or Escalation rates by weakening the Gate or confirmation; no autonomy theater; no hidden per-Procedure developer work; no silent agent judgment.

## Assumptions

- An Audit Manager may confirm evaluations on, submit, and later approve the same Result in the PoC.
- Non-hero Templates are configurable in period, source, Target Systems, and Schedule; their instructions and rules are not re-authored for acceptance.
- Schedules use a single UTC time zone and fixed start time; periods derive as the preceding day, week, or month.
- Plan derivation and Agent-Judged evaluation use Claude Sonnet 5 (`claude-sonnet-5`) through the Anthropic adapter by default, with the OpenAI adapter wired as fallback; the hero benchmark may change the default; the model identity is recorded on every version and the plan is data the Auditor reviews.
- The Agent-Judged confidence threshold is a per-version Builder field, default 0.80, set by the author and frozen at approval; below it the evaluation is stored Unevaluated.
- Timeouts: 30 minutes Paused, 4 hours Awaiting Auditor; Live View freshness 5 seconds.
- Low-confidence Agent-Judged evaluations are stored Unevaluated and need no confirmation.
- Replay is independent of provider retention: the platform copies the Workspace Provider recording into its own storage at Run end, provider retention is set to its minimum, and the provider region matches the hosting region.
- LedgerDesk is a Linux desktop application that serves its control tree as JSON on localhost inside the workspace VM; the platform snapshot agent reads that endpoint.
- Export is the signed archive only: manifest, JSON, captures, and a browser-readable HTML summary.
- Extractors: web accessibility-tree snapshot through the browser SDK, the LedgerDesk snapshot endpoint, a CSV and XLSX parser, and JSON path for APIs; model-read is allowed only for values that exist only as pixels, and the hero declares none.
- Acceptance roles: a design-partner auditor who did not see the Template built authors the hero (SM-1); a different design-partner auditor who neither authored nor approved it reproduces from the bundle using the addendum §F contents plus the reproduction steps (SM-7); a design-partner auditor performs the hero check by hand on the golden data as the timed baseline (SM-11); the people are named before acceptance.
- A manual intervention is any human action on a Run other than the Live View controls and Escalation answers, by anyone; developer actions always count.
- The IntelliFin Design System bundle ("Ledger Signal") is an external UI system; DESIGN.md restates every token it needs.

## Open Questions

None. The nine PRD questions were resolved by the owner on 2026-09-01; the answers are the Assumptions above and PRD §11 records them.
