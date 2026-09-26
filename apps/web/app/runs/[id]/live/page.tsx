import type { Metadata } from 'next';
import Link from 'next/link';

import { isActiveRunState, isFlaggableRunState, runPauseTransition } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleFrozenExecutionReader,
  DrizzleRunDetailRepository,
  readRecordNames,
  readTimelineHead,
  readRunPauseLinkage,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { LIVE_VIEW_QUEUED_SENTENCE } from '../../../../src/design/copy';
import { PageHeader } from '../../../../src/design/PageHeader';
import { Reference } from '../../../../src/design/Reference';
import { Timestamp } from '../../../../src/design/Timestamp';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { LiveGate } from '../../../../src/runs/LiveGate';
import { RunCancelControl } from '../../../../src/runs/RunCancelControl';
import { RunFlagControl } from '../../../../src/runs/RunFlagControl';
import { RunPauseControls } from '../../../../src/runs/RunPauseControls';
import { RunControllerLease } from '../../../../src/runs/RunControllerLease';
import { SharedRunControl } from '../../../../src/runs/SharedRunControl';
import { readOpenEscalation } from '../../../../src/runs/escalation-read';
import { CancellationBanners, OpenEscalationSection, PauseBanners } from '../../../../src/runs/detail';
import { LiveViewer } from '../../../../src/runs/LiveViewer';
import { RunDenied, openRun, runTabHref } from '../../../../src/runs/detail';
import { planActionWord, runLifecycleWord, utcStamp } from '../../../../src/runs/labels';
import { StatusBadge } from '../../../../src/design/StatusBadge';
import { recordNaming, recordWords } from '../../../../src/runs/record-words';
import {
  LIVE_VIEW_STAGE,
  frameNarration,
  liveViewChrome,
  plannedStepCount,
  plannedStepIds,
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
  const [timeline, frame, current, agentWork, evidence, plan, liveCursor, flagRows] = await Promise.all([
    detail.readTimeline(run.runId),
    detail.readLatestFrame(run.runId),
    // The step the Run is on now, read on its own: the Timeline's page is the OLDEST fifty
    // Step Executions, so its newest row names a step a long Run finished long ago.
    detail.readLatestStepExecution(run.runId),
    detail.readAgentWorkPosition(run.runId),
    detail.readEvidenceItems(run.runId),
    new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId),
    isActiveRunState(run.state) ? readTimelineHead(runtime.db, run.runId) : Promise.resolve(null),
    detail.readFlags(run.runId),
  ]);
  // Session Steps retain exact Evidence ids. Resolve those ids directly; the generic
  // Evidence overview is a bounded prefix and cannot establish that an artifact is absent.
  const adapterEvidence = await detail.readEvidenceItemsByIds(run.runId,
    timeline.sessionSteps.filter(step => step.action === 'extract-adapter').flatMap(step => step.evidenceId === null ? [] : [step.evidenceId]));
  const digestByEvidence = new Map(adapterEvidence.map(item => [item.evidenceId, item.state === 'REGISTERED' ? item.digest : null]));
  // Names, not ids. A Run records its actors as user IDs because an address cannot enter
  // the audit chain; printing one at a reader is the platform speaking its own language.
  const actorNames = await new DrizzleActorNameReader(runtime.db)
    .namesFor(flagRows.map((row) => row.flaggedBy));

  const targetName = (registrationId: string | null): string | null =>
    registrationId === null
      ? null
      : plan?.inputs.targets.find((target) => target.registrationId === registrationId)?.displayName ?? null;

  // The Step the frame belongs to, so the frame's alt text and the rail's narration are
  // the SAME sentence (UX-DR37). It is read by id when it is not on the Timeline's bounded
  // page; a frame whose Step Execution cannot be read at all narrates from the action
  // instead, which is why `frameNarration` takes both.
  const frameStep = frame === null
    ? null
    : timeline.stepExecutions.rows.find((row) => row.stepExecutionId === frame.stepExecutionId)
      ?? await detail.readStepExecution(run.runId, frame.stepExecutionId);
  /** The system a Step Execution is working, through the Work Item that names its registration. */
  const systemOf = (workItemId: string | null): string | null =>
    workItemId === null
      ? null
      : targetName(timeline.workItems.find((item) => item.workItemId === workItemId)?.registrationId ?? null);
  /**
   * The RECORD a Step Execution is working, so the narration a screen reader hears can
   * tell two Work Items of the same Run apart. `displayName` cannot: it is the Target
   * System's name and is identical on every Work Item.
   */
  const subjectKeyOf = (workItemId: string | null): string | null =>
    workItemId === null
      ? null
      : timeline.workItems.find((item) => item.workItemId === workItemId)?.subjectKey ?? null;
  const workItem = agentWork?.workItemId === undefined || agentWork.workItemId === null
    ? null
    : timeline.workItems.find((item) => item.workItemId === agentWork.workItemId) ?? null;
  // UX-25: a record is named the way the record review names it — the key, then the
  // person's name — and masked wherever the version's frozen binding says so (FR-41).
  const naming = recordNaming(plan);
  const subjectKeys = [
    subjectKeyOf(frameStep?.workItemId ?? frame?.workItemId ?? null),
    subjectKeyOf(current?.workItemId ?? null),
    workItem?.subjectKey ?? null,
  ].filter((key): key is string => key !== null);
  const recordNames = plan === null ? new Map<string, string>() : await readRecordNames(runtime.db, run.runId, plan, subjectKeys);
  const subjectLabel = (key: string | null): string | null =>
    key === null ? null : recordWords({ key, name: recordNames.get(key) ?? null }, naming);
  const subjectOf = (workItemId: string | null): string | null => subjectLabel(subjectKeyOf(workItemId));

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

  const pauseLinkage = waits?.pause == null ? null : (await readRunPauseLinkage(runtime.db, run.runId)).rows.find(entry => entry.kind === 'pause' && entry.waitId === waits.pause!.waitId) ?? null;

  // The Paused banner names the person who paused the Run, not their user id.
  const pauseNames = await new DrizzleActorNameReader(runtime.db).namesFor([
    ...(waits?.pause?.openedBy == null ? [] : [waits.pause.openedBy]),
    ...(run.pauseRequest === null ? [] : [run.pauseRequest.requestedBy]),
    ...(run.cancellation === null ? [] : [run.cancellation.requestedBy]),
  ]);

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

  // The Step counter's numerator: LOGICAL plan steps, never `run_step_execution`'s row
  // count. A pause supersedes the attempt in flight and the resume starts a new one, so
  // the total counted attempts and the chrome read "Step 7 of 6" (UX-47). Counted over
  // EVERY row in the database rather than over the bounded page above, so a long Run is
  // not under-reported either; `logicalStepProgress` in `live-view.ts` is the same rule
  // over rows in hand, and the integration test holds the two to one answer.
  const progress = await detail.readLogicalStepProgress(run.runId, plannedStepIds(plan));

  // ONE header row: the title, the lifecycle badge beside it, the four session controls on
  // its right and one meta line. The walkthrough met the title, the status, the banner, a
  // full-width control stack, a workspace id, a warning and a row of hashes each on their
  // own row before the screen (UX-48).
  const header = (
    <PageHeader
      title={<>Live View · {run.procedureName}</>}
      badge={lifecycle === null ? <span>{run.state}</span> : <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />}
      actions={
        <>
          {/* The controller panel is NOT in this row: it sits at the top of the rail and
              shares its one read with this control through `SharedRunControl`. */}
          <RunPauseControls
            runId={run.runId}
            procedureName={run.procedureName}
            paused={run.state === 'PAUSED'}
            pausePending={run.pauseRequest !== null}
            awaitingAuditor={run.state === 'AWAITING_AUDITOR'}
            pausable={runPauseTransition(run.state) !== null}
            runRevision={waits?.runRevision ?? null}
            controlRefreshKey={readAt.toISOString()}
            showController={false}
          />
          <RunCancelControl
            runId={run.runId}
            procedureName={run.procedureName}
            active={isActiveRunState(run.state)}
            cancelPending={run.cancellation !== null}
          />
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
        </>
      }
      meta={
        <>
          <Link href={runTabHref(run.runId, '')}>Open Run Detail</Link> ·{' '}
          <Reference kind="Run" value={run.runId} /> · started <Timestamp value={run.initiatedAt} precision="minute" />
        </>
      }
    />
  );

  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/runs', label: 'Runs' },
          // The Procedure, as Run Detail's own trail names it; the Run's identifier is under
          // Technical details and its short reference is on the meta line (UX-02).
          { href: runTabHref(run.runId, ''), label: run.procedureName },
          { href: here, label: 'Live' },
        ]}
      />

      {/* ONE subscription for the surface, and the gate over every control under it
          (Story 5.7). The channel subscribes only while the Run is active (UX-DR35); a
          terminal Run gets the ended Banner instead, nothing reconnects, and the gate is
          closed from the first render.

          EXPERIENCE.md → session viewer: "Live controls: Pause / Resume, Cancel, Flag to
          Audit Manager". Each is the SAME component Run Detail mounts, and each asks the
          gate whether it may act — which is open everywhere else. */}
      <SharedRunControl>
      <LiveGate
        runId={run.runId}
        state={run.state}
        url={`/api/runs/${run.runId}/events`}
        cursor={liveCursor}
        readAt={readAt.toISOString()}
        href={here}
        header={header}
      >
        {/* AT THE TOP, and the workspace screen stays below it rather than behind it
            (EXPERIENCE.md → Live View / Awaiting Auditor: "Escalation panel focused;
            workspace screen still visible"). It is not a dialog: a modal over the session
            viewer would answer the question by hiding the thing the question is about.
            Focus is NOT moved here — the skip link moves it and the panel announces itself
            politely, which is what UX-DR27 asks for; taking focus from somebody mid-word
            is a context change nobody asked for. */}
        <OpenEscalationSection run={run} escalation={waits} readAt={readAt} />
        <PauseBanners linkage={pauseLinkage} run={run} pause={waits?.pause ?? null} readAt={readAt} names={pauseNames} />
        {/* The server's own statement of a requested cancellation, as on Run Detail: the
            control's transitional "Cancellation requested." is dropped once the page has
            re-read the Run (UX-49), so this is what says it from then on. */}
        <CancellationBanners run={run} names={pauseNames} />

        <LiveViewer
          runId={run.runId}
          runState={run.state}
          controller={run.state === 'PAUSED' || run.state === 'AWAITING_AUDITOR' || runPauseTransition(run.state) !== null
            ? <RunControllerLease runId={run.runId} refreshKey={readAt.toISOString()} />
            : null}
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
                  reference: timeline.workspace.reference,
                  status: timeline.workspace.status,
                }
          }
          stepsStarted={progress.started}
          plannedSteps={plannedStepCount(plan)}
          retries={progress.retries}
          frame={
            frame === null
              ? null
              : {
                  evidenceId: frame.evidenceId,
                  narration: frameNarration(frame, frameStep,
                    systemOf(frameStep?.workItemId ?? frame.workItemId),
                    subjectOf(frameStep?.workItemId ?? frame.workItemId)),
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
                  narration: stepNarration(current, systemOf(current.workItemId), subjectOf(current.workItemId)),
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
                  // The record, which the rail renders in front of the system name. It was
                  // hard-coded `null` here, so Watch said "LoanCore · RUNNING · 1
                  // Observations" whichever leaver the Agent was inspecting.
                  subjectKey: subjectLabel(workItem.subjectKey),
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
              evidenceId: step.evidenceId,
              digest: step.evidenceId === null ? null : digestByEvidence.get(step.evidenceId) ?? null,
            }))}
        />
      </LiveGate>
      </SharedRunControl>
    </div>
  );
}
