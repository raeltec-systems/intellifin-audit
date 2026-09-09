import { Fragment } from 'react';
import type {
  RunStepExecutionRow,
  RunTimelineRead,
  RunTimelineSessionStep,
  RunTimelineToolAction,
  RunTimelineWorkItem,
} from '@intellifin/infrastructure';

import { ADAPTER_ACTIONS_UNRECORDED } from '../design/copy';
import { StatusBadge } from '../design/StatusBadge';
import {
  captureSentence,
  countText,
  durationText,
  planActionWord,
  sessionStepWord,
  stepExecutionWord,
  toolActionOutcomeWord,
  utcStamp,
  workItemWord,
  workspaceModeWord,
} from './labels';

/**
 * The Execution Timeline (DESIGN.md → Execution Timeline row; EXPERIENCE.md → Execution
 * Timeline).
 *
 * "Four-column grid; rows nest by 20px per level — Session Step › Work Item › Step
 * Execution › Tool Action. Each row shows a step marker, status icon, name and detail, a
 * sanitized call box in `{typography.mono}`, and a right column with status word and
 * duration." "Collapsed to Work Item rows by default, except that Escalations, retries,
 * errors, limits consumed, and version stamps stay expanded inline."
 *
 * **What nests under what, in an adapter Run.** `makePlan` emits one `extract-adapter`
 * Session Step per Target System; the stage writes a `run_session_step` row for a
 * `versioned-file` Reference Source and a `run_work_item` row for an `api` one, both keyed
 * by the same frozen plan step. So an adapter Work Item IS the execution of its Session
 * Step and there is no separate row above it — the two Session Step kinds and the Work
 * Items are all plan-step-level units here, and the Step Executions nest beneath whichever
 * of them started them. The renderer takes a `level`, so Epic 4's agent Runs (where one
 * Session Step really does contain several Work Items) and the fourth Tool Action level
 * nest at 20px without a rewrite.
 *
 * The expansion is a `<details>`, so it works with no JavaScript at all and is reachable
 * by keyboard — which a click handler on a row would not be. It is `open` when any Step
 * Execution beneath it failed: "errors stay expanded".
 */
export function ExecutionTimeline({
  timeline,
  runId,
}: {
  readonly timeline: RunTimelineRead;
  readonly runId: string;
}): React.JSX.Element {
  const byWorkItem = new Map<string, RunStepExecutionRow[]>();
  const byPlanStep = new Map<string, RunStepExecutionRow[]>();
  for (const execution of timeline.stepExecutions.rows) {
    if (execution.workItemId === null) {
      byPlanStep.set(execution.planStepId, [...(byPlanStep.get(execution.planStepId) ?? []), execution]);
    } else {
      byWorkItem.set(execution.workItemId, [...(byWorkItem.get(execution.workItemId) ?? []), execution]);
    }
  }
  // The fourth level. `run_tool_action` is ONE table and one shape for both surfaces, so an
  // agent's Tool Action and an adapter's Adapter Action render identically and `surface` is
  // the only thing that distinguishes them — AD-6 says so in as many words. The adapter path
  // writes none of these rows yet, which is a named gap and not a rendering decision.
  const byStepExecution = new Map<string, RunTimelineToolAction[]>();
  for (const action of timeline.toolActions.rows) {
    byStepExecution.set(action.stepExecutionId, [
      ...(byStepExecution.get(action.stepExecutionId) ?? []),
      action,
    ]);
  }
  return (
    <ol className="ls-timeline">
      {timeline.workspace === null ? null : (
        <>
          <TimelineRow
            level={0}
            marker="Session Step"
            name="Create the Agent Workspace"
            detail={`${workspaceModeWord(timeline.workspace.mode)} · ${countText(timeline.workspace.attempts)} attempts`}
            call={timeline.workspace.stepId}
            status={timeline.workspace.status}
            duration={null}
            startedAt={timeline.workspace.startedAt}
            diagnostic={timeline.workspace.diagnostic}
          />
          <StepExecutions
            executions={byPlanStep.get(timeline.workspace.stepId) ?? []}
            level={1}
            actions={byStepExecution}
          />
        </>
      )}
      {timeline.population === null ? null : (
        <TimelineRow
          level={0}
          marker="Session Step"
          name="Acquire the population"
          detail={`${countText(timeline.population.attempts)} attempts`}
          call={timeline.population.stepId}
          status={timeline.population.status}
          duration={null}
          startedAt={timeline.population.startedAt}
          diagnostic={timeline.population.diagnostic}
        />
      )}
      {timeline.sessionSteps.map((step) => (
        <SessionStepRow
          key={step.stepId}
          step={step}
          executions={byPlanStep.get(step.stepId) ?? []}
          actions={byStepExecution}
        />
      ))}
      {timeline.workItems.map((item) => (
        <WorkItemRow
          key={item.workItemId}
          item={item}
          runId={runId}
          executions={byWorkItem.get(item.workItemId) ?? []}
          actions={byStepExecution}
        />
      ))}
    </ol>
  );
}

