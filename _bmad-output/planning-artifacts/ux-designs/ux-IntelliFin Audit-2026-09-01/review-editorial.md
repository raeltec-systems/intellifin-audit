---
title: Editorial review — IntelliFin Audit UX specs (DESIGN.md + EXPERIENCE.md)
artifacts:
  - ./DESIGN.md
  - ./EXPERIENCE.md
lenses: [structure, prose]
verdict: revise — no reordering, no scope change; fix 3 critical and 8 high items before architecture / front-end handoff
counts:
  structure: { critical: 2, high: 3, medium: 8, low: 6, total: 19 }
  prose: { critical: 1, high: 5, medium: 8, low: 13, total: 27 }
  total: 46
reviewed: 2026-09-01
reader_type: humans (downstream architect and front-end developer), with LLM-consumption precision applied to terminology
---

# Editorial review — DESIGN.md and EXPERIENCE.md

**Purpose/audience read.** These two documents exist to help an architect and a front-end developer build the IntelliFin Audit PoC surfaces so that seven (actually eight — see S3) state families are never visually or behaviorally confused: `DESIGN.md` is the visual contract, `EXPERIENCE.md` the behavioral spine. Content is sacrosanct; every row below is a proposal the author accepts or rejects.

**Structure model applied.** Reference/Database (random access, MECE, consistent schema per item). Section order is fixed by the template and is not challenged. The two documents are evaluated as one reference set, so cross-file duplication and cross-file contradiction count as MECE failures.

**Style choices preserved.** Workpaper register (factual, restrained), sentence case, capitalized defined terms, `{path.to.token}` references, `[ASSUMPTION]` / `[NON-GOAL for PoC]` tags, bold lead-ins in DESIGN §Components, the "Lifted from / Rejected —" pattern, and the persona-driven Key Flows. None of these are flagged.

## Word metrics

Source: `scripts/word_metrics.py` (exact counts).

| File | Total | Largest sections |
| --- | --- | --- |
| DESIGN.md | 3,159 | frontmatter 630 · Components 951 · Colors 584 · Brand & Style 326 · Do's and Don'ts 233 · Layout & Spacing 181 · Typography 125 · Shapes 54 · Elevation & Depth 51 |
| EXPERIENCE.md | 4,758 | Per-surface states 960 · Component Patterns 916 · Information Architecture 385 · State families 297 · Voice and Tone 217 · Flow 1 208 · Roles and Action Gating 198 · Accessibility Floor 184 · Flow 3 155 · Interaction Primitives 149 · Inspiration 146 · Foundation 123 · Flow 6 112 · Open Questions 111 · Responsive 109 · Flow 5 102 · Flow 4 97 · Flow 2 84 |

Neither document is bloated for its purpose. The structure pass therefore targets *consistency* (one source of truth per rule) more than reduction; if every structure row is accepted, DESIGN.md loses roughly 230 words (~7%) and EXPERIENCE.md roughly 50 words (~1%).

---

## Structure lens

Tags: CUT · MERGE · MOVE · CONDENSE · QUESTION · PRESERVE. Word impact is from the metrics above. Line numbers are 1-based in the current files.

### Critical

