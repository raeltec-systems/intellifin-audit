---
title: "Reconciliation — Architecture Spine revision 2 against its load-bearing inputs"
inputs:
  - ../ARCHITECTURE-SPINE.md (revision 2, draft)
  - ../../../prds/prd-IntelliFin Audit-2026-08-31/prd.md (revision 2, final) — §1, §1.2, §4 FR-1..FR-50, §5 NFR-1..15, §6, §8.1
  - ../../../prds/prd-IntelliFin Audit-2026-08-31/addendum.md — §B, §B.1, §E, §E.1, §F, §H
  - ../../../ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md — Information Architecture, Component Patterns, State Patterns, Interaction Primitives
  - ../../../ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md — Components frontmatter and prose
created: 2026-09-01
status: complete
summary: "6 high, 17 medium, 18 low gaps; 11 contradictions (3 high, 5 medium, 3 low)"
---

# Reconciliation — Spine rev 2 vs PRD rev 2, addendum, EXPERIENCE.md, DESIGN.md

Read-only review. Each row is something an architecture unit could build wrongly because the spine does not bind it, or a place where the spine and an input disagree. Severity is downstream build risk, not document importance.

## Covered

The spine lands the revision-2 execution model: per-Observation Gate checks and deterministic evaluation at registration (AD-3, AD-6), two acquisition paths on one Observation contract (AD-4, AD-18), durable waits as Run states (AD-16), the Timeline as the single live source with SSE fan-out including the 5-second freshness and 15-second stale indicator (AD-17, Live channel row), sealed and signed Evidence with Workpaper Bundle export for any terminal Run (AD-5, FR-46), Schedules as application data with period-boundary handover (AD-19), Escalation notifications (AD-20), the Procedure Version / Run / Work Item (with `AWAITING`) / Review / Exception state machines matching addendum §E, the Result-rejection-as-event rule, the "free text never reaches the agent" guarantee (AD-7, AD-9), the four addendum §D adversarial seeds it names (AD-12), and the PoC acceptance envelope (NFR-6..NFR-11).

## Contradictions (spine vs input)

