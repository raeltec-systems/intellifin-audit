---
title: "Preservation validation — SPEC IntelliFin Audit"
spec: SPEC.md
verdict: needs-revision
gaps:
  high: 0
  medium: 4
  low: 12
sources_walked:
  - prd.md (revision 2) — FR-1..50, NFR-1..15, §1.1 principles, §1.2 trust seam, §6, §7, §8.3, §9, §11, §12
  - brief.md — principles, PoC success criteria, MVP boundary
preserved_in:
  - SPEC.md
  - glossary.md
  - addendum.md (adopted)
  - ARCHITECTURE-SPINE.md (adopted)
  - DESIGN.md (adopted)
  - EXPERIENCE.md (adopted)
created: 2026-09-01
---

# Preservation validation — SPEC IntelliFin Audit

Read-only pass over PRD revision 2 and the product brief, both claimed fully absorbed. Every load-bearing claim is traced to SPEC.md (CAP/section), glossary.md, or an adopted companion. Gaps are claims that landed nowhere downstream will read. Verdict is **needs-revision** on the strength of four medium gaps — each is a one-line fix; no high gap was found, so no builder would ship the wrong thing from this contract as it stands.

Landing codes: **S** = SPEC.md, **G** = glossary.md, **A** = addendum.md, **AD** = ARCHITECTURE-SPINE.md, **D** = DESIGN.md, **E** = EXPERIENCE.md.

## 1. Product principles and trust seam (PRD §1.1, §1.2; brief principles)

| Claim | Landed |
| --- | --- |
| P1 No conclusion without sufficient evidence | S Why ("must never yield a Pass"), S Constraint 1, CAP-10 success, Success signal |
| P2 Reproducibility over theatrical autonomy | CAP-8, CAP-14, Success signal guard "no autonomy theater" |
| P3 Human accountability in the workflow | CAP-3, CAP-11, CAP-13, S Constraint 2 |
| P4 Read-only, least privilege | CAP-1, S Constraint 3, S Non-goal (write access) |
| P5 Agent uncertainty visible | CAP-7, CAP-10, S Constraint 2, guard "no silent agent judgment" |
| Trust seam: grounded not asserted; absence proven; every condition per record; unnamed → Unevaluated | S Constraint 1 verbatim; CAP-9, CAP-10, CAP-11; A §B, §B.1, §H; AD-6 |
| Object chain Control → Procedure → Run → Workspace → Evidence → Review | S Why; E Foundation |

Gap L1: the five principles are absorbed as content but not as the named **tie-break rules** the PRD makes them ("tie-break rules for every downstream decision"). A downstream skill resolving a conflict has no principle list to cite.

## 2. Functional requirements FR-1..FR-50

