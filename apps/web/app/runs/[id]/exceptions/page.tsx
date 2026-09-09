import type { Metadata } from 'next';

import { adapterLookupColumn } from '@intellifin/domain';
import { DrizzleProcedureRepository, DrizzleRunDetailRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { ExceptionCard } from '../../../../src/runs/ExceptionList';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { countText } from '../../../../src/runs/labels';

export const metadata: Metadata = { title: 'Run · Exceptions · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Run Detail → Exceptions.
 *
 * Every Exception this Run raised, ordered by identifier, with its immutable condition
 * set and the current effective Exception conditions. There are no disposition controls:
 * FR-42's Open → Under Review → Confirmed / Not an Exception transitions are Epic 6, and
 * a control that does nothing is worse than a control that is not there yet.
 */
export default async function RunExceptionsPage({
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
  const [exceptions, version] = await Promise.all([
    detail.readExceptions(run.runId),
    new DrizzleProcedureRepository(runtime.db).findVersion(run.versionId),
  ]);
  const evaluations = await detail.readEvaluations(
    run.runId,
    exceptions.rows.map((row) => row.observationId),
  );

  const plan = version?.compiledPlan ?? null;
  const conditions = plan?.inputs.complianceConditions ?? [];
  const conditionText = (conditionId: string): string | null =>
    conditions.find((condition) => condition.conditionId === conditionId)?.text ?? null;

  /*
    FR-41: the identity is masked where the Population Source binding designates it. The
    matching key column is the Template's own lookup column, and the sensitive set is
    frozen on the Version's source snapshot — so this is read from the contract the Run
    executed under, never from the binding as it stands today.
  */
  const lookupColumn = plan === null ? null : adapterLookupColumn(plan.inputs.templateId);
  const sensitive = plan?.inputs.sourceSnapshot?.contract.sensitive_fields ?? [];
  const masked = lookupColumn !== null && sensitive.includes(lookupColumn);

  return (
    <RunDetailFrame run={run} tab="exceptions" readAt={readAt}>
      {exceptions.rows.length === 0 ? (
        <EmptyState
          icon="alert-circle"
          headline={RUN_TAB_EMPTY.exceptions.headline}
          sentence={RUN_TAB_EMPTY.exceptions.sentence}
        />
      ) : (
        <section className="ls-card ls-stack" aria-labelledby="exceptions-heading">
          <h2 id="exceptions-heading">Exceptions</h2>
          <p>
            {countText(exceptions.rows.length)} of {countText(exceptions.total)} Exceptions are
            listed.
          </p>
          <ul className="ls-plain-list">
            {exceptions.rows.map((exception) => (
              <ExceptionCard
                key={exception.exceptionId}
                exception={exception}
                evaluations={evaluations.filter((entry) => entry.observationId === exception.observationId)}
                conditionText={conditionText}
                masked={masked}
              />
            ))}
          </ul>
        </section>
      )}
    </RunDetailFrame>
  );
}
