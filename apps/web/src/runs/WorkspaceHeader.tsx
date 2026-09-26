import Link from 'next/link';

import type { RunRecord } from '@intellifin/domain';

import { PageHeader } from '../design/PageHeader';
import { StatusBadge } from '../design/StatusBadge';
import { Timestamp } from '../design/Timestamp';
import { readablePeriod } from '../design/time';
import { runLifecycleWord } from './labels';
import { LiveGateNote } from './LiveGateNote';
import {
  NO_STEP_STARTED_SENTENCE,
  RECORD_COVERAGE_UNAVAILABLE,
  currentStepWords,
  recordCoverageLine,
  type WorkspaceCoverageCounts,
} from './workspace-words';

export type WorkspaceHeaderRun = Pick<
  RunRecord,
  'procedureId' | 'procedureName' | 'versionId' | 'versionNumber' | 'period' | 'initiatedAt' | 'state'
>;

/**
 * The Auditor Workspace's title row (UI cleanup 2026-09-23, UX-23 and UX-02).
 *
 * The same `PageHeader` shape as Run Detail's frame: the title and the Run's state on one
 * row, then ONE caption line of facts. The workspace used to print its own `<header>` with
 * `2026-08-01 to 2026-08-31` and the state as a lowercased code (`awaiting auditor`). The
 * state is now the lifecycle badge, the period is `readablePeriod`, and the start is a
 * `<Timestamp>` whose exact ISO instant is in its `dateTime` attribute. Two short rows,
 * because the conversation and the workspace panes below need the height.
 *
 * A state outside the vocabulary is still written in words: `StatusBadge` throws on an
 * unknown state, and on this page that would be a 500 for the whole workspace.
 */
export function WorkspaceHeader({ run }: { readonly run: WorkspaceHeaderRun }): React.JSX.Element {
  const lifecycle = runLifecycleWord(run.state);
  return (
    <PageHeader
      title={<>Auditor Workspace · {run.procedureName}</>}
      badge={lifecycle === null
        ? <span>Run lifecycle: {run.state}</span>
        : <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />}
      meta={
        <>
          <Link href={`/procedures/${run.procedureId}`}>{run.procedureName}</Link> ·{' '}
          <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>v{run.versionNumber}</Link> ·{' '}
          Period {readablePeriod(run.period)} · Started <Timestamp value={run.initiatedAt} precision="minute" />
        </>
      }
    >
      {/* Why the workspace's controls are withdrawn while the stream says they are, as on
          Live View (Story 10.8 screenshot review). Nothing renders while they may be used. */}
      <LiveGateNote />
    </PageHeader>
  );
}

export interface WorkspaceCurrentStep {
  readonly action: string;
  readonly subject: string | null;
  readonly target: string | null;
  readonly startedAt: string;
}

/**
 * Record coverage and the newest step, in words (UX-02, UX-31).
 *
 * Every count goes through `countNoun` and every instant is a `<Timestamp>`: the line used
 * to read `1 of 1 included records inspected` and `Read at 2026-09-21T12:24:45.656Z`. The
 * step line keeps its bounded, keyboard-reachable region, because a record key is source
 * data of any length and must not grow the status chrome over the panes.
 */
export function WorkspaceProgress({ counts, readAt, current }: {
  /** `null` when the record coverage read is not ready. */
  readonly counts: WorkspaceCoverageCounts | null;
  readonly readAt: Date | string;
  readonly current: WorkspaceCurrentStep | null;
}): React.JSX.Element {
  return (
    <div role="group" aria-label="Run progress">
      <p>{counts === null ? RECORD_COVERAGE_UNAVAILABLE : recordCoverageLine(counts)}</p>
      <div className="ls-caption run-workspace-current-action" role="region" aria-label="Current action and freshness" tabIndex={0}>
        Read at <Timestamp value={readAt} />.{' '}
        {current === null
          ? NO_STEP_STARTED_SENTENCE
          : <>{currentStepWords(current)}, started <Timestamp value={current.startedAt} />.</>}
      </div>
    </div>
  );
}
