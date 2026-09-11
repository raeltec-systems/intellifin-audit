import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState, isFlaggableRunState, runPauseTransition } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleFrozenExecutionReader,
  DrizzleRunDetailRepository,
  readTimelineHead,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { LIVE_VIEW_QUEUED_SENTENCE } from '../../../../src/design/copy';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { LiveGate } from '../../../../src/runs/LiveGate';
import { RunCancelControl } from '../../../../src/runs/RunCancelControl';
import { RunFlagControl } from '../../../../src/runs/RunFlagControl';
import { RunPauseControls } from '../../../../src/runs/RunPauseControls';
import { readOpenEscalation } from '../../../../src/runs/escalation-read';
import { OpenEscalationSection, PauseBanners } from '../../../../src/runs/detail';
import { LiveViewer } from '../../../../src/runs/LiveViewer';
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
 * Story 5.3 shipped it READ-ONLY; 5.4 added Pause and Resume and 5.5 adds Cancel and Flag
 * to Audit Manager, which is EXPERIENCE.md's full session-viewer control set. Each is the
 * same component Run Detail mounts, so the two surfaces cannot disagree about a stale
 * revision, a blocked retry or a pending request.
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
  const [timeline, frame, agentWork, evidence, plan, liveCursor, flagRows] = await Promise.all([
    detail.readTimeline(run.runId),
    detail.readLatestFrame(run.runId),
    detail.readAgentWorkPosition(run.runId),
    detail.readEvidenceItems(run.runId),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    isActiveRunState(run.state) ? readTimelineHead(runtime.db, run.runId) : Promise.resolve(null),
    detail.readFlags(run.runId),
  ]);
  // Names, not ids. A Run records its actors as user IDs because an address cannot enter
  // the audit chain; printing one at a reader is the platform speaking its own language.
  const actorNames = await new DrizzleActorNameReader(runtime.db)
    .namesFor(flagRows.map((row) => row.flaggedBy));

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
  // The open wait, for a Run holding on one, and ONE read for both kinds: an Escalation
  // holds the Run in `AWAITING_AUDITOR` and a pause holds it in `PAUSED`, and the same read
  // answers which — supplying the panel's wait and, for a pause, the revision Resume
  // compare-and-sets against. Read only in the two states that can have one, so an ordinary
  // LIVE render costs no extra transaction. Exactly what `RunDetailFrame` does.
  const waits = run.state === 'AWAITING_AUDITOR' || run.state === 'PAUSED'
    ? await readOpenEscalation(run.runId)
    : null;

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
          Evidence Quality Gate and the Execution Timeline.
        </p>
        {lifecycle === null ? (
          <p>Run lifecycle: {run.state}</p>
        ) : (
          <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />
        )}
      </header>

      {/* ONE subscription for the surface, and the gate over every control under it
          (Story 5.7). The channel subscribes only while the Run is active (UX-DR35); a
          terminal Run gets the ended Banner instead, nothing reconnects, and the gate is
          closed from the first render.

          EXPERIENCE.md → session viewer: "Live controls: Pause / Resume, Cancel, Flag to
          Audit Manager". Each is the SAME component Run Detail mounts, and each asks the
          gate whether it may act — which is open everywhere else. */}
      <LiveGate
        runId={run.runId}
        state={run.state}
        url={`/api/runs/${run.runId}/events`}
        cursor={liveCursor}
        readAt={readAt.toISOString()}
        href={here}
      >
        {/* AT THE TOP, and the workspace screen stays below it rather than behind it
            (EXPERIENCE.md → Live View / Awaiting Auditor: "Escalation panel focused;
            workspace screen still visible"). It is not a dialog: a modal over the session
            viewer would answer the question by hiding the thing the question is about.
            Focus is NOT moved here — the skip link moves it and the panel announces itself
            politely, which is what UX-DR27 asks for; taking focus from somebody mid-word
            is a context change nobody asked for. */}
        <OpenEscalationSection run={run} escalation={waits} readAt={readAt} />
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
        <RunCancelControl
          runId={run.runId}
          procedureName={run.procedureName}
          active={isActiveRunState(run.state)}
          cancelPending={run.cancellation !== null}
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
        {/* Flag sits AFTER the viewer: it is the one control here that is not about stopping
            or holding the Run, and it carries the record of the flags already raised. */}
        <RunFlagControl
          runId={run.runId}
          flaggable={isFlaggableRunState(run.state)}
          flags={flagRows.map((row) => ({
            flagId: row.flagId,
            flaggedBy: actorNames.get(row.flaggedBy) ?? row.flaggedBy,
            flaggedAt: row.flaggedAt,
            note: row.note,
          }))}
        />
      </LiveGate>
      <p className="ls-caption">Read at {utcStamp(readAt)}.</p>
    </div>
  );
}
