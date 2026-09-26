import { HumanMatch } from './HumanMatch';
import Link from 'next/link';

import type { JsonValue } from '@intellifin/domain';
import {
  RECORD_REVIEW_FILTERS,
  type EvaluationReviewCommandStatus,
  type RecordReviewCounts,
  type RecordReviewFilter,
  type RecordReviewPage,
  type RecordReviewRow,
  type RecordReviewSelection,
  type RecordReviewTarget,
} from '@intellifin/application';
import type {
  RunEvaluationRow,
  RunEvidenceItem,
  RunObservationRow,
  RunResultRow,
} from '@intellifin/infrastructure';

import { Banner } from '../design/Banner';
import { CAPTURE_TIME_UNRECORDED, MASKED_BY_BINDING, MASKED_VALUE } from '../design/copy';
import { Digest } from '../design/Digest';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { countNoun } from '../design/words';
import { EvaluationReview } from './EvaluationReview';
import { RecordLabel } from './RecordLabel';
import { UntrustedList, UntrustedPolicy, UntrustedText } from './UntrustedText';
import {
  evaluationOriginWord,
  evaluationValueWord,
  foundWord,
  observationCheckOutcomeWord,
  observationCheckWord,
} from './labels';
import { NO_RECORD_NAMING, recordLabelParts, type RecordNaming } from './record-words';

import './RecordReview.css';

export const RECORD_REVIEW_PAGE_SIZES = [25, 50] as const;
export type RecordReviewPageSize = (typeof RECORD_REVIEW_PAGE_SIZES)[number];

export const RECORD_REVIEW_FILTER_LABELS: Readonly<Record<RecordReviewFilter, string>> = {
  all: 'All records',
  exceptions: 'Exceptions',
  'needs-review': 'Needs review',
  'evidence-problems': 'Evidence problems',
  'not-inspected': 'Not inspected',
};

export interface RecordReviewNavigation {
  readonly filter: RecordReviewFilter;
  readonly search: string;
  readonly pageSize: RecordReviewPageSize;
  readonly cursor: string | null;
  readonly selected: number | null;
}

export type RecordReviewNavigationUpdate = Partial<
  Omit<RecordReviewNavigation, 'cursor' | 'selected'>
> & {
  readonly cursor?: string | null;
  readonly selected?: number | null;
};

/** Build a queue link while carrying the reader's current list context. */
export function recordReviewHref(
  runId: string,
  navigation: RecordReviewNavigation,
  update: RecordReviewNavigationUpdate = {},
): string {
  const next: RecordReviewNavigation = {
    filter: update.filter ?? navigation.filter,
    search: update.search ?? navigation.search,
    pageSize: update.pageSize ?? navigation.pageSize,
    cursor: update.cursor === undefined ? navigation.cursor : update.cursor,
    selected: update.selected === undefined ? navigation.selected : update.selected,
  };
  const query = new URLSearchParams();
  if (next.filter !== 'all') query.set('filter', next.filter);
  if (next.search !== '') query.set('search', next.search);
  if (next.pageSize !== 25) query.set('pageSize', String(next.pageSize));
  if (next.cursor !== null && next.cursor !== '') query.set('cursor', next.cursor);
  if (next.selected !== null) query.set('selected', String(next.selected));
  const encodedRunId = encodeURIComponent(runId);
  const suffix = query.toString();
  return `/runs/${encodedRunId}/evidence${suffix === '' ? '' : `?${suffix}`}`;
}

/** The navigation state used by a server render, with invalid request values normalized. */
export function normalizeRecordReviewNavigation(input: {
  readonly filter?: string;
  readonly search?: string;
  readonly pageSize?: string;
  readonly cursor?: string;
  readonly selected?: string;
}): RecordReviewNavigation {
  const filter = input.filter !== undefined && (RECORD_REVIEW_FILTERS as readonly string[]).includes(input.filter)
    ? input.filter as RecordReviewFilter
    : 'all';
  const pageSize: RecordReviewPageSize = input.pageSize === '50' ? 50 : 25;
  const selectedNumber = input.selected === undefined ? Number.NaN : Number(input.selected);
  return {
    filter,
    search: (input.search ?? '').trim().slice(0, 120),
    pageSize,
    cursor: input.cursor !== undefined && input.cursor.trim() !== '' ? input.cursor : null,
    selected: Number.isSafeInteger(selectedNumber) && selectedNumber > 0 ? selectedNumber : null,
  };
}

/**
 * The record a reader meets when they arrive without choosing one (UX-22): the first
 * Exception, else the first record waiting on a person, else the first record. A blank
 * inspector on arrival spent half the first screen saying "select a record".
 */
export function firstReviewOrdinal(rows: readonly RecordReviewRow[]): number | null {
  const pick = rows.find((row) => row.targets.some((target) => target.exception))
    ?? rows.find((row) => row.targets.some((target) => target.pendingAssessments > 0))
    ?? rows[0];
  return pick === undefined ? null : pick.sourceOrdinal;
}

