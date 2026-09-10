import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState, runPauseTransition } from '@intellifin/domain';
import {
  DrizzleFrozenExecutionReader,
  DrizzleRunDetailRepository,
  readTimelineHead,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { LIVE_VIEW_QUEUED_SENTENCE } from '../../../../src/design/copy';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { LiveBanner } from '../../../../src/runs/LiveBanner';
import { RunPauseControls } from '../../../../src/runs/RunPauseControls';
import { readOpenEscalation } from '../../../../src/runs/escalation-read';
import { PauseBanners } from '../../../../src/runs/detail';
import { EndedBanner, LiveViewer } from '../../../../src/runs/LiveViewer';
import { RunDenied, openRun, runTabHref } from '../../../../src/runs/detail';
import { planActionWord, runLifecycleWord, utcStamp } from '../../../../src/runs/labels';
import { StatusBadge } from '../../../../src/design/StatusBadge';
import {
  LIVE_VIEW_STAGE,
  currentStepExecution,
  frameNarration,
  liveViewChrome,
  plannedStepCount,
  stepNarration,
} from '../../../../src/runs/live-view';

export const metadata: Metadata = { title: 'Run · Live View · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Live View (FR-24, UX-DR24, UX-DR25; `docs/contracts/live-view-v1.md`).
 *
 * A SEPARATE surface, not a sixth Run Detail tab: EXPERIENCE.md reaches it from the Run
 * Detail rail's Watch control and from a notification, and its breadcrumb is
 * "Runs / <run> / Live". It authorizes for itself, exactly as each Run Detail tab does —
 * reaching one surface has never been a precondition for reading another.
 *
 * Everything on it is a SERVER read of what PostgreSQL holds at the moment the request
 * is served. The live channel (Story 5.1) carries no page content: it carries Timeline
 * sequence numbers, and each one makes this page re-read. So a frame the reader sees is
 * a REGISTERED artifact whose digest was verified when the platform froze it, never a
 * value that travelled over a stream.
 *
 * Story 5.3 is READ-ONLY supervision. Pause, Resume and Flag are Stories 5.4 and 5.5;
 * Cancel already exists on Run Detail and this surface links there. A disabled control
 * whose action does not exist yet is worse than a control that is not there.
 */
export default async function RunLivePage({
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
  const [timeline, frame, agentWork, evidence, plan, liveCursor] = await Promise.all([
    detail.readTimeline(run.runId),
    detail.readLatestFrame(run.runId),
    detail.readAgentWorkPosition(run.runId),
    detail.readEvidenceItems(run.runId),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    isActiveRunState(run.state) ? readTimelineHead(runtime.db, run.runId) : Promise.resolve(null),
  ]);

  const targetName = (registrationId: string | null): string | null =>
    registrationId === null
      ? null
      : plan?.inputs.targets.find((target) => target.registrationId === registrationId)?.displayName ?? null;

  // The Step the frame belongs to, so the frame's alt text and the rail's narration are
  // the SAME sentence (UX-DR37). A frame whose Step Execution has fallen off the bounded
  // read narrates from the action instead, which is why `frameNarration` takes both.
  const frameStep = frame === null
    ? null
    : timeline.stepExecutions.rows.find((row) => row.stepExecutionId === frame.stepExecutionId) ?? null;
  /** The system a Step Execution is working, through the Work Item that names its registration. */
  const systemOf = (workItemId: string | null): string | null =>
    workItemId === null
      ? null
      : targetName(timeline.workItems.find((item) => item.workItemId === workItemId)?.registrationId ?? null);
  const current = currentStepExecution(timeline.stepExecutions.rows);
  const workItem = agentWork?.workItemId === undefined || agentWork.workItemId === null
    ? null
    : timeline.workItems.find((item) => item.workItemId === agentWork.workItemId) ?? null;

  const chrome = liveViewChrome(run.state);
  const lifecycle = runLifecycleWord(run.state);
  const here = `/runs/${run.runId}/live`;
  // The open wait, for a Run holding on one: a pause supplies the banner's actor, its two
  // instants and the revision Resume compare-and-sets against. Read only in the state that
  // can have one, so an ordinary LIVE render costs no extra transaction.
  const waits = run.state === 'PAUSED' ? await readOpenEscalation(run.runId) : null;

  // Why there is no frame, in words. An empty stage that says nothing reads as "fine",
  // which is the one thing a supervision surface must never do.
  const stageNote = frame !== null
    ? null
    : run.state === 'QUEUED'
      ? LIVE_VIEW_QUEUED_SENTENCE
      : timeline.workspace === null
        ? LIVE_VIEW_STAGE.adapterOnly
        : isActiveRunState(run.state)
          ? LIVE_VIEW_STAGE.awaitingFirstFrame
          : LIVE_VIEW_STAGE.unavailable;

  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/runs', label: 'Runs' },
          { href: runTabHref(run.runId, ''), label: run.runId, mono: true },
          { href: here, label: 'Live' },
        ]}
      />
      <header className="ls-page-header">
        <h1>Live View · {run.procedureName}</h1>
        <p>
          <Link href={runTabHref(run.runId, '')}>Open Run Detail</Link> for the Result, the
          Evidence Quality Gate, the Execution Timeline and the Cancel control.
        </p>
        {lifecycle === null ? (
          <p>Run lifecycle: {run.state}</p>
        ) : (
          <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />
        )}
      </header>

      {/* The channel subscribes only while the Run is active (UX-DR35). A terminal Run
          gets the ended Banner instead, and nothing reconnects. */}
      {liveCursor === null ? (
        <EndedBanner runId={run.runId} state={run.state} />
      ) : (
        <LiveBanner
          url={`/api/runs/${run.runId}/events`}
          cursor={liveCursor}
          readAt={readAt.toISOString()}
          href={here}
        />
      )}

      {/* EXPERIENCE.md → Live View: Pause on LIVE, Resume replacing it on PAUSED, and the
          countdown banner naming who paused it. The SAME control Run Detail carries, so
          neither surface can disagree with the other about a stale revision. Cancel and
          Flag join it in Story 5.5. */}
      <PauseBanners run={run} pause={waits?.pause ?? null} />
      <RunPauseControls
        runId={run.runId}
        procedureName={run.procedureName}
        paused={run.state === 'PAUSED'}
        pausePending={run.pauseRequest !== null}
        awaitingAuditor={run.state === 'AWAITING_AUDITOR'}
        pausable={runPauseTransition(run.state) !== null}
        runRevision={waits?.runRevision ?? null}
      />

      <LiveViewer
        runId={run.runId}
        chrome={chrome}
        stateSentence={
          chrome === null
            ? 'This Run has not started, so there is no session to watch.'
            : `Session ${chrome}.`
        }
        workspace={
          timeline.workspace === null
            ? null
            : {
                mode: timeline.workspace.mode,
                workspaceId: timeline.workspace.workspaceId,
                status: timeline.workspace.status,
              }
        }
        stepsStarted={timeline.stepExecutions.total}
        plannedSteps={plannedStepCount(plan)}
        frame={
          frame === null
            ? null
            : {
                evidenceId: frame.evidenceId,
                narration: frameNarration(frame, frameStep, systemOf(frameStep?.workItemId ?? frame.workItemId)),
                sourceLocation: frame.sourceLocation,
                digest: frame.digest,
                capturedAt: frame.capturedAt,
              }
        }
        stageNote={stageNote}
        step={
          current === null
            ? null
            : {
                narration: stepNarration(current, systemOf(current.workItemId)),
                state: current.state,
                attempt: current.attempt,
                diagnostic: current.diagnostic,
              }
        }
        workItem={
          workItem === null
            ? null
            : {
                displayName: workItem.displayName,
                state: workItem.state,
                subjectKey: null,
                observations: workItem.observations,
              }
        }
        observations={timeline.workItems.reduce((total, item) => total + item.observations, 0)}
        evidence={evidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          digest: item.digest,
          capturedAt: item.capturedAt,
        }))}
        instructions={(plan?.inputs.instructions ?? []).map((instruction) => ({
          system: targetName(instruction.registrationId) ?? instruction.registrationId,
          text: instruction.text,
        }))}
        adapterSteps={timeline.sessionSteps
          .filter((step) => step.action === 'extract-adapter')
          .map((step) => ({
            stepId: step.stepId,
            displayName: `${planActionWord(step.action)} · ${step.displayName}`,
            state: step.state,
            attempts: step.attempts,
            digest: null,
          }))}
      />
      <p className="ls-caption">Read at {utcStamp(readAt)}.</p>
    </div>
  );
}
