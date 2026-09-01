---
title: "Architecture Reviewer Gate — Adversarial Divergence (revision 2)"
artifact: "../ARCHITECTURE-SPINE.md"
review_type: "independent-unit incompatibility attack"
prior_review: "review-adversarial-divergence.md, recheck-adversarial-divergence.md (revision 1, all closed)"
spine_state_reviewed: "revision 2 draft as amended 2026-09-01 20:14 (AD-21, AD-22, registrations module, AD-16 reattach, AD-6 threshold)"
status: complete
date: 2026-09-01
verdict: needs-revision
severity_counts:
  critical: 2
  high: 6
  medium: 9
  low: 3
---

# Adversarial Divergence — Revision 2

## Verdict

**NEEDS-REVISION.** Every revision-1 closure (idempotent artifacts, atomic `CompleteRun`, canonical bytes, versioned contracts, single retry owner, release discipline, recovery unit) survives revision 2 and is not re-raised. The parallel rubric-gate amendment applied during this review closed the largest new hole (AD-21: `SealResult` is one command invoked from `CompleteRun` or the last confirmation) and narrowed two others (AD-16 workspace reattach; the modules row giving `evaluation` Exception creation). Against the amended text, twenty pairs of lower-level units remain that each obey every AD literally and still compose into a system that drops a human's answer, cannot prove absence on adapter paths, evaluates the wrong employee's page, runs one period twice, or never activates a regressed version.

Two findings are critical because they break acceptance Templates outright: the wait record has two jobs (deadline wake, resume) with no ordering or dedup rule, so an answered Escalation can time out; and the Absence Observation contract is written in agent-only terms, so adapter Target Systems (P-3 "no approval", P-2 missing account) can never produce a valid `found = false`.

## Attack method

For each seam, two plausible lower-level units (epics or teams) are built independently from the spine text. Each honors AD-1 dependency direction, uses the stack only behind ports, and follows the cited ADs to the letter. The attack succeeds when the composed system loses a decision, disagrees on state, or produces different terminal outcomes for the same Observations. Findings cite the spine AD, the PRD FR, and the addendum section (§B.1, §E, §E.1, §H are the normative data and state models). Each fix is proposed as AD text.

## Closed in parallel (not counted)

| Scenario this review constructed | Closed by |
| --- | --- |
| Worker `CompleteRun` never seals; web has no confirmation to trigger `SealResult` for all-compiled P-2/P-3 (also reconcile-rev2 C2) | AD-21 |
| Two workers disagree whether to recreate or reattach the browser session after a wait | AD-16 "reattaches to the leased workspace … re-runs the sign-in Session Steps" |
| Evaluation module and review module both create Exception rows | Modules row: `evaluation` owns Exception creation and fingerprints; `review` owns a disposition/assignment aggregate keyed by Exception id |
| Confidence-threshold evaluations need confirmation in one build and not the other | AD-6 threshold sentence |

Residuals of the first three appear below as ADV2-07, ADV2-10, and ADV2-06.

## Findings

### ADV2-01 — Critical — A wait has two jobs, two homes for the answer, and no ordering rule

**Seam:** AD-16 wait lifecycle; web supervision commands vs worker wake handler; Waits convention.

**Independently compliant units**

- *Worker wait team:* on entering `PAUSED`/`AWAITING_AUDITOR` it checkpoints, releases the job, and "schedules a deadline wake" as a pg-boss job with `startAfter = deadline`, using the wait id as singleton key so a restart cannot schedule two wakes. On wake it "enforces the deadline (`INCONCLUSIVE`)".
- *Web supervision team:* `AnswerEscalation` validates expected revision and the wait record, stores the answer on the Escalation aggregate (AD-9: Escalations are typed application objects), and "enqueues one resume job keyed by the wait id" — also singleton key = wait id, same run queue.

**Divergence:** pg-boss singleton semantics deduplicate the second job with the same key while the first is queued: the resume job is silently dropped, and the deadline wake later marks the Run `INCONCLUSIVE` although the answer was committed hours earlier. If the teams use different queues instead, the two jobs race: worker concurrency or two worker instances run the wake and the resume concurrently; the wake sees `now ≥ deadline` and times out a Run whose resume is mid-flight, or the resume continues a Run the wake already ended. Third divergence: the memlog says the resume job carries "the Escalation answer id", the spine says it is "keyed by the wait id", and the convention puts `answer?` on the wait record — three candidate payloads; the worker reads the answer from the wait record, the web wrote it to the Escalation. Fourth: cancel from `AWAITING_AUDITOR` and Pause timeout are also wait closures; whether they are the "second answer" that must be rejected is undefined.

**Cites:** AD-16, Consistency Conventions "Waits", memlog AD-16 entry, FR-25, FR-27, §E Run states.

