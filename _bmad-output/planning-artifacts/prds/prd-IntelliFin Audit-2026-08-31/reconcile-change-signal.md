# Reconciliation: change signal (2026-09-01) vs PRD revision 2

**Input:** `change-signal-2026-09-01.md` (Israel, 2026-09-01) — product owner change directive for PRD revision 2.
**Targets:** `prd.md` (revision 2) and `addendum.md` (revision 2).
**Method:** every sentence-level idea in the input was checked against both targets for explicit representation (not just plausible inference). Items were classed Covered, Gap, or Contradiction.

## Covered

| Input item | PRD / addendum location |
| --- | --- |
| "central experience ... is not a set of preconfigured control tests" | prd §1 para 2 (verbatim reframing) |
| "auditor configuring and delegating an audit procedure to an autonomous audit agent, then watching or replaying" | prd §1 para 2; §2.2 JTBD; UJ-1, UJ-3, UJ-4 |
| "digital junior auditor working under supervision" | prd §1 para 2 (verbatim); §2.2 "as I would to a junior colleague" |
| Auditor defines: what control/procedure is tested | FR-4 (name the Control; choose Template) |
| Auditor defines: audit period or scope | FR-5 |
| Auditor defines: where evidence/population is found | FR-6 (Population Source, inclusion rule) |
| Auditor defines: which systems the agent inspects | FR-7 |
| Auditor defines: what the agent should do in those systems | FR-8 (Audit Instructions) |
| Auditor defines: compliance / exception conditions | FR-9 (Compliance Rule) |
| Auditor defines: evidence to retain | FR-10 (Evidence Requirements) |
| Auditor defines: how frequently the procedure runs | FR-11 (Schedule); FR-16 |
| "When a Run begins ... isolated audit workspace" | FR-18; §4.5 description; UJ-3 |
| "agent actually performs the procedure through the relevant files, browsers, applications ... much like a human auditor would" | §4.5 description (near-verbatim); FR-19 |
| Auditor can watch the agent work live | FR-22 Live View; UJ-3; SM-2 |
| Auditor can see the current step | FR-22 ("current Step, current Work Item, the workspace screen") |
| Auditor can inspect evidence as it is collected | FR-22 ("Evidence as it is registered") |
| Auditor can pause / cancel | FR-23, FR-24 |
| Escalation with Auditor answer | FR-25; FR-17 Awaiting Auditor; UJ-3 |
| Auditor can leave the agent to finish unattended | FR-22 ("Closing the Live View does not affect the Run"); FR-16; UJ-3/UJ-4 |
| Auditor can replay the execution later | FR-27; UJ-4; SM-2, SM-6 |
| Auditor can review final results and exceptions | FR-37 to FR-41; UJ-5, UJ-6 |
| Hero journey config: period August 2026 | UJ-1 |
| Hero journey config: Excel leavers file as population source | UJ-1; addendum A.1 (Leavers spreadsheet `.xlsx`) |
| Hero journey config: inclusion rule employees marked Terminated | UJ-1; addendum C P-1 (`employment_status = Terminated`) |
| Hero journey config: target systems LoanCore and Finance ERP | UJ-1; addendum A.2 (LoanCore web app, LedgerDesk finance ERP desktop client) |
| Hero journey config: test instruction (search each terminated employee in each target system) | UJ-1; addendum C P-1 Audit Instructions default |
| Hero journey config: compliant condition (no account / disabled); exception condition (active account) | UJ-1; addendum C P-1 Compliance Rule default |
| Hero journey config: evidence required (account status, username, roles, screenshot/source evidence) | UJ-1; FR-10; addendum C P-1 Evidence Requirements default (incl. source spreadsheet row) |
| Hero journey config: frequency once / daily / weekly / monthly | FR-11; glossary Schedule; addendum C period derivation |
| Journey step 1: enters isolated workspace | FR-18; UJ-3 |
| Journey step 2: opens leavers spreadsheet | FR-19; UJ-3; addendum A.1 acquisition mode |
| Journey step 3: identifies terminated population | FR-19 ("applies the inclusion rule"); UJ-3 |
| Journey step 4: opens first target system | FR-19; UJ-3 |
| Journey step 5: authenticates with approved audit credentials | FR-19 (just-in-time credential); FR-3; UJ-3 |
| Journey step 6: searches for each terminated user | FR-19 ("locates each population record"); addendum A.2 |
| Journey step 7: inspects account status and attributes | FR-19 ("inspects it"); Observation schema addendum B.1 |
| Journey step 8: captures supporting evidence | FR-19; FR-28 |
| Journey step 10: repeats across target systems | FR-20 (Work Item per record per Target System); FR-30 per-record coverage |
| "The auditor may watch live or replay afterward" | UJ-3, UJ-4; FR-22, FR-27 |
| Decision 1: PoC auditor explicitly defines systems | FR-7 last consequence; §6 guardrail; §7 non-goal |
| Decision 1 maturity path: specifies → recommends → discovers with approval | §8.2 row "Target System discovery" (all three stages present) |
| Decision 2: hybrid structured fields + natural-language instructions | §4.2 description; FR-5 to FR-11 (structured); FR-8 (natural language); FR-12 plan preview |
| Decision 2 long-term: conversational delegation translated into reviewable executable procedure | §8.2 row "Procedure authoring" (Next, Vision); §7 non-goal; §8.3 |
| Decision 3: one agent, sequential, deliberately small population | glossary Audit Agent; FR-20; §6; addendum D (≤ 20 records) |
| Decision 3: production parallel execution; decomposition into work units in one governed Run; model must not assume one Run = one worker | FR-20 third consequence; §6 guardrail; §8.2 row "Execution model"; glossary Work Item |
| Correction: authoring and scheduling no longer deferred | §4.2, §4.3, §4.4 as in-scope FRs; §8.1; not listed in §8.3 |
| Correction: four procedures remain templates; hero fully configurable | FR-4; addendum C (P-1 "hero, fully configurable") |
| Correction: prove an auditor can create an executable procedure without a developer | §4.2 description; FR-47; SM-1; SM-C3 |
| P0-1 Procedure Builder | §4.2; FR-4, FR-12 |
| P0-2 Evidence/Population Source Configuration | FR-6 |
| P0-3 Target System Configuration | FR-7 |
| P0-4 Audit Instructions | FR-8 |
| P0-5 Compliance/Exception Rules | FR-9; FR-34, FR-35 |
| P0-6 Evidence Requirements | FR-10 |
| P0-7 Period/Scope | FR-5 |
| P0-8 Frequency | FR-11; FR-16; NFR-9 |
| P0-9 Autonomous Audit Workspace | FR-18; NFR-5 |
| P0-10 Live Agent Execution | FR-19; FR-21; FR-22 |
| P0-11 Execution Timeline | FR-26 |
| P0-12 Replay | FR-27 |
| P0-13 Evidence Capture | FR-28; FR-29 |
| P0-14 Results and Exceptions | FR-36 to FR-39 |
| P0-15 Auditor Review | FR-40; FR-41 |
| P0-16 Pause/Cancel/Escalation | FR-23; FR-24; FR-25 (see Contradiction 1 on who may escalate) |
| Other three controls as templates to demonstrate generalization | FR-4; SM-8; addendum C P-2 to P-4 |
| Core product thesis statement (full sentence) | §1 blockquote (verbatim) |
| "core product experience and the principal thesis the PoC exists to prove, not an optional experiment" | §1 para 3 (verbatim) |
| Solari: browser, desktop/sandbox, session observability; perform work rather than analyze extracted data | §4.5 description; addendum §J (verbatim) |
| Preserve evidence quality, deterministic rules, safe failure, lineage, reproducibility, human accountability | §4.8, §4.9, §4.10, §4.11; NFR-3, NFR-4; §6; SM-4 to SM-7; SM-C1 |
| Main object is Audit Procedure, not Control; Control vs Procedure definitions | §1 para 4; glossary Audit Procedure, Control |
| Object chain CONTROL → PROCEDURE → RUN → WORKSPACE → WORKPAPERS/EVIDENCE → REVIEW | §1 diagram (see Gap 1 for the dropped "AUDIT ASSIGNMENT" label) |
| Follow-up: classification hybrid (rules where expressible; agent-judged, flagged, counts after confirmation) | §4.9 description; FR-9; FR-34; FR-35; glossary Agent-Judged; §6; SM-C4 |
| Follow-up: one synthetic web app + one synthetic desktop app | FR-7 second consequence; §8.1; addendum A.2 |
| Follow-up: Procedure Version approved by Audit Manager who is not the author | FR-2; FR-13; UJ-2; addendum E states |
| Follow-up: frequency = real scheduled unattended execution in the PoC | FR-16; SM-3; NFR-9; UJ-4 |