function countText(value: number | null): string {
  return value === null ? 'Unavailable' : Number.isFinite(value) ? value.toLocaleString('en-US') : String(value);
}

function sourceQualityWord(value: RecordReviewCounts['sourceQuality']): string {
  switch (value) {
    case 'verified': return 'Every source check passed';
    case 'problems': return 'A source check failed';
    case 'unknown': return 'Not known';
  }
}

function targetStateWord(state: RecordReviewTarget['assessmentState']): string {
  switch (state) {
    case 'exception': return 'Exception';
    case 'needs-review': return 'Needs review';
    case 'unevaluated': return 'Unevaluated';
    case 'compliant': return 'Compliant';
    case 'not-inspected': return 'Not inspected';
    case 'excluded': return 'Excluded';
  }
}

function targetStateClass(state: RecordReviewTarget['assessmentState']): string {
  switch (state) {
    case 'exception': return 'record-review__state--danger';
    case 'needs-review': return 'record-review__state--info';
    case 'unevaluated':
    case 'not-inspected': return 'record-review__state--warning';
    case 'compliant': return 'record-review__state--success';
    case 'excluded': return 'record-review__state--neutral';
  }
}

/** One word for the whole row, the most urgent of its targets' states. */
function rowAssessment(targets: readonly RecordReviewTarget[]): { readonly word: string; readonly className: string } {
  if (targets.length === 0) return { word: 'Not recorded', className: 'record-review__state--neutral' };
  if (targets.some((target) => target.assessmentState === 'exception' || target.exception)) {
    return { word: 'Exception', className: targetStateClass('exception') };
  }
  if (targets.some((target) => target.assessmentState === 'needs-review' || target.pendingAssessments > 0)) {
    return { word: 'Needs review', className: targetStateClass('needs-review') };
  }
  if (targets.some((target) => target.assessmentState === 'unevaluated')) {
    return { word: 'Unevaluated', className: targetStateClass('unevaluated') };
  }
  if (targets.some((target) => target.assessmentState === 'not-inspected')) {
    return { word: 'Not inspected', className: targetStateClass('not-inspected') };
  }
  if (targets.every((target) => target.assessmentState === 'compliant')) {
    return { word: 'Compliant', className: targetStateClass('compliant') };
  }
  if (targets.every((target) => target.assessmentState === 'excluded')) {
    return { word: 'Excluded', className: targetStateClass('excluded') };
  }
  const first = targets[0]!.assessmentState;
  return { word: targetStateWord(first), className: targetStateClass(first) };
}

/**
 * Which evidence checks this record passed, as one phrase (UX-26). "No problem recorded"
 * could not be told apart from a record nothing ever checked: a record's checks are
 * complete only when its every target was inspected, which the projection decides from
 * the stored per-Observation checks.
 */
function rowChecksWord(targets: readonly RecordReviewTarget[]): string {
  if (targets.length === 0) return 'Not checked';
  if (targets.some((target) => target.evidenceProblem)) return 'A check failed';
  if (targets.every((target) => target.inspected)) return 'All checks passed';
  return 'Not checked yet';
}

function rowSubjectText(targets: readonly RecordReviewTarget[]): string {
  const subjects = [...new Set(targets.map((target) => target.account).filter((value): value is string => value !== null && value.trim() !== ''))];
  return subjects.length === 0 ? 'Not recorded' : subjects.length === 1 ? subjects[0]! : `${subjects.length} accounts recorded`;
}

function rowCapturedStatusText(targets: readonly RecordReviewTarget[]): string {
  const statuses = [...new Set(targets.map((target) => target.capturedStatus).filter((value): value is string => value !== null && value.trim() !== ''))];
  return statuses.length === 0 ? 'Not recorded' : statuses.length === 1 ? statuses[0]! : `${statuses.length} statuses recorded`;
}

function sourceText(value: string | null): string {
  return value === null || value.trim() === '' ? 'Not recorded' : value;
}

function targetFound(value: string | null): string {
  if (value === null) return 'Not recorded';
  return foundWord(value) ?? value;
}

function dispositionWord(disposition: string): string {
  switch (disposition) {
    case 'included': return 'In the tested population';
    case 'excluded': return 'Excluded from the test';
    case 'indeterminate': return 'Could not be placed in the period';
    default: return disposition;
  }
}

function conditionById(selection: RecordReviewSelection): ReadonlyMap<string, string> {
  return new Map(selection.conditions.map((condition) => [condition.conditionId, condition.text]));
}

function jsonValueText(value: JsonValue): string {
  if (value === null) return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return 'Value could not be displayed.';
  }
}

function fieldWords(name: string): string {
  return name.replaceAll('_', ' ');
}

