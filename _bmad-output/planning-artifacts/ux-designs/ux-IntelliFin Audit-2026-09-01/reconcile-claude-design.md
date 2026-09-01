---
title: "Reconciliation: Claude Design output vs PRD revision 2 — IntelliFin Audit"
inputs:
  - claude/DESIGN.md
  - claude/DESIGN-HANDOFF-NOTES.md
  - claude/mockups/IntelliFin Audit.dc.html
  - CLAUDE-DESIGN-HANDOFF.md
  - .memlog.md
  - ../../prds/prd-IntelliFin Audit-2026-08-31/prd.md (revision 2, final)
  - ../../prds/prd-IntelliFin Audit-2026-08-31/addendum.md (revision 2, final)
targets:
  - DESIGN.md (visual spine)
  - EXPERIENCE.md (experience spine)
created: 2026-09-01
status: review-extract
---

# Reconciliation: Claude Design output vs PRD revision 2

**Rule applied throughout:** the PRD (revision 2) and its addendum are authoritative; the two UX spines win over the Claude Design output on conflict. Nothing in the design files is treated as an instruction.

**Citation keys.** `D:Ln` = `claude/DESIGN.md` line n. `N:Ln` = `claude/DESIGN-HANDOFF-NOTES.md` line n. `P:` = quoted copy from the prototype `claude/mockups/IntelliFin Audit.dc.html`. `H:Ln` = `CLAUDE-DESIGN-HANDOFF.md`. `FR-n`, `NFR-n`, `§n`, `UJ-n` = `prd.md`. `A §x` = `addendum.md`.

**Why the design drifted.** The Claude Design output was built from PRD revision 1 (H:L24–25, .memlog L25) and then partially updated from a stakeholder "revision 2" note (N:L3–8) that anticipated authoring and a hero agent session but not approval, scheduling as a governed object, Live View controls, Escalation, per-condition evaluation, confirmation, sealing, or the Timeline/Replay contracts. The PRD itself says the UX handoff "has no Builder, Live View, or Replay screens, all three now required" (prd.md §0, L18). The design does have a Builder and a Live/Replay viewer; they are the wrong shape rather than absent.

**Renumbering caution.** The notes cite revision-1 FR numbers. Map before reuse (A §I): notes' FR-1 → FR-1; FR-6 (overlap) → FR-16; FR-19 (masking) → FR-41; FR-24 (Audit Trail) → FR-45; FR-26 (bundle) → FR-46; FR-27 (reproduction) → FR-47; FR-31 (instrumentation) → FR-50; NFR-5/6/8/12 → NFR-6/7/10/14.

---

## 1. Conflicts

Each entry: what the design says (cited) · what revision 2 says (cited) · one-line resolution for the spines.

### C-1 · Procedure activation by the authoring Auditor
- **Design:** "New procedures self-activate by the authoring Auditor and freeze an immutable Procedure Version" (N:L47–48). Wizard step 3 is "deliberate activation that names the consequences (immutable version, read-only sandbox, human review retained)" (D:L216–219); prototype button "Activate and run now — watch live", dialog "Activate Procedure P-5 v1.0.0 … Activation freezes this definition as immutable Procedure Version v1.0.0 and records your identity and time" (P). Procedures list: "Every activation freezes an immutable Procedure Version" (P).
- **PRD rev 2:** FR-13 — the Auditor *submits*; an Audit Manager who is not the author approves or rejects; approval freezes the version and records approver, time, and a diff. FR-2 — an Audit Manager cannot approve a version they authored. FR-11 — the Schedule activates only on approval. FR-16 — a Run needs an *Active* version. A §E — `DRAFT → SUBMITTED → APPROVED | REJECTED`; `REJECTED → DRAFT` on edit; `APPROVED → ACTIVE` immediately or after the FR-15 regression Run; `ACTIVE → RETIRED`.
- **Resolution:** Replace "Activate" with "Submit for approval"; the Auditor never activates and never runs an unapproved version. Add the Procedure Version state family (Draft · Submitted · Approved · Rejected · Active · Retired) and an Audit Manager approval surface. "Activate and run now — watch live" is invalid; the first Run of an approved version starts from Procedure Detail (FR-16) or from the Schedule (FR-17).