| FR | Claim and testable consequences | Landed |
| --- | --- | --- |
| FR-1 | Sign-in, role-limited; unauthenticated reach nothing | CAP-1 success |
| FR-1 | Successful and failed authentication events recorded | AD-22 (authentication events chain on `platform`), AD-10 — gap L11 (failed-auth not explicit) |
| FR-2 | Three roles; Auditor / Audit Manager / PoC Administrator action sets; no self-approval; admin cannot alter Evidence, no extraordinary path | CAP-1 intent, CAP-3 success, CAP-15 intent; E Roles and Action Gating; AD-7; G |
| FR-2 | `[ASSUMPTION]` Audit Manager may confirm, submit, and approve the same Result | S Assumptions; E |
| FR-3 | Allowlisted read ops only; writes, out-of-scope origins, injected content denied and logged; write-capable credential unregistrable | CAP-1 success; S Constraint 4; AD-4, AD-9; E Flow 0 failure |
| FR-3 | Out-of-scope **parameters** (search outside declared population) and arbitrary code/shell outside the sandbox denied and logged | **Gap M1** |
| FR-4 | Four Templates by name; pre-populate every section with §C defaults; hero fully configurable, others assumed partially | A §C P-1..P-4; E Builder re-derivation; S Assumptions; CAP-2 |
| FR-4 | Procedure names the Control it verifies | D Builder ("Template and Control"), G Control — gap L4 (CAP-2 intent omits) |
| FR-4 | `[NOTE FOR PM]` stretch: re-author one non-hero Template | Dropped (recommendation, not requirement) — on record §7 |
| FR-5 | Explicit date range; scheduled period derived and recorded | CAP-4 intent; A §B; AD-19 |
| FR-5 | Scope statement verbatim on version and shown in every Result | AD Versioning freezes scope; A §F bundle — gap L5 ("shown in every Result") |
| FR-6 | Three binding kinds; upload only for `once`; binding frozen not snapshot; digest/generation/declared count per Run; snapshot is initial Evidence; deterministic parser is population of record; structured inclusion rule; declared-count mechanism required; empty population → Inconclusive unless opt-in | CAP-2 intent; G Population Source; A §A.1, §H; AD-5, AD-18, AD-23; E Builder validation |
| FR-7 | Only registered read-only Target Systems; four kinds; ≥1 web + ≥1 desktop; version records kind/origins/credential ref/actions/digest/label patterns; explicit discovery | CAP-2, CAP-5 intent; G Target System; A §A.2; AD-2 (digest tuple), AD-18; S Constraint 5 |
| FR-8 | Instructions verbatim on version; shown in plan and Bundle; scope-widening flagged 100% at authoring, denied at execution as security event | CAP-2 success; AD-23, AD-3; A §D; E Flow 1 — gap L6 (Live View/Replay display) |
| FR-9 | Compile vs uncompiled shown; applicability predicate (default `found = true`) derived by builder, agent never decides; derivation order Exception → Unevaluated → Compliant; missing Agent-Judged evaluation = Gate failure; unnamed value Unevaluated with diagnostic; explicit boundary semantics; tolerance compiled; P-3 USD 100,000 boundary; materiality suppression non-goal; unmatched/ambiguous/uninspected/uncorroborated never Compliant | CAP-2, CAP-10, CAP-11; S Constraint 1; S Non-goals; A §B, §B.1, §C P-3, §H; AD-6, AD-23; E Compliance Rule editor |
| FR-10 | Five Evidence Requirement types; snapshot + screenshot always for agent-driven; grounding never into screenshot; identity attribute on `found = true`; platform captures, agent does not choose; missing required Evidence → not Compliant | CAP-9, CAP-10; AD-5 artifact kinds, AD-18; A §B.1 |
| FR-11 | once/daily/weekly/monthly; activates on approval (+ regression); UTC fixed start | G Schedule; CAP-3; AD-19; S Assumptions |
| FR-12 | Plan contents; readable without code; frozen at approval; not directly editable; re-derivation recorded; underivable blocks submission; model may derive, identity recorded | CAP-2; G Executable plan; AD-23; E Plan preview, Builder re-derivation; S Assumptions |
| FR-13 | Non-author Audit Manager approves/rejects; approval freezes all listed fields; rejection → Rejected with rationale, edit → Draft; approver, time, diff recorded | CAP-3; AD-2; A §E; E Version review, state families |
| FR-14 | Run retains version; any change or platform-side change mints (platform-authored) draft; prior Schedule active until successor Active + regression; handover at period boundary, no double/skip; in-flight complete on own version | CAP-3; AD-2, AD-19 (`handover_at`); E Procedure Detail states |
| FR-15 | Regression Run: Approved-not-Active, golden Source substituted, exempt from overlap, labeled; approver confirms from script; every expected terminal outcome reproduced except §D exemptions; mismatch blocks; recorded on version; counted in FR-50 | CAP-3, CAP-16; AD-19, AD-12; A §D; E Version review states |
| FR-16 | No overlapping active Run for version + period; unique correlation id; initiator recorded | AD-3 (unique on Procedure + period, stricter), AD-10; CAP-4 |
| FR-17 | Schedule as initiator, derived period; missed start recorded, never skipped; ≥1 unattended Run in acceptance | CAP-4 success; AD-19; E Runs states |
| FR-18 | Eight states; platform failure vs Control Failure vs waiting distinguishable; every transition records time/actor/reason/prior state | CAP-4; D three load-bearing distinctions; AD-7 |
| FR-19 | Fresh workspace per Run with agent Steps; adapter-only needs none, Live View shows Adapter Steps; no persistence; allowlisted egress only; creation failure → Run Failed | CAP-5; AD-4, AD-16 (reaping); A §H row 1; E Live View adapter-only |
| FR-20 | Per-Target-System ordering, sign-in once as Session Step; Step/Tool Action start-end-outcome on Timeline; credentials JIT and never in Timeline/Evidence/logs/exports; per-Observation Gate + evaluator at registration; no Observation → Uninspected; stop-and-report never guess; last Work Item → Run-level Gate → Completed/Inconclusive | CAP-5, CAP-10; AD-3, AD-4, AD-6; A §C P-1, §E; G Session Step, Uninspected — gap L9 (ordering stated only for P-1) |
| FR-21 | Adapters: same schema, grounding, declared counts, digests, same Gate; batch Work Items; adding a kind is Adapter-level only | CAP-5 intent and success (SM-8); AD-4, AD-18; A §C coverage rules |
| FR-22 | Work Item definition; per-record coverage over Observations; model not assuming one Run = one worker; parallel non-goal | G Work Item; CAP-10; S Constraint 5; S Non-goals; AD-18 |
| FR-23 | Limits (retries/Step, Run-level Step count, time, tokens); tools, model, prompt recorded per Run; unchangeable by content; exhaustion → Escalation/Inconclusive/Run Failed never fabricated; fabricated = uncorroboratable; retrieved content inert | CAP-5; S Constraint 4; AD-3 mapping, AD-9; A §E.1 |
| FR-24 | Live View contents; 5 s; closing has no effect | CAP-6; E Live View states; AD-17 |
| FR-25 | Pause at Tool Action boundary; 30 min timeout → Inconclusive, Evidence preserved; actor/time/Step recorded | CAP-6 success; S Assumptions; AD-16; E |
| FR-26 | Cancel any active state; Evidence preserved; Canceled reserved for human; rerun is linked new Run | CAP-6 intent; A §E; AD-3 ("Rerun always creates a linked new Run"); E Rail cards |
| FR-27 | Three kinds with closed answer sets; platform resolves unique grounded row; pick only by declared secondary key, flagged human-matched everywhere; abort → Canceled with reason; Awaiting Auditor; notes never reach agent; question labeled agent-generated, inert; answer scoped to Run, in Timeline and Bundle; no answer classifies; 4 h timeout, workspace preserved; flag notifies Audit Managers, no execution effect | CAP-7; A §B, §E, §F; AD-9, AD-16, AD-20; D Escalation panel; E Escalation panel; S Assumptions |
| FR-28 | Initiating Auditor (or author for scheduled) + every Audit Manager; in-app and email; each delivery/failure on Audit Trail; content names Procedure, Run, kind, time remaining; no Evidence/secrets | CAP-7 success; AD-20; E Notification row |
| FR-29 | Timeline contents incl. sanitized Tool Actions, rationales, limits, versions; written as events occur; authoritative; provider recording supplementary; no secrets | CAP-8; A §F; AD-3, AD-17 |
| FR-30 | Replay from platform-owned asset set; jumps; works with provider blocked and after retention; never re-executes | CAP-8 success; A §F asset set; AD-9, AD-12; E Replay |
| FR-31 | Evidence item fields; Observation → Evidence + grounding; originals retained; Absence Observation per §B.1 | CAP-9; D Evidence item card; A §B.1; AD-5; E |
| FR-32 | Package per Run; full trace; survives Source/Target changes and provider retention expiry | CAP-9 success (SM-6); CAP-8 success; AD-11 |
| FR-33 | All §H checks; per-Observation at registration, Run-level at end; corroboration rule (value, label, identity; contradictory → Unevaluated → Inconclusive; stored snapshot only; model-read declared); exact file-level counts, inclusion-level rows in/included/excluded; visible outcome + diagnostic | CAP-10; A §B.1, §H; AD-6; D Gate checklist |
| FR-34 | Inconclusive vs Run Failed; neither a conclusion; Work Item failure continues → coverage Inconclusive; Session Step failure/denied action → Run Failed; Result names affected systems/checks/items | CAP-10; A §E, §E.1; D; E Run Detail states |
| FR-35 | No user/admin alteration; mismatch during Run → Run Failed, after → trail event + flag, no state change; corrections need new Run | CAP-9 success; A §H Integrity; AD-5 |
| FR-36 | Normalize with originals and transformation history; exact-key matching; UTC + source offset; unmatched/multi-matched visible, never Compliant | A §B, §F; AD-6, AD-14 provenance graph; E Formats |
| FR-37 | Deterministic identical evaluations; no human override; per condition not per record | CAP-11 success; AD-6 |
| FR-38 | Agent-Judged with rationale, Evidence, confidence [0,1]; excluded until confirmed; Pending Confirmation unsealed; reject sets value with rationale as human-classified, history retained; visibly distinguished; low-confidence → Unevaluated, no confirmation | CAP-11; S Assumptions; AD-6, AD-21; D evaluation origin family; E Evaluation confirmation |
| FR-39 | Result reports population, exclusions, inspected/uninspected per system, per-condition counts by origin and confirmation, Template fields; never count excluded/uninspected/Unevaluated as Compliant | A §C, §F; D Population reconciliation; CAP-10 |
| FR-40 | Six outcomes distinct; Pending Confirmation precedence; Pass conditions; Result version increments; sealed outcome immutable; rejection → Unevaluated → Completed→Inconclusive at sealing | CAP-11; A §E, §E.1; AD-21; D triptych; E |
| FR-40 | Gate pass necessary, not sufficient; Auditor judges sufficiency (§2.2 floor/ceiling) | D ribbon copy ("Results are not assurance conclusions") — gap L7 |
| FR-41 | Exception detail contents; stable id and cross-version fingerprint; sensitive fields masked in lists | CAP-12; A §B compatibility; AD-6 HMAC; AD-7 masking; E |
| FR-42 | Assign, note, four states; Not an Exception needs rationale, retains evaluation and outcome; changes keep actor/time/prior/rationale | CAP-12; A §E; AD-7; E Exception Detail states |
| FR-43 | Submit sealed only; blocked for unsealed/Inconclusive/Run Failed/Canceled; finalization record; nothing overwritten; direct finalization and post-finalization mutation denied and logged | CAP-13; A §E review states; AD-7, AD-22; E |
| FR-44 | Disagreement with rationale only; no override; in Audit Trail and Bundle | CAP-13 intent; A §F; AD-10 |
| FR-45 | Event families; actor/type/time/source/outcome/correlation; mutation detectable | CAP-14; AD-10, AD-22 |
| FR-46 | Bundle for any terminal Run incl. Inconclusive/Run Failed; §F contents; manifest; readable without code | CAP-14; A §F; AD-5 layout |
| FR-47 | Reproduce Rule-Classified, re-examine Agent-Judged; stored snapshots only; no live system or provider | CAP-14; A §B.1 |
| FR-48 | Filters; separate labels for Control Failure / Pending Confirmation / Awaiting Auditor / failures; NFR-7 bound without reload | CAP-15; E Filter bar; AD-17 |
| FR-49 | Diagnostics without secrets; link to Run and correlation id; cannot alter Result | CAP-15; AD-10 |
| FR-50 | Measures list; hero target zero code; no production telemetry needed | CAP-16; AD-13 |
| FR-50 | Definition of procedure-specific code (references a Template, Control, or Target System by identity; synthetic systems and golden datasets are fixtures) | **Gap M2** |

