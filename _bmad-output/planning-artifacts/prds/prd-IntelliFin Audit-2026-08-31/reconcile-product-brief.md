---
title: "Reconciliation: Product Brief → PRD revision 2"
input: "../../briefs/brief-IntelliFin Audit-2026-08-31/brief.md"
targets: "prd.md (rev 2), addendum.md (rev 2)"
created: 2026-09-01
status: review-extract
---

# Reconciliation: Product Brief → PRD revision 2

Scope: every product principle, PoC success criterion, MVP-boundary item, risk, differentiation claim, and PRD-handoff decision in the brief, plus the proposition steps and qualitative ideas in prose. Each item is classed as **Covered**, **Superseded by owner decision**, or **Gap**. Locations refer to `prd.md` (§/FR/NFR/SM) and `addendum.md` (§A–§J).

## Covered

| Brief item | PRD / addendum location | Note |
| --- | --- | --- |
| **Exec summary:** converts auditor-approved procedures into repeatable, governed tests | §1 thesis; FR-13, FR-14, FR-15, FR-16 | |
| Exec summary: gathers evidence, performs tests, identifies exceptions, traceable evidence trail | FR-28, FR-29, FR-34, FR-38, FR-26 | |
| Exec summary: does not replace the auditor; auditor accountable for approval, sufficiency, investigation, conclusions | §1, §2.2, FR-13, FR-35, FR-40, §7 first non-goal | "Risk assessment" and "professional skepticism" are not named; see Notes |
| Exec summary: first wedge = four synthetic read-only procedures | FR-4, §8.1, addendum §C | Reshaped: one hero + three Templates (see Superseded) |
| **Problem:** four costs (mechanical work, late/sample-blind detection, auditor variance, untraceable evidence) | §1, §2.2 JTBD, NFR-4, FR-29 | Implicit; not restated as a problem statement |
| Problem: run approved procedures more frequently / respond when a control fails | FR-11, FR-16; §8.3 defers monitoring, alerts, trends | |
| **Users:** CAE buyer; auditors, IT auditors, audit managers | §2.1 | |
| Users: risk/compliance/audit firms as future customers | §2.1 non-users | Separation of management monitoring vs independent assurance dropped — Gap 10 |
| **Proposition step 1:** read-only authorized evidence | FR-3, FR-7, addendum §A.2 | |
| Proposition step 2: record source, retrieval time, scope, completeness checks | FR-5, FR-28, FR-30, addendum §H | |
| Proposition step 3: normalize and reconcile across systems | FR-33, addendum §B, §C P-2/P-3 | Narrowed to exact-key matching; fuzzy matching explicitly out of scope |
| Proposition step 4: deterministic test logic where expressible as rules | FR-9, FR-34, §6 | |
| Proposition step 5: bounded agentic capabilities for navigation/extraction/classification/interpretation | FR-19, FR-21, FR-35 | Agent role widened (see Superseded) |
| Proposition step 6: escalate missing/ambiguous/low-confidence/contradictory evidence | FR-25, FR-31, FR-35 `[ASSUMPTION]`, addendum §E limit mapping | |
| Proposition step 7: results, exceptions, evidence, transformations, execution trace for review | FR-26, FR-33, FR-36, FR-37, FR-38, addendum §F | |
| Proposition step 8: repeat versioned procedure on demand or schedule | FR-14, FR-15, FR-16, FR-24 | |
| Terminated-access example incl. 24-hour requirement | UJ-1..UJ-6; addendum §C P-1 "Template variant retained" | 24h rule kept as variant, not default |
| **Differentiation 1:** evidence-grade execution — versioned procedure contracts define populations, evidence, logic, escalation | FR-5–FR-13, FR-14 | "tolerances" and "review responsibilities" not in the contract — Gaps 1, 8 |
| Differentiation 1: conclusion links immutably to evidence, transformations, software versions, completeness checks, reviewer decisions | FR-26, FR-29, FR-32, FR-40, FR-42, addendum §F | |
| **Differentiation 2:** governed hybrid automation across structured sources, spreadsheets, browsers, desktop | FR-6, FR-7, FR-19, addendum §A | "documents" (unstructured) not a PoC source type — Gap 11 |
| **Differentiation 3:** least privilege, credential isolation | FR-3, FR-18, FR-19, NFR-1, NFR-5 | |
| Differentiation 3: data residency, private deployment | NFR-15 `[ASSUMPTION]`, §8.3 deferred, addendum §J, Open Q2 | Deferred with a preserved path |
| Differentiation 3: reusable FS/lending/fintech/telco control patterns | §7 non-goal (cross-industry library); Templates in FR-4 | Not on §8.2 maturity table — Gap 13 |
| "Working without APIs is not a moat; RPA already does UI automation" | §7 non-goal: general-purpose RPA | Positioning not argued in PRD — see Notes |
| "Wins only with materially less setup and operating effort" | FR-47, SM-1, SM-11, SM-C3, §10 "Builder becomes a developer tool" | Comparative baseline absent — Gap 12 |
| Coexists with GRC / not a system of record | §7 non-goal (replacement of GRC); §8.3 deferred integration | Positioning implicit — see Notes |
| **PoC:** fictional org, synthetic data, read-only, four procedures | §8.1, NFR-13, addendum §A, §C | |
| PoC is a foundation, not disposable; shared capabilities as reusable components | §6 constraints, SM-8, §10 "Disposable-demo architecture" | |
| **PoC success 1:** all four run from evidence collection through auditor review with known expected results | SM-4, SM-8, SM-9, addendum §D | |
| PoC success 2: expected exceptions and compliant cases, no unexplained differences | SM-4 | |
| PoC success 3: every result traceable to evidence, transformations, version, execution record | SM-6, FR-29 | |
| PoC success 4: incomplete/stale/inaccessible/contradictory → explicit inconclusive or error, never false pass | SM-5, SM-C1, FR-30, FR-31, addendum §H | |
| PoC success 5: auditor reviews, reproduces, approves/rejects without code | SM-7, FR-43, FR-44, FR-40 | |
| PoC success 6a: common components reused across four procedures | SM-8, FR-47 | |
| PoC success 6b: reruns produce consistent results | NFR-4 (classification only) | Run-level rerun consistency not measured — Gap 2 |
| **MVP:** creation, approval, versioning, scheduling of procedures | FR-4–FR-16 | |
| MVP: read-only collection from small extensible set of source types | FR-6, FR-7, §6 contracts | "Extensible"/adapter architecture not explicit — Gap 9 |
| MVP: cross-source reconciliation + deterministic execution | FR-33, FR-34 | |
| MVP: population, freshness, completeness validation | FR-30, addendum §H | |
| MVP: exception management — duplicate detection, ownership, status tracking | FR-38 (stable fingerprint), FR-39 (assign, states), addendum §E | Materiality/tolerance thresholds absent — Gap 1; cross-Run aggregation deferred §8.3 |
| MVP: evidence-linked results, execution logs, reviewer sign-off, exportable working papers | FR-37, FR-26, FR-40, FR-43 | |
| MVP: failure-safe escalation for access, evidence, automation, confidence | FR-25, FR-31, FR-21, addendum §E | |
| MVP: security controls — identities, credentials, permissions, audit logging, retention, tenant isolation | FR-1, FR-2, FR-42, NFR-1, NFR-14; SSO/tenant admin/retention deferred §8.3 | |
| MVP exclusions: autonomous opinions, remediation, write access, universal NL automation, broad industry coverage, GRC replacement | §7 non-goals (all six present) | |
| MVP assumption: design-partner integrations; adapter architecture; no large connector catalog | §8.3 deferred; §7 non-goal (broad connector catalog) | Adapter architecture — Gap 9 |
| **Principle 1:** no conclusion without sufficient evidence | §1, FR-30, FR-31, SM-5, SM-C1 | |
| Principle 2: reproducibility over theatrical autonomy | SM-C2, FR-26, FR-27, FR-44, NFR-4 | |
| Principle 3: human accountability in the workflow | FR-13, FR-35, FR-40, FR-41, §7 | |
| Principle 4: read-only and least privilege by default, bounded by procedure and environment | FR-3, FR-7, FR-18, NFR-5 | |
| Principle 5: agent uncertainty visible; escalation or safe failure, never concealed inference | FR-21, FR-25, FR-35, SM-C4, §6 last bullet | Principles not restated as a set — Gap 6 |
| **Risk:** evidence failure / false pass | §10 "False Pass from bad Evidence" | |
| Risk: prompt injection, UI changes, ambiguous records, unreliable navigation, safe failure modes | §10 prompt injection, desktop fragility; NFR-2, FR-21, addendum §D | Model drift + regression testing — Gap 4 |
| Risk: privilege concentration | FR-3, FR-18, NFR-1, NFR-5, FR-42, SM-10 | |
| Risk: alert fatigue | §10 "Escalation fatigue" | Reframed to Escalations only — Gap 7 |
| Risk: implementation economics / services-heavy | FR-47, SM-C3, §10 "Builder becomes a developer tool", "Disposable-demo architecture" | |
| Risk assumption: MVP baseline targets (setup time, hours saved, frequency, FP rate, approval rate, reuse, cost per test) | FR-47, SM-11 (setup time, reuse, interventions) | Four of seven measures missing — Gap 5 |
| **Handoff 1:** first design-partner profile and source mix | §8.3 deferred; synthetic Northstar in addendum §A | Deliberately deferred |
| Handoff 2: procedure-authoring model | §4.2 hybrid builder; §8.2 maturity row | Decided (see Superseded) |
| Handoff 3: evidence-store, retention, immutability, export model | FR-28, FR-29, FR-32, FR-43, NFR-14, addendum §F; Open Q2, Q4 | Retention is `[ASSUMPTION]` |
| Handoff 4: identity matching, completeness controls, confidence thresholds | FR-33, addendum §B, §H; FR-35 `[ASSUMPTION]`; Open Q1 | |
| Handoff 5: deterministic vs model-assisted boundary | FR-9, FR-34, FR-35, §6, SM-C4 | Fully decided |
| Handoff 6: deployment topology / sequencing (SaaS, private cloud, customer-hosted) | NFR-15, §8.3, addendum §J | Sequencing not decided; acceptable for PoC |
| Handoff 7: GRC / audit-management integration after wedge | §7 non-goal, §8.3 deferred | |
| **Vision:** autonomous execution layer, not assurance authority; risk-appropriate intervals | §1, FR-11, §8.2 | Control packs and third-party integrations absent from §8.2 — Gap 13 |

