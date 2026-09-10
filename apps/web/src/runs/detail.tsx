import Link from 'next/link';
import { notFound } from 'next/navigation';

import { runPauseTransition, isActiveRunState, type RunRecord } from '@intellifin/domain';
import type { EvaluationReviewCommandStatus, RunWait } from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  DrizzleRunRepository,
  PostgresEvaluationReviewRepository,
  type RunEvaluationRow,
  type RunResultRow,
  readTimelineHead,
} from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { Banner } from '../design/Banner';
import { StatusBadge } from '../design/StatusBadge';
import { Tabs } from '../design/Tabs';
import { WatchControl } from './WatchControl';
import { ESCALATION_PANEL_COPY, PAUSE_COPY, STALE_DATA_ACTION, runCanceledBy, updatedAtTitle } from '../design/copy';
import { DetailTrail } from '../procedures/DetailTrail';
import { requireServerAction } from '../server-session';
import { EscalationPanel } from './EscalationPanel';
import { EvaluationReview } from './EvaluationReview';
import { readOpenEscalation, type OpenEscalationRead } from './escalation-read';
import { LiveBanner } from './LiveBanner';
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
  /** Safe durable command state for the exact current review revision. */
  readonly commandStatuses: readonly EvaluationReviewCommandStatus[];
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
  const commandStatuses = await new PostgresEvaluationReviewRepository(runtime.db)
    .readCommandStatuses(runId, reviewRevision, observations.rows.map((row) => row.observationId));
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
    commandStatuses,
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
  // Read for both wait kinds: an Escalation holds the Run in `AWAITING_AUDITOR` and a
  // pause holds it in `PAUSED`, and the same one read answers which — and, for a pause,
  // supplies the revision the Resume control compare-and-sets against.
  const escalation = run.state === 'AWAITING_AUDITOR' || run.state === 'PAUSED'
    ? await readOpenEscalation(run.runId)
    : null;
  const evaluationReview = tab === '' && (run.state === 'COMPLETED' || run.state === 'INCONCLUSIVE')
    ? await readEvaluationReview(run.runId)
    : null;
  const lifecycle = runLifecycleWord(run.state);
  const here = runTabHref(run.runId, tab);
  // The live channel subscribes only while the Run is active (UX-DR35): the cursor is
  // the chain head the page was read at, so the stream replays exactly what commits
  // after this render and nothing before it. A terminal Run keeps the plain banner.
  const liveCursor = isActiveRunState(run.state)
    ? await readTimelineHead((await getRuntime()).db, run.runId)
    : null;
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
      {liveCursor === null
        ? <RefreshBanner readAt={readAt} href={here} />
        : <LiveBanner url={`/api/runs/${run.runId}/events`} cursor={liveCursor} readAt={readAt.toISOString()} href={here} />}
      <Tabs label="Run Detail" tabs={RUN_TABS.map((entry) => ({ href: runTabHref(run.runId, entry.slug), label: entry.label }))} current={here} />
      <CancellationBanners run={run} />
      <PauseBanners run={run} pause={escalation?.pause ?? null} />
      <RerunLinks runId={run.runId} />
      {/* Watch: the rail's Session control (EXPERIENCE.md → Run Detail rows). Live View
          is its own surface, not a sixth tab, so it is reached from here and from a
          notification rather than from the tab bar. */}
      <WatchControl runId={run.runId} state={run.state} active={isActiveRunState(run.state)} />
      <RunLifecycleActions
        runId={run.runId}
        active={isActiveRunState(run.state)}
        awaitingAuditor={run.state === 'AWAITING_AUDITOR'}
        cancelPending={run.cancellation !== null}
        paused={run.state === 'PAUSED'}
        pausePending={run.pauseRequest !== null}
        pausable={runPauseTransition(run.state) !== null}
        runRevision={escalation?.runRevision ?? null}
        requestToken={new CryptoUuidV7Generator().next()}
        procedureName={run.procedureName}
      />
      <OpenEscalationSection run={run} escalation={escalation} readAt={readAt} />
      {evaluationReview !== null ? (
        <EvaluationReview
          runId={run.runId}
          result={evaluationReview.result}
          evaluations={evaluationReview.evaluations}
          reviewRevision={evaluationReview.reviewRevision}
          pendingCount={evaluationReview.pendingCount}
          commandStatuses={evaluationReview.commandStatuses}
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
 * What a pause says, on whichever tab the reader is on (Story 5.4).
 *
 * EXPERIENCE.md → Run Detail / Paused, character for character, with the three facts the
 * row names filled from the WAIT row rather than from the request marker: `opened_by` and
 * `opened_at` are when the Run actually paused, and `deadline` is when it ends
 * Inconclusive. The marker says only that a pause has been ASKED for, which is the other
 * banner here.
 *
 * A pause the Run outran gets no banner at all: `lifecycle.pause-superseded` is on the
 * Timeline, the Run's own outcome stands, and a banner saying a request was not honoured
 * would compete with the outcome for the reader's attention on every terminal tab.
 */
/**
 * The open Escalation, on Run Detail AND on Live View (Story 5.6).
 *
 * ONE mount, for the reason `RunPauseControls` and `RunCancelControl` are one component
 * each: both surfaces carry the same panel, and two copies would agree on every case
 * anybody tried and diverge on the first one nobody did — here that would be one surface
 * showing the panel and the other silently showing nothing when the wait cannot be read.
 *
 * A wait that is open but unreadable is a BANNER and never an absence. `AWAITING_AUDITOR`
 * means the Run is holding on a question; rendering nothing there would tell a reader the
 * Run is simply busy, which is the "an empty stage that says nothing reads as fine" defect
 * in the one place it costs an audit its answer.
 */
export function OpenEscalationSection({ run, escalation, readAt }: {
  readonly run: RunRecord;
  readonly escalation: OpenEscalationRead | null;
  readonly readAt: Date;
}): React.JSX.Element | null {
  if (run.state !== 'AWAITING_AUDITOR' || escalation === null) return null;
  return escalation.wait !== null && escalation.runRevision !== null
    ? <EscalationPanel
        runId={run.runId}
        wait={escalation.wait}
        details={escalation.details}
        runRevision={escalation.runRevision}
        readAt={readAt.toISOString()}
      />
    : <Banner tone="danger" title={ESCALATION_PANEL_COPY.unavailable} />;
}

export function PauseBanners({ run, pause }: {
  readonly run: RunRecord;
  readonly pause: RunWait | null;
}): React.JSX.Element {
  if (run.state === 'PAUSED' && pause !== null && pause.openedBy !== null) {
    return (
      <Banner
        tone="warning"
        title={PAUSE_COPY.banner
          .replace('{actor}', pause.openedBy)
          .replace('{time}', utcStamp(pause.openedAt))
          .replace('{ends}', utcStamp(pause.deadline))}
      >
        <p>Evidence already collected is preserved. The agent restarts the current Step from its first Tool Action.</p>
      </Banner>
    );
  }
  // Requested and not yet honoured. Only while the Run is still active: a terminal Run
  // that carries one was never paused, and the Timeline records that as superseded.
  if (run.pauseRequest !== null && isActiveRunState(run.state)) {
    return (
      <Banner
        tone="warning"
        title={`Pause requested by ${run.pauseRequest.requestedBy} at ${utcStamp(run.pauseRequest.requestedAt)}`}
      >
        <p>The Run holds at its next Tool Action, before any further Target System work.</p>
      </Banner>
    );
  }
  return <></>;
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