### C-2 · Live mode is watch-only + cancel
- **Design:** "Watching is read-only: cancel is the only live control" (D:L214–215); "Live mode is watch-only + cancel by product decision" (N:L45). The prototype's only live action is "Cancel Run"; its single "Pause" string is the replay scrubber's play/pause label (P).
- **PRD rev 2:** FR-24 — Live View of a Running, *Paused*, or *Awaiting Auditor* Run shows the current Step, current Work Item, workspace screen, Observations so far, Evidence as registered, and any open Escalation. FR-25 — pause (Running only, at the next Tool Action boundary) and resume; 30-minute paused timeout → Inconclusive. FR-26 — cancel from any active state. FR-27 — typed Escalations with closed answer sets (*choose candidate* / *unnamed value* / *retry or skip*, plus *abort*), answered in place; plus an Auditor-raised flag to Audit Managers. Glossary "Live View … with pause, cancel, and Escalation controls" (§3). SM-2 requires a Run "watched live, paused, escalated, resumed, and later replayed".
- **Resolution:** Live View carries Pause/Resume, Cancel, an Escalation answer panel with the closed answer set and supporting Evidence, and "Flag to Audit Manager". Keep the no-chat / no-free-text-to-agent rule (FR-27: notes are recorded but never reach the agent).

### C-3 · Four preconfigured procedures remain manual; authoring out of scope
- **Design:** "the four preconfigured procedures remain manual" (N:L49–50); Procedure Detail copy "Authoring and editing are out of scope for the proof of concept" (P); Procedures list "Four preconfigured procedures, plus procedures you author" with a fifth, user-authored "P-5" (N:L109, P). Scheduling exists only as "a per-procedure field (P-5 runs weekly)" (N:L49).
- **PRD rev 2:** FR-4 — the four are *Procedure Templates* that pre-populate the Builder; Procedures are created from them; the hero (P-1 Terminated Users) is fully configurable and the other three are configurable in period, Population Source, Target Systems, and Schedule. FR-11 — every Procedure Version carries a Schedule (once / daily / weekly / monthly). A §C — P-1's default Schedule is weekly. §8.1 — "Procedure Builder with hybrid authoring, plan preview, approval, versioning, and regression Runs" is in scope.
- **Resolution:** Model Templates as a picker (FR-4), not as immutable Procedures; drop "P-5" and the "out of scope" copy; every Procedure Detail shows its versions, states, and Schedule; the hero Procedure is P-1 from the Terminated Users Template.

### C-4 · Notes §6 lists scheduling, authoring, and alerts as non-goals
- **Design:** "Scheduling, procedure authoring, alerts, trend analysis. Explicit non-goals; deliberately absent" (N:L169–170) — contradicting the notes' own revision-2 header (N:L3–8).
- **PRD rev 2:** FR-11 Schedule, FR-17 scheduled initiation (missed starts surfaced on the dashboard), FR-28 in-app and email notification, FR-48 upcoming scheduled Runs. Only *continuous monitoring, alerts, trends* remain deferred (§8.3).
- **Resolution:** Strike the line. Scheduling, authoring, and Escalation notification are in scope; trend analysis and continuous-monitoring alerts stay deferred per §8.3.

### C-5 · Run lifecycle omits Paused and Awaiting Auditor
- **Design:** six states, "Queued · Running · Completed · Inconclusive · Run Failed · Canceled" (D:L122, N:L122), each with badge and icon.
- **PRD rev 2:** FR-18 — eight states, adding Paused and Awaiting Auditor; users must distinguish "waiting on a human" from platform failure and Control Failure. A §E — `RUNNING ⇄ PAUSED`, `RUNNING → AWAITING_AUDITOR → RUNNING`; both time out to `INCONCLUSIVE`. FR-48 — Awaiting Auditor gets its own dashboard filter and label.
- **Resolution:** Add Paused and Awaiting Auditor to the lifecycle family with treatments distinct from Inconclusive's warning badge (Awaiting Auditor must read as "needs you", not "evidence failed"); show time remaining before timeout (FR-28 names it).

