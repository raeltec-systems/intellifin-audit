import type { Metadata } from 'next';

import type { Role } from '@intellifin/domain';
import type { SessionSnapshot } from '@intellifin/application';
import { DrizzleActorNameReader } from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { Banner } from '../../src/design/Banner';
import { EMPTY_STATES } from '../../src/design/copy';
import { EmptyState } from '../../src/design/EmptyState';
import { PageHeader } from '../../src/design/PageHeader';
import { Tabs } from '../../src/design/Tabs';
import { SubmittedVersions } from '../../src/review/SubmittedVersions';
import { maySeeApprovalQueue, maySubmitVersions, readReviewQueues } from '../../src/review/reads';
import {
  PROCEDURES_TAB_AUDITOR_EMPTY,
  PROCEDURES_TAB_AUDITOR_HEADING,
  PROCEDURES_TAB_AUDITOR_SENTENCE,
  PROCEDURES_TAB_HEADING,
  PROCEDURES_TAB_SENTENCE,
  REVIEWS_LEDE,
  REVIEWS_NOT_YOUR_QUEUE,
  REVIEWS_TITLE,
  REVIEW_TABS,
  REVIEW_TABS_LABEL,
  SUBMITTED_VERSIONS_UNREADABLE,
} from '../../src/review/review-words';
import { currentIdentity } from '../../src/server-session';

export const metadata: Metadata = { title: 'Reviews · IntelliFin Audit' };

/** The role is read per request and the queues change under the reader; never cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Reviews — Procedures (UI cleanup 2026-09-22, UX-30, UX-35).
 *
 * `[REPAIRED]` This page was Story 1.4's placeholder: it rendered
 * `EMPTY_STATES.reviewQueueEmpty` UNCONDITIONALLY and read nothing at all, so a manager
 * with a Procedure Version waiting for them was told no Result awaited their decision —
 * false about the thing that was waiting and false about the thing that cannot wait in
 * this release. The 2026-09-16 walkthrough named this page as the third face of that
 * defect and left it unfixed; this is the fix.
 *
 * The sidebar's Reviews link lands HERE, on Procedures, because that is the queue this
 * release can actually be acted on. The Results tab is one link away and states its own
 * availability.
 *
 * The contract's empty state stays, from `copy.ts`, for the case it was written for: a
 * manager whose approval queue really is empty. `copy.test.ts` requires this file to
 * render `EMPTY_STATES`, which is what stops the sentence being retyped inline.
 */
export default async function ReviewPage(): Promise<React.JSX.Element> {
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
        current={REVIEW_TABS.procedures.href}
      />
      {session === null || role === null || !(maySeeApprovalQueue(role) || maySubmitVersions(role)) ? (
        <Banner tone="info" title={REVIEWS_NOT_YOUR_QUEUE} />
      ) : (
        <ProceduresQueue session={session} role={role} />
      )}
    </div>
  );
}

/**
 * The queue itself, for a role that has one.
 *
 * An Audit Manager is being asked to decide; an Auditor is being told where their own
 * submitted work got to. Two headings and two empty states, because the two readers are
 * asked for different things — a queue headed "awaiting approval" shown to somebody who
 * may not approve invites an action every surface below it will refuse.
 */
async function ProceduresQueue({
  session,
  role,
}: {
  readonly session: SessionSnapshot;
  readonly role: Role;
}): Promise<React.JSX.Element> {
  const runtime = await getRuntime();
  const decides = maySeeApprovalQueue(role);
  const { versions } = await readReviewQueues(session, role);
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(
    (versions?.rows ?? []).flatMap((version) =>
      [version.authorId, version.submittedBy].filter((id): id is string => id !== null),
    ),
  );
  return (
    <section aria-labelledby="review-procedures-heading" className="ls-stack">
      <h2 id="review-procedures-heading">
        {decides ? PROCEDURES_TAB_HEADING : PROCEDURES_TAB_AUDITOR_HEADING}
      </h2>
      <p>{decides ? PROCEDURES_TAB_SENTENCE : PROCEDURES_TAB_AUDITOR_SENTENCE}</p>
      {/* An unreadable queue is NOT an empty queue: a version really may be waiting, and
          saying nothing would tell a manager their work is done. */}
      {versions === null ? (
        <Banner tone="warning" title={SUBMITTED_VERSIONS_UNREADABLE} />
      ) : versions.total === 0 ? (
        <EmptyState
          icon="inbox"
          {...(decides ? EMPTY_STATES.reviewQueueEmpty : PROCEDURES_TAB_AUDITOR_EMPTY)}
        />
      ) : (
        <SubmittedVersions rows={versions.rows} total={versions.total} names={names} />
      )}
    </section>
  );
}
