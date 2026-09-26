import { evaluationReviewJoin, effectiveEvaluationConfirmation, effectiveEvaluationValue } from './effective-evaluation.js';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  EvaluationConfirmation,
  EvaluationOrigin,
  EvaluationValue,
  GateCheckName,
  GateDiagnostic,
  GateOutcome,
  ObservationAttribute,
  ObservationAbsenceProof,
  ObservationQueryKey,
  ObservationCoverage,
  ObservationFound,
  OutcomeRowId,
  RunResultPublication,
  SystemOutcome,
} from '@intellifin/domain';
import { observationAbsenceDigest } from '@intellifin/application';
import { isObservationAbsenceProof, isObservationQueryKey, isRunResultPublication, workspaceReference } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import {
  auditEvents,
  populationExecution,
  runAgentWork,
  runEvidence,
  runEvidenceCapture,
  runException,
  runFlag,
  runGateCheck,
  runObservation,
  runObservationAbsence,
  runObservationCheck,
  runObservationEvaluation,
  runEvaluationReview,
  runResultReview,
  runExecution,
  runResult,
  runSessionStep,
  runStepExecution,
  runToolAction,
  runWait,
  runWorkItem,
  runWorkspace,
} from '../db/schema.js';

/**
 * The Run DETAIL reads (Story 3.11).
 *
 * One module for the five tabs, and every read here is bounded. The Result, the Gate rows
 * and the Evidence package are one row each; Exceptions, Observations and Step Executions
 * are lists a Run can carry a hundred thousand of, so each is capped and each says the
 * exact total beside the sample — the discipline `GATE_AFFECTED_LIMIT` and
 * `RESULT_SAMPLE_LIMIT` already impose on the Result itself.
 *
 * Nothing here writes, and nothing here recomputes. The sealed Result carries the outcome,
 * the counts, the coverage and the statement; this reads them.
 */

/** How many rows of a per-Run list one page of the detail surface shows. */
export const RUN_DETAIL_PAGE_SIZE = 50;

/**
 * How many frames one Replay holds (Story 5.8).
 *
 * Larger than a detail page, because a scrubber over fifty pills is a scrubber over a
 * fraction of the session and would silently misrepresent where a Step sits in it. Still
 * bounded, with the exact total beside it, so a Run that captured more says so rather than
 * rendering a truncated session as a whole one.
 */
export const REPLAY_FRAME_LIMIT = 500;

/**
 * The ceiling for the reads REPLAY joins against its frames (PR 29 review).
 *
 * The reads below cap at `RUN_DETAIL_PAGE_SIZE`, which is right for a Run Detail tab and
 * wrong for Replay: the surface renders up to `REPLAY_FRAME_LIMIT` frames and then looks
 * each one up in the Tool Actions, the Step Executions, the waits, the Exceptions and the
 * Observation deltas. Capped at fifty, a Run with more than fifty actions showed later
 * frames with "No Tool Action" and fallback narration, dropped later jump targets from the
 * list with nothing saying so, and froze the Observation count at the fiftieth delta —
 * durable facts present in the database and absent from the screen.
 *
 * It equals the frame limit because that is the cardinality it has to cover: one lookup
 * per rendered frame. The DEFAULTS stay `RUN_DETAIL_PAGE_SIZE`, so every Run Detail read
 * is unchanged and only a caller that asks for more gets more.
 *
 * A limit belongs to the cardinality of the READ, not to the table it starts from — the
 * rule this file already learned once, in the PR 23 second pass.
 */
export const REPLAY_PAGE_SIZE = REPLAY_FRAME_LIMIT;

export interface RunResultRow {
  readonly version: number;
  readonly outcome: SystemOutcome;
  readonly outcomeRow: OutcomeRowId;
  readonly sealed: boolean;
  readonly gatePassed: boolean;
  readonly sealedAt: string;
  readonly scope: string | null;
  /**
   * The published document, or `null` when this build cannot read it.
   *
   * `run_result.publication` is `jsonb` whose CHECK says only that it is an object, so a
   * row from an older build or a fixture can hold a shape whose members do not exist —
   * and a surface reaching into one would answer a framework 500 for the whole Run. The
   * outcome, the version and the seal are typed COLUMNS and are always readable; only
   * the document can be missing, and the surface says which.
   */
  readonly publication: RunResultPublication | null;
}

export interface RunGateRow {
  readonly check: GateCheckName;
  readonly outcome: GateOutcome;
  readonly diagnostics: readonly GateDiagnostic[];
  readonly targetSystems: readonly string[];
  readonly workItems: readonly string[];
  readonly records: readonly string[];
  readonly total: number;
}

export interface RunEvidenceItem {
  readonly evidenceId: string;
  readonly kind: string;
  readonly registrationId: string;
  readonly objectKey: string;
  readonly mediaType: string | null;
  readonly digest: string | null;
  readonly size: number | null;
  readonly state: string;
  readonly required: boolean;
  /** The plan Session Step that produced it, from the Work Item or Session Step row. */
  readonly stepId: string | null;
  readonly displayName: string | null;
  readonly workItemId: string | null;
  /**
   * FR-31's capture provenance, READ from the row (generation 32).
   *
   * It used to be derived here — the completion of the last Step Execution of the plan step
   * — and the capture METHOD was derived on the way to the screen from the artifact's kind.
   * Both are stored now: an artifact records how and when it was captured at the moment it
   * is registered, and `captureTimeSource` says whether the instant was measured then
   * (`registration`) or recovered from the Step Execution that froze the bytes
   * (`step-execution`, which is what generation 32 backfilled onto older rows).
   *
   * `null` is an artifact with no recoverable instant at all, and the surface says so in
   * words rather than showing a dash a reader takes for "fine".
   */
  readonly capturedAt: string | null;
  readonly captureMethod: string | null;
  readonly captureTimeSource: string | null;
}

export interface RunObservationAbsence {
  readonly proof: ObservationAbsenceProof | null;
  readonly expectedQueryKeys: readonly ObservationQueryKey[];
  readonly integrityValid: boolean;
}

function readAbsenceMetadata(row: typeof runObservationAbsence.$inferSelect): RunObservationAbsence {
  try {
    const valid = (row.proof === null || isObservationAbsenceProof(row.proof)) &&
      Array.isArray(row.expectedQueryKeys) && row.expectedQueryKeys.every(isObservationQueryKey) &&
      observationAbsenceDigest(row.observationId, row.proof, row.expectedQueryKeys) === row.digest;
    return valid ? { proof: row.proof, expectedQueryKeys: row.expectedQueryKeys, integrityValid: true }
      : { proof: null, expectedQueryKeys: [], integrityValid: false };
  } catch { return { proof: null, expectedQueryKeys: [], integrityValid: false }; }
}

export interface RunObservationRow {
  /** Undefined means this historical Observation did not retain its absence provenance. */
  readonly absence?: RunObservationAbsence;
  readonly observationId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
  readonly targetSystem: string;
  readonly found: ObservationFound;
  readonly coverage: ObservationCoverage;
  readonly corroboration: string;
  readonly observedAt: string;
  readonly observedAtSource: string;
  readonly captureMethod: string;
  readonly matchOrigin: string;
  readonly digest: string;
  readonly identity: ObservationAttribute | null;
  readonly attributes: readonly ObservationAttribute[];
  readonly evidenceIds: readonly string[];
  readonly checks: readonly { readonly check: string; readonly outcome: string; readonly diagnostic: string | null }[];
}

/**
 * One stored Observation row, projected. ONE mapping, shared by the bounded page and by
 * the id-list read: two copies would diverge on the first column nobody added to both.
 */
function observationRow(
  row: typeof runObservation.$inferSelect,
  absence: ReadonlyMap<string, RunObservationAbsence>,
  checks: ReadonlyMap<string, { check: string; outcome: string; diagnostic: string | null }[]>,
): RunObservationRow {
  return {
    ...(absence.has(row.observationId) ? { absence: absence.get(row.observationId)! } : {}),
    observationId: row.observationId,
    workItemId: row.workItemId,
    populationRecordKey: row.populationRecordKey,
    targetSystem: row.targetSystem,
    found: row.found as ObservationFound,
    coverage: row.coverage as ObservationCoverage,
    corroboration: row.corroboration,
    observedAt: row.observedAt.toISOString(),
    observedAtSource: row.observedAtSource,
    captureMethod: row.captureMethod,
    matchOrigin: row.matchOrigin,
    digest: row.digest,
    identity: row.identity,
    attributes: row.attributes,
    evidenceIds: row.evidenceIds,
    checks: checks.get(row.observationId) ?? [],
  };
}

