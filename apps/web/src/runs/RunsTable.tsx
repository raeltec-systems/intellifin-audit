import Link from 'next/link';

import type { RunListChange, RunListRow, RunStopFacts } from '@intellifin/infrastructure';

import { Absent } from '../design/Absent';
import { DataTable } from '../design/DataTable';
import { StatusBadge } from '../design/StatusBadge';
import { NOT_COMPARABLE_SENTENCE, RUNS_EMPTY_STATE, runChangeSummary } from '../design/copy';
import { ActorName } from './ActorName';
import { StopReasonNote } from './StopReason';
import {
  elapsedText,
  gateWord,
  periodText,
  resultOutcomeWord,
  runLifecycleWord,
} from './labels';

/**
 * The Runs table — EXPERIENCE.md's ten columns, in its order.
 *
 * Run · Procedure · Effective period · Lifecycle · Result outcome · Gate · Review ·
 * Initiator · Elapsed · Change. The Run cell is the row header AND the row's only link;
 * `DataTable` has no `onRowClick` prop and there must never be one, so a row cannot
 * become a click target a keyboard never reaches.
 *
 * Every badge here is derived from a stored value through a guarded lookup. A value
 * outside a family's vocabulary is WRITTEN IN WORDS rather than guessed into a badge:
 * `StatusBadge` throws on an unknown state, and on a server-rendered list that is a 500
 * for every Run on the page rather than one odd cell.
 *
 * Two things the owner could not read off this table (2026-09-15) are on it now. A Run
 * that stopped before its Gate says WHY under its outcome badge, in words, from the stage
 * checkpoint that ended it — a page of "Inconclusive · No conclusion issued" read as "all
 * the runs failed" with the reason (a stale snapshot) only on the Timeline tab as a code
 * word. And the Initiator is a person's name: a user id is what the row holds, because an
 * address cannot enter the chain, and printing it here was the platform speaking its own
 * language on the one column that names who is accountable.
 */
export function RunsTable({
  rows,
  readAt,
  stops,
  names,
}: {
  readonly rows: readonly RunListRow[];
  /** When the page was read. Every elapsed time on it is measured to this one instant. */
  readonly readAt: Date;
  /** Why each stopped Run stopped, keyed by Run id (`DrizzleRunStopReader`). */
  readonly stops: ReadonlyMap<string, RunStopFacts>;
  /** User id to person's name (`ActorNameReader`). An id with no name is shown as the id. */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <DataTable
      caption="Runs, newest first, with their lifecycle, Result outcome, Evidence Quality Gate, and change since the previous Run."
      first={{
        header: 'Run',
        href: (row) => `/runs/${row.runId}`,
        label: (row) => row.runId,
        mono: true,
      }}
      columns={[
        { key: 'procedure', header: 'Procedure', render: (row) => row.procedureName },
        {
          key: 'period',
          header: 'Effective period',
          // One line: `2026-08-01 → 2026-08-31` broken after the arrow reads as two dates.
          render: (row) => <span className="ls-mono ls-nowrap">{periodText(row.period)}</span>,
        },
        {
          key: 'lifecycle',
          header: 'Lifecycle',
          render: (row) => {
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
        {
          key: 'review',
          header: 'Review',
          /*
            The Auditor Review family — Draft, Submitted, Approved, Finalized. Epic 3
            creates no review at all and Story 6.3 is what submits one, so every row shows
            the contract's absent marker. Rendering "Draft" for a review nobody started
            would state a fact that is not true — Story 2.1's "Active version: Draft"
            defect in a new column.
          */
          render: () => <Absent what="No Auditor Review has started." />,
        },
        {
          key: 'initiator',
          header: 'Initiator',
          render: (row) => <ActorName id={row.initiatorId} names={names} />,
        },
        {
          key: 'elapsed',
          header: 'Elapsed',
          numeric: true,
          render: (row) => elapsedText(row.initiatedAt, row.endedAt, readAt),
        },
        { key: 'change', header: 'Change', render: (row) => <ChangeCell change={row.change} /> },
      ]}
      rows={rows}
      rowKey={(row) => row.runId}
      empty={RUNS_EMPTY_STATE}
    />
  );
}

/**
 * The Change cell.
 *
 * Story 3.7 gives every Exception an HMAC fingerprint over five keys with the Run
 * deliberately absent, so the same finding recurring in a later Run is recognisable as
 * the same finding. That is the whole basis of this column; where the comparison cannot
 * be made it SAYS so rather than showing a zero.
 */
function ChangeCell({ change }: { readonly change: RunListChange }): React.JSX.Element {
  if (change.kind === 'absent') return <Absent what="No comparable previous Run." />;
  if (change.kind === 'incomparable') return <>{NOT_COMPARABLE_SENTENCE}</>;
  return <>{runChangeSummary(change.added, change.resolved)}</>;
}

/**
 * The cold-load skeleton (EXPERIENCE.md → "Any / Cold load": skeleton rows matching the
 * layout, no counts shown until loaded).
 *
 * The rows are decorative and hidden from assistive technology; the live region beside
 * them says what is happening in words. No `aria-label` on a generic element — a
 * prohibited name is silently dropped, and axe reports that as incomplete rather than as
 * a violation, so `Digest.test.ts` is what catches it.
 */
export function RunsTableSkeleton({ rows = 6 }: { readonly rows?: number }): React.JSX.Element {
  return (
    <div className="ls-skeleton" role="status">
      <p className="ls-visually-hidden">Loading Runs.</p>
      <div className="ls-skeleton__rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="ls-skeleton__row" key={index} />
        ))}
      </div>
    </div>
  );
}

/**
 * Pagination, never infinite scroll (EXPERIENCE.md → Interaction Primitives).
 *
 * Plain links, so the keyboard and a browser with no JavaScript reach both of them.
 */
export function RunsPagination({
  next,
  firstHref,
  onFirstPage,
}: {
  readonly next: string | null;
  readonly firstHref: string;
  readonly onFirstPage: boolean;
}): React.JSX.Element | null {
  if (next === null && onFirstPage) return null;
  return (
    <nav className="ls-pagination" aria-label="Runs pages">
      {onFirstPage ? null : <Link href={firstHref}>Newest Runs</Link>}
      {next === null ? null : <Link href={`${firstHref}?after=${next}`}>Older Runs</Link>}
    </nav>
  );
}