| # | Location | Original | Disposition / proposed rewrite | Why |
| --- | --- | --- | --- | --- |
| S1 | DESIGN §Layout & Spacing L293 vs EXPERIENCE §Responsive & Platform L178–183 | DESIGN: "At 1240px the rail collapses … **Below 900px** the product enters a reading mode … Live View below 1024px is read-only." EXPERIENCE: "**900–1023px** Reading mode: single column; tables become label/value stacks … Live View read-only. **< 900px** Reading mode only; Builder and Version review show 'Open on a desktop browser…'" | **QUESTION + MERGE.** The two files disagree on where reading mode begins (DESIGN: below 900px; EXPERIENCE: below 1024px). Decide once, then make the EXPERIENCE table canonical and reduce DESIGN L293 to: "Breakpoint behavior is specified in `EXPERIENCE.md` → Responsive & Platform; the rail widths above apply at ≥ 1280px." Also, the EXPERIENCE row "1024–1279px — Rail stacks under the main column **at 1240px**" puts a breakpoint inside a band; either make 1240 the band edge (1240–1279 / 1024–1239) or state that the rail stacks for the whole band. | A front-end developer will implement two different breakpoint sets. Contradiction across files; ~60 words of duplication removed from DESIGN. |
| S2 | DESIGN frontmatter `description` L4, §Brand & Style L243, §Colors table L259–267 vs EXPERIENCE §State families L92–100 | DESIGN names seven families: Procedure Version, Run lifecycle, Evidence Quality Gate, Result outcome, Auditor Review, **evaluation origin**, Work Item. EXPERIENCE's "State families" table has seven rows: the same minus evaluation origin, plus **Exception** (Open → Under review → Confirmed / Not an Exception). | **QUESTION.** Two different "seven". Either (a) both files enumerate eight families — add an Exception row (badge treatment + icon) to the DESIGN Colors table and an "Evaluation origin" row (Agent-Judged pending → confirmed / Human-classified) to the EXPERIENCE transitions table — and change "seven" to "eight" in DESIGN L4 and L243; or (b) state explicitly in both files which family is intentionally omitted from the other and why (e.g. "Exception state is a list-level disposition and takes no badge"). | An architect modelling state enums from these files will get different sets depending on which file they open. The Exception family currently has no badge treatment anywhere. |

### High

| # | Location | Original | Disposition / proposed rewrite | Why |
| --- | --- | --- | --- | --- |
| S3 | DESIGN §Components L317, L325, L331, L333, L335 vs EXPERIENCE §Component Patterns L71, L76, L81, L82, L85 | DESIGN L307 promises "Audit-specific patterns, composed from tokens (behavior in `EXPERIENCE.md`)"; EXPERIENCE L63 promises "Behavioral. Visual specs live in `DESIGN.md.Components`." Yet DESIGN's **Confirmation dialog** paragraph (L333, ~85 words) is entirely behavioral and its rationale list ("Rejection, disagreement, 'Not an Exception', and rejecting an Agent-Judged evaluation") is repeated verbatim at EXPERIENCE L82; **Empty states** (L335) has no visual content at all (EmptyState is inherited) and duplicates EXPERIENCE L85; **Action bar** (L331) duplicates L81; **Evaluation card** L317 ("confirm/reject controls while pending. Human-classified replacements sit beneath the rejected evaluation…") and **Escalation panel** L325 carry behavior. | **MERGE / CONDENSE.** Hold the declared split. DESIGN keeps only what a stylesheet needs: Confirmation dialog → "`{spacing.dialog}` modal over `{colors.scrim}`; finalization uses the destructive primary button; rationale field when required (see `EXPERIENCE.md` → Confirmation dialog)." CUT Empty states from DESIGN (EXPERIENCE L85 is the rule). Action bar → keep the panel token and "reason is visible text, never tooltip-only"; drop the rest. Evaluation card / Escalation panel → keep layout and type; move "Human-classified replacements sit beneath…" and answer-ordering rules to EXPERIENCE L71/L76 if not already there. | One source of truth per rule; ~150 words out of DESIGN. Today a developer must diff two paragraphs to learn which is authoritative. |
| S4 | EXPERIENCE L16 "This spine wins on conflict." · DESIGN L249 "Where the prototype and this document disagree, this document wins" | Each file claims precedence over the prototype; neither states precedence between the two files, and S1 shows they do conflict. | **QUESTION → rewrite L16:** "On conflict with the prototype, this spine wins. On conflict between this spine and `DESIGN.md`, behavior and copy follow this spine; visual values (tokens, sizes, treatments) follow `DESIGN.md`." Mirror one sentence in DESIGN L249. | Removes an undefined tiebreak that S1/P12/P8 currently need. |
| S5 | EXPERIENCE §Information Architecture L44 | "Closure: every UJ lands on a surface above; every surface is entered by at least one Key Flow below." | **QUESTION.** Administration (L40) is entered by no Key Flow (Flows 1–6 touch Procedures, Builder, Version review, Procedure Detail, Live View, Runs, Run Detail, Replay, Exception Detail, Overview, Review, Notifications). Either add an Administration step to a flow or qualify: "…every surface except Administration is entered by a Key Flow below; Administration is exercised by FR-7/FR-49 only." | The sentence is a completeness guarantee a reader will trust. |