### C-6 · Auditor Review has a "Rejected" state
- **Design:** review family "Draft · Submitted · Approved · Rejected · Finalized" with a danger-outline Rejected badge (D:L125); prototype `REJECTED:['Rejected','x-circle','danger-outline']` (P); states demonstrated list "Rejected (in RUN-2388 history)" (N:L127).
- **PRD rev 2:** A §E — `DRAFT → SUBMITTED → APPROVED → FINALIZED`; rejection is a review *event* that returns the Result from Submitted to Draft. FR-43 — direct finalization from Draft "including after a rejection" is denied. (A Rejected *state* does exist — for Procedure Versions, A §E.)
- **Resolution:** Review family is four states; render rejection as an event in review history with a "returned to Draft" annotation on the Draft badge. Reuse the Rejected badge for Procedure Versions only.

### C-7 · Gate checklist is "nine checks"
- **Design:** "Nine rows" (D:L183), "9 checks" (N:L63), "passed (9/9)" (N:L123). Prototype rows: Source access, Declared population, Record-count reconciliation, Pagination completeness, Schema validity, Mandatory fields, Duplicate primary keys, Freshness, Integrity digest (P). This is the revision-1 list (H:L155–164).
- **PRD rev 2:** FR-33 and A §H — twenty rows split into per-Observation checks (run at registration) and Run-level checks (run at end): workspace and Target System access; population acquisition; record-count reconciliation at file level *and* at inclusion level (rows in = included + excluded with reason); empty population; per-record coverage; identity corroboration; search completeness (absence); required Evidence; Observation corroboration; condition completeness; pagination/extraction completeness; schema; mandatory values; duplicate primary keys; ambiguous match; unnamed value; freshness (snapshot) and freshness (Target System); integrity.
- **Resolution:** Keep the row grammar (icon · name+status word · diagnostic · rule) but source rows from A §H, grouped per-Observation vs Run-level, with the header count derived rather than "9/9"; per-Observation results must also appear live (FR-20, FR-24).

### C-8 · Outcome set has no Pending Confirmation, no sealing
- **Design:** System Outcome "Pass · Control Failure · No conclusion issued" (D:L124); a Run is "Completed · Control Failure · 1 Exception · Draft" the moment it completes (N:L109); "the session always ends at the Evidence Quality Gate and a deterministic Result" (D:L107–108); submission blocked only for Inconclusive / Run Failed / Canceled (N:L137).
- **PRD rev 2:** FR-40 — Pass, Control Failure, *Pending Confirmation*, Inconclusive, Run Failed, and Canceled are distinct; Pending Confirmation takes precedence over Control Failure while any Agent-Judged evaluation is unconfirmed; the Result *seals* when the Gate passed and every evaluation is resolved; the System Outcome is computed once at sealing; the Result version increments per confirmation/rejection; a rejection leaving a condition Unevaluated moves Completed → Inconclusive at sealing. FR-43 — submission is also blocked while unsealed. A §E.1 ordered outcome rules.
- **Resolution:** Triptych cell 3 shows the Result outcome (Pending Confirmation · Pass · Control Failure · none issued) plus a sealed/unsealed marker and Result version; the hero Run (P-1 has Agent-Judged condition C2) lands in Pending Confirmation first; add "unsealed" to the submit-blocked reasons.

