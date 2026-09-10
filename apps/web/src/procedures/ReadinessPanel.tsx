import {
  READINESS_NOTHING_FOUND,
  READINESS_NO_GUARANTEE,
  procedureReadiness,
  type ProcedureReadinessInputs,
} from '@intellifin/domain';

import { Banner } from '../design/Banner';

/**
 * Readiness before paid execution, as advice.
 *
 * A Run costs a browser session, a model and a person's attention. This panel answers
 * "what would make this Run produce nothing useful?" from the Draft's own authoring
 * inputs, BEFORE anybody spends any of that. It never blocks a save and is never a
 * submission blocker: the items are a list to read, not a gate to pass.
 *
 * The vocabulary and every sentence come from `procedureReadiness` in the domain, so the
 * Builder and the version review page cannot describe one finding in two sets of words.
 * {@link READINESS_NO_GUARANTEE} is rendered whether or not anything is listed — an
 * empty list must never read as a promise, and readiness has read the Draft, not a
 * Target System.
 */
export function ReadinessPanel({
  inputs,
  headingId,
  headingLevel = 2,
}: {
  readonly inputs: ProcedureReadinessInputs;
  readonly headingId: string;
  /** 2 on the Builder, where it is a top-level section; 3 inside the agent summary. */
  readonly headingLevel?: 2 | 3;
}): React.JSX.Element {
  const items = procedureReadiness(inputs);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="ls-card ls-stack" aria-labelledby={headingId} data-readiness>
      <Heading className="ls-card__title" id={headingId}>
        Before you run this
      </Heading>
      {items.length === 0 ? (
        <p data-readiness-empty>{READINESS_NOTHING_FOUND}</p>
      ) : (
        <ul className="ls-stack">
          {items.map((item) => (
            <li key={`${item.code}:${item.subject ?? ''}`} data-readiness-item={item.code}>
              <Banner tone="warning" title={item.sentence} />
            </li>
          ))}
        </ul>
      )}
      <p className="ls-caption">{READINESS_NO_GUARANTEE}</p>
    </section>
  );
}
