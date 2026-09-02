import type { Metadata } from 'next';

import { EmptyState } from '../src/design/EmptyState';

export const metadata: Metadata = { title: 'Overview · IntelliFin Audit' };

/**
 * Overview.
 *
 * Story 1.4 builds the shell, not the surfaces. This page carries the two empty states
 * EXPERIENCE.md specifies for Overview, word for word, because they are the surface's
 * whole content in an environment where nothing has run — which is the state this PoC
 * starts in and the state the axe gate scans.
 *
 * Both sentences refuse the same inference on purpose: an empty Overview is not a
 * passed control, and neither empty state offers an action that would change that.
 */
export default function OverviewPage(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Overview</h1>
        <p>What ran, what needs attention, and whether Evidence is trustworthy.</p>
      </header>

      <section aria-labelledby="needs-attention-heading" className="ls-stack">
        <h2 id="needs-attention-heading">Needs attention</h2>
        <EmptyState
          icon="check-circle-2"
          headline="Nothing needs attention."
          sentence="No Result awaits confirmation or review, no Run is waiting on you, and none is Inconclusive or Run Failed. This does not imply that any control passed."
        />
      </section>

      <section aria-labelledby="recent-runs-heading" className="ls-stack">
        <h2 id="recent-runs-heading">Recent Runs</h2>
        <EmptyState
          headline="No Runs yet."
          sentence="No Procedure has run in this environment. An empty Overview does not mean a control passed."
        />
      </section>
    </div>
  );
}