## 3. Non-functional requirements NFR-1..NFR-15

| NFR | Landed |
| --- | --- |
| NFR-1 Security | Credential redaction: CAP-5 success, AD-10; at-rest encryption: AD-11 (Railway); in transit: AD-11 diagram only. Secrets outside application data and **cross-user / cross-Run leakage negative tests** — **Gap M4** |
| NFR-2 Agent safety | CAP-1 success (SM-10); S Constraint 4; A §D injection seeds; AD-12 |
| NFR-3 Integrity | CAP-14 success; AD-22 |
| NFR-4 Determinism / re-examinability | CAP-11 success; CAP-14 intent |
| NFR-5 Workspace isolation, negative tests | CAP-5 success; AD-16 reaping; AD-11 separate processes |
| NFR-6 Performance envelope; golden ≤ 20 records | S Constraint 7; AD acceptance envelope; A §D |
| NFR-7 Live 5 s; 2 s at 5 users | S Constraint 7; E Interaction primitives; AD-17 |
| NFR-8 ≤3 bounded retries, no duplicates, outcome mapping | AD-3; A §E.1 |
| NFR-9 Schedule within 5 min; restart-safe | S Constraint 7; AD-19 |
| NFR-10 Backup/RPO/RTO/restore drill | S Constraint 7; AD-11 |
| NFR-11 WCAG 2.1 AA, keyboard | S Constraint 7; E Accessibility floor; AD-12 |
| NFR-12 Observability per Run | CAP-15 intent; AD-10 — gap L10 (per-Step / per-Target-System latency, Work Item counts and states not enumerated) |
| NFR-13 Synthetic data only, incl. recordings | S Constraint 3 |
| NFR-14 Retention for PoC life; Replay independent of provider | S Assumptions; AD-11; CAP-8 success |
| NFR-15 Runner portability; one Adapter contract | S Constraint 9; AD-4, AD-11, AD-18; S Non-goals (customer-hosted) |