function evidenceKindWord(kind: string): string {
  switch (kind) {
    case 'screenshot': return 'Screenshot';
    case 'structural-snapshot': return 'Saved page data';
    case 'population': return 'Population source';
    case 'reference-source': return 'Reference source';
    case 'adapter-extraction': return 'System extract';
    default: return 'Saved evidence';
  }
}

/**
 * The digest check this platform ran, and when (UX-26). A REGISTERED artifact was read
 * back from storage when it was saved and matched the digest recorded for it — that is
 * what registration means. Anything else was never verified, and says so rather than
 * "Fingerprint recorded", which described a column, not a check.
 */
function digestCheckWord(item: RunEvidenceItem): string {
  return item.state === 'REGISTERED' && item.digest !== null
    ? 'Matched when the file was saved'
    : 'Not verified yet';
}

function evidenceOpenHref(runId: string, item: RunEvidenceItem): string | null {
  if (item.kind === 'screenshot') {
    return `/api/runs/${encodeURIComponent(runId)}/frames/${encodeURIComponent(item.evidenceId)}`;
  }
  return null;
}

function evidenceGroundingHref(runId: string, item: RunEvidenceItem, observations: readonly RunObservationRow[]): string | null {
  for (const observation of observations) {
    const attributes = observation.identity === null ? observation.attributes : [observation.identity, ...observation.attributes];
    for (const attribute of attributes) {
      if (attribute.grounding?.evidenceId === item.evidenceId) {
        return `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(item.evidenceId)}?locator=${encodeURIComponent(attribute.grounding.locator)}`;
      }
    }
  }
  return null;
}

/** The queue's counts, in one line of words (UX-22). */
export function reviewCountsSummary(counts: RecordReviewCounts): string {
  const exceptions = counts.exceptionRecords === null
    ? 'exceptions not yet known'
    : `${countNoun(counts.exceptionRecords, 'record')} with an exception`;
  return [
    countNoun(counts.includedRows, 'included record'),
    exceptions,
    `${countNoun(counts.pendingAssessments, 'assessment')} waiting for review`,
    `${counts.fullyInspectedSubjects.toLocaleString('en-US')} of ${counts.includedRows.toLocaleString('en-US')} fully inspected`,
  ].join(' · ');
}

export interface RecordReviewQueueProps {
  readonly runId: string;
  readonly page: RecordReviewPage;
  readonly navigation: RecordReviewNavigation;
  /** How this Run names a record and what its frozen binding masks (UX-25, FR-41). */
  readonly naming?: RecordNaming;
  /** The record the inspector shows when the reader arrived without choosing one. */
  readonly selectedOrdinal?: number | null;
}

/**
 * The bounded, server-rendered queue. Links carry the list context explicitly, so a
 * focused record never silently changes the filter or page the reader was reviewing.
 *
 * It opens on RECORDS (UX-22): the counts on one line, the filters under it, then the
 * list. The source and coverage figures that used to fill the first screen are behind one
 * closed disclosure; a failed check is never hidden there — each has its own banner.
 */
