import {
  READINESS_NOTHING_FOUND,
  READINESS_NO_GUARANTEE,
  procedureReadiness,
  type PreparationSectionId,
  type ProcedureReadinessInputs,
} from '@intellifin/domain';

import { Banner } from '../design/Banner';
import { goToSection, readinessLine } from './readiness-words';

/**
 * Readiness before paid execution, as advice.
 *
 * A Run costs a browser session, a model and a person's attention. This panel answers
 * "what would make this Run produce nothing useful?" from the Draft's own authoring
 * inputs, BEFORE anybody spends any of that. It never blocks a save and is never a
 * submission blocker: the items are a list to read, not a gate to pass.
 *
 * The vocabulary comes from `procedureReadiness` in the domain, so the Builder and the
 * version review page cannot disagree about WHICH findings exist. What each one SAYS on
 * this surface comes from `readiness-words.ts` (UI cleanup 2026-09-22, UX-15): the
 * domain's sentence names a section by its stored heading ("Population Source binding"),
 * which is not a title anywhere the auditor is reading, so every line here names the
 * section by the Builder's own title and — where a step can be opened — links to it.
 * {@link READINESS_NO_GUARANTEE} is rendered whether or not anything is listed — an
 * empty list must never read as a promise, and readiness has read the Draft, not a
 * Target System.
 */
export function ReadinessPanel({
  inputs,
  headingId,
  headingLevel = 2,
  stepHref,
}: {
  readonly inputs: ProcedureReadinessInputs;
  readonly headingId: string;
  /** 2 on the Builder, where it is a top-level section; 3 inside the agent summary. */
  readonly headingLevel?: 2 | 3;
  /**
   * Where the step that resolves a finding is, on a page that has one — the Builder's
   * outline anchors. Absent on a surface with no editor, where the section is named and
   * nothing is linked: a link to a step the page does not have would go nowhere.
   */
  readonly stepHref?: (step: PreparationSectionId) => string;
}): React.JSX.Element {
  const items = procedureReadiness(inputs).map(readinessLine);
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
          {items.map((line, index) => (
            <li key={`${line.code}:${index}`} data-readiness-item={line.code} data-readiness-step={line.step}>
              <Banner tone="warning" title={line.sentence}>
                {stepHref === undefined ? null : (
                  <p>
                    <a href={stepHref(line.step)} data-readiness-link={line.step}>{goToSection(line.sectionTitle)}</a>
                  </p>
                )}
              </Banner>
            </li>
          ))}
        </ul>
      )}
      <p className="ls-caption">{READINESS_NO_GUARANTEE}</p>
    </section>
  );
}
