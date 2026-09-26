import type { Metadata } from 'next';
import Link from 'next/link';
import { isActiveRunState, isFlaggableRunState, runPauseTransition } from '@intellifin/domain';
import { DrizzleActorNameReader, DrizzleFrozenExecutionReader, DrizzleRunDetailRepository,
  PostgresRecordReviewRepository, readRecordNames, readTimelineHead } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../src/bootstrap';
import { currentIdentity } from '../../../../src/server-session';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { RunDenied, openRun, OpenEscalationSection, PauseBanners } from '../../../../src/runs/detail';
import { readOpenEscalation } from '../../../../src/runs/escalation-read';
import { readPauseHold } from '../../../../src/runs/pause-read';
import { readRunConversation, readCurrentRunInspection } from '../../../../src/runs/run-conversation-actions';
import { LiveGate } from '../../../../src/runs/LiveGate';
import { FrameSource, SessionStage } from '../../../../src/runs/LiveViewer';
import { RunPauseControls } from '../../../../src/runs/RunPauseControls';
import { RunCancelControl } from '../../../../src/runs/RunCancelControl';
import { RunFlagControl } from '../../../../src/runs/RunFlagControl';
import { RunWorkspaceConversation } from '../../../../src/runs/RunWorkspaceConversation';
import { WorkspacePreview } from '../../../../src/runs/WorkspacePreview';
import { WorkspaceCaptureView } from '../../../../src/runs/WorkspaceCaptureView';
import { WorkspaceHeader, WorkspaceProgress } from '../../../../src/runs/WorkspaceHeader';
import { UntrustedRegion } from '../../../../src/runs/UntrustedText';
import { SAVED_SCREEN_HEADING, noSavedScreenSentence, savedScreenSentence } from '../../../../src/runs/workspace-words';
import { frameNarration } from '../../../../src/runs/live-view';
import { recordNaming, recordWords } from '../../../../src/runs/record-words';
import { planActionWord } from '../../../../src/runs/labels';

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
  const [timeline, frame, current, plan, conversation, summary, selected, waits, cursor, flags, currentInspection] = await Promise.all([
    detail.readTimeline(id), detail.readLatestFrame(id),
    // The step the Run is on now, read on its own: the Timeline's page is the OLDEST
    // fifty Step Executions, so its newest row names a step a long Run finished long ago.
    detail.readLatestStepExecution(id),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    readRunConversation(id), records.readSummary({ runId: id, actorId: identity.session.userId }),
    ordinal === null ? Promise.resolve(null) : records.readSelection({ runId: id, actorId: identity.session.userId, sourceOrdinal: ordinal }),
    run.state === 'AWAITING_AUDITOR' || run.state === 'PAUSED' ? readOpenEscalation(id) : Promise.resolve(null),
    isActiveRunState(run.state) ? readTimelineHead(runtime.db, id) : Promise.resolve(null), detail.readFlags(id), readCurrentRunInspection(id),
  ]);
  // Where the pause holds the Run (Story 10.6, legacy 5.4), from the plan this page read.
  const pauseHold = await readPauseHold(runtime.db, run, waits?.pause ?? null, plan);
  const names = await new DrizzleActorNameReader(runtime.db).namesFor([
    ...flags.map(flag => flag.flaggedBy), ...(waits?.pause?.openedBy ? [waits.pause.openedBy] : []),
    ...(run.pauseRequest ? [run.pauseRequest.requestedBy] : []),
  ]);
  const itemFor = (workItemId: string | null) => timeline.workItems.find(item => item.workItemId === workItemId);
  const targetFor = (workItemId: string | null) => plan?.inputs.targets.find(target => target.registrationId === itemFor(workItemId)?.registrationId)?.displayName ?? null;
  // The frame's own Step Execution, wherever it sits in the Run's history.
  const frameStep = frame === null ? null
    : timeline.stepExecutions.rows.find(step => step.stepExecutionId === frame.stepExecutionId)
      ?? await detail.readStepExecution(id, frame.stepExecutionId);
  const decisionStep = plan === null ? undefined : [...plan.sessionSteps, ...plan.targetSystems.flatMap(target => target.planSteps)]
    .find(step => step.id === waits?.details?.stepId);
  const currentTarget = targetFor(current?.workItemId ?? null);
  const frameWorkItemId = frame === null ? null : frameStep?.workItemId ?? frame.workItemId;
  // UX-25: a record is named the way the record review names it — the key, then the
  // person's name — and masked wherever the version's frozen binding says so (FR-41).
  const naming = recordNaming(plan);
  const subjectKeys = [itemFor(current?.workItemId ?? null)?.subjectKey, itemFor(frameWorkItemId)?.subjectKey]
    .filter((key): key is string => typeof key === 'string');
  const recordNames = plan === null ? new Map<string, string>() : await readRecordNames(runtime.db, id, plan, subjectKeys);
  const subjectLabel = (key: string | null | undefined): string | null =>
    key === null || key === undefined ? null : recordWords({ key, name: recordNames.get(key) ?? null }, naming);
  const currentSubject = subjectLabel(itemFor(current?.workItemId ?? null)?.subjectKey);
  const here = `/runs/${id}/workspace`;
  return <div className="ls-stack run-workspace-route">
    <DetailTrail trail={[{ href: '/runs', label: 'Runs' }, { href: `/runs/${id}`, label: run.procedureName }, { href: here, label: 'Auditor Workspace' }]} />
    <LiveGate runId={id} state={run.state} url={`/api/runs/${id}/events`} cursor={cursor} readAt={readAt.toISOString()} href={here}>
      <RunWorkspaceConversation key={id} runId={id} initial={conversation} controlRefreshKey={readAt.toISOString()} currentInspection={currentInspection} questionContext={waits?.question ?? null}
        selectedSourceOrdinal={selected?.status === 'ready' ? selected.row.sourceOrdinal : null} replyToWaitId={waits?.wait?.waitId ?? null}
        header={<WorkspaceHeader run={run} />}
        progress={<WorkspaceProgress counts={summary.status === 'ready' ? summary.counts : null} readAt={readAt}
          current={current === null ? null : { action: current.action, subject: currentSubject, target: currentTarget, startedAt: current.startedAt }} />}
        controls={<>{run.state === 'AWAITING_AUDITOR'
          ? <p className="ls-caption">Pause is unavailable while an auditor answer is open.</p>
          : <RunPauseControls showController={false} runId={id} procedureName={run.procedureName} paused={run.state === 'PAUSED'}
            pausePending={run.pauseRequest !== null} awaitingAuditor={false}
            pausable={runPauseTransition(run.state) !== null} runRevision={waits?.runRevision ?? null} controlRefreshKey={readAt.toISOString()} />}
          <RunCancelControl runId={id} procedureName={run.procedureName} active={isActiveRunState(run.state)} cancelPending={run.cancellation !== null} />
          <Link href={`/runs/${id}/evidence`}>Records and findings</Link><Link href={`/runs/${id}/replay`}>Replay</Link>
          <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>Approved procedure</Link></>}
        currentDecision={<><OpenEscalationSection run={run} escalation={waits} readAt={readAt}
          workspacePresentation={{ stepLabel: decisionStep === undefined ? null : planActionWord(decisionStep.action) }} />
          <PauseBanners run={run} pause={waits?.pause ?? null} hold={pauseHold} readAt={readAt} names={names} />
          {selected?.status === 'ready' && <p>Conversation context: {recordWords({ key: selected.row.recordLabel, name: selected.row.recordName ?? null }, naming)}. <Link href={`/runs/${id}/evidence?selected=${selected.row.sourceOrdinal}`}>Open record inspector</Link></p>}
          {ordinal !== null && selected?.status !== 'ready' && <p>The selected record is unavailable. Messages will have Run context only.</p>}</>}
        workspace={<div className="run-workspace-stage">
          <h2>{isActiveRunState(run.state) ? 'Agent workspace' : 'Last workspace capture'}</h2>
          {/* The live picture first, then the saved one (UX-24). The preview says it is a
              few seconds behind and is not evidence; the saved screen says it IS, and
              which system, page and instant it came from. No sentence here names the
              mechanism behind either. */}
          <WorkspacePreview key={id} runId={id} enabled={isActiveRunState(run.state) && runtime.config.WORKSPACE_PREVIEW_MODE === 'synthetic-local'} />
          <h3>{SAVED_SCREEN_HEADING}</h3>
          {frame === null ? null : <p className="ls-caption">{savedScreenSentence(targetFor(frameWorkItemId))}</p>}
          <WorkspaceCaptureView hasCapture={frame !== null}>
            <SessionStage runId={id} frame={frame === null ? null : {
              evidenceId: frame.evidenceId, sourceLocation: frame.sourceLocation, digest: frame.digest, capturedAt: frame.capturedAt,
              narration: frameNarration(frame, frameStep, targetFor(frameWorkItemId), subjectLabel(itemFor(frameWorkItemId)?.subjectKey)),
            }} stageNote={noSavedScreenSentence({ browserOpened: timeline.workspace !== null, active: isActiveRunState(run.state) })} />
          </WorkspaceCaptureView>
          {/* The captured page location is the Target System's own text, so it stays in an
              inert untrusted block; the policy sentence is said once, above it (UX-27). */}
          {frame === null ? null : <UntrustedRegion><FrameSource frame={frame} headingId="workspace-frame-source-heading" /></UntrustedRegion>}
        </div>} />
    {/* `RunFlagControl` is its own native disclosure ("Flag to Audit Manager", UX-48), so
        it is not wrapped in a second one. */}
    <RunFlagControl runId={id} flaggable={isFlaggableRunState(run.state)} flags={flags.map(flag => ({ ...flag, flaggedBy: names.get(flag.flaggedBy) ?? 'Auditor' }))} />
    </LiveGate>
  </div>;
}
