import type { Metadata } from 'next';

import { EMPTY_STATES } from '../../src/design/copy';
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
      <EmptyState icon="inbox" {...EMPTY_STATES.reviewQueueEmpty} />
    </div>
  );
}
