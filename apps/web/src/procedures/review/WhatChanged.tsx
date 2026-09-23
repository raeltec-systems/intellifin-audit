import type { TemplateId, VersionSectionDiff } from '@intellifin/domain';

import { versionChanges } from './changed-sections';
import {
  CHANGE_ARROW,
  FIRST_VERSION_SENTENCE,
  NOT_SUBMITTED_COMPARISON_SENTENCE,
  REVIEW_HEADINGS,
  comparedWithSentence,
  nothingChangedSentence,
  technicalSectionsChangedSentence,
} from './review-words';

/**
 * What somebody changed since the previous version, in words (UI cleanup 2026-09-22, UX-33).
 *
 * A FIRST version says so and lists nothing: its stored diff marks every section
 * `changed: true` because a review with no baseline must, and rendering that flag told an
 * approver that fourteen sections had been changed on a version with no predecessor.
 */
export function WhatChanged({
  diff,
  baseline,
  templateId,
  headingId,
  submitted = true,
}: {
  readonly diff: readonly VersionSectionDiff[];
  /** The version this one is compared against, or `null` for a first version. */
  readonly baseline: { readonly versionNumber: number } | null;
  readonly templateId: TemplateId;
  readonly headingId: string;
  /**
   * Whether this version has frozen a review at all. A Draft has none, so it has nothing
   * frozen to compare — which is a different statement from "this is the first version".
   */
  readonly submitted?: boolean;
}): React.JSX.Element {
  const changes = baseline === null ? null : versionChanges(diff, templateId);
  return (
    <section className="ls-card ls-stack" aria-labelledby={headingId} data-what-changed>
      <h2 className="ls-card__title" id={headingId}>
        {REVIEW_HEADINGS.changed}
      </h2>
      {!submitted ? (
        <p data-not-submitted>{NOT_SUBMITTED_COMPARISON_SENTENCE}</p>
      ) : baseline === null || changes === null ? (
        <p data-first-version>{FIRST_VERSION_SENTENCE}</p>
      ) : changes.sections.length === 0 && changes.technicalChanged === 0 ? (
        <p>{nothingChangedSentence(baseline.versionNumber)}</p>
      ) : (
        <>
          <p>{comparedWithSentence(baseline.versionNumber)}</p>
          {changes.sections.map((section) => (
            <section key={section.section} className="ls-review-change">
              <h3 className="ls-overline">{section.title}</h3>
              <dl className="ls-definition">
                {section.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>
                      <span className="ls-change__before">{fact.before}</span>{' '}
                      <span aria-hidden="true">{CHANGE_ARROW}</span>
                      <span className="ls-visually-hidden">became</span>{' '}
                      <span className="ls-change__after">{fact.after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {changes.technicalChanged === 0 ? null : (
            <p className="ls-caption">{technicalSectionsChangedSentence(changes.technicalChanged)}</p>
          )}
        </>
      )}
    </section>
  );
}
