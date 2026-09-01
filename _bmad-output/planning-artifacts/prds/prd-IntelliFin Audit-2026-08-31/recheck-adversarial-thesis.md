---
title: "Recheck — Adversarial Review (Thesis Coherence and Exploitability) against PRD rev 2 (renumbered)"
artifact: "prd.md (rev 2, updated 2026-09-01, FR-1..FR-50) and addendum.md (rev 2)"
prior_review: "review-adversarial-thesis.md (C-1..C-4, H-1..H-8, M-1..M-6, L-1..L-5); review-rubric.md (high and medium findings)"
verdict: needs-revision
counts:
  critical: 0
  high: 2
  medium: 9
  low: 7
date: 2026-09-01
---

# Recheck — Adversarial Review against the Revised PRD

Prior-review FR numbers refer to the pre-renumbering draft; every finding below is mapped by content to the current FR-1..FR-50. The four owner decisions (unnamed value → Unevaluated/Inconclusive/new version; frozen binding + per-Run snapshot; deterministic Adapters for Sources and API/file Target Systems, agent for web/desktop, one Timeline; in-app + email on Awaiting Auditor) are treated as given.

Closure standard: **CLOSED** = a build team reading only prd.md + addendum.md could not reproduce the failure scenario. **PARTIALLY CLOSED** = the literal scenario is blocked but a near variant survives (the variant is filed as a new finding in Part 3). **OPEN** = reproducible as written.

---

## Part 1 — Prior adversarial findings

### Critical

| ID | Status | Where it is closed / what remains |
| --- | --- | --- |
| **C-1** Agent-asserted Observations laundered into Pass | **PARTIALLY CLOSED** | Closed for the literal scenario (correct page, transcribed `disabled` for on-screen `Active`): §1.2 rule 1; §3 *Grounding*; FR-10 (grounding mandatory, platform-captured screenshot bound to the reading Tool Action); FR-23 defines fabrication; FR-31; FR-33 corroboration consequence; addendum §B.1 `grounding`/`corroboration`; §H "Observation corroboration" row; §D seeded transcription error; SM-5 includes "uncorroborated". **Remains:** corroboration proves the value exists at the agent-chosen locator, not that the locator is the right field of the right record; and the artifact the extractor re-reads is never captured as Evidence. See N-1, N-2, N-3. |
| **C-2** `found=false` proved by say-so | **PARTIALLY CLOSED** | §3 *Absence Observation*; §1.2 rule 2; FR-31; §B.1 Absence Observation (normative); §H "Search completeness"; §D silent-timeout/partial-pagination case; §C P-1 "unproven absence" → Inconclusive. **Remains:** the query string is not required to equal the population record's key (a mistyped ID yields a legitimately empty result and a "proven" absence), and nothing says the query strings and empty result are taken from platform-recorded Tool Actions rather than agent-reported fields. See N-4. |
| **C-3** No per-condition origin; omitted judgment = Pass | **CLOSED** | FR-9 (per-condition evaluation, record derivation, "uncompiled condition with no Agent-Judged evaluation … is a Gate failure"); FR-37 non-override scoped to the condition; FR-38; FR-39 per-condition counts; §B.1 per-condition evaluations (normative); §E evaluation origins; §H "Condition completeness"; §C P-1 "C2 applies to every found account; a found account with no C2 evaluation is a Gate failure"; §F counts by condition and origin; §6. Residual (generic, not hero): "applicable record" is defined only for the hero's C2 — see N-9. |
| **C-4** `Suspended` mapping Escalation | **CLOSED** (owner decision 1) | §1.2 rule 4; UJ-5 rewritten; FR-9 unnamed value → Unevaluated with diagnostic, "no Run-time answer can map that value"; FR-20 deterministic evaluator inside the Audit Runner, incremental per Observation; FR-27 *unnamed value* kind with closed answers; addendum §B "Unnamed values (normative)" raised by the platform; §H "Unnamed value" row; §7 non-goal "including Run-time mapping of values the Compliance Rule does not name"; §D expected terminal outcome Inconclusive. Note: UJ-5 still says "the agent raised an Escalation" where §B says the platform raises it — wording only, filed under N-11. |

### High

