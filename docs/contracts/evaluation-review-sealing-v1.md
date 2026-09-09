# Agent-Judged evaluation, human review and sealing, version 1

How a model proposal becomes an evaluation, how a human confirms or rejects one, and how a
Result finally seals (Epic 4, Stories 4.8–4.9, FR-27, AD-2, AD-12). Normative for every
producer that writes an `AGENT_JUDGED` evaluation and for every surface that decides one.

Read with `deterministic-evaluation-v1.md` (the rules engine), `run-result-v1.md` (§E.1 and
the seal) and `observation-registration-v1.md` (the one write path).

## Purpose

Some frozen conditions are Agent-Judged. A model may propose a value for one, with a
confidence and a rationale; it may never write an evaluation. The deterministic compiler
stays the only rules engine, the proposal is retained immutably beside the effective row,
and a Run whose evaluation is still awaiting a person does not seal.

## Vocabulary

| Term | Meaning |
|---|---|
| Proposal | `AgentJudgedProposal` = `{observationId, conditionId, value, confidence, rationale}`. No Evidence ids — "Evidence belongs to the platform-captured Observation" |
| Confirmation | `EvaluationConfirmation`: `pending`, `confirmed`, or `null` |
| Review revision | `run_result_review.revision`, the compare-and-set token for review decisions. Separate from `run_result.version` and `audit_run.revision` |
| Decision | One immutable `run_evaluation_review` row: the original AND the effective evaluation, the actor and the instant |
| Command | One durable `run_evaluation_review_command` row: `PENDING`, `SUCCEEDED` or `REFUSED` |
| Effective evaluation | The machine row overlaid by any decision — `effective-evaluation.ts` |

## The evaluation-phase model turn

1. **Evaluation is a SEPARATE turn, after the capture.** `finishObservation`
   (`execute-agent-work-item.ts`) builds an `AgentModelRequest` with `phase: 'evaluation'`,
   `retrieved: []` and `tools: []`. `validateRequest` in the gateway requires exactly that:
   an evaluation request with any tool is `invalid-request`.
