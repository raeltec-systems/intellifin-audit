import type { RunListRow, RunStopFacts } from '@intellifin/infrastructure';

import { DataTable } from '../design/DataTable';
import { referenceLabel } from '../design/references';
import { StatusBadge } from '../design/StatusBadge';
import { EMPTY_STATES } from '../design/copy';
import { ActorName } from '../runs/ActorName';
import { StopReasonNote } from '../runs/StopReason';
import { gateWord, resultOutcomeWord, runLifecycleWord } from '../runs/labels';
import { RECENT_RUNS_CAPTION, STARTED_BY } from './overview-words';

/**
 * Recent Runs on the Overview.
 *
 * FIVE columns, because EXPERIENCE.md fixes them: "Overview Recent Runs: Run · Procedure
 * · Lifecycle · Result outcome · Gate". The Runs register has ten; this is the same read,
 * bounded and narrowed, not a second one — `DrizzleRunListRepository.listRuns` answers
 * both, so a Run cannot appear here in one state and there in another.
 *
 * Two things the columns alone cannot say are said inside them rather than as new columns
 * the contract does not name. The reason a stopped Run stopped goes under its outcome
 * badge, exactly as it does on the register, because "Inconclusive · No conclusion issued"
 * is what the owner read as "all the runs failed". And the initiator is named under the
 * Procedure, because a Run is something a person asked for and a page that never names
 * anybody makes every Run look like something the platform did on its own.
 *
 * The empty state is the contract's, from `copy.ts`, and is rendered by `DataTable` only
 * when there are genuinely no rows — which is the one case EXPERIENCE.md wrote it for.
 */
export function RecentRuns({
  rows,
  stops,
  names,
}: {
  readonly rows: readonly RunListRow[];
  /** Why each stopped Run stopped, keyed by Run id (`DrizzleRunStopReader`). */
  readonly stops: ReadonlyMap<string, RunStopFacts>;
  /** User id to person's name (`ActorNameReader`). An id with no name is shown as the id. */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <DataTable
      caption={RECENT_RUNS_CAPTION}
      first={{
        header: 'Run',
        href: (row) => `/runs/${row.runId}`,
        // `[REPAIRED 2026-09-22, UX-02/UX-31]` The raw UUID was the row's own name. The
        // contract keeps a Run column here, and names it by its short reference; the
        // Procedure it tested is the very next cell, and the whole identifier is one click
        // away under the Run's own Technical details.
        label: (row) => referenceLabel('Run', row.runId),
      }}
      columns={[
        {
          key: 'procedure',
          header: 'Procedure',
          render: (row) => (
            <>
              {row.procedureName}
              <p className="ls-caption">
                {STARTED_BY} <ActorName id={row.initiatorId} names={names} />
              </p>
            </>
          ),
        },
        {
          key: 'lifecycle',
          header: 'Lifecycle',
          render: (row) => {
            // `StatusBadge` THROWS on a state its family does not hold, and on a
            // server-rendered list that is a 500 for every Run on the page.
            const word = runLifecycleWord(row.state);
            return word === null ? <>{row.state}</> : <StatusBadge family="run-lifecycle" state={word} />;
          },
        },
        {
          key: 'outcome',
          header: 'Result outcome',
          render: (row) => {
            const word = resultOutcomeWord(row.outcome);
            const facts = stops.get(row.runId) ?? null;
            return (
              <>
                {word === null ? <>{row.outcome}</> : <StatusBadge family="result-outcome" state={word} />}
                {facts === null ? null : <StopReasonNote facts={facts} />}
              </>
            );
          },
        },
        {
          key: 'gate',
          header: 'Gate',
          render: (row) => (
            <StatusBadge family="evidence-quality-gate" state={gateWord(row.gateChecks, row.gateFailed)} />
          ),
        },
      ]}
      rows={rows}
      rowKey={(row) => row.runId}
      empty={EMPTY_STATES.overviewNoRuns}
    />
  );
}