## Superseded by owner decision

Recorded so the divergence is explicit; not counted as gaps.

1. **"Desktop applications and legacy environments ... should be demonstrated only after the evidence model and test runner have been validated"** (brief §First PoC `[ASSUMPTION]`). Revision 2 puts a desktop Target System (LedgerDesk) inside the PoC (FR-7, §8.1, addendum §A.2) with a dedicated risk in §10. The brief's preference for controlled web apps, files, and structured sources survives for the other Templates.
2. **Procedure authoring left as an open handoff decision** ("structured builder, controlled natural language, templates, or a combination"; rev-1 had deferred authoring entirely). Revision 2 decides: hybrid structured fields + natural-language Audit Instructions + plan preview, in scope for the hero Procedure (§4.2, FR-8, FR-12, §8.2).
3. **Agent as fallback** — "uses bounded agentic capabilities ... where rules alone are insufficient" (proposition step 5). Revision 2 makes the Audit Agent the primary executor of every Run (FR-19) while retaining determinism for classification only (FR-34/FR-35, §6). The ordering "deterministic first, agent where insufficient" now applies to classification, not to execution.
4. **Four preconfigured procedures as the wedge.** Revision 2 replaces this with one fully configurable hero Procedure plus three Templates whose instructions and rules need not be re-authored for acceptance (FR-4 `[ASSUMPTION]`, §7, §8.1).
5. **Cross-system reconciliation breadth** — narrowed to exact normalized-identifier matching; fuzzy identity resolution is out of scope and ambiguous matches become Unevaluated or Escalations (addendum §B). Recorded here because the brief's "identity resolution" risk assumed a harder problem than the PoC will attempt.

