import type { ProcedureVersionState, VersionDecisionRecord } from '@intellifin/domain';

import { Timestamp } from '../../design/Timestamp';
import { ActorName } from '../../runs/ActorName';
import { ProcedureStateBadge } from '../ProcedureStateBadge';
import { decisionWord } from '../version-review-words';
import {
  AUTHOR_LABEL,
  DECISION_HEADING,
  NO_SUBMISSION_RECORDED,
  SAVED_DECISION_LABEL,
  SUBMITTED_BY_LABEL,
} from './review-words';

/**
 * The decision, kept in front of the person taking it (UI cleanup 2026-09-22, UX-34).
 *
 * Approve and Reject used to sit at the bottom of a 13,887px page, so a manager scrolled
 * past everything they had just read to reach them, with nothing on screen saying which
 * version they were about to activate. This bar sticks to the top of the CONTENT column —
 * not the shell, which already owns the top bar — and carries the four facts an approval
 * is about: which version of which Procedure, who wrote it, who submitted it and when,
 * and what has been decided so far.
 *
 * There is exactly ONE set of decision controls on this surface. A second copy would give
 * a manager two Approve buttons for one version, and a guard withdrawn on one of them.
 */
export function DecisionBar({
  versionNumber,
  controlName,
  state,
  authorId,
  submission,
  latest,
  names,
  status,
  actions,
  headingId,
}: {
  readonly versionNumber: number;
  readonly controlName: string;
  readonly state: ProcedureVersionState;
  /** The person responsible for this version's definition, or `null` when unrecorded. */
  readonly authorId: string | null;
  /** The submission this decision answers, or `null` where none was recorded. */
  readonly submission: { readonly actorId: string; readonly occurredAt: string } | null;
  /** The decision already saved against this version, or `null` before any was taken. */
  readonly latest: VersionDecisionRecord | null;
  readonly names: ReadonlyMap<string, string>;
  /** What this state means and what happens next: the version's own status sentences. */
  readonly status: React.ReactNode;
  /** The decision controls. This surface mounts them here and nowhere else. */
  readonly actions: React.ReactNode;
  readonly headingId: string;
}): React.JSX.Element {
  return (
    <section className="ls-decision-bar ls-stack" aria-labelledby={headingId} data-decision-bar>
      <div className="ls-decision-bar__head">
        <h2 className="ls-decision-bar__title" id={headingId}>
          {DECISION_HEADING}
        </h2>
        <p className="ls-decision-bar__version">
          Version {versionNumber} · {controlName}
        </p>
        <ProcedureStateBadge state={state} />
      </div>
      <p className="ls-decision-bar__meta">
        {authorId === null ? null : (
          <>
            {AUTHOR_LABEL} <ActorName id={authorId} names={names} /> ·{' '}
          </>
        )}
        {submission === null ? (
          NO_SUBMISSION_RECORDED
        ) : (
          <>
            {SUBMITTED_BY_LABEL} <ActorName id={submission.actorId} names={names} /> on{' '}
            <Timestamp value={submission.occurredAt} />
          </>
        )}
      </p>
      {status}
      {latest === null ? null : (
        <p className="ls-decision-bar__saved" data-saved-decision>
          <strong>{SAVED_DECISION_LABEL}:</strong> {decisionWord(latest.decision)} ·{' '}
          <ActorName id={latest.actorId} names={names} /> · <Timestamp value={latest.occurredAt} />
        </p>
      )}
      {actions}
    </section>
  );
}
