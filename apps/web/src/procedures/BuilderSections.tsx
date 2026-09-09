import {
  BUILDER_CONTROL_NAME_EDITABLE_SENTENCE,
  BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE,
} from '../design/copy';

/**
 * The Builder's sections, in EXPERIENCE.md's order (UX-DR8).
 *
 * Seven sections carry an editor. The two that do not — Control and Objective — render
 * their pre-filled content read-only under the pinned sentence saying so, and the
 * Control section additionally names where its editable half lives. The headings are
 * the domain's `DRAFT_SECTION_HEADINGS`, so the Builder cannot show a section the
 * payload does not carry, nor hide one it does.
 *
 * This is a server component on purpose: there is nothing to interact with here, and
 * both sentences are contract sentences imported from `copy.ts`, not retyped.
 */
export function BuilderSections({
  sections,
  periodScope,
  populationSource,
  targetSystems,
  auditInstructions,
  complianceRule,
  evidenceRequirements,
  schedule,
}: {
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
  return (
    <div className="ls-stack">
      {sections.map((section) => {
        // `Object.hasOwn`, not a plain index: the heading is domain data, and a lookup
        // keyed by it follows the standing guard rule.
        const editor = Object.hasOwn(editors, section.heading) ? editors[section.heading] : undefined;
        return (
        <section key={section.heading} className="ls-card">
          <h2 className="ls-card__title">{section.heading}</h2>
          {editor ? editor : <>
          {section.content === null ? (
            // §C gives some Templates nothing for a section. An empty section says so in
            // words — a blank panel reads as a rendering failure or as "fine".
            <p className="ls-caption">The Template states nothing for this section.</p>
          ) : (
            <p className="ls-whitespace">{section.content}</p>
          )}
          {/*
            Not `aria-hidden`. This sentence is the only thing that says the section is
            read-only, so hiding it from assistive technology tells a screen-reader user
            the opposite of what the page tells everyone else: they meet a section of
            content with no indication that it cannot be edited. The repetition across
            sections is the cost of saying it where it applies.
          */}
          <p className="ls-caption">{BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE}</p>
          {section.heading === 'Control' ? (
            <p className="ls-caption">{BUILDER_CONTROL_NAME_EDITABLE_SENTENCE}</p>
          ) : null}
          </>}
        </section>
        );
      })}
    </div>
  );
}
