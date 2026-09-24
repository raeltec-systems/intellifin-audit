import Link from 'next/link';

import type { SubmittedVersionRow } from '@intellifin/infrastructure';

import { StatusBadge } from '../design/StatusBadge';
import { Timestamp } from '../design/Timestamp';
import { ActorName } from '../runs/ActorName';
import {
  AUTHORED_BY,
  AUTHOR_UNKNOWN,
  SUBMITTED_AT_UNKNOWN,
  SUBMITTED_BY,
} from '../overview/overview-words';
import { OPEN_VERSION_REVIEW, reviewsBounded } from './review-words';

/**
 * The Procedure Versions waiting for an Audit Manager's decision
 * (UI cleanup 2026-09-22, UX-30, UX-35).
 *
 * The same read the Overview's attention list uses, rendered as the Reviews area's own
 * queue: name, version, who submitted it and when, who is accountable for what it says,
 * and one way onward. The words for the two actors come from `overview-words.ts` rather
 * than being retyped here, because both surfaces answer the same question about the same
 * row and a second spelling is a second answer.
 *
 * Ordered by submission time, oldest work first at the READ, because this is a queue
 * rather than a register. Nothing here decides whether THIS manager may approve a given
 * version — `authorizeAction`'s "cannot approve a version they authored" rule applies
 * where the decision is taken, and a list that pre-judged it would be a second copy of it.
 */
export function SubmittedVersions({
  rows,
  total,
  names,
}: {
  readonly rows: readonly SubmittedVersionRow[];
  /** The exact number waiting, which a bounded list may not reach. */
  readonly total: number;
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <div className="ls-stack">
      <ul className="ls-attention">
        {rows.map((version) => (
          <li className="ls-attention__item" key={version.versionId}>
            <p className="ls-attention__head">
              <StatusBadge family="procedure-version" state="Submitted" />
              <Link href={`/procedures/${version.procedureId}/versions/${version.versionId}`}>
                {version.controlName} · v{version.versionNumber}
              </Link>
            </p>
            <p className="ls-caption">
              {version.submittedAt === null ? (
                SUBMITTED_AT_UNKNOWN
              ) : (
                <>
                  {SUBMITTED_BY}{' '}
                  {version.submittedBy === null ? (
                    AUTHOR_UNKNOWN
                  ) : (
                    <ActorName id={version.submittedBy} names={names} />
                  )}{' '}
                  · <Timestamp value={version.submittedAt} precision="minute" />
                </>
              )}
            </p>
            <p className="ls-caption">
              {version.authorId === null ? (
                AUTHOR_UNKNOWN
              ) : (
                <>
                  {AUTHORED_BY} <ActorName id={version.authorId} names={names} />
                </>
              )}
            </p>
            <p className="ls-caption">
              <Link href={`/procedures/${version.procedureId}/versions/${version.versionId}`}>
                {OPEN_VERSION_REVIEW}
              </Link>
            </p>
          </li>
        ))}
      </ul>
      {total > rows.length ? <p role="status">{reviewsBounded(rows.length, total)}</p> : null}
    </div>
  );
}
