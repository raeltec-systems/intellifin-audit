import type { Metadata } from 'next';

import { EmptyState } from '../../src/design/EmptyState';

export const metadata: Metadata = { title: 'Procedures · IntelliFin Audit' };

/**
 * Procedures — an inert placeholder so the nav item resolves.
 *
 * EXPERIENCE.md gives this surface an empty state whose only action is "New procedure".
 * The Procedure Builder is Epic 2, so the action is not offered here: a link to a route
 * that does not exist is worse than no link, and an EmptyState may not carry a mutating
 * call to action in any case.
 */
export default function ProceduresPage(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Procedures</h1>
        <p>Procedures with their Active version, Schedule, next Run, and last outcome.</p>
      </header>
      <EmptyState
        icon="file-text"
        headline="No Procedures yet."
        sentence="A Procedure and its versions would be listed here. Authoring a Procedure is not part of this release, and an empty list does not mean a control passed."
      />
    </div>
  );
}
