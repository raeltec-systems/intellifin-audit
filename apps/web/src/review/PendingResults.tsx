import Link from 'next/link';

import type { PendingResultRow } from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { StatusBadge } from '../design/StatusBadge';
import { Timestamp } from '../design/Timestamp';
import { pendingAssessmentSentence } from '../design/status-words';
import { readablePeriod } from '../design/time';
import { ActorName } from '../runs/ActorName';
import { OPEN_RESULT, STARTED_BY, TEST_FINISHED, reviewsBounded } from './review-words';

/**
 * The finished tests whose assessments are waiting for a person
 * (UI cleanup 2026-09-22, UX-01 and UX-35 — one list, two surfaces).
 *
 * The Overview's attention list and the Reviews area's Results tab ask the same question
 * of the same read, so they render the same component: two copies would agree on every
 * case anybody tried and disagree on the first one nobody did, and here the disagreement
 * would be two surfaces reporting different amounts of outstanding audit work.
 *
 * Each row leads with the PROCEDURE, because that is what a person recognises, and carries
 * the short Run reference beside it; the full identifier is on the Run itself, under
 * Technical details. What it asks for is `pendingAssessmentSentence`'s exact count, which
 * is the same number the Run's own Result tab shows — both come from the effective
 * confirmation over the review ledger, never from the machine rows alone.
 */
export function PendingResults({
  rows,
  total,
  names,
}: {
  readonly rows: readonly PendingResultRow[];
  /** The exact number waiting, which a bounded list may not reach. */
  readonly total: number;
  /** User id to person's name (`ActorNameReader`). An id with no name is shown as the id. */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <div className="ls-stack">
      <ul className="ls-attention">
        {rows.map((row) => (
          <li className="ls-attention__item" key={row.runId}>
            <p className="ls-attention__head">
              <StatusBadge family="result-outcome" state="Pending Confirmation" />
              <Link href={`/runs/${row.runId}/result`}>
                {row.procedureName} · v{row.versionNumber}
              </Link>
              <Reference kind="Run" value={row.runId} />
            </p>
            <p>{pendingAssessmentSentence(row.pendingEvaluations)}</p>
            <p className="ls-caption">
              {readablePeriod(row.period)} · {TEST_FINISHED}{' '}
              <Timestamp value={row.resultAt} precision="minute" /> · {STARTED_BY}{' '}
              <ActorName id={row.initiatorId} names={names} />
            </p>
            <p className="ls-caption">
              <Link href={`/runs/${row.runId}/result`}>{OPEN_RESULT}</Link>
            </p>
          </li>
        ))}
      </ul>
      {total > rows.length ? <p role="status">{reviewsBounded(rows.length, total)}</p> : null}
    </div>
  );
}
