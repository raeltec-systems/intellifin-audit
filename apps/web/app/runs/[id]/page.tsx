import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DrizzleRunRepository } from '@intellifin/infrastructure';
import type { RunState } from '@intellifin/domain';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { Banner } from '../../../src/design/Banner';
import { StatusBadge } from '../../../src/design/StatusBadge';
import type { StatusState } from '../../../src/design/status';

export const metadata: Metadata = { title: 'Run · IntelliFin Audit' };
export const dynamic = 'force-dynamic';
const labels: Record<RunState, StatusState<'run-lifecycle'>> = { QUEUED: 'Queued', RUNNING: 'Running', PAUSED: 'Paused', AWAITING_AUDITOR: 'Awaiting Auditor', COMPLETED: 'Completed', INCONCLUSIVE: 'Inconclusive', RUN_FAILED: 'Run Failed', CANCELED: 'Canceled' };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return <div className="ls-stack"><h1>Run</h1><Banner tone="danger" title={decision.reason} /></div>;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const runtime = await getRuntime();
  const run = await new DrizzleRunRepository(runtime.db).findRun(id);
  if (run === null) notFound();
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
    <p><Link href={`/runs/${run.runId}`}>Refresh Run</Link></p>
  </div>;
}
