import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState } from '@intellifin/domain';
import { DrizzleFrozenExecutionReader, DrizzleRunDetailRepository, REPLAY_INSPECTION_PAGE_SIZE, REPLAY_PAGE_SIZE, readRecordNames } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { REPLAY_COPY } from '../../../../src/design/copy';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { ReplayViewer, type ReplayFrameView } from '../../../../src/runs/ReplayViewer';
import { PageHeader } from '../../../../src/design/PageHeader';
import { Reference } from '../../../../src/design/Reference';
import { Timestamp } from '../../../../src/design/Timestamp';
import { RunDenied, openRun, runTabHref } from '../../../../src/runs/detail';
import { planActionWord, runLifecycleWord, workItemLabel } from '../../../../src/runs/labels';
import { StatusBadge } from '../../../../src/design/StatusBadge';
import { frameNarration, plannedStepCount, stepNarration } from '../../../../src/runs/live-view';
import { effectiveFrameWorkItemId, replayInitialSelection, replayJumpTargets, replayObservationsThrough, replayRequest, replayViewerKey, resolveFrameWorkItems } from '../../../../src/runs/replay';
import { recordNaming, recordWords } from '../../../../src/runs/record-words';

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
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ readonly workItem?: string | string[]; readonly cursor?: string | string[] }>;
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
          // The Procedure, as Run Detail's own trail names it; the Run's identifier is under
          // Technical details and its short reference is on the meta line (UX-02).
          { href: runTabHref(run.runId, ''), label: run.procedureName },
          { href: here, label: 'Replay' },
        ]}
      />
      {/* ONE header row: the title, the lifecycle badge beside it and one meta line, so
          the session's first frame is inside the first viewport (UI cleanup, UX-29). */}
      <PageHeader
        title={<>Replay · {run.procedureName}</>}
        badge={lifecycle === null ? <span>{run.state}</span> : <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />}
        meta={
          <>
            <Link href={runTabHref(run.runId, '')}>Open Run Detail</Link> ·{' '}
            <Reference kind="Run" value={run.runId} /> · started{' '}
            <Timestamp value={run.initiatedAt} precision="minute" />
          </>
        }
      />
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
  const request = replayRequest(await searchParams, REPLAY_INSPECTION_PAGE_SIZE);
  if (request.kind !== 'prefix') {
    const [selected, plan] = await Promise.all([
      request.kind === 'inspection'
        ? detail.readInspectionReplay(run.runId, request.workItemId, request.cursor)
        : Promise.resolve({ kind: 'unavailable' } as const),
      new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    ]);
    const owner = selected.kind === 'inspection' ? selected.workItem : null;
    const system = owner === null ? null : plan?.inputs.targets
      .find(target => target.registrationId === owner.registrationId)?.displayName ?? null;
    // The record as the queue, the inspector and the Exception name it (UX-25): the key,
    // then the permitted name, each masked where the frozen binding says so.
    const naming = recordNaming(plan);
    const names = plan === null || owner === null || owner.subjectKey === null
      ? new Map<string, string>()
      : await readRecordNames(runtime.db, run.runId, plan, [owner.subjectKey]);
    const subject = owner?.subjectKey == null ? null : recordWords({ key: owner.subjectKey, name: names.get(owner.subjectKey) ?? null }, naming);
    const label = owner === null ? null : workItemLabel({ ...owner, subjectKey: subject, displayName: system ?? owner.displayName });
    const views: readonly ReplayFrameView[] = selected.kind === 'unavailable' ? [] : selected.rows.map(row => {
      const narration = frameNarration(row.frame, row.step, system, subject);
      return {
        evidenceId: row.frame.evidenceId, narration, stepNarration: narration, workItemLabel: label,
        workItemId: owner?.workItemId ?? null, subjectKey: subject,
        sourceLocation: row.frame.sourceLocation, digest: row.frame.digest, capturedAt: row.frame.capturedAt,
        action: { action: row.action.action, method: row.action.method, destination: row.action.destination,
          outcome: row.action.outcome, status: row.action.status, denial: row.action.denial,
          capture: row.action.capture, captureSuppression: row.action.captureSuppression, startedAt: row.action.startedAt },
        observations: row.observations, globalOrdinal: row.globalOrdinal,
      };
    });
    return (
      <div className="ls-stack">
        {header}
        {/* Keyed by the REQUEST, never by the read: see `replayViewerKey`. */}
        <ReplayViewer
          key={replayViewerKey(run.runId, request)}
          runId={run.runId}
          runState={run.state}
          stateSentence={`Session REPLAY. This Run ended: ${run.state}.`}
          workspace={selected.kind === 'inspection' ? selected.workspace : null}
          frames={views}
          framesTotal={selected.kind === 'inspection' ? selected.framesTotal : 0}
          plannedSteps={plannedStepCount(plan)}
          stageNote={null}
          jumpTargets={[]}
          initialSelection={selected.kind === 'unavailable'
            ? { kind: 'unavailable', frameIndex: null }
            : { kind: 'inspection', frameIndex: views.length === 0 ? null : 0,
                target: { kind: 'work-item', id: selected.workItem.workItemId, label: label!,
                  ...(views.length === 0 ? { frameIndex: null, absence: 'none-captured' } as const
                    : { frameIndex: 0, absence: null } as const) } }}
          window={selected.kind === 'unavailable' ? { kind: 'unavailable' }
            : { kind: 'inspection', workItemId: selected.workItem.workItemId, label: label!,
                total: selected.total, cursor: selected.cursor,
                previousCursor: selected.previousCursor, nextCursor: selected.nextCursor }}
          instructions={(plan?.inputs.instructions ?? []).map(instruction => ({
            system: plan?.inputs.targets.find(target => target.registrationId === instruction.registrationId)?.displayName ?? instruction.registrationId,
            text: instruction.text,
          }))}
          adapterSteps={[]}
        />
        <p className="ls-caption">Read at <Timestamp value={readAt} precision="minute" />.</p>
      </div>
    );
  }
  // Sized for REPLAY, not for a Run Detail page. Every one of these is joined against the
  // frames this surface renders — up to `REPLAY_FRAME_LIMIT` of them — so a fifty-row
  // default silently dropped later Tool Actions, jump targets and Observation deltas from
  // a Run that had more than fifty. See `REPLAY_PAGE_SIZE`.
  const [timeline, frames, waits, deltas, exceptions, plan, evidence] = await Promise.all([
    detail.readTimeline(run.runId, REPLAY_PAGE_SIZE),
    detail.readFrames(run.runId),
    detail.readWaits(run.runId, REPLAY_PAGE_SIZE),
    detail.readObservationDeltas(run.runId, REPLAY_PAGE_SIZE),
    detail.readExceptions(run.runId, REPLAY_PAGE_SIZE),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    // The adapter log rows below promise "its integrity digest", and printed `null` for
    // every one: "No artifact registered." over artifacts that ARE registered. The Evidence
    // read this surface already has carries the digest per Evidence id.
    detail.readEvidenceItems(run.runId),
  ]);
  const digestByEvidence = new Map(evidence.map((item) => [item.evidenceId, item.digest]));
  // ONE record label with the queue, the inspector and the Exception (UX-25). Every place
  // below that names a record — a pill, the rail, the frame's narration — says this.
  const naming = recordNaming(plan);
  const names = plan === null ? new Map<string, string>() : await readRecordNames(runtime.db, run.runId, plan, [
    ...timeline.workItems.flatMap((item) => (item.subjectKey === null ? [] : [item.subjectKey])),
    ...exceptions.rows.map((row) => row.populationRecordKey),
  ]);
  const subjectLabel = (key: string | null): string | null =>
    key === null ? null : recordWords({ key, name: names.get(key) ?? null }, naming);

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
    // The Step-first owner, the same rule the stored selected-inspection read uses.
    const workItemId = effectiveFrameWorkItemId(frame, step);
    const system = systemOf(workItemId);
    // The record, so the frame's `alt` and each scrubber pill's label can tell two Work
    // Items of the same Run apart. `system` is identical on both.
    const subject = subjectLabel(timeline.workItems
      .find((item) => item.workItemId === workItemId)?.subjectKey ?? null);
    // The frame's `alt` and the rail's Step narration are the SAME string (UX-DR37): a
    // reader who cannot see the picture hears exactly what the picture is captioned with.
    const narration = frameNarration(frame, step, system, subject);
    const action = actionsById.get(frame.toolActionId) ?? null;
    return {
      evidenceId: frame.evidenceId,
      narration,
      workItemId,
      subjectKey: subject,
      sourceLocation: frame.sourceLocation,
      digest: frame.digest,
      capturedAt: frame.capturedAt,
      stepNarration: step === null ? narration : stepNarration(step, system, subject),
      // Resolved the SAME way the system name two lines up is: `run_tool_action.work_item_id`
      // is nullable, so a frame whose Work Item is known only through its Step Execution
      // reported no Work Item at all while the narration beside it named the system.
      workItemLabel: (() => {
        const owner = timeline.workItems.find((item) => item.workItemId === workItemId);
        return owner === undefined ? null : workItemLabel({ ...owner, subjectKey: subjectLabel(owner.subjectKey) });
      })(),
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

  const targets = replayJumpTargets({
    frames: resolveFrameWorkItems(frames.rows, timeline.stepExecutions.rows),
    framesTotal: frames.total,
    workItems: timeline.workItems.map((item) => ({ workItemId: item.workItemId, displayName: item.displayName, subjectKey: subjectLabel(item.subjectKey) })),
    exceptions: exceptions.rows.map((row) => ({
      exceptionId: row.exceptionId,
      workItemId: row.workItemId,
      populationRecordKey: subjectLabel(row.populationRecordKey) ?? row.populationRecordKey,
    })),
    waits,
  });
  const initialSelection = replayInitialSelection(undefined, targets, views.length);

  return (
    <div className="ls-stack">
      {header}
      <ReplayViewer
        key={replayViewerKey(run.runId, request)}
        runId={run.runId}
        runState={run.state}
        stateSentence={`Session REPLAY. This Run ended: ${run.state}.`}
        workspace={
          timeline.workspace === null
            ? null
            : { mode: timeline.workspace.mode, reference: timeline.workspace.reference }
        }
        frames={views}
        framesTotal={frames.total}
        plannedSteps={plannedStepCount(plan)}
        stageNote={REPLAY_COPY.noFrames}
        jumpTargets={targets}
        initialSelection={initialSelection}
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
            digest: step.evidenceId === null ? null : (digestByEvidence.get(step.evidenceId) ?? null),
          }))}
      />
      <p className="ls-caption">Read at <Timestamp value={readAt} precision="minute" />.</p>
    </div>
  );
}
