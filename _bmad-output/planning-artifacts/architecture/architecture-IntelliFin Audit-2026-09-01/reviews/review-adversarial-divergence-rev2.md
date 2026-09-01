---
title: "Architecture Reviewer Gate — Adversarial Divergence (revision 2)"
artifact: "../ARCHITECTURE-SPINE.md"
review_type: "independent-unit incompatibility attack"
prior_review: "review-adversarial-divergence.md, recheck-adversarial-divergence.md (revision 1, all closed)"
status: complete
date: 2026-09-01
verdict: needs-revision
severity_counts:
  critical: 3
  high: 7
  medium: 8
  low: 2
---

# Adversarial Divergence — Revision 2

## Verdict

**NEEDS-REVISION.** Revision 2 keeps every revision-1 closure intact (idempotent artifacts, atomic `CompleteRun`, canonical bytes, versioned contracts, single retry owner, release discipline, recovery unit). None of those is reopened here. The new surface — durable waits (AD-16), the live channel (AD-17), one Observation contract on two paths (AD-18), scheduler handover (AD-19), notifications (AD-20), and the split of evaluation-in-worker from sealing-in-web (AD-3/AD-6) — admits twenty pairs of units that each obey every AD literally and still compose into a system that never seals, drops a human's answer, cannot prove absence on adapter paths, or runs one period twice.

Three findings are critical because they break the hero or an acceptance Template outright: no unit is obliged to seal a Result that has no Agent-Judged evaluation (P-2 and P-3 never become submittable); the wait record's two jobs (deadline wake, resume) can be deduplicated or reordered so an answered Escalation times out; and the Absence Observation contract is written in agent-only terms, so adapter Target Systems (P-3 "no approval", P-2 missing account) can never produce a valid `found = false`.

## Attack method

For each seam, two plausible lower-level units (epics or teams) are built independently from the spine text. Each honors AD-1 dependency direction, uses the stack only behind ports, and follows the cited ADs to the letter. The attack succeeds when the composed system loses a decision, disagrees on state, or produces different terminal outcomes for the same Observations. Findings cite the spine AD, the PRD FR, and the addendum section (§B.1, §E, §E.1, §H are the normative data and state models). Each fix is proposed as AD text.

## Findings

### ADV2-01 — Critical — No unit is obliged to seal a Result that has nothing to confirm, and confirmations are not fenced to `COMPLETED`

**Seam:** worker `CompleteRun` (AD-3) vs web `SealResult` (AD-3, AD-6); evaluation module vs runs module.

**Independently compliant units**

- *Worker Run executor:* `CompleteRun` commits the Gate decision, the **unsealed** Result, `COMPLETED`, final checkpoint, and audit events atomically (AD-3, verbatim). It never seals — "`SealResult` is a separate web-side unit of work".
- *Web evaluation/confirmation team:* implements `ConfirmEvaluation`/`RejectEvaluation`; "the last one seals the Result" (EXPERIENCE.md, Evaluation confirmation). `SealResult` runs inside the confirmation handler when the pending count reaches zero.

**Divergence:** Template P-2 and P-3 have only compiled conditions; a hero P-1 Run whose every C2 evaluation fell below the confidence threshold has no pending evaluation either (FR-38 assumption). No confirmation ever happens, so no unit invokes `SealResult`. The Run sits `COMPLETED`, outcome "Pending Confirmation" with zero pending, Submit disabled forever (FR-43: unsealed cannot submit). Both units did exactly what AD-3 says. A second divergence in the same seam: the evaluation team accepts `ConfirmEvaluation` as soon as an Agent-Judged evaluation exists — which is at Observation registration, while the Run is `RUNNING` and the Auditor is in Live View (AD-6 registers `AGENT_JUDGED` pending at registration). The "last" confirmation then seals the Result before the Run-level Gate has run; `CompleteRun` later overwrites it as "unsealed", or refuses. The runs team assumed confirmations begin only after `COMPLETED`.

**Cites:** AD-3 ("`SealResult` is a separate web-side unit of work"), AD-6 ("Result sealing computes the System Outcome once all confirmations resolve"), FR-40, addendum §E "Result sealing (normative)", §E.1 row 4.

**Fix (amend AD-3 and AD-6):**
> `SealResult` is an application command, not a process. It is invoked (a) inside the `CompleteRun` transaction when no evaluation on the Run is `pending`, and (b) inside the confirmation or rejection command that resolves the last `pending` evaluation. It is invoked nowhere else. `ConfirmEvaluation` and `RejectEvaluation` are refused unless the Run is `COMPLETED` and its Result unsealed; Live View shows pending Agent-Judged evaluations read-only while `RUNNING`. A sealed Result is the only precondition of `SubmitResult`. The Run-level Gate and `CompleteRun` execute in the worker; sealing executes in whichever process runs the resolving command.

### ADV2-02 — Critical — A wait has two jobs, two homes for the answer, and no ordering rule

**Seam:** AD-16 wait lifecycle; web supervision commands vs worker wake handler; Waits convention.

**Independently compliant units**

