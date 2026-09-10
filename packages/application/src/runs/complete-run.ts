import {
  FRAME_MISSING_EVENT,
  GATE_CHECKS,
  includedRecordKeys,
  isTerminalRunState,
  publishRunResult,
  requiredTargetSystems,
  resultTargetSystems,
  systemOutcome,
  type ExecutablePlan,
  type GateCheckName,
  type RunRecord,
  type RunResultGate,
  type RunResultPopulation,
} from '@intellifin/domain';
import type { RunResultContext, StoredRunResult } from './execution-ports.js';
import { sealPackage } from './seal-package.js';

/**
 * `CompleteRun`: the one place a Run's System Outcome is computed and its Result sealed
 * (Story 3.9).
 *
 * Called at EVERY terminal transition, inside the transaction that takes it — the same
 * shape `sealIfTerminal` has, and for the same reason: a Result written afterwards would
 * describe a state the Run has already left, and a Result written twice invites two
 * answers. Generation 25's deferred constraint trigger is the forcing function behind it,
 * exactly as generation 21's is for the Evidence package: a branch that reaches a terminal
 * state without a Result does not ship a Run nobody can read, it fails to commit.
 *
 * CompleteRun publishes once. SealResult is the sole later transition for a pending
 * publication, under the same Result lock held by the human-review command. Both use
 * the shared publisher below and the generation25 one-update/version-increment guard.
 *
 * **A passed Gate is necessary and never sufficient for Pass.** `gatePassed` is READ from
 * the Gate rows Story 3.8 wrote — all twenty of them, all passing — and the evaluation
 * facts are READ from the per-condition evaluations Story 3.7 wrote. Neither is inferred
 * from the other: the Gate asks whether the Evidence supports a conclusion and the outcome
 * asks what that conclusion is, and deriving either from the other is the mistake this
 * command exists to prevent.
 *
 * The ORDER inside the transaction is load-bearing:
 *
 *  1. decide, from the facts, with no writes at all;
 *  2. take the Run state the decision implies, which for §E's `COMPLETED → INCONCLUSIVE`
 *     row differs from the state the caller was committing;
 *  3. seal the Evidence package AT that state, so the package records the state the Run
 *     actually reached;
 *  4. publish the Result over the seal and write it.
 */

/** The audit event a sealed Result appends. Its payload names counts, never values. */
const RESULT_EVENT = 'lifecycle.result-sealed';

/**
 * The audit event a cancellation the Run outran appends.
 *
 * **The outcome the Run EARNED wins, and the request is never silent.** A person can ask
 * for a Run to stop while its last Work Item is running or while its acquisition is
 * already failing, and by the time the worker reaches the boundary it commits at, the Run
 * has an outcome: at the adapter stage a complete, sealed, defensible conclusion one
 * transaction away, and at the population stage a failing check that says WHY it could not
 * conclude. Honouring the cancellation there would throw the first away for nothing — the
 * Evidence is frozen either way, and §E.1's `canceled` row matches on the STATE alone, so
 * the Run would record `gatePassed: false, checks: 0` over twenty Gate rows it was about to
 * write — and would hide the second behind a state that says only "somebody asked".
 *
 * What was missing is that the marker was then answered by NOTHING. A Run sealed carrying a
 * committed requester, time and reason, and no event, no Result field and no sentence said
 * what became of the request: the person clicked Cancel, got a confirmation, and the Run
 * said Completed. That is the defect, and this event is the whole of it. The Run state, the
 * Gate rows and the Result are unchanged.
 *
 * It lives HERE and not at the two call sites because every terminal transition already
 * goes through this command — which is why Story 3.10 put `performCancellation` here as the
 * one place a Run becomes `CANCELED` — so one check covers both worker stages, the web
 * command, and every path Epic 4 adds, and cannot be forgotten by a branch written later.
 */
const CANCELLATION_SUPERSEDED_EVENT = 'lifecycle.cancellation-superseded';
/**
 * The same reading for a pause nothing reached (Story 5.4, AD-16).
 *
 * Defined here rather than imported from `PauseRun` for the reason its sibling above is:
 * an event name lives where the event is appended, and `PauseRun` reaching back into this
 * module would make the two import each other.
 */
const PAUSE_SUPERSEDED_EVENT = 'lifecycle.pause-superseded';

export interface CompleteRunInput {
  readonly run: RunRecord;
  /** The terminal state this transition is committing. A non-terminal one does nothing. */
  readonly state: RunRecord['state'];
  readonly at: string;
  /** The plan the version froze, or `null` when this build cannot read it. */
  readonly plan: ExecutablePlan | null;
}