### C-9 · Provenance chain is six deterministic steps
- **Design:** "Six numbered steps: source record → matched record → transformation → comparison → rule and version → deterministic Exception" (D:L190–192, N:L69); prototype steps Source record / Matched record / Transformation / Comparison (P).
- **PRD rev 2:** FR-41 — an Exception shows the violated *condition*, the Observation and its grounding, compared values, source lineage, the Timeline segment and Replay position, and the *evaluation origin*. FR-9/A §B.1 — one evaluation per condition per record with origin RULE / AGENT_JUDGED (pending·confirmed·rejected, confidence) / HUMAN / UNEVALUATED. FR-27/A §B — records may be flagged *human-matched* (`match_origin`). FR-38 — Agent-Judged and human-classified evaluations are visibly distinguished everywhere.
- **Resolution:** Chain becomes population record → Observation (grounding, corroboration status, match origin) → per-condition evaluations (origin badge, confidence, rationale, confirmation status) → Exception; add a "Timeline segment / Open in Replay" step. "Deterministic" applies only to Rule-Classified conditions.

### C-10 · Compiled plan is a "structured editor" with Edit affordances
- **Design:** "compiled plan in a structured editor" (D:L217); "'Edit' affordances in the compiled plan are shown but not functional" (N:L48–49); wizard is intent → plan → activate (D:L216–219).
- **PRD rev 2:** FR-12 — "The Auditor cannot edit the plan directly; changing any structured field or Audit Instruction re-derives the plan, and each re-derivation is recorded"; a plan that cannot derive blocks submission with the reason. §4.2 — hybrid means *structured fields* plus natural-language Audit Instructions, not a single intent textarea (§7 non-goal: free-form conversational authoring).
- **Resolution:** Builder = structured sections (FR-5..FR-11) + Audit Instructions, with a read-only plan preview that re-derives on change and logs each re-derivation; no Edit controls on plan rows.

### C-11 · Hero content and the agent's role in acquisition
- **Design:** hero "P-5" reads a shared-drive workbook of "terminated contractors" in an "Excel-like grid with extracted rows highlighted" and checks an AccessGate "identity console" (D:L210–213, P: "AccessGate (portal session SBX-2437-01)").
- **PRD rev 2:** the hero is P-1 with Population Source = Leavers export via Adapter and agent-driven Target Systems LoanCore (web) and LedgerDesk (desktop) (A §C P-1, A §A.2, UJ-3); AccessGate is an adapter-acquired API for P-2. FR-6 — the population is parsed by a deterministic platform parser; the agent "may additionally open the file … but its reading never replaces the parser's".
- **Resolution:** Re-cast session content to LoanCore then LedgerDesk; show population acquisition as an Adapter Session Step; if the agent opens the file, label it non-authoritative. Keep the mock-screen viewer pattern.

### C-12 · Replay renders the provider's session recording
- **Design:** "Session recording is preserved in the Evidence Package (artifact `session SBX-2437-01`)" (N:L46); "Full session recording available in Replay" (P).
- **PRD rev 2:** FR-29 — the Timeline written by IntelliFin Audit is the authoritative record; the provider recording is supplementary. FR-30 / A §F — Replay renders the platform-owned Replay asset set (per Tool Action: timestamped frame, sanitized action, Observation delta; per Escalation; per Session Step) and must work with the Workspace Provider unreachable; jump to any Work Item, Exception, or Escalation.
- **Resolution:** Replay is driven by the Timeline + Replay asset set; provider video is an optional supplementary link while retained.

### C-13 · "Execution trace" vs Execution Timeline
- **Design:** tab "Execution trace" with "staged execution trace row (stage, status, duration, sanitised call)" (N:L75, N:L94, N:L99).
- **PRD rev 2:** FR-29 Execution Timeline (A §I: "Execution trace becomes Execution Timeline") includes Session Steps, Work Items, Step Executions, sanitized Tool Actions, Observations, Evidence registrations, rule evaluations, Agent-Judged evaluations with rationale, Escalations and answers, pauses, retries, errors, limits consumed, and versions.
- **Resolution:** Rename to Execution Timeline; rows are hierarchical (Session Step / Work Item / Step Execution / Tool Action) with Work Item states from A §E.

