import { evaluationReviewJoin, effectiveEvaluationConfirmation, effectiveEvaluationValue } from './effective-evaluation.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { isObservationAbsenceProof, isObservationQueryKey, isRunResultPublication } from '@intellifin/domain';
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
        /** The provider's opaque session identity (Story 4.1): correlatable, never a capability. */
        readonly workspaceId: string | null;
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

/** One wait a Run held, closed or open — a Replay jump target (Story 5.8). */
export interface RunReplayWait {
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
      .where(and(
        eq(runEvidence.runId, runId),
        eq(runEvidence.kind, 'screenshot'),
        eq(runEvidence.state, 'REGISTERED'),
        ...(evidenceId === undefined ? [] : [eq(runEvidence.evidenceId, evidenceId)]),
      ))
      .orderBy(
        direction === 'asc' ? asc(runToolAction.startedAt) : desc(runToolAction.startedAt),
        direction === 'asc' ? asc(runToolAction.toolActionId) : desc(runToolAction.toolActionId),
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
      .where(and(eq(runEvidence.runId, runId), eq(runEvidence.kind, 'screenshot'), eq(runEvidence.state, 'REGISTERED')));
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
   * Every wait this Run held, oldest first — a pause among them (Story 5.8).
   *
   * A pause is a wait and is not an Escalation, so the KIND is carried and the surface
   * decides: the jump list names Escalations, and a pause is where the session stopped for
   * a person rather than for an answer.
   */
  async readWaits(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<readonly RunReplayWait[]> {
    if (!isUuidText(runId)) return [];
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
      .where(eq(runWait.runId, runId))
      .orderBy(asc(runWait.openedAt), asc(runWait.waitId))
      .limit(Math.min(limit, RUN_DETAIL_PAGE_SIZE));
    return rows.map((row) => ({
      waitId: row.waitId,
      kind: row.kind,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
      closureKind: row.closureKind,
      answerOptionId: row.answerOptionId,
    }));
  }

  /**
   * The Observation registrations of a Run, oldest first, read from the chain (Story 5.8).
   *
   * A payload field this build does not recognize is read as ABSENT rather than coerced: a
   * chain row is immutable and an older build may have written a shape this one does not
   * know, and a fabricated count would read as a fact nobody recorded.
   */
  async readObservationDeltas(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<readonly RunReplayObservationDelta[]> {
    if (!isUuidText(runId)) return [];
    const rows = await this.db
      .select({ sequence: auditEvents.sequence, occurredAt: auditEvents.occurredAt, payload: auditEvents.payload })
      .from(auditEvents)
      .where(and(eq(auditEvents.aggregateId, runId), eq(auditEvents.eventType, 'execution.observations-registered')))
      .orderBy(asc(auditEvents.sequence))
      .limit(Math.min(limit, RUN_DETAIL_PAGE_SIZE));
    return rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        sequence: Number(row.sequence),
        occurredAt: row.occurredAt.toISOString(),
        workItemId: typeof payload['workItemId'] === 'string' ? payload['workItemId'] : null,
        stepExecutionId: typeof payload['stepExecutionId'] === 'string' ? payload['stepExecutionId'] : null,
        registered: typeof payload['registered'] === 'number' ? payload['registered'] : 0,
      };
    });
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
    return {
      total,
      rows: rows.map((row): RunObservationRow => ({
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
        checks: byObservation.get(row.observationId) ?? [],
      })),
    };
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
  async readExceptions(runId: string, limit = RUN_DETAIL_PAGE_SIZE): Promise<Bounded<RunExceptionRow>> {
    if (!isUuidText(runId)) return { rows: [], total: 0 };
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
      .limit(Math.min(limit, RUN_DETAIL_PAGE_SIZE));
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
  async readTimeline(runId: string): Promise<RunTimelineRead> {
    const empty: RunTimelineRead = { workspace: null, population: null, execution: null, sessionSteps: [], workItems: [], stepExecutions: { rows: [], total: 0 }, toolActions: { rows: [], total: 0 } };
    if (!isUuidText(runId)) return empty;
    const [workspace] = await this.db.select().from(runWorkspace).where(eq(runWorkspace.runId, runId));
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
    const stepExecutions = await this.readStepExecutions(runId);
    return {
      workspace: workspace
        ? {
            status: workspace.status,
            attempts: workspace.attempts,
            diagnostic: workspace.diagnostic,
            stepId: workspace.stepId,
            mode: workspace.mode,
            workspaceId: workspace.workspaceId,
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
      toolActions: await this.readToolActions(runId),
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
      .limit(Math.min(limit, RUN_DETAIL_PAGE_SIZE));
    return {
      total,
      rows: rows.map((row): RunStepExecutionRow => ({
        stepExecutionId: row.stepExecutionId,
        planStepId: row.planStepId,
        workItemId: row.workItemId,
        action: row.action,
        state: row.state,
        attempt: row.attempt,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
        diagnostic: row.diagnostic,
      })),
    };
  }
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
