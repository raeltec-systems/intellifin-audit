import type { Metadata } from 'next';

import { Absent } from '../../../../src/design/Absent';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';

export const metadata: Metadata = { title: 'Run · Review · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/**
 * Run Detail → Review.
 *
 * **This tab has no data behind it, and that is stated rather than hidden.** The Auditor
 * Review state machine is Draft → Submitted → Approved → Finalized (addendum §E), and
 * Epic 3 creates no review at all: Story 6.3 is what submits a Result for one. So there is
 * no review row for any Run in this environment.
 *
 * The tab still exists, because EXPERIENCE.md's Run Detail is five tabs and a missing one
 * would leave the reader wondering where review went. What it must never do is render an
 * empty review panel, or a "Draft" badge for a review nobody started — that is Story 2.1's
 * "Active version: Draft" defect, where a cell stated a fact that was not true.
 */
export default async function RunReviewPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  return (
    <RunDetailFrame run={run} tab="review" readAt={readAt}>
      <section className="ls-card ls-stack" aria-labelledby="review-heading">
        <h2 id="review-heading">Auditor Review</h2>
        <dl className="ls-definition">
          <div>
            <dt>Review state</dt>
            <dd>
              <Absent what="No Auditor Review has started." />
            </dd>
          </div>
        </dl>
        <EmptyState
          icon="user-check"
          headline={RUN_TAB_EMPTY.review.headline}
          sentence={RUN_TAB_EMPTY.review.sentence}
        />
      </section>
    </RunDetailFrame>
  );
}
