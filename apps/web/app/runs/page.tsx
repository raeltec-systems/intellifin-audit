import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DrizzleRunListRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { LiveBanner } from '../../src/runs/LiveBanner';
import { RunsPagination, RunsTable, RunsTableSkeleton } from '../../src/runs/RunsTable';
import { Banner } from '../../src/design/Banner';
import { requireServerAction } from '../../src/server-session';

export const metadata: Metadata = { title: 'Runs · IntelliFin Audit' };

/** The role is read per request and the rows change under the reader; never cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Runs (FR-48, EXPERIENCE.md → Data tables → Runs).
 *
 * A request-time read behind the contract's `Updated {time}. Refresh.` banner, which
 * the live channel (Story 5.1, AD-17) re-reads on every committed Timeline event: the
 * table still asks the database at the moment the request is served and says so; the
 * channel only decides when to ask again. No polling.
 *
 * The table itself is inside a `<Suspense>` boundary so a cold load streams skeleton rows
 * in the shape of the layout rather than a blank page — EXPERIENCE.md's "Any / Cold load"
 * row, whose other half is "no counts shown until loaded", which is why the count is
 * inside the boundary too.
 */
export default async function RunsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ after?: string }>;
}): Promise<React.JSX.Element> {
  // Authorization FIRST, before any Run fact is read, and audited on refusal.
  const decision = await requireServerAction('run.initiate');
  const after = (await searchParams).after ?? null;
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Runs</h1>
        <p>Runs with their lifecycle, Result outcome, Evidence Quality Gate, and initiator.</p>
      </header>
      {decision.allowed ? (
        <Suspense fallback={<RunsTableSkeleton />}>
          <RunsList after={after} />
        </Suspense>
      ) : (
        <Banner tone="danger" title={decision.reason} />
      )}
    </div>
  );
}

async function RunsList({ after }: { readonly after: string | null }): Promise<React.JSX.Element> {
  const runtime = await getRuntime();
  const page = await new DrizzleRunListRepository(runtime.db).listRuns(after);
  const readAt = new Date();
  return (
    <>
      <LiveBanner url="/api/runs/events" cursor={null} readAt={readAt.toISOString()} href={after === null ? '/runs' : `/runs?after=${after}`} />
      <RunsTable rows={page.rows} readAt={readAt} />
      <RunsPagination next={page.next} firstHref="/runs" onFirstPage={after === null} />
    </>
  );
}
