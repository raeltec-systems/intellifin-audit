import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { authorizeActionRole, type Role } from '@intellifin/domain';
import type { OpenNotification, SessionSnapshot } from '@intellifin/application';
import {
  DrizzleActorNameReader,
  DrizzleNotificationRepository,
  DrizzleProcedureListReader,
  DrizzleRunListRepository,
  DrizzleRunOverviewRepository,
  DrizzleRunStopReader,
  type PendingResultRow,
  type ProcedureListPage,
  type StoppedRunRow,
  type SubmittedVersionRow,
} from '@intellifin/infrastructure';

import { getRuntime } from '../src/bootstrap';
import { Banner } from '../src/design/Banner';
import { EMPTY_STATES, STALE_DATA_ACTION, updatedAtTitle } from '../src/design/copy';
import { EmptyState } from '../src/design/EmptyState';
import { PageHeader } from '../src/design/PageHeader';
import { readableStamp } from '../src/design/time';
import { AdministratorOverview } from '../src/overview/AdministratorOverview';
import { AttentionList, attentionTotal, type AttentionCounts } from '../src/overview/AttentionList';
import { MyDrafts } from '../src/overview/MyDrafts';
import { RecentRuns } from '../src/overview/RecentRuns';
import {
  ALL_RUNS_LINK,
  ATTENTION_HEADING,
  MANAGER_ATTENTION_ORDER,
  MANAGER_RESULT_REVIEW_NOTE,
  OPEN_ITEMS_UNREADABLE,
  OVERVIEW_DRAFT_LIMIT,
  OVERVIEW_LEDE,
  OVERVIEW_NOT_YOUR_SUMMARY,
  OVERVIEW_NO_ROLE,
  OVERVIEW_OPEN_ITEM_LIMIT,
  OVERVIEW_STOPPED_LIMIT,
  RECENT_RUNS_HEADING,
  REVIEWS_LINK,
} from '../src/overview/overview-words';
import { readReviewQueues } from '../src/review/reads';
import { PENDING_RESULTS_UNREADABLE, SUBMITTED_VERSIONS_UNREADABLE } from '../src/review/review-words';
import { RunsTableSkeleton } from '../src/runs/RunsTable';
import { isStoppedState } from '../src/runs/stop-reason';
import { currentIdentity } from '../src/server-session';

export const metadata: Metadata = { title: 'Overview · IntelliFin Audit' };

/** The role is read per request and the rows change under the reader; never cached (AD-7). */
export const dynamic = 'force-dynamic';

/** How many Runs the Overview's Recent Runs table holds. The register holds the rest. */
const RECENT_RUN_LIMIT = 10;

/**
 * Overview (UX-DR6, EXPERIENCE.md → Overview).
 *
 * `[REPAIRED 2026-09-16, owner finding RUN-04]` This page was Story 1.4's placeholder: it
 * rendered the two contract empty states UNCONDITIONALLY and read nothing at all. So in
 * production it said "Nothing needs attention", "none is Inconclusive or Run Failed" and
 * "No Runs yet" while the Runs register two clicks away held one Run Failed and two
 * Inconclusive Runs. **An empty state is a statement about the environment. A surface that
 * makes one without reading anything is not reporting, it is asserting.**
 *
 * `[ROLE LANDING 2026-09-22, UI cleanup UX-37]` It is now the signed-in role's home rather
 * than one summary shown to everybody:
 *
 * - An **Auditor** leads with their own Drafts — the work they started and can finish —
 *   then what needs attention, then the recent Runs.
 * - An **Audit Manager** leads with the Procedure Versions awaiting their approval (the
 *   attention list's `MANAGER_ATTENTION_ORDER`), and is told plainly that Results cannot
 *   yet be sent to them, because a manager who is not told reads an approvals queue as the
 *   whole of their responsibility.
 * - A **PoC Administrator** lands on an administration summary. They used to meet a
 *   refusal-shaped Banner saying the summary was for other people — a welcome that told
 *   somebody they had done something wrong when all they did was sign in, and named
 *   nothing they could do about it. The contract now says it outright: "a PoC
 *   Administrator lands on an administration summary, not on a refusal."
 *
 * The Run facts stay gated on `run.initiate` — the action the Runs register itself is
 * gated on — and are NOT READ for a role that does not hold it. Not READING is the
 * control; what the page then shows is courtesy. An audited `security.denied` says
 * somebody was refused an ACTION, and loading a home page is not one.
 */
