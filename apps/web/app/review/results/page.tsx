import type { Metadata } from 'next';

import type { Role } from '@intellifin/domain';
import type { SessionSnapshot } from '@intellifin/application';
import { DrizzleActorNameReader } from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { Banner } from '../../../src/design/Banner';
import { EmptyState } from '../../../src/design/EmptyState';
import { PageHeader } from '../../../src/design/PageHeader';
import { Tabs } from '../../../src/design/Tabs';
import { PendingResults } from '../../../src/review/PendingResults';
import {
  mayConfirmAssessments,
  maySeeApprovalQueue,
  readReviewQueues,
} from '../../../src/review/reads';
import {
  PENDING_RESULTS_UNREADABLE,
  RESULTS_TAB_EMPTY,
  RESULTS_TAB_HEADING,
  RESULT_REVIEW_MANAGER_NOTE,
  RESULT_REVIEW_UNAVAILABLE_BODY,
  RESULT_REVIEW_UNAVAILABLE_TITLE,
  REVIEWS_LEDE,
  REVIEWS_NOT_YOUR_QUEUE,
  REVIEWS_TITLE,
  REVIEW_TABS,
  REVIEW_TABS_LABEL,
} from '../../../src/review/review-words';
import { currentIdentity } from '../../../src/server-session';

export const metadata: Metadata = { title: 'Reviews · Results · IntelliFin Audit' };

/** The role is read per request and the queue changes under the reader; never cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Reviews — Results (UI cleanup 2026-09-22, UX-35, UX-36).
 *
 * This release has NO Result submission, manager approval or finalization: EXPERIENCE.md's
 * own list of what the cleanup does not deliver names all three, and requires each surface
 * to "state its availability truthfully rather than showing an ordinary empty state". So
 * the unavailability is a BANNER — a statement about the product — and the empty state
 * below it is about the one thing a person really can do here, which is confirm the
 * agent's own assessments on a finished Run.
 *
 * The list is the same read and the same component the Overview uses, so the two surfaces
 * cannot report different amounts of outstanding audit work.
 */
export default async function ReviewResultsPage(): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  // Narrowed here rather than at the call: `role !== null` says nothing about the
  // discriminated union the session lives on.
  const session = identity.kind === 'identified' ? identity.session : null;
  return (
    <div className="ls-stack">
      <PageHeader title={REVIEWS_TITLE} lede={REVIEWS_LEDE} />
      <Tabs
        label={REVIEW_TABS_LABEL}
        tabs={[REVIEW_TABS.procedures, REVIEW_TABS.results]}
        current={REVIEW_TABS.results.href}
      />
      <Banner tone="info" title={RESULT_REVIEW_UNAVAILABLE_TITLE}>
        <p>{RESULT_REVIEW_UNAVAILABLE_BODY}</p>
        {/* A manager's own half of the same fact: there is nothing here to approve,
            because nothing can be sent for approval. */}
        {role !== null && maySeeApprovalQueue(role) ? <p>{RESULT_REVIEW_MANAGER_NOTE}</p> : null}
      </Banner>
      {session === null || role === null || !mayConfirmAssessments(role) ? (
        <Banner tone="info" title={REVIEWS_NOT_YOUR_QUEUE} />
      ) : (
        <PendingQueue session={session} role={role} />
      )}
    </div>
  );
}

async function PendingQueue({
  session,
  role,
}: {
  readonly session: SessionSnapshot;
  readonly role: Role;
}): Promise<React.JSX.Element> {
  const runtime = await getRuntime();
  const { pending } = await readReviewQueues(session, role);
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(
    (pending?.rows ?? []).map((row) => row.initiatorId),
  );
  return (
    <section aria-labelledby="review-results-heading" className="ls-stack">
      <h2 id="review-results-heading">{RESULTS_TAB_HEADING}</h2>
      {/* An unreadable queue is NOT an empty queue. A Run really may be holding on a
          person, and rendering nothing would tell them the platform is simply quiet. */}
      {pending === null ? (
        <Banner tone="warning" title={PENDING_RESULTS_UNREADABLE} />
      ) : pending.total === 0 ? (
        <EmptyState icon="inbox" {...RESULTS_TAB_EMPTY} />
      ) : (
        <PendingResults rows={pending.rows} total={pending.total} names={names} />
      )}
    </section>
  );
}
