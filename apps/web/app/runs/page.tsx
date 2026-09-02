import type { Metadata } from 'next';

import { EmptyState } from '../../src/design/EmptyState';

export const metadata: Metadata = { title: 'Runs · IntelliFin Audit' };

/** Runs — an inert placeholder so the nav item resolves. */
export default function RunsPage(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Runs</h1>
        <p>Runs with their lifecycle, Result outcome, Evidence Quality Gate, and initiator.</p>
      </header>
      <EmptyState
        icon="play"
        headline="No Runs yet."
        sentence="A Run, its lifecycle state, and its sealed Result would be listed here. An empty list does not mean a control passed."
      />
    </div>
  );
}
