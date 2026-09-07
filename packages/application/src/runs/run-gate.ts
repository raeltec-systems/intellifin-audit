import {
  coverageFindings,
  includedRecordKeys,
  requiredTargetSystems,
  populationFieldFindings,
  runGateChecks,
  runGateDecision,
  tallyGateFindings,
  GATE_AFFECTED_LIMIT,
  GATE_CHECKS,
  type ExecutablePlan,
  type GateCheckResult,
  type GateDiagnostic,
  type GateFinding,
  type GateFindingTally,
  type ObservationCheckName,
  type PopulationGateRow,
  type RunGateDecision,
  type RunRecord,
} from '@intellifin/domain';
import type {
  GateCheckRow,
  GateFactSample,
  GateFactTally,
  RunGateContext,
} from './execution-ports.js';
import {
  agentPageDeclarationChecks,
  p4PageTargetSystem,
  requiresP4PageDeclaration,
} from './agent-page-declaration.js';
import { completeRun } from './complete-run.js';

/**
 * The Run-level Evidence Quality Gate (Story 3.8).
 *
 * Runs when the last Work Item completes, inside the transaction that finishes the adapter
 * stage. Every addendum §H row is evaluated, every outcome and diagnostic becomes a
 * Timeline event, and the terminal transition — `COMPLETED` on a pass, `INCONCLUSIVE` on a
 * Gate failure, `RUN_FAILED` where a diagnostic says so — is taken atomically with the
 * Evidence package seal.
 *
 * **There is no injection point.** `AdapterExecutionContext` extends `RunGateContext`, so
 * the stage that finishes the last Work Item already holds everything this command needs
 * and there is no dependency a composition root could omit or switch off. Stories 3.6 and
 * 3.7 both removed such a seam rather than leave one; a Gate that could be left out is a
 * Run that concludes without one, which is the whole thing §H exists to prevent.
 *
 * **It never re-runs a check somebody else recorded.** The six per-Observation rows are
 * rolled up from `run_observation_check`, and the population rows from the reconciliation
 * Story 3.2 stored. A second implementation of either would agree on every case anybody
 * thought to try and diverge on the first one nobody did — and here the divergence would be
 * an audit conclusion.
 *
 * **A Gate failure is never repaired by re-running a check.** The rows are written once:
 * `readGateChecks` returns what is already there and this command writes nothing more, so a
 * redelivered job cannot turn a failing Gate into a passing one.
 */

/** The Timeline event every Gate row appends. Its payload names identities, never values. */
const GATE_EVENT = 'execution.gate-checked';
/** The §E.1 security event a denied action or a scope violation additionally appends. */
export const SECURITY_DENIED_EVENT = 'security.action-denied';

export interface RunGateOutcome {
  readonly decision: RunGateDecision;
  readonly results: readonly GateCheckResult[];
  /** `false` when the Gate had already run and this call changed nothing. */
  readonly recorded: boolean;
}

export interface RunGateInput {
  readonly run: RunRecord;
  /** The plan the version froze, or `null` when this build cannot read it. */
  readonly plan: ExecutablePlan | null;
  /** The instant this Gate is deciding. Used for the Evidence package seal. */
  readonly decidedAt: string;
}

function sample(entries: readonly GateFactSample[], diagnostic: GateDiagnostic): GateFinding[] {
  return entries.map((entry) => ({
    diagnostic,
    targetSystem: entry.targetSystem,
    workItemId: entry.workItemId,
    record: entry.record,
  }));
}

/** A tally the port already counted: keep its exact total, bound its named identities. */
function fromTally(tally: GateFactTally, diagnostic: GateDiagnostic): GateFindingTally | null {
  if (tally.total <= 0) return null;
  const bound = (pick: (entry: GateFactSample) => string | null): string[] => [
    ...new Set(tally.sample.map(pick).filter((value): value is string => value !== null)),
  ].slice(0, GATE_AFFECTED_LIMIT);
  return {
    diagnostic,
    total: tally.total,
    targetSystems: bound((entry) => entry.targetSystem),
    workItems: bound((entry) => entry.workItemId),
    records: bound((entry) => entry.record),
  };
}

/**
 * The per-Observation check each §H row rolls up from.
 *
 * `Record<ObservationCheckName, …>` on purpose: the six checks Story 3.4 and 3.6 record are
 * a closed union, so a check added there without a §H diagnostic here does not compile, and
 * a row of §H whose evidence is decided per Observation can never be left un-rolled-up.
 *
 * Exported so the golden reconciliation rolls the checks up through the SAME table this
 * command does. A test that retyped it would be a second copy of a routing table, and the
 * first value the two disagreed about would be a §H row nobody noticed had moved.
 */
