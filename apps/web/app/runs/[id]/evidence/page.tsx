import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  RecordReviewPage,
  RecordReviewResult,
  RecordReviewSelection,
  RecordReviewSelectionResult,
} from '@intellifin/application';
import { authorizeActionRole } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleFrozenExecutionReader,
  DrizzleRoleRepository,
  DrizzleRunDetailRepository,
  PostgresEvaluationReviewRepository,
  PostgresRecordReviewRepository,
  type RunEvaluationRow,
  type RunEvidenceItem,
  type RunObservationRow,
  type RunResultRow,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import {
  firstReviewOrdinal,
  normalizeRecordReviewNavigation,
  recordReviewHref,
  RecordReviewInspector,
  RecordReviewQueue,
  type RecordReviewNavigation,
  type SelectedEvaluationReviewRead,
} from '../../../../src/runs/RecordReview';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { recordNaming } from '../../../../src/runs/record-words';
import { currentIdentity, requireServerAction } from '../../../../src/server-session';

export const metadata: Metadata = { title: 'Run · Record review · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

type RequestSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function firstParam(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function selectionStatusCopy(status: Exclude<RecordReviewSelectionResult, RecordReviewSelection>['status']): string {
  switch (status) {
    case 'denied': return 'This record is not available to the current role.';
    case 'missing': return 'This source record is no longer available in the Run projection.';
    case 'invalid': return 'The selected source record link is invalid.';
    case 'expired': return 'The review list expired. Refresh the list to select a current record.';
    case 'unavailable': return 'Record review is unavailable because the Run projection is incomplete.';
    case 'too-large': return 'This Run exceeds the bounded record review limit.';
  }
}

function pageStatusCopy(status: Exclude<RecordReviewResult, RecordReviewPage>['status']): string {
  switch (status) {
    case 'denied': return 'The current role cannot open the record review queue.';
    case 'missing': return 'This Run is no longer available.';
    case 'invalid': return 'The review list link is invalid. Refresh the list to create a current snapshot.';
    case 'expired': return 'The review list expired. Refresh to create a new review snapshot.';
    case 'unavailable': return 'Record review is unavailable because the Run projection is incomplete.';
    case 'too-large': return 'This Run exceeds the bounded record review limit.';
  }
}

interface SelectedRecordDetail {
  readonly observations: readonly RunObservationRow[];
  readonly evaluations: readonly RunEvaluationRow[];
  readonly evidence: readonly RunEvidenceItem[];
  readonly evaluationReview: SelectedEvaluationReviewRead | null;
}

type SelectedRecordRead =
  | { readonly status: 'ready'; readonly selection: RecordReviewSelection; readonly detail: SelectedRecordDetail }
  | { readonly status: Exclude<RecordReviewSelectionResult, RecordReviewSelection>['status'] };

/**
 * The selected projection and its related rows share the repository's short repeatable
 * read. This keeps a changed Observation from being paired with an older selection row
 * while leaving commands and object bytes outside the transaction.
 */
async function readSelectedRecord(
  repository: PostgresRecordReviewRepository,
  input: { readonly runId: string; readonly actorId: string; readonly sourceOrdinal: number; readonly listedRevision: string },
  allowReview: boolean,
): Promise<SelectedRecordRead> {
  const result = await repository.readSelectionWithDetails(input, async (selection, tx): Promise<SelectedRecordDetail> => {
    const detail = new DrizzleRunDetailRepository(tx);
    const observationIds = selection.row.targets
      .map((target) => target.observationId)
      .filter((id): id is string => id !== null);
    const observations = await detail.readObservationsByIds(input.runId, observationIds);
    const evaluations = await detail.readEvaluations(input.runId, observationIds);
    const evidenceIds = [...new Set(observations.flatMap((observation) => observation.evidenceIds))];
    const evidence = await detail.readEvidenceItemsByIds(input.runId, evidenceIds);

    // The page gate is a presentation decision. Re-read the role inside the same
    // repeatable read as the selected evaluations before exposing review metadata.
    const reviewRole = await new DrizzleRoleRepository(tx).findRole(input.actorId);
    if (!allowReview || !authorizeActionRole(reviewRole, 'evaluation.confirm').allowed) {
      return { observations, evaluations, evidence, evaluationReview: null };
    }

    const [resultRow, reviewRevision, pending] = await Promise.all([
      detail.readResult(input.runId),
      detail.readReviewRevision(input.runId),
      detail.readPendingEvaluationCount(input.runId),
    ]);
    const observationIdsForCommands = [...new Set(evaluations.map((evaluation) => evaluation.observationId))];
    // Projection readers share the same transaction, including authorization and names.
    const reviewRepository = new PostgresEvaluationReviewRepository(
      tx,
    );
    const commandStatuses = await reviewRepository.readCommandStatuses(
      input.runId,
      reviewRevision,
      observationIdsForCommands,
    );
    const actorIds = [...new Set(evaluations
      .map((evaluation) => evaluation.reviewDecision?.actorId)
      .filter((id): id is string => typeof id === 'string'))];
    const names = actorIds.length === 0
      ? new Map<string, string>()
      : await new DrizzleActorNameReader(
        tx,
      ).namesFor(actorIds);
    const evaluationReview: SelectedEvaluationReviewRead = {
      result: resultRow === null ? null : { outcome: resultRow.outcome, sealed: resultRow.sealed, version: resultRow.version },
      evaluations,
      reviewRevision,
      pendingCount: resultRow === null || resultRow.publication === null ? null : pending,
      commandStatuses,
      reviewerNames: Object.fromEntries(names),
    };
    return { observations, evaluations, evidence, evaluationReview };
  });

  if (result.status !== 'ready') return result;
  return { status: 'ready', selection: result.selection, detail: result.detail };
}

function Unavailable({ title, message, runId, navigation }: {
  readonly title: string;
  readonly message: string;
  readonly runId: string;
  readonly navigation: RecordReviewNavigation;
}): React.JSX.Element {
  return (
    <section className="ls-card ls-stack" aria-labelledby="record-review-unavailable-heading">
      <h2 id="record-review-unavailable-heading">{title}</h2>
      <Banner tone="warning" title="Record review unavailable">
        <p>{message}</p>
        <p><Link href={recordReviewHref(runId, navigation, { cursor: null, selected: null })}>Refresh review list</Link></p>
      </Banner>
      <p><Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open technical artifacts</Link></p>
    </section>
  );
}

export default async function RunEvidencePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<RequestSearchParams>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') {
    return <RunDenied reason={identity.kind === 'anonymous' ? 'Sign in to continue.' : 'Identity is temporarily unavailable.'} />;
  }

  const search = await searchParams;
  const navigation = normalizeRecordReviewNavigation({
    filter: firstParam(search.filter),
    search: firstParam(search.search),
    pageSize: firstParam(search.pageSize),
    cursor: firstParam(search.cursor),
    selected: firstParam(search.selected),
  });
  const runtime = await getRuntime();
  const repository = new PostgresRecordReviewRepository(runtime.db);
  // How a record is named and what the frozen binding masks (UX-25, FR-41): read from
  // the version this Run executed, never from the binding as it stands today.
  const naming = recordNaming(await new DrizzleFrozenExecutionReader(runtime.db).readFrozenExecution(run.versionId, run.procedureId));
  const pageResult = await repository.readPage({
    runId: run.runId,
    actorId: identity.session.userId,
    filter: navigation.filter,
    search: navigation.search,
    pageSize: navigation.pageSize,
    ...(navigation.cursor === null ? {} : { cursor: navigation.cursor }),
  });
  if (pageResult.status !== 'ready') {
    return (
      <RunDetailFrame run={run} tab="evidence" readAt={readAt} compact>
        <Unavailable
          title="Record review queue"
          message={pageStatusCopy(pageResult.status)}
          runId={run.runId}
          navigation={navigation}
        />
      </RunDetailFrame>
    );
  }

  // A cursor is the immutable list snapshot identity. Canonicalizing it into the URL
  // after the first read lets ordinary refreshes and Run chrome navigation reuse this
  // snapshot instead of silently creating another one.
  if (navigation.cursor === null) {
    redirect(recordReviewHref(run.runId, navigation, { cursor: pageResult.cursor }));
  }
  const listNavigation: RecordReviewNavigation = { ...navigation, cursor: pageResult.cursor };

  // A reader who arrives without choosing a record meets the first finding rather than an
  // empty inspector (UX-22). Their links still carry only what THEY chose, so paging or
  // filtering does not pin this default into the URL.
  const selectedOrdinal = navigation.selected ?? firstReviewOrdinal(pageResult.rows);
  let selected: SelectedRecordRead | null = null;
  if (selectedOrdinal !== null) {
    const reviewDecision = await requireServerAction('evaluation.confirm');
    selected = await readSelectedRecord(
      repository,
      {
        runId: run.runId,
        actorId: identity.session.userId,
        sourceOrdinal: selectedOrdinal,
        listedRevision: pageResult.revision,
      },
      reviewDecision.allowed,
    );
  }

  return (
    <RunDetailFrame run={run} tab="evidence" readAt={readAt} compact>
      <div className="record-review__layout">
        <RecordReviewQueue runId={run.runId} page={pageResult} navigation={listNavigation} naming={naming} selectedOrdinal={selectedOrdinal} />
        <RecordReviewInspector
          runId={run.runId}
          selection={selected?.status === 'ready' ? selected.selection : null}
          selectionStatus={selected === null || selected.status === 'ready' ? null : selectionStatusCopy(selected.status)}
          observations={selected?.status === 'ready' ? selected.detail.observations : []}
          evaluations={selected?.status === 'ready' ? selected.detail.evaluations : []}
          evidence={selected?.status === 'ready' ? selected.detail.evidence : []}
          evaluationReview={selected?.status === 'ready' ? selected.detail.evaluationReview : null}
          navigation={listNavigation}
          page={pageResult}
          naming={naming}
        />
      </div>
    </RunDetailFrame>
  );
}
