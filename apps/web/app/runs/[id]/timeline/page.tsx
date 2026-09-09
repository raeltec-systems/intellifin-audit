import type { Metadata } from 'next';

import { DrizzleRunDetailRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { ExecutionTimeline } from '../../../../src/runs/Timeline';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { countText } from '../../../../src/runs/labels';

export const metadata: Metadata = { title: 'Run · Execution Timeline · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Run Detail → Execution Timeline.
 *
 * The backend WRITES the Timeline as the Run executes; this page SHOWS what exists when
 * the request is served. There is no polling, no streaming and no auto-refresh — the
 * `Updated {time}. Refresh.` banner in the frame is what tells the reader the page is a
 * snapshot — and Epic 5's live channel on Live View is compatible with that because this
 * read asks the database at the moment the request is served.
 *
 * There is no Tool Action row and no "Open in Replay" link: both are later epics, and a
 * link to a surface that does not exist would send an auditor to a 404.
 */
export default async function RunTimelinePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  const runtime = await getRuntime();
  const timeline = await new DrizzleRunDetailRepository(runtime.db).readTimeline(run.runId);
  const nothing =
    timeline.population === null &&
    timeline.execution === null &&
    timeline.sessionSteps.length === 0 &&
    timeline.workItems.length === 0;

  return (
    <RunDetailFrame run={run} tab="timeline" readAt={readAt}>
      {nothing ? (
        <EmptyState
          icon="refresh-cw"
          headline={RUN_TAB_EMPTY.timeline.headline}
          sentence={RUN_TAB_EMPTY.timeline.sentence}
        />
      ) : (
        <section className="ls-card ls-stack" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Execution Timeline</h2>
          <p>
            {countText(timeline.stepExecutions.rows.length)} of{' '}
            {countText(timeline.stepExecutions.total)} Step Executions are listed. Step
            Executions are collapsed under the unit that started them; a unit with a failure
            is expanded.
          </p>
          <ExecutionTimeline timeline={timeline} runId={run.runId} />
        </section>
      )}
    </RunDetailFrame>
  );
}