/**
 * Read the §H verdict off the Gate rows, without re-judging one of them.
 *
 * Twenty rows, every one `PASS`. FEWER than twenty is not a pass either: a Run stopped by
 * a limit, a denial or a Session Step failure never reached the Gate and has no rows at
 * all, and an unrun Gate is not a passed Gate — the fail-closed reading, and the same one
 * `snapshot-generation-unknown` takes for a snapshot nobody measured.
 */
function gateVerdict(rows: readonly { check: GateCheckName; outcome: 'PASS' | 'FAIL' }[]): RunResultGate {
  const failed = rows.filter((row) => row.outcome === 'FAIL').map((row) => row.check);
  return {
    passed: rows.length === GATE_CHECKS.length && failed.length === 0,
    checks: rows.length,
    failed: GATE_CHECKS.filter((check) => failed.includes(check)),
  };
}

/**
 * Compute the System Outcome and seal the Result, inside the caller's terminal transaction.
 *
 * Returns the Result — the one this call wrote, or the one that was already there — or
 * `null` when the transition is not a terminal one. It is called on non-terminal
 * transitions too, deliberately: a caller that had to decide terminality first would be a
 * second copy of `TERMINAL_RUN_STATES` in every branch of both producers.
 */
export async function completeRun(
  context: RunResultContext,
  input: CompleteRunInput,
): Promise<StoredRunResult | null> {
  if (!isTerminalRunState(input.state)) return null;

  const existing = await context.readResult();
  if (existing !== null) {
    // The FIRST Result wins. The package is sealed in the same transaction as the Result,
    // so this is a read that finds it rather than a second seal.
    await sealPackage(context, {
      run: input.run,
      terminalState: existing.runState,
      sealedAt: input.at,
    });
    return existing;
  }

  return publishResult(context, input, null);
}

/** The review transaction supplies a compare-and-set writer; ordinary writers remain insert-only. */
export interface SealResultContext extends RunResultContext {
  sealPendingResult(result: StoredRunResult, expectedVersion: number): Promise<void>;
}

/** Called only inside the locked human-review transaction after updating effective evaluations. */
export async function sealResult(context: SealResultContext, input: CompleteRunInput): Promise<StoredRunResult | null> {
  if (input.state !== 'COMPLETED' || input.run.state !== 'COMPLETED') return null;
  const existing = await context.readResult();
  if (existing === null || existing.sealed) return existing;
  if (existing.outcome !== 'PENDING_CONFIRMATION') throw new Error('Unsealed Result is not pending');
  const counts = await context.readConditionCounts();
  if (counts.some(row => row.confirmation === 'pending' && row.total > 0)) return existing;
  return publishResult(context, input, existing);
}

