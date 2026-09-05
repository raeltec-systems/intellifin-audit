import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DrizzleRunRepository, PostgresAdapterExecutionRepository, PostgresPopulationRepository } from '@intellifin/infrastructure';
import { Digest } from '../../../src/design/Digest';
import type { RunState } from '@intellifin/domain';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { Banner } from '../../../src/design/Banner';
import { StatusBadge } from '../../../src/design/StatusBadge';
import type { StatusState } from '../../../src/design/status';

export const metadata: Metadata = { title: 'Run · IntelliFin Audit' };
export const dynamic = 'force-dynamic';
const labels: Record<RunState, StatusState<'run-lifecycle'>> = { QUEUED: 'Queued', RUNNING: 'Running', PAUSED: 'Paused', AWAITING_AUDITOR: 'Awaiting Auditor', COMPLETED: 'Completed', INCONCLUSIVE: 'Inconclusive', RUN_FAILED: 'Run Failed', CANCELED: 'Canceled' };
/** The §E Work Item vocabulary, in the design system's words. `Object.hasOwn` guards the
 * lookup: a state read from a row is request-shaped input like any other. */
const workItemLabels: Record<string, StatusState<'work-item'>> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', AWAITING: 'Awaiting', OBSERVED: 'Observed', UNINSPECTED: 'Uninspected', AMBIGUOUS: 'Ambiguous', FAILED: 'Failed' };
/** A Session Step has no badge family in DESIGN.md, so it is written in words. */
const sessionStepLabels: Record<string, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', ACQUIRED: 'Acquired', FAILED: 'Failed' };
function labelOf(table: Record<string, string>, state: string): string {
  return Object.hasOwn(table, state) ? table[state]! : state;
}
/** A state the vocabulary does not hold is written in words, never guessed into a badge:
 * `StatusBadge` throws on an unknown state, and that would be a 500 on a whole page. */
