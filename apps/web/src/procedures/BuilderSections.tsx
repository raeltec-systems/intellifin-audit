import { isDraftSectionHeading, type DraftSectionHeading } from '@intellifin/domain';
import type { ProcedureVersionView } from '@intellifin/application';

import {
  BUILDER_CONTROL_NAME_EDITABLE_SENTENCE,
  BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE,
} from '../design/copy';
import { SECTION_WORDS, isTemplateOnly } from '../design/plain-words';
import { BuilderStep } from './BuilderStep';
import { builderProgress, sectionSummary } from './section-summary';

/**
 * The Builder, as a short list of questions instead of nine open forms.
 *
 * It used to render every section expanded at once, each headed by the name the domain
 * uses for what it freezes — "Population Source binding", "Compliance Rule conditions" —
 * and each repeating the read-only sentence. An auditor arriving to set up one control
 * met nine simultaneous forms in a vocabulary they had no reason to know. The owner's
 * words for it were exact: "i cant understand a single word of whats happening here and
 * what im expected to do".
 *
 * So the two sections the Template writes are read ONCE at the top, as reference, and
 * everything else becomes a numbered step that states what is currently set and opens
 * only if it still needs an answer. The headings are still the domain's — they are the
 * stored payload's own key set, validated on read — and {@link SECTION_WORDS} is the one
 * place they become the question they answer.
 *
 * A step is a native `<details>`: it opens before hydration and with a keyboard, and a
 * closed step still says what is inside it, so closing is never hiding.
 */
export function BuilderSections({
  draft,
  sections,
  periodScope,
  populationSource,
  targetSystems,
  auditInstructions,
  complianceRule,
  evidenceRequirements,
  schedule,
}: {
  readonly draft: ProcedureVersionView;
  readonly sections: readonly { readonly heading: string; readonly content: string | null }[];
  readonly periodScope?: React.ReactNode;
  readonly populationSource?: React.ReactNode;
  readonly targetSystems?: React.ReactNode;
  readonly auditInstructions?: React.ReactNode;
  readonly complianceRule?: React.ReactNode;
  readonly evidenceRequirements?: React.ReactNode;
  readonly schedule?: React.ReactNode;
}): React.JSX.Element {
  const editors: Readonly<Record<string, React.ReactNode>> = {
    'Period and scope': periodScope,
    'Population Source binding': populationSource,
    'Target System selection': targetSystems,
    'Audit Instructions': auditInstructions,
    'Compliance Rule conditions': complianceRule,
    'Evidence Requirements': evidenceRequirements,
    Schedule: schedule,
  };
  const reference = sections.filter((section) => isTemplateOnly(section.heading));
  const steps = sections.filter((section) => !isTemplateOnly(section.heading));
  // `isDraftSectionHeading` is the guard, not a cast: the payload is validated on read,
  // but a section whose heading this build does not know still has to render as itself
  // rather than crash the page or borrow another section's words.
  const known = steps.filter((section): section is { heading: DraftSectionHeading; content: string | null } =>
    isDraftSectionHeading(section.heading),
  );
  const progress = builderProgress(
    known.map((section) => section.heading),
    draft,
  );
  return (
    <div className="ls-stack">
      <section className="ls-card ls-stack" aria-labelledby="builder-template">
        <h2 className="ls-card__title" id="builder-template">
          What this procedure tests
        </h2>
        {reference.map((section) => {
          // `Object.hasOwn` is not needed — the list is filtered by `isTemplateOnly`,
          // which is itself a membership test — but the words are read through a typed
          // record, so a heading added to the Template-only pair without a word here
          // fails to compile.
          const words = isDraftSectionHeading(section.heading)
            ? SECTION_WORDS[section.heading]
            : { title: section.heading, question: '' };
          return (
            <div className="ls-template-fact" key={section.heading}>
              <h3 className="ls-template-fact__title">{words.title}</h3>
              {section.content === null ? (
                // A Template that says nothing for a section says so in words. A blank
                // panel reads as a rendering failure, or as "fine".
                <p className="ls-caption">The Template does not state this.</p>
              ) : (
                <p className="ls-whitespace">{section.content}</p>
              )}
              {/*
                Scoped to the Control section, and never `aria-hidden`: it is the only
                sentence naming where the Control name is edited, and hiding it from
                assistive technology would tell a screen-reader user the opposite of
                what the page tells everyone else.
              */}
              {section.heading === 'Control' ? (
                <p className="ls-caption">{BUILDER_CONTROL_NAME_EDITABLE_SENTENCE}</p>
              ) : null}
            </div>
          );
        })}
        <p className="ls-caption">{BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE}</p>
      </section>

      <section className="ls-card ls-stack" aria-labelledby="builder-steps">
        <h2 className="ls-card__title" id="builder-steps">
          Set this up
        </h2>
        <p className="ls-caption" data-builder-progress>
          {progress.done} of {progress.total} answered. Open a step to change it; a step
          you have not answered is open already.
        </p>
        <ol className="ls-steps">
          {known.map((section, index) => {
            const summary = sectionSummary(section.heading, draft);
            const words = SECTION_WORDS[section.heading];
            const editor = Object.hasOwn(editors, section.heading)
              ? editors[section.heading]
              : undefined;
            return (
              <li key={section.heading}>
                <BuilderStep
                  number={index + 1}
                  heading={section.heading}
                  title={words.title}
                  question={words.question}
                  line={summary.line}
                  state={summary.state}
                  initiallyOpen={summary.state === 'todo'}
                >
                  {editor === undefined ? (
                    section.content === null ? (
                      <p className="ls-caption">The Template does not state this.</p>
                    ) : (
                      <>
                        <p className="ls-whitespace">{section.content}</p>
                        <p className="ls-caption">{BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE}</p>
                      </>
                    )
                  ) : (
                    editor
                  )}
                </BuilderStep>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