function SessionStepRow({
  step,
  executions,
  actions,
}: {
  readonly step: RunTimelineSessionStep;
  readonly executions: readonly RunStepExecutionRow[];
  readonly actions: ReadonlyMap<string, readonly RunTimelineToolAction[]>;
}): React.JSX.Element {
  return (
    <>
      <TimelineRow
        level={0}
        marker="Session Step"
        // The row said "Reference Source" for every Session Step, which stopped being true
        // the moment Story 4.2 wrote the first `sign-in` one. A label that states something
        // untrue is worse than one that states nothing, so the ACTION the plan froze is read
        // rather than assumed.
        name={step.displayName}
        detail={`${planActionWord(step.action)} · ${countText(step.attempts)} attempts`}
        call={step.stepId}
        status={sessionStepWord(step.state)}
        duration={null}
        startedAt={null}
        diagnostic={step.diagnostic}
      />
      <StepExecutions executions={executions} level={1} actions={actions} />
    </>
  );
}

function WorkItemRow({
  item,
  runId,
  executions,
  actions,
}: {
  readonly item: RunTimelineWorkItem;
  readonly runId: string;
  readonly executions: readonly RunStepExecutionRow[];
  readonly actions: ReadonlyMap<string, readonly RunTimelineToolAction[]>;
}): React.JSX.Element {
  const word = workItemWord(item.state);
  return (
    <>
      <li
        className="ls-timeline__row"
        id={`work-item-${item.workItemId}`}
        style={{ '--ls-timeline-level': 0 } as React.CSSProperties}
      >
        <span className="ls-timeline__marker">Work Item</span>
        <span className="ls-timeline__name">
          <span className="ls-timeline__title">{item.displayName}</span>
          <span className="ls-timeline__detail">
            {countText(item.observations)} Observations · {countText(item.attempts)} attempts ·{' '}
            {countText(item.cycles)} cycles
            {item.diagnostic === null ? null : (
              <>
                {' '}
                · <code className="ls-mono">{item.diagnostic}</code>
              </>
            )}
          </span>
        </span>
        <span className="ls-timeline__call ls-mono">{item.stepId}</span>
        <span className="ls-timeline__status">
          {word === null ? item.state : <StatusBadge family="work-item" state={word} />}
        </span>
      </li>
      <StepExecutions
        executions={executions}
        level={1}
        anchor={`${runId}-${item.workItemId}`}
        actions={actions}
      />
    </>
  );
}

/**
 * Step Executions, collapsed by default and expanded when one of them failed.
 *
 * The `<details>` is inside an `<li>` so the list stays a list; a `<details>` as a direct
 * child of `<ol>` is invalid HTML and an axe finding.
 */