### C-14 · "Source" as the single term for every external system
- **Design:** Sources = PeopleHub, AccessGate, LedgerFlow, ProdConsole, etc.; "execution-failure panel naming the Source" (D:L130–131); gate row "Source access" (P); Run Failed "ProdConsole unreachable" (N:L113).
- **PRD rev 2:** distinguishes Population Source (FR-6), Target System (FR-7; ProdConsole and LoanCore are Target Systems), and Reference Source (RoleMatrix; A §A.2). Run Failed causes are Session Steps: workspace creation, Population Source acquisition, Target System sign-in, Adapter extraction (A §E).
- **Resolution:** Adopt the three terms; the execution-failure panel names the failed Session Step and its Target System / Population Source.

### C-15 · Chief Audit Executive as a fourth role
- **Design:** role switcher includes "Chief Audit Executive" with disabled actions (N:L28–30, N:L135). Originated as an assumption in the brief (H:L230).
- **PRD rev 2:** FR-2 and §8.1 — three roles (Auditor, Audit Manager, PoC Administrator); the CAE is the economic buyer (§2.1), not a system role.
- **Resolution:** Drop the CAE role from the spines; if an executive read-only view is wanted, it is an Audit Manager without mutating actions, flagged `[ASSUMPTION]`.

### C-16 · Design uses revision-1 FR numbers and rules in copy
- **Design:** "FR-6 prevents overlapping active Runs" (N:L178), "FR-19 requires sensitive fields masked" (N:L189), §6 cites FR-1/24/26/27/31 (N:L158–167).
- **PRD rev 2:** renumbered (A §I): FR-16, FR-41, FR-45/46/47/50. FR-41 now says masking is defined by the *Population Source contract*.
- **Resolution:** Spines cite revision-2 numbers only; do not carry the notes' numbers forward.

---

## 2. Gaps

Revision-2 surfaces, states, or behaviors with no design representation (or only a placeholder). Grouped by P0 capability (§8.1).

**Procedure Builder (FR-4..FR-12)**
- G-1 Template picker and Control naming (FR-4); Templates pre-populate every section with A §C defaults.
- G-2 Period and scope fields; scope statement shown verbatim on every Result (FR-5).
- G-3 Population Source binding: three binding kinds (manual upload only for `once`; versioned file; read-only API), declared-count mechanism with authoring-time warning when absent, structured inclusion filter, zero-record-Pass opt-in (FR-6).
- G-4 Target System selection from registered systems only, showing kind (web / desktop = agent-driven; API / file = adapter-acquired), credential reference, permitted read actions, and per-attribute expected labels (FR-7); Reference Sources shown separately (A §A.2).
- G-5 Audit Instructions field with scope-widening flags (unregistered system, write verb, out-of-scope origin) before submission (FR-8).
- G-6 Compliance Rule editor: per-condition compiled vs Agent-Judged marker, applicability predicate (default `found = true`), explicit boundary semantics, confidence threshold on the version (FR-9, FR-38).
- G-7 Evidence Requirements: attribute values, Structural Snapshot, screenshot, source file excerpt, recording segment; snapshot and screenshot always-on for agent-driven systems (FR-10).
- G-8 Schedule as a governed field (once/daily/weekly/monthly, UTC, period derivation) (FR-11, A §B).
- G-9 Plan preview listing Session Steps, Plan Steps per Target System, Observations, compiled and Agent-Judged conditions, credentials referenced, limits, model identity; re-derivation log; derivation failure blocks submission (FR-12).

**Approval, versioning, regression (FR-13..FR-15)**
- G-10 Submit-for-approval action and Procedure Version state badges (Draft, Submitted, Approved, Rejected, Active, Retired) with reviewer rationale on rejection (FR-13, A §E).
- G-11 Audit Manager approval surface with diff against the previous version, self-approval blocked (FR-13, FR-2); platform-authored drafts after model/prompt/tool/registration changes; Schedule handover at period boundary (FR-14).
- G-12 Regression Run: labeled on the Runs dashboard, run on an Approved-not-Active version against the Template's golden Population Source, approver confirms Agent-Judged evaluations, mismatch blocks activation (FR-15).
- G-13 Exception-fingerprint compatibility shown on the version (A §B).

