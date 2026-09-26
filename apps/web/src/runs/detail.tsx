import Link from 'next/link';
import { notFound } from 'next/navigation';

import { runPauseTransition, isActiveRunState, type RunRecord } from '@intellifin/domain';
import type { EvaluationReviewCommandStatus, RunWait } from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleActorNameReader,
  DrizzleRunDetailRepository,
  DrizzleRunRepository,
  DrizzleRunStopReader,
  PostgresEvaluationReviewRepository,
  type RunEvaluationRow,
  type RunResultRow,
  readTimelineHead,
} from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';
import { Banner } from '../design/Banner';
import { PageHeader } from '../design/PageHeader';
import { StatusBadge } from '../design/StatusBadge';
import { Tabs } from '../design/Tabs';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { executionMeaning } from '../design/status-words';
import { readablePeriod, readableStamp } from '../design/time';
import { WatchControl } from './WatchControl';
import { ESCALATION_PANEL_COPY, PAUSE_COPY, STALE_DATA_ACTION, fillTemplate, runCanceledBy, updatedAtTitle } from '../design/copy';
import { DetailTrail } from '../procedures/DetailTrail';
import { requireServerAction } from '../server-session';
import { EscalationOutcomeHost } from './EscalationOutcome';
import { EscalationPanel, type EscalationWorkspacePresentation } from './EscalationPanel';
import { readOpenEscalation, type OpenEscalationRead } from './escalation-read';
import { SurfaceLiveBanner } from './SurfaceLiveBanner';
import { RunLifecycleActions } from './RunLifecycleActions';
import { WaitCountdown } from './WaitCountdown';
import { periodText, runLifecycleWord, utcStamp } from './labels';
import { ActorName } from './ActorName';
import { StopReasonBanner } from './StopReason';
import { isStoppedState } from './stop-reason';

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
  /**
   * The population record each reviewed Observation is about, keyed by Observation id, so a
   * review row is headed by the record a reader recognises rather than a UUID (UX-21).
   */
  readonly recordKeys: Readonly<Record<string, string>>;
  /**
   * The reviewer of each stored decision, by name: a decision says who made it in words,
   * and the user id is under the row's Technical details (UX-02), as the record inspector
   * already does.
   */
  readonly reviewerNames: Readonly<Record<string, string>>;
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
  const reviewerIds = [...new Set(evaluations
    .map((evaluation) => evaluation.reviewDecision?.actorId)
    .filter((id): id is string => typeof id === 'string'))];
  const reviewerNames = reviewerIds.length === 0
    ? new Map<string, string>()
    : await new DrizzleActorNameReader(runtime.db).namesFor(reviewerIds);
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
    recordKeys: Object.fromEntries(observations.rows.map((row) => [row.observationId, row.populationRecordKey])),
    reviewerNames: Object.fromEntries(reviewerNames),
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
  // One line, in readable UTC to the minute (UI cleanup 2026-09-21, UX-02, UX-23): the
  // contract's sentence is unchanged; what changed is that `{time}` is no longer a
  // machine spelling and the strip no longer costs a card of every viewport.
  return (
    <Banner tone="info" variant="line" title={updatedAtTitle(readableStamp(readAt, 'minute'))}>
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
  compact = false,
}: {
  readonly run: RunRecord;
  readonly tab: RunTabSlug;
  readonly readAt: Date;
  readonly children: React.ReactNode;
  /** Compact chrome for bounded record-review pages; ordinary Run Detail stays unchanged. */
  readonly compact?: boolean;
}): Promise<React.JSX.Element> {
  // Read for both wait kinds: an Escalation holds the Run in `AWAITING_AUDITOR` and a
  // pause holds it in `PAUSED`, and the same one read answers which — and, for a pause,
  // supplies the revision the Resume control compare-and-sets against.
  const escalation = run.state === 'AWAITING_AUDITOR' || run.state === 'PAUSED'
    ? await readOpenEscalation(run.runId)
    : null;
  const lifecycle = runLifecycleWord(run.state);
  const conversationEnabled = (await getRuntime()).conversationEnabled;
  const here = runTabHref(run.runId, tab);
  // The live channel subscribes only while the Run is active (UX-DR35): the cursor is
  // the chain head the page was read at, so the stream replays exactly what commits
  // after this render and nothing before it. A terminal Run keeps the plain banner.
  const liveCursor = isActiveRunState(run.state)
    ? await readTimelineHead((await getRuntime()).db, run.runId)
    : null;
  // A user id printed at a reader is the platform speaking its own language, and the
  // pause and cancellation banners are the surfaces whose job is to name the person
  // accountable.
  const names = await new DrizzleActorNameReader((await getRuntime()).db).namesFor([
    ...(escalation?.pause?.openedBy === undefined || escalation.pause.openedBy === null ? [] : [escalation.pause.openedBy]),
    ...(run.pauseRequest === null ? [] : [run.pauseRequest.requestedBy]),
    ...(run.cancellation === null ? [] : [run.cancellation.requestedBy]),
  ]);
  // Why a stopped Run stopped, on EVERY tab (owner correction 2026-09-15). The reason a
  // Run ended before its Gate was recorded by the stage that ended it and shown only on
  // the Timeline tab, as a code word; the header said "Inconclusive" and nothing else.
  const stop = isStoppedState(run.state)
    ? await new DrizzleRunStopReader((await getRuntime()).db).readStop(run.runId)
    : null;
  const lifecycleActions = (
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
  );
  // The trail names the Procedure, never the Run's UUID (UI cleanup 2026-09-21, UX-02):
  // a person follows `Runs / Leaver access review / Evidence`, and the identifier is one
  // row under Technical details.
  const trail = [
    { href: '/runs', label: 'Runs' },
    { href: runTabHref(run.runId, ''), label: run.procedureName },
    ...(tab === '' ? [] : [{ href: here, label: runTabLabel(tab) }]),
  ];
  return (
    <div className={compact ? 'ls-stack run-detail-frame run-detail-frame--compact' : 'ls-stack'}>
      <DetailTrail trail={trail} />
      {/* One row for the title and its state, one meta line, and the controls that belong
          to the whole Run on the title's right (UI cleanup 2026-09-21, UX-23, UX-48). The
          walkthrough measured this header at nearly half a laptop viewport. A state
          outside the vocabulary is still written in words: `StatusBadge` throws on an
          unknown state, and on a page that is a 500 for the whole Run. Watch — the rail's
          Session control — and the Auditor Workspace are reached from here: neither is a
          tab. */}
      <PageHeader
        title={<>Run · {run.procedureName}</>}
        badge={lifecycle === null ? <span>Run lifecycle: {run.state}</span> : <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />}
        actions={
          <>
            <WatchControl runId={run.runId} state={run.state} active={isActiveRunState(run.state)} />
            {conversationEnabled && <Link href={`/runs/${run.runId}/workspace`}>Open Auditor Workspace</Link>}
          </>
        }
        meta={
          <>
            <Link href={`/procedures/${run.procedureId}`}>{run.procedureName}</Link> ·{' '}
            <Link href={`/procedures/${run.procedureId}/versions/${run.versionId}`}>v{run.versionNumber}</Link> ·{' '}
            {run.kind === 'STANDARD' ? 'Standard' : 'Regression'} Run · Period {readablePeriod(run.period)} · Started{' '}
            <Timestamp value={run.initiatedAt} precision="minute" />
            {lifecycle === null ? null : <> · {executionMeaning(lifecycle)}</>}
          </>
        }
      />
      {liveCursor === null
        ? <RefreshBanner readAt={readAt} href={here} />
        : <SurfaceLiveBanner url={`/api/runs/${run.runId}/events`} cursor={liveCursor} readAt={readAt.toISOString()} href={here} />}
      <Tabs label="Run Detail" tabs={RUN_TABS.map((entry) => ({ href: runTabHref(run.runId, entry.slug), label: entry.label }))} current={here} />
      {stop === null ? null : <StopReasonBanner facts={stop} />}
      <CancellationBanners run={run} names={names} />
      <PauseBanners run={run} pause={escalation?.pause ?? null} readAt={readAt} names={names} />
      <RerunLinks runId={run.runId} />
      {/* Compact record review keeps its queue in the first viewport, so the Run's actions
          sit behind one disclosure there; ordinary Run Detail shows them as they were. */}
      {compact ? (
        <details className="run-detail-frame__lifecycle">
          <summary>Run actions</summary>
          {lifecycleActions}
        </details>
      ) : lifecycleActions}
      {/* The Run's identifiers, once, on every tab. The person who started the Run is named
          in words on the page; their user id is here, because it is what an auditor
          matches against the audit chain. */}
      <TechnicalDetails
        items={[
          { label: 'Run identifier', value: run.runId, mono: true },
          { label: 'Correlation identifier', value: run.correlationId, mono: true },
          { label: 'Procedure Version identifier', value: run.versionId, mono: true },
          { label: 'Effective period', value: periodText(run.period), mono: true },
          { label: 'Started', value: utcStamp(run.initiatedAt), mono: true },
          { label: 'Started by (user identifier)', value: run.initiatorId, mono: true },
          { label: 'Read at', value: utcStamp(readAt), mono: true },
        ]}
      />
      {compact
        ? <CompactOpenEscalationDisclosure run={run} workspaceAvailable={conversationEnabled} />
        : <OpenEscalationSection run={run} escalation={escalation} readAt={readAt} />}
      {/* The pending confirmations are NOT here (UI cleanup 2026-09-22, UX-19). They were
          rendered by the frame, above `children`, so three historical AI assessments
          preceded the conclusion on every Result tab and the completed Result page stood
          7,132px tall. They belong under the triptych, on the Result page, where "what
          needs the reader now" sits — and where a sealed Result can collapse them into a
          review history instead of leading with them. The record inspector reads its own
          selected record's review. */}
      {children}
    </div>
  );
}

