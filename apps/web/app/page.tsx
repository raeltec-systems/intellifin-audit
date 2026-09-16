import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { authorizeActionRole, type Role } from '@intellifin/domain';
import type { OpenNotification, SessionSnapshot } from '@intellifin/application';
import {
  DrizzleActorNameReader,
  DrizzleNotificationRepository,
  DrizzleRunListRepository,
  DrizzleRunOverviewRepository,
  DrizzleRunStopReader,
  DrizzleSubmittedVersionReader,
  type StoppedRunRow,
  type SubmittedVersionRow,
} from '@intellifin/infrastructure';

import { getRuntime } from '../src/bootstrap';
import { Banner } from '../src/design/Banner';
import { EMPTY_STATES, STALE_DATA_ACTION, updatedAtTitle } from '../src/design/copy';
import { EmptyState } from '../src/design/EmptyState';
import { AttentionList, attentionTotal, type AttentionCounts } from '../src/overview/AttentionList';
import { RecentRuns } from '../src/overview/RecentRuns';
import { ALL_RUNS_LINK, OPEN_ITEMS_UNREADABLE, OVERVIEW_NO_ROLE, OVERVIEW_NOT_YOUR_SUMMARY } from '../src/overview/overview-words';
import { RunsTableSkeleton } from '../src/runs/RunsTable';
import { utcStamp } from '../src/runs/labels';
import { isStoppedState } from '../src/runs/stop-reason';
import { currentIdentity } from '../src/server-session';

export const metadata: Metadata = { title: 'Overview · IntelliFin Audit' };

/** The role is read per request and the rows change under the reader; never cached (AD-7). */
export const dynamic = 'force-dynamic';

/** How many Runs the Overview's Recent Runs table holds. The register holds the rest. */
const RECENT_RUN_LIMIT = 10;

/** How many open Escalations and flags the attention list holds. The count beside it is exact. */
const OPEN_ITEM_LIMIT = 10;

/**
 * Overview (UX-DR6, EXPERIENCE.md → Overview).
 *
 * `[REPAIRED 2026-09-16, owner finding RUN-04]` This page was Story 1.4's placeholder: it
 * rendered the two contract empty states UNCONDITIONALLY and read nothing at all. So in
 * production it said "Nothing needs attention", "none is Inconclusive or Run Failed" and
 * "No Runs yet" while the Runs register two clicks away held one Run Failed and two
 * Inconclusive Runs — and said it again after every reload, because there was nothing for
 * a reload to change. **An empty state is a statement about the environment. A surface
 * that makes one without reading anything is not reporting, it is asserting**, and the
 * one it asserted here is the inference every empty state in this product is worded to
 * refuse.
 *
 * Both contract sentences are still here, unchanged, for the case they were written for:
 * a deployment where nothing is waiting and nothing has run. What decides between them
 * and the real content is the EXACT counts from the reads, never the length of a bounded
 * list — a summary that said "nothing needs attention" because three stopped Runs fell
 * off the end of a page would be the same defect with a database behind it.
 *
 * The Run facts are gated on `run.initiate` — the action the Runs register itself is gated
 * on — and are NOT READ for a role that does not hold it. This is the Procedures list's
 * shape, not `requireServerAction`'s, for two reasons. The Overview is the home page every
 * signed-in role lands on, and a landing page that is nothing but a red refusal tells a PoC
 * Administrator they did something wrong when all they did was sign in. And an audited
 * `security.denied` says somebody was refused an ACTION: loading a summary is not one, and
 * writing that event on every home-page load would put routine navigation into a chain
 * nothing can take it out of. Not READING is the control; the sentence is courtesy.
 */
export default async function OverviewPage(): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  const decision = role === null ? null : authorizeActionRole(role, 'run.initiate');
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Overview</h1>
        <p>What ran, what needs attention, and whether Evidence is trustworthy.</p>
      </header>
      {identity.kind === 'identified' && role !== null && decision?.allowed ? (
        <Suspense fallback={<RunsTableSkeleton />}>
          <OverviewSections session={identity.session} role={role} />
        </Suspense>
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

  const [recent, stopped, open, versions] = await Promise.all([
    new DrizzleRunListRepository(runtime.db).listRuns(null, RECENT_RUN_LIMIT),
    new DrizzleRunOverviewRepository(runtime.db).listStoppedRuns(),
    readOpenItems(runtime, session),
    mayApproveVersions
      ? new DrizzleSubmittedVersionReader(runtime.db).listSubmitted()
      : Promise.resolve({ rows: [] as readonly SubmittedVersionRow[], total: 0 }),
  ]);

  // Two bounded reads over the ids this page actually holds: why each stopped Run stopped,
  // and the name of each person on the page. Both are the Runs list's own readers, so the
  // Overview cannot say one thing about a Run while the register says another.
  const stopIds = [
    ...stopped.rows.map((row) => row.runId),
    ...recent.rows.filter((row) => isStoppedState(row.state)).map((row) => row.runId),
  ];
  const [stops, names] = await Promise.all([
    new DrizzleRunStopReader(runtime.db).readStops(stopIds),
    new DrizzleActorNameReader(runtime.db).namesFor(actorIds(recent.rows, stopped.rows, open, versions.rows)),
  ]);

  const counts: AttentionCounts = {
    open: open === null ? 0 : open.total,
    versions: versions.total,
    stopped: stopped.total,
  };
  const nothingNeedsAttention = open !== null && attentionTotal(counts) === 0;

  return (
    <>
      <Banner tone="info" title={updatedAtTitle(utcStamp(readAt))}>
        <p>
          <Link href="/">{STALE_DATA_ACTION}</Link>
        </p>
      </Banner>

      <section aria-labelledby="needs-attention-heading" className="ls-stack">
        <h2 id="needs-attention-heading">Needs attention</h2>
        {open === null ? <Banner tone="warning" title={OPEN_ITEMS_UNREADABLE} /> : null}
        {nothingNeedsAttention ? (
          <EmptyState icon="shield" {...EMPTY_STATES.overviewNothingNeedsAttention} />
        ) : (
          <AttentionList
            open={open?.items ?? []}
            versions={versions.rows}
            stopped={stopped.rows}
            stops={stops}
            names={names}
            counts={counts}
            readAt={readAt}
          />
        )}
      </section>

      <section aria-labelledby="recent-runs-heading" className="ls-stack">
        <h2 id="recent-runs-heading">Recent Runs</h2>
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
    items = await repository.openFor(session, OPEN_ITEM_LIMIT);
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
): readonly string[] {
  return [
    ...recent.map((row) => row.initiatorId),
    ...stopped.map((row) => row.initiatorId),
    ...(open?.items ?? []).flatMap((item) => (item.kind === 'flag' ? [item.flaggedBy] : [])),
    ...versions.flatMap((version) =>
      [version.authorId, version.submittedBy].filter((id): id is string => id !== null),
    ),
  ];
}