**Run initiation and lifecycle (FR-16..FR-18)**
- G-14 Paused and Awaiting Auditor Run Detail variants with timeout countdown (FR-18, FR-25, FR-27).
- G-15 Scheduled-Run indicators: initiator = Schedule, derived period, upcoming scheduled Runs, missed or failed scheduled starts (FR-17, FR-48).

**Live supervision (FR-24..FR-28)**
- G-16 Live View content: current Step and Work Item, workspace screen, Observations so far, Evidence as registered, open Escalation, 5-second refresh, "closing does not affect the Run" (FR-24); Adapter-only Runs show Adapter Session Steps (FR-19).
- G-17 Escalation UI: kind, Step, supporting Evidence (e.g., both captured result rows for *choose candidate*), closed answer set, optional note that is recorded but not sent to the agent, question labeled agent-generated and rendered inert, abort → Canceled with reason (FR-27).
- G-18 Escalation notification in-app and by email, naming Procedure, Run, kind, and time remaining (FR-28); Auditor-raised flag to Audit Managers (FR-27).

**Timeline and Replay (FR-29..FR-30)**
- G-19 Timeline hierarchy with Adapter Session Steps, Work Item states (Pending, In progress, Observed, Uninspected, Ambiguous, Failed, Awaiting), Tool Actions, limits consumed, model/prompt/component versions (FR-29, A §E).
- G-20 Replay asset set rendering with jump-to Work Item / Exception / Escalation (FR-30, A §F).

**Evidence and Gate (FR-31..FR-35)**
- G-21 Structural Snapshot and grounding display per attribute (`evidence_id`, `locator`, `label`, `extracted_text`) with corroboration status matched / contradictory / model_read; identity attribute; Absence Observation evidence (Tool-Action-derived query strings, grounded empty result) (FR-31, FR-33, A §B.1).
- G-22 Evidence item card fields per FR-31 (Work Item, Target System, Step, capture method) and Evidence kinds (Structural Snapshot vs screenshot vs excerpt vs recording segment); design's nine-field card (N:L68) is the revision-1 set.
- G-23 Post-Run integrity event flag on the Result and export (FR-35).

**Evaluation and Results (FR-36..FR-40)**
- G-24 Agent-Judged confirmation flow: evaluation card with rationale, confidence, grounded Evidence; confirm / reject; rejection sets Compliant · Exception · Unevaluated with rationale → human-classified; rejected evaluation retained as history; low-confidence stored as Unevaluated (FR-38).
- G-25 Result sealing indicator, Result version, "unsealed" as a submit-blocked reason (FR-40, FR-43).
- G-26 Per-condition counts (Compliant, Exception, Agent-Judged pending/confirmed/rejected, human-classified, unmatched, Unevaluated), per-Target System inspected/uninspected, inclusion-level reconciliation (rows in / included / excluded with reason) (FR-39, FR-33).
- G-27 Human-matched flag on records in every Result, list, and export (FR-27, A §B).

**Review, export, oversight (FR-43..FR-49)**
- G-28 Workpaper Bundle export available for *any terminal* Run including Inconclusive and Run Failed, dialog listing A §F contents including Timeline, Escalations, Agent-Judged rationales, Replay assets, integrity manifest (FR-46). Verify the design's unavailable-actions panel does not disable export on Inconclusive/Run Failed.
- G-29 Runs dashboard filters and labels for Awaiting Auditor, Pending Confirmation, initiator (manual/Schedule), start time; regression label (FR-48).
- G-30 Administration: Target System registration (kind, origin/application identity, credential reference, permitted read actions, attribute labels, registration digest), Workspace Provider health, limit consumption, diagnostics linking to Run and correlation id (FR-7, FR-49). Design shows only "synthetic Source configuration, Source connectivity, runner health" (H:L216–221).
- G-31 Disagreement entry point at Rule-Classified-evaluation level, not only Result level (FR-44; see Q4).

