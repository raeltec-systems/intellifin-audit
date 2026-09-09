import Link from 'next/link';

import type { ProcedureVersionView } from '@intellifin/application';
import { procedureVersionRowVersion } from '@intellifin/application';

import { NewVersionButton } from './NewVersionButton';

/**
 * What editing this version means, said where the version is read.
 *
 * A Draft is edited in place. Every other state is FROZEN — generation 14 refuses a
 * frozen-field update to an Approved, Active or Retired row — so "edit an Active
 * version" is really "start a new Draft from it", and the Active version goes on
 * running its Schedule until the successor activates. That is a surprising rule to meet
 * for the first time in a confirmation dialog, and before this panel the version review
 * page offered no way to act on it at all: the only "New version" control in the product
 * was a bare button in the Procedure Detail version list, with nothing saying what it
 * did.
 *
 * One component, used by both surfaces, so the two cannot describe the same rule in two
 * sets of words.
 */
const EDIT_RULE: Readonly<Record<ProcedureVersionView['state'], string>> = {
  DRAFT:
    'This version is a Draft. Open the Builder to edit any section; nothing is frozen until it is submitted, and editing it never changes the Template it came from.',
  SUBMITTED:
    'This version is submitted and frozen while it awaits a decision. An approver can reject it, which returns it to Draft for editing.',
  APPROVED:
    'This version is approved and frozen. It cannot be edited, and a new version cannot start from it until it is Active.',
  ACTIVE:
    'This version is Active and frozen. "New version" copies its definition into a new Draft for you to edit; this Active version is not changed and goes on owning its Schedule until the successor activates.',
  REJECTED:
    'This version was rejected. "Edit" returns it to Draft, and every section becomes editable again in the Builder.',
  RETIRED:
    'This version is retired and read-only. Start from the Active version of this Procedure to author a successor.',
};

export function EditVersionPanel({
  version,
  headingId,
}: {
  readonly version: ProcedureVersionView;
  /** Supplied by the page so the section's heading is its accessible name. */
  readonly headingId: string;
}): React.JSX.Element {
  // `Object.hasOwn`, not a plain index: a state read off a row must never resolve to an
  // inherited `Object.prototype` member and be rendered as the rule.
  const rule = Object.hasOwn(EDIT_RULE, version.state) ? EDIT_RULE[version.state] : null;
  return (
    <section className="ls-card ls-stack" aria-labelledby={headingId}>
      <h2 className="ls-card__title" id={headingId}>
        Editing this version
      </h2>
      {rule === null ? null : <p>{rule}</p>}
      {version.state === 'DRAFT' ? (
        <p>
          <Link
            className="ls-button ls-button--secondary ls-button--md"
            href={`/procedures/${version.procedureId}/builder?version=${version.versionId}`}
          >
            Open Builder
          </Link>
        </p>
      ) : null}
      {version.state === 'ACTIVE' ? (
        <NewVersionButton
          procedureId={version.procedureId}
          versionId={version.versionId}
          expectedRowVersion={procedureVersionRowVersion(version)}
        />
      ) : null}
    </section>
  );
}