### Medium

| # | Location | Original | Disposition / proposed rewrite | Why |
| --- | --- | --- | --- | --- |
| S6 | DESIGN §Layout & Spacing L291 vs EXPERIENCE §Component Patterns L86 "Rail cards" | DESIGN lists the rail's contents (Procedure Version and Schedule, review state, change since previous Run, route into technical detail, open Escalation). EXPERIENCE lists the same plus **Session (Watch or Replay)**. | **MERGE.** Keep the enumerated list only in EXPERIENCE L86; DESIGN L291 becomes "The rail carries persistent context (cards listed in `EXPERIENCE.md` → Rail cards) so it never competes with the conclusion for vertical position." | Two lists, one divergent (~25 words saved; removes the missing-card discrepancy). |
| S7 | DESIGN §Colors table L259–267 "Badge treatment" column | Treatment names used: neutral · warning · info · danger-outline · neutral-solid · success · danger · info-solid. Only `info-solid`, `neutral-solid`, `danger-solid` exist as tokens; "danger-outline", "info", "neutral", "success", "warning", "danger" are unmapped. | **QUESTION.** Add a one-line legend beneath the table: "Treatment names resolve to `{colors.<family>-bg / -border / -text}`; `-solid` variants use `{colors.<family>-solid}` fill with `{colors.text-inverse}`; `-outline` variants use `{colors.<family>-border}` border, `{colors.<family>-text}` text, no fill." (Author to confirm the mapping — it is inferred, not stated.) | The table is the load-bearing artifact of the whole design; a developer cannot build it from the tokens without guessing. |
| S8 | DESIGN §Components L327 vs frontmatter `session-viewer` L214–222 | Prose: "LIVE · PAUSED · AWAITING · REPLAY state dot and word". Tokens: `live-dot`, `replay-dot`, `paused-dot` — no `awaiting-dot`. | **QUESTION.** Add `awaiting-dot: '{colors.info-solid}'` (consistent with the "needs a human" rule at L275) or state that AWAITING reuses another dot. | Four words, three colours. |
| S9 | EXPERIENCE §Voice and Tone L59 | One 90-word paragraph beginning "Rules: sentence case; domain nouns capitalized …" followed by a verbless fragment "Identifiers, timestamps (…), amounts (…), counts with thousands separators, periods as …, durations as …, absent values as `—`." | **CONDENSE → list.** Split into two short bullet lists, "Rules" (four bullets) and "Formats" (seven bullets, each `term — format`). Word-neutral; the fragment gains a verb ("Formats:"). | Prose that is really a schema; the current paragraph is scanned, not read. |
| S10 | EXPERIENCE §Component Patterns L71 (Evaluation card, ~75 words) and L77 (Procedure Builder sections, ~80 words) | Table cells containing five to six sentences each. | **CONDENSE (table → sub-bullets or split rows).** Either allow line breaks inside the cell (`<br>`-separated sentences) or split "Procedure Builder sections" into two rows: "Builder re-derivation" and "Builder validation". Word-neutral. | The longest cells hold the most rules; a table row is not a good container for six sentences. |
| S11 | Rule "disabled action keeps its position and shows a visible reason" — DESIGN L331, L346, L356; EXPERIENCE L56, L81, L145, L151 | Seven statements of one rule across both files. | **CONDENSE.** Canonical: EXPERIENCE L81 (it carries the accessible-description detail). Keep the Do (L346) and Don't (L356) as recap. Trim DESIGN L331 to the panel's visual spec, and EXPERIENCE L151 to "nothing is hover-only". | Reinforcement in Do's/Don'ts is fine; three normative restatements are not (~40 words). |
| S12 | EXPERIENCE §Accessibility Floor L164 | "Visual contrast lives in `DESIGN.md` (parent-system token pairs tested for WCAG 2.1 AA; gold never for text under 18.5px)." | **QUESTION.** DESIGN.md contains neither a contrast statement nor the 18.5px rule. Either add one sentence to DESIGN §Colors ("Token pairs are the parent system's WCAG 2.1 AA-tested pairs; gold is never used for text below 18.5px.") or drop the parenthetical here. | Dangling cross-reference: the reader is sent to content that does not exist. |
| S13 | EXPERIENCE §Component Patterns L75 | "See State Patterns → Live View." | **MOVE pointer.** "See Per-surface states → Live View rows (L131–135)." There is no Live View subsection. | Broken internal reference. |