## 4. §6 constraints, §7 non-goals, §8.3 deferred

| PRD item | Landed |
| --- | --- |
| §6 web app + background Runners in isolated workspaces | AD paradigm; CAP-5 |
| §6 read-only, synthetic | S Constraint 3 |
| §6 Rule-Classified authoritative; Agent-Judged flagged and confirmed; every condition evaluated | S Constraints 1–2 |
| §6 grounded, corroborated, absence proven, unnamed Unevaluated | S Constraint 1 |
| §6 one agent sequential, not permanent; Auditor names systems | S Constraint 5 |
| §6 reusable contracts not hardcoded into screens; execution/workspace/Evidence contracts not bound to hosting boundary | AD-1, AD-2, AD-11; S Constraints 6, 9 |
| §6 favor truthful Inconclusive/Escalation/Run Failed over apparent completion | S Why; Success signal guards |
| §7 all eight non-goals | S Non-goals 1–8, one to one |
| §8.3 deferred: agent scope, conversational authoring, parallel Work Items, finding-triggered escalation, documents as Sources, control packs, materiality suppression, confirm/approve separation, SSO, customer-hosted | S Non-goals 9; AD Deferred |
| §8.3 deferred: continuous monitoring/alerts/trends, default Exception ownership and reviewers, cross-Run aggregation beyond fingerprints, platform-assurance evidence pack, design-partner integrations, commercial-scale performance/availability/certification | gap L3 (not listed; S Non-goals 9 cites "PRD §8.3", a source downstream does not read) |