export interface RunEvaluationRow {
  readonly observationId: string;
  readonly conditionId: string;
  readonly origin: EvaluationOrigin;
  readonly value: EvaluationValue;
  readonly confirmation: EvaluationConfirmation | null;
  readonly confidence: string | null;
  readonly rationale: string | null;
  readonly diagnostic: string | null;
  /** Original machine proposal, retained even when thresholding or review changes its value. */
  readonly machineProposal?: { readonly value: EvaluationValue; readonly confidence: string; readonly rationale: string } | null;
  readonly reviewDecision?: { readonly action: 'confirm' | 'reject'; readonly actorId: string; readonly decidedAt: string; readonly rejectionRationale: string | null } | null;
}

export interface RunExceptionRow {
  readonly exceptionId: string;
  readonly observationId: string;
  readonly workItemId: string;
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  /** The immutable condition set captured when this finding was raised. */
  readonly conditionIds: readonly string[];
  /**
   * The condition set in the current effective evaluation overlay. This can differ from
   * `conditionIds`: a human may remove one pending Agent-Judged Exception and classify a
   * different pending condition as an Exception. The fingerprint and diagnostics remain
   * bound to `conditionIds` and are never recomputed from this overlay.
   */
  readonly effectiveConditionIds: readonly string[];
  readonly diagnostics: readonly string[];
  readonly fingerprint: string;
  readonly raisedAt: string;
}

export interface RunStepExecutionRow {
  readonly stepExecutionId: string;
  readonly planStepId: string;
  readonly workItemId: string | null;
  readonly action: string;
  readonly state: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly diagnostic: string | null;
}

/** An exact total beside a bounded sample, on every list this surface renders. */
export interface Bounded<Row> {
  readonly rows: readonly Row[];
  readonly total: number;
}

export interface RunTimelineStage {
  readonly status: string;
  readonly attempts: number;
  readonly diagnostic: string | null;
  readonly startedAt: string;
}

export interface RunTimelineSessionStep {
  readonly stepId: string;
  readonly ordinal: number;
  readonly displayName: string;
  /**
   * The frozen action this Session Step performs (`sign-in` or `extract-adapter`).
   *
   * Read rather than assumed. The row said "Reference Source" for every Session Step,
   * which became false the moment Story 4.2 wrote the first `sign-in` row — a label that
   * states something untrue, which is worse than one that states nothing.
   */
  readonly action: string;
  readonly registrationId: string;
  readonly state: string;
  readonly attempts: number;
  readonly diagnostic: string | null;
  readonly evidenceId: string | null;
}

/**
 * One Tool Action, as the Timeline's fourth level renders it (Story 4.3).
 *
 * The rows Story 4.2 started writing, finally read. It carries `capture` because a
 * suppression must be a stated fact rather than an absence a reader infers: an action with
 * no artifact beside it and no explanation reads as "nothing happened here", which is the
 * defect class this codebase keeps finding.
 */
export interface RunTimelineToolAction {
  readonly toolActionId: string;
  readonly stepExecutionId: string;
  readonly surface: string;
  readonly action: string;
  readonly method: string;
  readonly destination: string;
  readonly outcome: string;
  readonly denial: string | null;
  readonly status: number | null;
  readonly redirected: boolean;
  readonly downloads: number;
  readonly capture: string;
  readonly captureSuppression: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly diagnostic: string | null;
}

// `action` is a Session Step's column and not a Work Item's: a Work Item's action is the
// plan step it belongs to, which is already `stepId`.
export interface RunTimelineWorkItem extends Omit<RunTimelineSessionStep, 'ordinal' | 'action'> {
  readonly workItemId: string;
  readonly ordinal: number;
  readonly cycles: number;
  readonly observations: number;
  /**
   * WHICH record this Work Item inspected — the population's own primary key.
   *
   * `displayName` is the TARGET SYSTEM's name and is the same on every Work Item of a
   * Run, so without this the Execution Timeline of a three-record Run reads as three
   * identical rows called "LoanCore" and cannot say which leaver each one was about.
   * The Runs list and Live View both name the subject; the Timeline is the surface an
   * auditor follows from record to conclusion, and it is where it matters most.
   *
   * `null` for a Work Item that is not per-record: P-4 inspects one page, not a
   * population, so the row has a page and no subject.
   */
  readonly subjectKey: string | null;
}

export interface RunTimelineRead {
  /**
   * The Agent Workspace, when this Run's frozen plan required one (Story 4.1).
   *
   * `null` for every adapter-only Run, which is most of them. `mode` is on the row because
   * the two modes are not the same guarantee, and a Run that ran under the weaker one has
   * to say so on the surface rather than inherit the stronger sentence.
   */
  readonly workspace:
    | (RunTimelineStage & {
        readonly stepId: string;
        readonly mode: string;
        /** Public platform reference. Provider handles never leave the worker-side store. */
        readonly reference: string;
        readonly releasedAt: string | null;
      })
    | null;
  readonly population: (RunTimelineStage & { readonly stepId: string; readonly attemptStartedAt: string }) | null;
  readonly execution: (RunTimelineStage & { readonly runStartedAt: string }) | null;
  readonly sessionSteps: readonly RunTimelineSessionStep[];
  readonly workItems: readonly RunTimelineWorkItem[];
  readonly stepExecutions: Bounded<RunStepExecutionRow>;
  readonly toolActions: Bounded<RunTimelineToolAction>;
}

/**
 * One registered screenshot bound to the Tool Action that captured it (Story 5.3).
 *
 * A frame is `run_evidence` of kind `screenshot` in state `REGISTERED`, bound through
 * `run_evidence_capture` to a `run_tool_action` row. The binding is what makes it a
 * frame rather than a loose artifact: the action says which Step Execution and Work Item
 * it belongs to, and the Live View narrates the frame from that Step. A screenshot with
 * no binding is not a frame and is not read here.
 */
export interface RunFrameRow {
  readonly evidenceId: string;
  readonly toolActionId: string;
  readonly stepExecutionId: string;
  readonly workItemId: string | null;
  readonly action: string;
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
  /** The sanitized location the action captured, from the binding (never a query string). */
  readonly sourceLocation: string;
  readonly capturedAt: string | null;
  readonly actionStartedAt: string;
}

/** Rich inspection pages are bounded independently of the chronological Replay prefix. */
export const REPLAY_INSPECTION_PAGE_SIZE = 100;

export interface RunInspectionReplayFrame {
  readonly frame: RunFrameRow;
  readonly step: RunStepExecutionRow;
  readonly action: RunTimelineToolAction;
  readonly globalOrdinal: number;
  readonly inspectionOrdinal: number;
  readonly observations: number;
}

export type RunInspectionReplayRead =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'inspection';
      readonly workItem: Pick<RunTimelineWorkItem, 'workItemId' | 'subjectKey' | 'displayName' | 'registrationId'>;
      readonly workspace: { readonly mode: string; readonly reference: string } | null;
      readonly rows: readonly RunInspectionReplayFrame[];
      readonly total: number;
      readonly framesTotal: number;
      readonly cursor: number;
      readonly previousCursor: number | null;
      readonly nextCursor: number | null;
    };

type RunCaptureReplayRead =
  | { readonly kind: 'unavailable' }
  | (Omit<Extract<RunInspectionReplayRead, { kind: 'inspection' }>, 'kind' | 'workItem'> & {
      readonly kind: 'capture';
      readonly workItem: Extract<RunInspectionReplayRead, { kind: 'inspection' }>['workItem'] | null;
    });

/** One wait a Run held, closed or open — a Replay jump target (Story 5.8). */
export interface RunReplayWait {
  readonly frameEvidenceId?: string | null;
  readonly frameWorkItemId?: string | null;
  readonly waitId: string;
  readonly kind: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closureKind: string | null;
  readonly answerOptionId: string | null;
}

/**
 * One Observation registration, as the chain recorded it (Story 5.8).
 *
 * The DELTA and not the Observations: Replay says how many were registered at that point
 * in the session, and the Observation rows themselves are Run Detail's Observations tab.
 * Read from `audit_events`, which is where `replay-asset-set-v1.md` says it lives.
 */
export interface RunReplayObservationDelta {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly workItemId: string | null;
  readonly stepExecutionId: string | null;
  readonly registered: number;
}

/** Where the agent phase is, from its own checkpoint (`run_agent_work`), or `null`. */
export interface RunAgentWorkPosition {
  readonly status: string;
  readonly workItemId: string | null;
  readonly waitId: string | null;
}

/** One flag as a Run surface shows it (Story 5.5). */
export interface RunFlagRow {
  readonly flagId: string;
  readonly flaggedBy: string;
  readonly flaggedAt: string;
  readonly note: string | null;
}