/**
 * Record review keeps its queue in the first viewport. An open decision is still disclosed,
 * but the full answer panel belongs to Auditor Workspace where its question, source context
 * and guarded controls have room to remain together.
 */
function CompactOpenEscalationDisclosure({ run, workspaceAvailable }: {
  readonly run: RunRecord;
  readonly workspaceAvailable: boolean;
}): React.JSX.Element | null {
  if (run.state !== 'AWAITING_AUDITOR') return null;
  const href = workspaceAvailable
    ? `/runs/${run.runId}/workspace`
    : `${runTabHref(run.runId, '')}#open-escalation`;
  const label = workspaceAvailable
    ? 'Open Auditor Workspace to review the decision'
    : 'Open Run detail to review the decision';
  return (
    <details className="run-detail-frame__lifecycle">
      <summary>Open auditor decision</summary>
      <p>This Run is waiting for an auditor answer.</p>
      <p><Link href={href}>{label}</Link></p>
    </details>
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
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(successors.map((successor) => successor.initiatorId));
  return <RerunLinksBanner successors={successors} names={names} />;
}

/** The rerun banner's markup, with the person who started each successor NAMED. */
export function RerunLinksBanner({ successors, names }: {
  readonly successors: readonly Pick<RunRecord, 'runId' | 'initiatedAt' | 'initiatorId'>[];
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <Banner tone="info" title={successors.length === 1 ? 'This Run has been rerun.' : 'This Run has been rerun more than once.'}>
      <ul>
        {successors.map((successor) => (
          <li key={successor.runId}>
            <Link className="ls-mono" href={runTabHref(successor.runId, '')}>
              {successor.runId}
            </Link>{' '}
            · started <Timestamp value={successor.initiatedAt} /> by <ActorName id={successor.initiatorId} names={names} />
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
 *
 * The outcome host is rendered in EVERY state, and that is what keeps an answer's
 * confirmation on the page: the refresh after an answer leaves no question open, so the
 * panel goes, and a confirmation inside it went with it within about 300 ms. The host sits
 * in the same place either way, so its state survives the refresh.
 */
export function OpenEscalationSection({ run, escalation, readAt, workspacePresentation }: {
  readonly run: RunRecord;
  readonly escalation: OpenEscalationRead | null;
  readonly readAt: Date;
  readonly workspacePresentation?: EscalationWorkspacePresentation;
}): React.JSX.Element {
  const open = run.state === 'AWAITING_AUDITOR' ? escalation : null;
  return (
    <EscalationOutcomeHost openWaitId={open?.wait?.waitId ?? null}>
      {open === null
        ? null
        : open.wait !== null && open.runRevision !== null
          ? <EscalationPanel
              runId={run.runId}
              wait={open.wait}
              details={open.details}
              runRevision={open.runRevision}
              readAt={readAt.toISOString()}
              {...(workspacePresentation === undefined ? {} : { workspacePresentation })}
            />
          : <Banner tone="danger" title={ESCALATION_PANEL_COPY.unavailable} />}
    </EscalationOutcomeHost>
  );
}

/**
 * What a pause says, on whichever surface the reader is on.
 *
 * The branch table is the rule, and it is `OpenEscalationSection`'s above: the full banner
 * when the wait reads, a DANGER banner when it does not, and nothing at all in a state that
 * holds no pause.
 *
 * **A `PAUSED` Run whose wait cannot be read is never rendered as an absence.** `PAUSED`
 * means the Run is being HELD and will end Inconclusive when its deadline passes; a surface
 * that renders nothing tells the reader it is simply busy. That read fails for ordinary
 * reasons — `readOpenEscalation` returns every field `null` when the role check refuses, and
 * `pause` is `null` whenever the row is missing, already closed, or not of kind `pause` —
 * so this is a state a reader reaches, not a theoretical one.
 *
 * The second arm is the marker, which means "requested and NOT yet honoured": the boundary
 * that honours a pause clears it, so it cannot overlap the first arm.
 */
export function PauseBanners({ run, pause, readAt, names }: {
  readonly run: RunRecord;
  readonly pause: RunWait | null;
  /** The instant the server read, so the countdown's first client render matches it. */
  readonly readAt: Date;
  /**
   * User id to person's name, from `ActorNameReader`.
   *
   * `run_wait.opened_by` and `pause_requested_by` are user IDS -- an address cannot enter
   * the chain, so the row holds an id. EXPERIENCE.md's sentence is "Paused by Daniel
   * Okonjo at {time}", and this banner printed the UUID: the platform speaking its own
   * language on the one surface whose job is to name the person accountable. An id with no
   * row comes back absent and the id is shown, which is honest about what is known.
   */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  if (run.state === 'PAUSED') {
    if (pause === null || pause.openedBy === null) {
      return <Banner tone="danger" title={PAUSE_COPY.unreadable} />;
    }
    return (
      <Banner
        tone="warning"
        title={fillTemplate(PAUSE_COPY.banner, {
          actor: names.get(pause.openedBy) ?? pause.openedBy,
          time: readableStamp(pause.openedAt),
          ends: readableStamp(pause.deadline),
        })}
      >
        {/* EXPERIENCE.md asks for a COUNTDOWN here, in three places (lines 115, 149 and
            292), and this banner printed two absolute timestamps. "Ends Inconclusive at
            09:30:00Z" makes a reader do the arithmetic that decides whether they still
            have time to act; the Escalation sibling has always shown the clock instead. */}
        <WaitCountdown
          deadline={pause.deadline}
          readAt={readAt.toISOString()}
          expiredSentence={PAUSE_COPY.expired}
        />
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
        title={`Pause requested by ${names.get(run.pauseRequest.requestedBy) ?? run.pauseRequest.requestedBy} at ${readableStamp(run.pauseRequest.requestedAt)}`}
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
export function CancellationBanners({ run, names }: {
  readonly run: RunRecord;
  /** User id to person's name. The marker holds an id; the sentence names a person. */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  if (run.cancellation === null) return <></>;
  const actor = names.get(run.cancellation.requestedBy) ?? run.cancellation.requestedBy;
  if (run.state === 'CANCELED') {
    return (
      <Banner
        tone="warning"
        title={runCanceledBy(actor, readableStamp(run.cancellation.requestedAt))}
      >
        <p>{run.cancellation.reason}</p>
        <p>Evidence already collected is preserved. No conclusion was issued.</p>
      </Banner>
    );
  }
  return (
    <Banner
      tone="warning"
      title={`Cancellation requested by ${actor} at ${readableStamp(run.cancellation.requestedAt)}`}
    >
      {isActiveRunState(run.state) ? (
        <p>The Run stops at its next checkpoint, before any further Target System work.</p>
      ) : (
        <p>The Run ended before the cancellation was performed, so its own outcome stands.</p>
      )}
    </Banner>
  );
}
