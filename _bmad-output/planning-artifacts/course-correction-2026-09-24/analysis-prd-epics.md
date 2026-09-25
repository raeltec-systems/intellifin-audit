# PRD, addendum and epics vs. the 2026-09-24 course correction

Baseline: `main` at `c18ad36` (includes PR #51 Auditor Workspace v1.1 and PR #52 UI cleanup — real conversational/controller/record-review scaffolding, scoped to one Run; `sprint-status.yaml` is stale at 2026-09-10 and under-reports built state). Produced by a read-only analysis agent on 2026-09-24; persisted by the correct-course session.

## 1. PRD verdicts

**§1 Vision / thesis / principles / trust seam — SUPERSEDED.** The "define a Procedure once, delegate repeated execution" thesis is exactly what Direction §I retires ("stop expanding the form-driven procedure builder as the primary experience"). Principles 1, 3, 5 (evidence sufficiency, human accountability, agent uncertainty visible) HOLD verbatim. Principle 2 (reproducibility) HOLDS and widens from Procedure Versions to any artifact. Principle 4 (read-only by default) REVISE — Direction §C requires write/send/draft actions under a permission model; keep "least privilege", drop "read-only". §1.2 Trust Seam rules HOLD as a pattern, generalised beyond "Compliance Rule condition".

**§2 Users / jobs / journeys — REVISE.** Roles HOLD but need a per-auditor authority axis (§C: "configure the agent's authority within the access I possess"). UJ-1..UJ-6 SUPERSEDED (all Builder-first). NEW SECTION NEEDED: **Engagements** — the direction repeatedly references "the current engagement" as an entity the PRD never defines (closest today is Procedure, which is control-scoped, not client/period-scoped).

**§4.1 Identity / roles / read-only — FR-1/FR-2 HOLD.** FR-3 ("only allowlisted read operations… a write-capable credential cannot be registered") conflicts directly with §B/§C's write actions. Keep FR-3's mechanism (allowlist, deny-and-log, content cannot change permissions); drop "read-only". NEW SECTION NEEDED: **Permission Model** (read/write/draft/send tiers, confirm-required vs routine).

**§4.2 Procedure Builder — SUPERSEDED as primary UX.** FR-4, FR-8, FR-9, FR-12 are the "navigate sections, define structured inputs" pattern the direction's opening paragraph names as the problem. §7 Non-Goals literally excludes "free-form conversational procedure authoring" — invalidated by §A. Underlying machinery (PlanCompiler, `equivalentExecutablePlan`, scope-widening check, plan preview) KEEPS as a skill invoked from conversation. `guided-procedure-preparation.md` / `v2-conversational-authoring.md` are superseded in ambition (still form-anchored) but their governance answers (freeze boundary "reasoning before the freeze, never after it"; provenance-per-input) carry forward.

**§4.3 Approval / Versioning — HOLDS strongly.** FR-13/14/15 map onto §G ("approved recurring check… versioned and governed"). Generalises to any governed artifact.

**§4.4 Run Initiation / Scheduling — HOLDS.** FR-16/17/18 map to §G's "perform on schedule".

**§4.5 Agent Workspace / Autonomous Execution — PARTIALLY HOLDS.** FR-19/NFR-5 (isolated workspace) HOLD, generalised to a general sandboxed environment. FR-20's per-Target-System sign-in loop and FR-22's record × system Work Item grid are too narrow for connector-driven tool use — NEW SECTION NEEDED: **general task / tool-call execution model**. NFR-15 (runner portability, one Adapter contract per kind) HOLDS and is reinforced.

**§4.6 Live Supervision — HOLDS**, strong match to §A/§D. One conflict: FR-27's Escalation is a CLOSED three-kind answer set (choose-candidate / unnamed-value / retry-or-skip); §A wants open-ended clarifying questions — keep the durable-wait/notification/timeout mechanism, widen the answer shape.

**§4.7 Timeline / Replay — HOLDS fully** (FR-29/30 = §D "verifiable outcomes" + §F traceability). Generalises beyond Target-System actions to any connector call or code execution.

**§4.8 Evidence Capture / Quality — HOLDS as the crown-jewel safeguard; generalise the vocabulary.** FR-31/32/33 + addendum §H are exactly §D's "an inaccessible mailbox is not 'no response received'". The mechanism (Structural Snapshot / accessibility-tree grounding) is Target-System specific — NEW SECTION NEEDED: **Source Snapshot → Working Copy → Derived Outputs** (named directly in §C).

**§4.9 Evaluation — PARTIALLY HOLDS.** Rule-Classified vs Agent-Judged (FR-37/38) is the right pattern for §G's "execution success, input completeness, assessment and review status must remain distinct"; the Compliance-Rule-condition implementation is one skill's output, not the general model.

**§4.10 Results / Exceptions / Review — HOLDS.** FR-40–44 match §F's worked example almost exactly ("this conclusion is overstated… revise the affected artifact, preserve its history, identify related conclusions/approvals" = FR-41 provenance + FR-14 immutable versioning with diff). Exception generalises to Finding.

**§4.11 Audit Trail / Reproduction / Export — HOLDS fully, becomes MORE central.** FR-45/46/47 are §F/§G nearly verbatim.

**§4.12 Web Oversight — HOLDS**, generalise Runs → tasks.

**§4.13 Thesis Instrumentation — SUPERSEDED.** FR-50 measured developer-free Procedure setup via the Builder; needs replacement instrumentation matched to §H's demo criteria.

**§5 NFRs — mostly HOLD** (NFR-1, 3, 4, 5, 8, 9, 10, 11, 12, 14) as architecture safeguards. NFR-2 (agent safety) HOLDS and is elevated — §C's injection through documents/emails/pages is NFR-2 extended to new connector surfaces. NFR-6 (hero perf numbers) SUPERSEDED. NFR-13 (synthetic data only) HOLDS, reaffirmed by §H. NFR-15 HOLDS, reinforced.

**§6 Constraints — HOLD mostly.** "Auditor names Target Systems explicitly, agent does not choose scope" REVISES toward the PRD's own §8.2 "Vision" column (agent notices patterns within mandate, approval required for expansion — §G).

**§7 Non-Goals — the sharpest conflict in the document.** INVALIDATED: "free-form conversational procedure authoring" (§A); "automated remediation or any write access" (§B/§C); "broad Adapter catalog… cross-industry control library" (§B's connector table IS a broad catalog, phased); "root-cause analysis, finding management, or audit-plan management" (§F/§G make Findings/plans first-class artifacts). HOLDS: "human override of Rule-Classified evaluations". REVISE (narrower): "general-purpose RPA / arbitrary desktop automation" — §B widens scope but keeps allowlist discipline. The PRD's own §8.2 "Vision" column already describes conversational delegation almost verbatim, and §8.3 explicitly defers exactly what §A now asks to build.

**§9 Success Metrics.** SM-1 SUPERSEDED (Builder-based). SM-2, 3, 4, 6, 7, 9, 10 HOLD (SM-5 elevated — matches §D's mailbox example). SM-8, SM-11 REVISE (skill/connector generalisation; "procedure-specific code = 0" replaced by cost/time-per-task + connector reuse).

## 2. Addendum verdicts

**KEEP as structural safeguards:** §B (shared data rules: exact-key matching, unnamed-value handling, absence proof), §D (golden-dataset pattern, reusable for any skill), §E (state-machine discipline: immutable once approved, sealed once, human disposition never rewrites a sealed outcome — generalises Procedure/Run/Result/Exception to Artifact/Task/Finding), §F (Workpaper Bundle / Replay asset set — this IS §F's inspectable/correctable/evidence-linked spec, already written in detail), §G (standards basis), §H (Evidence Quality Gate — the crown jewel; §D's "access failures must be visible" IS §H's purpose; rows generalise from Target-System wording to connector wording).

**SUPERSEDE / DEMOTE:** §C (Template Contracts P-1..P-4) — Direction §E: "do not hard-code the conventions from my current workspace as universal audit rules"; these are domain-layer build constants pinned by test to this addendum and must become ONE example firm-supplied methodology pack. §A (synthetic org/systems) — demote to a regression fixture corpus. §0/§0b (procedure-specific owner decisions) — retire as product rule, keep the "explicit frozen mapping, never inferred from a name" pattern. §J (Solari rationale) — Solari becomes one connector among several; its provider-neutrality argument for Replay ownership generalises to every connector. §I — historical map, no verdict needed.

## 3. Epic verdicts

**Built epics (1–5):**
- Epic 1 — MODIFY. Identity/roles/audit trail KEEP; Target System registration generalises to Connector registration with typed permission tiers instead of read-only only.
- Epic 2 — MODIFY / PARTIALLY RETIRE. Builder-as-primary-UI RETIRE; versioning/approval/diff mechanics KEEP, generalised to any artifact; plan compiler KEEP as the control-testing skill implementation.
- Epic 3 — MODIFY. Deterministic execution engine + sealing + Gate KEEP as the core pattern; generalise Population Source/Target System wording and the record × system Work Item grid to a general task graph.
- Epic 4 — MODIFY. `BrowserExecution` port, JIT credential containment, durable-wait Escalations, untrusted-content rendering KEEP as the connector-execution/safety pattern → become the browser connector under the new Permission Model; widen from read-only/registered-system-only to authority-tiered; widen 3 fixed Escalation kinds to open questions.
- Epic 5 — KEEP. Direct match to §A/§D; carries forward as the conversation/task execution viewer largely unchanged.

**Epic 6 (backlog) — KEEP all 8 stories.** 6.1 provenance = §F's worked example almost literally; 6.3–6.5 / 6.7–6.8 depend on the new Artifacts epic (NE-5) existing first, since they operate on Result/Exception which must be re-implemented as the general artifact object.

**Epic 7 (desktop Target System, backlog) — DEFER all 7 stories.** A large narrow investment (synthetic app + sandbox template + snapshot agent) to complete the OLD hero Procedure demo; §B names no generic desktop connector. Revisit only when a real desktop connector is prioritised.

**Epic 8 (scheduling/regression, backlog) — ABSORB INTO new epic "Recurring Checks from Conversation" (NE-9).** All 6 stories' mechanics KEEP (schedule enqueue, missed-start recording, unattended completion, period-boundary handover, regression-before-activation, regression visibility) but generalise from "Procedure Version" / "golden dataset" to "approved check version" / "regression fixture for the changed check or connector". Depends on NE-5 (Artifacts) and NE-7 (Skills).

**Epic 9 (oversight, backlog) — MODIFY, carry forward as the assurance umbrella.** 9.1, 9.2, 9.4, 9.5, 9.6, 9.8, 9.9 KEEP (generalise Run → Task, Target System → connector, injection surface → email/calendar/docs). 9.3 MODIFY (replace developer-free-setup metric). 9.7 MODIFY (replace hero-Procedure perf numbers with connector/task-workload targets).

## 4. Proposed new epics

1. **NE-1 Engagement & Conversation Harness** — Engagement entity above Procedure, durable conversation, plan-then-act loop, inline artifact references. Absorbs Epic 2's AgentSummary pattern, Epic 5's SSE mechanics generalised, and the merged Auditor Workspace v1.1 conversation/controller-lease scaffolding (Run-scoped today, widened to engagement scope). DEMO: YES, core.
2. **NE-2 Permission Model & Authority Boundaries** — read/write/draft/send tiers, admin outer boundary, routine-vs-confirm classification, enforced at application + connector + execution environment (never prompt-only). Absorbs Epic 1 registration/credential model, Epic 4's `authorizeToolAction` gate, NFR-2. DEMO: YES, core (§H requires proving a refused prohibited action).
3. **NE-3 Connector Framework + First Connectors** — reusable connector abstraction + Drive/OneDrive, Gmail, Calendar via personal-account OAuth. Absorbs Epic 4's adapter-conformance pattern (AD-4/AD-18 were already designed kind-agnostic — the strongest existing foundation). DEMO: YES, core.
4. **NE-4 Source Snapshot → Working Copy → Derived Outputs** — generalises Epic 3's Evidence Package/grounding/corroboration and §H's Gate to any connector source; captures new source versions rather than replacing silently. DEMO: YES (§H's "preserving the original, analysing a working copy").
5. **NE-5 Artifacts** (plans, working papers, findings, reports) — generalises Procedure Version versioning + Result/Exception into a general versioned-artifact object with cross-artifact reconsideration flags. Absorbs Epic 6 (once the object exists) + Epic 2's versioning mechanics. DEMO: PARTIAL, at least one output-artifact type.
6. **NE-6 Memory** (six scopes, provenance, supersession, promotion) — user prefs / firm methodology / org-client knowledge / engagement facts & decisions / conversation & execution state / confirmed lessons, with client isolation. Net new. DEMO: PARTIAL, engagement-facts + execution-state scopes only.
7. **NE-7 Skills & Methodology Packs** — firm-suppliable skill definitions (context discovery, planning, document review, population analysis, control testing, reconciliation, investigation, evidence assessment, working-paper preparation, reporting); P-1..P-4 become one example pack. Absorbs Epic 2's Compliance Rule compiler as the control-testing skill. DEMO: PARTIAL, one "read / propose / produce" skill.
8. **NE-8 Sandboxed Analysis Runtime** — controlled fs/network/credential/resource-bounded code execution for analysis, distinct from Epic 4's browser sandbox; the model generates/selects code, the platform executes and preserves method + results. Net new. DEMO: LIKELY YES if analysis exceeds reading text.
9. **NE-9 Recurring Checks from Conversation** (absorbs Epic 8 wholesale). DEMO: NO, explicitly later-phase per §G.
10. **Epic 9 (existing, generalised)** — platform-assurance/NFR proof suites, runs throughout and gates the demo.

**Order:** NE-2 → NE-3 → NE-1 → NE-4 → NE-8 (minimal) → NE-5 (minimal) → NE-6 (minimal) → NE-7 (minimal) → Epic 9 proofs throughout → NE-9 (post-demo). Epic 7 deferred indefinitely.

**Minimum slice for §H's first end-to-end demo:** NE-2, NE-3, NE-1, NE-4, plus the "produce an output" corner of NE-5/NE-7, plus NE-8 if analysis goes beyond reading text — matching §H's script (find a document, preserve the original, analyse a working copy, produce an output, use email/calendar context, one authorised collaboration action, prove refusal + honest connection-failure reporting).

## 5. Open questions and assumptions the direction answers or invalidates

**PRD §11 Open Questions:** Q1 (model/provider) — reinforced, not resolved, by §D's provider-neutrality principle. Q2 (confidence threshold) — still open; should become methodology-configurable per §E. Q3 (Workspace Provider recording retention) — scope broadens to every connector's preserved source data. Q4 (desktop platform) — MOOT, Epic 7 deferred. Q5 (export formats) — still open, likely widens for firm-specific reports. Q6–Q9 (independent reviewer / authoring subject / extractors / manual baseline for SM-1/7/11) — resolved-but-now-moot; old-thesis instrumentation superseded.

**PRD §12 Assumptions:** §2.3 (six journeys) INVALIDATED. FR-4 (non-hero Template editability) INVALIDATED. FR-11 (UTC/fixed schedule) carries forward. FR-12/38 (Claude Sonnet 5 default, OpenAI fallback) REINFORCED by §D's provider neutrality. FR-38 (0.80 threshold) carries forward as a pattern; should become skill-level, not product-wide. FR-7/10 (LedgerDesk extractors) MOOT. FR-46 (signed archive only) carries forward. SM-1/7/11 (design-partner auditor) MOOT. FR-24/NFR-7 (5 s freshness) carries forward. FR-25 (30-min pause timeout) carries forward as a pattern for any long-running session. FR-27 (4-hour timeout, 3 closed Escalation kinds) carries the timeout mechanism forward, REVISES the closed-answer-set assumption toward open questions. NFR-6 (hero perf numbers) MOOT. NFR-10/14 (backup/retention) carry forward, revisit sizing. NFR-15 (runner portability) STRONGLY REINFORCED — the single most reusable existing foundation.