export class DrizzleRunDetailRepository {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * The flags raised on a Run, newest first (Story 5.5).
   *
   * Bounded, because it is a surface read: a Run flagged a hundred times shows the recent
   * ones rather than making the page unrenderable. Nothing downstream counts these — the
   * bell counts its own — so a bound here cannot make a number wrong.
   */
  async readFlags(runId: string, limit = 20): Promise<readonly RunFlagRow[]> {
    if (!isUuidText(runId)) return [];
    const rows = await this.db
      .select({
        flagId: runFlag.flagId,
        flaggedBy: runFlag.flaggedBy,
        flaggedAt: runFlag.flaggedAt,
        note: runFlag.note,
      })
      .from(runFlag)
      .where(eq(runFlag.runId, runId))
      .orderBy(desc(runFlag.flaggedAt), desc(runFlag.flagId))
      .limit(Math.max(1, Math.min(100, limit)));
    return rows.map((row) => ({
      flagId: row.flagId,
      flaggedBy: row.flaggedBy,
      flaggedAt: row.flaggedAt.toISOString(),
      note: row.note,
    }));
  }

  /**
   * The newest frame of a Run, or `null` when nothing has been captured yet.
   *
   * Newest by the ACTION's start, tiebroken on the action id (a UUIDv7, so deterministic),
   * never by the Evidence row's registration time: the frame shows the page the agent was
   * on when it acted, and two captures registered out of order would otherwise swap.
   */
  async readLatestFrame(runId: string): Promise<RunFrameRow | null> {
    if (!isUuidText(runId)) return null;
    const [row] = await this.frames(runId).limit(1);
    return row === undefined ? null : frameRow(row);
  }

  /** One frame by its Evidence id, only when it is a registered, bound screenshot of this Run. */
  async readFrame(runId: string, evidenceId: string): Promise<RunFrameRow | null> {
    if (!isUuidText(runId) || !isUuidText(evidenceId)) return null;
    const [row] = await this.frames(runId, evidenceId).limit(1);
    return row === undefined ? null : frameRow(row);
  }

  private frames(runId: string, evidenceId?: string, direction: 'asc' | 'desc' = 'desc') {
    return this.db
      .select({
        evidenceId: runEvidence.evidenceId,
        digest: runEvidence.digest,
        size: runEvidence.size,
        mediaType: runEvidence.mediaType,
        capturedAt: runEvidence.capturedAt,
        toolActionId: runEvidenceCapture.toolActionId,
        sourceLocation: runEvidenceCapture.sourceLocation,
        stepExecutionId: runToolAction.stepExecutionId,
        workItemId: runToolAction.workItemId,
        action: runToolAction.action,
        actionStartedAt: runToolAction.startedAt,
      })
      .from(runEvidence)
      .innerJoin(runEvidenceCapture, and(eq(runEvidenceCapture.evidenceId, runEvidence.evidenceId), eq(runEvidenceCapture.runId, runId)))
      .innerJoin(runToolAction, and(eq(runToolAction.toolActionId, runEvidenceCapture.toolActionId), eq(runToolAction.runId, runId)))
      .innerJoin(runStepExecution, and(eq(runStepExecution.stepExecutionId, runToolAction.stepExecutionId), eq(runStepExecution.runId, runId)))
      .leftJoin(runWorkItem, and(eq(runWorkItem.workItemId, sql`coalesce(${runStepExecution.workItemId}, ${runToolAction.workItemId})`), eq(runWorkItem.runId, runId)))
      .where(and(
        eq(runEvidence.runId, runId),
        eq(runEvidence.kind, 'screenshot'),
        eq(runEvidence.state, 'REGISTERED'),
        sql`(coalesce(${runStepExecution.workItemId}, ${runToolAction.workItemId}) IS NULL OR ${runWorkItem.workItemId} IS NOT NULL)`,
        ...(evidenceId === undefined ? [] : [eq(runEvidence.evidenceId, evidenceId)]),
      ))
      .orderBy(
        direction === 'asc' ? asc(runToolAction.startedAt) : desc(runToolAction.startedAt),
        direction === 'asc' ? asc(runToolAction.toolActionId) : desc(runToolAction.toolActionId),
        direction === 'asc' ? asc(runEvidence.evidenceId) : desc(runEvidence.evidenceId),
      );
  }

  /**
   * Every frame of a Run, OLDEST first (Story 5.8).
   *
   * The same join `readLatestFrame` uses and the same order reversed, so Live View's
   * newest frame and Replay's last frame are the same row by construction. Bounded like
   * every other list this module reads, with the exact total beside the sample: a Run that
   * captured ten thousand frames must still render.
   */
  async readFrames(runId: string, limit = REPLAY_FRAME_LIMIT): Promise<Bounded<RunFrameRow>> {
    if (!isUuidText(runId)) return { rows: [], total: 0 };
    const counted = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(runEvidence)
      .innerJoin(runEvidenceCapture, and(eq(runEvidenceCapture.evidenceId, runEvidence.evidenceId), eq(runEvidenceCapture.runId, runId)))
      .innerJoin(runToolAction, and(eq(runToolAction.toolActionId, runEvidenceCapture.toolActionId), eq(runToolAction.runId, runId)))
      .innerJoin(runStepExecution, and(eq(runStepExecution.stepExecutionId, runToolAction.stepExecutionId), eq(runStepExecution.runId, runId)))
      .leftJoin(runWorkItem, and(eq(runWorkItem.workItemId, sql`coalesce(${runStepExecution.workItemId}, ${runToolAction.workItemId})`), eq(runWorkItem.runId, runId)))
      .where(and(eq(runEvidence.runId, runId), eq(runEvidence.kind, 'screenshot'), eq(runEvidence.state, 'REGISTERED'),
        sql`(coalesce(${runStepExecution.workItemId}, ${runToolAction.workItemId}) IS NULL OR ${runWorkItem.workItemId} IS NOT NULL)`));
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { rows: [], total: 0 };
    const rows = await this.frames(runId, undefined, 'asc').limit(Math.min(limit, REPLAY_FRAME_LIMIT));
    // A REGISTERED row carries its digest, size and media type by CHECK, so `frameRow`
    // returning `null` here is unreachable — and it is FILTERED rather than coerced, so an
    // unserveable row is one the scrubber does not offer instead of a pill that opens
    // nothing. `total` stays the exact count of bound registered screenshots either way.
    return { total, rows: rows.map(frameRow).filter((row): row is RunFrameRow => row !== null) };
  }

  /**
   * Exact same-Run inspection selection, independent of every chronological prefix.
   * SQL ranks all retained captures but serializes at most one inspection page. Context
   * joins happen after that bound; no provider handles or storage keys are projected.
   * Cursor is the zero-based inspection offset, always a whole page boundary.
   */
  async readInspectionReplay(runId: string, workItemId: string, cursor = 0): Promise<RunInspectionReplayRead> {
    const read = await this.readReplaySelection(runId, workItemId, cursor);
    return read.kind === 'capture' ? { kind: 'unavailable' } : read;
  }

  /** A single exact retained capture, including session captures with no Work Item. */
  async readReplayCapture(runId: string, evidenceId: string): Promise<RunCaptureReplayRead> {
    if (!isUuidText(evidenceId)) return { kind: 'unavailable' };
    const read = await this.readReplaySelection(runId, null, 0, evidenceId);
    return read.kind === 'inspection' ? { kind: 'unavailable' } : read;
  }