function workItemState(state: string): React.JSX.Element {
  return Object.hasOwn(workItemLabels, state)
    ? <StatusBadge family="work-item" state={workItemLabels[state]!} size="sm" />
    : <>{state}</>;
}

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ after?: string }> }): Promise<React.JSX.Element> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return <div className="ls-stack"><h1>Run</h1><Banner tone="danger" title={decision.reason} /></div>;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const runtime = await getRuntime();
  const run = await new DrizzleRunRepository(runtime.db).findRun(id);
  if (run === null) notFound();
  const after = Number((await searchParams).after ?? 0);
  const population = await new PostgresPopulationRepository(runtime.db).readPopulation(id,after);
  const execution = await new PostgresAdapterExecutionRepository(runtime.db).readExecution(id);
  return <div className="ls-stack">
    <nav aria-label="Breadcrumb"><Link href={`/procedures/${run.procedureId}`}>{run.procedureName}</Link> / Run</nav>
    <header className="ls-page-header"><h1>Run · {run.procedureName}</h1><StatusBadge family="run-lifecycle" state={labels[run.state]} size="md" /></header>
    {run.state === 'QUEUED' && <Banner tone="info" title="Run queued">The Run is saved and waiting for execution. No conclusion has been issued.</Banner>}
    <section className="ls-card ls-stack" aria-labelledby="run-details"><h2 id="run-details">Run details</h2>
      <dl className="ls-card__cells ls-run-details">
        <div><dt>Run ID</dt><dd>{run.runId}</dd></div>
        <div><dt>Procedure Version</dt><dd><Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>v{run.versionNumber}</Link></dd></div>
        <div><dt>Period</dt><dd>{run.period.from} to {run.period.to} (inclusive)</dd></div>
        <div><dt>Initiator</dt><dd>{run.initiatorId}</dd></div>
        <div><dt>Initiated at</dt><dd>{run.initiatedAt.replace('T', ' ').replace('Z', ' UTC')}</dd></div>
        <div><dt>Run kind</dt><dd>{run.kind === 'STANDARD' ? 'Standard' : 'Regression'}</dd></div>
        <div><dt>Correlation ID</dt><dd>{run.correlationId}</dd></div>
      </dl>
    </section>
    {population && <section className="ls-card ls-stack" aria-labelledby="population-heading">
      <h2 id="population-heading">Population acquisition</h2>
      <p>{population.status === 'POPULATION_READY' ? 'Population verified. Target checks are pending.' : population.status === 'TERMINAL' ? 'Population acquisition stopped.' : 'Population acquisition is in progress.'} Attempts: {population.attempts}.</p>
      {population.diagnostic && <Banner tone="warning" title="Population diagnostic">{population.diagnostic}</Banner>}
      {population.summary && <><dl><dt>Rows acquired</dt><dd>{population.summary.included + population.summary.excluded + population.summary.indeterminate}</dd><dt>Included</dt><dd>{population.summary.included}</dd><dt>Excluded</dt><dd>{population.summary.excluded}</dd><dt>Indeterminate</dt><dd>{population.summary.indeterminate}</dd></dl>
        <ul>{population.summary.checks.map(check => <li key={check.name}>{check.name}: {check.passed ? 'Passed' : 'Failed'}</li>)}</ul></>}
      {population.evidence && <dl><dt>Evidence ID</dt><dd>{population.evidence.evidenceId}</dd><dt>Evidence state</dt><dd>{population.evidence.state === 'REGISTERED' ? 'Registered' : population.evidence.state === 'ABANDONED' ? 'Abandoned' : 'Reserved'}</dd><dt>SHA-256 of original bytes</dt><dd>{population.evidence.rawDigest ? <Digest label="Population Evidence" value={population.evidence.rawDigest} /> : population.evidence.state === 'ABANDONED' ? 'Not registered; acquisition stopped.' : 'Reserved; verification pending'}</dd><dt>Bytes</dt><dd>{population.evidence.size ?? 'Not yet registered'}</dd></dl>}
      {population.rows.length > 0 && <><h3>Excluded and indeterminate rows</h3><table><thead><tr><th scope="col">Source row</th><th scope="col">Disposition</th><th scope="col">Reasons</th></tr></thead><tbody>{population.rows.map(row=><tr key={row.ordinal}><td>{row.ordinal}</td><td>{row.disposition}</td><td>{row.reasons.join('; ')}</td></tr>)}</tbody></table></>}
      {after > 0 && <Link href={`/runs/${id}`}>First reasons</Link>}{population.next !== null && <Link href={`/runs/${id}?after=${population.next}`}>Next reasons</Link>}
    </section>}
    {execution && <section className="ls-card ls-stack" aria-labelledby="execution-heading">
      <h2 id="execution-heading">Target System execution</h2>
      <p>{execution.status === 'EXTRACTION_COMPLETE' ? 'Every Reference Source is frozen and every Work Item has run.' : execution.status === 'TERMINAL' ? 'Target System execution stopped.' : 'Target System execution is in progress.'} Attempts: {execution.attempts}.</p>
      {execution.diagnostic && <Banner tone="warning" title="Execution diagnostic">{execution.diagnostic}</Banner>}
      {execution.sessionSteps.length > 0 && <><h3>Reference Sources</h3>
        <table><caption>Session Steps, acquired before any Work Item</caption><thead><tr><th scope="col">Reference Source</th><th scope="col">State</th><th scope="col">Attempts</th><th scope="col">Diagnostic</th><th scope="col">SHA-256 of frozen bytes</th></tr></thead>
        <tbody>{execution.sessionSteps.map(step => <tr key={step.stepId}><td>{step.displayName}</td><td>{labelOf(sessionStepLabels, step.state)}</td><td>{step.attempts}</td><td>{step.diagnostic ?? 'None'}</td><td>{step.evidence?.digest ? <Digest label="Reference Source Evidence" value={step.evidence.digest} /> : step.evidence?.state === 'ABANDONED' ? 'Not registered; acquisition stopped.' : 'Not yet frozen'}</td></tr>)}</tbody></table></>}
      {execution.workItems.length > 0 && <><h3>Work Items</h3>
        <table><caption>One Work Item per adapter-acquired Target System, executed in order</caption><thead><tr><th scope="col">Target System</th><th scope="col">State</th><th scope="col">Observations</th><th scope="col">Attempts</th><th scope="col">Diagnostic</th><th scope="col">SHA-256 of frozen bytes</th></tr></thead>
        <tbody>{execution.workItems.map(item => <tr key={item.workItemId}><td>{item.displayName}</td><td>{workItemState(item.state)}</td><td>{item.observations}</td><td>{item.attempts}</td><td>{item.diagnostic ?? 'None'}</td><td>{item.evidence?.digest ? <Digest label="Adapter extraction Evidence" value={item.evidence.digest} /> : item.evidence?.state === 'ABANDONED' ? 'Not registered; extraction stopped.' : 'Not yet frozen'}</td></tr>)}</tbody></table></>}
    </section>}
    <p><Link href={`/runs/${run.runId}`}>Refresh Run</Link></p>
  </div>;
}