**Fix (amend AD-16 and the Waits convention):**
> Exactly one durable job exists per wait, created in the wait-entry transaction with `startAfter = deadline` and singleton key `wait:<wait id>`. Every closure of a wait — answer, resume, cancel, abort — is one application command that, in one transaction, locks the wait row `FOR UPDATE`, requires `closed_at IS NULL` and the expected Run revision, writes `{closed_at, closure_kind, answer_option_id, actor}` on the **wait record** (the Escalation aggregate references the wait and never holds the authoritative answer), and moves the wait job's start time to now. The worker's wake handler locks the same row and applies exactly one of: closed → act on `closure_kind`; open and `now ≥ deadline` → `INCONCLUSIVE` with Evidence preserved; open and early → reschedule. A second closure fails the `closed_at IS NULL` precondition. The job payload is `{schemaVersion, runId, waitId}` only.

### ADV2-02 — Critical — The Absence Observation contract is agent-shaped; adapter paths cannot prove absence

**Seam:** Adapter team vs Agent team under AD-18's "one Observation contract"; AD-6 vs addendum §B.1/§H.

**Independently compliant units**

- *Adapter team (P-3 ApproveNow, P-2 AccessGate):* emits one Observation per population record from one extraction (AD-18). For a transaction with no approval in ApproveNow it must emit `found = false`. §B.1 requires "the query string derived from the sanitized Tool Action log (the `type` action into the identified search control)" plus a search-completeness check. An API adapter has no Tool Action, no search control, no `type` action. Reading the letter, the team emits no Observation for absent records, or emits `found = false` without the required fields.
- *Gate team:* implements §H "Search completeness (absence)" and "Per-record coverage" exactly: a `found = false` Observation lacking a Tool-Action-derived query string makes the Work Item `UNINSPECTED`; a record with no Observation is uninspected.

**Divergence:** P-3's core Exception case — "No approval" — can never be evaluated; every population transaction lacking an approval yields `INCONCLUSIVE` in one build, or is "proven absent" through an adapter-synthesized pseudo-Tool-Action in another. The builds disagree on the P-3 golden dataset's terminal outcomes. On the agent path a mirror divergence exists: "the identified search control" is identified by nobody — one Agent team derives the query from the last `type` action before the results snapshot; another requires the registration to declare a search-control locator; mistyped-key and partial-pagination seeds (§D) then yield `UNINSPECTED` in one build and a Compliant absence in the other. Adjacent (raised as reconcile-rev2 C5, not counted here): AD-18's "one Work Item per record per agent-driven Target System" contradicts §C P-4's single agent Work Item owning one Observation per parameter.

**Cites:** AD-6 ("Absence Observations carry query strings derived by the platform from the sanitized Tool Action log"), AD-18, §B.1 Absence Observation, §H search completeness and per-record coverage, §C P-2/P-3 coverage rules, FR-31.

