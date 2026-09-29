import type { Metadata } from 'next';

import { isActiveRunState } from '@intellifin/domain';
import { DrizzleRunDetailRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { ExecutionTimeline } from '../../../../src/runs/Timeline';
import { EscalationAnswersSection } from '../../../../src/runs/EscalationAnswers';
import { PauseHistorySection } from '../../../../src/runs/PauseHistory';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { readDecisionHistoryView } from '../../../../src/runs/decision-read';
import { readPauseHistoryView } from '../../../../src/runs/pause-read';
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
 * Each answered Escalation links to its jump target on Replay (Story 10.10), and only for a
 * Run that has ended: a Run still going has no Replay, and a link to one would open a page
 * that says so.
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
  // Every pause, where it held the Run and which attempt its resume started (Story 10.6,
  // legacy 5.4). Read by the identities the records carry, never paired by time.
  const pauses = await readPauseHistoryView(runtime.db, run);
  // Every answered Escalation and every pause request the Run never honoured (Story 10.10,
  // legacy 4.8, 5.6 and 5.4): read from the wait rows and the chain, by identity. The
  // frozen plan is passed on when the pause read already has it, so it is read once.
  const decisions = await readDecisionHistoryView(runtime.db, run, pauses.history.total > 0 ? pauses.plan : undefined);
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
      <PauseHistorySection {...pauses} requests={decisions.requests} />
      <EscalationAnswersSection {...decisions.escalations} runId={run.runId} replayable={!isActiveRunState(run.state)} />
    </RunDetailFrame>
  );
}
