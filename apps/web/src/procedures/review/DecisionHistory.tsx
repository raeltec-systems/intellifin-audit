import type { VersionDecisionRecord } from '@intellifin/domain';

import { Timestamp } from '../../design/Timestamp';
import { countNoun } from '../../design/words';
import { ActorName } from '../../runs/ActorName';
import { decisionWord } from '../version-review-words';
import { NO_DECISIONS_SENTENCE, REVIEW_HEADINGS } from './review-words';

/**
 * Every decision taken on this version, collapsed (UI cleanup 2026-09-22, UX-34).
 *
 * The history is provenance rather than the decision in front of the reader — the
 * decision bar carries that one — so it is a native `<details>`, which works before
 * hydration and with no JavaScript at all. The summary says how many there are, so
 * closing it hides nothing a reader needs in order to know whether to open it.
 */
export function DecisionHistory({
  decisions,
  names,
}: {
  readonly decisions: readonly VersionDecisionRecord[];
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <details className="ls-disclosure" data-decision-history>
      <summary>
        {REVIEW_HEADINGS.history} · {countNoun(decisions.length, 'decision')}
      </summary>
      <div className="ls-disclosure__body">
        {decisions.length === 0 ? (
          <p>{NO_DECISIONS_SENTENCE}</p>
        ) : (
          <ol className="ls-review-history">
            {decisions.map((decision, index) => (
              <li key={`${decision.aggregateRevision}:${index}`}>
                <p>
                  {decisionWord(decision.decision)} · <ActorName id={decision.actorId} names={names} /> ·{' '}
                  <Timestamp value={decision.occurredAt} />
                </p>
                {decision.rationale ? <p>Rationale: {decision.rationale}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