2. **The conditions offered are the applicable Agent-Judged ones, computed by the
   compiler.** `applicableAgentConditionIds` (`agent-rule-evaluation.ts`) runs
   `evaluateComplianceRecord` with valid evidence facts "solely to read its `applicable`
   field", and keeps the rows `agentJudgedNeedsProposal` accepts: `origin === 'AGENT_JUDGED'
   && applicable === true` and NOT decided by a frozen role-privilege policy (item 12a). The
   model cannot infer applicability from prose or from its own answer.
3. **The Observation the model is shown is the JUDGED copy.** `finishObservation` runs
   `snapshotCorroboration([snapshot]).corroborate(...)` first and passes the record with the
   real identity and attribute verdicts — the code's own words: "Leaving these fields null
   would tell the model corroboration had not been performed." The registration transaction
   independently repeats those checks over the ORIGINAL record.
4. **The Observation identity is frozen in the request.** `parseOutput` writes
   `observationId: request.evaluation.observationId` onto every proposal; the response
   schema has no identity field, and a `conditionId` outside the offered set or a duplicate
   is `invalid-selection`.
5. **Model uncertainty on the evaluation turn is a typed wait, not a value.**
   `turn.response.uncertainty.kind !== 'none'` raises `retry-or-skip` with diagnostic
   `insufficient-evidence`.
6. **A proposal is validated at the application boundary before any write.**
   `isAgentJudgedProposal` requires exactly the five keys, bounded text, a value in
   `{COMPLIANT, EXCEPTION, UNEVALUATED}`, and a confidence that is a decimal string in
   `[0,1]` and is not `-0`.

## The proposal becomes an evaluation

`agentRuleEvaluation(inputs).evaluateWithAgentProposals(subjects, proposals)` is the
proposal-bearing counterpart to `ruleEvaluation`; both call the same
`evaluateObservationRecord`.

7. **The compiler remains the only rules engine.** It "receives only the value/confidence
   part of each already validated proposal"; applicability and every Rule-Classified
   condition come from the frozen version.
8. **A duplicate or missing population key resolves to `null`, never first-wins.**
   `indexPopulation` sets `null` for a key it has already seen — "so the domain evaluator
   cannot accidentally choose first-wins or last-wins data for a deterministic conclusion".
9. **`pending` is set only above the frozen threshold, and only where a value can stand.**
   In `evaluateObservationRecord` (`packages/domain/src/runs/evaluation.ts`):
   `pending = validAgent && value !== 'UNEVALUATED' &&
   compareComplianceDecimals(agent.confidence, fields.agentJudgedThreshold) >= 0`.
   Below the threshold the effective value is `UNEVALUATED` and there is no control; a
   rule, an inapplicable condition or unsupported Evidence never becomes pending.
10. **The Compliant floor applies first.** `supportable = condition.value !== 'COMPLIANT'
    || (canBeCompliant(coverage) && corroborationAllowsCompliant(corroboration))`; an
    unsupportable Compliant becomes `UNEVALUATED` with `UNSUPPORTABLE_COMPLIANT` in its
    diagnostic, and therefore is never pending either.
11. **Proposals are emitted in the frozen condition order, filtered to conditions the
    version actually evaluates** — "rather than trusting object-key order from an adapter
    payload".
12. **Unknown applicability is not a missing judgment.** Where the frozen evaluator returns
    `MISSING_OBSERVATION_FIELD` for Agent-Judged applicability, the row stays `UNEVALUATED`
    with no proposal; registration rejects a proposed or conclusive output for that state.
12a. **A frozen role-privilege policy (2026-09-08) decides some rows without the model and
    backstops the rest.** Under `deterministic-evaluation-v1.md`'s "Role-privilege policy"
    section: unreadable roles are the missing-field case and an unnamed role is §B's unnamed
    value — both need no proposal and are excluded from the offered conditions by the shared
    `agentJudgedNeedsProposal`; the unnamed role raises `unnamed-value` before any model turn.
    A proposal the policy contradicts is `UNEVALUATED` with `POLICY_CONTRADICTED` in its
    diagnostic and is treated by the producer as a rejected model answer
    (`model-policy-contradiction`, bounded retry, then `retry-or-skip`). A consistent
    privileged EXCEPTION is labelled `retained privileged assignment <roles>` and is still
    `pending` human confirmation.
13. **The machine proposal is stored beside the effective value.** Generation 36 adds
    `agent_proposed_value`, `agent_proposed_confidence` and `agent_proposed_rationale` to
    `run_observation_evaluation`, pinned by `run_observation_evaluation_agent_proposal`, and
    `run_observation_evaluation_immutable` refuses any update to that table.

## PENDING_CONFIRMATION

14. **A pending evaluation is an §E.1 outcome, and it is the only unsealed one.**
    `OUTCOME_ROWS` row `pending-confirmation` matches on `facts.pending > 0`;
    `run_result_sealed` (generation 25) is `sealed = (outcome <> 'PENDING_CONFIRMATION')`.
15. **The Result is written at version 1 and can be updated exactly once.**
    `run_result_immutable` (generation 25) raises when `OLD.sealed`, and otherwise requires
    `NEW.sealed` and `NEW.version = OLD.version + 1` — "An unsealed Result may only be
    sealed, once, raising its version".
16. **`completeRun` writes the pending Result; `sealResult` is what seals it.**
    `sealResult(context, input)` returns `null` unless both the input state and the Run
    state are `COMPLETED`, returns the existing row when it is already sealed, throws when
    an unsealed Result is not `PENDING_CONFIRMATION`, returns the row unchanged while any
    condition count still has `confirmation === 'pending'` with a `total > 0`, and otherwise
    calls `publishResult`.
17. **`publishResult` is the ONE outcome implementation** for initial completion and for
    the final review answer. It re-reads the Gate verdict, the condition counts and the
    findings, calls `systemOutcome`, moves the Run state FIRST when §E's `COMPLETED →
    INCONCLUSIVE` applies, seals the Evidence package, then reads the registered artifacts
    "after the seal, so it sees the artifacts in their settled state".

## The durable review command

The web authorizes and enqueues; the worker decides. `dispatchEvaluationReview` →
`run_evaluation_review_command` + pg-boss `EVALUATION_REVIEW_QUEUE` →
`executeEvaluationReviewCommand` → `reviewEvaluationInContext`.

18. **The web never writes a decision.** It checks the role
    (`authorizeCommandRole` on `evaluation.confirm` / `evaluation.reject`), parses the
    request, bounds the actor and session identity, and enqueues.
19. **A duplicate in-flight command is refused with a closed response.** The partial unique
    index `run_evaluation_review_command_target_uidx` on
    `(run_id, observation_id, condition_id, expected_review_revision) WHERE status =
    'PENDING'` produces `conflict`; the dispatcher returns a fixed sentence "even if a
    future adapter gets the conflict path wrong" — an authored rationale and another
    actor's identity must not be reflected back.
20. **A refusal is immutable and a fresh retry is still possible.** Pending-only uniqueness
    means a `REFUSED` row does not block a new command;
    `run_evaluation_review_command_immutable` refuses any change to a terminal row and to
    every request field of a pending one.
21. **The command row records exactly the columns its status allows.**
    `run_evaluation_review_command_completion` pins `PENDING` (all outcome columns NULL),
    `SUCCEEDED` (decision id, review revision ≥ 1, result version ≥ 1, an outcome from the
    closed §E.1 set, `result_sealed`, `processed_at`) and `REFUSED` (a `refusal_code` from
    the closed set, `processed_at`, nothing else).
22. **Nothing is marked complete before the review transaction succeeds.**
    `executeEvaluationReviewCommand` calls `context.completeCommand(completion(result))`
    inside the same `transactionCommand`; "Any thrown error leaves the row PENDING so
    pg-boss can retry it". A terminal command returns `null` and is acknowledged as a safe
    duplicate.
23. **Recovery resends pending commands with no live delivery.**
    `startEvaluationReviewRecovery` re-sends at most 100 rows per pass.

## The decision itself

`reviewEvaluationInContext(dependencies, context, input, action, options)`.

24. **The role is re-read inside the locked transaction.**
    `context.authorizationRoles.findRole` then `authorizeAction`; a denial appends
    `security.denied` with the action, the role and the reason and refuses `unauthorized`.
25. **The preconditions are checked against the locked rows, in order.** Run exists →
    `run.state === 'COMPLETED'` → a Result exists → not `sealed` → `runState ===
    'COMPLETED'` → `outcome === 'PENDING_CONFIRMATION'` → the review revision equals the
    caller's expectation → the target exists in this Run → `origin === 'AGENT_JUDGED'` and
    `confirmation === 'pending'` → no prior decision for that key.
26. **There are exactly two actions and no edit or delete.**
    `EVALUATION_REVIEW_ACTIONS = ['confirm', 'reject']`.
27. **A rejection requires BOTH a replacement value and a rationale.**
    `parseEvaluationReviewRequest` refuses a `confirm` carrying either key, and refuses a
    `reject` without a replacement in `{COMPLIANT, EXCEPTION, UNEVALUATED}`
    (`invalid-replacement`) or without a non-blank rationale of at most 4000 characters
    (`rationale-required`).
28. **The decision copies the original the reviewer saw.** `originalOrigin`,
    `originalValue`, `originalConfirmation`, `originalConfidence`, `originalRationale` and
    `originalEvidenceIds` are taken from the locked target "so later effective-value changes
    do not overwrite the proposal that a reviewer actually saw".
29. **The ledger row's shape is pinned by the database.**
    `run_evaluation_review_shape` (generation 36): a `confirm` must keep
    `effective_origin = 'AGENT_JUDGED'`, `effective_value = original_value`,
    `effective_confirmation = 'confirmed'`, and both rejection columns NULL; a `reject` must
    have `effective_origin = 'HUMAN'`, a NULL confirmation, a replacement value and a
    non-blank rationale.
30. **The trigger re-derives every binding rather than trusting the copies.**
    `run_evaluation_review_binding_guard` locks `audit_run FOR UPDATE` (must be
    `COMPLETED`), locks `run_result FOR UPDATE` (must be unsealed, `PENDING_CONFIRMATION`,
    `run_state = 'COMPLETED'`), locks `run_result_review FOR UPDATE` (revision must equal
    `NEW.review_revision`), reads the evaluation `FOR SHARE` (must be `AGENT_JUDGED` and
    `pending`), and requires every original field to match the stored row.
31. **A human Compliant decision requires a covered, matched Observation.** The same
    trigger, on `NEW.effective_value = 'COMPLIANT'`, reads `run_observation FOR SHARE` and
    requires `coverage = 'COVERED'` AND `corroboration = 'MATCHED'` — "This check must use
    the effective value: rejecting an original Exception or Unevaluated proposal to
    Compliant needs the same evidence floor as confirming an original Compliant proposal."
32. **The ledger is append-only.** `run_evaluation_review_immutable` refuses updates and
    `run_evaluation_review_undeletable` is a constraint trigger refusing deletes; the
    aggregate `run_result_review.revision` is the only mutable review row.
33. **An effective Exception is signed by the worker.** `ensureException(observationId,
    now)` is REQUIRED on the context: "A context without the worker-only signer must
    provide a fail-closed implementation that throws; leaving this optional would let a
    direct review write and seal a Result without its permanent Exception lineage." The
    web-composed context has no fingerprinter, so its `ensureException` throws. The
    implementation returns early when an Exception for that Observation already exists, and
    otherwise reads the Observation `FOR SHARE` and mints one from the worker's
    `EXCEPTION_FINGERPRINT_KEY`.
34. **The decision, the Exception, the audit event and the seal share one commit.**
    `execution.evaluation-confirmed` or `execution.evaluation-rejected` is appended with
    the actor, the review revision, the original and effective values (and, for a
    rejection, the replacement and the rationale), followed by `notifyTimeline`, and then
    `sealResult` runs in the same transaction.
35. **Sealing happens exactly once and only when this decision removed the last pending
    row.** `sealResult` re-reads `readConditionCounts()` from the same transaction;
    `sealPendingResult(result, previous.version)` is a second, database-level CAS
    "so a future caller cannot use this port to rewrite a sealed or already-sealed Result".
36. **A rejection to `UNEVALUATED` can seal the Result as `INCONCLUSIVE`.** §E.1 row 5
    (`COMPLETED → INCONCLUSIVE`, "only at Result sealing"); `publishResult` calls
    `saveRunState(decision.runState)` before the package seal. The immutable evaluation
    history must therefore stay mounted on Run Detail for that terminal state as well as
    for `COMPLETED`.

## The effective overlay

37. **Machine rows are never rewritten; decisions overlay them on read.**
    `effective-evaluation.ts`: `effectiveEvaluationValue` and `effectiveEvaluationOrigin`
    are `coalesce(review, machine)`, and `effectiveEvaluationConfirmation` is a `CASE` on
    `decisionId IS NULL` — "A rejection intentionally has NULL confirmation, so COALESCE
    would restore *pending*."
38. **Pending UI counts must query the effective evaluations**, not the unchanged
    publication on the Result.
39. **An Exception's original conditions, fingerprint and diagnostics are preserved.** The
    effective review condition set is displayed separately.

## Failure classification

`EVALUATION_REVIEW_REFUSALS`, the closed set shared by the command and the durable row's
`refusal_code` CHECK:

| Code | Sentence |
|---|---|
| `malformed` | `Choose a valid evaluation review.` |
| `unauthorized` | `You are not allowed to review this evaluation.` |
| `unknown` | `That evaluation does not exist.` |
| `not-completed` | `Only a Completed Run can accept an evaluation decision.` |
| `sealed` | `This Result is sealed and cannot be changed.` |
| `not-pending` | `That evaluation is not awaiting confirmation.` |
| `stale-revision` | `This Result changed while you were deciding. Reload the Run.` |
| `rationale-required` | `Enter a rationale for rejecting this evaluation.` |
| `invalid-replacement` | `Choose Compliant, Exception, or Unevaluated as the replacement.` |

`EVALUATION_REVIEW_DISPATCH_REFUSALS.conflict` covers an already-pending command.

## What is immutable

- The machine evaluation row (`run_observation_evaluation_immutable`) and its retained
  proposal columns.
- Every decision in `run_evaluation_review` (no update, no delete).
- Every terminal `run_evaluation_review_command`, and the request fields of a pending one.
- A sealed `run_result` (generation 25), and `run_result.version` moves only at sealing.
- The Exception raised by a decision: generation 23 forbids updating one and forbids
  deleting one while its Observation exists.

## What is deliberately NOT guaranteed

- **A reviewer cannot edit an Observation, a grounding or an Evidence artifact.** The only
  two actions are confirm and reject.
- **A rejection does not re-run the rules engine.** The replacement value is the human's,
  recorded as `effectiveOrigin: 'HUMAN'`, and only the covered-and-matched floor constrains
  it.
- **A worker without `EXCEPTION_FINGERPRINT_KEY` cannot complete a review that raises an
  Exception.** The command stays recoverable rather than sealing through a weaker path.
- **Below-threshold proposals are retained but are not decidable.** They are already
  `UNEVALUATED` with no `pending` confirmation, so no control exists for them.
- **`agentJudgedThreshold` is a frozen Version value.** Nothing in the review path can
  change it, and a Run is judged against the threshold its Version froze.

## Where it is enforced

| Behaviour | Location |
|---|---|
| Proposal shape and validation | `packages/application/src/runs/agent-evaluation.ts` — `AgentJudgedProposal`, `isAgentJudgedProposal`, `agentProposalKey` |
| Applicability projection and the proposal-bearing port | `packages/application/src/runs/agent-rule-evaluation.ts` — `applicableAgentConditionIds`, `agentRuleEvaluation`, `indexPopulation` |
| Threshold, pending, Compliant floor, retained proposals | `packages/domain/src/runs/evaluation.ts` — `evaluateObservationRecord` |
| The §E.1 rows and the pending outcome | `packages/domain/src/runs/outcome.ts` — `OUTCOME_ROWS`, `systemOutcome` |
| Evaluation-phase turn and its wait | `packages/application/src/runs/execute-agent-work-item.ts` — `finishObservation` |
| Gateway phase validation and proposal normalization | `packages/infrastructure/src/runs/agent-model-gateway.ts` — `validateRequest`, `validEvaluationInput`, `parseOutput` |
| Review command, preconditions, decision record | `packages/application/src/runs/evaluation-review.ts` — `reviewEvaluation`, `reviewEvaluationInContext`, `parseEvaluationReviewRequest`, `EVALUATION_REVIEW_REFUSALS` |
| Dispatch, durable command, worker execution | `packages/application/src/runs/review-dispatch.ts` — `dispatchEvaluationReview`, `executeEvaluationReviewCommand`, `parseEvaluationReviewJob` |
| Sealing | `packages/application/src/runs/complete-run.ts` — `sealResult`, `publishResult` |
| Worker-signed Exception, CAS seal port | `packages/infrastructure/src/runs/evaluation-review-repository.ts` — `ensureException`, `sealPendingResult` |
| Effective overlay | `packages/infrastructure/src/runs/effective-evaluation.ts` |
| Queue and recovery | `packages/infrastructure/src/runs/evaluation-review-queue.ts`; `apps/worker/src/main.ts` |
| Ledger, revision aggregate, binding guard, Compliant floor | `packages/infrastructure/drizzle/0036_zippy_thunderbolt.sql` — `run_evaluation_review`, `run_result_review`, `run_evaluation_review_shape`, `run_evaluation_review_binding_guard`, `run_evaluation_review_immutable`, `run_evaluation_review_undeletable`, `run_observation_evaluation_immutable`, `run_observation_evaluation_agent_proposal` |
| Durable command table | `packages/infrastructure/drizzle/0037_chunky_bill_hollister.sql` — `run_evaluation_review_command`, `run_evaluation_review_command_completion`, `run_evaluation_review_command_target_uidx`, `run_evaluation_review_command_immutable` |
| One-update sealing trigger | `packages/infrastructure/drizzle/0025_sparkling_rockslide.sql` — `run_result_sealed`, `run_result_version`, `run_result_immutable`, `audit_run_requires_result` |
