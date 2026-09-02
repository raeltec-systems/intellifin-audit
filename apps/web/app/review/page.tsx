import type { Metadata } from 'next';

import { EmptyState } from '../../src/design/EmptyState';

export const metadata: Metadata = { title: 'Review · IntelliFin Audit' };

/**
 * Review — an inert placeholder so the nav item resolves. The headline is the verbatim
 * empty state EXPERIENCE.md gives the review queue.
 */
export default function ReviewPage(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Review</h1>
        <p>Results awaiting a decision, and Results already finalized.</p>
      </header>
      <EmptyState
        icon="inbox"
        headline="No Result awaits your decision."
        sentence="A submitted Result, its outcome, and its Evidence Quality Gate would be listed here. An empty queue does not mean a control passed."
      />
    </div>
  );
}