| # | Sev | Spine | Input | Conflict |
| --- | --- | --- | --- | --- |
| C1 | High | AD-2 "A Run may reference only an `ACTIVE` version" | FR-15; §E | FR-15 requires the Regression Run on an `APPROVED`, not-yet-`ACTIVE` version. AD-19 exempts Regression Runs from the overlap rule only, not from the `ACTIVE`-only rule; a literal build of AD-2 blocks every Regression Run. (§E's own "only `ACTIVE` versions run or schedule" is the same PRD-internal tension; the spine must resolve it explicitly.) |
| C2 | High | AD-3 `SealResult` "is a separate web-side unit of work ... once every evaluation is resolved" | FR-40, UJ-4, §E.1 row 4→6; EXPERIENCE Evaluation confirmation ("the last one seals the Result") | For a Run with no pending Agent-Judged evaluation (all-compiled P-2/P-3, or a hero Run whose C2 evaluations are all below threshold) no human action ever occurs on the web side, so nothing triggers sealing and the Run sits `COMPLETED`-unsealed forever. Either `CompleteRun` seals when nothing is pending, or the last confirmation command seals in its own transaction; the spine binds neither. |
| C3 | High | AD-12 binds "four PoC Templates and their golden datasets" as test fixtures under `tests/fixtures` | FR-15; addendum §D | FR-15 compares a runtime Regression Run against the golden dataset's expected terminal outcomes and has the approver confirm from the "confirmation script"; those must be product data on the Template (AD-19 already puts the golden Population Source binding there). The spine locates them only in the test tree. |
| C4 | Med | AD-6 per-Observation set = condition completeness, identity/value corroboration, absence completeness, unnamed value, ambiguous match, required Evidence | FR-20 (grounding, identity/value corroboration, absence completeness, unnamed value, required Evidence); EXPERIENCE Gate checklist (adds Target System freshness, puts condition completeness at Run level) | Three lists, three memberships. Condition completeness cannot be decided per Observation while an uncompiled condition's Agent-Judged evaluation may arrive later in the Work Item; Target System freshness is missing from the spine's per-Observation set. The Gate checklist's two groups and live-updating rows are built directly from this assignment. |
| C5 | Med | AD-18 "Work Items are one per record per agent-driven Target System" | Addendum §C P-4 "one agent Work Item for the ProdConsole page read, owning one Observation per baseline parameter" | P-4 is agent-driven yet uses one Work Item for the whole population (FR-22 wording matches the spine; §C is the per-Template coverage rule FR-22 and §H point to). The Work Item model must allow an agent-driven Work Item to own many Observations or P-4 cannot run. |
| C6 | Med | Design-paradigm flow: "rejection leaves Unevaluated → INCONCLUSIVE"; AD-3 "may move `COMPLETED → INCONCLUSIVE`" | §E.1 rows 5–6 (first match wins) | §E.1 moves to `INCONCLUSIVE` only when a condition is `UNEVALUATED` **and no Exception counts**; if any Exception counts the sealed outcome is Control Failure with Unevaluated records listed. The spine's unconditional rule would seal a Control Failure Run as Inconclusive. (FR-40's prose is also unconditional; §E.1 is the normative home.) |
| C7 | Med | AD-20 creates notifications on `AWAITING_AUDITOR` and an Auditor flag only | EXPERIENCE Flow 1 step 7 ("Maya is notified"), Flow 2 step 3 ("Daniel is notified"), Version review → Rejected ("the author is notified"), IA row "Version review — reached from Notification" | The UX depends on version-lifecycle notifications (submitted → Audit Managers; approved/rejected → author) that no AD produces. FR-28 does not require them, so the spine should either add them to AD-20 or the UX must drop them; today they are silently unbuilt. |
| C8 | Med | AD-6 "Comparisons are valid only across declared-compatible Procedure/evaluator/schema versions" | Addendum §B fingerprint compatibility: same Procedure + same matching key + same Compliance Rule digest, "declared by the builder on approval and shown on the version" | Different compatibility criteria and no declaration step in the Versioning row. A build following AD-6 will compare Runs §B calls incompatible, or vice versa. |
| C9 | Low | Consistency row: evaluation origin ∈ {`RULE`, `AGENT_JUDGED`, `HUMAN`}; "Unevaluated is a value with an origin" | Addendum §B.1 and §E list `UNEVALUATED` as an origin | The spine sides with EXPERIENCE/DESIGN ("Unevaluated is a value, never an origin"). Correct choice, but the divergence from the normative addendum should be stated so the wire schema (AD-14) is not built from §B.1 verbatim. |
| C10 | Low | AD-17 "the Runs dashboard uses the same channel per list" (live) | EXPERIENCE Interaction Primitives "no auto-refresh of detail pages except Live View"; per-surface "Stale data — Banner 'Updated {time}. Refresh.' on Run Detail and Runs"; yet Run Detail → Running "Live Gate rows updating" | EXPERIENCE is internally inconsistent and the spine does not say which surfaces subscribe (Live View, Run Detail while active, Runs list, Overview counts). FR-48 requires the dashboard to reflect state within NFR-7 without reload, so the spine is right; it should name the subscribing surfaces. |
| C11 | Low | AD-5 artifacts: Structural Snapshots, screenshots, Replay frames, source excerpts; AD-9 provider recording is supplementary | FR-10 Evidence Requirement type "workspace recording segment"; DESIGN Evidence item kinds "Recording segment" and "Adapter extract" | If a recording segment is an Evidence Requirement it must be a platform-stored artifact under AD-5 (Replay must work with the provider blocked); the spine never says segments are captured/stored, and "Adapter extract" is not an artifact kind. |

## Gaps by input

### PRD §1, §1.2, §4 (FR-1..FR-50)

