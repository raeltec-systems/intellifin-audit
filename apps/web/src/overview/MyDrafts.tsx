import Link from 'next/link';

import type { ProcedureListRow } from '@intellifin/infrastructure';

import { EmptyState } from '../design/EmptyState';
import { Timestamp } from '../design/Timestamp';
import { ProcedureStateBadge } from '../procedures/ProcedureStateBadge';
import { templateLabel } from '../procedures/labels';
import {
  ALL_PROCEDURES_LINK,
  MY_DRAFTS_EMPTY,
  MY_DRAFTS_HEADING,
  MY_DRAFTS_SENTENCE,
  overviewBounded,
} from './overview-words';

/**
 * The Auditor's drafts, first on their Overview (UI cleanup 2026-09-22, role landing).
 *
 * EXPERIENCE.md's role-landing decision leads an Auditor's Overview with "an Auditor's
 * drafts, tests needing attention and assessments to confirm", in that order. A draft is
 * work they started and can finish, and it is the one thing a landing page can show them
 * that nobody else needs to see — so it is the first section rather than something to be
 * found by scrolling past the whole deployment's stopped Runs.
 *
 * Each row names the Control and the Template and says when it was last touched, which is
 * how a person recognises the one they were in the middle of. The exact total beside it
 * comes from the read, never from `rows.length` of a bounded list.
 */
export function MyDrafts({
  rows,
  total,
}: {
  readonly rows: readonly ProcedureListRow[];
  /** Every Draft this person is accountable for, counted, not only the ones shown. */
  readonly total: number;
}): React.JSX.Element {
  return (
    <section aria-labelledby="my-drafts-heading" className="ls-stack">
      <h2 id="my-drafts-heading">{MY_DRAFTS_HEADING}</h2>
      <p>{MY_DRAFTS_SENTENCE}</p>
      {total === 0 ? (
        <EmptyState
          icon="file-text"
          {...MY_DRAFTS_EMPTY}
          link={{ href: '/procedures', label: ALL_PROCEDURES_LINK }}
        />
      ) : (
        <>
          <ul className="ls-attention">
            {rows.map((row) => (
              <li className="ls-attention__item" key={row.procedureId}>
                <p className="ls-attention__head">
                  {row.latestVersionState === null ? null : (
                    <ProcedureStateBadge state={row.latestVersionState} />
                  )}
                  <Link href={`/procedures/${row.procedureId}`}>
                    {row.controlName}
                    {row.latestVersionNumber === null ? '' : ` · v${row.latestVersionNumber}`}
                  </Link>
                </p>
                <p className="ls-caption">
                  {templateLabel(row.templateId)} · Last changed{' '}
                  <Timestamp value={row.updatedAt} precision="minute" />
                </p>
              </li>
            ))}
          </ul>
          {total > rows.length ? <p role="status">{overviewBounded(rows.length, total)}</p> : null}
          <p>
            <Link href="/procedures">{ALL_PROCEDURES_LINK}</Link>
          </p>
        </>
      )}
    </section>
  );
}