## Gaps

1. **"AUDIT ASSIGNMENT / RUN" and "multiple audit assignments/work units"** — The input's object chain names the third link `AUDIT ASSIGNMENT / RUN`, and uses "audit assignment" twice more ("create an executable audit assignment without a developer"; "decompose into multiple audit assignments/work units"). The PRD chain (§1) reads `RUN` only, and the term "Audit Assignment" appears nowhere in prd.md or addendum.md; the closest concept is `Work Item`. A reader of the input will not find the term. *Suggested placement:* add "AUDIT ASSIGNMENT / RUN" to the §1 chain diagram and a glossary entry in §3 that maps Audit Assignment to the Run (single-agent PoC) and to Work Items / future parallel work units, so the input's vocabulary is preserved and the maturity path in §8.2 row 3 can reference it.

2. **The 16 "Revised P0 capabilities" are not represented as a prioritized list** — Every capability maps to at least one FR (see Covered), but the PRD carries no priority label, no "P0" designation, and no capability-to-FR table. The input's explicit statement that these sixteen are P0 (and, by implication, that everything else is lower priority) is silently dropped by the FR structure. *Suggested placement:* a short "P0 capability map" table in §8.1 In Scope (or a new addendum §K) listing the sixteen capabilities with their FR numbers, and a sentence that PoC acceptance requires all sixteen.