export const OBSERVATION_CHECK_DIAGNOSTIC: Readonly<Record<ObservationCheckName, GateDiagnostic>> = {
  'identity-corroboration': 'identity-uncorroborated',
  'search-completeness': 'absence-unproven',
  'ambiguous-match': 'ambiguous-match',
  'required-evidence': 'evidence-missing',
  freshness: 'observation-stale',
  'observation-corroboration': 'observation-contradicted',
};

/**
 * Run the whole §H Gate for one Run and commit its conclusion.
 *
 * Called inside the caller's transaction. It reads the facts every earlier story recorded,
 * decides in the domain, stores one row per §H check, appends one Timeline event per
 * outcome and per diagnostic, takes the terminal transition and seals the Evidence package
 * — all of it in that one transaction.
 */
export async function runRunLevelGate(
  context: RunGateContext,
  input: RunGateInput,
): Promise<RunGateOutcome> {
  const existing = await context.readGateChecks();
  if (existing.length > 0) {
    // The first Gate wins. A Gate failure is not repaired by re-running a check.
    const results = existing.map(
      (row): GateCheckResult => ({
        check: row.check,
        outcome: row.outcome,
        diagnostics: row.diagnostics,
        affected: {
          targetSystems: row.targetSystems,
          workItems: row.workItems,
          records: row.records,
          total: row.total,
        },
      }),
    );
    return { decision: runGateDecision(results), results, recorded: false };
  }

  const plan = input.plan;
  const templateId = plan?.inputs.templateId ?? '';
  // The two axes of the coverage matrix, derived ONCE in the domain: the published Result
  // (Story 3.9) reports the same matrix, and two derivations of its axes would be two
  // answers to one question.
  const required = requiredTargetSystems(plan);

  const populationFacts = await context.readPopulationFacts();
  const rows: readonly PopulationGateRow[] =
    populationFacts === null ? [] : await context.readPopulationRows();
  // The page declaration is a separate producer fact. It is appended to the existing
  // population check list only for P-4, without replacing the source declaration/count or
  // inventing a second Gate engine. A missing page fact is therefore two ordinary §H
  // failures: declaration-absent and declared-count-mismatch.
  const populationChecks = populationFacts === null
    ? null
    : [
        ...populationFacts.checks,
        ...(requiresP4PageDeclaration(plan)
          ? agentPageDeclarationChecks(
              populationFacts.agentPageDeclaration,
              p4PageTargetSystem(plan),
            )
          : []),
      ];

  const findings: GateFindingTally[] = [];

  // §H schema, mandatory values, duplicate primary keys and the unparseable timestamps
  // folded into mandatory values — one streaming pass over the parsed population.
  if (plan !== null && rows.length > 0) {
    findings.push(
      ...populationFieldFindings({
        templateId,
        declaredSchema: plan.inputs.sourceSnapshot?.contract.declared_schema ?? [],
        allowVersionedDuplicates: plan.inputs.allowVersionedDuplicates,
        rows,
      }),
    );
  }

  // §H per-record coverage: the matrix over (required Target System × included record).
  const observations = await context.readGateObservations();
  findings.push(
    ...tallyGateFindings(
      coverageFindings({
        requiredTargetSystems: required,
        includedRecordKeys: includedRecordKeys(templateId, rows),
        observations,
      }),
    ),
  );

  // The six per-Observation rows, rolled up from the outcomes already recorded.
  const failedChecks = await context.readFailedObservationChecks();
  for (const [check, diagnostic] of Object.entries(OBSERVATION_CHECK_DIAGNOSTIC) as readonly [
    ObservationCheckName,
    GateDiagnostic,
  ][]) {
    const tally = Object.hasOwn(failedChecks, check) ? failedChecks[check] : undefined;
    const rolled = tally === undefined ? null : fromTally(tally, diagnostic);
    if (rolled !== null) findings.push(rolled);
  }

  // §H condition completeness and unnamed values, over the version's frozen conditions.
  //
  // Counted from the FROZEN PLAN, never from the stored evaluation rows: a version whose
  // Compliance Rule this build can no longer recompile produces ZERO evaluations while its
  // plan still declares its conditions, so every Observation reports a gap and the Run is
  // `INCONCLUSIVE` — which is the whole point of counting it here.
  //
  // A plan this build cannot read at all declares nothing, so there is no count to compare
  // against and `readConditionGaps(0)` finds no gaps. That must not read as a PASS: a Run
  // whose plan could not be read has no condition anybody verified an evaluation for. The
  // adapter stage refuses such a plan as `unsupported-frozen-plan` before its first Work
  // Item, so this is the second lock on that door rather than the first — but a row that
  // passes for want of a number is exactly the kind of pass §H exists to refuse.
  if (plan === null) {
    findings.push({
      diagnostic: 'condition-evaluation-missing',
      total: 1,
      targetSystems: [],
      workItems: [],
      records: [],
    });
  } else {
    const conditionGaps = await context.readConditionGaps(plan.inputs.complianceConditions.length);
    const gapTally = fromTally(conditionGaps, 'condition-evaluation-missing');
    if (gapTally !== null) findings.push(gapTally);
  }
  const unnamed = fromTally(await context.readUnnamedValues(), 'unnamed-value');
  if (unnamed !== null) findings.push(unnamed);

  // §H pagination / extraction completeness, workspace and Target System access, integrity.
  const incomplete = await context.readIncompleteExtractions();
  const access = await context.readAccessFailures();
  const integrity = await context.readIntegrityFindings();
  findings.push(
    ...tallyGateFindings([
      ...sample(incomplete, 'extraction-incomplete'),
      ...sample(access.failedSessionSteps, 'session-step-failed'),
      // The same fact on §H's OTHER row: a Session Step whose `extract-adapter` acquisition
      // failed is an acquisition that could not complete, which the pagination/extraction
      // row makes `RUN_FAILED`. The addendum gives that one failure two rows, and this is
      // the second of them rather than a duplicate count of the first.
      ...sample(access.failedSessionSteps, 'acquisition-unavailable'),
      ...sample(access.denied, 'target-access-denied'),
      ...sample(integrity, 'integrity-mismatch'),
    ]),
  );

  const results = runGateChecks({
    populationChecks,
    population:
      populationFacts === null
        ? null
        : {
            rowsParsed: populationFacts.rowsParsed,
            included: populationFacts.included,
            excluded: populationFacts.excluded,
            indeterminate: populationFacts.indeterminate,
            unexplained: populationFacts.unexplained,
          },
    snapshot:
      populationFacts === null
        ? null
        : {
            generatedAt: populationFacts.generatedAt,
            periodTo: input.run.period.to,
            initiatedAt: input.run.initiatedAt,
          },
    findings,
  });
  const decision = runGateDecision(results);

  await context.saveGateChecks(
    results.map(
      (result): GateCheckRow => ({
        check: result.check,
        outcome: result.outcome,
        diagnostics: result.diagnostics,
        targetSystems: result.affected.targetSystems,
        workItems: result.affected.workItems,
        records: result.affected.records,
        total: result.affected.total,
      }),
    ),
  );

  // Every check outcome AND every diagnostic is a Timeline event: a passing row appends
  // one saying it ran, and a failing row appends one per diagnostic, so an empty mandatory
  // identifier, a duplicate primary key, an unparseable timestamp and an undeclared schema
  // field each raise their own. Bounded by the vocabulary — twenty rows and at most one
  // event per closed diagnostic — never by the population.
  for (const result of results) {
    const diagnostics: readonly (GateDiagnostic | null)[] =
      result.diagnostics.length === 0 ? [null] : result.diagnostics;
    for (const diagnostic of diagnostics) {
      const stored = await context.auditEvents.append({
        actor: { type: 'system', id: 'evidence-gate' },
        eventType: GATE_EVENT,
        source: 'worker',
        outcome: result.outcome === 'PASS' ? 'success' : 'failure',
        aggregateId: input.run.runId,
        correlationId: input.run.correlationId,
        sessionId: input.run.sessionId,
        payload: {
          check: result.check,
          outcome: result.outcome,
          diagnostic,
          // What the Result names: the affected systems, Work Items and records. Identities
          // only — there is nowhere here for a captured value or a byte of Evidence.
          targetSystems: result.affected.targetSystems,
          workItems: result.affected.workItems,
          records: result.affected.records,
          affected: result.affected.total,
          runState: decision.state,
        },
      });
      await context.notifyTimeline(stored.sequence);
    }
  }

  await context.saveRunState(decision.state);
  const summary = await context.auditEvents.append({
    actor: { type: 'system', id: 'evidence-gate' },
    eventType: GATE_EVENT,
    source: 'worker',
    outcome: decision.passed ? 'success' : 'failure',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.run.sessionId,
    payload: {
      check: 'run-level-gate',
      outcome: decision.passed ? 'PASS' : 'FAIL',
      runState: decision.state,
      checks: GATE_CHECKS.length,
      failed: decision.failed,
    },
  });
  await context.notifyTimeline(summary.sequence);
  // Every terminal transition completes the Run, in this transaction: the System Outcome
  // is computed once, the Result is sealed and the Evidence package is sealed with it. A
  // branch that forgot would not ship an unsealed Run — generations 21 and 25 both refuse
  // the commit outright, with a deferred constraint trigger each.
  await completeRun(context, {
    run: input.run,
    state: decision.state,
    at: input.decidedAt,
    plan: input.plan,
  });
  return { decision, results, recorded: true };
}