  private async readReplaySelection(runId: string, workItemId: string | null, cursor: number, evidenceId?: string): Promise<RunInspectionReplayRead | RunCaptureReplayRead> {
    if (!isUuidText(runId) || (workItemId !== null && !isUuidText(workItemId)) || !Number.isSafeInteger(cursor) ||
      cursor < 0 || cursor > 2_147_483_600 || cursor % REPLAY_INSPECTION_PAGE_SIZE !== 0)
      return { kind: 'unavailable' };
    const [owner] = workItemId === null ? [] : await this.db.select({
      workItemId: runWorkItem.workItemId, subjectKey: runWorkItem.subjectKey,
      displayName: runWorkItem.displayName, registrationId: runWorkItem.registrationId,
    }).from(runWorkItem).where(and(eq(runWorkItem.runId, runId), eq(runWorkItem.workItemId, workItemId))).limit(1);
    if (owner === undefined && evidenceId === undefined) return { kind: 'unavailable' };
    const result = await this.db.execute<{
      total: number; frames_total: number; rows: RunInspectionReplayFrame[];
    }>(sql`
      WITH ranked AS MATERIALIZED (
        SELECT e.evidence_id, a.tool_action_id, a.step_execution_id, a.started_at AS action_started_at,
          coalesce(s.work_item_id, a.work_item_id) AS work_item_id,
          row_number() OVER (ORDER BY a.started_at, a.tool_action_id, e.evidence_id)::int AS global_ordinal
        FROM run_evidence e
        JOIN run_evidence_capture c ON c.evidence_id = e.evidence_id AND c.run_id = ${runId}::uuid
        JOIN run_tool_action a ON a.tool_action_id = c.tool_action_id AND a.run_id = ${runId}::uuid
        JOIN run_step_execution s ON s.step_execution_id = a.step_execution_id AND s.run_id = ${runId}::uuid
        LEFT JOIN run_work_item w ON w.work_item_id = coalesce(s.work_item_id, a.work_item_id) AND w.run_id = ${runId}::uuid
        WHERE e.run_id = ${runId}::uuid AND e.kind = 'screenshot' AND e.state = 'REGISTERED'
          AND (coalesce(s.work_item_id, a.work_item_id) IS NULL OR w.work_item_id IS NOT NULL)
      ), selected AS MATERIALIZED (
        SELECT *, row_number() OVER (ORDER BY global_ordinal)::int AS inspection_ordinal
        FROM ranked WHERE ${evidenceId === undefined ? sql`work_item_id = ${workItemId}::uuid` : sql`evidence_id = ${evidenceId}::uuid`}
      ), page AS (
        SELECT * FROM selected ORDER BY inspection_ordinal LIMIT ${REPLAY_INSPECTION_PAGE_SIZE} OFFSET ${cursor}
      ), observation_times AS (
        SELECT ev.occurred_at AS instant,
          sum(CASE WHEN jsonb_typeof(ev.payload->'registered') = 'number'
            THEN (ev.payload->>'registered')::numeric ELSE 0 END) AS delta
        FROM audit_events ev WHERE ev.aggregate_id = ${runId}
          AND ev.event_type = 'execution.observations-registered'
          AND ev.occurred_at <= (SELECT max(action_started_at) FROM page)
        GROUP BY ev.occurred_at
        UNION ALL
        SELECT DISTINCT action_started_at AS instant, 0::numeric AS delta FROM page
      ), observation_totals AS MATERIALIZED (
        SELECT instant, sum(sum(delta)) OVER (ORDER BY instant ROWS UNBOUNDED PRECEDING) AS observations
        FROM observation_times GROUP BY instant
      )
      SELECT (SELECT count(*)::int FROM selected) AS total,
        (SELECT count(*)::int FROM ranked) AS frames_total,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'globalOrdinal', p.global_ordinal, 'inspectionOrdinal', p.inspection_ordinal,
          'frame', jsonb_build_object(
            'evidenceId', e.evidence_id, 'toolActionId', a.tool_action_id,
            'stepExecutionId', s.step_execution_id, 'workItemId', p.work_item_id,
            'action', a.action, 'digest', e.digest, 'size', e.size, 'mediaType', e.media_type,
            'sourceLocation', c.source_location, 'capturedAt', e.captured_at, 'actionStartedAt', a.started_at),
          'step', jsonb_build_object(
            'stepExecutionId', s.step_execution_id, 'planStepId', s.plan_step_id, 'workItemId', s.work_item_id,
            'action', s.action, 'state', s.state, 'attempt', s.attempt, 'startedAt', s.started_at,
            'completedAt', s.completed_at, 'diagnostic', s.diagnostic),
          'action', jsonb_build_object(
            'toolActionId', a.tool_action_id, 'stepExecutionId', a.step_execution_id, 'surface', a.surface,
            'action', a.action, 'method', a.method, 'destination', a.destination, 'outcome', a.outcome,
            'denial', a.denial, 'status', a.status, 'redirected', a.redirected, 'downloads', a.downloads,
            'capture', a.capture, 'captureSuppression', a.capture_suppression, 'startedAt', a.started_at,
            'completedAt', a.completed_at, 'diagnostic', a.diagnostic),
          'observations', totals.observations
        ) ORDER BY p.inspection_ordinal)
        FROM page p
        JOIN run_evidence e ON e.evidence_id = p.evidence_id AND e.run_id = ${runId}::uuid
        JOIN run_evidence_capture c ON c.evidence_id = e.evidence_id AND c.run_id = ${runId}::uuid
        JOIN run_tool_action a ON a.tool_action_id = p.tool_action_id AND a.run_id = ${runId}::uuid
        JOIN run_step_execution s ON s.step_execution_id = p.step_execution_id AND s.run_id = ${runId}::uuid
        JOIN observation_totals totals ON totals.instant = a.started_at
        ), '[]'::jsonb) AS rows
    `);
    const read = result[0];
    if (read === undefined || (cursor > 0 && cursor >= read.total) || (evidenceId !== undefined && read.total !== 1)) return { kind: 'unavailable' };
    const [workspace] = await this.db.select({ mode: runWorkspace.mode }).from(runWorkspace)
      .where(eq(runWorkspace.runId, runId)).limit(1);
    const common = {
      workspace: workspace === undefined ? null : { mode: workspace.mode, reference: workspaceReference(runId) },
      rows: read.rows, total: read.total, framesTotal: read.frames_total, cursor,
      previousCursor: cursor === 0 ? null : cursor - REPLAY_INSPECTION_PAGE_SIZE,
      nextCursor: cursor + REPLAY_INSPECTION_PAGE_SIZE < read.total ? cursor + REPLAY_INSPECTION_PAGE_SIZE : null,
    };
    if (evidenceId === undefined) return { kind: 'inspection', workItem: owner!, ...common };
    const captureOwnerId = read.rows[0]?.frame.workItemId;
    const [captureOwner] = captureOwnerId == null ? [] : await this.db.select({
      workItemId: runWorkItem.workItemId, subjectKey: runWorkItem.subjectKey,
      displayName: runWorkItem.displayName, registrationId: runWorkItem.registrationId,
    }).from(runWorkItem).where(and(eq(runWorkItem.runId, runId), eq(runWorkItem.workItemId, captureOwnerId))).limit(1);
    return { kind: 'capture', workItem: captureOwner ?? null, ...common };
  }

  /**
   * Every wait this Run held, oldest first — a pause among them (Story 5.8).
   *
   * A pause is a wait and is not an Escalation, so the KIND is carried and the surface
   * decides: the jump list names Escalations, and a pause is where the session stopped for
   * a person rather than for an answer.
   */
  async readWaits(runId: string, limit = RUN_DETAIL_PAGE_SIZE, cursor = 0, escalationsOnly = false): Promise<Bounded<RunReplayWait>> {
    if (!isUuidText(runId) || !validReplayOffset(cursor)) return { rows: [], total: 0 };
    const where = and(eq(runWait.runId, runId), ...(escalationsOnly ? [ne(runWait.kind, 'pause')] : []));
    const [counted] = await this.db.select({ total: sql<number>`count(*)::int` }).from(runWait).where(where);
    const rows = await this.db
      .select({
        waitId: runWait.waitId,
        kind: runWait.kind,
        openedAt: runWait.openedAt,
        closedAt: runWait.closedAt,
        closureKind: runWait.closureKind,
        answerOptionId: runWait.answerOptionId,
      })
      .from(runWait)
      .where(where)
      .orderBy(asc(runWait.openedAt), asc(runWait.waitId))
      .limit(Math.min(limit, REPLAY_PAGE_SIZE)).offset(cursor);
    const landingRows = rows.length === 0 ? [] : await this.db.execute<{
      wait_id: string; evidence_id: string | null; work_item_id: string | null;
    }>(sql`
      WITH captures AS MATERIALIZED (
        SELECT e.evidence_id, a.tool_action_id, a.started_at, coalesce(s.work_item_id, a.work_item_id) AS work_item_id
        FROM run_evidence e
        JOIN run_evidence_capture c ON c.evidence_id = e.evidence_id AND c.run_id = ${runId}::uuid
        JOIN run_tool_action a ON a.tool_action_id = c.tool_action_id AND a.run_id = ${runId}::uuid
        JOIN run_step_execution s ON s.step_execution_id = a.step_execution_id AND s.run_id = ${runId}::uuid
        LEFT JOIN run_work_item owner ON owner.work_item_id = coalesce(s.work_item_id, a.work_item_id) AND owner.run_id = ${runId}::uuid
        WHERE e.run_id = ${runId}::uuid AND e.kind = 'screenshot' AND e.state = 'REGISTERED'
          AND (coalesce(s.work_item_id, a.work_item_id) IS NULL OR owner.work_item_id IS NOT NULL)
      ) SELECT w.wait_id, landed.evidence_id, landed.work_item_id FROM run_wait w
      LEFT JOIN LATERAL (
        SELECT evidence_id, work_item_id FROM captures WHERE started_at <= w.opened_at
        ORDER BY started_at DESC, tool_action_id DESC, evidence_id DESC LIMIT 1
      ) landed ON true
      WHERE w.run_id = ${runId}::uuid AND w.wait_id IN (${sql.join(rows.map(row => sql`${row.waitId}::uuid`), sql`, `)})
    `);
    const landings = new Map(landingRows.map(row => [row.wait_id, row]));
    return { total: Number(counted?.total ?? 0), rows: rows.map((row) => ({
      waitId: row.waitId,
      frameEvidenceId: landings.get(row.waitId)?.evidence_id ?? null,
      frameWorkItemId: landings.get(row.waitId)?.work_item_id ?? null,
      kind: row.kind,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
      closureKind: row.closureKind,
      answerOptionId: row.answerOptionId,
    })) };
  }