export function RecordReviewQueue({
  runId,
  page,
  navigation,
  naming = NO_RECORD_NAMING,
  selectedOrdinal,
}: RecordReviewQueueProps): React.JSX.Element {
  const refreshHref = recordReviewHref(runId, navigation, { cursor: null });
  const firstHref = recordReviewHref(runId, navigation, { cursor: null });
  const nextHref = page.nextCursor === null ? null : recordReviewHref(runId, navigation, { cursor: page.nextCursor });
  const previousHref = page.previousCursor === null ? null : recordReviewHref(runId, navigation, { cursor: page.previousCursor });
  const selected = selectedOrdinal === undefined ? navigation.selected : selectedOrdinal;

  return (
    <section className="record-review__queue ls-card" aria-labelledby="record-review-queue-heading">
      <div className="record-review__queue-heading">
        <h2 id="record-review-queue-heading">Records and findings</h2>
        <span className="record-review__count">{countText(page.filteredRows)} shown</span>
      </div>
      <p className="record-review__summary">{reviewCountsSummary(page.counts)}</p>

      {page.changesAvailable ? (
        <Banner tone="info" title="Changes available">
          <p>The Run has made progress since this list was read. <Link href={refreshHref}>Refresh</Link></p>
        </Banner>
      ) : null}

      <form className="record-review__filters" method="post" action={`/api/runs/${encodeURIComponent(runId)}/record-review-navigation`}>
        <div className="record-review__filter-field">
          <label htmlFor="record-review-search">Search records</label>
          <input
            id="record-review-search"
            name="search"
            type="search"
            defaultValue={navigation.search}
            maxLength={120}
            placeholder="Record or account"
          />
        </div>
        <div className="record-review__filter-field">
          <label htmlFor="record-review-filter">Filter</label>
          <select id="record-review-filter" name="filter" defaultValue={navigation.filter}>
            {RECORD_REVIEW_FILTERS.map((filter) => (
              <option key={filter} value={filter}>{RECORD_REVIEW_FILTER_LABELS[filter]}</option>
            ))}
          </select>
        </div>
        <div className="record-review__filter-field">
          <label htmlFor="record-review-page-size">Rows per page</label>
          <select id="record-review-page-size" name="pageSize" defaultValue={String(navigation.pageSize)}>
            {RECORD_REVIEW_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </div>
        <button type="submit" className="ls-button ls-button--secondary ls-button--sm">Apply</button>
      </form>

      {page.counts.sourceQuality === 'problems' ? (
        <Banner tone="warning" title="A population source check failed">
          <p>The counts and records below are still shown, so you can see which records it affects.</p>
        </Banner>
      ) : null}
      {page.counts.runEvidenceProblems > 0 ? (
        <Banner tone="warning" title="Evidence integrity problem">
          <p>{countNoun(page.counts.runEvidenceProblems, 'saved file')} did not match {page.counts.runEvidenceProblems === 1 ? 'its' : 'their'} recorded digest when this list was read. <Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open the saved evidence</Link></p>
        </Banner>
      ) : null}
      {page.currentEvidenceProblems > 0 ? (
        <Banner tone="danger" title="Evidence integrity problem now">
          <p>{countNoun(page.currentEvidenceProblems, 'saved file')} {page.currentEvidenceProblems === 1 ? 'does' : 'do'} not match {page.currentEvidenceProblems === 1 ? 'its' : 'their'} recorded digest. The sealed outcome is unchanged; check the file before you rely on it. <Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open the saved evidence</Link></p>
        </Banner>
      ) : null}
      {page.counts.unattributedObservations > 0 ? (
        <Banner tone="warning" title="Some findings are not linked to a record">
          <p>{countNoun(page.counts.unattributedObservations, 'recorded Observation')} could not be linked to exactly one source record, so the number of records with an exception is not known yet. <Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open the saved evidence</Link></p>
        </Banner>
      ) : null}

      <details className="ls-disclosure record-review__population">
        <summary>Source and coverage details</summary>
        <div className="ls-disclosure__body ls-stack">
          <p className="ls-caption">Filtering changes this view only. It does not change the approved population.</p>
          <dl className="record-review__metrics">
            <div><dt>Source checks</dt><dd>{sourceQualityWord(page.counts.sourceQuality)}</dd></div>
            <div><dt>Declared source count</dt><dd>{countText(page.counts.sourceDeclaredCount)}</dd></div>
            <div><dt>Source generated</dt><dd>{page.counts.sourceGeneratedAt === null ? 'Time not recorded' : <Timestamp value={page.counts.sourceGeneratedAt} />}</dd></div>
            <div><dt>Source rows</dt><dd>{countText(page.counts.sourceRows)}</dd></div>
            <div><dt>Included</dt><dd>{countText(page.counts.includedRows)}</dd></div>
            <div><dt>Excluded</dt><dd>{countText(page.counts.excludedRows)}</dd></div>
            <div><dt>Could not be placed</dt><dd>{countText(page.counts.indeterminateRows)}</dd></div>
            <div><dt>Fully inspected records</dt><dd>{countText(page.counts.fullyInspectedSubjects)}</dd></div>
            <div><dt>Inspections done</dt><dd>{countText(page.counts.inspectedUnits)} of {countText(page.counts.requiredUnits)}</dd></div>
            <div><dt>Records with exceptions</dt><dd>{countText(page.counts.exceptionRecords)}</dd></div>
            <div><dt>Findings not linked to a record</dt><dd>{countText(page.counts.unattributedObservations)}</dd></div>
            <div><dt>Assessments waiting for review</dt><dd>{countText(page.counts.pendingAssessments)}</dd></div>
            <div><dt>Records with evidence problems</dt><dd>{countText(page.counts.evidenceProblemRecords)}</dd></div>
            <div><dt>Integrity problems when read</dt><dd>{countText(page.counts.runEvidenceProblems)}</dd></div>
          </dl>
          <p className="ls-caption">
            {countText(page.filteredRows)} records match this view · Page {page.pageNumber} · List read{' '}
            <Timestamp value={page.asOf} />. Paging works until <Timestamp value={page.expiresAt} />.
          </p>
        </div>
      </details>

      {page.rows.length === 0 ? (
        <p className="record-review__empty">No records match this filter. The approved population counts remain unchanged.</p>
      ) : (
        <ol className="record-review__rows" aria-label="Record review queue">
          {page.rows.map((row) => (
            <RecordReviewQueueRow
              key={row.sourceOrdinal}
              runId={runId}
              row={row}
              navigation={navigation}
              naming={naming}
              selected={selected === row.sourceOrdinal}
            />
          ))}
        </ol>
      )}

      <nav className="record-review__pagination" aria-label="Record review pages">
        {previousHref === null ? null : <Link href={previousHref}>Previous page</Link>}
        {previousHref === null && page.pageNumber > 1 ? <Link href={firstHref}>First page</Link> : null}
        {nextHref === null ? null : <Link href={nextHref}>Next page</Link>}
        <Link href={refreshHref}>Refresh list</Link>
      </nav>
    </section>
  );
}

function RecordReviewQueueRow({
  runId,
  row,
  navigation,
  naming,
  selected,
}: {
  readonly runId: string;
  readonly row: RecordReviewRow;
  readonly navigation: RecordReviewNavigation;
  readonly naming: RecordNaming;
  readonly selected: boolean;
}): React.JSX.Element {
  const href = recordReviewHref(runId, navigation, { selected: row.sourceOrdinal });
  const assessment = rowAssessment(row.targets);
  return (
    <li className={`record-review__row${selected ? ' record-review__row--selected' : ''}`} aria-current={selected ? 'true' : undefined}>
      <div className="record-review__row-head">
        <div>
          <h3><RecordLabel parts={recordLabelParts({ key: row.recordLabel, name: row.recordName ?? null }, naming)} /></h3>
          <p className="ls-caption">{row.targets.length === 0 ? 'No target system recorded' : row.targets.map((target) => target.targetName).join(' · ')}</p>
        </div>
        <span className={`record-review__state ${assessment.className}`}>{assessment.word}</span>
      </div>
      {row.targets.map(target => <div key={target.targetId}>{target.matchOrigin === 'human-matched' ? <strong>{target.targetName}</strong> : null}<HumanMatch runId={runId} matchOrigin={target.matchOrigin} decision={target.matchingDecision} /></div>)}
      <dl className="record-review__row-facts">
        <div><dt>Observed account</dt><dd>{rowSubjectText(row.targets)}</dd></div>
        <div><dt>Captured status</dt><dd>{rowCapturedStatusText(row.targets)}</dd></div>
        <div><dt>Evidence checks</dt><dd>{rowChecksWord(row.targets)}</dd></div>
      </dl>
      {row.duplicateIdentity || row.missingIdentity || row.disposition !== 'included' ? (
        <p className="record-review__row-note">
          {row.duplicateIdentity ? 'The source lists this record more than once. ' : ''}
          {row.missingIdentity ? 'The source row has no record key. ' : ''}
          {row.disposition !== 'included' ? `${dispositionWord(row.disposition)}.` : ''}
        </p>
      ) : null}
      <Link className="ls-button ls-button--primary ls-button--sm record-review__review-link" href={href} aria-current={selected ? 'page' : undefined}>
        Review evidence
      </Link>
      <TechnicalDetails
        items={[
          { label: 'Source row', value: String(row.sourceOrdinal), mono: true },
          { label: 'Observation identifiers', value: row.targets.filter((target) => target.observationId !== null).map((target) => target.observationId).join(', ') || 'None', mono: true },
          { label: 'Work Item identifiers', value: row.targets.filter((target) => target.workItemId !== null).map((target) => target.workItemId).join(', ') || 'None', mono: true },
        ]}
      />
    </li>
  );
}

export interface SelectedEvaluationReviewRead {
  readonly result: Pick<RunResultRow, 'outcome' | 'sealed' | 'version'> | null;
  readonly evaluations: readonly RunEvaluationRow[];
  readonly reviewRevision: number;
  readonly pendingCount: number | null;
  readonly commandStatuses: readonly EvaluationReviewCommandStatus[];
  readonly reviewerNames: Readonly<Record<string, string>>;
}

export interface RecordReviewInspectorProps {
  readonly runId: string;
  readonly selection: RecordReviewSelection | null;
  readonly selectionStatus?: string | null;
  readonly observations: readonly RunObservationRow[];
  readonly evaluations: readonly RunEvaluationRow[];
  readonly evidence: readonly RunEvidenceItem[];
  readonly evaluationReview?: SelectedEvaluationReviewRead | null;
  readonly navigation: RecordReviewNavigation;
  readonly page: RecordReviewPage;
  readonly naming?: RecordNaming;
}

/**
 * The selected-record inspector. It receives only the selected Observation/evaluation/evidence rows.
 *
 * It says what an auditor needs to judge the record (UX-24): what the approved test
 * expected, what was captured and from which system, when, which checks ran and how they
 * came out, and what the person must decide. How the platform stores or serves any of it
 * is under Technical details, and the untrusted-content policy is said once (UX-27).
 */
export function RecordReviewInspector({
  runId,
  selection,
  selectionStatus = null,
  observations,
  evaluations,
  evidence,
  evaluationReview = null,
  navigation,
  page,
  naming = NO_RECORD_NAMING,
}: RecordReviewInspectorProps): React.JSX.Element {
  if (selection === null) {
    return (
      <section className="record-review__inspector ls-card" aria-label="Record inspector">
        <h2 id="record-review-inspector-heading">Record inspector</h2>
        {selectionStatus === null ? <p>Select <strong>Review evidence</strong> to inspect one record.</p> : <Banner tone="warning" title="Record detail unavailable">{selectionStatus}</Banner>}
      </section>
    );
  }

  const conditions = conditionById(selection);
  const conditionLabels = Object.fromEntries(selection.conditions.map((condition) => [condition.conditionId, condition.text]));
  const observationLabels = Object.fromEntries(selection.row.targets
    .filter((target) => target.observationId !== null)
    .map((target) => [target.observationId as string, target.targetName]));
  const targetsWithObservations = selection.row.targets.filter((target) => target.observationId !== null);
  const unresolvedRows = page.rows.filter((row) => row.sourceOrdinal !== selection.row.sourceOrdinal && row.targets.some((target) => target.assessmentState === 'needs-review' || target.assessmentState === 'unevaluated' || target.assessmentState === 'not-inspected' || target.pendingAssessments > 0));
  const nextUnresolved = unresolvedRows[0] ?? null;
  const replayTargets = [...new Map(selection.row.targets.filter(target => target.workItemId !== null)
    .map(target => [target.workItemId, target])).values()];
  const nextHref = nextUnresolved === null ? null : recordReviewHref(runId, navigation, { selected: nextUnresolved.sourceOrdinal });
  const masked = new Set(selection.maskedFields ?? []);
  const systemOf = (registrationId: string): string | null =>
    selection.row.targets.find((target) => target.targetId === registrationId)?.targetName ?? null;

  return (
    <section className="record-review__inspector ls-card" aria-label="Record inspector">
      <header className="record-review__inspector-head">
        <div>
          <p className="record-review__overline">Record inspector · {selection.row.targets.map((target) => target.targetName).join(' · ') || 'No target system recorded'}</p>
          <h2 id="record-review-inspector-heading">
            <RecordLabel parts={recordLabelParts({ key: selection.row.recordLabel, name: selection.row.recordName ?? null }, naming)} />
          </h2>
          <p className="ls-caption">Source row {selection.row.sourceOrdinal} · read <Timestamp value={selection.readAt} /></p>
        </div>
        <span className="record-review__state record-review__state--neutral">{dispositionWord(selection.row.disposition)}</span>
      </header>

      {selection.changedSinceList ? (
        <Banner tone="warning" title="Changed since this list loaded">
          This record changed after the list was read. What you see here is current; refresh the list to update the rest.
        </Banner>
      ) : null}

      <section className="record-review__section record-review__expectation" aria-labelledby="record-review-expectation-heading">
        <h3 id="record-review-expectation-heading">What the approved test expected</h3>
        {selection.conditions.length === 0 ? (
          <p>The approved procedure recorded no condition for this Run.</p>
        ) : (
          <ol className="record-review__conditions">
            {selection.conditions.map((condition) => <li key={condition.conditionId}>{condition.text}</li>)}
          </ol>
        )}
        <p>Approved scope: {selection.scope}</p>
      </section>

      <section className="record-review__section" aria-labelledby="record-review-captured-heading">
        <h3 id="record-review-captured-heading">What was captured</h3>
        {/* Captured values, account names and page text all come from outside this
            platform. The policy is said once here, above every block of it (UX-27). */}
        <UntrustedPolicy />
        <div className="record-review__target-list">
          {selection.row.targets.length === 0 ? <p>No target system was recorded for this source record.</p> : selection.row.targets.map((target) => {
            const observation = target.observationId === null ? null : observations.find((row) => row.observationId === target.observationId) ?? null;
            return <div key={target.targetId}><HumanMatch runId={runId} matchOrigin={observation?.matchOrigin} decision={observation?.matchingDecision} /><CapturedTarget target={target} observation={observation} masked={masked} /></div>;
          })}
        </div>
        <section id="recorded-source-values" className="record-review__source-record" aria-labelledby="record-review-source-heading">
          <h4 id="record-review-source-heading">Source record</h4>
          {Object.keys(selection.sourceValues).length === 0 ? (
            <p>No source fields were recorded.</p>
          ) : (
            <table className="record-review__source-table">
              <caption>Fields from the approved population source.</caption>
              <tbody>
                {Object.entries(selection.sourceValues).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => (
                  <tr key={key}>
                    <th scope="row">{fieldWords(key)}</th>
                    <td>
                      {masked.has(key) ? (
                        <>
                          <span aria-hidden="true">{MASKED_VALUE}</span>
                          <span className="ls-visually-hidden">{MASKED_BY_BINDING}</span>
                        </>
                      ) : (
                        <span className="record-review__source-value">{jsonValueText(value)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {masked.size > 0 ? <p className="ls-caption">{MASKED_BY_BINDING}: {[...masked].map(fieldWords).join(', ')}.</p> : null}
        </section>
      </section>

      <section className="record-review__section" aria-labelledby="record-review-assessment-heading">
        <h3 id="record-review-assessment-heading">Condition-by-condition assessment</h3>
        {targetsWithObservations.length === 0 ? (
          <p>No Observation is recorded for this record, so no condition was assessed.</p>
        ) : (
          <div className="record-review__assessment-list">
            {targetsWithObservations.map((target) => <TargetAssessment key={target.targetId} target={target} conditions={conditions} evaluations={evaluations.filter((evaluation) => evaluation.observationId === target.observationId)} />)}
          </div>
        )}
      </section>

      <section className="record-review__section" aria-labelledby="record-review-evidence-heading">
        <div className="record-review__section-head">
          <h3 id="record-review-evidence-heading">Supporting evidence</h3>
          <span className="record-review__state record-review__state--neutral">{evidence.length === 0 ? 'Not captured' : `${countNoun(evidence.length, 'item')} recorded`}</span>
        </div>
        <p className="record-review__evidence-note">Opening evidence does not confirm an assessment.</p>
        {evidence.length === 0 ? <p>No evidence is linked to this record's Observations.</p> : (
          <ul className="record-review__evidence-list">
            {evidence.map((item) => {
              const openHref = evidenceOpenHref(runId, item) ?? evidenceGroundingHref(runId, item, observations);
              const system = systemOf(item.registrationId);
              return (
                <li key={item.evidenceId} className="record-review__evidence-item">
                  <div>
                    <h4>{evidenceKindWord(item.kind)}</h4>
                    <p className="ls-caption">
                      {system ?? 'Target system not recorded'}
                      {item.displayName === null ? null : <> · {item.displayName}</>}
                    </p>
                  </div>
                  <dl className="record-review__evidence-facts">
                    <div><dt>Captured</dt><dd>{item.capturedAt === null ? CAPTURE_TIME_UNRECORDED : <Timestamp value={item.capturedAt} />}</dd></div>
                    <div><dt>Digest check</dt><dd>{digestCheckWord(item)}</dd></div>
                  </dl>
                  {item.kind === 'screenshot' && openHref !== null ? (
                    <details className="record-review__preview">
                      <summary>Preview account capture</summary>
                      <div className="record-review__preview-frame">
                        <img src={openHref} alt="Saved account capture" loading="lazy" />
                      </div>
                      <p><Link href={openHref}>Open account capture</Link></p>
                    </details>
                  ) : openHref === null ? (
                    <p className="ls-caption">This item has no captured field to open.</p>
                  ) : (
                    <Link href={openHref}>Open recorded page data</Link>
                  )}
                  <TechnicalDetails
                    items={[
                      { label: 'Evidence identifier', value: item.evidenceId, mono: true },
                      { label: 'Object key', value: item.objectKey, mono: true },
                      { label: 'Step', value: item.stepId ?? 'Not recorded', mono: true },
                      { label: 'Work Item', value: item.workItemId ?? 'Not recorded', mono: true },
                      ...(item.digest === null ? [] : [{ label: 'Digest', value: <Digest as="span" label="Evidence" value={item.digest} /> }]),
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {evaluationReview !== null && evaluationReview.evaluations.length > 0 ? (
        <section className="record-review__section" aria-labelledby="record-review-human-heading">
          <h3 id="record-review-human-heading">Human review</h3>
          <p className="record-review__evidence-note">Confirm or reject each proposal below. Your decision is recorded against your name.</p>
          <EvaluationReview
            runId={runId}
            result={evaluationReview.result}
            evaluations={evaluationReview.evaluations}
            reviewRevision={evaluationReview.reviewRevision}
            pendingCount={evaluationReview.pendingCount}
            commandStatuses={evaluationReview.commandStatuses}
            observationLabels={observationLabels}
            conditionLabels={conditionLabels}
            reviewerNames={evaluationReview.reviewerNames}
          />
        </section>
      ) : null}

      <section className="record-review__section" aria-labelledby="record-review-history-heading">
        <h3 id="record-review-history-heading">History</h3>
        <p>Read <Timestamp value={selection.readAt} />. Opening a record does not mark it reviewed.</p>
        {evaluationReview === null ? <p>Your role cannot see human review decisions.</p> : <p>Any review decision is shown above, with the current Result.</p>}
      </section>

      <section className="record-review__section record-review__inspector-actions" aria-label="Record actions">
        <Link href="#recorded-source-values">View source record</Link>
        {replayTargets.length === 0 ? <Link href={`/runs/${encodeURIComponent(runId)}/replay`}>Open Run Replay</Link>
          : replayTargets.map(target => <Link key={target.workItemId}
            href={`/runs/${encodeURIComponent(runId)}/replay?workItem=${encodeURIComponent(target.workItemId!)}`}>
            {replayTargets.length === 1 ? 'Replay this inspection' : `Replay ${target.targetName} inspection`}
          </Link>)}
        {nextHref === null ? <span className="ls-caption">No other unresolved record on this page.</span> : <Link href={nextHref}>Next unresolved record</Link>}
      </section>

      <TechnicalDetails
        items={[
          { label: 'Review list revision', value: page.revision, mono: true },
          { label: 'Current detail revision', value: selection.revision, mono: true },
          { label: 'Observation identifiers', value: observations.map((observation) => observation.observationId).join(', ') || 'None', mono: true },
        ]}
      />
    </section>
  );
}

function CapturedTarget({ target, observation, masked }: {
  readonly target: RecordReviewTarget;
  readonly observation: RunObservationRow | null;
  readonly masked: ReadonlySet<string>;
}): React.JSX.Element {
  // Captured attributes are named like source fields; one the binding designates
  // sensitive is masked here exactly as it is in the source table (FR-41).
  const captured = observation === null ? [] : observation.attributes.map((attribute) =>
    `${fieldWords(attribute.name)}: ${masked.has(attribute.name) ? MASKED_VALUE : jsonValueText(attribute.originalValue)}`);
  const failing = observation?.checks.filter((check) => check.outcome !== 'PASS' && check.diagnostic !== null) ?? [];
  return (
    <article className="record-review__captured-target">
      <header className="record-review__section-head">
        <div><h4>{target.targetName}</h4><p className="ls-caption">{target.account === null ? 'Account not recorded' : sourceText(target.account)}</p></div>
        <span className={`record-review__state ${targetStateClass(target.assessmentState)}`}>{targetStateWord(target.assessmentState)}</span>
      </header>
      <dl className="record-review__captured-facts">
        <div><dt>Captured status</dt><dd>{sourceText(target.capturedStatus)}</dd></div>
        <div><dt>Found</dt><dd>{targetFound(target.found)}</dd></div>
        <div><dt>Observed</dt><dd>{observation === null ? 'Not recorded' : <Timestamp value={observation.observedAt} />}</dd></div>
      </dl>
      <h5 className="record-review__checks-heading">Evidence checks</h5>
      {observation === null ? (
        <p>Not checked yet: no Observation was recorded for this system.</p>
      ) : observation.checks.length === 0 ? (
        <p>No check was recorded for this Observation.</p>
      ) : (
        <ul className="record-review__checks">
          {observation.checks.map((check) => (
            <li key={check.check} className={check.outcome === 'PASS' ? 'record-review__check--passed' : 'record-review__check--failed'}>
              {observationCheckWord(check.check)}: <strong>{observationCheckOutcomeWord(check.outcome)}</strong>
            </li>
          ))}
        </ul>
      )}
      {captured.length > 0 ? <UntrustedList policy={false} field="captured fields" values={captured} /> : null}
      {failing.length === 0 ? null : (
        <TechnicalDetails
          items={failing.map((check) => ({ label: `${observationCheckWord(check.check)} — recorded reason`, value: check.diagnostic!, mono: true }))}
        />
      )}
    </article>
  );
}

function TargetAssessment({
  target,
  conditions,
  evaluations,
}: {
  readonly target: RecordReviewTarget;
  readonly conditions: ReadonlyMap<string, string>;
  readonly evaluations: readonly RunEvaluationRow[];
}): React.JSX.Element {
  const byCondition = new Map(evaluations.map((evaluation) => [evaluation.conditionId, evaluation]));
  const conditionIds = conditions.size > 0 ? [...conditions.keys()] : evaluations.map((evaluation) => evaluation.conditionId);
  return (
    <article className="record-review__assessment">
      <header className="record-review__section-head">
        <h4>{target.targetName}</h4>
        <span className={`record-review__state ${targetStateClass(target.assessmentState)}`}>{targetStateWord(target.assessmentState)}</span>
      </header>
      {conditionIds.length === 0 ? <p>No condition assessment was recorded.</p> : (
        <ol className="record-review__condition-rows">
          {conditionIds.map((conditionId) => {
            const evaluation = byCondition.get(conditionId) ?? null;
            const value = evaluation === null ? null : evaluationValueWord(evaluation.value);
            const origin = evaluation === null ? null : evaluationOriginWord(evaluation.origin, evaluation.confirmation);
            return (
              <li key={conditionId}>
                <p>{conditions.get(conditionId) ?? 'The approved wording of this condition is not available.'}</p>
                <dl className="record-review__condition-facts">
                  <div><dt>Assessment</dt><dd>{value ?? 'Not assessed'}</dd></div>
                  <div><dt>Decided by</dt><dd>{origin ?? 'Not recorded'}</dd></div>
                </dl>
                {/* A rationale is a model's or a person's words and a diagnostic can name a
                    value a Target System served; neither is the platform's own prose. */}
                {evaluation?.rationale ? (
                  <UntrustedText field="recorded explanation" policy={false}>{evaluation.rationale}</UntrustedText>
                ) : null}
                {evaluation?.diagnostic ? (
                  <UntrustedText field="recorded assessment diagnostic" policy={false}>{evaluation.diagnostic}</UntrustedText>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