## Gaps

1. **"configurable materiality and tolerance thresholds"** (MVP boundary) and **"specifies expected conditions and tolerances"** (proposition). Nothing in the Procedure Builder (FR-9 covers boundary semantics only), the Exception workflow (FR-39), the Result (FR-37), §7, or §8.3 mentions materiality or tolerance. The concept is neither in scope nor explicitly deferred, so it has silently vanished. *Suggested placement:* add a consequence to FR-9 ("a Compliance Rule may declare a tolerance or materiality threshold as a compiled condition; the PoC exercises at least the P-3 USD 100,000 boundary") or add an explicit line to §8.3 deferring materiality/tolerance and stating that the PoC treats every Exception as material.
2. **"reruns produce consistent results"** (PoC success criterion 6). NFR-4 requires determinism only for re-classifying *frozen* Observations. With an agentic executor, the risk is that two Runs of the same Procedure Version over the same golden Population produce different Observations (different search path, missed record, different screenshot) and therefore different outcomes. No SM or NFR demands Run-level consistency. *Suggested placement:* new consequence on SM-4 or SM-8 ("two consecutive Runs of each golden dataset yield identical System Outcomes and identical Rule-Classified counts; Observation differences are explained"), and a §D golden-dataset requirement that every dataset is run at least twice.
3. **"Platform assurance: customers will need evidence over IntelliFin Audit's own access, changes, models, logs, completeness controls, tamper resistance, incidents, and data handling"** (risk). Dropped entirely — not in §10, not in §8.3 (which defers "regulatory certification" only), and not in §7. The seeds exist (FR-42 Audit Trail, NFR-3 integrity, model/prompt versions in FR-21/FR-26) but the idea that the platform is itself an audit subject, and that the PoC should show what a customer's auditor would ask for, is gone. *Suggested placement:* §10 risk ("Platform not itself auditable") with mitigation pointing at FR-21, FR-26, FR-42, NFR-3; and a §8.3 line deferring a platform-assurance evidence pack (change control, model change log, incident log).
4. **"model drift ... require version control, regression testing, monitoring"** (risk: agent and UI instability). FR-14 makes a model or tool change a new Procedure Version, and FR-47 measures maintenance effort after a seeded Target System change, but nothing requires re-validation of an existing approved Procedure against its golden dataset when the model, prompt version, or Target System UI changes, and nothing monitors for drift between Runs. *Suggested placement:* new FR in §4.13 ("Regression re-run: approving a Procedure Version whose model, prompt, or tool configuration differs from the prior version requires a golden-dataset Run before its Schedule activates") or a consequence on FR-13; add "drift" to the §10 prompt-injection/desktop risks.
5. **"setup time, auditor hours saved, testing frequency, false-positive rate, reviewer approval rate, procedure reuse, and cost per completed test"** (risk assumption on MVP baselines). FR-47/SM-11 carry setup time, Escalations, interventions, procedure-specific code, reuse, and maintenance. Missing: false-positive rate (Not-an-Exception dispositions per Run are recorded by FR-39 but not aggregated), reviewer approval/rejection rate (FR-40 records decisions but no metric), cost per completed test (FR-21 and NFR-12 expose tokens and limits consumed, but no per-Run cost is reported), and auditor hours saved (needs a manual baseline for the hero Procedure). *Suggested placement:* extend FR-47 consequences and SM-11 with these four; add an Open Question on who performs the manual baseline of the hero Procedure.
6. **The five Product Principles as a named set** ("No conclusion without sufficient evidence", "Reproducibility over theatrical autonomy", "Human accountability is part of the workflow", "Read-only and least privilege by default", "Agent uncertainty must be visible"). Each is realized somewhere, but the PRD never restates them, so architecture and UX (which §0 says must be revised against this document) lose the tie-break rules they were written for. Counter-metrics SM-C1–C4 are the closest surrogate. *Suggested placement:* §1.1 "Product Principles" listing the five verbatim, each with the FRs/SMs that enforce it.
7. **"Alert fatigue: continuous execution without materiality, tolerances, duplicate detection, and ownership may create more work than periodic testing"** (risk). §10 reframes this as Escalation fatigue (agent questions per Run). The other half — a weekly Schedule re-raising the same Exceptions every Run with no cross-Run suppression, ownership carry-over, or materiality — is only partly acknowledged by §8.3 ("cross-Run Exception aggregation beyond stable fingerprints") and never named as a risk. *Suggested placement:* rename or add a §10 entry "Exception fatigue on scheduled Runs", mitigation: stable fingerprints (FR-38) plus deferred aggregation; cross-reference Gap 1.
8. **"review responsibilities"** as part of the procedure contract (differentiation 1) and "ownership" (MVP). A Procedure Version fixes scope, rule, evidence, credentials, and Schedule, but not who reviews its Results or who owns its Exceptions by default; reviewer is any Audit Manager and Exception assignment is ad hoc (FR-39). *Suggested placement:* optional consequence on FR-5 or FR-13 ("a Procedure Version may name a default reviewer and Exception owner; unattended Runs route to them"), or an explicit §8.3 deferral.
9. **"A source-adapter architecture and import capability are required"** (MVP assumption) / "small, extensible set of source types". FR-6 lists three Population Source kinds and FR-7 two Target System kinds; §6 forbids hardcoding contracts into screens; NFR-15 covers runner portability. No requirement states that adding a Source or Target System type is an adapter-level change rather than a product change. *Suggested placement:* add to §6 or NFR-15: "Population Source and Target System types are implemented behind a common adapter contract; adding a type must not change Builder, Gate, or classification code", and count adapters in FR-47's reuse measure.
10. **"subject to clear separation between management monitoring and independent assurance responsibilities"** (users). §2.1 lists Risk, Compliance, and control owners as non-users but drops the reason — that management-run monitoring must not be presented as independent assurance. This matters for the PoC data model if a control owner ever runs a Procedure. *Suggested placement:* one sentence in §2.1 or §7 ("Runs initiated by control owners or first/second line are outside the PoC; the model must not conflate them with independent assurance").
11. **"documents"** as an evidence source (differentiation 2: "structured sources, documents, spreadsheets, browsers, and desktop interfaces"). The PoC Sources are spreadsheet/CSV, versioned file, and API (FR-6) plus web and desktop Target Systems; unstructured documents (PDF approvals, policies, tickets) are neither in scope nor deferred. *Suggested placement:* a row in §8.2 (Evidence sources: PoC structured/file/UI → Next documents) or a §8.3 line.
12. **"materially less setup and operating effort than the combination of GRC software, analytics or RPA, scripts, and manual work"** (differentiation). SM-1 and SM-11 measure absolute effort with zero procedure-specific code, but nothing compares against a scripted or manual baseline for the hero Procedure, so the PoC cannot say "less than". *Suggested placement:* SM-11 consequence or Open Question 7: "Establish a manual/scripted baseline for the hero Procedure to compare against SM-11 measures."
13. **"reusable regulated-industry control packs and third-party integrations"** (vision; differentiation 3 "reusable ... control patterns"). §7 excludes a cross-industry library and §8.3 defers integrations, but the §8.2 maturity table — the PRD's stated instrument for showing the path beyond the PoC — has no row for Templates → control packs. *Suggested placement:* add a §8.2 row "Procedure library: PoC four Templates → Next tenant-authored Templates → Vision regulated-industry control packs".

