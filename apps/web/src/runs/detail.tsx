import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isActiveRunState, type RunRecord } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  DrizzleRunRepository,
  type RunEvaluationRow,
  type RunResultRow,
} from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { Banner } from '../design/Banner';
import { StatusBadge } from '../design/StatusBadge';
import { Tabs } from '../design/Tabs';
import { ESCALATION_PANEL_COPY, STALE_DATA_ACTION, runCanceledBy, updatedAtTitle } from '../design/copy';
import { DetailTrail } from '../procedures/DetailTrail';
import { requireServerAction } from '../server-session';
import { EscalationPanel } from './EscalationPanel';
import { EvaluationReview } from './EvaluationReview';
import { readOpenEscalation } from './escalation-read';
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

export interface EvaluationReviewRead {
  readonly result: Pick<RunResultRow, 'outcome' | 'sealed' | 'version'> | null;
  readonly evaluations: readonly RunEvaluationRow[];
  readonly reviewRevision: number;
  readonly pendingCount: number | null;
}

/**
 * Read the review projection under its own action gate.
 *
 * `RunDetailFrame` already authorized the route to be opened. This second, component
 * specific check is deliberate: review metadata and the mutable review revision are
 * only supplied to roles that may review evaluations, and the revision is read fresh on
 * every request. The browser receives no repository or database capability.
 */
export async function readEvaluationReview(runId: string): Promise<EvaluationReviewRead | null> {
  const decision = await requireServerAction('evaluation.confirm');
  if (!decision.allowed) return null;
  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  const [result, observations, reviewRevision, freshPendingCount] = await Promise.all([
    detail.readResult(runId),
    detail.readObservations(runId),
    detail.readReviewRevision(runId),
    detail.readPendingEvaluationCount(runId),
  ]);
  const evaluations = await detail.readEvaluations(runId, observations.rows.map((row) => row.observationId));
  // The unsealed publication is intentionally unchanged after each review decision. The
  // adjacent query counts the current effective rows, while an unreadable publication
  // keeps the count unavailable rather than presenting a partial Result as complete.
  const pendingCount = result?.publication === null || result?.publication === undefined
    ? null
    : freshPendingCount;
  return {
    result: result === null ? null : { outcome: result.outcome, sealed: result.sealed, version: result.version },
    evaluations,
    reviewRevision,
    pendingCount,
  };
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
export async function RunDetailFrame({
  run,
  tab,
  readAt,
  children,
}: {
  readonly run: RunRecord;
  readonly tab: RunTabSlug;
  readonly readAt: Date;
  readonly children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const escalation = run.state === 'AWAITING_AUDITOR'
    ? await readOpenEscalation(run.runId)
    : null;
  const evaluationReview = tab === '' && (run.state === 'COMPLETED' || run.state === 'INCONCLUSIVE')
    ? await readEvaluationReview(run.runId)
    : null;
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
      <RerunLinks runId={run.runId} />
      <RunLifecycleActions
        runId={run.runId}
        active={isActiveRunState(run.state)}
        awaitingAuditor={run.state === 'AWAITING_AUDITOR'}
        cancelPending={run.cancellation !== null}
        requestToken={new CryptoUuidV7Generator().next()}
        procedureName={run.procedureName}
      />
      {run.state === 'AWAITING_AUDITOR' && escalation !== null
        ? escalation.wait !== null && escalation.runRevision !== null
          ? <EscalationPanel runId={run.runId} wait={escalation.wait} details={escalation.details} runRevision={escalation.runRevision} readAt={readAt.toISOString()} />
          : <Banner tone="danger" title={ESCALATION_PANEL_COPY.unavailable} />
        : null}
      {evaluationReview !== null ? (
        <EvaluationReview
          runId={run.runId}
          result={evaluationReview.result}
          evaluations={evaluationReview.evaluations}
          reviewRevision={evaluationReview.reviewRevision}
          pendingCount={evaluationReview.pendingCount}
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * The Runs this one has already been rerun as, on whichever tab the reader is on.
 *
 * `RunLifecycleActions` tells somebody whose rerun response was LOST to "Reload the Run to
 * see whether a new Run was queued", and until now the Run they reloaded could not answer
 * that: the link is deliberately on the SUCCESSOR's row and its own chain and NOWHERE else,
 * so the predecessor's page showed nothing at all. They reloaded, saw no change, and clicked
 * Rerun again — and once the first successor had itself concluded, the active-period check
 * no longer refused the second, so one intent became two Runs and the person believed one.
 *
 * This does not stop a DELIBERATE second rerun, and it must not: nothing in the contract
 * says a terminal Run has at most one successor, and inventing that rule here would be a
 * product decision taken by a bug fix. What it does is make the answer visible where the
 * recovery sentence sends the reader.
 */
export async function RerunLinks({ runId }: { readonly runId: string }): Promise<React.JSX.Element> {
  const runtime = await getRuntime();
  const successors = await new DrizzleRunRepository(runtime.db).findSuccessors(runId);
  if (successors.length === 0) return <></>;
  return (
    <Banner tone="info" title={successors.length === 1 ? 'This Run has been rerun.' : 'This Run has been rerun more than once.'}>
      <ul>
        {successors.map((successor) => (
          <li key={successor.runId}>
            <Link className="ls-mono" href={runTabHref(successor.runId, '')}>
              {successor.runId}
            </Link>{' '}
            · started {utcStamp(successor.initiatedAt)} by {successor.initiatorId}
          </li>
        ))}
      </ul>
    </Banner>
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
