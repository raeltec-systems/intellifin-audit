import Link from 'next/link';

import type { RunListChange, RunListRow } from '@intellifin/infrastructure';

import { Absent } from '../design/Absent';
import { DataTable } from '../design/DataTable';
import { StatusBadge } from '../design/StatusBadge';
import { NOT_COMPARABLE_SENTENCE, RUNS_EMPTY_STATE, runChangeSummary } from '../design/copy';
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
 */
export function RunsTable({
  rows,
  readAt,
}: {
  readonly rows: readonly RunListRow[];
  /** When the page was read. Every elapsed time on it is measured to this one instant. */
  readonly readAt: Date;
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
          render: (row) => <span className="ls-mono">{periodText(row.period)}</span>,
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
            return word === null ? <>{row.outcome}</> : <StatusBadge family="result-outcome" state={word} />;
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
        { key: 'initiator', header: 'Initiator', render: (row) => row.initiatorId },
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