## 5. §9 success metrics and counter-metrics

| Metric | Landed |
| --- | --- |
| SM-1 delegation without developer | CAP-2 success; Success signal |
| SM-2 observable execution | CAP-6 success |
| SM-3 unattended scheduled Run | CAP-4 success |
| SM-4 identical terminal outcomes twice; expected records identified | CAP-11 success; Success signal; AD-19 comparison |
| SM-4 identical **Rule-Classified counts**, Observation differences explained, Agent-Judged correct-or-Unevaluated and never confidently wrong across the golden set | **Gap M3** (A §D states the confidently-wrong rule for the hero ambiguous record only) |
| SM-5 safe evidence failure | CAP-10 success |
| SM-6 lineage and Replay | CAP-9 success; CAP-8 success |
| SM-7 reproducibility per Procedure | CAP-14 success |
| SM-8 generalization | CAP-5 success; CAP-16 |
| SM-9 review completeness | CAP-13 success |
| SM-10 scope enforcement | CAP-1 success |
| SM-11 implementation baseline | CAP-16 success |
| SM-C1..C4 | Success signal guards (four clauses, one per counter-metric); CAP-11 success ("unconfirmed or Unevaluated condition never yields a Pass") |

## 6. §11 open questions and §12 assumptions

All nine PRD open questions are present in S Open Questions (Q4 merged with the spine's desktop control-tree question, owners retained). All thirteen §12 assumptions are present: FR-2, FR-4, FR-11, FR-12, FR-24/NFR-7, FR-25, FR-27 (incl. workspace preserved for the full timeout via AD-16 lease), FR-38 in S Assumptions; NFR-6, NFR-10 in S Constraint 7; NFR-14, NFR-15 in S Assumptions / Constraint 9; §2.3 journeys → E Flows 1–6; addendum inline tags → adopted.

## 7. Brief: principles, PoC success criteria, MVP boundary

| Brief claim | Landed |
| --- | --- |
| Five principles | identical to PRD §1.1 (see §1 above; gap L1 applies) |
| SC-1 all four procedures run through auditor review on known datasets | CAP-5 success (SM-8), CAP-14 success (SM-7 per Procedure) — gap L12 (review completion for all four not stated) |
| SC-2 expected exceptions and compliant cases, no unexplained differences | CAP-11 success (SM-4) — see gap M3 |
| SC-3 every result traceable | CAP-9 success (SM-6) |
| SC-4 bad evidence → explicit inconclusive/error, never false pass | CAP-10 success (SM-5); Success signal |
| SC-5 auditor reviews, reproduces, approves/rejects without code | CAP-13, CAP-14 (SM-7) |
| SC-6 components reused; reruns consistent | CAP-5 success, CAP-11 success, CAP-16 |
| MVP boundary (commercial release inclusions) | Deliberately dropped — describes the first commercial release, not the PoC; its exclusions list is mirrored by S Non-goals 1–8 and its inclusions by §8.3 deferred items |
| Brief `[ASSUMPTION]` desktop demonstrated only after evidence model validated | Superseded by PRD rev 2 (LedgerDesk in PoC); sequencing survives as AD-4 (snapshot agent is a prerequisite for Rule-Classified desktop conditions) |

## 8. Gaps

### Medium (a test or verification step would be missing)

- **M1 — FR-3 parameter and shell scope.** "Out-of-scope parameters (for example a search outside the declared population)" and "arbitrary code or shell execution outside the Agent Workspace sandbox" are denied and logged in the PRD. CAP-1 success covers writes, destinations, credential disclosure, and injected tool use; AD-4/AD-9 conformance contracts cover origins, read-only actions, redirects, downloads. Parameter scope and sandbox-escape are named nowhere. Fix: add both to CAP-1 success.
- **M2 — FR-50 definition of procedure-specific code.** "Code that references a Template, Control, or Target System by identity; synthetic Target Systems and golden datasets are test fixtures, not procedure-specific code." CAP-16 and AD-13 record the measure and the zero target but not the definition, so the hero's "zero" is unmeasurable and SM-C3 unverifiable. Fix: one sentence in CAP-16 or glossary.md.
- **M3 — SM-4 consistency beyond terminal outcome.** PRD requires two consecutive golden Runs to yield identical terminal outcomes **and identical Rule-Classified counts**, with any Observation difference explained, and every Agent-Judged evaluation in the golden set correct or Unevaluated, none confidently wrong. CAP-11 success carries only identical terminal outcomes; A §D carries the confidently-wrong rule for the hero's ambiguous record only. Fix: extend CAP-11 success.
- **M4 — NFR-1 security baseline.** Encryption in transit and at rest, secrets stored outside application data, and automated tests denying cross-user or cross-Run data leakage have no SPEC constraint. AD-10 covers log redaction, AD-11 covers Railway at-rest encryption and an HTTPS diagram; the leakage negative test lands nowhere. Fix: add an NFR-1 line to S Constraints (next to the acceptance envelope).

### Low (naming or traceability)

- **L1** Principles absorbed as content, not as the named tie-break list (PRD §1.1 / brief).
- **L2** glossary.md lacks *Golden dataset* (used in CAP-3, CAP-11, Success signal; defined only by A §D's requirements) and *Procedure Builder (Builder)* (used throughout).
- **L3** S Non-goals 9 omits the §8.3 items listed in §4 above and cites "PRD §8.3", a source downstream does not read.
- **L4** FR-4 "name the Control it verifies" absent from CAP-2 intent (present in D Builder and G Control).
- **L5** FR-5 scope statement "shown in every Result" — frozen (AD Versioning) and exported (A §F) but not shown on the Result surface (E triptych/rail).
- **L6** FR-8 Audit Instructions displayed in Live View and Replay (plan and Bundle are covered).
- **L7** FR-40 / §2.2 "Gate pass is necessary, not sufficient; the Auditor judges sufficiency" survives only as ribbon copy in D.
- **L8** §2.1 management-monitoring vs independent-assurance distinction (control-owner-initiated Runs are not assurance) survives only as E's CAE non-goal.
- **L9** FR-20 execution ordering (all records per Target System; sign-in once per Target System) stated for P-1 only (A §C); generic rule rests on the frozen plan (AD-3).
- **L10** NFR-12 per-Step and per-Target-System latency and Work Item counts/states per Run not enumerated (CAP-15 lists durations, retries, limits, errors; AD-10 says "latency").
- **L11** FR-1 failed-authentication events recorded — AD-22 names authentication events generically.
- **L12** Brief SC-1 "through auditor review" for all four Procedures — SM-7/SM-8 cover execution and bundle per Procedure; a completed review for each non-hero Template is not required anywhere.

## 9. Wrapper content deliberately dropped (on record)

PRD: §0 document purpose, revision notice, and the `[NOTE FOR PM]` that the spine and UX handoff needed re-derivation (resolved — both companions are revision-2 finals); §1 positioning prose ("not RPA with an audit label", differentiation statement); §2.1 economic buyer and stakeholder prose; §2.2 jobs-to-be-done narrative; §2.3 journey narrative color (personas and beats survive in E Flows 1–6); per-section "Description … Realizes UJ-n" mapping; FR-4 `[NOTE FOR PM]` stretch acceptance case; §4.5 `[NOTE FOR PM]` on Solari neutrality (decided: CAP-8 platform-owned Replay assets); §8.1 in-scope list and the sixteen-item P0 capability map (superseded by CAP-1..16); §8.2 maturity paths table; §10 risks and mitigations (every mitigation is an FR already traced; "exception fatigue accepted because populations are small" is the only judgment dropped); addendum §G standards basis, §I migration map, §J rationale (adopted with the addendum anyway).

Brief: executive summary, problem and opportunity, users and buyer, eight-step product proposition, differentiation, first-PoC narrative, MVP boundary (commercial release scope, see §7), key product and commercial risks, PRD handoff decisions (all resolved by the PRD), vision statement, and the design-partner assumptions.

## 10. Spec Law coherence

| Rule | Result |
| --- | --- |
| Every CAP has intent and success | Pass — CAP-1..16 each carry both |
| Intents are WHAT not HOW | Pass with two notes: CAP-14 "hash-chained" and CAP-8 "platform-owned Replay asset set" name mechanisms, but both are PRD-level product commitments (NFR-3, FR-30) rather than spine choices; acceptable |
| Each constraint rules something out | Pass — nine constraints each exclude a behavior, envelope breach, UI pattern, or stack drift |
| At least one non-goal | Pass — nine |
| Success signal testable | Pass — names the hero, the approval, the live/paused/escalated/resumed Run, the unattended Run, two golden passes, 100% seeded bad-evidence cases, and one offline reproduction |
| CAP IDs unique | Pass — CAP-1..CAP-16, no duplicates |

Additional coherence note: S Non-goals 9 and the sources banner both point readers at the PRD for detail, which contradicts the banner's own claim that the contract is complete (see L3).
