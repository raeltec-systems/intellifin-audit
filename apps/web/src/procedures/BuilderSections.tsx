import { BUILDER_SECTION_NOT_EDITABLE_SENTENCE } from '../design/copy';

/**
 * The Builder's sections, in EXPERIENCE.md's order (UX-DR8, scoped to this story).
 *
 * Every section renders its pre-filled content READ-ONLY under the pinned sentence
 * saying it is not editable yet: stories 2.2-2.5 make the sections editable in turn,
 * and a pre-filled value that reads as an editable field is a promise this release
 * does not keep. The headings are the domain's `DRAFT_SECTION_HEADINGS`, so the Builder
 * cannot show a section the payload does not carry, nor hide one it does.
 *
 * This is a server component on purpose: there is nothing to interact with here, and
 * the sentence is a contract sentence imported from `copy.ts`, not retyped.
 */
export function BuilderSections({
  sections,
}: {
  readonly sections: readonly { readonly heading: string; readonly content: string | null }[];
}): React.JSX.Element {
  return (
    <div className="ls-stack">
      {sections.map((section) => (
        <section key={section.heading} className="ls-card">
          <h2 className="ls-card__title">{section.heading}</h2>
          {section.content === null ? (
            // §C gives some Templates nothing for a section. An empty section says so in
            // words — a blank panel reads as a rendering failure or as "fine".
            <p className="ls-caption">The Template states nothing for this section.</p>
          ) : (
            <p className="ls-whitespace">{section.content}</p>
          )}
          <p className="ls-caption" aria-hidden="true">
            {BUILDER_SECTION_NOT_EDITABLE_SENTENCE}
          </p>
        </section>
      ))}
    </div>
  );
}
