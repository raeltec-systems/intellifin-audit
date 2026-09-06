import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState } from '@intellifin/domain';
import {
  DrizzleProcedureRepository,
  DrizzleRunDetailRepository,
  PostgresAdapterExecutionRepository,
  PostgresPopulationRepository,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { GATE_NOT_EVALUATED } from '../../../src/design/copy';
import { GateChecklist } from '../../../src/runs/GateChecklist';
import {
  ConditionCards,
  CoverageSection,
  ExecutionFailurePanel,
  FindingsSection,
  PopulationReconciliation,
  SafeNextActionPanel,
  type FailedStep,
} from '../../../src/runs/ResultSections';
import { ConclusionTriptych } from '../../../src/runs/Triptych';
import { RunDenied, RunDetailFrame, openRun } from '../../../src/runs/detail';
import { utcStamp } from '../../../src/runs/labels';

export const metadata: Metadata = { title: 'Run · Result · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Run Detail → Result.
 *
 * The conclusion triptych, the Gate checklist, the population reconciliation, the
 * per-Target-System coverage, the evaluation counts by condition, the records the Result
 * names, and — for a Run that concluded nothing an auditor can act on — the Safe next
 * action and execution failure panels.
 *
 * Every number here is read from the SEALED Result that Story 3.9 published inside the
 * transaction that concluded the Run. None of it is recomputed on the page.
 */
export default async function RunResultPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  const [result, gate, population, execution, version] = await Promise.all([
    detail.readResult(run.runId),
    detail.readGateChecks(run.runId),
    new PostgresPopulationRepository(runtime.db).readPopulation(run.runId),
    new PostgresAdapterExecutionRepository(runtime.db).readExecution(run.runId),
    new DrizzleProcedureRepository(runtime.db).findVersion(run.versionId),
  ]);

  const failedGate = gate.filter((row) => row.outcome === 'FAIL').length;
  const terminalStop = run.state === 'INCONCLUSIVE' || run.state === 'RUN_FAILED';
  // Every Session Step and stage whose failure ends the RUN. A Work Item failure is
  // deliberately not here: §E lets the Run continue past one, and naming it in the
  // execution-failure panel would report a Run failure that did not happen.
  const failedSteps: FailedStep[] = [
    ...(population !== null && population.status === 'TERMINAL'
      ? [{ name: 'Population Source acquisition', attempts: population.attempts, diagnostic: population.diagnostic }]
      : []),
    ...(execution?.sessionSteps ?? [])
      .filter((step) => step.state === 'FAILED')
      .map((step) => ({ name: `Reference Source · ${step.displayName}`, attempts: step.attempts, diagnostic: step.diagnostic })),
    ...(execution !== null && execution.status === 'TERMINAL'
      ? [{ name: 'Adapter extraction', attempts: execution.attempts, diagnostic: execution.diagnostic }]
      : []),
  ];

  /** The frozen condition's authored text — a human's words, not a Target System's. */
  const conditions = version?.compiledPlan?.inputs.complianceConditions ?? [];
  const conditionText = (conditionId: string): string | null =>
    conditions.find((condition) => condition.conditionId === conditionId)?.text ?? null;

  const declaredCountPassed =
    population?.summary?.checks.find((check) => check.name === 'declared-count')?.passed ?? null;
  const publication = result?.publication ?? null;
  const uninspected = (publication?.coverage ?? []).reduce((total, entry) => total + entry.uninspected, 0);

  return (
    <RunDetailFrame run={run} tab="" readAt={readAt}>
      <ConclusionTriptych
        state={run.state}
        result={result}
        gateChecks={gate.length}
        gateFailed={failedGate}
      />
      {run.state === 'RUN_FAILED' ? (
        <ExecutionFailurePanel steps={failedSteps} sealedAt={result?.sealedAt ?? null} />
      ) : null}
      {terminalStop && result !== null ? <SafeNextActionPanel result={result} /> : null}
      <GateChecklist
        rows={gate}
        runId={run.runId}
        failedFirst={terminalStop}
        notEvaluatedReason={
          isActiveRunState(run.state)
            ? GATE_NOT_EVALUATED.active
            : run.state === 'CANCELED'
              ? GATE_NOT_EVALUATED.canceled
              : GATE_NOT_EVALUATED.stopped
        }
      />
      {/* One sentence, not two: the triptych's statement line already says it. This
          explains what is still true, which is what a reader needs next. */}
      {result !== null && publication === null ? (
        <p>
          The outcome, the seal and the Result version above are stored columns and are what
          this Run concluded. The published document beside them was written in a shape this
          build does not read, so its counts are not shown rather than shown wrongly.
        </p>
      ) : null}
      {publication === null ? null : (
        <>
          <PopulationReconciliation
            publication={publication}
            rowsDigest={population?.summary?.rowsDigest ?? null}
            declaredCountPassed={declaredCountPassed}
            uninspected={uninspected}
          />
          <CoverageSection publication={publication} />
          <ConditionCards publication={publication} conditionText={conditionText} />
          <FindingsSection publication={publication} />
        </>
      )}
      <section className="ls-card ls-stack" aria-labelledby="run-details">
        <h2 id="run-details">Run details</h2>
        <dl className="ls-card__cells ls-run-details">
          <div>
            <dt>Run ID</dt>
            <dd className="ls-mono">{run.runId}</dd>
          </div>
          <div>
            <dt>Procedure Version</dt>
            <dd>
              <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>
                v{run.versionNumber}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd className="ls-mono">
              {run.period.from} to {run.period.to} (inclusive)
            </dd>
          </div>
          <div>
            <dt>Initiator</dt>
            <dd>{run.initiatorId}</dd>
          </div>
          <div>
            <dt>Initiated at</dt>
            <dd className="ls-mono">{utcStamp(run.initiatedAt)}</dd>
          </div>
          <div>
            <dt>Run kind</dt>
            <dd>{run.kind === 'STANDARD' ? 'Standard' : 'Regression'}</dd>
          </div>
          <div>
            <dt>Correlation ID</dt>
            <dd className="ls-mono">{run.correlationId}</dd>
          </div>
          {/* A rerun says which Run it follows and why it exists. The predecessor itself
              is never changed by the link — only this row and this Run's own chain. */}
          {run.predecessorRunId === null ? null : (
            <div>
              <dt>Rerun of</dt>
              <dd>
                <Link className="ls-mono" href={`/runs/${run.predecessorRunId}`}>
                  {run.predecessorRunId}
                </Link>
              </dd>
            </div>
          )}
          {run.rerunReason === null ? null : (
            <div>
              <dt>Reason for this Run</dt>
              <dd>{run.rerunReason}</dd>
            </div>
          )}
        </dl>
      </section>
    </RunDetailFrame>
  );
}