---

## 3. Kept

Design decisions consistent with revision 2; carry into the spines unchanged unless noted.

- K-1 Four state families kept visually separate (D:L92–96, L117–125), extended as C-5/C-6/C-8 require; FR-18 and FR-40 demand exactly this distinction.
- K-2 Badge = colour + icon + word; Completed is neutral; Control Failure filled danger vs Run Failed outlined danger vs Inconclusive warning (D:L127–136). NFR-11.
- K-3 Monospace as a data type only (D:L143–148); add correlation identifiers, fingerprints, locators, and digests to the list (already included).
- K-4 Action bar + "Unavailable actions" panel with visible reasons (D:L199–201); FR-43 denials must be explained and logged.
- K-5 Two confirmation weights; finalization names irreversibility (D:L203–206); FR-43.
- K-6 Untrusted-content block rendered inert (D:L194–197); extend to Escalation questions (FR-27, NFR-2).
- K-7 Accessibility decisions (N:L140–154); NFR-11 extends them to Builder, Live View, and Replay controls.
- K-8 Empty states never imply a Pass (D:L221–222, N:L132–134).
- K-9 Shell and layout: 240px sidebar, 56px top bar, 340px rail, 1320px cap, responsive rules (D:L150–162); nav set Overview · Procedures · Runs · Review · Administration (H:L68–76). PRD is silent; keep.
- K-10 Ledger Signal tokens, no new hues, hairline structure, single modal shadow, radii (D:L9–88, L164–174).
- K-11 Conclusion triptych as the primary Run Detail object (D:L178–181), with cell 3 extended per C-8.
- K-12 Population reconciliation table with excluded/unevaluated always shown (D:L187–188); extend to A §H inclusion-level rows.
- K-13 Safe-next-action and execution-failure panels (D:L130–133); rename per C-14.
- K-14 Disposition history; "Not an Exception" requires rationale and leaves the Exception and System Outcome visible (N:L129–131); FR-42.
- K-15 Reviewer disagreement additive, System Outcome unchanged (D:L240); FR-44.
- K-16 Session viewer chrome: LIVE/REPLAY state, sandbox id, "read-only · isolated credentials", step counter, scrubber, narration rail, masked runner-injected credentials, no chat affordance (D:L208–215); FR-19, FR-20, FR-24, FR-30. Controls extended per C-2.
- K-17 Agent session as a hero experience (D:L103–108) — matches rev 2 §1 ("the core product experience"); this supersedes H:L41 and .memlog L13 ("AI stays in the background").
- K-18 Currency USD with ISO 4217 and decimals; ISO 8601 UTC with original offset retained (N:L21–23, D:L145); A §B, A §C P-3. Parent ZMW rule does not apply.
- K-19 Identifier formats `RUN-nnnn`, `EX-<run>-nn`, `EP-nnnn`, `Pn vX.Y.Z` as `[ASSUMPTION]` (N:L36–37); PRD unspecified. Add: correlation identifier per Run (FR-16), stable Exception fingerprint (FR-41), identifiers are strings preserving leading zeros (A §B).
- K-20 Audit-workpaper tone and microcopy (D:L98–101, H:L246–263).
- K-21 Role-gated actions with stated reasons (N:L135–138), minus the CAE role (C-15).
- K-22 Denied transitions: finalize from Submitted denied; mutation after finalization denied (N:L137–138); FR-43.
- K-23 Grouped employee-level context with account-level outcomes (N:L70); consistent with one Work Item per record per Target System (FR-22).
- K-24 Overview evidence-reliability counts as counts, not charts (N:L41–43); no PRD objection.
- K-25 Run Detail variant set (N:L105–118) — keep and add Pending Confirmation, Paused, Awaiting Auditor, and a regression Run.
- K-26 No KPI walls, heatmaps, charts, persistent assistant panel, hover-only actions, tooltip-only explanations (D:L242–243).
- K-27 Gate presented as a trust checkpoint with per-check diagnostic and rule (D:L183–185); rows replaced per C-7.
- K-28 Evidence Quality Gate states Passed · Not passed · Incomplete · Not evaluated (D:L123); still valid as Run-level summary states.