### Low

| # | Location | Original | Disposition / proposed rewrite | Why |
| --- | --- | --- | --- | --- |
| S14 | EXPERIENCE L131, L147, L158 | Live View 5-second latency and self-refresh stated three times. | **CONDENSE.** Keep L158 (Interaction Primitives, with the 15-second stale rule); L131 → "frames stream (NFR-7)"; L147 → drop "Live View refreshes itself." (~12 words) | Same fact, three homes. |
| S15 | DESIGN §Shapes L301 vs frontmatter `rounded` comments L108–111 | Prose repeats the four radius assignments already in the token comments. | **PRESERVE the section (fixed order) but CONDENSE** to the one fact not in the tokens: "Radii per `rounded` above. The provenance chain uses a 22px pill marker with a 1px vertical connector — a ledger line, not an illustration." (~25 words) | Frontmatter comments already carry the assignments. |
| S16 | EXPERIENCE §Key Flows headings L213, L225, L233, L243, L252, L261 | "Flow 1 — Daniel builds the Terminated Users procedure (UJ-1; Daniel Okonjo, IT Auditor, Monday morning)" | **CONDENSE headings; PRESERVE persona narrative.** "Flow 1 — Build the Terminated Users procedure (UJ-1)" with the persona line as the first sentence of the flow. (~30 words) | Persona is repeated in the heading and the steps; the flows themselves earn their length. |
| S17 | EXPERIENCE Flow 3 L241 | "Failure: he pauses to take a call → …" | **Relabel** "Alternate: …" (Flow 5 correctly uses "Failure: none"). | Pausing is not a failure path; the label pattern is otherwise consistent. |
| S18 | Rule "no free text reaches the agent" — DESIGN L247, L354; EXPERIENCE L22, L160, L193 | Five statements. | **PRESERVE** L160 (normative), L354 (Don't) and L193 (rationale); trim DESIGN L247's closing clause "and nothing that would let retrieved content or free text steer the agent" (already implied by "exactly the controls the PRD grants"). (~15 words) | Minor reinforcement overreach. |
| S19 | DESIGN §Typography L283 | 50-word single-sentence list of monospace uses. | **CONDENSE → bullet list** (word-neutral). Also the Do at L345 recaps it; fine as recap. | Scan-ability. |

**Structure summary.** 19 recommendations. Estimated reduction if all accepted: DESIGN.md ≈ 230 words (7%), EXPERIENCE.md ≈ 50 words (1%). No length target was provided. Comprehension trade-offs: S16 removes persona names from headings (kept in the body); S3 moves behavioral sentences a designer may like seeing beside the visual spec — the pointer sentence in each DESIGN paragraph preserves discoverability.

---

## Prose lens

Rows quote exact text; rewrites are the smallest change that achieves clarity. "Consider:" marks uncertain fixes.

### Critical

| # | Location | Original | Revised | Changes |
| --- | --- | --- | --- | --- |
| P1 | EXPERIENCE §Voice and Tone L59 | "domain nouns capitalized as defined terms (Run, Result, Evidence, Exception, Procedure Version, **System Outcome**, Auditor Review, Target System, Population Source)" | "domain nouns capitalized as defined terms — Run, Result, Result outcome, Evidence, Exception, Procedure Version, Auditor Review, Work Item, Session Step, Tool Action, Observation, Escalation, Target System, Population Source, and the other PRD glossary terms" | "System Outcome" appears once in both files and nowhere else (the family is "Result outcome", 7 uses). The list is presented as canonical yet omits Work Item, Session Step, Tool Action, Observation, Escalation, Structural Snapshot, Agent Workspace, Template, Schedule, Compliance Rule — all capitalized throughout. A developer naming enums from this list would be wrong. |

### High

| # | Location | Original | Revised | Changes |
| --- | --- | --- | --- | --- |
| P2 | DESIGN §Colors L277 | "rejection is a review event rendered in history, and the **Result's badge** returns to Draft with a 'returned to Draft' annotation." | "rejection is a review event rendered in history, and the **Auditor Review badge** returns to Draft with a 'returned to Draft' annotation." | The Result has an *outcome* badge (Pass / Control Failure); Draft is an Auditor Review state. As written it conflates two families the document exists to keep apart. |
| P3 | DESIGN §Brand & Style L247 | "pause, resume, cancel, answer a **typed** Escalation, flag to an Audit Manager" | "pause, resume, cancel, answer an Escalation from its closed answer set, flag to an Audit Manager" | "typed" reads as "typed in", contradicting the no-free-text rule in the same sentence; the intended sense is "of a defined kind". |
| P4 | DESIGN §Components L329; EXPERIENCE L77–79, L219 | DESIGN: "marks each condition *compiled* or *Agent-Judged* with the evaluation-origin badge". EXPERIENCE: "compiled/Agent-Judged badge", "uncompiled condition", "C1 marked compiled". Evaluation-origin family (DESIGN L266): Rule-Classified · Agent-Judged … | DESIGN L329: "marks each condition *compiled* (its evaluations will be Rule-Classified) or *Agent-Judged*, using the evaluation-origin badge with the word **Rule-Classified** or **Agent-Judged**". Consider: is the badge word on a condition "compiled" or "Rule-Classified"? | "compiled" (6 uses) and "Rule-Classified" (6 uses) name the same origin at two lifecycle moments; EXPERIENCE L67 requires badge text to be the state's exact name, and "compiled" is not a state in the family. |
| P5 | EXPERIENCE L111 vs L204, L231 | L111: "You cannot approve **your own version**." · L204/L231: "You cannot approve **a version you authored**." | Use "You cannot approve a version you authored." in all three places. | Two strings for one guard; a developer ships two. |
| P6 | DESIGN §Colors L253 vs L275 and frontmatter L51 | L253: "the audit domain has **three** states that are neither failure nor success but a person's turn." L275 lists four: Awaiting Auditor, Pending Confirmation, Agent-Judged pending, and a Work Item awaiting an Escalation answer. | "…has **four** states that are neither failure nor success but a person's turn." Update the frontmatter comment on `info-solid` (L51) to list all four. | Internal count contradiction in the paragraph that defines the treatment. |

### Medium

| # | Location | Original | Revised | Changes |
| --- | --- | --- | --- | --- |
| P7 | DESIGN §Components L333 | "**Confirmation dialog.** Two weights. Routine decisions (…) use a `{spacing.dialog}` modal that restates the consequence. Rejection, disagreement, 'Not an Exception', and rejecting an Agent-Judged evaluation additionally require a rationale field. Finalization is the heaviest … Abort from an Escalation uses the **cancel weight**." | "**Confirmation dialog.** Three weights. *Routine* (submit, approve, rerun, export, pause, answer an Escalation): a `{spacing.dialog}` modal that restates the consequence. *Routine with rationale* (reject, disagreement, 'Not an Exception', rejecting an Agent-Judged evaluation): the same modal with a required rationale field. *Finalization*: destructive primary button, a title naming irreversibility, and a body stating that Evidence, Exceptions, Results, and reviews become read-only. Consider: cancel and Escalation *abort* use the [routine / routine-with-rationale] weight?" | "Two weights" is followed by three tiers; "cancel weight" is named once and never defined (EXPERIENCE L76 says "the cancel confirmation", also undefined). Cancel is absent from every list. |
| P8 | EXPERIENCE §Per-surface states L120 | "Triptych: Queued · Not evaluated · **No conclusion**" | "Triptych: Queued · Not evaluated · No conclusion issued" | Badge text must be the state's exact name (L67); the outcome state is "No conclusion issued" (L97, DESIGN L264). |
| P9 | EXPERIENCE §State families L95 | "Paused and Awaiting Auditor show a countdown **(30 min, 4 h)** and what happens at timeout (Inconclusive)" | "Paused (30 min) and Awaiting Auditor (4 h) show a countdown and what happens at timeout (Inconclusive)" | Pairing is only recoverable from Flow 3; make it explicit. |
| P10 | EXPERIENCE §Component Patterns L71 | "Reject opens the rationale dialog **and requires Compliant · Exception · Unevaluated**." | "Reject opens the rationale dialog, which requires a rationale and a replacement value (Compliant · Exception · Unevaluated)." | The sentence omits what is required of whom; the replacement-value semantics are implicit. |
| P11 | DESIGN L266 (origin family: "Unevaluated"), L315, L317; EXPERIENCE L71 (×2), L95 | "Unevaluated" is a state of the *evaluation-origin* family (DESIGN L266, warning badge, `help-circle`) **and** a *value* on the evaluation card ("Compliant · Exception · Unevaluated"). | Consider: is Unevaluated an origin or a value? If a value, remove it from the origin family (an Unevaluated value still has an origin — Rule-Classified, Agent-Judged low-confidence, or Human-classified); if an origin, give the card's value list a different third word. Either way, add one sentence to DESIGN L317 stating which. | One word, two families; an architect will model it twice. Related: "Exception" is also both an object and an evaluation value — accepted PRD usage, but worth one clarifying clause. |
| P12 | DESIGN §Components L309 vs EXPERIENCE L68 | DESIGN: third cell carries "…the Result version in `{typography.mono}`" (always). EXPERIENCE: "sealed marker and Result version **once sealed**." | Align to one. Consider: since confirmation increments the Result version while unsealed (L71), DESIGN's "always shown" seems intended → EXPERIENCE L68: "…while unsealed; sealed marker once sealed; Result version always." | Same cell, two rules. |
| P13 | EXPERIENCE §Component Patterns L74 | "Collapsed to Work Items by default; Escalations, retries, errors, limits consumed, and version stamps expanded inline." | "Collapsed to Work Item rows by default, except that Escalations, retries, errors, limits consumed, and version stamps stay expanded inline." | "Collapsed … expanded" in one sentence without the exception being marked. |
| P14 | DESIGN §Components L305 | One 80-word sentence: "Inherited from the IntelliFin Design System bundle and used unchanged: Sidebar, Button (primary · … ), StatusBadge (…), Banner, EnvironmentRibbon, EmptyState, Tabs (…), Icon (Lucide subset, self-hosted at …; this document adds `pause`, `play`, … to the subset)." | Break into a short list, one inherited component per line, with the icon additions as their own line: "Icon — Lucide subset, self-hosted at `claude/mockups/assets/lucide-icons.js`. Added by this document: pause, play, user, braces, cpu, help-circle, shield, bell, flag, archive, search-x." | Nested parentheticals inside a list inside a sentence. Word-neutral. |

### Low

| # | Location | Original | Revised | Changes |
| --- | --- | --- | --- | --- |
| P15 | DESIGN §Brand & Style L241 | "every token above that is not audit-specific is the parent system's value **restated for resolution**." | "every token above that is not audit-specific is the parent system's value, restated so that `{…}` references in this document resolve without the parent bundle." | "for resolution" is opaque on first read. |
| P16 | DESIGN §Brand & Style L247 | "The session is **still** evidence-first" | "The session is evidence-first" | "still" has no antecedent. |
| P17 | DESIGN §Typography L281 | "the roles above **name where each size lives**." | "the role names above (page-title, card-title, row-title …) indicate where each size lives." | The typography block carries no usage comments (the colour block does); only the names carry that information. |
| P18 | EXPERIENCE L80, L94, L112, L229 vs L83, L129, L142 | "regression Run" (4) vs "Regression Run" (3) | "Regression Run" throughout, per the defined-term rule at L59. | Capitalization drift on a defined term. |
| P19 | DESIGN §Components L315 | "Excluded, **uninspected**, and Unevaluated counts are always present." | "Excluded, Uninspected, and Unevaluated counts are always present." | Uninspected is a Work Item state (capitalized 4× elsewhere). |
| P20 | Both files | UK: "colour" (11), "labelled" (7), "optimised" (1) — US: "Canceled" (6), "Finalized", "normalized", "sanitized", "color" in token names. | Pick one dialect for prose (state names such as Canceled and Finalized are fixed identifiers and stay). Consider: US, since the identifiers are US. | Mixed dialect within sentences ("sanitized … labelled"). |
| P21 | EXPERIENCE §Information Architecture L42 | "Run Detail, Exception Detail, Live View, and Replay **highlight** Runs; Builder, Procedure Detail, and Version review highlight Procedures." | "…keep the **Runs** sidebar item highlighted; … keep **Procedures** highlighted." | "highlight" without an object is ambiguous (highlight what?). |
| P22 | EXPERIENCE Flow 4 L246 | "Two Escalations would have notified Daniel and Maya by email; none is raised." | "No Escalation is raised; had one been, Daniel and Maya would have been emailed." | Counterfactual with a stray specific count ("Two"). |
| P23 | EXPERIENCE §Component Patterns L80 | "approver identity blocked from self-approval with a stated reason" | "the author cannot approve their own version, and the reason is stated" | Noun-stack. |
| P24 | EXPERIENCE §Component Patterns L83 | "Search matches identifier, Procedure, initiator. Clearing filters resets **all three**." | Consider: "Clear filters resets the three filters and the search." | Search is a fourth control; "all three" is ambiguous. |
| P25 | DESIGN L247, L309, L325, L327; EXPERIENCE L155, L172 | Bare "Step" ("every Step is narrated", "Step counter", "Step scrubber", "Step rows", "Step narration") alongside the defined terms Session Step, Plan Step, Step Execution. | Consider: define once in DESIGN §Brand & Style — "'Step' unqualified means Session Step" (or Plan Step, whichever is intended) — or qualify each use. | Three defined "Step" nouns exist; the bare word is ambiguous in the session viewer spec. |
| P26 | EXPERIENCE L129 "confirmation script"; L83 "Regression" as a status chip | Terms used once, undefined. | Consider: "confirmation script (the golden expectation's answer list)" or reference the PRD section; "Regression" chip → "Regression Run". | Hapax terms confuse a reader hunting for a definition. |
| P27 | EXPERIENCE §Responsive & Platform L181 | "Live View **supervised**." | "Live View controls available." | Elliptical; parallel to L182 "Live View read-only". |

**Prose summary.** 27 rows (1 critical, 5 high, 8 medium, 13 low). Rows P1–P6 change meaning a developer would act on; the rest are clarity. No further minor fixes withheld.

---

## Terminology inconsistency table

Counts are exact (`grep -o`) across DESIGN.md / EXPERIENCE.md.

| Concept | Name A (count D/E) | Name B (count D/E) | Recommendation |
| --- | --- | --- | --- |
| Result outcome family | "Result outcome" (6/1) | "System Outcome" (0/1) | Use "Result outcome"; delete "System Outcome" (P1). |
| Rule-based evaluation origin | "Rule-Classified" (2/4) | "compiled" / "uncompiled" (1/6) | Keep both but define the relation once: a *compiled* condition yields *Rule-Classified* evaluations; badge word is one of the family names (P4). |
| Regression run | "Regression Run" (0/3) | "regression Run" (0/4), "Regression" as chip (0/1) | "Regression Run" everywhere (P18). |
| Self-approval guard copy | "You cannot approve a version you authored." (0/2) | "You cannot approve your own version." (0/1) | One string (P5). |
| Null outcome badge | "No conclusion issued" (1/1) | "No conclusion" (0/2 additional) | Exact badge name in Per-surface states (P8). |
| Work Item not inspected | "Uninspected" (1/3) | "uninspected" (1/0) | Capitalize (P19). |
| Agent execution environment | "Agent Workspace" (2/1) | "workspace" (1/4), "Workspace Provider" (0/2) | Acceptable short form; consider "Agent Workspace" on first use per section. |
| Timeline | "Execution Timeline" (2/4) | "Timeline" (4/9) | Acceptable short form; no action. |
| Gate | "Evidence Quality Gate" (6/2) | "Gate" (9/11) | Acceptable short form; no action. |
| "Unevaluated" | origin-family state (DESIGN L266) | evaluation-card value (DESIGN L317, EXPERIENCE L71) | Decide which; one word, two families (P11). |
| Confirmation weight for cancel | "cancel weight" (1/0) | "cancel confirmation" (0/1) | Neither defined; fold into the weights list (P7). |
| Session viewer awaiting state | "AWAITING" chrome word (1/1) | no `awaiting-dot` token | Add token or state reuse (S8). |
| Count of state families | "seven" (DESIGN L4, L243) | seven rows, different set (EXPERIENCE L92–100) | Reconcile to eight or state the omission (S2). |
| Reading-mode threshold | "Below 900px" (DESIGN L293) | "900–1023px Reading mode" (EXPERIENCE L182) | One number (S1). |
| Dialect | colour / labelled / optimised (UK: 7+4 / 4+3 / 1) | Canceled / Finalized / sanitized (US) | One dialect for prose (P20). |

## Cross-file duplication register

| Rule / content | DESIGN.md | EXPERIENCE.md | Disposition |
| --- | --- | --- | --- |
| Confirmation dialog weights and rationale list | L333 | L82 | Behavior → EXPERIENCE; DESIGN keeps visuals (S3) |
| Empty-state rule | L335 | L85 (+ L22, L351) | CUT from DESIGN (S3) |
| Disabled action keeps position, visible reason | L331, L346, L356 | L56, L81, L145, L151 | Canonical L81 (S11) |
| Rail card list | L291 | L86 | Canonical L86 (S6) |
| Breakpoint behavior | L293 | L178–183 | Canonical EXPERIENCE table after S1 is decided |
| Session viewer controls | L327 | L75, L131–136 | Acceptable: DESIGN = chrome/layout, EXPERIENCE = state rows; trim only the control list from L327 if desired |
| Live View latency | — | L131, L147, L158 | Canonical L158 (S14) |
| No free text to the agent | L247, L354 | L22, L160, L193 | PRESERVE with one trim (S18) |
| Execution-failure panel contents | L272 | L127 | Acceptable: consistent, one visual, one state row |

## What was not flagged (PRESERVE)

- Do's and Don'ts (DESIGN) as a recap of rules stated earlier — reinforcement, not redundancy.
- The Per-surface states table (960 words) — the right shape for a 44-row reference.
- Key Flows narrative with personas — the only place the surfaces are shown in sequence.
- Frontmatter token blocks (630 words in DESIGN) — machine-readable contract.
- Roles and Action Gating as an invented section — placed correctly before Key Flows; its mixed "✓ / — reason" cells are dense but unambiguous.