**Fix (amend AD-18; add to the Observation contract):**
> Absence evidence is defined per `capture_method`. **Agent:** the query string is the sanitized `type` Tool Action into the search control the Target System registration declares by locator pattern (FR-7); the empty-result page is a Structural Snapshot; completeness is all result pages consumed. **Adapter:** every lookup or extraction is an *Adapter Action* on the Timeline with the same sanitized-action schema as a Tool Action; the query string is the request key the Adapter sent, recorded by the platform from the request, never from the response; the empty result is the stored response artifact (the Observation's snapshot substrate); completeness is the §H extraction/pagination check. A `found = false` Observation missing its path's absence fields makes the Work Item (agent) or the record (adapter batch) `UNINSPECTED`. An adapter batch Work Item is `OBSERVED` only when every covered record has an Observation with `found ∈ {true, false}`; otherwise `UNINSPECTED` listing the records.

### ADV2-03 — High — "Identity attribute" is grounded in the search results by one team and in the record page by the other; the wrong-page seed passes in one build

**Seam:** Agent team vs Gate/corroboration team; AD-4 "focused-record identity" vs AD-6/§B.1 identity attribute.

**Independently compliant units**

- *Agent/execution team:* platform key matching runs over "captured result rows" (FR-27, AD-9); the row whose grounded key equals the record key is the match; `BrowserExecution` reports "identity of the focused record" (AD-4). The Observation's `identity` attribute is grounded in the **search-results** snapshot (row cell); value attributes are grounded in the **account-page** snapshot.
- *Corroboration team:* re-reads the identity attribute at its grounding and compares it to the normalized record key (§H). Passes.

**Divergence:** §D seeds "one account page of a *different* employee presented as the record's page (identity corroboration must yield Inconclusive)". The search row was correct; the agent opened the wrong row's page. Identity grounded in the results snapshot corroborates; value attributes grounded in the wrong page corroborate too (they truly appear there). The Observation passes the Gate and the wrong employee's status is evaluated. In the other build (identity grounded in the same snapshot as the values) the seed is caught. Second divergence: after a *choose candidate* answer by full name the page may show no employee ID; one team fails identity corroboration (value ≠ key) and marks the record Unevaluated despite `human-matched`; another skips the check entirely — §H's "or the record is flagged human-matched" permits both.

**Cites:** AD-4, AD-6, AD-18, §B.1 `identity`, §H identity corroboration, §D wrong-page seed, FR-27, FR-33.

**Fix (amend AD-6):**
> An Observation's identity attribute is grounded in the **same Structural Snapshot** as each value attribute (one identity grounding per snapshot when attributes span several). Platform key matching over search-result rows is a separate provenance node (`match`: candidate-rows snapshot, matched-row locator, key compared) required in addition to page identity. For `match_origin = human-matched`, page identity corroboration compares the declared secondary key attribute, re-read from the page snapshot, to the record's secondary key value; it is never skipped. AD-4's "focused-record identity" is an adapter capability that supplies a locator; the Gate trusts only the extractor's re-read.

### ADV2-04 — High — Regression Runs cannot be dispatched under the literal ACTIVE-only rule

**Seam:** procedures/approval team vs runs dispatch team vs scheduler. (Reconcile-rev2 C1 records the contradiction; this finding adds the divergent builds and the closure.)

**Independently compliant units**

- *Runs dispatch:* "A Run may reference only an `ACTIVE` version" (AD-2); `InitiateRun` rejects anything else.
- *Approval team:* on approving a version whose configuration digest differs, starts the Regression Run "on an Approved, not yet Active, version" (FR-15; AD-19 "Regression Runs bind to the Template's golden Population Source").

**Divergence:** every Regression Run is rejected at dispatch; no version with a changed model, prompt, tool, or registration digest ever becomes `ACTIVE`; platform-authored drafts pile up. Alternate builds pass the check by flipping the version to `ACTIVE` first — the scheduler (AD-19) then enqueues real Runs on an unregressed version. Also unresolved: who compares terminal outcomes to the golden expectations (procedures vs evaluation); whether a Regression Run's Result seals under AD-21 and enters Review (EXPERIENCE.md: never in Review, yet the approver confirms its Agent-Judged evaluations — a `SealResult` path); and how a Run reaches "Target System fixtures" (§D) when the version's frozen registrations point at the synthetic systems.

**Cites:** AD-2, AD-3, AD-19, AD-21, FR-15, §D, §E Procedure Version states, EXPERIENCE.md Version review states.

**Fix (amend AD-2 and AD-19):**
> A Run carries `kind ∈ {STANDARD, REGRESSION}`. `STANDARD` Runs reference only an `ACTIVE` version. A `REGRESSION` Run references an `APPROVED` version, is started only by the approval command, substitutes the Template's golden Population Source binding for that Run only, keeps the version's frozen Target System registrations (golden Target System fixtures are the synthetic systems seeded with the golden dataset), is exempt from the overlap rule, seals through `SealResult` with the approver's confirmations, never enters Review, and never notifies. The procedures module owns the comparison of terminal outcome and evaluations to the golden expectations and records `RegressionPassed | RegressionFailed` on the version; only `RegressionPassed` (or no regression needed) moves `APPROVED → ACTIVE`.

### ADV2-05 — High — "Period boundary handover" has two owners, two ACTIVE versions, and an overlap key that permits the double Run it exists to prevent

**Seam:** worker scheduler vs procedures version state machine vs manual `InitiateRun`.

**Independently compliant units**

- *Procedures team:* `ApproveVersion` (regression satisfied) sets the successor `ACTIVE` immediately; the predecessor stays `ACTIVE` until "the first period boundary after a successor is `ACTIVE`" (State machines row, §E). Two `ACTIVE` versions coexist; "only `ACTIVE` versions run or schedule".
- *Scheduler team:* per tick, for each `ACTIVE` version with a due period, enqueues one Run under the unique constraint `(Procedure Version, period)` (AD-19). Both versions are `ACTIVE`; both are due; the constraint is per **version**; two Runs for one period are enqueued. FR-14's "no period run twice" is violated by two literal implementations.

**Divergence continued:** which period does the boundary hand over? Successor active on Wednesday, weekly Schedule: the period Mon–Sun containing Wednesday ends Sunday and its Run is due Monday. Scheduler A gives it to the predecessor (period started before the boundary); scheduler B to the successor (Run starts after the boundary); if the successor's frequency changed, "period boundary" refers to different calendars in each. Who writes `ACTIVE → RETIRED` — the worker scheduler at the boundary or the web approval command with a future-dated effect — is unstated, so audit events carry actor "Schedule" or actor "approver" depending on the build. A manual `InitiateRun` for the straddling period picks whichever `ACTIVE` version the UI lists first.

**Cites:** AD-3 ("One active Run per Procedure Version/effective period"), AD-19, FR-14, FR-16, FR-17, §B period derivation, §E Procedure Version states.

**Fix (amend AD-19 and AD-3):**
> `handover_at` is computed once by the approval command as the first period start (per the **successor's** Schedule) strictly after the successor's activation time and stored on both versions. The predecessor owns every effective period whose start is before `handover_at`, including periods whose Run is due after it; the successor owns periods starting at or after `handover_at`. Run uniqueness is enforced on `(Procedure, effective period)` for `STANDARD` Runs, not on the version. `InitiateRun` resolves the version from the requested period's ownership and refuses periods no version owns. The scheduler performs `ACTIVE → RETIRED` for the predecessor in the transaction that enqueues the first Run the successor owns, or on the first tick after `handover_at`, with actor "Schedule".

### ADV2-06 — High — Exceptions are created at registration by one build and at sealing by the other; a rejection deletes one build's disposition history

**Seam:** within `evaluation` (now the owner) between per-Observation registration in the worker and `SealResult`; `review`'s disposition aggregate keyed by Exception id.

**Independently compliant units**

- *Registration-time build:* an Exception is "a record with at least one condition evaluated as violating, whether Rule-Classified or confirmed Agent-Judged" (glossary). It creates the Exception in the registration transaction for `RULE = EXCEPTION` and — because EXPERIENCE.md shows Exception rows whose "only Exception evaluation is Agent-Judged pending" — also for pending `AGENT_JUDGED = EXCEPTION`; identifier and fingerprint assigned then; Live View and FR-41's "Timeline segment where it was found" work.
- *Seal-time build:* creates Exceptions at `SealResult` from the sealed evaluation set, the only moment "counts toward the outcome" is knowable, so an Exception never exists for an evaluation later rejected to Compliant.

**Divergence:** revision-2 AD-3 no longer names Exceptions in the `CompleteRun` commit list (the ADV-02 closure did). Composed: Exception identifiers and fingerprints are assigned at different times, so cross-Run fingerprint comparison (FR-41, Rerun convention) differs between builds; in the registration-time build a rejection to Compliant either deletes an Exception that already carries `review` assignment and `UNDER_REVIEW` state — violating AD-7's "retains history" — or leaves an Exception that does not count, with no field to say so.

**Cites:** AD-3, AD-6, AD-7, AD-21, FR-41, FR-42, §E Exception states, §E.1, EXPERIENCE.md Exception list row, Modules row.

**Fix (add to AD-6):**
> The evaluation module creates an Exception in the transaction that records the first evaluation with value `EXCEPTION` for a record (origin `RULE`, `AGENT_JUDGED`, or `HUMAN`), assigns its Run-stable identifier and fingerprint then, and never deletes it. An Exception carries `counts_toward_outcome`, computed at `SealResult`: true when any current evaluation on the record is `EXCEPTION` with origin `RULE`, confirmed `AGENT_JUDGED`, or `HUMAN`; an Exception whose every `EXCEPTION` evaluation was rejected to Compliant is retained with `counts_toward_outcome = false` and reason `superseded by rejection`. `review` assignment and disposition are permitted only after sealing. `CompleteRun` commits the Exceptions created so far; `SealResult` commits `counts_toward_outcome`.

### ADV2-07 — High — Confirmations are not fenced to `COMPLETED`, and the "last confirmation" seal is a cross-aggregate read that no revision precondition serializes

**Seam:** evaluation confirmation commands (web) vs `CompleteRun` (worker) vs AD-21 seal trigger. Residual after AD-21.

**Independently compliant units**

- *Confirmation team:* accepts `ConfirmEvaluation` as soon as an Agent-Judged evaluation exists — at Observation registration, while the Run is `RUNNING` and the Auditor watches Live View (AD-6 registers `AGENT_JUDGED` pending at registration). It requires the expected revision of the **evaluation** (AD-7: evaluations are a separate aggregate), commits, counts pending, and invokes `SealResult` when zero, per AD-21 "the last confirmation or rejection invokes it".
- *Runs team:* assumes confirmations start after `COMPLETED`; `CompleteRun` "publishes the Result … and computes the pending-confirmation count".

**Divergence:** (a) the "last" confirmation during `RUNNING` seals before the Run-level Gate ran; `CompleteRun` then publishes a Result that is already sealed and refuses, or re-publishes over it. (b) Two Auditors confirm the last two pending evaluations concurrently; under read-committed each sees the other's still pending; neither invokes `SealResult` — the Run is stuck exactly as in the scenario AD-21 was written to close; under another interleaving both seal and the Result version increments twice for one seal. The expected-revision rule is bound to the wrong aggregate for this decision.

**Cites:** AD-6, AD-7, AD-21, FR-38, FR-40, Commands and mutation convention.

**Fix (add to AD-21):**
> `ConfirmEvaluation` and `RejectEvaluation` are refused unless the Run is `COMPLETED` and its Result unsealed; while `RUNNING`, pending Agent-Judged evaluations are read-only in Live View. Both commands carry the expected **Result** revision, lock the Result row `FOR UPDATE`, mutate the evaluation, increment the Result revision, and evaluate the seal condition inside that lock; the Result row is the serialization point for every mutation that can change the pending count or the System Outcome.

### ADV2-08 — High — The compiled condition and applicability-predicate language is not a named durable contract, and its semantics over missing, contradictory, and model-read attributes are open

**Seam:** web Builder (compiles at approval) vs domain evaluator (executes in the worker).

**Independently compliant units**

- *Builder team:* compiles conditions and predicates "at approval" into an expression AST stored on the Procedure Version; predicates evaluate over the Observation's declared attributes as captured.
- *Evaluator team:* evaluates predicates over the **corroborated** view — an attribute marked `contradictory` is "treated as not captured" (§B.1's rule for ungrounded attributes) — so a predicate that references it is not applicable; the condition then needs no evaluation, condition completeness passes, and the record can be Compliant on its remaining conditions.

**Divergence:** the §D transcription-error seed (`Active` shown, `disabled` recorded) makes `account_status` contradictory. Build A: predicate applicable, condition Unevaluated, record Unevaluated (safe). Build B: predicate not applicable for a condition written as `applicability: account_status is present`, nothing to evaluate, record Compliant on the rest — false assurance. Further choices two compliant builds make differently: original vs normalized value in predicates; three-valued logic for `found = ambiguous`; whether a predicate may reference a model-read attribute (then "the agent never decides applicability" is violated); whether P-1's C2 Agent-Judged evaluation must arrive **inside** the registration transaction ("A found account with no C2 evaluation is a Gate failure" runs per Observation per AD-6) or as a later command, in which case every found account fails condition completeness spuriously. AD-14 lists "compiled plans" but not the condition/predicate expression as a versioned boundary.

**Cites:** AD-2, AD-6, AD-14, FR-9, FR-33, FR-38, §B.1 per-condition evaluations, §D seeds, §H condition completeness.

**Fix (amend AD-6 and AD-14):**
> The compiled condition and applicability-predicate expression is a versioned `application` contract (AD-14) with one domain interpreter used by the Builder preview, the Regression comparison, and the worker evaluator. Predicates evaluate over `found`, `match_origin`, and **normalized** values of attributes whose corroboration is `matched`; a predicate referencing an attribute that is absent, `contradictory`, or `model_read` evaluates *applicable* (fail-closed) and the condition's evaluation is `UNEVALUATED` with a diagnostic naming the attribute. `found = ambiguous` makes every condition applicable and Unevaluated. Model-read attributes may not appear in predicates; the Builder refuses them. The Observation registration envelope carries the agent's evaluations for every uncompiled applicable condition; registration is one transaction.

### ADV2-09 — Medium — Which `UNEVALUATED` values fail the Gate at `CompleteRun` and which survive to sealing is decided differently by the Gate team and the sealer

**Seam:** Run-level Gate (worker) vs `SealResult` on "Unevaluated is a value with an origin".

**Independently compliant units**

- *Gate team:* §H "Condition completeness — every condition has an evaluation for every record its predicate selects". A below-threshold Agent-Judged evaluation stored as `UNEVALUATED` (AD-6) *is* an evaluation; the Gate passes; the Run is `COMPLETED` with zero pending.
- *Sealer:* AD-21 moves `COMPLETED → INCONCLUSIVE` only "when a rejection left a condition Unevaluated"; a threshold-Unevaluated with no counting Exception is neither Pass (blocked by §E.1) nor Control Failure nor `INCONCLUSIVE`. One sealer emits `INCONCLUSIVE` anyway, another Pass with the record listed, a third refuses to seal — inside the `CompleteRun` transaction.

**Cites:** AD-6, AD-21, FR-38, FR-40, §E.1 rows 5–7, §H condition completeness.

**Fix (amend AD-6):**
> At the Run-level Gate, any current evaluation with value `UNEVALUATED` whose origin is not `HUMAN` is a condition-completeness failure → `INCONCLUSIVE` at `CompleteRun`. Only human rejection can introduce `UNEVALUATED` after `COMPLETED`, which is the sole trigger of `COMPLETED → INCONCLUSIVE` at sealing.

### ADV2-10 — Medium — "Continues from the checkpointed Tool Action" restarts a Step Execution in one build and replays a persisted model conversation in the other

**Seam:** AD-15 (a waiting Run resumes on a new worker build) vs AD-16 vs the Agent team's model loop. Residual after AD-16's reattach rule.

**Independently compliant units**

- *Worker A:* the checkpoint is the application checkpoint (stage, Work Item, Tool Action ordinal, workspace lease). On resume the model loop restarts the current Step Execution from its first Tool Action; Observations dedupe by idempotency key (NFR-8), but the Timeline shows the Step Execution twice and the retry budget is charged; a second restart triggers *retry or skip*.
- *Worker B:* persists the in-flight model conversation (messages, tool results, provider response ids) in the checkpoint and continues mid-turn with "only the chosen option identifier" — a provider-shaped durable contract AD-14 does not list, which must survive a worker build change and a provider switch.

**Cites:** AD-9, AD-14, AD-15, AD-16, NFR-8, FR-25.

**Fix (amend AD-16):**
> Resume restarts the **current Step Execution** from its first Tool Action as a new attempt that is not charged to the Step Execution retry budget; the earlier attempt's Tool Actions remain on the Timeline marked `superseded_by_resume`. No model conversation state is persisted or required across a wait; the model is re-briefed from the frozen plan, the Work Item, and the chosen option identifier. `BrowserExecution`/`DesktopExecution` conformance includes `attach(WorkspaceRef)` preserving the signed-in session, and `release`.

### ADV2-11 — Medium — Timeline `seq` is allocated by one team and assumed commit-ordered by the other

**Seam:** Timeline writer (worker and web both append) vs SSE route (`after=<seq>` cursor).

**Independently compliant units**

- *Writer:* allocates `seq` from a per-Run counter or global sequence at insert; web commands (answer, pause, flag, confirmation) and the worker append concurrently.
- *SSE route:* on `NOTIFY(run_id, seq)` queries `seq > cursor`, sends, advances the cursor.

**Divergence:** event 10 (web, long transaction) commits after event 11 (worker); the client has cursor 11; the NOTIFY for 10 arrives; the query returns nothing; event 10 is never shown, and reconnect replay repeats the miss. AD-22's per-aggregate chain "using a transactionally allocated sequence/head" gives commit-ordered gapless numbering only if the Timeline **is** the Run's audit chain and every writer takes the head lock — AD-17 does not say so, so the runs team keeps a separate Timeline table with its own sequence.

**Cites:** AD-8, AD-17, AD-22, Live channel convention, glossary (Timeline events are Audit Trail events).

**Fix (amend AD-17):**
> Timeline events are the Run aggregate's AD-22 chain events; `seq` is the chain sequence allocated under the Run head row lock, so it is gapless and commit-ordered across web and worker writers. `NOTIFY` is issued in the same transaction. The SSE route replays `seq > cursor` in order and never skips.

### ADV2-12 — Medium — "Replay asset" is a seal-gating Evidence artifact to one team and a best-effort projection to the other

**Seam:** evidence module (AD-5 artifacts) vs runs/renderer team (AD-9, AD-17, §F).

**Independently compliant units**

- *Evidence team:* Replay frames are artifacts "under this rule" (AD-5) and "a package seals only when every required artifact is Registered". A lost frame for a `click` blocks the seal → missing required Evidence → `INCONCLUSIVE`.
- *Runs team:* only Evidence-Requirement screenshots are required (FR-10); per-Tool-Action frames are best-effort; the Replay asset set is a projection over Timeline events plus frame references; the "Observation delta" is computed by the renderer from Observation events.

**Divergence:** the same upload failure ends a Run `INCONCLUSIVE` in one build and produces a Replay gap in the other. Additionally the Tool Action's Timeline event commits "before anything else can observe it" while its frame registers in a later transaction; a renderer expecting the frame id on the Tool Action event renders empty frames live; one that waits violates the 5-second freshness.

**Cites:** AD-5, AD-9, AD-17, FR-10, FR-30, §F Replay asset set, NFR-7.

**Fix (amend AD-5 and AD-9):**
> Artifacts carry `role ∈ {required, replay}`. `required` (Evidence-Requirement snapshots and screenshots, source excerpts, absence snapshots) gate the package seal. `replay` frames follow the same idempotent registration, but a missing or failed frame is a Timeline `frame_missing` event flagged on Replay and export, never a Gate failure. The Replay asset set is a versioned projection (AD-14) over Timeline events joined to registered frame references; the worker computes and stores the Observation delta on the Observation-registration event. The renderer treats a Tool Action whose frame is not yet Registered as "frame pending".

### ADV2-13 — Medium — "Registration digest" has no canonical field set or comparison baseline

**Seam:** the new `registrations` module (computes digests, emits draft-minting change events) vs `procedures` (freezes digests, gates Regression Runs).

**Independently compliant units**

- *Registrations team:* digest = SHA-256 over the canonical registration row (name, description, kind, origins, application identity, credential reference, permitted actions, attribute labels, updated-at).
- *Procedures team:* digest over the FR-14-enumerated fields only (origin, application identity, credential reference, permitted actions, attribute labels).

**Divergence:** a description edit or credential rotation mints platform-authored drafts for every Procedure and forces Regression Runs in one build and nothing in the other; the digest frozen at approval never equals the digest the other module recomputes, so every approval "differs". Second: "when configuration digests differ" compares against "the prior approved version" (FR-15) — the latest `ACTIVE`/`RETIRED`, the latest `APPROVED` including a regression-failed one, or the version the draft was derived from (possibly `REJECTED`) — three baselines.

**Cites:** AD-2, FR-7, FR-14, FR-15, Modules row (`registrations`), Versioning convention.

**Fix (amend AD-2):**
> A registration digest is SHA-256 over the RFC 8785 canonical JSON of exactly `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns}`, computed by one domain function owned by `registrations`; identity, name, and description are excluded. The configuration digest compared for Regression gating is the tuple (model, prompt version, tool configuration, registration digests) of the new version against the most recent version of the same Procedure that reached `ACTIVE`; a first version needs no Regression Run.

### ADV2-14 — Medium — Terminal transitions the worker does not perform leave the package unsealed, and `CANCELED` has two writers

**Seam:** web supervision (cancel, deadline outcomes) vs evidence module seal vs worker teardown. The amended State machines row adds "any active state `→ CANCELED` on explicit cancel" without naming the writer.

**Independently compliant units**

- *Evidence team:* the package seals on `CompleteRun` in the worker.
- *Web team:* cancel from `QUEUED` (no worker holds the job) writes `CANCELED` directly, since "cooperative cancellation" has nobody to cooperate with; cancel from `RUNNING` only records a request and waits for the worker. Two paths, two audit actors, one command name.

**Divergence:** a Run canceled from `QUEUED` or timed out from a wait has a package that was never sealed; FR-46 export "for any terminal Run" fails or exports unsealed metadata. If the web sets `CANCELED` and the worker later dequeues the job, an idempotent stage that does not re-read Run state creates the workspace.

**Cites:** AD-3, AD-5, AD-16, FR-26, FR-46, State machines row.

**Fix (add to AD-3 and AD-5):**
> `SealPackage` is an evidence-module command invoked inside every terminal transition — `CompleteRun`, `FailRun`, wait timeout, and `CancelRun` — by whichever process performs the transition; open reservations are marked `abandoned` and listed on the Result and export. `CancelRun` writes `cancel_requested` on the Run; the transition to `CANCELED` is performed by the worker for `RUNNING`/`PAUSED`/`AWAITING_AUDITOR` at the next Tool Action boundary or wake, and by the web command itself for `QUEUED`, which also cancels the dispatch job. Every worker stage first re-reads Run state and stops on `cancel_requested`.

### ADV2-15 — Medium — Snapshot substrate kinds, locator grammar, and "label" for adapter Observations are undefined

**Seam:** Adapter team (API/file) vs domain corroboration extractor.

**Independently compliant units**

- *API adapter:* grounds attributes into the stored raw JSON response artifact; `locator` is a JSON pointer; `label` is the key name.
- *Extractor team:* supports accessibility-tree/DOM (web), control tree (desktop), and "parsed sheet (file)" (glossary), with row/column locators and header-cell labels; JSON is not a substrate it re-reads.

**Divergence:** every adapter Observation is `contradictory` (the extractor cannot re-read it), or the extractor is bypassed for `capture_method = adapter`, silently dropping corroboration for P-2/P-3. FR-7's "expected field label or locator pattern" is meaningless for API keys in one build and mandatory in the other.

**Cites:** AD-14, AD-18, §B.1 grounding, §H observation corroboration, FR-7, FR-21.

**Fix (amend AD-18 and AD-14):**
> The Structural Snapshot contract enumerates substrate kinds `{web_tree, desktop_tree, sheet, json}`, each with a locator grammar and a label rule (accessible name; control name; header cell; property key path). The domain extractor implements all four; the Gate never skips corroboration by `capture_method`. Registrations declare label patterns in the substrate's label rule.

### ADV2-16 — Medium — Notification rows and open waits diverge after an answer

**Seam:** notifications module (delivery worker, in-app rows) vs runs supervision (wait closure).

**Independently compliant units**

- *Notifications team:* creates rows in the wait-entry transaction (AD-20), delivers at-least-once with idempotent send keys, and never updates them. The bell lists notification rows.
- *Runs team:* closes the wait on answer; nothing touches notification rows.

**Divergence:** the Escalation is answered before the delivery job runs; the email "awaits your answer, 3 h 58 min remaining" is still sent; the bell shows a Run that is no longer waiting, contradicting the EXPERIENCE.md empty state "No Run is waiting on you". "Time remaining" is computed at creation by one team and at send by the other.

**Cites:** AD-16, AD-20, FR-28, EXPERIENCE.md Notifications states and Notification row.

**Fix (amend AD-20):**
> The in-app Notifications surface is a query over open wait records and open flags, not over notification records. A notification record is delivery-tracking only; the delivery worker locks the wait, skips delivery when the wait is already closed (outcome `superseded`), and computes time remaining at send.

### ADV2-17 — Medium — The frozen plan is executed by one team and re-derived by the other

**Seam:** web Builder (derives the plan, possibly with a model per FR-12) vs worker executor.

**Independently compliant units**

- *Builder:* stores the derived plan for the Auditor to read; derivation may call `ModelGateway` from the web process; each re-derivation is recorded.
- *Executor:* treats the stored plan as documentation and re-derives an executable structure from the frozen structured fields at Run start, because the stored plan lacks the tool bindings it needs.

**Divergence:** the plan the Audit Manager approved is not what executes; NFR-4 and FR-12's "frozen into the Procedure Version" hold in text only. If derivation used a model, two derivations differ, and the web process makes a model call inside a request.

**Cites:** AD-2, AD-3, AD-14, FR-12, FR-14.

**Fix (amend AD-2):** the compiled plan is the executable contract (AD-14 versioned) consumed byte-for-byte by the worker; the worker never re-derives. Derivation is a `procedures` command that may use `ModelGateway` only through a queued job, never inside a request; the plan records the deriving model identity and version.

### ADV2-18 — Low — `once` Schedules are scheduled by one team and manual-only by the other

**Seam:** scheduler vs Builder/procedures.

**Divergence:** AD-19 freezes "frequency, fixed UTC start, period derivation"; §B says `once → the period the Auditor set`; FR-6 allows manual upload only for `once`. The scheduler enqueues one Run at the fixed start and records a missed start when approval happens after it; the procedures team treats `once` as no Schedule. Dashboards show phantom "upcoming"/"missed" entries in one build.

**Cites:** AD-19, FR-6, FR-11, FR-17, §B.

**Fix (add to AD-19):** `once` has no scheduler entry; its Runs are manual only, and "upcoming scheduled Runs" excludes it.

### ADV2-19 — Low — Web-side state changes after `CompleteRun` are Timeline events to one team and audit-only events to the other

**Seam:** runs Timeline writer vs evaluation/review modules.

**Divergence:** sealing, `COMPLETED → INCONCLUSIVE`, confirmations, and finalization are appended by one build as Timeline events (so Live View's "Run ended while open" chrome and Run Detail update) and by another only as audit events on the Result/Review chains, leaving Run Detail stale until refresh. AD-3 also calls the `CompleteRun` checkpoint "final" although the Run can still change state at sealing.

**Cites:** AD-3, AD-17, AD-21, FR-29, EXPERIENCE.md Live View "Run ended while open".

**Fix (add to AD-17):** every Run state transition, including those performed in the web process, is a Timeline event on the Run chain; evaluation, Result, and Review events live on their own chains and are referenced from the Run Timeline by id. Rename the `CompleteRun` checkpoint "execution-complete".

### ADV2-20 — Low — Reference Sources are acquired "before evaluation" at Run start by one adapter team and before the Run-level Gate by the other

**Seam:** the amended AD-18 sentence vs per-Observation evaluation at registration (AD-3, AD-6).

**Divergence:** AD-18 now says Reference Sources are "frozen into the Evidence Package before evaluation; the evaluator receives their parsed content as an input value". Evaluation happens at each Observation registration during execution. Adapter team A acquires RoleMatrix in the first Session Step; team B acquires it after the last Work Item ("before evaluation" read as before the Run-level Gate). In build B every P-2 `RULE` evaluation at registration lacks its expansion input and is `UNEVALUATED`, or the evaluator performs I/O it is forbidden.

**Cites:** AD-3, AD-6, AD-18, §C P-2.

**Fix (amend AD-18):** Reference Source acquisition Session Steps are ordered in the compiled plan before the first Work Item; a Run whose Reference Source acquisition fails is `RUN_FAILED` before any Work Item starts.

## Coverage of the requested pairs

| Requested pair / term | Findings |
| --- | --- |
| web Builder vs worker executor | ADV2-08, ADV2-17 |
| Adapter team vs Agent team | ADV2-02, ADV2-15, ADV2-20 |
| evaluation module vs review module | ADV2-06, ADV2-07 |
| scheduler vs Run executor | ADV2-04, ADV2-05, ADV2-18 |
| SSE route vs Timeline writer | ADV2-11, ADV2-12, ADV2-19 |
| notifications worker vs Run state machine | ADV2-16 |
| web `SealResult` vs worker `CompleteRun` | ADV2-07, ADV2-09, ADV2-14 (primary scenario closed by AD-21) |
| "wait record" | ADV2-01, ADV2-10 |
| "Replay asset" | ADV2-12 |
| "identity attribute" | ADV2-03 |
| "applicability predicate" | ADV2-08 |
| "registration digest" | ADV2-13 |
| "period boundary handover" | ADV2-05 |
| "one Observation per record for adapter Work Items" | ADV2-02, ADV2-15 |
| New AD-16 / AD-17 / AD-18 / AD-19 / AD-20 | 01, 10 / 11, 12, 19 / 02, 03, 15, 20 / 04, 05, 18 / 16 |
| Amended AD-2 / AD-3 / AD-4 / AD-6 / AD-7 / AD-9 / AD-21 | 13, 17 / 14 / 03, 10 / 06, 08, 09 / 07 / 12 / 07, 09 |

## Not re-raised

Revision-1 closures ADV-01..ADV-10 were checked against the amended revision 2 and remain closed. ADV2-06 touches the ADV-02 closure only because revision 2's AD-3 dropped "Exceptions" from the `CompleteRun` commit list; the atomicity rule itself is intact. Reconcile-rev2 C1 (Regression Run vs ACTIVE-only), C2 (sealing trigger, now closed by AD-21), and C5 (P-4 Work Item shape) overlap ADV2-04, the closed table, and ADV2-02 respectively and should be counted once.

## Gate exit criteria

The gate can pass when the spine binds: (1) one job per wait with a single locked closure path and the answer on the wait record; (2) per-`capture_method` absence evidence and an adapter batch coverage rule; (3) same-snapshot identity grounding with a separate `match` node; (4) a `REGRESSION` Run kind; (5) `(Procedure, period)` ownership with a computed `handover_at` and a named `RETIRED` writer; (6) Exception creation at first `EXCEPTION` evaluation with `counts_toward_outcome`; (7) confirmations fenced to `COMPLETED` and serialized on the Result row; (8) the compiled expression as a versioned contract with fail-closed predicate semantics; and the medium items as AD text or a binding companion.