- *Worker wait team:* on entering `PAUSED`/`AWAITING_AUDITOR` it checkpoints, releases the job, and "schedules a deadline wake" as a pg-boss job with `startAfter = deadline`, using the wait id as the singleton key so a restart cannot schedule two wakes. On wake it "enforces the deadline (`INCONCLUSIVE`)".
- *Web supervision team:* `AnswerEscalation` validates expected revision and the wait record, stores the answer on the Escalation aggregate (AD-9: Escalations are typed application objects), and "enqueues one resume job keyed by the wait id" — also singleton key = wait id, on the same run queue.

**Divergence:** pg-boss singleton semantics deduplicate the second job with the same key while the first is queued: the resume job is silently dropped and the deadline wake later marks the Run `INCONCLUSIVE` although the answer was committed hours earlier. If the teams use different queues instead, the two jobs race: worker concurrency or two worker instances run the wake and the resume concurrently; the wake sees `now ≥ deadline` and times out a Run whose resume is mid-flight, or the resume continues a Run the wake already ended. Third divergence: the memlog says the resume job carries "the Escalation answer id", the spine says it is "keyed by the wait id", and the convention puts `answer?` on the wait record — three candidate payloads; the worker reads the answer from the wait record, the web wrote it to the Escalation. Fourth: cancel from `AWAITING_AUDITOR` and Pause-timeout are also wait closures; whether they count as the "second answer" that must be rejected is undefined.

**Cites:** AD-16, Consistency Conventions "Waits", memlog AD-16 entry, FR-25, FR-27.

**Fix (amend AD-16 and the Waits convention):**
> Exactly one durable job exists per wait, created in the wait-entry transaction with `startAfter = deadline` and singleton key `wait:<wait id>`. Every closure of a wait — answer, resume, cancel, abort — is one application command that, in one transaction, locks the wait row `FOR UPDATE`, requires `closed_at IS NULL` and the expected Run revision, writes `{closed_at, closure_kind, answer_option_id, actor}` on the **wait record** (the Escalation aggregate references the wait; it never holds the authoritative answer), and moves the wait job's start time to now. The worker's wake handler locks the same row and applies exactly one of: closed → act on `closure_kind`; open and `now ≥ deadline` → `INCONCLUSIVE` with Evidence preserved; open and early → reschedule. A second closure fails the `closed_at IS NULL` precondition. Job payload is `{schemaVersion, runId, waitId}` only.

### ADV2-03 — Critical — The Absence Observation contract is agent-shaped; adapter paths cannot prove absence

**Seam:** Adapter team vs Agent team under AD-18's "one Observation contract"; AD-6 vs addendum §B.1/§H.

**Independently compliant units**

- *Adapter team (P-3 ApproveNow, P-2 AccessGate):* emits one Observation per population record from one extraction (AD-18). For a transaction with no approval in ApproveNow it must emit `found = false`. §B.1 says `found = false` requires "the query string derived from the sanitized Tool Action log (the `type` action into the identified search control)" and a passing search-completeness check. There is no Tool Action, no search control, and no `type` action in an API adapter. Reading the letter, the team emits no Observation for absent records (or emits `found = false` without the required fields).
- *Gate/evaluation team:* implements §H "Search completeness (absence)" and "Per-record coverage" exactly: a `found = false` Observation without a Tool-Action-derived query string makes the Work Item `UNINSPECTED`; a record with no Observation is uninspected.

**Divergence:** P-3's core Exception case — "No approval" — can never be evaluated; every population transaction lacking an approval yields `INCONCLUSIVE` in one build, or is fabricated as "proven absent" through an adapter-synthesized pseudo-Tool-Action in another. The two builds disagree on the terminal outcome of the P-3 golden dataset. On the agent path a mirror divergence exists: "the identified search control" is identified by nobody — one Agent team derives the query from the last `type` action before the results snapshot, another requires the Procedure Version to declare a search-control locator per Target System; mistyped-key and partial-pagination seeds (§D) then yield `UNINSPECTED` in one build and a Compliant absence in the other.

**Cites:** AD-6 ("Absence Observations carry query strings derived by the platform from the sanitized Tool Action log"), AD-18, §B.1 Absence Observation, §H search completeness and per-record coverage, §C P-2/P-3 coverage rules, FR-31.