/** One outcome/publication implementation for initial completion and the final review answer. */
async function publishResult(
  context: RunResultContext,
  input: CompleteRunInput,
  previous: StoredRunResult | null,
): Promise<StoredRunResult> {
  const gate = gateVerdict(await context.readGateChecks());
  const conditions = await context.readConditionCounts();
  const findings = await context.readResultFindings();
  const decision = systemOutcome({
    runState: input.state,
    gatePassed: gate.passed,
    // Each fact read from the evaluation rows, and each counted where §B.1 puts it: a
    // pending confirmation and an `UNEVALUATED` value are per-condition facts, and an
    // Exception is a finding about a record.
    pending: conditions
      .filter((entry) => entry.confirmation === 'pending')
      .reduce((total, entry) => total + entry.total, 0),
    unevaluated: conditions
      .filter((entry) => entry.value === 'UNEVALUATED')
      .reduce((total, entry) => total + entry.total, 0),
    exceptions: findings.exceptions.total,
  });

  // §E's `COMPLETED → INCONCLUSIVE`, "only at Result sealing, when a human rejection
  // leaves a condition Unevaluated". Taken BEFORE the seal so the package records the
  // state the Run actually reached, and it is the only row that moves one.
  if (decision.runState !== input.state) await context.saveRunState(decision.runState);
  const seal = await sealPackage(context, {
    run: input.run,
    terminalState: decision.runState,
    sealedAt: input.at,
  });
  // What this Run actually froze, BY IDENTITY (owner decision, 2026-09-06).
  //
  // Read after the seal, so it sees the artifacts in their settled state: sealing abandons
  // still-open reservations first, and abandonment can only touch a `RESERVED` row, so the
  // `REGISTERED` set is identical to the one `seal.registered` counted. The count and this
  // list therefore cannot disagree — they are the same rows read inside one transaction.
  //
  // It is here rather than a count on its own because "Inconclusive with Evidence" and
  // "Inconclusive with nothing" are different findings, and a number cannot tell them
  // apart: a Run stopped by its own time limit after acquiring, storing and verifying a
  // population still has that population, and the Result has to say which artifact.
  const registeredArtifacts = (await context.readPackageArtifacts())
    .filter((artifact) => artifact.state === 'REGISTERED')
    .map((artifact) => ({
      evidenceId: artifact.evidenceId,
      kind: artifact.kind,
      objectKey: artifact.objectKey,
    }));

  // Every Tool Action that should have left a frame and did not (Story 5.2, AC3).
  //
  // Read AFTER the seal, which is what makes "the seal is not blocked" a property of
  // WHERE this sits rather than a rule this code remembers: `sealPackage` has already
  // returned its decision, and nothing below can change it. A `replay`-role asset is
  // outside the required set by construction (AD-5), so a frame gap degrades a Replay and
  // never a conclusion.
  const missingFrames = await context.readMissingFrames();

  const populationFacts = await context.readPopulationFacts();
  const population: RunResultPopulation | null =
    populationFacts === null
      ? null
      : {
          rowsParsed: populationFacts.rowsParsed,
          included: populationFacts.included,
          excluded: populationFacts.excluded,
          indeterminate: populationFacts.indeterminate,
        };
  const rows = populationFacts === null ? [] : await context.readPopulationRows();
  const templateId = input.plan?.inputs.templateId ?? null;
  const publication = publishRunResult({
    outcome: decision.outcome,
    templateId,
    controlName: input.plan?.inputs.controlName ?? null,
    // The auditor's own sentence, verbatim. `null` says this build could not read the
    // frozen plan, which is a different statement from a scope that is empty.
    scope: input.plan?.inputs.scope ?? null,
    period: input.run.period,
    population,
    exclusions: await context.readResultExclusions(),
    // The same two axes the Gate's coverage row is decided on, from the same domain
    // functions. A Result that derived them a second way could disagree with the Gate it
    // reports.
    requiredTargetSystems: requiredTargetSystems(input.plan),
    // What was in scope and what was not, by name, from the same frozen plan.
    targetSystems: resultTargetSystems(input.plan),
    includedRecordKeys: includedRecordKeys(templateId ?? '', rows),
    observations: await context.readGateObservations(),
    conditions,
    exceptions: findings.exceptions,
    unevaluated: findings.unevaluated,
    gate,
    evidence: {
      state: seal.state,
      requiredTotal: seal.requiredTotal,
      registered: seal.registered,
      missingRequired: seal.missingRequired.length,
      abandoned: seal.abandoned.length,
      artifacts: registeredArtifacts,
      // On the Result as well as in the chain, because "flagged on Replay and export"
      // needs a fact the Result document carries: an export reader holds the document and
      // not the Timeline. Never folded into `missingRequired` — a frame cannot gate a seal.
      framesMissing: missingFrames.total,
    },
  });

  const result: StoredRunResult = {
    runId: input.run.runId,
    // The row is written at version 1. The only later version there can be is the sealing
    // of a Pending Confirmation Result, which is the only unsealed outcome there is.
    version: previous === null ? 1 : previous.version + 1,
    outcome: decision.outcome,
    row: decision.row,
    sealed: decision.sealed,
    runState: decision.runState,
    gatePassed: gate.passed,
    sealedAt: input.at,
    scope: publication.scope,
    publication,
  };
  if (previous === null) await context.writeResult(result);
  else {
    if (!result.sealed) throw new Error('Result still has pending evaluations');
    await (context as SealResultContext).sealPendingResult(result, previous.version);
  }

  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'result-sealer' },
    eventType: RESULT_EVENT,
    source: 'worker',
    // A Control Failure is a truthful conclusion, not a failed seal: the outcome carries
    // what the Run found, and saying it twice would double-count it. Only an outcome that
    // means the Run could not conclude is recorded as a failure here.
    outcome:
      decision.outcome === 'PASS' || decision.outcome === 'CONTROL_FAILURE'
        ? 'success'
        : 'failure',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.run.sessionId,
    payload: {
      outcome: decision.outcome,
      // Which §E.1 row decided, so a Result can say why it says what it says.
      rule: decision.row,
      sealed: decision.sealed,
      version: result.version,
      runState: decision.runState,
      gatePassed: gate.passed,
      gateFailed: gate.failed,
      // Counts and identities only. The scope statement, the control-specific values and
      // every captured attribute stay on the Result row: the chain is immutable, so what
      // enters it can never be taken out, and none of this needs to.
      rowsParsed: publication.population.rowsParsed,
      included: publication.population.included,
      excluded: publication.population.excluded,
      indeterminate: publication.population.indeterminate,
      exceptions: findings.exceptions.total,
      unevaluated: findings.unevaluated.total,
      evidencePackage: seal.state,
    },
  });
  await context.notifyTimeline(stored.sequence);

  // The Replay asset set is not whole (Story 5.2, AC3). One event per Run, carrying the
  // exact total and a bounded sample: one per missing frame would put an unbounded number
  // of rows into an immutable chain for exactly the Run whose capture was misconfigured.
  //
  // Only on the FIRST publication. A pending Result sealed later by a human review adds no
  // frames and removes none, so a second event would report the same gap twice and read as
  // a second failure.
  if (previous === null && missingFrames.total > 0) {
    const flagged = await context.auditEvents.append({
      actor: { type: 'system', id: 'result-sealer' },
      eventType: FRAME_MISSING_EVENT,
      source: 'worker',
      // A failure: a capture the platform meant to take did not happen. It does not change
      // the outcome and does not block the seal — both were decided above this line.
      outcome: 'failure',
      aggregateId: input.run.runId,
      correlationId: input.run.correlationId,
      sessionId: input.run.sessionId,
      payload: {
        // Identities and counts. A destination is redacted before it is recorded and is
        // already on the `run_tool_action` row this names; repeating it here would put a
        // second, unredacted-by-this-path copy into the immutable chain.
        missing: missingFrames.total,
        actions: missingFrames.sample.map((frame) => ({
          toolActionId: frame.toolActionId,
          stepExecutionId: frame.stepExecutionId,
          targetSystem: frame.targetSystem,
          completedAt: frame.completedAt,
        })),
      },
    });
    await context.notifyTimeline(flagged.sequence);
  }

  // The Run outran a cancellation somebody asked for. Read HERE, on this transaction's
  // connection, because the request may have committed after the worker's claim; and only
  // when the state being committed is not `CANCELED`, which is the path where the request
  // DID take effect and `performCancellation` has already recorded it.
  if (previous === null && input.state !== 'CANCELED') {
    const request = await context.readCancellation();
    if (request !== null) {
      const superseded = await context.auditEvents.append({
        // The system, not the requester: they asked, and the platform did not do it. An
        // event naming them as its actor would say they caused an outcome they did not.
        actor: { type: 'system', id: 'result-sealer' },
        eventType: CANCELLATION_SUPERSEDED_EVENT,
        source: 'worker',
        // Not a success: a person asked for something and did not get it.
        outcome: 'failure',
        aggregateId: input.run.runId,
        correlationId: input.run.correlationId,
        sessionId: input.run.sessionId,
        payload: {
          requestedBy: request.requestedBy,
          requestedAt: request.requestedAt,
          reason: request.reason,
          // What happened instead, so the chain says why the request was outrun.
          state: decision.runState,
          outcome: decision.outcome,
          occurredAt: input.at,
        },
      });
      await context.notifyTimeline(superseded.sequence);
    }
  }

  // AD-16: "a pause requested when no further Tool Action boundary occurs is recorded as
  // superseded on the Timeline and the Run proceeds to its terminal state". The marker is
  // cleared by the boundary that honours a pause, so one still outstanding here is one no
  // boundary ever reached — no state comparison is needed to tell the two apart.
  if (previous === null) {
    const pause = await context.readPauseRequest();
    if (pause !== null) {
      const superseded = await context.auditEvents.append({
        // The system, not the requester: they asked, and the platform did not do it.
        actor: { type: 'system', id: 'result-sealer' },
        eventType: PAUSE_SUPERSEDED_EVENT,
        source: 'worker',
        // Not a success: a person asked for something and did not get it.
        outcome: 'failure',
        aggregateId: input.run.runId,
        correlationId: input.run.correlationId,
        sessionId: input.run.sessionId,
        payload: {
          requestedBy: pause.requestedBy,
          requestedAt: pause.requestedAt,
          state: decision.runState,
          outcome: decision.outcome,
          occurredAt: input.at,
        },
      });
      await context.notifyTimeline(superseded.sequence);
    }
  }
  return result;
}
