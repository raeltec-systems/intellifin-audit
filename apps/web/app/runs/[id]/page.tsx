import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DrizzleRunRepository, PostgresPopulationRepository } from '@intellifin/infrastructure';
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
    <p><Link href={`/runs/${run.runId}`}>Refresh Run</Link></p>
  </div>;
}
