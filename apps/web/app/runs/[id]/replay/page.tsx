import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState } from '@intellifin/domain';
import { DrizzleFrozenExecutionReader, DrizzleRunDetailRepository, REPLAY_PAGE_SIZE } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { REPLAY_COPY } from '../../../../src/design/copy';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { ReplayViewer, type ReplayFrameView } from '../../../../src/runs/ReplayViewer';
import { RunDenied, openRun, runTabHref } from '../../../../src/runs/detail';
import { planActionWord, runLifecycleWord, utcStamp } from '../../../../src/runs/labels';
import { StatusBadge } from '../../../../src/design/StatusBadge';
import { frameNarration, plannedStepCount, stepNarration } from '../../../../src/runs/live-view';
import { replayJumpTargets, replayObservationsThrough } from '../../../../src/runs/replay';

export const metadata: Metadata = { title: 'Run · Replay · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Replay (FR-30, UX-DR24, UX-DR26, addendum §F; `docs/contracts/replay-v1.md`).
 *
 * A SURFACE of its own, reached from Run Detail's rail on a terminal Run, and it
 * authorizes for itself through `openRun` exactly as Live View and each Run Detail tab do.
 *
 * **Every asset comes from PostgreSQL and object storage this platform owns**, and the
 * Workspace Provider is never reached — not on a slow path, not on a fallback, not at all.
 * That is a property of what this page imports rather than a rule it remembers: there is
 * no provider client, no workspace port and no outbound fetch anywhere on the path, and
 * `tests/e2e/replay.spec.ts` blocks every non-application origin at the network to prove
 * the surface renders whole with the provider unreachable.
 *
 * **Nothing is ever re-executed.** The rows are the ones the Run wrote while it ran, and
 * `replay.ts` — the only logic between them and the screen — takes rows and returns
 * indices.
 */
export default async function RunReplayPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  const here = `/runs/${run.runId}/replay`;
  const lifecycle = runLifecycleWord(run.state);
  const header = (
    <>
      <DetailTrail
        trail={[
          { href: '/runs', label: 'Runs' },
          { href: runTabHref(run.runId, ''), label: run.runId, mono: true },
          { href: here, label: 'Replay' },
        ]}
      />
      <header className="ls-page-header">
        <h1>Replay · {run.procedureName}</h1>
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
    </>
  );

  // A Run that is still going is WATCHED, not replayed. Rendering a Replay of a session
  // still being written would show a reader a finished session that is not finished.
  // `isActiveRunState` covers QUEUED as well as the three working states, so this is the
  // whole of "not terminal" and there is no second list to keep in step.
  if (isActiveRunState(run.state)) {
    return (
      <div className="ls-stack">
        {header}
        <Banner tone="info" title={REPLAY_COPY.notTerminal}>
          <p><Link href={`/runs/${run.runId}/live`}>Open Live View</Link></p>
        </Banner>
      </div>
    );
  }

  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  // Sized for REPLAY, not for a Run Detail page. Every one of these is joined against the
  // frames this surface renders — up to `REPLAY_FRAME_LIMIT` of them — so a fifty-row
  // default silently dropped later Tool Actions, jump targets and Observation deltas from
  // a Run that had more than fifty. See `REPLAY_PAGE_SIZE`.
  const [timeline, frames, waits, deltas, exceptions, plan] = await Promise.all([
    detail.readTimeline(run.runId, REPLAY_PAGE_SIZE),
    detail.readFrames(run.runId),
    detail.readWaits(run.runId, REPLAY_PAGE_SIZE),
    detail.readObservationDeltas(run.runId, REPLAY_PAGE_SIZE),
    detail.readExceptions(run.runId, REPLAY_PAGE_SIZE),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
  ]);

  const targetName = (registrationId: string | null): string | null =>
    registrationId === null
      ? null
      : plan?.inputs.targets.find((target) => target.registrationId === registrationId)?.displayName ?? null;
  const systemOf = (workItemId: string | null): string | null =>
    workItemId === null
      ? null
      : targetName(timeline.workItems.find((item) => item.workItemId === workItemId)?.registrationId ?? null);
  const actionsById = new Map(timeline.toolActions.rows.map((action) => [action.toolActionId, action]));

  const views: readonly ReplayFrameView[] = frames.rows.map((frame) => {
    const step = timeline.stepExecutions.rows.find((row) => row.stepExecutionId === frame.stepExecutionId) ?? null;
    const system = systemOf(step?.workItemId ?? frame.workItemId);
    // The frame's `alt` and the rail's Step narration are the SAME string (UX-DR37): a
    // reader who cannot see the picture hears exactly what the picture is captioned with.
    const narration = frameNarration(frame, step, system);
    const action = actionsById.get(frame.toolActionId) ?? null;
    return {
      evidenceId: frame.evidenceId,
      narration,
      sourceLocation: frame.sourceLocation,
      digest: frame.digest,
      capturedAt: frame.capturedAt,
      stepNarration: step === null ? narration : stepNarration(step, system),
      workItemLabel: timeline.workItems.find((item) => item.workItemId === frame.workItemId)?.displayName ?? null,
      action: action === null ? null : {
        action: action.action,
        method: action.method,
        destination: action.destination,
        outcome: action.outcome,
        status: action.status,
        denial: action.denial,
        capture: action.capture,
        captureSuppression: action.captureSuppression,
        startedAt: action.startedAt,
      },
      observations: replayObservationsThrough(deltas, frame),
    };
  });

  return (
    <div className="ls-stack">
      {header}
      <ReplayViewer
        runId={run.runId}
        stateSentence={`Session REPLAY. This Run ended: ${run.state}.`}
        workspace={
          timeline.workspace === null
            ? null
            : { mode: timeline.workspace.mode, workspaceId: timeline.workspace.workspaceId }
        }
        frames={views}
        framesTotal={frames.total}
        plannedSteps={plannedStepCount(plan)}
        stageNote={REPLAY_COPY.noFrames}
        jumpTargets={replayJumpTargets({
          frames: frames.rows,
          workItems: timeline.workItems.map((item) => ({ workItemId: item.workItemId, displayName: item.displayName })),
          exceptions: exceptions.rows.map((row) => ({
            exceptionId: row.exceptionId,
            workItemId: row.workItemId,
            populationRecordKey: row.populationRecordKey,
          })),
          waits,
        })}
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
