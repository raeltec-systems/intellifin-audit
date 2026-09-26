import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleProcedureRepository,
  DrizzleRunDetailRepository,
  DrizzleRunStopReader,
  PostgresAdapterExecutionRepository,
  PostgresPopulationRepository,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { GATE_NOT_EVALUATED } from '../../../src/design/copy';
import { Reference } from '../../../src/design/Reference';
import { TechnicalDetails } from '../../../src/design/TechnicalDetails';
import { Timestamp } from '../../../src/design/Timestamp';
import { readablePeriod } from '../../../src/design/time';
import { GateChecklist } from '../../../src/runs/GateChecklist';
import { EvaluationReview } from '../../../src/runs/EvaluationReview';
import {
  ConditionCards,
  CoverageSection,
  ScopeSection,
  EvidencePackageSection,
  ExecutionFailurePanel,
  FindingsSection,
  HumanMatchesSection,
  PopulationReconciliation,
  SafeNextActionPanel,
  type FailedStep,
} from '../../../src/runs/ResultSections';
import { RESULT_WORDS } from '../../../src/runs/result-words';
import { ConclusionTriptych } from '../../../src/runs/Triptych';
import { RunDenied, RunDetailFrame, openRun, readEvaluationReview } from '../../../src/runs/detail';
import { readHumanMatchIndex, readRunHumanMatchList } from '../../../src/runs/human-match-read';
import { recordNaming } from '../../../src/runs/record-words';
import { utcStamp } from '../../../src/runs/labels';
import { isStoppedState } from '../../../src/runs/stop-reason';