| ID | Status | Where it is closed / what remains |
| --- | --- | --- |
| **H-1** Population acquisition agent-vs-deterministic; count level | **CLOSED** | FR-6 (deterministic platform parser is the population of record; two-level reconciliation; binding supplies declared count); FR-21; §A.1; §H "Record-count reconciliation — file level" and "— inclusion level"; FR-33 "at file and inclusion level"; §F inclusion reconciliation. |
| **H-2** Freshness makes the weekly Run Inconclusive | **CLOSED** (owner decision 2) | FR-6 (binding frozen, snapshot per Run; manual upload only for `once`; empty population → Inconclusive unless opt-in); §3 *Population Source*; UJ-1/UJ-3/UJ-4 rewritten; §H "Freshness — snapshot Sources" restated relative to period end and Run initiation; §H "Empty population". Fixture note only: whether the weekly leavers export is cumulative or per-week decides whether UJ-3's manual August Run can find twelve records (filed as low, N-16). |
| **H-3** No Unevaluated row; Pending-vs-Control-Failure; "immutable" outcome | **CLOSED** | §E outcome table rows 4–7 with explicit order; FR-40 sealing and precedence; §E "Result sealing (normative)"; §3 *System Outcome*, *Pending Confirmation*, *Result*. **But** the fix introduces a new inconsistency: row 5 yields "Inconclusive (Run state)" on a sealed Result of a `COMPLETED` (terminal) Run — see N-5. |
| **H-4** NFR-8 vs §E on exhausted retries | **CLOSED** | NFR-8 scoped Run-level vs Work-Item-level; FR-34 second consequence; §E "Session Steps" and "Limit exhaustion mapping"; §E Work Item states with `FAILED`/`UNINSPECTED` feeding coverage; §H row 1. |
| **H-5** Escalation as an injection channel | **CLOSED** | FR-27 (typed kinds, closed answer sets, free text never enters the agent's context, question labelled and rendered inert); NFR-2 includes "through an Escalation's rendered question"; §D injection-shaping-an-Escalation case; SM-10. |
| **H-6** Step / Work Item / boundary ambiguity | **CLOSED** | §3 *Step* (Plan Step / Step Execution / Tool Action), *Session Step*, *Work Item*; FR-20 PoC ordering (per Target System, all records; sign-in once as a Session Step); FR-22; FR-23 limits by Step Execution / Run; FR-25 pause at Tool Action boundary. |
| **H-7** NFR-6 10,000-record envelope vs sequential agent | **CLOSED** (owner decision 3) | §4.5 description; FR-21; §3 *Adapter*, *Target System* (kinds and acquisition path); §A.2 table now includes AccessGate, RoleMatrix, ApproveNow with acquisition path; NFR-6 split by acquisition path; SM-8 restated. |
| **H-8** Replay independence untestable | **CLOSED** | FR-30 (platform-owned asset set; acceptance with provider blocked at network level and after retention expiry); §F "Replay asset set (normative, platform-owned)"; NFR-14; §4.5 `[NOTE FOR PM]` on the cost. |

### Medium

| ID | Status | Where |
| --- | --- | --- |
| **M-1** Pause/Escalation timeouts and transitions | **CLOSED** | FR-25 (Paused timeout → Inconclusive); FR-27 (four hours for both manual and scheduled; workspace preserved); FR-26 active = Queued/Running/Paused/Awaiting Auditor; §E Run states (pause from RUNNING only; cancel from any active); §E `AMBIGUOUS → IN_PROGRESS`. |
| **M-2** Pending Confirmation as status/outcome/filter | **CLOSED** | §3 *Pending Confirmation* ("Result outcome of a Completed Run … Not a System Outcome"); FR-18 state list excludes it; FR-40; FR-43 "unsealed (Pending Confirmation)"; FR-48 as a filter label. (FR-43 still says "… Pending Confirmation … Runs" — wording only.) |
| **M-3** SM-5 counts Escalation as safe | **CLOSED** | SM-5 measured on terminal outcomes "including after an Escalation is answered"; §D expected terminal outcome per case. |
| **M-4** Untestable low-confidence golden case | **CLOSED** for the case definition | §D "genuinely ambiguous … accepted as Unevaluated, escalated, or correctly evaluated and failed only if confidently wrong"; SM-4; FR-38 confidence in [0,1]; OQ-1(b). **But** "escalated" has no Escalation kind that could produce it, and the acceptance *set* conflicts with FR-15/SM-4 "identical" terminal outcomes — see N-7. |
| **M-5** No role can change model/prompt/tool config | **CLOSED** | FR-14 platform-authored draft; FR-14 Schedule handover at a period boundary; FR-15; §E Procedure Version states incl. `RETIRED`; FR-45 "model and prompt change" events. Residual on Target System *registration* changes — see N-8. |
| **M-6** Work Item model does not fit P-2/P-4 | **CLOSED** for coverage | §3 *Reference Source*; FR-21 batch Work Items; §C per-Template "Work Item coverage"; §H per-record coverage "per the Template's coverage rule (§C)". **But** FR-22 and the *Work Item* glossary entry still assert one-per-record-per-Target-System "in the PoC" — see N-6. |

### Low

| ID | Status | Where |
| --- | --- | --- |
| **L-1** "procedure-specific code" undefined | **CLOSED** | FR-50 second consequence. |
| **L-2** "compatible Procedure Versions" undefined | **CLOSED** | §B "Exception fingerprint compatibility (normative)"; FR-41. |
| **L-3** "ordinary administrators" undefined | **CLOSED** | FR-2 "No administrator can alter Evidence; there is no extraordinary path in the PoC". |
| **L-4** NFR-6 excludes Escalation but not Pause wait | **CLOSED** | NFR-6 "excluding Pause and Escalation wait time". |
| **L-5** Manager confirms and approves the same Result | **CLOSED** (accepted assumption) | FR-2 `[ASSUMPTION]`; §8.3; §12. Not covered: a Manager submitting (as Auditor) and approving the same Result — low, N-16. |

### Non-goal / constraint contradictions table

| Prior row | Status |
| --- | --- |
| §7 human override vs Suspended mapping | CLOSED (§7 non-goal extended; FR-9; §B). |
| §6 Rule-Classified authoritative vs P-1 uncompiled override | CLOSED (§6 restated per condition; FR-37 non-override per condition). |
| §7 parallel vs NFR-6 envelope | CLOSED (NFR-6 split; FR-21). |
| SM-C4 vs omitted judgment | CLOSED (FR-9; §H condition completeness; SM-C4 "never let an unevaluated condition pass"). |
| FR-25(old) Escalation cannot change rule vs UJ-3/§C trigger | CLOSED (FR-27; UJ-5; §C seeded trigger now expects Inconclusive). |
| §H freshness vs UJ-4 | CLOSED (see H-2). |

### "Not testable as written" list

| Item | Status |
| --- | --- |
| "never a fabricated Observation" | CLOSED — FR-23 defines fabrication via FR-33 corroboration. |
| "stops and reports rather than guessing" | CLOSED — FR-20 points to §D seeded cases with expected terminal outcomes. |
| Replay independent of provider | CLOSED — FR-30 network-level acceptance test; §F asset set. |
| lines of procedure-specific code | CLOSED — FR-50. |
| "must be Unevaluated for low confidence" | CLOSED — §D acceptance set (but see N-7). |
| FR-8 authoring flag blocking or advisory | CLOSED — FR-8 "advisory; execution-time denial (FR-3) is the enforced control"; §D three seeded instructions; 100% flagged. |
| SM-5 Escalation as terminal | CLOSED — see M-3. |

---

## Part 2 — Prior rubric findings (high and medium; lows noted where relevant)

| Rubric finding | Status | Where |
| --- | --- | --- |
| **high** Second execution mode implied but undefined | **CLOSED** | Owner decision 3: §4.5; FR-21; §3 *Adapter*, *Target System*; §A.2 complete; NFR-6; NFR-15; SM-8. |
| **high** Escalation notification for unattended Runs | **CLOSED** | Owner decision 4: FR-28 (in-app + email; initiating Auditor or Procedure author for scheduled Runs; every Audit Manager; delivery recorded on the Audit Trail); FR-27 last consequence; UJ-4; FR-45 "notification" events; §F "notifications". |
| **medium** No `[NOTE FOR PM]` at real tensions | **CLOSED** | §0 (re-derivation cost), §4.5 (Solari vs neutrality, Replay-asset cost), FR-4 (SM-8 proves the engine, not authoring). |
| **medium** FR-4 assumption weakens SM-8 | **CLOSED** | FR-4 `[NOTE FOR PM]` with stretch acceptance case; SM-8 restated. |
| **medium** FR-12 no plan-correction path | **CLOSED** | FR-12 third consequence (no direct edit; re-derive on change, recorded; underivable plan blocks submission); UJ-1 shows the cycle. |
| **medium** FR-8 scope-widening detection untestable | **CLOSED** | FR-8 second consequence; §D three seeded instructions. |
| **medium** *System Outcome* contradicts Pending Confirmation | **CLOSED** | §3 *System Outcome* (Pass or Control Failure; Inconclusive/Run Failed/Canceled are Run states), *Pending Confirmation* (not a System Outcome). |
| **medium** *Audit Trail* undefined | **CLOSED** | §3 *Audit Trail* with relation to Timeline. |
| **medium** Step ↔ Work Item relation | **CLOSED** | §3 *Session Step*, *Step*, *Work Item*; FR-20; FR-22. |
| **medium** `Solari` undefined / vs neutrality | **CLOSED** | §3 *Workspace Provider*; §4.5 uses the generic term plus `[NOTE FOR PM]`; addendum §J. |
| low: OQ-1 split; NFR-10/11 justified; fingerprint compatibility; dashboard bound (FR-48 → NFR-7); manual-Run Escalation timeout; confidence signal form; bare *Source* (alias declared in §3); *Timeline* short form; Unevaluated/human-classified/Inconclusive/Pending Confirmation/executable plan entries; *Auditor Review* clarified; FR-17 → FR-48 ref; §A.2 completeness; Result version; *connector* removed | **CLOSED** | Verified in §3, §5, §11, §B, FR-17, FR-27, FR-38, FR-48. |
| low: pause (30 min) vs Escalation (4 h) timeouts unreconciled | **PARTIALLY CLOSED** | FR-27 states the workspace is preserved for the full Escalation timeout, but the PRD still does not say why an idle Paused workspace is torn down at 30 minutes while an idle Awaiting Auditor workspace is kept for four hours. One sentence at FR-25 would close it. |

---

## Part 3 — Fresh adversarial pass over the revised text

Severity is by impact on downstream build safety.

### High

#### N-1. Corroboration verifies *what* was read, never *whose* page it was read from — a grounded, corroborated Observation of the wrong account still becomes Compliant

**Cites:** FR-33 "Corroboration re-reads every declared attribute from its grounding … and compares it to `original_value`"; §B.1 (Observation carries `population_record_key` as a field, not as a grounded attribute); FR-36 "matches population records to Observations using exact keys"; §C P-1 Evidence Requirements (username, account_status, roles, screenshot, source row — no employee ID read from the Target System); FR-10 (screenshot records URL or window title but no check compares it to anything); §B "Matching uses exact normalized identifiers"; FR-27 *choose candidate*.

**Scenario.** Work Item for employee 000412 in LoanCore. The ID search returns nothing and the agent skips the name fallback, but the previous account page (000411, `disabled`) is still open — or the agent opens the first search-result row for a partial match. It records `found = true`, `account_status = disabled`, grounding into the open page's DOM. Corroboration: the extractor re-reads `disabled` at the locator → `matched`. Coverage: `found = true`. C1: Compliant. Every §H row passes; System Outcome Pass. The `population_record_key` on the Observation is a field the platform set when it created the Work Item; nothing deterministic ever checks that the Evidence belongs to that key. The same hole is the exit for a *choose candidate* answer: the human picks a candidate, but the candidate list is agent-composed and the chosen candidate's identity is never grounded and corroborated against the key.

**Fix.** (1) §B.1 and FR-10: every `found = true` Observation from a Target System carries a grounded **identity attribute** — the matching key as displayed by the Target System (employee ID on the LoanCore/LedgerDesk account page; transaction ID in ApproveNow; parameter name in ProdConsole). (2) §H: add an **"Identity corroboration"** row — the extractor's re-read of the identity attribute equals the normalized population record key; mismatch → record Unevaluated, Run Inconclusive. (3) FR-27 *choose candidate*: candidates are rendered from the platform-captured search-results Evidence with their grounded keys; when exactly one candidate's grounded key equals the record key the platform resolves the match without an Escalation; a human choice of a candidate whose grounded key does not equal the record key is permitted only if the Procedure Version declares a secondary key (for example full name) and the Result flags the record as *human-matched*. (4) Add a §D case: the account page of a *different* employee is presented as the record's page; expected terminal outcome Inconclusive.

#### N-2. The artifact the deterministic extractor re-reads is never captured — corroboration has no substrate for web and desktop Target Systems

**Cites:** §3 *Grounding* ("a pointer into its linked Evidence … from which a deterministic extractor can re-read the value"); §B.1 `locator` = accessibility-tree or DOM path (web), window and control identifier (desktop); FR-10 Evidence Requirement types = "attribute values, a screenshot of the relevant screen, the source file excerpt, and the workspace recording segment"; §F Evidence inventory ("original synthetic artifacts, screenshots, and the Replay asset set"); FR-47 "Reproduction does not depend on live Target System state"; OQ-7.

**Problem.** A DOM path or control identifier cannot be re-read from a screenshot or a video segment. None of FR-10, FR-31, §B.1, §F, or §H requires the platform to capture the accessibility-tree / DOM snapshot (web) or control-tree snapshot (desktop) *at the reading Tool Action* as an Evidence item. Two teams will build: (A) corroboration re-reads the **live page** in the workspace at registration time — the agent may have navigated away, the check is unreproducible after the Run, and FR-47/SM-7 reproduction of a Rule-Classified evaluation "from its grounded Observation" is impossible offline; (B) corroboration **OCRs the screenshot** — then the locator is not a DOM path, and every attribute effectively becomes model-read. Either way FR-33's linchpin check is undefined, and OQ-7 (which extractor) does not cover *what is captured* for the extractor to read.

**Fix.** FR-10 and §B.1: add a platform-captured **structural snapshot** Evidence type — accessibility tree or DOM serialization for web, control tree for desktop, the parsed sheet for files — captured by the platform at the Tool Action that read the attributes and bound to the same Tool Action as the screenshot; `grounding.evidence_id` must reference a structural snapshot (or file) Evidence item, never a screenshot or recording. §H corroboration and FR-47 reproduction operate on the stored snapshot only. §F: add structural snapshots to the Evidence inventory. Where a desktop Target System cannot expose a control tree, the attribute must be declared model-read (FR-33) and the Procedure Version shows it; OQ-7 keeps the extractor choice.

### Medium

#### N-3. Locator misdirection: the value can be corroborated from the wrong element of the right page

**Cites:** §B.1 `grounding = {evidence_id, locator, extracted_text}`; FR-33; §H "Observation corroboration"; §A.2 LoanCore ("read status, username, roles"); FR-7 (registration records kind, origins, credential, permitted actions — no attribute-to-field mapping).

**Scenario.** The 000412 account page shows Status `Active`; the same page has a status-filter dropdown whose options include `disabled`, or a "last disabled by" panel. The agent grounds `account_status` to the DOM path of a node whose text is `disabled`. Extractor re-reads `disabled` = `original_value` → `matched` → Compliant. Corroboration checks self-consistency of the pointer, not that the pointer denotes the attribute.

**Fix.** §B.1: grounding for web/desktop attributes also carries the field's **label or accessible name** read from the structural snapshot; the Target System registration (FR-7) or the Procedure Version declares, per declared attribute, the expected label or locator pattern (for example `Status`, `Roles`); §H corroboration also checks the label. Attributes for which no label binding can be declared are model-read. Add a §D case where the correct value appears only in a non-field element.

#### N-4. Absence proof accepts any query string and agent-reported search facts

**Cites:** §3 *Absence Observation*; §B.1 "requires Evidence of every declared search key tried, the exact query string used for each, and the Target System's captured empty-result response"; §H "Search completeness"; §C P-1 Audit Instructions ("search by employee ID, and if there is no ID match search by full name").

**Scenario 1 (typo).** The agent types `00412` (or a name with a transposed surname). The search legitimately returns nothing; the empty result is captured; both keys were "tried". Search completeness passes; `found = false` is Compliant. **Scenario 2 (report vs record).** A team implements "query string used" as a field the agent fills; the agent claims the name search was run when it was not. Nothing in the text binds these facts to the sanitized Tool Action record.

**Fix.** §B.1 and §H: the query strings are **derived from the sanitized Tool Action log** (the `type` action into the identified search control), not agent-supplied; §H search completeness additionally requires each query string to equal the normalized value of the corresponding declared search key from the population record (exact match after §B normalization); the empty result is a grounded locator into the structural snapshot (N-2). Add a §D mistyped-key case (expected Inconclusive).

#### N-5. `COMPLETED` is terminal, yet the Gate and row 5 must move a Completed Run to Inconclusive; corroboration timing contradicts "before any rule uses it"

**Cites:** FR-20 "On the last Work Item the Run transitions to Completed"; §E Run states ("terminal `COMPLETED | INCONCLUSIVE | RUN_FAILED | CANCELED`"); §E "COMPLETED means execution finished; its Result is Pending Confirmation until sealed, then Pass or Control Failure"; FR-33 "Before a conclusion, the system evaluates…"; §E outcome row 3 (Gate fails → "Inconclusive (Run state)") and row 5 ("Gate passes, sealed … Inconclusive (Run state)"); §3 *Inconclusive* ("Run state"); §1.2 rule 1 ("corroborates … before any rule uses it"); FR-37 "applies each compiled condition to each corroborated Observation"; FR-20 "evaluated … as each Observation is registered".

**Problems.** (a) If the Gate's Run-level checks (coverage, counts, condition completeness) run after the last Work Item, a Run that is already `COMPLETED` must become `INCONCLUSIVE`, but no such transition exists and `COMPLETED` is terminal. (b) Row 5 is reached only after sealing — after human rejection of an Agent-Judged evaluation to Unevaluated — on a `COMPLETED` Run; it is labelled "Inconclusive (Run state)", which cannot be applied to a terminal Run. Team A leaves the Run `COMPLETED` with a Result outcome that the glossary says is not a Result outcome; Team B adds an undocumented transition. (c) Per-Observation Gate checks (grounding present, corroboration, absence completeness, unnamed value) are described as end-of-Run Gate work in FR-33, while FR-20 evaluates compiled conditions at registration; §1.2 and FR-37 require corroboration to precede evaluation. As written, the *unnamed value* Escalation can be raised on an uncorroborated value.

**Fix.** §E Run states: on the last Work Item the Run executes the Gate; Gate pass → `COMPLETED`; Gate fail → `INCONCLUSIVE`; `COMPLETED` is terminal for execution but the Result may still resolve to Inconclusive at sealing — either (preferred) add `COMPLETED → INCONCLUSIVE` at sealing for row 5, or make Inconclusive a Result outcome as well as a Run state and relabel row 5. FR-20/FR-33: state that per-Observation checks (grounding, corroboration, absence completeness, unnamed value, required Evidence) run at Observation registration, before the deterministic evaluator applies compiled conditions; Run-level checks run at end of execution. Update §3 *Inconclusive* accordingly.

#### N-6. Work Item cardinality is contradicted between FR-22 / glossary and FR-21 / §C

**Cites:** FR-22 "one Work Item per population record per Target System in the PoC"; §3 *Work Item* ("in the PoC one Work Item per population record per Target System … Owns its Step Executions, Observation [singular]"); FR-21 "Adapter Work Items may cover a batch of population records"; §C P-2 "one adapter Work Item covering the whole population"; §C P-3 "one adapter Work Item per extraction"; §C P-4 "the ProdConsole page read is one Step Execution whose grounded parameter values populate each Work Item's Observation" vs §3 *Step* ("Step Execution is one runtime instance of a Plan Step inside one Work Item").

**Problem.** The domain model gets two cardinalities: Work Item : Observation = 1:1 (glossary, FR-22) or 1:N (FR-21, §C P-2/P-3). P-4 also has one Step Execution shared by many Work Items, which the glossary forbids. Run-level completeness "computed from Work Item states" (FR-22) is ambiguous for a batch Work Item in which some records are `found` and others are missing.

**Fix.** FR-22 and §3 *Work Item*: "one Work Item per population record per **agent-driven** Target System; for adapter-acquired Target Systems one Work Item per extraction, owning one Observation per population record (FR-21, §C)". §H per-record coverage is computed over Observations, not Work Items. §C P-4: either one Work Item for the page read owning one Observation per parameter, or state that a Session-level Step Execution may feed several Work Items and amend the *Step* entry.

#### N-7. The "escalated" acceptance for the ambiguous Agent-Judged case has no Escalation kind, and the acceptance *set* conflicts with FR-15 / SM-4 "identical" outcomes; the regression Run is under-specified

**Cites:** §D hero case ("accepted as Unevaluated, escalated, or correctly evaluated"); SM-4 ("correct, escalated, or Unevaluated"); FR-27 (closed set: *choose candidate*, *unnamed value*, *retry or skip*); FR-15 ("must reproduce the expected terminal outcomes"); SM-4 ("Two consecutive Runs … identical System Outcomes"); §E "Only `ACTIVE` versions run or schedule" vs FR-15 (regression Run before activation); FR-14 (binding frozen) vs FR-15 (Run "against the Procedure's golden dataset"); FR-38 (Agent-Judged evaluations need confirmation before sealing); FR-16 overlap rule.

**Problems.** (a) No Escalation kind lets the agent escalate an uncertain C2 judgment; "escalated" cannot occur. (b) If the ambiguous case may legitimately end Unevaluated (→ condition completeness fails → Inconclusive) or correctly Exception (→ Control Failure), two consecutive golden Runs can differ in terminal outcome while both pass §D — but FR-15 blocks activation on "a mismatch" and SM-4 demands identical outcomes. (c) A regression Run executes on an `APPROVED`, not-yet-`ACTIVE` version, against a golden dataset that is not the frozen binding, and cannot reach a terminal Pass/Control Failure without a human confirming Agent-Judged evaluations; none of this is stated (who confirms, what period, does FR-16 overlap apply, is it on the dashboard).

**Fix.** Drop "escalated" from §D and SM-4 (low confidence → Unevaluated already covers it) or add an *uncertain judgment* Escalation kind with answers {mark Unevaluated, abort}. §D: the ambiguous-C2 record is excluded from the SM-4/FR-15 identity comparison, or its expected terminal outcome is fixed by fixing the tester's confirmation script. FR-15: regression Runs are permitted on `APPROVED` versions, bind to the golden Population Source declared on the Template, are confirmed by the approver, and are labelled regression on the dashboard.

#### N-8. A Target System registration change never mints a new Procedure Version, so FR-15 cannot fire for it

**Cites:** FR-15 (regression required when "Target System registration differs from the prior approved version"); FR-14 list of changes that create a draft (scope, binding, Target Systems, instructions, rule, Evidence Requirements, Schedule, model, prompt, tool configuration — not registration); FR-7 (version records kind, origins, credential reference, permitted actions); FR-2 (PoC Administrator manages registrations); FR-50 ("maintenance effort after a seeded Target System change including the FR-15 regression Run").

**Scenario.** The Administrator changes LoanCore's allowlisted origin or the credential reference. No draft is created (FR-14), the `ACTIVE` version keeps running against a registration it never froze, and the seeded maintenance case in FR-50 has no trigger.

**Fix.** FR-14: add "a change to a referenced Target System registration (origin, application identity, credential reference, permitted actions)" to the platform-authored-draft list; FR-7: the version freezes a digest of each registration; FR-15 compares that digest.

#### N-9. "Applicable record" is defined only for the hero's C2; generically, the agent could decide applicability

**Cites:** FR-9 "Every condition applies to every applicable record"; FR-38 "each uncompiled condition and each applicable record"; §H "Condition completeness — every applicable condition has an evaluation for every record"; §C P-1 "C2 applies to every found account".

**Scenario.** For a non-hero or re-authored uncompiled condition, applicability is undefined. A team lets the agent report "not applicable"; the completeness check counts only applicable records; the skipped records reach Pass — the C-3 failure re-enters through the side door.

**Fix.** FR-9: applicability is a compiled predicate over Observation fields recorded on the Procedure Version for every uncompiled condition (default `found = true`), derived by the builder and shown in the plan; the agent never decides applicability; §H completeness counts records by that predicate.

#### N-10. *abort* has no Run state, and the *retry or skip* trigger is undefined

**Cites:** FR-27 answer sets ("abort the Run"; "abort"); §E Run states (no abort; `CANCELED` "reserved for explicit human cancellation"); FR-26; FR-23 "Exhausting a limit produces Escalation, Inconclusive, or Run Failed according to addendum §E" vs §E limit-exhaustion mapping (never produces an Escalation); §C seeded "search timeout (*retry or skip*)"; §D expected terminal outcome per case.

**Problems.** An Escalation answer of *abort* is an explicit human action — Canceled? — or an execution stop — Inconclusive? The seeded `Suspended` case expects Inconclusive; if the tester answers *abort* the outcome is undefined. *retry or skip* is raised either before retries are exhausted (agent's discretion) or instead of the automatic `FAILED` mapping; the two readings produce different Timelines and different SM-2/SM-5 test scripts. Whether a *retry* answer resets the retry counter is unstated.

**Fix.** §E: *abort* → `CANCELED` with reason "Escalation answer: abort", actor recorded. FR-27/§E: *retry or skip* is raised by the platform when a Step Execution's retry limit is exhausted, before the Work Item is marked `FAILED`; *retry* grants one more bounded retry cycle (counted against the Run-level Step Execution limit); *skip* → `UNINSPECTED`. Reword FR-23 to match.

#### N-11. Journey text contradicts FR-43 / FR-20 / §B on who submits and who raises

**Cites:** UJ-6 "Maya opens a submitted Result. One record carries an [unconfirmed] Agent-Judged evaluation … confirms … the Result seals" vs FR-43 "Submission is blocked for unsealed (Pending Confirmation)"; UJ-4 "the Audit Agent … submits the Result" vs FR-43 (an Auditor submits, sealed only); FR-20 "submits the Run for Auditor review" vs §3 *Auditor Review* (Audit Manager's approval, initiated by the Auditor); UJ-5 "the agent raised an Escalation [for `Suspended`]" vs §B "the platform raises an *unnamed value* Escalation" and FR-20 (agent never decides for a compiled condition).

**Fix.** UJ-6: Maya opens a *Completed* Result in Draft, confirms, then the Result is submitted and approved. UJ-4: "… and the Run completes with its Result in Draft". FR-20: "… and, on completion, the Run transitions to Completed with its Result in Draft (FR-40)". UJ-5: "the platform raised an Escalation".

### Low

#### N-12. Evaluation-model wording that a literal implementation gets wrong
- FR-9: "Compliant only if every condition has a non-Exception evaluation that is Rule-Classified, confirmed Agent-Judged, or human-classified" — a human-classified evaluation with value `UNEVALUATED` is non-Exception and human-classified, so the record reads Compliant; FR-40 and §E row 7 block Pass, but FR-39 counts would be wrong. Fix: "non-Exception, non-Unevaluated".
- §B.1 "one evaluation per Compliance Rule condition" vs FR-39/§F counting both the rejected Agent-Judged evaluation and its human replacement. Fix: the rejected evaluation is retained as history; the current evaluation is the human one.
- §3 *Unevaluated* lists "rejected without replacement", but FR-38 requires a replacement value on rejection. Fix: delete the phrase or allow rejection without replacement (→ Unevaluated) explicitly.
- FR-38 `[ASSUMPTION]` "stored as Unevaluated rather than as an evaluation" vs §B.1 where `origin = UNEVALUATED` *is* an evaluation. Fix: "stored as an evaluation with origin `UNEVALUATED` and the confidence recorded".
- A compiled condition over a model-read attribute (FR-33, §B.1 "any condition over it is Agent-Judged"): who produces the evaluation (agent per FR-38, or the deterministic evaluator applied to the model-read value with origin `AGENT_JUDGED`) and where its rationale/confidence come from is unstated.

#### N-13. §H "Integrity → `RUN_FAILED`" cannot apply after the Run
FR-35 detects mismatches at any time (including export, FR-46); a finalized Run cannot become `RUN_FAILED` (§E terminal; FR-43 nothing changes after finalization). Fix: during the Run → `RUN_FAILED`; afterwards → integrity event on the Audit Trail, visible flag on the Result and Bundle, no state change.

#### N-14. Agent Workspace and Live View for adapter-only Runs
FR-19 creates a workspace for every Run and fails the Run if creation fails; FR-24 shows "the workspace screen". P-2/P-3 Runs have no agent-driven Target System. Fix: a workspace is created only when the Procedure Version has agent-driven Steps (or the agent opens a file Source for the recording); Live View shows Adapter Session Steps otherwise.

#### N-15. Procedure Version / review state nits
- §E "Only `ACTIVE` versions run" vs FR-16 "approved Procedure Version" (approved-but-awaiting-regression cannot be run manually; say so or allow it).
- FR-43 "Direct finalization from Submitted or Rejected" — `Rejected` is not a §E review state (rejection returns to `DRAFT`). Align.
- FR-13 "Rejection returns the Procedure to draft" vs §E "`REJECTED → DRAFT` on edit".
- §E row 3 lists "missing C2 evaluation" — hero-specific in a normative generic table; say "missing evaluation for an applicable condition".
- FR-18 actor list omits Adapter; FR-45 includes it.

#### N-16. Documentation and fixture nits
- Addendum §I maps rev 1 → rev 2 only; the intra-rev-2 renumbering (47 → 50 FRs) that the two prior reviews cite is unmapped; add a column or a note so the reviews remain navigable.
- *Uninspected* and *golden dataset* are used normatively (FR-15, FR-20, FR-30, FR-31, FR-33, §E, §H) without glossary entries.
- §8.1 P0 map omits FR-14, FR-15, FR-16, FR-18, FR-21, FR-22 from every row; the map claims "all sixteen capabilities" but FR-21 (Adapter acquisition, owner decision 3) belongs under capability 10 or 13.
- FR-46 exports "a Completed or finalized Result" — Completed is a Run state, and Inconclusive/Run Failed Runs (UJ-5) cannot be exported for diagnosis; consider allowing export of any terminal Run.
- FR-27 "No answer classifies a record" vs the *unnamed value* answer "mark the record Unevaluated" — say "never classifies a record Compliant or Exception".
- UJ-3 (manual August Run acquiring "the current leavers export") works only if the weekly export is cumulative; §A.1 should state the fixture's semantics.
- §C P-3 Compliant requires "the approver's limit" but no Population Source, Target System, or Reference Source supplies approver limits.
- FR-2: an Audit Manager may submit (as Auditor) and approve the same Result; either add to the FR-2 assumption or block.
- SM-2 "Validates FR-19 through FR-30" sweeps in FR-21 and FR-28, which its description does not exercise.

---

## Part 4 — Cross-reference and glossary verification (task 3c, 3d)

- **Every `FR-n` mention in prd.md and addendum.md resolves to the FR whose content it describes:** §1.1 (FR-33/34; FR-29/30/47; FR-13/38/43/44; FR-3/7/19; FR-23/27/38), §1.2 (FR-31/33; FR-9/37/38; FR-9/27), §3 *Audit Trail* (FR-45), FR-8→FR-3, FR-11→FR-15, FR-14→FR-15, FR-15→FR-50, FR-17→FR-48, §4.5 note (FR-29/30), FR-20→FR-38, FR-23→FR-33, FR-27→FR-28, FR-37→FR-44, FR-48→NFR-7, FR-50→FR-15, §8.1 map (all 16 rows), §9 (all eleven "Validates" lists), §10 (FR-15, FR-41, FR-23/29/45), §11 (FR-12, FR-38), §12 (FR-2/4/11/12/24/25/27/38 — all carry inline `[ASSUMPTION]` tags; roundtrip complete), addendum §A.1 (FR-21, FR-6), §A.2 (FR-3), §B.1 (FR-9), §C (FR-20, FR-9), §E (FR-15), §F (FR-30), §J (NFR-15). No dangling or mis-targeted reference found.
- **Addendum §I:** the rev-2 column covers FR-1..FR-50 exactly once and NFR-1..NFR-15 exactly once; targets describe the named content. The rev-1 column could not be verified (rev 1 not in scope). See N-16 for the missing intra-rev-2 map.
- **ID continuity:** FR-1..50, NFR-1..15, SM-1..11, SM-C1..4, UJ-1..6 contiguous.
- **Glossary — defined but unused in the PRD body:** *Reference Source* (used only in the addendum — acceptable), *Audit Assignment* (used in §1 chain and FR-22 — fine). **Used but undefined:** *Uninspected*, *golden dataset* / *golden Run* (N-16). *Awaiting Auditor*, *Failed* (Work Item), *Contradictory* are defined inside other entries or §E — acceptable. Bare *Source* is now a declared alias; *connector* and *classification* no longer appear.
- **§E internal consistency:** state enumerations agree with FR-18, FR-26, FR-42, FR-43 (except the `Rejected` review state, N-15); outcome-table row order is correct for precedence (Canceled → Run Failed → Gate fail/timeouts → Pending → Unevaluated → Control Failure → Pass) and matches FR-40; the defect is row 3/row 5 versus a terminal `COMPLETED` (N-5) and the missing *abort* state (N-10).
- **§H internal consistency:** outcomes agree with §E and FR-34 except the post-Run Integrity row (N-13); per-record coverage's `found ∈ {true,false}` correctly excludes `ambiguous` (§B.1) and routes it to the "Ambiguous match" row.

---

## Verdict

**needs-revision.** All four prior criticals and all eight highs are closed or reduced to a bounded residual; the owner's four decisions are consistently carried into the FRs, glossary, journeys, §E, and §H. What remains is one class of exploit the corroboration fix did not reach — the deterministic layer now verifies the *value* at an agent-chosen pointer but neither the *identity* of the record the pointer belongs to (N-1) nor, for web and desktop systems, the *captured artifact* the pointer is read from (N-2) — plus a set of medium inconsistencies the fixes themselves introduced (terminal `COMPLETED` vs Gate/row-5 Inconclusive, Work Item cardinality, the unproducible "escalated" outcome, registration changes outside FR-14, generic applicability, the *abort* answer). Close N-1, N-2, N-5, and N-6 before the architecture spine is re-derived; they change the Observation schema, the Evidence types, the Run state machine, and the Work Item model.
