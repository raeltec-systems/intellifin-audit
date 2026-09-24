import type { JsonValue } from '@intellifin/domain';

/** Presentation-only projection. None of these values authorizes an audit action. */
export const RECORD_REVIEW_FILTERS = ['all', 'exceptions', 'needs-review', 'evidence-problems', 'not-inspected'] as const;
export type RecordReviewFilter = (typeof RECORD_REVIEW_FILTERS)[number];
export interface RecordReviewQuery {
  readonly runId: string;
  readonly actorId: string;
  readonly cursor?: string;
  readonly filter?: string;
  readonly search?: string;
  readonly pageSize?: number;
}
export interface RecordReviewTarget {
  readonly targetId: string;
  readonly targetName: string;
  readonly observationId: string | null;
  readonly workItemId: string | null;
  readonly account: string | null;
  readonly capturedStatus: string | null;
  readonly found: string | null;
  readonly inspected: boolean;
  readonly exception: boolean;
  readonly pendingAssessments: number;
  readonly evidenceProblem: boolean;
  readonly assessmentState: 'exception' | 'needs-review' | 'unevaluated' | 'compliant' | 'not-inspected' | 'excluded';
}
export interface RecordReviewRow {
  readonly sourceOrdinal: number;
  /** The record KEY (the Template's first frozen lookup column), or a source-row label. */
  readonly recordLabel: string;
  /**
   * The record's NAME — the Template's second frozen lookup column (P-1's `full_name`) —
   * only when the frozen binding does not designate that field sensitive (FR-41, UX-25).
   * `null` when there is none or it is masked. Absent on a presentation snapshot written
   * before this field existed; such a snapshot expires within ten minutes.
   */
  readonly recordName?: string | null;
  readonly disposition: string;
  readonly duplicateIdentity: boolean;
  readonly missingIdentity: boolean;
  readonly targets: readonly RecordReviewTarget[];
}
export interface RecordReviewCounts {
  readonly sourceRows: number;
  readonly sourceDeclaredCount: number | null;
  readonly sourceGeneratedAt: string | null;
  readonly sourceQuality: 'verified' | 'problems' | 'unknown';
  readonly runEvidenceProblems: number;
  readonly includedRows: number;
  readonly excludedRows: number;
  readonly indeterminateRows: number;
  readonly fullyInspectedSubjects: number;
  readonly inspectedUnits: number;
  readonly requiredUnits: number;
  readonly exceptionRecords: number | null;
  readonly unattributedObservations: number;
  readonly pendingAssessments: number;
  readonly evidenceProblemRecords: number;
}
export interface RecordReviewPage {
  readonly status: 'ready';
  readonly rows: readonly RecordReviewRow[];
  readonly counts: RecordReviewCounts;
  readonly filteredRows: number;
  readonly asOf: string;
  readonly expiresAt: string;
  readonly revision: string;
  readonly changesAvailable: boolean;
  readonly currentEvidenceProblems: number;
  readonly cursor: string;
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
  readonly pageNumber: number;
  readonly pageSize: number;
  readonly filter: RecordReviewFilter;
  readonly search: string;
}
export type RecordReviewResult = RecordReviewPage | {
  readonly status: 'denied' | 'missing' | 'invalid' | 'expired' | 'unavailable' | 'too-large';
};
export interface RecordReviewSelection {
  readonly status: 'ready';
  readonly row: RecordReviewRow;
  /** Every source field; a field the frozen binding designates sensitive is `null` here. */
  readonly sourceValues: Readonly<Record<string, JsonValue>>;
  /** The source fields withheld as sensitive (FR-41), so a surface can say `••••` for them. */
  readonly maskedFields: readonly string[];
  readonly conditions: readonly { readonly conditionId: string; readonly text: string }[];
  readonly scope: string;
  readonly readAt: string;
  readonly revision: string;
  readonly changedSinceList: boolean;
}
export type RecordReviewSelectionResult = RecordReviewSelection | Exclude<RecordReviewResult, RecordReviewPage>;