3. **Journey steps 9 and 11 are not explicit in the agent's step list** — Input step 9 "records compliant cases and exceptions" and step 11 "submits the completed work for auditor review" are agent actions. FR-19 enumerates the plan as open source → apply rule → sign in → locate → inspect → capture; it stops at capture. Classification is described as a system act (FR-34/FR-35) and "submission" only exists as an Auditor-to-Manager act (FR-40). Nowhere does an FR say that on finishing its last Work Item the Audit Agent submits the completed work (Result draft) to the Auditor for review; UJ-4 narrates it ("submits the Result") but no requirement backs it. Step 10 ("repeats across target systems") is implied by FR-20 but not stated as a plan step either. *Suggested placement:* extend FR-19's step list with "records the classification outcome per Work Item, repeats for every Target System, and on completion submits the Run for Auditor review (Run → Completed, Result created in review state DRAFT)"; cross-reference addendum §E Review states.

4. **"other approved sources"** — Input: the agent performs the procedure "through the relevant files, browsers, applications, and other approved sources". §4.5 description and FR-19 name files, browsers, and applications only; the open-ended "other approved sources" (e.g. the read-only API Sources in FR-6 / addendum A.1) is not stated in the execution section. *Suggested placement:* §4.5 description — "files, browsers, applications, and other approved Sources registered on the Procedure Version".

5. **Conversational-delegation example and its "escalate immediately" semantics** — The input's vision example ("Every Monday, check all employees terminated in the previous week and verify that they no longer have access ... Escalate any active privileged accounts immediately.") is not quoted anywhere. §8.2 row 2 keeps the abstract vision but loses (a) the concrete illustration and (b) the idea that a finding can trigger immediate escalation/alerting during a Run. FR-25 defines Escalation strictly as a blocking question the agent asks when it "cannot proceed safely"; there is no finding-triggered escalation even as a maturity item, and §8.3 defers "alerts" generically. *Suggested placement:* quote the example under §8.2 row 2 (Vision), and add a fourth §8.2 row or a §8.3 bullet "finding-triggered immediate escalation / alerting" so the vision idea is tracked rather than dropped.

6. **"where the initial evidence or population can be found" / "Evidence/Population Source Configuration"** — The input consistently pairs "evidence" with "population" for the source configuration capability. The PRD names the concept `Population Source` only (FR-6, glossary). The "initial evidence" framing (the source file is itself evidence to be retained — addendum C P-1 lists "source spreadsheet row" as an Evidence Requirement) is representable but the naming drop could lead UX/architecture to model the source file as input data rather than as captured Evidence. *Suggested placement:* FR-6 title or first consequence — state that the Population Source is captured into the Evidence Package as initial Evidence (link to FR-10 "source file excerpt" and FR-28).