export const metadata: Metadata = { title: 'Run · Result · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Run Detail → Result.
 *
 * **Conclusion first, then what needs the reader** (UI cleanup 2026-09-22, UX-19;
 * EXPERIENCE.md → UI cleanup: "A completed test reads conclusion first: outcome, affected
 * records, coverage and the next action; then review history and successful checks,
 * collapsed; then technical evidence").
 *
 * The walkthrough measured this page at 7,132px, with three historical AI assessments
 * ABOVE the conclusion — because `RunDetailFrame` rendered the pending confirmations for
 * every tab, before `children`. The order is now fixed here, in one place a reader can
 * check against the contract:
 *
 * 1. the conclusion triptych, its three meanings and the Result's own statement — with
 *    the Safe next action / Execution failure panels beside it;
 * 2. the pending confirmations, which is what the reader has to DO, collapsed into a
 *    review history once the Result is sealed and there is nothing left to do;
 * 3. the records the Result names;
 * 4. coverage, scope and the population reconciliation, compact;
 * 5. the Evidence Quality Gate — a summary line with the failed rows open;
 * 6. the Evidence package, behind a disclosure;
 * 7. Technical details.
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
  const [result, gate, population, execution, version, names, stop, review] = await Promise.all([
    detail.readResult(run.runId),
    detail.readGateChecks(run.runId),
    new PostgresPopulationRepository(runtime.db).readPopulation(run.runId),
    new PostgresAdapterExecutionRepository(runtime.db).readExecution(run.runId),
    new DrizzleProcedureRepository(runtime.db).findVersion(run.versionId),
    new DrizzleActorNameReader(runtime.db).namesFor([run.initiatorId]),
    // The same statement the Runs list and the Run header read, so the failure panel
    // cannot name a different reason from the banner above it.
    isStoppedState(run.state) ? new DrizzleRunStopReader(runtime.db).readStop(run.runId) : Promise.resolve(null),
    // The review projection, under its OWN action gate: a role that may not confirm an
    // evaluation gets `null` and the page shows no review section and no pending count.
    run.state === 'COMPLETED' || run.state === 'INCONCLUSIVE'
      ? readEvaluationReview(run.runId)
      : Promise.resolve(null),
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
  const templateId = version?.compiledPlan?.inputs.templateId ?? null;
  // A Target System's frozen display name, from the Version the Run executed. The Result
  // stores the registration id, which is a UUID to a reader (UX-21).
  const systemName = (registrationId: string): string | null =>
    version?.compiledPlan?.inputs.targets.find((target) => target.registrationId === registrationId)?.displayName ?? null;

  // The human-selected matches (Story 10.6, legacy 4.7): among the records the Result
  // names, by the record it names them by, and every one of the Run's, for the Result's own
  // list — each read from the registration link, never by lining a wait up by time.
  const namedRecords = result?.publication === null || result?.publication === undefined
    ? []
    : [...result.publication.exceptions.records, ...result.publication.unevaluated.records]
      .map((record) => ({ targetSystem: record.targetSystem, populationRecordKey: record.populationRecordKey }));
  const [findingMatches, humanMatchList] = await Promise.all([
    readHumanMatchIndex(runtime.db, run.runId, { records: namedRecords }),
    readRunHumanMatchList(runtime.db, run.runId),
  ]);
  const naming = recordNaming(version?.compiledPlan ?? null);

  const declaredCountPassed =
    population?.summary?.checks.find((check) => check.name === 'declared-count')?.passed ?? null;
  const publication = result?.publication ?? null;
  const uninspected = (publication?.coverage ?? []).reduce((total, entry) => total + entry.uninspected, 0);

  // The review section, and whether it leads or is history. An unsealed Result is what
  // the reader has to act on; a sealed one has nothing left to decide, so its decisions
  // are collapsed rather than put in front of the conclusion they produced.
  const reviewIsHistory = result?.sealed === true;
  const reviewSection = review === null ? null : (
    <EvaluationReview
      runId={run.runId}
      result={review.result}
      evaluations={review.evaluations}
      reviewRevision={review.reviewRevision}
      pendingCount={review.pendingCount}
      commandStatuses={review.commandStatuses}
      recordKeys={review.recordKeys}
      reviewerNames={review.reviewerNames}
    />
  );

  return (
    <RunDetailFrame run={run} tab="" readAt={readAt}>
      {/* 1. The conclusion. */}
      <ConclusionTriptych
        state={run.state}
        result={result}
        gateChecks={gate.length}
        gateFailed={failedGate}
        pendingCount={review?.pendingCount ?? null}
      />
      {run.state === 'RUN_FAILED' ? (
        <ExecutionFailurePanel steps={failedSteps} stop={stop} sealedAt={result?.sealedAt ?? null} />
      ) : null}
      {terminalStop && result !== null ? <SafeNextActionPanel result={result} /> : null}

      {/* 2. What needs the reader now — or, once nothing does, the record of what was
             decided, out of the way of the conclusion it produced. */}
      {reviewSection === null ? null : reviewIsHistory ? (
        <details className="ls-disclosure ls-card">
          <summary>{RESULT_WORDS.reviewHistory}</summary>
          <div className="ls-disclosure__body">{reviewSection}</div>
        </details>
      ) : (
        reviewSection
      )}

      {/* One sentence, not two: the triptych's statement line already says it. This
          explains what is still true, which is what a reader needs next. */}
      {result !== null && publication === null ? <p>{RESULT_WORDS.unreadableDocument}</p> : null}

      {publication === null ? null : (
        <>
          {/* 3. The records the Result names. */}
          <FindingsSection
            publication={publication}
            runId={run.runId}
            conditionText={conditionText}
            templateId={templateId}
            systemName={systemName}
            humanMatches={findingMatches}
          />

          {/* 4. Coverage, scope and the reconciliation, compact. */}
          <CoverageSection publication={publication} systemName={systemName} />
          <ScopeSection publication={publication} />
          <ConditionCards
            publication={publication}
            conditionText={conditionText}
            templateId={templateId}
          />
          <PopulationReconciliation
            publication={publication}
            rowsDigest={population?.summary?.rowsDigest ?? null}
            declaredCountPassed={declaredCountPassed}
            declaredCount={population?.summary?.declaredCount ?? null}
            retrievedCount={population?.summary?.retrievedCount ?? null}
            evidence={population?.evidence ?? null}
            runId={run.runId}
            uninspected={uninspected}
          />
        </>
      )}

      {/* 3b. Every record a person matched, whether or not the Result names it. Read
             beside the sealed document; renders nothing for a Run with no such match. */}
      <HumanMatchesSection list={humanMatchList} runId={run.runId} systemName={systemName} naming={naming} />

      {/* 5. The evidence checks: a summary line, the failed rows open, the passed rows
             behind a disclosure. */}
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

      {/* 6. What the Run froze, behind a disclosure: thirty-one artifact rows are a
             provenance record, not the first thing a conclusion is read through. */}
      {publication === null ? null : <EvidencePackageSection publication={publication} runId={run.runId} />}

      {/* 7. The Result's own exact facts. The Run's identifiers — its id, correlation id,
          version, period, start and initiator — are in the frame's Technical details on
          every tab, so they are not repeated here. */}
      {(result?.sealedAt === null || result?.sealedAt === undefined) && run.predecessorRunId === null ? null : (
        <TechnicalDetails
          items={[
            ...(result?.sealedAt === null || result?.sealedAt === undefined
              ? []
              : [{ label: 'Concluded at', value: utcStamp(result.sealedAt), mono: true }]),
            ...(run.predecessorRunId === null
              ? []
              : [{
                  label: 'Rerun of',
                  value: <Link className="ls-mono" href={`/runs/${run.predecessorRunId}`}>{run.predecessorRunId}</Link>,
                  mono: true,
                }]),
          ]}
        />
      )}

      {/* The Run's own facts, in a person's words: who started it, when, over what. The
          identifiers that used to be this section's first row are above. */}
      <section className="ls-card ls-stack" aria-labelledby="run-details">
        <h2 id="run-details">{RESULT_WORDS.runDetails}</h2>
        <dl className="ls-card__cells ls-run-details">
          <div>
            <dt>Test</dt>
            <dd>
              <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>
                {run.procedureName} · v{run.versionNumber}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Period covered</dt>
            <dd>{readablePeriod(run.period)}</dd>
          </div>
          <div>
            <dt>Started by</dt>
            {/* The person's name. The user id is under Technical details on every Run
                surface; printing one here is the platform speaking its own language. */}
            <dd>{names.get(run.initiatorId) ?? <span className="ls-mono">{run.initiatorId}</span>}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd><Timestamp value={run.initiatedAt} /></dd>
          </div>
          <div>
            <dt>Run kind</dt>
            <dd>{run.kind === 'STANDARD' ? 'Standard' : 'Regression'}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd><Reference kind="Run" value={run.runId} /></dd>
          </div>
          {/* A rerun says which Run it follows and why it exists. The predecessor itself
              is never changed by the link — only this row and this Run's own chain. */}
          {run.predecessorRunId === null ? null : (
            <div>
              <dt>Rerun of</dt>
              <dd>
                <Link href={`/runs/${run.predecessorRunId}`}>
                  <Reference kind="Run" value={run.predecessorRunId} />
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