---

## 4. Open questions (notes §7)

| # | Notes' question | Status | Basis |
| --- | --- | --- | --- |
| 1 | Rerun conflict: blocked rerun offers "open the active Run" or "queue after"? (N:L178–180) | **Still open** | FR-16 only prevents overlap; regression Runs are exempt (FR-15). Choice is UX; recommend "open the active Run" since queuing is not a PRD behavior. |
| 2 | Exception prioritisation by amount / breach / count? (N:L181–183) | **Constrained, still open** | FR-9 non-goal: no materiality suppression, every Exception is material; FR-41 gives stable identifiers and fingerprints. Ranking is a view preference, never part of the Procedure contract. |
| 3 | Workpaper Bundle format and delivery (N:L184–185) | **Still open** | PRD Open Question 5 (§11); contents are fixed by FR-46 and A §F; export must cover any terminal Run. |
| 4 | Disagreement placement: Result-level vs Exception-level (N:L186–188) | **Answered** | FR-44: disagreement targets a Rule-Classified *evaluation* (condition-level) or the System Outcome; both entry points are required (G-31). |
| 5 | Masking policy field set (N:L189–190) | **Answered in principle, list open** | FR-41: masked fields are "designated by the Population Source contract" — the binding (FR-6) is the source of truth; the addendum does not enumerate them. |
| 6 | Notification of state change (N:L191–193) | **Answered for Escalation; open for completion** | FR-28: in-app and email to the initiating Auditor (or Procedure author for scheduled Runs) and every Audit Manager on Awaiting Auditor or Auditor flag, naming Procedure, Run, kind, time remaining; deliveries recorded on the Audit Trail. No PRD requirement to notify on Completed; UJ-4 assumes the Auditor opens Replay unprompted. |
| 7 | Canceled reruns: automatic linked rerun offer? (N:L194–195) | **Still open** | FR-26: rerun creates a linked new Run; A §E.1 permitted action for Canceled is "request a new Run". Offering it is UX; auto-starting is not permitted. |

---

## 5. Resolution summary for spine authors

| Conflict | Resolution (PRD wins) |
| --- | --- |
| C-1 | Submit for approval; Audit Manager (non-author) approves; version state family; Runs only on Active versions. |
| C-2 | Live View gains Pause/Resume, Cancel, Escalation answers, Flag to Audit Manager. |
| C-3 | Templates → Procedures; no immutable "preconfigured four"; every Procedure has a Schedule. |
| C-4 | Strike the non-goal line; only alerts/trends stay deferred. |
| C-5 | Add Paused and Awaiting Auditor with distinct treatments and countdown. |
| C-6 | Rejected is a review event, not a review state (badge reused for Procedure Versions). |
| C-7 | Gate rows from A §H, split per-Observation vs Run-level; derived counts. |
| C-8 | Add Pending Confirmation, sealing marker, Result version; block submit while unsealed. |
| C-9 | Provenance = record → grounded Observation → per-condition evaluations with origin → Exception, plus Replay jump. |
| C-10 | Read-only plan preview that re-derives; structured fields, no plan-row editing. |
| C-11 | Hero session shows LoanCore and LedgerDesk; population acquisition is an Adapter Session Step. |
| C-12 | Replay from Timeline + platform Replay asset set; provider video supplementary. |
| C-13 | Rename to Execution Timeline with the Session Step / Work Item / Step Execution / Tool Action hierarchy. |
| C-14 | Use Population Source / Target System / Reference Source. |
| C-15 | Three roles only; no CAE role. |
| C-16 | Cite revision-2 FR numbers only. |
