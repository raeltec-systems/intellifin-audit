import { PauseLinkageHistory } from '../../../../src/runs/PauseLinkage';
import type { Metadata } from 'next';

import { DrizzleRunDetailRepository, DrizzleActorNameReader, readRunPauseLinkage } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { ExecutionTimeline } from '../../../../src/runs/Timeline';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { stepExecutionsSentence } from '../../../../src/runs/stage-words';

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
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  const runtime = await getRuntime();
  const timeline = await new DrizzleRunDetailRepository(runtime.db).readTimeline(run.runId);
  const query = await searchParams ?? {};
  const rawCursor = query.pauseBefore;
  const parsedCursor = typeof rawCursor === 'string' && /^[1-9][0-9]*$/.test(rawCursor) ? Number(rawCursor) : null;
  const pauseBefore = parsedCursor !== null && Number.isSafeInteger(parsedCursor) ? parsedCursor : null;
  const pauses = await readRunPauseLinkage(runtime.db, run.runId, pauseBefore);
  const pauseBaseHref = `/runs/${encodeURIComponent(run.runId)}/timeline`;
  const pauseHref = (before: number | null): string => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (key !== 'pauseBefore' && value !== undefined) {
      for (const item of typeof value === 'string' ? [value] : value) parameters.append(key, item);
    }
    if (before !== null) parameters.set('pauseBefore', String(before));
    return `${pauseBaseHref}${parameters.size === 0 ? '' : `?${parameters.toString()}`}#pause-resume-history`;
  };
  const pauseNames = await new DrizzleActorNameReader(runtime.db).namesFor(pauses.rows.map(entry => entry.actorId));
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
          <ExecutionTimeline timeline={timeline} runId={run.runId} />
        </section>
      )}
      <PauseLinkageHistory entries={pauses.rows} total={pauses.total} names={pauseNames} firstHref={pauseBefore === null ? null : pauseHref(null)} nextHref={pauses.nextBeforeSequence === null ? null : pauseHref(pauses.nextBeforeSequence)} />
    </RunDetailFrame>
  );
}