function StepExecutions({
  executions,
  level,
  anchor,
  actions,
}: {
  readonly executions: readonly RunStepExecutionRow[];
  readonly level: number;
  readonly anchor?: string;
  readonly actions: ReadonlyMap<string, readonly RunTimelineToolAction[]>;
}): React.JSX.Element | null {
  if (executions.length === 0) return null;
  const failed = executions.some((execution) => execution.state === 'FAILED');
  return (
    <li
      className="ls-timeline__nest"
      style={{ '--ls-timeline-level': level } as React.CSSProperties}
      key={anchor}
    >
      <details className="ls-expand" open={failed}>
        <summary>
          {countText(executions.length)} Step Executions
          {failed ? ' · one or more failed' : ''}
        </summary>
        <ol className="ls-timeline">
          {executions.map((execution) => (
            <Fragment key={execution.stepExecutionId}>
              <TimelineRow
                level={0}
                marker="Step Execution"
                name={planActionWord(execution.action)}
                detail={`attempt ${countText(execution.attempt)}`}
                call={execution.planStepId}
                status={stepExecutionWord(execution.state)}
                duration={
                  execution.completedAt === null
                    ? null
                    : durationText(
                        new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime(),
                      )
                }
                startedAt={execution.startedAt}
                diagnostic={execution.diagnostic}
              />
              {(actions.get(execution.stepExecutionId) ?? []).map((action) => (
                <ToolActionRow key={action.toolActionId} action={action} />
              ))}
              {/*
                An ADAPTER Step Execution has no `run_tool_action` rows, because the adapter
                path writes none yet — so it would render with nothing beneath it, and an
                empty fourth level reads as "no actions were taken". That is false: the
                adapter resolved a credential, fetched a collection and froze the response.
                Said in words, like `Never probed` and `Not evaluated` before it.

                An AGENT Step Execution with no rows really did take no Tool Action, so it
                says nothing.
              */}
              {execution.action === 'extract-adapter' &&
              (actions.get(execution.stepExecutionId) ?? []).length === 0 ? (
                <li
                  className="ls-timeline__note"
                  style={{ '--ls-timeline-level': 1 } as React.CSSProperties}
                >
                  {ADAPTER_ACTIONS_UNRECORDED}
                </li>
              ) : null}
            </Fragment>
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * One Tool Action — the Timeline's fourth level (Story 4.3).
 *
 * The action is HERE whatever became of it, and the row says whether the platform captured
 * anything from it. That is the whole point: capture is suppressed while a credential is
 * on the wire, and a suppression that showed as a blank would be a gap a reader takes for
 * nothing having occurred — the sign-out defect's shape, an absent signal that looks like
 * success.
 *
 * The destination is scheme, authority and path — sanitized, capped, and credential-
 * redacted before it was ever stored — so it is rendered as the identifier it is, exactly
 * as every other `call` cell and every diagnostic on this Timeline is. It is deliberately
 * NOT wrapped in `UntrustedText`: that block is DESIGN.md's treatment for retrieved FREE
 * TEXT that could resemble an instruction, and a warning-bordered panel around a URL on
 * every row would drown the warnings that mean something.
 */
function ToolActionRow({ action }: { readonly action: RunTimelineToolAction }): React.JSX.Element {
  const detail = [
    `${action.method} · ${toolActionOutcomeWord(action.outcome)}`,
    action.status === null ? null : `status ${String(action.status)}`,
    action.redirected ? 'redirected' : null,
    action.downloads > 0 ? `${countText(action.downloads)} downloads offered` : null,
    captureSentence(action.capture, action.captureSuppression),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <li className="ls-timeline__row" style={{ '--ls-timeline-level': 1 } as React.CSSProperties}>
      <span className="ls-timeline__marker">Tool Action</span>
      <span className="ls-timeline__name">
        <span className="ls-timeline__title">{action.action}</span>
        <span className="ls-timeline__detail">
          {detail} · {utcStamp(action.startedAt)}
          {action.denial === null ? null : (
            <>
              {' '}
              · <code className="ls-mono">{action.denial}</code>
            </>
          )}
        </span>
      </span>
      <span className="ls-timeline__call ls-mono">{action.destination}</span>
      <span className="ls-timeline__status">{toolActionOutcomeWord(action.outcome)}</span>
    </li>
  );
}

/**
 * One row of the four-column grid.
 *
 * The status word is always written; a duration is shown when one was recorded. A
 * diagnostic is a closed platform constant, rendered as the identifier it is.
 */
function TimelineRow({
  level,
  marker,
  name,
  detail,
  call,
  status,
  duration,
  startedAt,
  diagnostic,
}: {
  readonly level: number;
  readonly marker: string;
  readonly name: string;
  readonly detail: string;
  readonly call: string;
  readonly status: string;
  readonly duration: string | null;
  readonly startedAt: string | null;
  readonly diagnostic: string | null;
}): React.JSX.Element {
  return (
    <li className="ls-timeline__row" style={{ '--ls-timeline-level': level } as React.CSSProperties}>
      <span className="ls-timeline__marker">{marker}</span>
      <span className="ls-timeline__name">
        <span className="ls-timeline__title">{name}</span>
        <span className="ls-timeline__detail">
          {detail}
          {startedAt === null ? null : <> · {utcStamp(startedAt)}</>}
          {diagnostic === null ? null : (
            <>
              {' '}
              · <code className="ls-mono">{diagnostic}</code>
            </>
          )}
        </span>
      </span>
      <span className="ls-timeline__call ls-mono">{call}</span>
      <span className="ls-timeline__status">
        {status}
        {duration === null ? null : <span className="ls-mono"> · {duration}</span>}
      </span>
    </li>
  );
}