| # | Sev | Input | What did not land |
| --- | --- | --- | --- |
| G1 | High | FR-15, FR-2, §D | Regression Run mechanics: who starts it (EXPERIENCE: approval auto-starts it when digests differ), who confirms its Agent-Judged evaluations (the **approver**, from the confirmation script), the comparison rule (every expected terminal outcome must reproduce, records §D excludes exempt), mismatch blocks activation and is surfaced to the approver, the Run is labelled Regression on the dashboard and recorded on the version. AD-19 binds only the golden binding and the overlap exemption; AD-12 mentions a comparison test. Also see C1, C3. |
| G2 | High | FR-12, FR-9 | Plan derivation and condition compilation have no owner. Nothing names the component that compiles conditions into deterministic rules and applicability predicates, whether compilation is deterministic (FR-37 identical-results depends on it), or where derivation runs (web request, worker job, streamed — EXPERIENCE shows "Re-deriving…"). FR-12 permits a model in derivation and requires the derivation model's identity on the Procedure Version; the Versioning row records only the execution model. Each re-derivation must be recorded; an underivable plan blocks submission. `ModelGateway` is bound to worker/agent use only (AD-9). |
| G3 | High | FR-20, FR-29, NFR-1, EXPERIENCE Flow 3 ("masked credentials") | Credential leakage through capture. AD-4 sanitizes Tool Action *logging*, but Structural Snapshots (DOM/accessibility/control tree) and frames are captured "at the Tool Action that read the attributes"; a snapshot or frame captured during a sign-in Session Step serialises the password input's value. No rule suppresses snapshot/frame capture during credential entry or redacts credential values from captured artifacts before registration. |
| G4 | High | FR-7, FR-3, FR-14, FR-49, §8.1 (Administration) | No module owns Target System registrations, credential references, Population Source location bindings, or users. The Modules row lists `identity … notifications`; the capability map sends FR-7 to `procedures` and FR-49 to "web queries + telemetry". Unowned consequences: registration-change → platform-authored drafts across Procedures (cross-module transaction or event?), rejection of a write-capable credential at registration, per-attribute expected labels on the registration, and where diagnostics read connectivity/health from. |
| G5 | Med | FR-27, §B | Escalation answer sets are not enumerated (choose candidate: pick by declared secondary key / mark ambiguous; unnamed value: mark Unevaluated and continue / abort; retry or skip: retry / skip / abort) nor the invariant "no answer evaluates a record Compliant or Exception or changes scope, credentials, tools, or the Compliance Rule". The secondary key is not in the Versioning row; `found = ambiguous` (§B.1) is not in AD-18. |
| G6 | Med | FR-23, FR-34, FR-35, NFR-8, §E.1 limit mapping | Outcome mapping beyond Session Steps is delegated to "addendum E" via the Errors row but never bound: Run-level Step Execution/time/token exhaustion → `INCONCLUSIVE` with partial Evidence; denied action or scope violation → `RUN_FAILED` plus security event; retry-then-second-exhaustion → Work Item `FAILED`; at most 3 retries with bounded backoff (NFR-8); during-Run integrity mismatch → `RUN_FAILED` (AD-5 covers only post-Run). |
| G7 | Med | FR-25, FR-27, FR-19, NFR-5 | Wait deadlines carry no values (30 min Pause, 4 h Escalation) and no rule for a Workspace Provider session that expires before the deadline (which terminal state?). No workspace teardown/lease-reaper invariant on any terminal state or worker crash; NFR-5 "holds no credential after the Run ends" is unenforced if a lease is orphaned. |
| G8 | Med | FR-6, FR-8, FR-9, FR-11 (Builder invariants) | Domain/application rules the Builder validates are unbound: manual upload only with a `once` Schedule; declared-count mechanism required at authoring; zero-record-Pass opt-in flag on the Procedure Version (not in Versioning row); authoring-time scope-widening flag with the three §D seeds (AD-12's seed list omits them); explicit boundary semantics per comparison; default applicability `found = true`; record derivation order Exception → Unevaluated → Compliant. |
| G9 | Med | FR-33, FR-38, §B.1 | Two evaluation rules missing from AD-6: a compiled condition over a *model-read* attribute is applied by the deterministic evaluator but recorded origin `AGENT_JUDGED` with the agent's read confidence; an Agent-Judged evaluation below the version's threshold is stored with value `UNEVALUATED` and needs no confirmation (so sealing treats it as resolved). A naive evaluator records the first as `RULE` and never seals the second. |
| G10 | Med | FR-33, FR-49, NFR-12; EXPERIENCE Gate checklist, Gate state family | Gate check outcomes are not first-class: FR-33 requires each check to produce a visible outcome and diagnostic; the checklist updates live, derives "18 of 20", links failed rows to Work Items, and has a family state (Not evaluated / Passed / Not passed / Incomplete). The spine runs checks inside transactions but never says outcomes are persisted as Timeline events with diagnostics and a Run-level Gate summary. |
| G11 | Med | FR-29, FR-45, NFR-3, glossary "Timeline events are also Audit Trail events" | The spine has "Timeline events" (AD-3, AD-17) and "product audit events, one chain per aggregate" (AD-5, AD-10) without stating they are the same store: is the Timeline the Run aggregate's hash chain? Which aggregate anchors system-wide events (authentication, registration change, Schedule, export)? Risk: two event tables and Timeline tampering undetected. |
| G12 | Med | FR-41; EXPERIENCE Exception Detail → Masked field | Masking: sensitive fields designated on the Population Source contract are masked in list views and unmasked in Exception Detail for Auditor/Audit Manager only. No masking designation on the binding, no authorization rule for unmasked reads, no export behaviour. |
| G13 | Med | FR-49, NFR-12; IA Administration row | Diagnostics read path: Target System connectivity, Workspace Provider health, Audit Runner health, per-Step/per-Target-System latency. No port, query, or process is named; connectivity probes from `apps/web` would cross the NFR-15 runner boundary. |
| G14 | Med | NFR-6 (10,000 adapter records in 5 min) | AD-3 requires a Timeline event per state change in the same transaction and AD-17 a `NOTIFY` per event; AD-18 gives one Observation per record with per-Observation Gate checks at registration. Nothing permits batched registration for adapter extractions; ~33 transactions + notifications per second is the implied floor. |
| G15 | Med | FR-47, §A.2 RoleMatrix (Reference Source) | Reference Sources are "consulted by the evaluator" only. Their acquisition, version/digest capture, inclusion in the Evidence Package and Workpaper Bundle (P-2 reproduction needs the RoleMatrix version) are unbound. |
| G16 | Med | FR-6 manual upload | Where an uploaded spreadsheet lives (EvidenceStore?) and how the worker Adapter acquires it via `EvidenceAcquisition`; the acquired snapshot must be the Run's initial Evidence item. |
| G17 | Low | FR-13 | Approval records a diff against the previous version; no structural representation of a version for diffing is bound (AD-14's wire schema could serve). |
| G18 | Low | FR-4, FR-22, §3 | `Control` (reference data a Procedure names) and `Audit Assignment` are absent from the AD-2 entity list. |
| G19 | Low | FR-3 | Out-of-scope *parameters* (a search outside the declared population) must be denied; the spine allowlists origins/applications/actions only. |
| G20 | Low | FR-43; EXPERIENCE Foundation ("never let an unsealed or Inconclusive Result be submitted") | Submit guard (only a sealed `COMPLETED` Result) is not explicit in AD-7's Review rules. |
| G21 | Low | FR-24 | Live frames exist only per Tool Action and pass through EvidenceStore reservation/verification before they are visible; "reflects agent progress within 5 seconds" is not guaranteed during a long Tool Action. |
| G22 | Low | FR-14, FR-16 | Between successor activation and the period boundary two versions are `ACTIVE`; which one manual "Initiate Run" targets is unstated. |
| G23 | Low | FR-1, FR-45 | Successful/failed authentication events from Better Auth must enter the product audit chain; folded into G11's aggregate question. |

### PRD §5 (NFR), §6, §8.1

| # | Sev | Input | What did not land |
| --- | --- | --- | --- |
| G24 | Med | NFR-3 | Modification of *Observations* before finalization is detectable only if the registration Timeline event carries the Observation's digest; the spine hashes events, not Observation rows. |
| G25 | Low | NFR-8 | "At most 3 retries with bounded backoff" — the retry policy is named but its bound is not. |
| G26 | Low | §6 "domain model must not assume one Run = one worker" | Deferred bullet covers Work Items; the wait record and workspace lease are per Run — fine for PoC, but no statement that leases could become per Work Item. |
| G27 | Low | §8.1 Templates P-2..P-4 | Per-Template coverage rules (§C) are referenced by AD-18 only as "per Template's coverage rule"; see C5. |

### Addendum §B, §B.1, §E, §E.1, §F, §H

| # | Sev | Input | What did not land |
| --- | --- | --- | --- |
| G28 | Low | §B timestamps, money | Original UTC offsets retained beside normalized values; money as decimal + ISO 4217 (the P-3 USD 100,000 inclusive boundary fails on floats). No value objects bound. |
| G29 | Low | §H duplicate primary keys | "Unless the Procedure Version explicitly permits versioned records" — flag not in the Versioning row. |
| G30 | Low | §E Session Steps | Adapter extraction is a Session Step (failure → `RUN_FAILED`) *and* yields a Work Item (FR-22, retry-or-skip path); the spine's flow diagram omits Adapter extraction and does not say which failure path applies. |
| G31 | Low | §F | Bundle contents list "notifications" on the Timeline and "initiator (Auditor or Schedule)"; AD-5's bundle list omits notifications. |
| G32 | Low | §H ProdConsole | The agent extracts the signed snapshot identifier and expected parameter count that the Gate reconciles — an agent-extracted declared count is an exception to "declared count generated independently" that AD-18 does not acknowledge. |

### EXPERIENCE.md (IA, Component Patterns, State Patterns, Interaction Primitives)

| # | Sev | Input | What did not land |
| --- | --- | --- | --- |
| G33 | Med | Data tables "Change" column; Rail card "Change since previous Run" | Predecessor selection for scheduled Runs (previous period's Run of the same Procedure, not a rerun predecessor) is unbound; the Rerun row covers reruns only. Depends on C8. |
| G34 | Low | Overview needs-attention list (7 ordered kinds); sidebar counts | Cross-module read models (runs + review + procedures/schedules) — AD-8 allows a `UnitOfWork` for writes; nothing says how read models compose across modules without reading another module's tables. |
| G35 | Low | Exception Detail (assignee, notes), Procedure Detail platform-authored draft ("after a {model/prompt/tool/registration} change"), Notifications bell (unread count) | Aggregate attributes: Exception assignee and notes; draft cause kind; notification read state. |
| G36 | Low | Live View → Stream lost | 60-second "Connection lost" state with controls disabled; spine binds 15-second stale only (client concern, but pause/cancel commands during loss must fail cleanly on expected revision). |
| G37 | Low | Session viewer / Accessibility ("alt narration equal to the Step narration") | Narration source is ambiguous: DESIGN says every Step is "narrated factually"; AD-9 treats narration as untrusted agent output. If narration is platform-derived from the sanitized Tool Action it is trusted content; if agent-generated it must be labelled. |
| G38 | Low | Flow 0 vs §C | Expected field labels are entered on the registration (Flow 0) and also declared per Template (§C); the spine says "declared label" without stating which is authoritative and how it is frozen into the version. |
| G39 | Low | Run Detail → Queued (Cancel enabled) | Cancel of a `QUEUED` Run must prevent the pending job from starting (job cancel or state check at pickup); AD-3's "cooperative" cancel describes a running worker. |

### DESIGN.md (Components)

| # | Sev | Input | What did not land |
| --- | --- | --- | --- |
| G40 | Low | Evidence item kinds (Structural Snapshot · Screenshot · Source excerpt · Recording segment · Adapter extract) | Artifact kind enumeration; see C11. |
| G41 | Low | Untrusted source content block ("any retrieved free text that resembles an instruction") | No detector is implied by the spine; safest reading is "render all retrieved free text and agent text in the untrusted block", which the spine should state so no unit builds a heuristic classifier. |
| G42 | Low | Execution-failure panel (`error_class`, failed Session Step, retries) | The closed failure taxonomy (Errors row) must expose `error_class`, Session Step, and retry count on the Run; attributes unnamed. |

## Totals

- Gaps: **6 high** (G1–G4 plus C2, C3 counted as gaps), **17 medium**, **18 low**.
- Contradictions: **11** (C1–C3 high, C4–C8 medium, C9–C11 low).

## Five most consequential

1. C1 — AD-2's `ACTIVE`-only rule blocks FR-15 Regression Runs on `APPROVED` versions.
2. C2 — No sealing trigger for Runs with nothing pending; all-compiled and unattended Runs never seal (AD-3 vs FR-40/§E.1/UX).
3. G3 — Structural Snapshots/frames captured during sign-in can carry credentials; only Tool Action logs are sanitized.
4. G2 — No owner, process, or determinism rule for plan derivation and condition compilation (P0 #1 Builder).
5. G1/C3 — Regression Run confirmer, comparison rule, and golden expectations as product data are unbound.