**Fix (amend AD-18; add to the Observation contract):**
> Absence evidence is defined per `capture_method`. **Agent:** the query string is the sanitized `type` Tool Action into the search control that the Target System registration declares by locator pattern (FR-7); the empty-result page is a Structural Snapshot; completeness is all result pages consumed. **Adapter:** every lookup or extraction is an *Adapter Action* on the Timeline with the same sanitized-action schema as a Tool Action; the query string is the request key the Adapter sent, recorded by the platform from the request, never from the response; the empty result is the stored response artifact (the Observation's snapshot substrate); completeness is the extraction/pagination completeness check of §H. A `found = false` Observation missing its path's absence fields makes the Work Item (agent) or the record (adapter batch) `UNINSPECTED`. An adapter batch Work Item is `OBSERVED` only when every covered record has an Observation with `found ∈ {true,false}`; otherwise `UNINSPECTED` listing the records.

### ADV2-04 — High — "Identity attribute" is grounded in the search results by one team and in the record page by the other; the wrong-page seed passes in one build

**Seam:** Agent team vs Gate/corroboration team; AD-4 "focused-record identity" vs AD-6/§B.1 identity attribute.

**Independently compliant units**

- *Agent/execution team:* platform key matching runs over "captured result rows" (FR-27, AD-9); the row whose grounded key equals the record key is the match; `BrowserExecution` reports "identity of the focused record" (AD-4). The Observation's `identity` attribute is grounded in the **search-results** snapshot (row cell), the value attributes in the **account-page** snapshot.
- *Corroboration team:* re-reads the identity attribute at its grounding and compares to the normalized record key (§H). Passes.

**Divergence:** addendum §D seeds "one account page of a *different* employee presented as the record's page (identity corroboration must yield Inconclusive)". The search row was correct; the agent opened the wrong row's page. Identity grounded in the results snapshot corroborates; value attributes grounded in the wrong page corroborate too (they truly appear there). The Observation passes the Gate and the wrong employee's status is evaluated. In the other build (identity grounded in the same snapshot as the values) the seed is caught. Second divergence: after a *choose candidate* answer by full name, the page may show no employee ID; one team fails identity corroboration (value ≠ key) and marks Unevaluated despite `human-matched`, another skips the check entirely for human-matched records — the §H text "or the record is flagged human-matched" permits both.

**Cites:** AD-4, AD-6, AD-18, §B.1 `identity`, §H identity corroboration, §D wrong-page seed, FR-27, FR-33.

**Fix (amend AD-6):**
> An Observation's identity attribute is grounded in the **same Structural Snapshot** as each value attribute (one identity grounding per snapshot when attributes span several). Platform key matching over search-result rows is a separate provenance node (`match`: candidate-rows snapshot, matched row locator, key compared) required in addition to page identity. For `match_origin = human-matched`, page identity corroboration compares the declared secondary key attribute (re-read from the page snapshot) to the record's secondary key value; it is never skipped. "Focused-record identity" in AD-4 is an adapter capability that supplies the locator; the Gate trusts only the extractor's re-read.

### ADV2-05 — High — Regression Runs cannot be dispatched under the literal ACTIVE-only rule

**Seam:** procedures/approval team vs runs dispatch team vs scheduler.

**Independently compliant units**

- *Runs dispatch:* "A Run may reference only an `ACTIVE` version" (AD-2); `InitiateRun` rejects anything else.
- *Approval team:* on approving a version whose configuration digest differs, starts the Regression Run "on an Approved, not yet Active, version" (FR-15; AD-19 "Regression Runs bind to the Template's golden Population Source").

**Divergence:** every Regression Run is rejected at dispatch; no version with a changed model, prompt, tool, or registration digest ever becomes `ACTIVE`; platform-authored drafts (AD-2) pile up. Alternate builds pass the dispatch check by flipping the version to `ACTIVE` first — then the scheduler (AD-19) enqueues real Runs on an unregressed version. Further unresolved: who compares terminal outcomes to the golden expectations (procedures vs evaluation), whether a Regression Run's Result seals and enters Review (EXPERIENCE.md: it never appears in Review, but the approver confirms its Agent-Judged evaluations — a `SealResult` path), and how a Run reaches "Target System fixtures" (§D) when the version's frozen registrations point at the synthetic systems.

**Cites:** AD-2, AD-3, AD-19, FR-15, §D, §E Procedure Version states, EXPERIENCE.md Version review states.

**Fix (amend AD-2 and AD-19):**
> A Run carries `kind ∈ {STANDARD, REGRESSION}`. `STANDARD` Runs reference only an `ACTIVE` version. A `REGRESSION` Run references an `APPROVED` version, is started only by the approval command, substitutes the Template's golden Population Source binding for that Run only, keeps the version's frozen Target System registrations (golden Target System fixtures are the synthetic systems seeded with the golden dataset), is exempt from the overlap rule, seals through `SealResult` with the approver's confirmations, never enters Review, and never notifies. The procedures module owns the comparison of terminal outcome and evaluations to the golden expectations and records `RegressionPassed | RegressionFailed` on the version; only `RegressionPassed` (or no regression needed) moves `APPROVED → ACTIVE`.

### ADV2-06 — High — "Period boundary handover" has two owners, two ACTIVE versions, and an overlap key that permits the double Run it exists to prevent

**Seam:** worker scheduler vs procedures version state machine vs manual `InitiateRun`.

**Independently compliant units**

- *Procedures team:* `ApproveVersion` (with regression satisfied) sets the successor `ACTIVE` immediately; the predecessor stays `ACTIVE` until "the first period boundary after a later version becomes `ACTIVE`" (§E). Two `ACTIVE` versions coexist; "only `ACTIVE` versions run or schedule".
- *Scheduler team:* per tick, for each `ACTIVE` version with a due period, enqueues one Run under the unique constraint `(Procedure Version, period)` (AD-19). Both versions are `ACTIVE`; both are due; the constraint is per **version**; two Runs for one period are enqueued. FR-14's "no period run twice" is violated by two literal implementations.

**Divergence continued:** which period does the boundary hand over? Successor active Wednesday, weekly Schedule: the period Mon–Sun containing Wednesday ends Sunday and its Run is due Monday. Scheduler A gives it to the predecessor (period started before the boundary); scheduler B to the successor (Run starts after the boundary); if the successor's Schedule changed frequency, "period boundary" refers to different calendars in each. Who writes `ACTIVE → RETIRED` — the worker scheduler at the boundary or the web approval command with a future-dated effect — is unstated, so an audit event with actor "Schedule" or actor "approver" is produced by different builds. A manual `InitiateRun` for the straddling period picks whichever `ACTIVE` version the UI lists first.

**Cites:** AD-3 ("One active Run per Procedure Version/effective period"), AD-19, FR-14, FR-16, FR-17, §B period derivation, §E Procedure Version states.

**Fix (amend AD-19 and AD-3):**
> `handover_at` is computed once by the approval command as the first period start (per the **successor's** Schedule) strictly after the successor's activation time and stored on both versions. The predecessor owns every effective period whose start is before `handover_at`, including periods whose Run is due after it; the successor owns periods starting at or after `handover_at`. Run uniqueness is enforced on `(Procedure, effective period)` for `STANDARD` Runs, not on the version. `InitiateRun` resolves the version from the requested period's ownership and refuses periods no version owns. The scheduler performs `ACTIVE → RETIRED` for the predecessor in the transaction that enqueues the first Run the successor owns, or on the first tick after `handover_at`, with actor "Schedule".

### ADV2-07 — High — Exceptions are created at registration by one team and at sealing by the other

**Seam:** evaluation module (worker, per-Observation) vs review module (web, dispositions and assignment).

**Independently compliant units**

- *Evaluation team:* an Exception is "a record with at least one condition evaluated as violating, whether Rule-Classified or confirmed Agent-Judged" (glossary). It creates the Exception row in the registration transaction for `RULE = EXCEPTION`, and, because EXPERIENCE.md shows Exception rows whose "only Exception evaluation is Agent-Judged pending", also for pending `AGENT_JUDGED = EXCEPTION`. Fingerprint computed then.
- *Review team:* Exceptions carry assignment and `OPEN → UNDER_REVIEW → …` (FR-42, AD-7). It creates Exceptions at `SealResult` from the sealed evaluation set — the only moment "counts toward the outcome" is knowable — so an Exception can never exist for an evaluation that is later rejected to Compliant.

**Divergence:** revision-2 AD-3 lists what `CompleteRun` commits and no longer names Exceptions (the memlog closure of ADV-02 did). Composed: Exceptions appear twice (registration and sealing) with two identifiers and two fingerprints; or an Exception assigned and set `UNDER_REVIEW` before sealing vanishes when the Auditor rejects the Agent-Judged evaluation to Compliant — deleting a row with disposition history, which AD-7's "retains history" forbids. Live View and the provenance chain (FR-41 "Timeline segment where it was found") want the early row; the outcome wants only the counted set.

**Cites:** AD-3, AD-6, AD-7, FR-41, FR-42, §E Exception states, §E.1, EXPERIENCE.md Exception list row.

**Fix (add to AD-6):**
> The evaluation module creates an Exception in the transaction that records the first evaluation with value `EXCEPTION` for a record (origin `RULE`, `AGENT_JUDGED`, or `HUMAN`), assigns its Run-stable identifier and fingerprint then, and never deletes it. An Exception carries `counts_toward_outcome`, computed at `SealResult`: true when any current evaluation on the record is `EXCEPTION` with origin `RULE`, confirmed `AGENT_JUDGED`, or `HUMAN`; an Exception whose every `EXCEPTION` evaluation was rejected to Compliant is retained with `counts_toward_outcome = false` and reason `superseded by rejection`. Assignment and disposition are review-module state on the same aggregate and are permitted only after sealing. `CompleteRun` commits the Exceptions created so far; `SealResult` commits `counts_toward_outcome`.

### ADV2-08 — High — The seal decision is a cross-aggregate read that no revision precondition serializes

**Seam:** evaluation aggregate revision vs Result revision; two concurrent confirmations.

**Independently compliant units**

- *Confirmation command (evaluation module):* requires the expected revision of the **evaluation** being confirmed (AD-7: per-condition evaluations are a separate aggregate), commits, then counts pending evaluations; if zero, calls `SealResult`.
- *Result aggregate (review/evaluation):* "The Result version increments on each confirmation or rejection" (FR-40) — implemented as a derived counter updated after commit.

**Divergence:** two Auditors confirm the last two pending evaluations concurrently. Under read-committed, each transaction sees the other's evaluation still pending; neither seals — the Run is stuck exactly as in ADV2-01. With a different interleaving both seal and two System Outcomes are computed; the Result version increments twice for one seal. The expected-revision rule exists but is bound to the wrong aggregate for this decision.

**Cites:** AD-7, FR-40, Commands and mutation convention.

**Fix (add to AD-7):**
> Confirmation and rejection commands carry the expected **Result** revision, lock the Result row `FOR UPDATE`, mutate the evaluation, increment the Result revision, and evaluate the seal condition inside that lock. The Result row is the serialization point for every mutation that can change pending count or System Outcome.

### ADV2-09 — High — The compiled condition and applicability-predicate language is not a named durable contract, and its semantics over missing, contradictory, and model-read attributes are open

**Seam:** web Builder (compiles at approval) vs domain evaluator (executes in the worker).

**Independently compliant units**

- *Builder team:* compiles conditions and predicates "at approval" into an expression AST stored on the Procedure Version; evaluates predicates over the Observation's declared attributes as captured.
- *Evaluator team:* evaluates predicates over the **corroborated** view — an attribute marked `contradictory` is "treated as not captured" (§B.1 wording for ungrounded attributes) — so a predicate referencing it is not applicable; the condition then needs no evaluation, condition completeness passes, and the record can be Compliant on its remaining conditions.

**Divergence:** the §D seeded transcription error (`Active` shown, `disabled` recorded) makes `account_status` contradictory. Build A: predicate applicable, condition Unevaluated, record Unevaluated (safe). Build B: predicate not applicable for a condition written as `applicability: account_status is present`, nothing to evaluate, record Compliant via the rest — false assurance. Further open choices that two compliant builds make differently: original vs normalized value in predicates; three-valued logic for `found = ambiguous`; whether a predicate may reference a model-read attribute (then "the agent never decides applicability" is violated); whether the P-1 C2 Agent-Judged evaluation must arrive **inside** the registration transaction ("A found account with no C2 evaluation is a Gate failure" runs per Observation at registration per AD-6) or as a later command — in the latter design every found account fails condition completeness spuriously. AD-14 lists "compiled plans" but not the condition/predicate expression as a versioned boundary.

**Cites:** AD-2, AD-6, AD-14, FR-9, FR-33, FR-38, §B.1 per-condition evaluations, §D seeds, §H condition completeness.

**Fix (amend AD-6 and AD-14):**
> The compiled condition and applicability-predicate expression is a versioned `application` contract (AD-14) with one domain interpreter used by the Builder preview, the Regression comparison, and the worker evaluator. Predicates are evaluated over `found`, `match_origin`, and **normalized** values of attributes whose corroboration is `matched`; a predicate that references an attribute that is absent, `contradictory`, or `model_read` evaluates *applicable* (fail-closed), and the condition's evaluation is `UNEVALUATED` with diagnostic naming the attribute. `found = ambiguous` makes every condition applicable and Unevaluated. Model-read attributes may not appear in predicates; the Builder refuses them. The Observation registration envelope carries the agent's evaluations for every uncompiled applicable condition; registration is one transaction.

### ADV2-10 — Medium — Which `UNEVALUATED` values fail the Gate at `CompleteRun` and which survive to sealing is decided differently by the Gate team and the sealer

**Seam:** Run-level Gate (worker) vs `SealResult` (web) on "Unevaluated is a value with an origin".

**Independently compliant units**

- *Gate team:* §H "Condition completeness — every condition has an evaluation for every record its predicate selects". A low-confidence Agent-Judged evaluation stored as `UNEVALUATED` (FR-38 assumption) *is* an evaluation; the Gate passes; the Run is `COMPLETED`.
- *Sealer team:* §E.1 row 5 moves `COMPLETED → INCONCLUSIVE` only for Unevaluated "by human rejection"; a low-confidence Unevaluated with no counting Exception is neither Pass (blocked) nor Control Failure (no Exception) nor `INCONCLUSIVE` (not by rejection). One sealer emits `INCONCLUSIVE` anyway; another emits Pass with the record listed; a third refuses to seal.

**Cites:** AD-6, FR-38, FR-40, §E.1 rows 5–7, §H condition completeness, §E Run states.

**Fix (amend AD-6):**
> At the Run-level Gate, any current evaluation with value `UNEVALUATED` whose origin is not `HUMAN` is a condition-completeness failure → `INCONCLUSIVE` at `CompleteRun`. Only human rejection can introduce `UNEVALUATED` after `COMPLETED`, which is the sole trigger of `COMPLETED → INCONCLUSIVE` at sealing. Low-confidence and model-read Agent-Judged evaluations therefore never reach a sealed Result.

### ADV2-11 — High — "Resume from the checkpointed Tool Action" on a new worker build has no durable agent context

**Seam:** AD-15 (a waiting Run must resume on a new worker build) vs AD-16 (continue from the checkpointed Tool Action) vs the Agent team's model loop.

**Independently compliant units**

- *Worker A:* the checkpoint is the application checkpoint (stage, Work Item, Tool Action ordinal). On resume after a Pause the model loop restarts the current Step Execution from its first Tool Action: new sign-in check, new search, new snapshot. Observations dedupe by idempotency key (NFR-8), but the Timeline records the Step Execution twice and the retry budget is charged.
- *Worker B:* persists the in-flight model conversation (messages, tool results, provider response ids) in the checkpoint so resume continues mid-turn with "only the chosen option identifier". This is a durable, provider-shaped contract AD-14 does not list, and it must survive a worker build change and a model-provider switch.

**Divergence:** the same Escalation answer yields different Timelines, different limit consumption, and in build A possibly a *retry or skip* Escalation caused by the resume itself. Re-attachment to the live Agent Workspace after the worker process changed (the "workspace lease") requires the execution ports to expose `attach(sessionRef)`; AD-4's conformance list omits it, so one adapter recreates the browser (losing the signed-in session) and another reattaches.

**Cites:** AD-4, AD-9, AD-14, AD-15, AD-16, NFR-8, FR-25.

**Fix (amend AD-16 and AD-4):**
> Resume restarts the **current Step Execution** from its first Tool Action as a new attempt that is not charged to the Step Execution retry budget; prior partial Tool Actions of that attempt remain on the Timeline marked `superseded_by_resume`. No model conversation state is persisted or required across a wait; the model is re-briefed from the frozen plan, the Work Item, and the chosen option identifier. The workspace lease stores a provider-neutral `WorkspaceRef`; `BrowserExecution`/`DesktopExecution` conformance includes `attach(WorkspaceRef)` preserving the signed-in session, and `release`.

### ADV2-12 — Medium — Timeline `seq` is allocated by one team and assumed commit-ordered by the other

**Seam:** Timeline writer (worker and web both append) vs SSE route (`after=<seq>` cursor).

**Independently compliant units**

- *Writer:* allocates `seq` from a per-Run counter or global sequence at insert; web commands (answer, pause, flag, confirmation) and the worker append concurrently.
- *SSE route:* on `NOTIFY(run_id, seq)` queries `seq > cursor`, sends, advances cursor.

**Divergence:** event 10 (web, long transaction) commits after event 11 (worker) commits; the client has cursor 11; the NOTIFY for 10 arrives; the query returns nothing; event 10 is never shown, and reconnect replay repeats the miss. AD-5's per-aggregate hash chain "using a transactionally allocated sequence/head" gives commit-ordered gapless numbering only if the Timeline **is** the Run's audit chain and every writer takes the head lock — AD-17 does not say so, so the runs team keeps a separate Timeline table.

**Cites:** AD-5, AD-8, AD-17, Live channel convention, glossary (Timeline events are Audit Trail events).

**Fix (amend AD-17):**
> Timeline events are the Run aggregate's audit-chain events; `seq` is the chain sequence allocated under the Run head row lock, so it is gapless and commit-ordered across web and worker writers. `NOTIFY` is issued in the same transaction. The SSE route replays `seq > cursor` in order and never skips.

### ADV2-13 — Medium — "Replay asset" is an Evidence artifact to one team and a Timeline projection to the other, with different seal consequences

**Seam:** evidence module (AD-5 artifacts) vs runs/renderer team (AD-9, AD-17, §F).

**Independently compliant units**

- *Evidence team:* Replay frames are artifacts "under this rule" (AD-5): reserved, uploaded, Registered, and "a package seals only when every required artifact is Registered". A lost frame for a `click` blocks the seal → missing required Evidence → `INCONCLUSIVE`.
- *Runs team:* only Evidence-Requirement screenshots are required (FR-10); per-Tool-Action frames are best-effort Replay assets; the Replay asset set is a projection of Timeline events plus frame references, and the "Observation delta" is computed by the renderer from Observation events.

**Divergence:** the same upload failure ends a Run `INCONCLUSIVE` in one build and produces a Replay gap in the other. Additionally the Tool Action's Timeline event is committed "before anything else can observe it" while its frame registers in a later transaction; a renderer that expects the frame id on the Tool Action event renders empty frames live; one that waits violates the 5-second freshness.

**Cites:** AD-5, AD-9, AD-17, FR-10, FR-30, §F Replay asset set, NFR-7.

**Fix (amend AD-5 and AD-9):**
> Artifacts carry `role ∈ {required, replay}`. `required` (Evidence-Requirement snapshots and screenshots, source excerpts, absence snapshots) gate package seal per AD-5. `replay` frames follow the same idempotent registration but a missing or failed frame is recorded as a Timeline `frame_missing` event and flagged on Replay and export, never a Gate failure. The Replay asset set is a versioned projection (AD-14) over Timeline events joined to registered frame references; the worker computes and stores the Observation delta on the Observation-registration event. The renderer treats a Tool Action whose frame is not yet Registered as "frame pending".

### ADV2-14 — Medium — "Registration digest" has no canonical field set or comparison baseline

**Seam:** Administration/identity module (writes registrations) vs procedures module (freezes digests, mints platform-authored drafts, gates Regression Runs).

**Independently compliant units**

- *Administration team:* digest = SHA-256 over the canonical registration row (name, description, kind, origins, application identity, credential reference, permitted actions, attribute labels, updated-at).
- *Procedures team:* digest over the FR-14-enumerated fields only (origin, application identity, credential reference, permitted actions, attribute labels).

**Divergence:** a description edit or credential rotation mints platform-authored drafts for every Procedure and forces Regression Runs in one build and nothing in the other; the digest stored at approval never equals the digest the other module recomputes, so every approval "differs". Second: "when configuration digests differ" compares against "the prior approved version" (FR-15) — the latest `ACTIVE`/`RETIRED`, the latest `APPROVED` including a regression-failed one, or the version the draft was derived from (possibly `REJECTED`) — three baselines.

**Cites:** AD-2, FR-7, FR-14, FR-15, Versioning convention.

**Fix (amend AD-2):**
> A registration digest is SHA-256 over the RFC 8785 canonical JSON of exactly `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns}`, computed by one domain function; identity, name, and description are excluded. The configuration digest compared for Regression gating is the tuple (model, prompt version, tool configuration, registration digests) of the new version against the most recent version of the same Procedure that reached `ACTIVE`; a first version needs no Regression Run.

### ADV2-15 — Medium — Terminal transitions the worker does not perform leave the package unsealed, and cancel has two owners

**Seam:** web supervision (cancel, timeout results) vs evidence module seal vs worker teardown.

**Independently compliant units**

- *Evidence team:* the package seals on `CompleteRun` in the worker.
- *Web team:* cancel from `QUEUED` (no worker holds the job) sets `CANCELED` directly, since "cooperative cancellation" has nobody to cooperate with; cancel from `RUNNING` only writes a cancel request and waits for the worker. Two paths, two audit actors, one command name.

**Divergence:** a Run canceled from `QUEUED` or timed out from a wait has a package that was never sealed; FR-46 export "for any terminal Run" either fails or exports unsealed metadata. If the web sets `CANCELED` and the worker later dequeues the job, an idempotent stage that does not re-read Run state starts the workspace.

**Cites:** AD-3, AD-5, AD-16, FR-26, FR-46, §E Run states.

**Fix (add to AD-3 and AD-5):**
> `SealPackage` is an evidence-module command invoked inside every terminal transition — `CompleteRun`, `FailRun`, wait timeout, and `CancelRun` — by whichever process performs the transition; open reservations are marked `abandoned` and listed on the Result and export. `CancelRun` writes `cancel_requested` on the Run; the transition to `CANCELED` is performed by the worker for `RUNNING`/`PAUSED`/`AWAITING_AUDITOR` at the next boundary or wake, and by the web command itself for `QUEUED`, which also cancels the dispatch job. Every worker stage first re-reads Run state and stops on `cancel_requested`.

### ADV2-16 — Medium — Snapshot substrate kinds, locator grammar, and "label" for adapter Observations are undefined

**Seam:** Adapter team (API/file) vs domain corroboration extractor.

**Independently compliant units**

- *API adapter:* grounds attributes into the stored raw JSON response artifact; `locator` is a JSON pointer; `label` is the key name.
- *Extractor team:* supports accessibility-tree/DOM (web), control tree (desktop), and "parsed sheet (file)" (glossary), with row/column locators and header-cell labels; JSON is not a substrate it re-reads.

**Divergence:** every adapter Observation is `contradictory` (extractor cannot re-read) or the extractor is bypassed for `capture_method = adapter`, silently dropping corroboration for P-2/P-3. FR-7's "expected field label or locator pattern" has no meaning for API keys in one build and is mandatory in the other.

**Cites:** AD-14, AD-18, §B.1 grounding, §H observation corroboration, FR-7, FR-21.

**Fix (amend AD-18 and AD-14):**
> The Structural Snapshot contract enumerates substrate kinds `{web_tree, desktop_tree, sheet, json}` each with a locator grammar and a label rule (accessible name; control name; header cell; property key path). The domain extractor implements all four; the Gate never skips corroboration by `capture_method`. Registrations declare label patterns in the substrate's label rule.

### ADV2-17 — Medium — Notification rows and open waits diverge after an answer

**Seam:** notifications module (delivery worker, in-app rows) vs runs supervision (wait closure).

**Independently compliant units**

- *Notifications team:* creates rows in the wait-entry transaction (AD-20), delivers at-least-once with idempotent send keys, and, since notification records are audit-adjacent, never updates them. The bell lists notification rows.
- *Runs team:* closes the wait on answer; nothing touches notification rows.

**Divergence:** the Escalation is answered before the delivery job runs; the email "Run awaits your answer, 3 h 58 min remaining" is still sent; the bell shows a Run that is no longer waiting, contradicting the EXPERIENCE.md empty state "No Run is waiting on you". "Time remaining" is computed at creation by one team and at send by the other.

**Cites:** AD-16, AD-20, FR-28, EXPERIENCE.md Notifications states and Notification row.

**Fix (amend AD-20):**
> The in-app Notifications surface is a query over open wait records and open flags, not over notification records. A notification record is delivery-tracking only; the delivery worker locks the wait, skips delivery when the wait is already closed (recording outcome `superseded`), and computes time remaining at send.

### ADV2-18 — Low — `once` Schedules are scheduled by one team and manual-only by the other

**Seam:** scheduler vs Builder/procedures.

**Divergence:** AD-19 freezes "frequency, fixed UTC start, period derivation"; §B says `once → the period the Auditor set`; FR-6 allows manual upload only for `once`. The scheduler enqueues one Run at the fixed start and records a missed start when approval happens after it; the procedures team treats `once` as no Schedule. Dashboards then show phantom "upcoming"/"missed" entries in one build.

**Cites:** AD-19, FR-6, FR-11, FR-17, §B.

**Fix (add to AD-19):** `once` has no scheduler entry; its Runs are manual only, and "upcoming scheduled Runs" excludes it.

### ADV2-19 — Medium — The frozen plan is executed by one team and re-derived by the other

**Seam:** web Builder (derives the plan, possibly with a model per FR-12) vs worker executor.

**Independently compliant units**

- *Builder:* stores the derived plan for the Auditor to read; derivation may call `ModelGateway` from the web process; each re-derivation is recorded.
- *Executor:* treats the plan as documentation and re-derives an executable structure from the frozen structured fields at Run start, because the stored plan lacks the tool bindings it needs.

**Divergence:** the plan the Audit Manager approved is not what executes; NFR-4 reproducibility and FR-12 "frozen into the Procedure Version" are satisfied in text only. If derivation used a model, two derivations differ.

**Cites:** AD-2, AD-3, AD-14, FR-12, FR-14.

**Fix (amend AD-2):** The compiled plan is the executable contract (AD-14 versioned) consumed byte-for-byte by the worker; the worker never re-derives. Derivation is a `procedures` command that may use `ModelGateway` only through a queued job, never inside a request; the plan records the deriving model identity and version.

### ADV2-20 — Low — Web-side state changes after `CompleteRun` are Timeline events to one team and audit-only events to the other

**Seam:** runs Timeline writer vs review/evaluation modules.

**Divergence:** sealing, `COMPLETED → INCONCLUSIVE`, confirmations, and finalization are appended by one build as Timeline events (so Live View's "Run ended while open" chrome and Run Detail update) and by another as audit events on the Result/Review chains only, leaving Run Detail stale until refresh. AD-3 also calls the `CompleteRun` checkpoint "final" although the Run can still change state at sealing.

**Cites:** AD-3, AD-17, FR-29, EXPERIENCE.md Live View "Run ended while open".

**Fix (add to AD-17):** every Run state transition, including those performed in the web process, is a Timeline event on the Run chain; evaluation, Result, and Review events live on their own chains and are referenced from the Run Timeline by id. Rename the `CompleteRun` checkpoint "execution-complete".

## Coverage of the requested pairs

| Requested pair / term | Findings |
| --- | --- |
| web Builder vs worker executor | ADV2-09, ADV2-19 |
| Adapter team vs Agent team | ADV2-03, ADV2-16 |
| evaluation module vs review module | ADV2-07, ADV2-08 |
| scheduler vs Run executor | ADV2-05, ADV2-06, ADV2-18 |
| SSE route vs Timeline writer | ADV2-12, ADV2-13, ADV2-20 |
| notifications worker vs Run state machine | ADV2-17 |
| web `SealResult` vs worker `CompleteRun` | ADV2-01, ADV2-08, ADV2-10, ADV2-15 |
| "wait record" | ADV2-02, ADV2-11 |
| "Replay asset" | ADV2-13 |
| "identity attribute" | ADV2-04 |
| "applicability predicate" | ADV2-09 |
| "registration digest" | ADV2-14 |
| "period boundary handover" | ADV2-06 |
| "one Observation per record for adapter Work Items" | ADV2-03, ADV2-16 |
| New AD-16 / AD-17 / AD-18 / AD-19 / AD-20 | ADV2-02, 11 / 12, 13, 20 / 03, 04, 16 / 05, 06, 18 / 17 |
| Amended AD-2 / AD-3 / AD-4 / AD-6 / AD-7 / AD-9 | 14, 19 / 01, 15 / 04, 11 / 07, 09, 10 / 08 / 13 |

## Not re-raised

Revision-1 closures ADV-01..ADV-10 were checked against revision 2 and remain closed. ADV2-07 touches the ADV-02 closure only because revision 2's AD-3 text dropped "Exceptions" from the `CompleteRun` commit list; the atomicity rule itself is intact.

## Gate exit criteria

The gate can pass when the spine binds: (1) `SealResult` as a process-agnostic command invoked from `CompleteRun` and from the last resolving confirmation, with confirmations fenced to `COMPLETED` and serialized on the Result row; (2) one job per wait with a single locked closure path and the answer on the wait record; (3) per-`capture_method` absence evidence and an adapter batch coverage rule; (4) same-snapshot identity grounding; (5) `REGRESSION` Run kind and `(Procedure, period)` ownership with a computed `handover_at`; (6) Exception creation point and `counts_toward_outcome`; (7) the compiled expression as a versioned contract with fail-closed predicate semantics; (8) resume-as-new-attempt with workspace `attach`; and the medium items as AD text or a binding companion.
