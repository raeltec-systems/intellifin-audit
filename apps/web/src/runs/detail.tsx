import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isActiveRunState, type RunRecord } from '@intellifin/domain';
import { CryptoUuidV7Generator, DrizzleRunRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { Banner } from '../design/Banner';
import { StatusBadge } from '../design/StatusBadge';
import { Tabs } from '../design/Tabs';
import { STALE_DATA_ACTION, runCanceledBy, updatedAtTitle } from '../design/copy';
import { DetailTrail } from '../procedures/DetailTrail';
import { requireServerAction } from '../server-session';
import { RunLifecycleActions } from './RunLifecycleActions';
import { runLifecycleWord, utcStamp } from './labels';

/**
 * The five Run Detail tabs, in EXPERIENCE.md's order.
 *
 * Each is its own ROUTE, and `Tabs` renders links in a `<nav>` with `aria-current` rather
 * than `role="tab"`: a tablist with no tabpanel beside it announces a widget the page does
 * not have. Because each is a route, each authorizes for itself — reaching one is not a
 * precondition for reading another, and `requireServerAction` on every page is what makes
 * that true rather than a convention.
 */
export const RUN_TABS = [
  { slug: '', label: 'Result' },
  { slug: 'evidence', label: 'Evidence' },
  { slug: 'exceptions', label: 'Exceptions' },
  { slug: 'review', label: 'Review' },
  { slug: 'timeline', label: 'Execution Timeline' },
] as const;

export type RunTabSlug = (typeof RUN_TABS)[number]['slug'];

export function runTabHref(runId: string, slug: RunTabSlug): string {
  return slug === '' ? `/runs/${runId}` : `/runs/${runId}/${slug}`;
}

/** The tab's own label, for the trail and the page title. `Object.hasOwn` is unnecessary
 * here because the slug is a literal type supplied by the route, never request input. */
export function runTabLabel(slug: RunTabSlug): string {
  return RUN_TABS.find((tab) => tab.slug === slug)?.label ?? 'Result';
}

export type RunAccess =
  | { readonly allowed: false; readonly reason: string }
  | { readonly allowed: true; readonly run: RunRecord; readonly readAt: Date };

/**
 * Authorize, then resolve the Run. In that order, always.
 *
 * The role is read fresh on every request (AD-7) and a refusal is audited before any Run
 * fact is exposed — including before the id is looked up, so a denied caller cannot learn
 * from a 404 whether a Run exists. A malformed or absent id is a safe not-found page, not
 * a framework 500: `/runs/%E0%A4%A` is a URL anybody can type, and `findRun` guards the
 * `uuid` comparison that would otherwise raise `22P02`.
 */
export async function openRun(id: string): Promise<RunAccess> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return { allowed: false, reason: decision.reason };
  const runtime = await getRuntime();
  const run = await new DrizzleRunRepository(runtime.db).findRun(id);
  if (run === null) notFound();
  return { allowed: true, run, readAt: new Date() };
}

/** What a role without the action sees: the gating table's sentence, and no Run fact. */
export function RunDenied({ reason }: { readonly reason: string }): React.JSX.Element {
  return (
    <div className="ls-stack">
      <h1>Run</h1>
      <Banner tone="danger" title={reason} />
    </div>
  );
}

/**
 * The banner every request-time read on these two surfaces carries.
 *
 * EXPERIENCE.md → "Any / Stale data": `Banner "Updated {time}. Refresh." on Run Detail and
 * Runs`. Nothing here polls, streams or auto-refreshes — Epic 5 adds the live channel on
 * Live View — so this is what tells the reader the page is a snapshot and how old it is.
 * "Refresh." is a real link to the same route, so the affordance works with no JavaScript.
 */
export function RefreshBanner({
  readAt,
  href,
}: {
  readonly readAt: Date;
  readonly href: string;
}): React.JSX.Element {
  return (
    <Banner tone="info" title={updatedAtTitle(utcStamp(readAt))}>
      <p>
        <Link href={href}>{STALE_DATA_ACTION}</Link>
      </p>
    </Banner>
  );
}

/**
 * The Run Detail chrome: trail, header, lifecycle badge, cancellation state, tabs,
 * refresh banner and the action bar.
 *
 * Rendered by every tab rather than by a `layout.tsx`, because the layout is not where
 * the authorization is: a page that forgot to call `openRun` would still be wrapped by a
 * layout that did, and "every tab authorizes for itself" would become a convention again.
 */
export function RunDetailFrame({
  run,
  tab,
  readAt,
  children,
}: {
  readonly run: RunRecord;
  readonly tab: RunTabSlug;
  readonly readAt: Date;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const lifecycle = runLifecycleWord(run.state);
  const here = runTabHref(run.runId, tab);
  const trail = [
    { href: '/runs', label: 'Runs' },
    { href: runTabHref(run.runId, ''), label: run.runId, mono: true },
    ...(tab === '' ? [] : [{ href: here, label: runTabLabel(tab) }]),
  ];
  return (
    <div className="ls-stack">
      <DetailTrail trail={trail} />
      <header className="ls-page-header">
        <h1>Run · {run.procedureName}</h1>
        <p>
          <Link href={`/procedures/${run.procedureId}`}>{run.procedureName}</Link> ·{' '}
          <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>
            v{run.versionNumber}
          </Link>{' '}
          · {run.kind === 'STANDARD' ? 'Standard' : 'Regression'} Run
        </p>
        {/* A state outside the vocabulary is written in words: `StatusBadge` throws on an
            unknown state, and on a page that is a 500 for the whole Run. */}
        {lifecycle === null ? (
          <p>Run lifecycle: {run.state}</p>
        ) : (
          <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />
        )}
      </header>
      <RefreshBanner readAt={readAt} href={here} />
      <Tabs label="Run Detail" tabs={RUN_TABS.map((entry) => ({ href: runTabHref(run.runId, entry.slug), label: entry.label }))} current={here} />
      <CancellationBanners run={run} />
      <RunLifecycleActions
        runId={run.runId}
        active={isActiveRunState(run.state)}
        cancelPending={run.cancellation !== null}
        requestToken={new CryptoUuidV7Generator().next()}
        procedureName={run.procedureName}
      />
      {children}
    </div>
  );
}

/**
 * What a cancellation says, on whichever tab the reader is on.
 *
 * EXPERIENCE.md → Run Detail / Canceled: "Canceled by {actor} at {elapsed}"; Evidence
 * preserved. The actor and the time come from the durable marker, never from a guess:
 * `CANCELED` is reserved for a person and the row says which one.
 */
export function CancellationBanners({ run }: { readonly run: RunRecord }): React.JSX.Element {
  if (run.cancellation === null) return <></>;
  if (run.state === 'CANCELED') {
    return (
      <Banner
        tone="warning"
        title={runCanceledBy(run.cancellation.requestedBy, utcStamp(run.cancellation.requestedAt))}
      >
        <p>{run.cancellation.reason}</p>
        <p>Evidence already collected is preserved. No conclusion was issued.</p>
      </Banner>
    );
  }
  return (
    <Banner
      tone="warning"
      title={`Cancellation requested by ${run.cancellation.requestedBy} at ${utcStamp(run.cancellation.requestedAt)}`}
    >
      {isActiveRunState(run.state) ? (
        <p>The Run stops at its next checkpoint, before any further Target System work.</p>
      ) : (
        <p>The Run ended before the cancellation was performed, so its own outcome stands.</p>
      )}
    </Banner>
  );
}