export default async function OverviewPage(): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  const decision = role === null ? null : authorizeActionRole(role, 'run.initiate');
  const administers = role !== null && authorizeActionRole(role, 'administration.users.manage').allowed;
  return (
    <div className="ls-stack">
      <PageHeader title="Overview" lede={OVERVIEW_LEDE} />
      {identity.kind === 'identified' && role !== null && decision?.allowed ? (
        <Suspense fallback={<RunsTableSkeleton />}>
          <OverviewSections session={identity.session} role={role} />
        </Suspense>
      ) : administers ? (
        <AdministratorOverview />
      ) : (
        <Banner tone="info" title={decision?.allowed === false ? decision.reason : OVERVIEW_NO_ROLE}>
          <p>{OVERVIEW_NOT_YOUR_SUMMARY}</p>
        </Banner>
      )}
    </div>
  );
}

/**
 * What the open-notification read answered.
 *
 * `null` is "the read failed", which is NOT an absence: `AWAITING_AUDITOR` means a Run is
 * holding on a question, and a surface that renders nothing tells the reader it is simply
 * quiet. Story 5.6 landed that rule on `OpenEscalationSection`; this is the same read
 * failure one surface along, so it says so in a Banner and the "Nothing needs attention"
 * empty state is then unreachable.
 */
type OpenItems = { readonly items: readonly OpenNotification[]; readonly total: number } | null;