7. **Auditor-initiated "escalate" control** — Input line "pause/cancel/escalate where needed" lists escalate among the Auditor's live controls, and the P0 capability is "Pause/Cancel/Escalation". The PRD only defines agent-initiated Escalation (FR-25); glossary Live View mentions "Escalation controls" but no FR gives the Auditor an action to escalate a Run (e.g. flag to the Audit Manager, or force the agent to stop and ask). Recorded as Contradiction 1 below; the gap is the missing FR. *Suggested placement:* FR-25 or a new FR-25a "Auditor-raised Escalation" in §4.6, or an explicit statement in §4.6 that Escalation is agent-initiated only and that the Auditor's intervention set is pause, cancel, and answer.

## Contradictions

1. **Who can escalate.** Input: the Auditor "should be able to ... pause/cancel/escalate where needed" (auditor-side control). PRD FR-25: "The Audit Agent can raise an Escalation ... and an Auditor can answer it" — Escalation is exclusively agent-initiated and the Auditor's role is to answer. Severity: low, because the input is itself ambiguous (its vision example has the agent escalating), but as written the PRD does not deliver the auditor-side capability the input names. Resolution options: add an Auditor-raised Escalation FR, or amend §4.6 to state the reinterpretation explicitly and get owner sign-off.

2. **Live View availability during an Escalation (internal inconsistency that undercuts the input's live-supervision expectation).** Input: the Auditor watches live, sees the current step, and intervenes where needed. PRD FR-22: "An Auditor can open a Live View of a Running or Paused Run" — the Awaiting Auditor state (FR-17, entered on every Escalation) is excluded, yet UJ-3 narrates Daniel answering the `Suspended` Escalation from the Live View. As specified, the Auditor could not see the workspace screen while answering the question that most needs it. Resolution: extend FR-22 to Running, Paused, or Awaiting Auditor.

No other statements in prd.md or addendum.md contradict the input. Specifically checked and found consistent: Control vs Procedure definitions; sequential single-agent PoC with non-permanent domain assumption; explicit target-system naming; hybrid classification; approval by a non-author Audit Manager; real unattended scheduling; one web + one desktop synthetic Target System; four templates with hero fully configurable; deterministic rules, evidence gate, lineage, reproducibility, and human accountability retained.

## Notes

- **Agent "records compliant cases and exceptions" (journey step 9) vs system-side classification.** The PRD deliberately moves deterministic classification to the platform (FR-34) and keeps only uncompiled conditions with the agent (FR-35). This is consistent with the input's instruction to preserve deterministic rules and with the follow-up hybrid decision, so it is not a contradiction; but the narrative should say so somewhere (e.g. FR-19 or §4.9 description) so a reader of the journey does not expect the agent itself to declare Pass/Exception.
- **Terminology drift the input reader will notice:** "Autonomous Audit Workspace" → `Agent Workspace`; "audit assignment / work unit" → `Work Item`; "Evidence/Population Source" → `Population Source`; "Finance ERP" → `LedgerDesk`; "Frequency" → `Schedule`. All are semantically covered; only "Audit Assignment" (Gap 1) has no mapped term.
- **Non-hero templates and the "analyze already-extracted data" tension.** Addendum C P-2 to P-4 and NFR-6's "file and API Sources with up to 10,000 records ... within five minutes" describe a largely data-extraction execution mode for the three non-hero templates. The input permits templates for those three, so this is acceptable, but the PRD could state explicitly (FR-4 or SM-8) that the non-hero templates may execute primarily through API/file Sources and that the thesis is proven by the hero Procedure's in-workspace execution.
- **Input's "deliberately small population"** is honoured by addendum D (≤ 20 records for hero golden populations); NFR-6 sizes performance at up to 50 records. Consistent, but the two numbers should be cross-referenced.
- **Revision-2 handling of previously deferred items** is clean: authoring, scheduling, workspace, Live View, pause, Escalation, and Replay are marked as new FRs in addendum §I and no longer appear in §8.3.
- **Approval-by-non-author** is stated twice (FR-2 and FR-13) with identical semantics; addendum §E state model lacks an explicit "author ≠ approver" guard but the FRs carry it.
- This review is read-only; no changes were made to prd.md or addendum.md.