## Notes

- **Positioning prose not carried.** The brief's competitive framing — "coexists with audit-management and GRC platforms, not another system of record"; "working without APIs is not itself a moat" — is honored by the non-goals but never argued in the PRD. Given that revision 2's thesis *is* an agent doing UI work, a one-paragraph statement of why that differs from RPA (auditor-authored, evidence-gated, replayable, no developer per procedure) would protect the thesis from the brief's own warning. Candidate location: end of §1.
- **Human-accountability vocabulary.** The brief names "risk assessment" and "professional skepticism" as auditor-retained responsibilities. The PRD keeps approval, sufficiency review, investigation, and final conclusions but never uses those two terms. Not a functional gap; worth one clause in §2.2 or §7 so audit readers recognize the IIA vocabulary.
- **Evidence sufficiency ownership shifted.** The brief assigns evidence sufficiency to the auditor; the PRD automates the floor (Evidence Quality Gate, addendum §H, zero tolerance) and leaves the auditor the ceiling (JTBD "Determine whether the Evidence is sufficient"). This is consistent, but the PRD should say explicitly that Gate pass is necessary, not sufficient, for reliance — FR-37's "Pass is available only after..." reads as if the Gate settles sufficiency.
- **24-hour rule demoted.** The brief's worked example is the 24-hour disablement window; the PRD hero Compliance Rule is status-based and the 24-hour rule is a Template variant (addendum §C P-1). Fine for an agentic hero (status is observable on screen), but the golden dataset §D "exact boundary case" for P-1 has no boundary unless the variant is exercised — confirm which rule the P-1 boundary case targets.
- **Continuous testing.** The brief accepts continuous testing as established, not novel; the PRD defers monitoring, alerts, and trends (§8.3) while keeping Schedules. No conflict, but §8.2 could add an "Execution cadence" row so the path from weekly Schedule to risk-appropriate continuous execution (vision) is visible.
- **Handoff decisions status.** Of seven handoff decisions, 2, 4, and 5 are decided in revision 2; 3 is decided modulo `[ASSUMPTION]` retention; 1, 6, and 7 are deliberately deferred with a preserved path. No handoff decision is silently dropped.
- **Non-goals coverage.** All six MVP exclusions from the brief appear in §7. §7 adds PoC-specific exclusions (agent-discovered scope, parallel execution, human override of Rule-Classified results) that the brief did not anticipate; none contradicts the brief.
