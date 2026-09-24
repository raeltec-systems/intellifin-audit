import Link from 'next/link';

import type { RunListChange, RunListRow, RunStopFacts } from '@intellifin/infrastructure';

import { Absent } from '../design/Absent';
import { DataTable } from '../design/DataTable';
import { Reference } from '../design/Reference';
import { StatusBadge } from '../design/StatusBadge';
import { Timestamp } from '../design/Timestamp';
import { readablePeriod } from '../design/time';
import { NOT_COMPARABLE_SENTENCE, RUNS_EMPTY_STATE, runChangeSummary } from '../design/copy';
import { ActorName } from './ActorName';
import { StopReasonNote } from './StopReason';
import { elapsedText, gateWord, resultOutcomeWord, runLifecycleWord } from './labels';
import { ELAPSED, RUNS_CAPTION, RUNS_COLUMNS, STARTED_BY, STILL_RUNNING } from './runs-list-words';

/**
 * The Runs table — EXPERIENCE.md's revised six columns, in its order
 * (UI cleanup 2026-09-22, UX-17).
 *
 * `Run` (the Procedure name, with the short reference and the effective period beneath it)
 * · `Execution` · `Assessment` · `Evidence checks` · `Started` (by whom, when, and elapsed)
 * · `Change`. The Run cell is the row header AND the row's only link; `DataTable` has no
 * `onRowClick` prop and there must never be one, so a row cannot become a click target a
 * keyboard never reaches.
 *
 * `[REPAIRED 2026-09-22]` It was TEN columns, and the first was a raw UUID rendered as the
 * row's own name — thirty-six characters a reader cannot compare by eye, in the one cell
 * that should say what the Run was about. At a laptop's width the table scrolled the WHOLE
 * PAGE sideways, which is the one thing EXPERIENCE.md's own responsive rules forbid. Four
 * columns went: Procedure and Effective period moved INTO the Run cell, which is where a
 * person looks for them; Initiator and Elapsed moved into `Started`, because who started a
 * Run and how long it took are facts about one event; and `Review` is gone until a Result
 * can be sent for review, which the caption says out loud.
 *
 * `Lifecycle`, `Result outcome` and `Gate` are now `Execution`, `Assessment` and `Evidence
 * checks` — `STATUS_COLUMN_WORDS`, the three questions a Run's status answers. The badge
 * WORDS are DESIGN.md's and do not move; what changed is that the header now says which of
 * the three questions its column is answering, so a passed Evidence Quality Gate can never
 * be read as a passed control.
 *
 * Every badge here is derived from a stored value through a guarded lookup. A value outside
 * a family's vocabulary is WRITTEN IN WORDS rather than guessed into a badge: `StatusBadge`
 * throws on an unknown state, and on a server-rendered list that is a 500 for every Run on
 * the page rather than one odd cell.
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
      caption={RUNS_CAPTION}
      first={{
        header: RUNS_COLUMNS.run,
        href: (row) => `/runs/${row.runId}`,
        // The NAME a person recognises; the short reference and the period sit under it.
        label: (row) => row.procedureName,
        detail: (row) => (
          <span className="ls-run-cell__detail">
            <Reference kind="Run" value={row.runId} /> · v{row.versionNumber} ·{' '}
            {readablePeriod(row.period)}
          </span>
        ),
      }}
      columns={[
        {
          key: 'execution',
          header: RUNS_COLUMNS.execution,
          render: (row) => {
            const word = runLifecycleWord(row.state);
            return word === null ? <>{row.state}</> : <StatusBadge family="run-lifecycle" state={word} />;
          },
        },
        {
          key: 'assessment',
          header: RUNS_COLUMNS.assessment,
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
          key: 'evidence-checks',
          header: RUNS_COLUMNS.evidenceChecks,
          render: (row) => (
            <StatusBadge family="evidence-quality-gate" state={gateWord(row.gateChecks, row.gateFailed)} />
          ),
        },
        {
          key: 'started',
          header: RUNS_COLUMNS.started,
          // Who, when, and how long — one event, one cell. The instant is readable and
          // carries the exact ISO value in its `datetime` attribute.
          render: (row) => (
            <>
              <Timestamp value={row.initiatedAt} precision="minute" />
              <span className="ls-caption ls-run-cell__detail">
                {STARTED_BY} <ActorName id={row.initiatorId} names={names} /> · {ELAPSED}{' '}
                {elapsedText(row.initiatedAt, row.endedAt, readAt)}
                {row.endedAt === null ? ` ${STILL_RUNNING}` : ''}
              </span>
            </>
          ),
        },
        { key: 'change', header: RUNS_COLUMNS.change, render: (row) => <ChangeCell change={row.change} /> },
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
