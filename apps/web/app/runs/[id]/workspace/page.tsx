import type { Metadata } from 'next';
import Link from 'next/link';
import { isActiveRunState, isFlaggableRunState, runPauseTransition } from '@intellifin/domain';
import { DrizzleActorNameReader, DrizzleFrozenExecutionReader, DrizzleRunDetailRepository,
  PostgresRecordReviewRepository, readTimelineHead } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../src/bootstrap';
import { currentIdentity } from '../../../../src/server-session';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { RunDenied, openRun, OpenEscalationSection, PauseBanners } from '../../../../src/runs/detail';
import { readOpenEscalation } from '../../../../src/runs/escalation-read';
import { readRunConversation } from '../../../../src/runs/run-conversation-actions';
import { LiveGate } from '../../../../src/runs/LiveGate';
import { SessionStage } from '../../../../src/runs/LiveViewer';
import { RunPauseControls } from '../../../../src/runs/RunPauseControls';
import { RunCancelControl } from '../../../../src/runs/RunCancelControl';
import { RunFlagControl } from '../../../../src/runs/RunFlagControl';
import { RunWorkspaceConversation } from '../../../../src/runs/RunWorkspaceConversation';
import { frameNarration, currentStepExecution, stepNarration } from '../../../../src/runs/live-view';
import { utcStamp } from '../../../../src/runs/labels';

export const metadata: Metadata = { title: 'Auditor Workspace · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

export default async function RunWorkspacePage({ params, searchParams }: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const { id: requestedId } = await params;
  const access = await openRun(requestedId);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;
  const id = run.runId;
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return <RunDenied reason="Sign in to open this workspace." />;
  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  const records = new PostgresRecordReviewRepository(runtime.db);
  const search = await searchParams;
  const ordinal = typeof search.record === 'string' && /^[1-9]\d{0,4}$/.test(search.record) ? Number(search.record) : null;
  const [timeline, frame, plan, conversation, summary, selected, waits, cursor, flags] = await Promise.all([
    detail.readTimeline(id), detail.readLatestFrame(id),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    readRunConversation(id), records.readSummary({ runId: id, actorId: identity.session.userId }),
    ordinal === null ? Promise.resolve(null) : records.readSelection({ runId: id, actorId: identity.session.userId, sourceOrdinal: ordinal }),
    run.state === 'AWAITING_AUDITOR' || run.state === 'PAUSED' ? readOpenEscalation(id) : Promise.resolve(null),
    isActiveRunState(run.state) ? readTimelineHead(runtime.db, id) : Promise.resolve(null), detail.readFlags(id),
  ]);
  const names = await new DrizzleActorNameReader(runtime.db).namesFor([
    ...flags.map(flag => flag.flaggedBy), ...(waits?.pause?.openedBy ? [waits.pause.openedBy] : []),
    ...(run.pauseRequest ? [run.pauseRequest.requestedBy] : []),
  ]);
  const current = currentStepExecution(timeline.stepExecutions.rows);
  const itemFor = (workItemId: string | null) => timeline.workItems.find(item => item.workItemId === workItemId);
  const targetFor = (workItemId: string | null) => plan?.inputs.targets.find(target => target.registrationId === itemFor(workItemId)?.registrationId)?.displayName ?? null;
  const frameStep = frame === null ? null : timeline.stepExecutions.rows.find(step => step.stepExecutionId === frame.stepExecutionId) ?? null;
  const here = `/runs/${id}/workspace`;
  return <div className="ls-stack">
    <DetailTrail trail={[{ href: '/runs', label: 'Runs' }, { href: `/runs/${id}`, label: run.procedureName }, { href: here, label: 'Auditor Workspace' }]} />
    <LiveGate runId={id} state={run.state} url={`/api/runs/${id}/events`} cursor={cursor} readAt={readAt.toISOString()} href={here}>
      <RunWorkspaceConversation runId={id} initial={conversation}
        selectedSourceOrdinal={selected?.status === 'ready' ? selected.row.sourceOrdinal : null} replyToWaitId={waits?.wait?.waitId ?? null}
        header={<header><h1>Auditor Workspace · {run.procedureName}</h1>
          <p>Approved version {run.versionNumber} · {run.period.from} to {run.period.to} · {run.state.toLowerCase().replaceAll('_', ' ')}</p></header>}
        progress={<div role="group" aria-label="Run progress">
          {summary.status === 'ready' ? <p>{summary.counts.fullyInspectedSubjects} of {summary.counts.includedRows} included records inspected · {summary.counts.exceptionRecords ?? 'Unknown'} with exceptions · {summary.counts.pendingAssessments} assessments awaiting confirmation</p>
            : <p>Record coverage is not yet available.</p>}
          <p className="ls-caption">Read at {utcStamp(readAt)}. {current === null ? 'No committed current action.' : stepNarration(current, targetFor(current.workItemId), itemFor(current.workItemId)?.subjectKey ?? null)}</p>
        </div>}
        controls={<><RunPauseControls runId={id} procedureName={run.procedureName} paused={run.state === 'PAUSED'}
          pausePending={run.pauseRequest !== null} awaitingAuditor={run.state === 'AWAITING_AUDITOR'}
          pausable={runPauseTransition(run.state) !== null} runRevision={waits?.runRevision ?? null} />
          <RunCancelControl runId={id} procedureName={run.procedureName} active={isActiveRunState(run.state)} cancelPending={run.cancellation !== null} />
          <Link href={`/runs/${id}/evidence`}>Records and findings</Link><Link href={`/runs/${id}/replay`}>Replay</Link>
          <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>Approved procedure</Link></>}
        currentDecision={<><OpenEscalationSection run={run} escalation={waits} readAt={readAt} />
          <PauseBanners run={run} pause={waits?.pause ?? null} readAt={readAt} names={names} />
          {selected?.status === 'ready' && <p>Conversation context: {selected.row.recordLabel}. <Link href={`/runs/${id}/evidence?selected=${selected.row.sourceOrdinal}`}>Open record inspector</Link></p>}
          {ordinal !== null && selected?.status !== 'ready' && <p>The selected record is unavailable. Messages will have Run context only.</p>}</>}
        workspace={<section aria-label="Action-linked workspace captures">
          <h2>{isActiveRunState(run.state) ? 'Agent workspace' : 'Last workspace capture'}</h2>
          <p>Action-linked captures · {timeline.workspace?.status.toLowerCase() ?? 'workspace not yet available'}</p>
          <SessionStage runId={id} frame={frame === null ? null : {
            evidenceId: frame.evidenceId, sourceLocation: frame.sourceLocation, digest: frame.digest, capturedAt: frame.capturedAt,
            narration: frameNarration(frame, frameStep, targetFor(frameStep?.workItemId ?? frame.workItemId), itemFor(frameStep?.workItemId ?? frame.workItemId)?.subjectKey ?? null),
          }} stageNote={timeline.workspace === null ? 'No browser workspace has been recorded for this Run.' : 'No registered workspace capture is available yet.'} />
          <p className="ls-caption">Images update when execution registers evidence. Near-live preview is not available in this development checkpoint.</p>
        </section>} />
    <details><summary>Flag this Run</summary><RunFlagControl runId={id} flaggable={isFlaggableRunState(run.state)} flags={flags.map(flag => ({ ...flag, flaggedBy: names.get(flag.flaggedBy) ?? 'Auditor' }))} /></details>
    </LiveGate>
  </div>;
}
