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
import { Digest } from '../design/Digest';
import { EvaluationReview } from './EvaluationReview';
import { UntrustedText } from './UntrustedText';
import {
  coverageWord,
  evaluationOriginWord,
  evaluationValueWord,
  foundWord,
  utcStamp,
} from './labels';

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

function countText(value: number | null): string {
  return value === null ? 'Unavailable' : Number.isFinite(value) ? value.toLocaleString('en-US') : String(value);
}

function sourceQualityWord(value: RecordReviewCounts['sourceQuality']): string {
  switch (value) {
    case 'verified': return 'Verified';
    case 'problems': return 'Problems recorded';
    case 'unknown': return 'Unknown';
  }
}

function recordLabel(row: RecordReviewRow): string {
  return row.recordLabel.trim() === '' ? 'Unnamed source record' : row.recordLabel;
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

function rowAssessmentWord(targets: readonly RecordReviewTarget[]): string {
  if (targets.length === 0) return 'Not recorded';
  if (targets.some((target) => target.assessmentState === 'exception' || target.exception)) return 'Exception in target';
  if (targets.some((target) => target.assessmentState === 'needs-review' || target.assessmentState === 'unevaluated' || target.pendingAssessments > 0)) return 'Needs review';
  if (targets.some((target) => target.assessmentState === 'not-inspected')) return 'Not inspected';
  if (targets.every((target) => target.assessmentState === 'compliant')) return 'Compliant';
  if (targets.every((target) => target.assessmentState === 'excluded')) return 'Excluded';
  return targetStateWord(targets[0]!.assessmentState);
}

function rowSubjectText(targets: readonly RecordReviewTarget[]): string {
  const subjects = [...new Set(targets.map((target) => target.account).filter((value): value is string => value !== null && value.trim() !== ''))];
  return subjects.length === 0 ? 'Not recorded' : subjects.length === 1 ? subjects[0]! : `${subjects.length} subjects recorded`;
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

function evidenceKindWord(kind: string): string {
  switch (kind) {
    case 'screenshot': return 'Screenshot';
    case 'structural-snapshot': return 'Recorded page data';
    case 'population': return 'Population source';
    case 'reference-source': return 'Reference source';
    case 'adapter-extraction': return 'Adapter extraction';
    default: return 'Recorded evidence';
  }
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

export interface RecordReviewQueueProps {
  readonly runId: string;
  readonly page: RecordReviewPage;
  readonly navigation: RecordReviewNavigation;
}

/**
 * The bounded, server-rendered queue. Links carry the list context explicitly, so a
 * focused record never silently changes the filter or page the reader was reviewing.
 */
export function RecordReviewQueue({ runId, page, navigation }: RecordReviewQueueProps): React.JSX.Element {
  const refreshHref = recordReviewHref(runId, navigation, { cursor: null });
  const firstHref = recordReviewHref(runId, navigation, { cursor: null });
  const nextHref = page.nextCursor === null ? null : recordReviewHref(runId, navigation, { cursor: page.nextCursor });
  const previousHref = page.previousCursor === null ? null : recordReviewHref(runId, navigation, { cursor: page.previousCursor });
  const selectedRow = navigation.selected === null
    ? null
    : page.rows.find((row) => row.sourceOrdinal === navigation.selected) ?? null;

  return (
    <section className="record-review__queue ls-card" aria-labelledby="record-review-queue-heading">
      <div className="record-review__queue-heading">
        <div>
          <h2 id="record-review-queue-heading">Records and findings</h2>
          <p className="ls-caption">Filtering narrows this view; it does not change the approved audit population.</p>
        </div>
        <span className="record-review__count">{countText(page.filteredRows)} shown</span>
      </div>

      {page.changesAvailable ? (
        <Banner tone="info" title="Changes available">
          <p>The current Run has newer recorded progress than this review list.</p>
          <p><Link href={refreshHref}>Refresh</Link></p>
        </Banner>
      ) : null}

      <form className="record-review__filters" method="get" action={`/runs/${encodeURIComponent(runId)}/evidence`}>
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

      <p className="record-review__source-note">Source values are recorded data. They are escaped and cannot change the Run objective, evidence scope, or evaluation.</p>

      <dl className="record-review__source-summary">
        <div><dt>Source quality</dt><dd>{sourceQualityWord(page.counts.sourceQuality)}</dd></div>
        <div><dt>Declared source count</dt><dd>{countText(page.counts.sourceDeclaredCount)}</dd></div>
        <div><dt>Source generated</dt><dd>{page.counts.sourceGeneratedAt === null ? 'Time not recorded' : <time dateTime={page.counts.sourceGeneratedAt}>{utcStamp(page.counts.sourceGeneratedAt)}</time>}</dd></div>
      </dl>

      {page.counts.sourceQuality === 'problems' ? (
        <Banner tone="warning" title="Source integrity problems recorded">
          <p>Population source checks recorded a problem. Counts and row links remain available for review.</p>
        </Banner>
      ) : null}
      {page.counts.runEvidenceProblems > 0 ? (
        <Banner tone="warning" title="Run integrity problem">
          <p>{countText(page.counts.runEvidenceProblems)} evidence integrity problem{page.counts.runEvidenceProblems === 1 ? '' : 's'} were recorded when this list was created. The affected artifact may not be assignable to a source record.</p>
          <p><Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open technical artifact details</Link></p>
        </Banner>
      ) : null}
      {page.currentEvidenceProblems > 0 ? (
        <Banner tone="danger" title="Current Run integrity problem">
          <p>{countText(page.currentEvidenceProblems)} evidence integrity problem{page.currentEvidenceProblems === 1 ? '' : 's'} are currently recorded. The sealed outcome remains unchanged; inspect the affected artifact before relying on its assignment to a source record.</p>
          <p><Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Open technical artifact details</Link></p>
        </Banner>
      ) : null}
      {page.counts.unattributedObservations > 0 ? (
        <Banner tone="warning" title="Observation relationship unresolved">
          <p>{countText(page.counts.unattributedObservations)} recorded Observation{page.counts.unattributedObservations === 1 ? '' : 's'} could not be uniquely related to a source record. The exception count is unavailable until that relationship is resolved.</p>
          <p><Link href={`/runs/${encodeURIComponent(runId)}/evidence/technical`}>Review technical relationship details</Link></p>
        </Banner>
      ) : null}

      <dl className="record-review__metrics">
        <div><dt>Source rows</dt><dd>{countText(page.counts.sourceRows)}</dd></div>
        <div><dt>Included</dt><dd>{countText(page.counts.includedRows)}</dd></div>
        <div><dt>Excluded</dt><dd>{countText(page.counts.excludedRows)}</dd></div>
        <div><dt>Indeterminate</dt><dd>{countText(page.counts.indeterminateRows)}</dd></div>
        <div><dt>Fully inspected subjects</dt><dd>{countText(page.counts.fullyInspectedSubjects)}</dd></div>
        <div><dt>Inspected units</dt><dd>{countText(page.counts.inspectedUnits)} / {countText(page.counts.requiredUnits)}</dd></div>
        <div><dt>Records with exceptions</dt><dd>{countText(page.counts.exceptionRecords)}</dd></div>
        <div><dt>Unattributed Observations</dt><dd>{countText(page.counts.unattributedObservations)}</dd></div>
        <div><dt>Pending assessments</dt><dd>{countText(page.counts.pendingAssessments)}</dd></div>
        <div><dt>Evidence problem records</dt><dd>{countText(page.counts.evidenceProblemRecords)}</dd></div>
        <div><dt>Integrity problems at list snapshot</dt><dd>{countText(page.counts.runEvidenceProblems)}</dd></div>
      </dl>

      <p className="record-review__as-of">
        {countText(page.filteredRows)} records match this view · Page {page.pageNumber} · List as of{' '}
        <time dateTime={page.asOf}>{utcStamp(page.asOf)}</time>. Snapshot expires <time dateTime={page.expiresAt}>{utcStamp(page.expiresAt)}</time>.
      </p>

      {page.rows.length === 0 ? (
        <p className="record-review__empty">No records match this filter. The approved population counts remain unchanged.</p>
      ) : (
        <ol className="record-review__rows" aria-label="Record review queue">
          {page.rows.map((row) => <RecordReviewQueueRow key={row.sourceOrdinal} runId={runId} row={row} navigation={navigation} selected={selectedRow?.sourceOrdinal === row.sourceOrdinal} />)}
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
  selected,
}: {
  readonly runId: string;
  readonly row: RecordReviewRow;
  readonly navigation: RecordReviewNavigation;
  readonly selected: boolean;
}): React.JSX.Element {
  const unresolved = row.targets.some((target) => target.assessmentState === 'needs-review' || target.assessmentState === 'unevaluated' || target.assessmentState === 'not-inspected' || target.pendingAssessments > 0);
  const href = recordReviewHref(runId, navigation, { selected: row.sourceOrdinal });
  return (
    <li className={`record-review__row${selected ? ' record-review__row--selected' : ''}`} aria-current={selected ? 'true' : undefined}>
      <div className="record-review__row-head">
        <div>
          <h3>{recordLabel(row)}</h3>
          <p className="ls-caption">{row.targets.length === 0 ? 'No target recorded' : row.targets.map((target) => target.targetName).join(' · ')}</p>
        </div>
        {unresolved ? <span className="record-review__state record-review__state--info">Review needed</span> : <span className="record-review__state record-review__state--neutral">Recorded</span>}
      </div>
      <dl className="record-review__row-facts">
        <div><dt>Observed subject</dt><dd>{rowSubjectText(row.targets)}</dd></div>
        <div><dt>Captured status</dt><dd>{rowCapturedStatusText(row.targets)}</dd></div>
        <div><dt>Assessment</dt><dd>{rowAssessmentWord(row.targets)}</dd></div>
        <div><dt>Evidence</dt><dd>{row.targets.some((target) => target.evidenceProblem) ? 'Problem recorded' : row.targets.length === 0 ? 'Not recorded' : 'No problem recorded'}</dd></div>
      </dl>
      {row.duplicateIdentity || row.missingIdentity || row.disposition !== 'included' ? (
        <p className="record-review__row-note">
          {row.duplicateIdentity ? 'Duplicate source identity. ' : ''}
          {row.missingIdentity ? 'Source identity is missing. ' : ''}
          {row.disposition !== 'included' ? `Source disposition: ${row.disposition}.` : ''}
        </p>
      ) : null}
      <Link className="ls-button ls-button--primary ls-button--sm record-review__review-link" href={href} aria-current={selected ? 'page' : undefined}>
        Review evidence
      </Link>
      <details className="ls-disclosure record-review__technical">
        <summary>Technical details</summary>
        <div className="ls-disclosure__body">
          <dl className="ls-definition">
            <div><dt>Source row ordinal</dt><dd className="ls-mono">{row.sourceOrdinal}</dd></div>
            <div><dt>Observation references</dt><dd className="ls-mono">{row.targets.filter((target) => target.observationId !== null).map((target) => target.observationId).join(', ') || 'None'}</dd></div>
            <div><dt>Work Item references</dt><dd className="ls-mono">{row.targets.filter((target) => target.workItemId !== null).map((target) => target.workItemId).join(', ') || 'None'}</dd></div>
          </dl>
        </div>
      </details>
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
}

/** The selected-record inspector. It receives only the selected Observation/evaluation/evidence rows. */
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
  const firstWorkItem = selection.row.targets.find((target) => target.workItemId !== null)?.workItemId ?? null;
  const nextHref = nextUnresolved === null ? null : recordReviewHref(runId, navigation, { selected: nextUnresolved.sourceOrdinal });
  const replayHref = firstWorkItem === null
    ? `/runs/${encodeURIComponent(runId)}/replay`
    : `/runs/${encodeURIComponent(runId)}/replay?workItem=${encodeURIComponent(firstWorkItem)}`;

  return (
    <section className="record-review__inspector ls-card" aria-label="Record inspector">
      <header className="record-review__inspector-head">
        <div>
          <p className="record-review__overline">Record inspector · {selection.row.targets.map((target) => target.targetName).join(' · ') || 'Target not recorded'}</p>
          <h2 id="record-review-inspector-heading">{recordLabel(selection.row)}</h2>
          <p className="ls-caption">Source record {selection.row.sourceOrdinal} · Read at <time dateTime={selection.readAt}>{utcStamp(selection.readAt)}</time></p>
        </div>
        <span className="record-review__state record-review__state--neutral">{selection.row.disposition === 'included' ? 'Included record' : selection.row.disposition}</span>
      </header>

      {selection.changedSinceList ? (
        <Banner tone="warning" title="Changed since this list loaded">
          The selected detail is newer than the review list. Review actions use the current revision and recheck authorization.
        </Banner>
      ) : null}

      <section className="record-review__section record-review__expectation" aria-labelledby="record-review-expectation-heading">
        <h3 id="record-review-expectation-heading">What the approved test expected</h3>
        {selection.conditions.length === 0 ? (
          <p>No frozen expected condition text was recorded for this selected Run.</p>
        ) : (
          <ol className="record-review__conditions">
            {selection.conditions.map((condition) => <li key={condition.conditionId}>{condition.text}</li>)}
          </ol>
        )}
        <p>Approved scope: {selection.scope}</p>
        <p className="ls-caption">Expected text is frozen with this Run and is shown for context only.</p>
      </section>

      <section className="record-review__section" aria-labelledby="record-review-captured-heading">
        <h3 id="record-review-captured-heading">What was captured</h3>
        <p className="record-review__source-note">Recorded values are shown as source data and remain inert presentation content.</p>
        <div className="record-review__target-list">
          {selection.row.targets.length === 0 ? <p>No target was recorded for this source record.</p> : selection.row.targets.map((target) => {
            const observation = target.observationId === null ? null : observations.find((row) => row.observationId === target.observationId) ?? null;
            return <CapturedTarget key={target.targetId} target={target} observation={observation} />;
          })}
        </div>
        <section id="recorded-source-values" className="record-review__source-record" aria-labelledby="record-review-source-heading">
          <h4 id="record-review-source-heading">Source record</h4>
          {Object.keys(selection.sourceValues).length === 0 ? (
            <p>No source fields were recorded.</p>
          ) : (
            <table className="record-review__source-table">
              <caption>Fields captured from the approved population source.</caption>
              <tbody>
                {Object.entries(selection.sourceValues).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => (
                  <tr key={key}><th scope="row">{key}</th><td><span className="record-review__source-value">{jsonValueText(value)}</span></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>

      <section className="record-review__section" aria-labelledby="record-review-assessment-heading">
        <h3 id="record-review-assessment-heading">Condition-by-condition assessment</h3>
        {targetsWithObservations.length === 0 ? (
          <p>No Observation is recorded for this selected record.</p>
        ) : (
          <div className="record-review__assessment-list">
            {targetsWithObservations.map((target) => <TargetAssessment key={target.targetId} target={target} conditions={conditions} evaluations={evaluations.filter((evaluation) => evaluation.observationId === target.observationId)} />)}
          </div>
        )}
      </section>

      <section className="record-review__section" aria-labelledby="record-review-evidence-heading">
        <div className="record-review__section-head">
          <div><h3 id="record-review-evidence-heading">Supporting evidence</h3><p className="ls-caption">Selected evidence metadata is loaded; bytes load only when you open the protected preview or snapshot route.</p></div>
          <span className="record-review__state record-review__state--neutral">{evidence.length === 0 ? 'Not captured' : `${evidence.length} item${evidence.length === 1 ? '' : 's'} recorded`}</span>
        </div>
        <p className="record-review__evidence-note">Opening evidence does not confirm an assessment. Bytes are fetched only by the protected frame or snapshot route.</p>
        {evidence.length === 0 ? <p>No selected Observation names supporting Evidence metadata.</p> : (
          <ul className="record-review__evidence-list">
            {evidence.map((item) => {
              const openHref = evidenceOpenHref(runId, item) ?? evidenceGroundingHref(runId, item, observations);
              return (
                <li key={item.evidenceId} className="record-review__evidence-item">
                  <div><h4>{evidenceKindWord(item.kind)}</h4><p className="ls-caption">{item.state === 'REGISTERED' ? 'Registered evidence' : item.state}</p></div>
                  <dl className="record-review__evidence-facts">
                    <div><dt>Captured</dt><dd>{item.capturedAt === null ? 'Time not recorded' : <time dateTime={item.capturedAt}>{utcStamp(item.capturedAt)}</time>}</dd></div>
                    <div><dt>Integrity</dt><dd>{item.digest === null ? 'Fingerprint not recorded' : 'Fingerprint recorded'}</dd></div>
                  </dl>
                  {item.kind === 'screenshot' && openHref !== null ? (
                    <details className="record-review__preview">
                      <summary>Preview account capture</summary>
                      <div className="record-review__preview-frame">
                        <img src={openHref} alt="Recorded account capture" loading="lazy" />
                      </div>
                      <p><Link href={openHref}>Open account capture</Link></p>
                    </details>
                  ) : openHref === null ? (
                    <p className="ls-caption">No recorded field link is available for this item.</p>
                  ) : (
                    <Link href={openHref}>Open recorded page data</Link>
                  )}
                  <details className="ls-disclosure">
                    <summary>Technical details</summary>
                    <div className="ls-disclosure__body">
                      <dl className="ls-definition">
                        <div><dt>Evidence ID</dt><dd className="ls-mono">{item.evidenceId}</dd></div>
                        <div><dt>Object key</dt><dd className="ls-mono">{item.objectKey}</dd></div>
                        <div><dt>Step</dt><dd className="ls-mono">{item.stepId ?? 'Not recorded'}</dd></div>
                        <div><dt>Work Item</dt><dd className="ls-mono">{item.workItemId ?? 'Not recorded'}</dd></div>
                        {item.digest === null ? null : <div><dt>Fingerprint</dt><dd><Digest as="span" label="Evidence" value={item.digest} /></dd></div>}
                      </dl>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {evaluationReview !== null && evaluationReview.evaluations.length > 0 ? (
        <section className="record-review__section" aria-labelledby="record-review-human-heading">
          <h3 id="record-review-human-heading">Human review</h3>
          <p className="record-review__evidence-note">Opening evidence does not confirm an assessment. Any decision below is independently authorized and uses the current Result and review revision.</p>
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
        <p>This inspector read the current selected-record projection at <time dateTime={selection.readAt}>{utcStamp(selection.readAt)}</time>. Opening a record does not mark it reviewed.</p>
        {evaluationReview === null ? <p>Human review history is unavailable to the current role.</p> : <p>Any stored human review decision is shown above with the current Result state.</p>}
      </section>

      <section className="record-review__section record-review__inspector-actions" aria-label="Record actions">
        <Link href="#recorded-source-values">View source record</Link>
        <Link href={replayHref}>Replay this inspection</Link>
        {nextHref === null ? <span className="ls-caption">No other unresolved record on this page.</span> : <Link href={nextHref}>Next unresolved record</Link>}
      </section>

      <details className="ls-disclosure">
        <summary>Technical details</summary>
        <div className="ls-disclosure__body">
          <dl className="ls-definition">
            <div><dt>Review list revision</dt><dd className="ls-mono">{page.revision}</dd></div>
            <div><dt>Current detail revision</dt><dd className="ls-mono">{selection.revision}</dd></div>
            <div><dt>Observation IDs</dt><dd className="ls-mono">{observations.map((observation) => observation.observationId).join(', ') || 'None'}</dd></div>
          </dl>
        </div>
      </details>
    </section>
  );
}

function CapturedTarget({ target, observation }: { readonly target: RecordReviewTarget; readonly observation: RunObservationRow | null }): React.JSX.Element {
  return (
    <article className="record-review__captured-target">
      <header className="record-review__section-head">
        <div><h4>{target.targetName}</h4><p className="ls-caption">{target.account === null ? 'Subject not recorded' : sourceText(target.account)}</p></div>
        <span className={`record-review__state ${targetStateClass(target.assessmentState)}`}>{targetStateWord(target.assessmentState)}</span>
      </header>
      <dl className="record-review__captured-facts">
        <div><dt>Captured status</dt><dd>{sourceText(target.capturedStatus)}</dd></div>
        <div><dt>Found</dt><dd>{targetFound(target.found)}</dd></div>
        <div><dt>Evidence completeness</dt><dd>{target.evidenceProblem ? 'Problem recorded' : observation === null ? 'Not loaded' : 'No problem recorded'}</dd></div>
        <div><dt>Observed</dt><dd>{observation === null ? 'Not recorded' : <time dateTime={observation.observedAt}>{utcStamp(observation.observedAt)}</time>}</dd></div>
      </dl>
      {observation === null ? <p>No selected Observation was available for this target.</p> : null}
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
                <p>{conditions.get(conditionId) ?? 'Expected condition text is unavailable.'}</p>
                <dl className="record-review__condition-facts">
                  <div><dt>Assessment</dt><dd>{value ?? 'Not assessed'}</dd></div>
                  <div><dt>Origin</dt><dd>{origin ?? 'Not recorded'}</dd></div>
                  <div><dt>Evidence</dt><dd>{evaluation === null ? 'Not recorded' : 'Recorded in selected metadata'}</dd></div>
                </dl>
                {evaluation?.rationale === null || evaluation?.rationale === undefined ? null : (
                  <p className="record-review__source-copy"><strong>Recorded explanation:</strong> {evaluation.rationale}</p>
                )}
                {evaluation?.diagnostic === null || evaluation?.diagnostic === undefined ? null : (
                  <UntrustedText field="recorded assessment diagnostic">{evaluation.diagnostic}</UntrustedText>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

/** Compact labels for the summary measures, used by tests and future surfaces. */
export function reviewCountsSummary(counts: RecordReviewCounts): string {
  return `${countText(counts.sourceRows)} source rows · ${countText(counts.exceptionRecords)} records with exceptions · ${countText(counts.pendingAssessments)} pending assessments`;
}