async function OverviewSections({
  session,
  role,
}: {
  readonly session: SessionSnapshot;
  readonly role: Role;
}): Promise<React.JSX.Element> {
  const runtime = await getRuntime();
  const readAt = new Date();
  // Role-level, not per version: whether THIS manager may approve a PARTICULAR version is
  // `authorizeAction`'s author rule, applied where the decision is taken. A version they
  // wrote themselves is still waiting and is still listed — they need to know it is, even
  // though somebody else has to approve it.
  const mayApproveVersions = authorizeActionRole(role, 'procedure.version.approve').allowed;
  const mayAuthor = authorizeActionRole(role, 'procedure.author').allowed;

  const [recent, stopped, open, queues, drafts] = await Promise.all([
    new DrizzleRunListRepository(runtime.db).listRuns(null, RECENT_RUN_LIMIT),
    new DrizzleRunOverviewRepository(runtime.db).listStoppedRuns(OVERVIEW_STOPPED_LIMIT),
    readOpenItems(runtime, session),
    // ONE read of "what is waiting for this person", shared with the Reviews area and the
    // sidebar count: three call sites reading the repositories directly would be three
    // chances to apply the role rule differently, and the failure mode is a sidebar badge
    // counting work the page it leads to does not show.
    readReviewQueues(session, role, { pending: OVERVIEW_OPEN_ITEM_LIMIT, wantVersions: mayApproveVersions }),
    mayAuthor
      ? new DrizzleProcedureListReader(runtime.db).listAuthoredDrafts(
          session.userId,
          OVERVIEW_DRAFT_LIMIT,
        )
      : Promise.resolve<ProcedureListPage>({ rows: [], total: 0, unfilteredTotal: 0, offset: 0, limit: 0 }),
  ]);
  const versions = queues.versions;
  const pending = queues.pending;

  // Two bounded reads over the ids this page actually holds: why each stopped Run stopped,
  // and the name of each person on the page. Both are the Runs list's own readers, so the
  // Overview cannot say one thing about a Run while the register says another.
  const stopIds = [
    ...stopped.rows.map((row) => row.runId),
    ...recent.rows.filter((row) => isStoppedState(row.state)).map((row) => row.runId),
  ];
  const [stops, names] = await Promise.all([
    new DrizzleRunStopReader(runtime.db).readStops(stopIds),
    new DrizzleActorNameReader(runtime.db).namesFor(
      actorIds(recent.rows, stopped.rows, open, versions?.rows ?? [], pending?.rows ?? []),
    ),
  ]);

  const counts: AttentionCounts = {
    open: open === null ? 0 : open.total,
    pending: pending === null ? 0 : pending.total,
    versions: versions === null ? 0 : versions.total,
    stopped: stopped.total,
  };
  // An unreadable read is never an absence, so "nothing needs attention" is reachable only
  // when every read SUCCEEDED and every exact count is zero.
  const everythingRead = open !== null && pending !== null && (!mayApproveVersions || versions !== null);
  const nothingNeedsAttention = everythingRead && attentionTotal(counts) === 0;

  return (
    <>
      <Banner tone="info" variant="line" title={updatedAtTitle(readableStamp(readAt, 'minute'))}>
        <Link href="/">{STALE_DATA_ACTION}</Link>
      </Banner>

      {/* An Auditor's own work, first. A Draft is the one thing a landing page can show
          them that nobody else needs to see. A manager may author too, so the section is
          gated on the action rather than on a role name — and it renders only when they
          really have one, so an approvals queue is not pushed down by an empty list. */}
      {mayAuthor && drafts.total > 0 ? <MyDrafts rows={drafts.rows} total={drafts.total} /> : null}

      <section aria-labelledby="needs-attention-heading" className="ls-stack">
        <h2 id="needs-attention-heading">{ATTENTION_HEADING}</h2>
        {open === null ? <Banner tone="warning" title={OPEN_ITEMS_UNREADABLE} /> : null}
        {pending === null ? <Banner tone="warning" title={PENDING_RESULTS_UNREADABLE} /> : null}
        {mayApproveVersions && versions === null ? (
          <Banner tone="warning" title={SUBMITTED_VERSIONS_UNREADABLE} />
        ) : null}
        {nothingNeedsAttention ? (
          <EmptyState icon="shield" {...EMPTY_STATES.overviewNothingNeedsAttention} />
        ) : (
          <AttentionList
            open={open?.items ?? []}
            pending={pending?.rows ?? []}
            versions={versions?.rows ?? []}
            stopped={stopped.rows}
            stops={stops}
            names={names}
            counts={counts}
            readAt={readAt}
            order={mayApproveVersions ? MANAGER_ATTENTION_ORDER : undefined}
          />
        )}
        {/* The half of a manager's work this release does not have, said to the one role
            that would otherwise read an approvals queue as the whole of it. */}
        {mayApproveVersions ? (
          <p className="ls-caption">
            {MANAGER_RESULT_REVIEW_NOTE} <Link href="/review">{REVIEWS_LINK}</Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="recent-runs-heading" className="ls-stack">
        <h2 id="recent-runs-heading">{RECENT_RUNS_HEADING}</h2>
        <RecentRuns rows={recent.rows} stops={stops} names={names} />
        <p>
          <Link href="/runs">{ALL_RUNS_LINK}</Link>
        </p>
      </section>
    </>
  );
}

/**
 * The open Escalations and flags this person can see, and how many there are.
 *
 * `countOpenFor` is the number the shell's bell shows and it THROWS on an unreadable
 * count, so the two reads are caught separately: an unreadable COUNT loses the bounded
 * note and nothing else, while an unreadable LIST is an absence this surface may not
 * render. The telemetry message is the closed allowlist's own entry for this repository's
 * read failing; a more precise one would be an addition to `TELEMETRY_MESSAGES`, which
 * this change does not own.
 */
async function readOpenItems(
  runtime: Awaited<ReturnType<typeof getRuntime>>,
  session: SessionSnapshot,
): Promise<OpenItems> {
  const repository = new DrizzleNotificationRepository(runtime.db);
  let items: readonly OpenNotification[];
  try {
    items = await repository.openFor(session, OVERVIEW_OPEN_ITEM_LIMIT);
  } catch (error) {
    runtime.telemetry.captureError('Notification count could not be read', error, { outcome: 'failure' });
    return null;
  }
  try {
    // Never below what the list itself holds: a count smaller than the rows would make the
    // bounded note say a page is showing more than there is.
    return { items, total: Math.max(await repository.countOpenFor(session), items.length) };
  } catch {
    return { items, total: items.length };
  }
}

/** Every person named on this page, in one lookup. A user id printed at a reader is the platform speaking its own language. */
function actorIds(
  recent: readonly { readonly initiatorId: string }[],
  stopped: readonly StoppedRunRow[],
  open: OpenItems,
  versions: readonly SubmittedVersionRow[],
  pending: readonly PendingResultRow[],
): readonly string[] {
  return [
    ...recent.map((row) => row.initiatorId),
    ...stopped.map((row) => row.initiatorId),
    ...pending.map((row) => row.initiatorId),
    ...(open?.items ?? []).flatMap((item) => (item.kind === 'flag' ? [item.flaggedBy] : [])),
    ...versions.flatMap((version) =>
      [version.authorId, version.submittedBy].filter((id): id is string => id !== null),
    ),
  ];
}