  /**
   * The Observation registrations of a Run, oldest first, read from the chain (Story 5.8).
   *
   * A payload field this build does not recognize is read as ABSENT rather than coerced: a
   * chain row is immutable and an older build may have written a shape this one does not
   * know, and a fabricated count would read as a fact nobody recorded.
   */
  async readObservationDeltas(runId: string, limit = RUN_DETAIL_PAGE_SIZE, cursor = 0): Promise<Bounded<RunReplayObservationDelta>> {
    if (!isUuidText(runId) || !validReplayOffset(cursor)) return { rows: [], total: 0 };
    const [counted] = await this.db.select({ total: sql<number>`count(*)::int` }).from(auditEvents)
      .where(and(eq(auditEvents.aggregateId, runId), eq(auditEvents.eventType, 'execution.observations-registered')));
    const rows = await this.db
      .select({ sequence: auditEvents.sequence, occurredAt: auditEvents.occurredAt, payload: auditEvents.payload })
      .from(auditEvents)
      .where(and(eq(auditEvents.aggregateId, runId), eq(auditEvents.eventType, 'execution.observations-registered')))
      .orderBy(asc(auditEvents.sequence))
      .limit(Math.min(limit, REPLAY_PAGE_SIZE)).offset(cursor);
    return { total: Number(counted?.total ?? 0), rows: rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        sequence: Number(row.sequence),
        occurredAt: row.occurredAt.toISOString(),
        workItemId: typeof payload['workItemId'] === 'string' ? payload['workItemId'] : null,
        stepExecutionId: typeof payload['stepExecutionId'] === 'string' ? payload['stepExecutionId'] : null,
        registered: typeof payload['registered'] === 'number' ? payload['registered'] : 0,
      };
    }) };
  }

  /** Locate a retained question without exposing a foreign Run's wait. */
  async readReplayWaitCursor(runId: string, waitId: string): Promise<number | null> {
    if (!isUuidText(runId) || !isUuidText(waitId)) return null;
    const rows = await this.db.execute<{ cursor: number }>(sql`
      WITH ranked AS (
        SELECT wait_id, row_number() OVER (ORDER BY opened_at, wait_id) - 1 AS ordinal
        FROM run_wait WHERE run_id = ${runId}::uuid AND kind <> 'pause'
      ) SELECT ((ordinal / ${REPLAY_PAGE_SIZE}) * ${REPLAY_PAGE_SIZE})::int AS cursor
        FROM ranked WHERE wait_id = ${waitId}::uuid
    `);
    return rows[0]?.cursor ?? null;
  }

  /** Complete registration history, aggregated once in SQL, bounded by requested frames. */
  async readReplayObservationCounts(runId: string, frames: readonly RunFrameRow[]): Promise<ReadonlyMap<string, number>> {
    if (!isUuidText(runId) || frames.length === 0) return new Map();
    if (frames.length > REPLAY_FRAME_LIMIT) throw new RangeError('Replay frame page exceeds its bound');
    const instants = [...new Set(frames.map(frame => new Date(frame.actionStartedAt).toISOString()))];
    const rows = await this.db.execute<{ instant: string; observations: string }>(sql`
      WITH requested AS (SELECT value::timestamptz AS instant FROM jsonb_array_elements_text(${JSON.stringify(instants)}::jsonb)),
      changes AS (
        SELECT ev.occurred_at AS instant,
          sum(CASE WHEN jsonb_typeof(ev.payload->'registered') = 'number'
            THEN (ev.payload->>'registered')::numeric ELSE 0 END) AS delta
        FROM audit_events ev WHERE ev.aggregate_id = ${runId}
          AND ev.event_type = 'execution.observations-registered'
          AND ev.occurred_at <= (SELECT max(instant) FROM requested)
        GROUP BY ev.occurred_at
        UNION ALL SELECT instant, 0::numeric FROM requested
      ), totals AS MATERIALIZED (
        SELECT instant, sum(sum(delta)) OVER (ORDER BY instant ROWS UNBOUNDED PRECEDING) AS observations
        FROM changes GROUP BY instant
      ) SELECT instant::text, observations::text FROM totals WHERE instant IN (SELECT instant FROM requested)
    `);
    const byInstant = new Map(rows.map(row => [new Date(row.instant).getTime(), Number(row.observations)]));
    return new Map(frames.map(frame => [frame.evidenceId, byInstant.get(Date.parse(frame.actionStartedAt)) ?? 0]));
  }

  /** The agent phase's own position, read from its checkpoint; `null` before the phase starts. */
  async readAgentWorkPosition(runId: string): Promise<RunAgentWorkPosition | null> {
    if (!isUuidText(runId)) return null;
    const [row] = await this.db
      .select({ status: runAgentWork.status, workItemId: runAgentWork.workItemId, waitId: runAgentWork.waitId })
      .from(runAgentWork)
      .where(eq(runAgentWork.runId, runId));
    return row === undefined ? null : { status: row.status, workItemId: row.workItemId, waitId: row.waitId };
  }

  async readResult(runId: string): Promise<RunResultRow | null> {
    if (!isUuidText(runId)) return null;
    const row = (await this.db.select().from(runResult).where(eq(runResult.runId, runId)))[0];
    if (!row) return null;
    return {
      version: row.version,
      outcome: row.outcome,
      outcomeRow: row.outcomeRow,
      sealed: row.sealed,
      gatePassed: row.gatePassed,
      sealedAt: row.sealedAt.toISOString(),
      scope: row.scope,
      publication: isRunResultPublication(row.publication) ? row.publication : null,
    };
  }

  /**
   * The §H rows, in the order the ADDENDUM writes them.
   *
   * Not alphabetically, and not "failed first": the checklist is a transcription of a
   * table, and the surface re-orders it for an Inconclusive Run rather than the read
   * doing it, so the same rows in the same order are behind both presentations.
   */
  async readGateChecks(runId: string): Promise<readonly RunGateRow[]> {
    if (!isUuidText(runId)) return [];
    const rows = await this.db
      .select()
      .from(runGateCheck)
      .where(eq(runGateCheck.runId, runId))
      .orderBy(asc(runGateCheck.checkName));
    return rows.map((row) => ({
      check: row.checkName as GateCheckName,
      outcome: row.outcome as GateOutcome,
      diagnostics: row.diagnostics,
      targetSystems: row.targetSystems,
      workItems: row.workItems,
      records: row.records,
      total: row.total,
    }));
  }

  /**
   * Every registered or reserved Evidence item, with the step that produced it.
   *
   * The population artifact is NOT here: it lives in `population_evidence` and is read by
   * `PostgresPopulationRepository.readPopulation`, which already returns it with the
   * acquisition's own state. Two reads of one row would be two answers to one question.
   */
  async readEvidenceItems(runId: string): Promise<readonly RunEvidenceItem[]> {
    if (!isUuidText(runId)) return [];
    const items = await this.db
      .select()
      .from(runEvidence)
      .where(eq(runEvidence.runId, runId))
      .orderBy(asc(runEvidence.kind), asc(runEvidence.objectKey))
      .limit(RUN_DETAIL_PAGE_SIZE);
    if (items.length === 0) return [];
    const steps = await this.db
      .select({ stepId: runSessionStep.stepId, displayName: runSessionStep.displayName, evidenceId: runSessionStep.evidenceId })
      .from(runSessionStep)
      .where(eq(runSessionStep.runId, runId));
    const workItems = await this.db
      .select({ stepId: runWorkItem.stepId, displayName: runWorkItem.displayName, evidenceId: runWorkItem.evidenceId, workItemId: runWorkItem.workItemId })
      .from(runWorkItem)
      .where(eq(runWorkItem.runId, runId));
    const producers = new Map<string, { stepId: string; displayName: string; workItemId: string | null }>();
    for (const step of steps) {
      if (step.evidenceId !== null) producers.set(step.evidenceId, { stepId: step.stepId, displayName: step.displayName, workItemId: null });
    }
    for (const item of workItems) {
      if (item.evidenceId !== null) producers.set(item.evidenceId, { stepId: item.stepId, displayName: item.displayName, workItemId: item.workItemId });
    }
    return items.map((item): RunEvidenceItem => {
      const producer = producers.get(item.evidenceId) ?? null;
      return {
        evidenceId: item.evidenceId,
        kind: item.kind,
        registrationId: item.registrationId,
        objectKey: item.objectKey,
        mediaType: item.mediaType,
        digest: item.digest,
        size: item.size,
        state: item.state,
        required: item.required,
        stepId: producer?.stepId ?? null,
        displayName: producer?.displayName ?? null,
        workItemId: producer?.workItemId ?? null,
        capturedAt: item.capturedAt === null ? null : item.capturedAt.toISOString(),
        captureMethod: item.captureMethod,
        captureTimeSource: item.captureTimeSource,
      };
    });
  }

  /**
   * Evidence metadata for a bounded set of selected Observation references.
   *
   * The Evidence tab's overview read is intentionally capped and ordered for the
   * artifact list. A record inspector can select an Observation beyond that sample,
   * so it must resolve only the exact ids named by that Observation rather than treating
   * the overview sample as an authorization boundary. This read never touches object
   * storage or returns bytes; the protected frame and snapshot routes do that on demand.
   */
  async readEvidenceItemsByIds(
    runId: string,
    evidenceIds: readonly string[],
  ): Promise<readonly RunEvidenceItem[]> {
    if (!isUuidText(runId)) return [];
    const ids = [...new Set(evidenceIds.filter(isUuidText))].slice(0, 64);
    if (ids.length === 0) return [];
    const items = await this.db
      .select()
      .from(runEvidence)
      .where(and(eq(runEvidence.runId, runId), inArray(runEvidence.evidenceId, ids)))
      .orderBy(asc(runEvidence.kind), asc(runEvidence.objectKey));
    if (items.length === 0) return [];
    const steps = await this.db
      .select({ stepId: runSessionStep.stepId, displayName: runSessionStep.displayName, evidenceId: runSessionStep.evidenceId })
      .from(runSessionStep)
      .where(and(eq(runSessionStep.runId, runId), inArray(runSessionStep.evidenceId, ids)));
    const workItems = await this.db
      .select({ stepId: runWorkItem.stepId, displayName: runWorkItem.displayName, evidenceId: runWorkItem.evidenceId, workItemId: runWorkItem.workItemId })
      .from(runWorkItem)
      .where(and(eq(runWorkItem.runId, runId), inArray(runWorkItem.evidenceId, ids)));
    const producers = new Map<string, { stepId: string; displayName: string; workItemId: string | null }>();
    for (const step of steps) {
      if (step.evidenceId !== null) producers.set(step.evidenceId, { stepId: step.stepId, displayName: step.displayName, workItemId: null });
    }
    for (const item of workItems) {
      if (item.evidenceId !== null) producers.set(item.evidenceId, { stepId: item.stepId, displayName: item.displayName, workItemId: item.workItemId });
    }
    return items.map((item): RunEvidenceItem => {
      const producer = producers.get(item.evidenceId) ?? null;
      return {
        evidenceId: item.evidenceId,
        kind: item.kind,
        registrationId: item.registrationId,
        objectKey: item.objectKey,
        mediaType: item.mediaType,
        digest: item.digest,
        size: item.size,
        state: item.state,
        required: item.required,
        stepId: producer?.stepId ?? null,
        displayName: producer?.displayName ?? null,
        workItemId: producer?.workItemId ?? null,
        capturedAt: item.capturedAt === null ? null : item.capturedAt.toISOString(),
        captureMethod: item.captureMethod,
        captureTimeSource: item.captureTimeSource,
      };
    });
  }

  /**
   * A bounded sample of Observations with their grounding, and the exact total.
   *
   * Ordered by the record key so two reads of the same Run show the same records: the
   * Observation id is derived from the Work Item and the record key, so it is stable, but
   * it is a UUIDv8 and reads as arbitrary to a person comparing two pages.
   */
  async readObservations(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<Bounded<RunObservationRow>> {
    if (!isUuidText(runId)) return { rows: [], total: 0 };
    const counted = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(runObservation)
      .where(eq(runObservation.runId, runId));
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { rows: [], total: 0 };
    const rows = await this.db
      .select()
      .from(runObservation)
      .where(eq(runObservation.runId, runId))
      .orderBy(asc(runObservation.targetSystem), asc(runObservation.populationRecordKey))
      .limit(Math.min(limit, RUN_DETAIL_PAGE_SIZE));
    return { total, rows: await this.projectObservations(runId, rows) };
  }

  /**
   * Exact Observation rows by id, independent of the overview's page.
   *
   * Two callers: the record inspector (the selected record's Observations, from the
   * authorized record-review projection) and the Exceptions tab (the Observations its
   * findings were raised on — `readObservations` is a bounded PAGE ordered by Target System
   * and record key, so resolving a finding from it would leave one past the fiftieth row
   * with no captured value to show). The Run predicate is repeated so a stale or forged id
   * can only resolve to an Observation in this Run, and the list is bounded at the page
   * size both callers' own reads already have.
   */
  async readObservationsByIds(
    runId: string,
    observationIds: readonly string[],
  ): Promise<readonly RunObservationRow[]> {
    if (!isUuidText(runId)) return [];
    const ids = [...new Set(observationIds.filter(isUuidText))].slice(0, RUN_DETAIL_PAGE_SIZE);
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(runObservation)
      .where(and(eq(runObservation.runId, runId), inArray(runObservation.observationId, ids)))
      .orderBy(asc(runObservation.targetSystem), asc(runObservation.populationRecordKey));
    return this.projectObservations(runId, rows);
  }

  private async projectObservations(
    runId: string,
    rows: readonly (typeof runObservation.$inferSelect)[],
  ): Promise<readonly RunObservationRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.observationId);
    const absenceRows = ids.length === 0 ? [] : await this.db.select().from(runObservationAbsence)
      .where(and(eq(runObservationAbsence.runId, runId), inArray(runObservationAbsence.observationId, ids)));
    const absence = new Map(absenceRows.map(row => [row.observationId, readAbsenceMetadata(row)]));
    const checks = ids.length === 0 ? [] : await this.db
      .select()
      .from(runObservationCheck)
      .where(inArray(runObservationCheck.observationId, ids))
      .orderBy(asc(runObservationCheck.checkName));
    const byObservation = new Map<string, { check: string; outcome: string; diagnostic: string | null }[]>();
    for (const check of checks) {
      const list = byObservation.get(check.observationId) ?? [];
      list.push({ check: check.checkName, outcome: check.outcome, diagnostic: check.diagnostic });
      byObservation.set(check.observationId, list);
    }
    return rows.map((row): RunObservationRow => observationRow(row, absence, byObservation));
  }

  /**
   * Resolve one recorded grounding for the protected snapshot route.
   *
   * The normal Observation projection is intentionally capped at 50 rows. An inspector
   * link can target any row in a larger Run, so resolving it from that sample would turn a
   * valid link into a false authorization refusal. PostgreSQL narrows the JSONB candidates
   * and returns at most two matches; the second row is retained solely to refuse an
   * ambiguous evidence/locator pair rather than choosing an arbitrary Observation.
   */
  async readObservationGrounding(
    runId: string,
    evidenceId: string,
    locator: string,
  ): Promise<ObservationAttribute | null> {
    if (!isUuidText(runId) || !isUuidText(evidenceId) || locator.length === 0 || locator.length > 1024) return null;
    const rows = await this.db
      .select({ identity: runObservation.identity, attributes: runObservation.attributes })
      .from(runObservation)
      .where(and(
        eq(runObservation.runId, runId),
        sql`(
          (
            ${runObservation.identity}->'grounding'->>'evidenceId' = ${evidenceId}
            AND ${runObservation.identity}->'grounding'->>'locator' = ${locator}
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${runObservation.attributes}) AS attribute
            WHERE attribute->'grounding'->>'evidenceId' = ${evidenceId}
              AND attribute->'grounding'->>'locator' = ${locator}
          )
        )`,
      ))
      .limit(2);
    let match: ObservationAttribute | null = null;
    let count = 0;
    for (const row of rows) {
      const candidates = row.identity === null ? row.attributes : [row.identity, ...row.attributes];
      for (const candidate of candidates) {
        if (candidate.grounding?.evidenceId !== evidenceId || candidate.grounding.locator !== locator) continue;
        count += 1;
        match = candidate;
      }
    }
    return count === 1 ? match : null;
  }

  /** Exact recorded empty-result proof, independent of the 50-row Observation sample. */
  async readAbsenceEvidence(runId: string, observationId: string, evidenceId: string): Promise<RunObservationAbsence | null> {
    if (![runId, observationId, evidenceId].every(isUuidText)) return null;
    const rows = await this.db.select({ metadata: runObservationAbsence, evidenceIds: runObservation.evidenceIds })
      .from(runObservationAbsence)
      .innerJoin(runObservation, and(eq(runObservation.observationId, runObservationAbsence.observationId), eq(runObservation.runId, runObservationAbsence.runId)))
      .where(and(eq(runObservationAbsence.runId, runId), eq(runObservationAbsence.observationId, observationId), eq(runObservation.found, 'false'))).limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    const metadata = readAbsenceMetadata(row.metadata);
    return metadata.integrityValid && metadata.proof?.emptyResultEvidenceId === evidenceId && row.evidenceIds.includes(evidenceId) ? metadata : null;
  }

  /** Every Exception this Run raised, ordered by identifier (EXPERIENCE.md, Open Question 2). */
  async readExceptions(runId: string, limit = RUN_DETAIL_PAGE_SIZE, cursor = 0): Promise<Bounded<RunExceptionRow>> {
    if (!isUuidText(runId) || !validReplayOffset(cursor)) return { rows: [], total: 0 };
    const counted = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(runException)
      .where(eq(runException.runId, runId));
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { rows: [], total: 0 };
    const rows = await this.db
      .select()
      .from(runException)
      .where(eq(runException.runId, runId))
      .orderBy(asc(runException.exceptionId))
      .limit(Math.min(limit, REPLAY_PAGE_SIZE)).offset(cursor);
    const observationIds = rows.map((row) => row.observationId);
    const effectiveRows = observationIds.length === 0 ? [] : await this.db
      .select({
        observationId: runObservationEvaluation.observationId,
        conditionId: runObservationEvaluation.conditionId,
      })
      .from(runObservationEvaluation)
      .leftJoin(runEvaluationReview, evaluationReviewJoin)
      .where(and(
        eq(runObservationEvaluation.runId, runId),
        inArray(runObservationEvaluation.observationId, observationIds),
        eq(effectiveEvaluationValue, 'EXCEPTION'),
      ))
      .orderBy(asc(runObservationEvaluation.observationId), asc(runObservationEvaluation.conditionId));
    const effectiveByObservation = new Map<string, string[]>();
    for (const row of effectiveRows) {
      const conditions = effectiveByObservation.get(row.observationId) ?? [];
      conditions.push(row.conditionId);
      effectiveByObservation.set(row.observationId, conditions);
    }
    return {
      total,
      rows: rows.map((row): RunExceptionRow => ({
        exceptionId: row.exceptionId,
        observationId: row.observationId,
        workItemId: row.workItemId,
        targetSystem: row.targetSystem,
        populationRecordKey: row.populationRecordKey,
        conditionIds: row.conditionIds,
        effectiveConditionIds: effectiveByObservation.get(row.observationId) ?? [],
        diagnostics: row.diagnostics,
        fingerprint: row.fingerprint,
        raisedAt: row.raisedAt.toISOString(),
      })),
    };
  }

  /** The per-condition evaluations of the named Observations, for the evaluation cards. */
  async readEvaluations(runId: string, observationIds: readonly string[]): Promise<readonly RunEvaluationRow[]> {
    if (!isUuidText(runId) || observationIds.length === 0) return [];
    const ids = observationIds.filter((id) => isUuidText(id)).slice(0, RUN_DETAIL_PAGE_SIZE);
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ evaluation: runObservationEvaluation, review: runEvaluationReview })
      .from(runObservationEvaluation)
      .leftJoin(runEvaluationReview, evaluationReviewJoin)
      .where(and(eq(runObservationEvaluation.runId, runId), inArray(runObservationEvaluation.observationId, ids)))
      .orderBy(asc(runObservationEvaluation.observationId), asc(runObservationEvaluation.conditionId));
    return rows.map(({ evaluation: row, review }): RunEvaluationRow => ({
      observationId: row.observationId,
      conditionId: row.conditionId,
      origin: (review?.effectiveOrigin ?? row.origin) as EvaluationOrigin,
      value: (review?.effectiveValue ?? row.value) as EvaluationValue,
      confirmation: (review ? review.effectiveConfirmation : row.confirmation) as EvaluationConfirmation | null,
      confidence: review?.action === 'reject' ? null : row.confidence,
      rationale: review?.action === 'reject' ? review.rejectionRationale : row.rationale,
      diagnostic: row.diagnostic,
      machineProposal: row.agentProposedValue !== null && row.agentProposedConfidence !== null && row.agentProposedRationale !== null
        ? { value: row.agentProposedValue as EvaluationValue, confidence: row.agentProposedConfidence, rationale: row.agentProposedRationale }
        : row.origin === 'AGENT_JUDGED' && row.confidence !== null && row.rationale !== null
          ? { value: row.value as EvaluationValue, confidence: row.confidence, rationale: row.rationale } : null,
      reviewDecision: review ? { action: review.action as 'confirm' | 'reject', actorId: review.actorId, decidedAt: review.decidedAt.toISOString(), rejectionRationale: review.rejectionRationale } : null,
    }));
  }

  /** Count every remaining pending condition, independently of the bounded display page. */
  async readPendingEvaluationCount(runId: string): Promise<number> {
    if (!isUuidText(runId)) return 0;
    const [row] = await this.db.select({ total: sql<number>`count(*)::int` })
      .from(runObservationEvaluation).leftJoin(runEvaluationReview, evaluationReviewJoin)
      .where(and(eq(runObservationEvaluation.runId, runId), eq(effectiveEvaluationConfirmation, 'pending')));
    return row?.total ?? 0;
  }

  /** Separate mutable decision revision; the sealed Result wire contract remains unchanged. */
  async readReviewRevision(runId: string): Promise<number> {
    if (!isUuidText(runId)) return 0;
    const [row] = await this.db.select({ revision: runResultReview.revision }).from(runResultReview).where(eq(runResultReview.runId, runId));
    return row?.revision ?? 0;
  }

  /**
   * The Execution Timeline's own read.
   *
   * A surface must not borrow another read's shape: `readPopulation` and `readExecution`
   * answer the acquisition and extraction STAGES with the fields those sections show, and
   * neither returns the timestamps a Timeline row needs. This returns the three levels
   * with their clocks and nothing else.
   */
  async readTimeline(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<RunTimelineRead> {
    const empty: RunTimelineRead = { workspace: null, population: null, execution: null, sessionSteps: [], workItems: [], stepExecutions: { rows: [], total: 0 }, toolActions: { rows: [], total: 0 } };
    if (!isUuidText(runId)) return empty;
    // Explicit projection: do not even read the provider capability for an auditor surface.
    const [workspace] = await this.db.select({
      status: runWorkspace.status, attempts: runWorkspace.attempts, diagnostic: runWorkspace.diagnostic,
      stepId: runWorkspace.stepId, mode: runWorkspace.mode,
      startedAt: runWorkspace.startedAt, releasedAt: runWorkspace.releasedAt,
    }).from(runWorkspace).where(eq(runWorkspace.runId, runId));
    const [population] = await this.db.select().from(populationExecution).where(eq(populationExecution.runId, runId));
    const [execution] = await this.db.select().from(runExecution).where(eq(runExecution.runId, runId));
    const sessionSteps = await this.db
      .select()
      .from(runSessionStep)
      .where(eq(runSessionStep.runId, runId))
      .orderBy(asc(runSessionStep.ordinal));
    const workItems = await this.db
      .select()
      .from(runWorkItem)
      .where(eq(runWorkItem.runId, runId))
      .orderBy(asc(runWorkItem.ordinal));
    const stepExecutions = await this.readStepExecutions(runId, limit);
    return {
      workspace: workspace
        ? {
            status: workspace.status,
            attempts: workspace.attempts,
            diagnostic: workspace.diagnostic,
            stepId: workspace.stepId,
            mode: workspace.mode,
            reference: workspaceReference(runId),
            startedAt: workspace.startedAt.toISOString(),
            releasedAt: workspace.releasedAt === null ? null : workspace.releasedAt.toISOString(),
          }
        : null,
      population: population
        ? {
            status: population.status,
            attempts: population.attempts,
            diagnostic: population.diagnostic,
            stepId: population.stepId,
            startedAt: population.startedAt.toISOString(),
            attemptStartedAt: population.attemptStartedAt.toISOString(),
          }
        : null,
      execution: execution
        ? {
            status: execution.status,
            attempts: execution.attempts,
            diagnostic: execution.diagnostic,
            startedAt: execution.startedAt.toISOString(),
            runStartedAt: execution.runStartedAt.toISOString(),
          }
        : null,
      sessionSteps: sessionSteps.map((row) => ({
        stepId: row.stepId,
        ordinal: row.ordinal,
        displayName: row.displayName,
        action: row.action,
        registrationId: row.registrationId,
        state: row.state,
        attempts: row.attempts,
        diagnostic: row.diagnostic,
        evidenceId: row.evidenceId,
      })),
      workItems: workItems.map((row) => ({
        workItemId: row.workItemId,
        subjectKey: row.subjectKey,
        stepId: row.stepId,
        ordinal: row.ordinal,
        displayName: row.displayName,
        registrationId: row.registrationId,
        state: row.state,
        attempts: row.attempts,
        cycles: row.cycles,
        diagnostic: row.diagnostic,
        evidenceId: row.evidenceId,
        observations: row.observations,
      })),
      stepExecutions,
      toolActions: await this.readToolActions(runId, limit),
    };
  }

  /**
   * Every Tool Action, oldest first, bounded like every other list this surface renders.
   *
   * Ordered by `(started_at, tool_action_id)` — the id is a UUIDv7, so the tiebreak is
   * deterministic rather than arbitrary, which is the same reason the Runs list keysets on
   * it. An exact total beside a bounded sample: a Run that took ten thousand actions must
   * still render, and a count that silently stopped at the sample size would understate the
   * case that matters.
   */
  async readToolActions(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<Bounded<RunTimelineToolAction>> {
    if (!isUuidText(runId)) return { rows: [], total: 0 };
    const counted = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(runToolAction)
      .where(eq(runToolAction.runId, runId));
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { rows: [], total: 0 };
    const rows = await this.db
      .select()
      .from(runToolAction)
      .where(eq(runToolAction.runId, runId))
      .orderBy(asc(runToolAction.startedAt), asc(runToolAction.toolActionId))
      .limit(limit);
    return {
      total,
      rows: rows.map((row) => ({
        toolActionId: row.toolActionId,
        stepExecutionId: row.stepExecutionId,
        surface: row.surface,
        action: row.action,
        method: row.method,
        destination: row.destination,
        outcome: row.outcome,
        denial: row.denial,
        status: row.status,
        redirected: row.redirected,
        downloads: row.downloads,
        capture: row.capture,
        captureSuppression: row.captureSuppression,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
        diagnostic: row.diagnostic,
      })),
    };
  }

  /** Every Step Execution, oldest first — the order the Timeline is read in. */
  /**
   * How far through its plan a Run has got, in LOGICAL steps, counted EXACTLY
   * (UI cleanup 2026-09-22, UX-47).
   *
   * Live View's counter read "Step 7 of 6" after a pause and a resume, because its
   * numerator was `run_step_execution`'s row total — ATTEMPTS, and a pause supersedes one
   * attempt and the resume starts another. Counting distinct plan steps over the bounded
   * page `readStepExecutions` returns would trade that defect for its opposite: a long Run
   * whose first fifty attempts had not yet reached a later plan step would report fewer
   * steps than it had started. So the three facts are aggregates over EVERY row:
   *
   * - `started`: distinct plan steps with at least one Step Execution, restricted to the
   *   ids the frozen plan declares when the caller has them — so `started` can never pass
   *   the plan's own step count, by construction rather than by clamping;
   * - `units`: distinct (plan step, Work Item) pairs, the work actually done;
   * - `retries`: every attempt beyond the first.
   */
  async readLogicalStepProgress(
    runId: string,
    planStepIds: readonly string[] | null,
  ): Promise<{ readonly started: number; readonly units: number; readonly retries: number }> {
    if (!isUuidText(runId)) return { started: 0, units: 0, retries: 0 };
    const declared = planStepIds === null
      ? sql`true`
      : planStepIds.length === 0
        ? sql`false`
        : inArray(runStepExecution.planStepId, [...planStepIds]);
    const [row] = await this.db
      .select({
        started: sql<number>`count(DISTINCT ${runStepExecution.planStepId}) FILTER (WHERE ${declared})::int`,
        units: sql<number>`count(DISTINCT ${runStepExecution.planStepId} || '|' || coalesce(${runStepExecution.workItemId}::text, ''))::int`,
        retries: sql<number>`count(*) FILTER (WHERE ${runStepExecution.attempt} > 1)::int`,
      })
      .from(runStepExecution)
      .where(eq(runStepExecution.runId, runId));
    return {
      started: Number(row?.started ?? 0),
      units: Number(row?.units ?? 0),
      retries: Number(row?.retries ?? 0),
    };
  }

  async readStepExecutions(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<Bounded<RunStepExecutionRow>> {
    if (!isUuidText(runId)) return { rows: [], total: 0 };
    const counted = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(runStepExecution)
      .where(eq(runStepExecution.runId, runId));
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { rows: [], total: 0 };
    const rows = await this.db
      .select()
      .from(runStepExecution)
      .where(eq(runStepExecution.runId, runId))
      .orderBy(asc(runStepExecution.startedAt), asc(runStepExecution.stepExecutionId))
      .limit(Math.min(limit, REPLAY_PAGE_SIZE));
    return { total, rows: rows.map(stepExecutionRow) };
  }

  /**
   * The Step Execution a Run is on now: its NEWEST, read on its own (UI cleanup
   * 2026-09-23).
   *
   * Live View and the Auditor Workspace both name the step a Run is working. They took the
   * newest row of the page `readStepExecutions` returns — which is the OLDEST fifty — so a
   * Run with more attempts than a page holds was said to be on a step it finished long ago.
   * The order is that page's, reversed, so the answer is the one `currentStepExecution` in
   * `live-view.ts` gives over EVERY row, and the integration test holds the two together.
   */
  async readLatestStepExecution(runId: string): Promise<RunStepExecutionRow | null> {
    if (!isUuidText(runId)) return null;
    const [row] = await this.db
      .select()
      .from(runStepExecution)
      .where(eq(runStepExecution.runId, runId))
      .orderBy(desc(runStepExecution.startedAt), desc(runStepExecution.stepExecutionId))
      .limit(1);
    return row === undefined ? null : stepExecutionRow(row);
  }

  /**
   * One Step Execution of this Run by id, wherever it sits in the Run's history: the one
   * a frame was captured in is not necessarily on the first page of a long Run.
   */
  async readStepExecution(runId: string, stepExecutionId: string): Promise<RunStepExecutionRow | null> {
    if (!isUuidText(runId) || !isUuidText(stepExecutionId)) return null;
    const [row] = await this.db
      .select()
      .from(runStepExecution)
      .where(and(eq(runStepExecution.runId, runId), eq(runStepExecution.stepExecutionId, stepExecutionId)))
      .limit(1);
    return row === undefined ? null : stepExecutionRow(row);
  }
}

function stepExecutionRow(row: typeof runStepExecution.$inferSelect): RunStepExecutionRow {
  return {
    stepExecutionId: row.stepExecutionId,
    planStepId: row.planStepId,
    workItemId: row.workItemId,
    action: row.action,
    state: row.state,
    attempt: row.attempt,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    diagnostic: row.diagnostic,
  };
}

function frameRow(row: {
  readonly evidenceId: string;
  readonly digest: string | null;
  readonly size: number | null;
  readonly mediaType: string | null;
  readonly capturedAt: Date | null;
  readonly toolActionId: string;
  readonly sourceLocation: string;
  readonly stepExecutionId: string;
  readonly workItemId: string | null;
  readonly action: string;
  readonly actionStartedAt: Date;
}): RunFrameRow | null {
  // A REGISTERED row carries a digest, a size and a media type by CHECK; a row that does
  // not is not a frame this build can serve, and is absence rather than a partial frame.
  if (row.digest === null || row.size === null || row.mediaType === null) return null;
  return {
    evidenceId: row.evidenceId,
    toolActionId: row.toolActionId,
    stepExecutionId: row.stepExecutionId,
    workItemId: row.workItemId,
    action: row.action,
    digest: row.digest,
    size: row.size,
    mediaType: row.mediaType,
    sourceLocation: row.sourceLocation,
    capturedAt: row.capturedAt === null ? null : row.capturedAt.toISOString(),
    actionStartedAt: row.actionStartedAt.toISOString(),
  };
}

function validReplayOffset(cursor: number): boolean {
  return Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= 2_147_483_500 && cursor % REPLAY_PAGE_SIZE === 0;
}
