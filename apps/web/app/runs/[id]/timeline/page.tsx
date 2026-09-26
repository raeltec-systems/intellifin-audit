import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { timelineRequest } from '../../../../src/runs/timeline-request';

import { DrizzleActorNameReader, DrizzleRunDetailRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { ExecutionTimeline } from '../../../../src/runs/Timeline';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { stepExecutionsSentence } from '../../../../src/runs/stage-words';

export const metadata: Metadata = { title: 'Run · Execution Timeline · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/** Run Detail's stored execution rows and retained decisions. The frame owns live refresh;
 * decision pages keyset on audit sequence, independently of the bounded execution rows. */
export default async function RunTimelinePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  const runtime = await getRuntime();
  const query = await searchParams;
  const request = timelineRequest(query);
  if (request === null) notFound();
  const { cursor } = request;
  const timeline = await new DrizzleRunDetailRepository(runtime.db).readTimeline(run.runId, undefined, cursor, request.waitId);
  if (!timeline.decisions.selectionFound) notFound();
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(timeline.decisions.rows.map(row => row.actorId));
  const nothing =
    timeline.decisions.total === 0 &&
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
          {/* `0 of 0 Step Executions are listed` is an arithmetic fact that reads as a
              rendering fault. What it means is that no record was tested, and whether the
              Run is still preparing its session or ended inside it is a fact about the Run
              — so the sentence is derived from both. */}
          <p>
            {stepExecutionsSentence(
              timeline.stepExecutions.rows.length,
              timeline.stepExecutions.total,
              run.state,
            )}
          </p>
          <ExecutionTimeline timeline={timeline} runId={run.runId} names={names} runState={run.state} />
          {timeline.decisions.total === 0 ? null : <nav aria-label="Decision history">
            <span>{timeline.decisions.rows.length} of {timeline.decisions.total} · Decisions</span>
            {cursor === 0 && query.wait === undefined ? null : <> · <Link href={`/runs/${run.runId}/timeline`}>First</Link></>}
            {timeline.decisions.nextCursor === null ? null : <> · <Link href={`/runs/${run.runId}/timeline?decisionsAfter=${timeline.decisions.nextCursor}`}>Next</Link></>}
          </nav>}
        </section>
      )}
    </RunDetailFrame>
  );
}
