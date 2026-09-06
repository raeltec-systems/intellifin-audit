import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  EvaluationConfirmation,
  EvaluationOrigin,
  EvaluationValue,
  GateCheckName,
  GateDiagnostic,
  GateOutcome,
  ObservationAttribute,
  ObservationCoverage,
  ObservationFound,
  OutcomeRowId,
  RunResultPublication,
  SystemOutcome,
} from '@intellifin/domain';
import { isRunResultPublication } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import {
  populationExecution,
  runEvidence,
  runException,
  runGateCheck,
  runObservation,
  runObservationCheck,
  runObservationEvaluation,
  runExecution,
  runResult,
  runSessionStep,
  runStepExecution,
  runWorkItem,
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
   * When the Step Execution that froze this artifact completed.
   *
   * `run_evidence` records NO capture time of its own (see the Story 3.11 note in
   * `CLAUDE.md`), so this is the recorded instant of the step that uploaded, verified and
   * registered the bytes. It is `null` when no Step Execution for that plan step has
   * completed, and the surface says so in words rather than showing a dash.
   */
  readonly capturedAt: string | null;
}

export interface RunObservationRow {
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
}

export interface RunExceptionRow {
  readonly exceptionId: string;
  readonly observationId: string;
  readonly workItemId: string;
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  readonly conditionIds: readonly string[];
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
  readonly registrationId: string;
  readonly state: string;
  readonly attempts: number;
  readonly diagnostic: string | null;
  readonly evidenceId: string | null;
}

export interface RunTimelineWorkItem extends Omit<RunTimelineSessionStep, 'ordinal'> {
  readonly workItemId: string;
  readonly ordinal: number;
  readonly cycles: number;
  readonly observations: number;
}

export interface RunTimelineRead {
  readonly population: (RunTimelineStage & { readonly stepId: string; readonly attemptStartedAt: string }) | null;
  readonly execution: (RunTimelineStage & { readonly runStartedAt: string }) | null;
  readonly sessionSteps: readonly RunTimelineSessionStep[];
  readonly workItems: readonly RunTimelineWorkItem[];
  readonly stepExecutions: Bounded<RunStepExecutionRow>;
}

export class DrizzleRunDetailRepository {
  constructor(private readonly db: Database | Transaction) {}

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
    // The completion of the LAST Step Execution of a plan step: an artifact is uploaded,
    // verified and registered inside the step that produced it, and a retried step froze
    // its bytes on the attempt that succeeded.
    const completions = await this.db.execute<{ plan_step_id: string; completed_at: Date | string }>(sql`
      SELECT ${runStepExecution.planStepId} AS plan_step_id, max(${runStepExecution.completedAt}) AS completed_at
      FROM ${runStepExecution}
      WHERE ${runStepExecution.runId} = ${runId} AND ${runStepExecution.completedAt} IS NOT NULL
      GROUP BY ${runStepExecution.planStepId}`);
    const completedAt = new Map(
      completions.map((row) => [
        row.plan_step_id,
        row.completed_at instanceof Date ? row.completed_at.toISOString() : new Date(row.completed_at).toISOString(),
      ]),
    );
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
        capturedAt: producer === null ? null : completedAt.get(producer.stepId) ?? null,
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
    return {
      total,
      rows: rows.map((row): RunExceptionRow => ({
        exceptionId: row.exceptionId,
        observationId: row.observationId,
        workItemId: row.workItemId,
        targetSystem: row.targetSystem,
        populationRecordKey: row.populationRecordKey,
        conditionIds: row.conditionIds,
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
      .select()
      .from(runObservationEvaluation)
      .where(and(eq(runObservationEvaluation.runId, runId), inArray(runObservationEvaluation.observationId, ids)))
      .orderBy(asc(runObservationEvaluation.observationId), asc(runObservationEvaluation.conditionId));
    return rows.map((row): RunEvaluationRow => ({
      observationId: row.observationId,
      conditionId: row.conditionId,
      origin: row.origin as EvaluationOrigin,
      value: row.value as EvaluationValue,
      confirmation: row.confirmation as EvaluationConfirmation | null,
      confidence: row.confidence,
      rationale: row.rationale,
      diagnostic: row.diagnostic,
    }));
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
    const empty: RunTimelineRead = { population: null, execution: null, sessionSteps: [], workItems: [], stepExecutions: { rows: [], total: 0 } };
    if (!isUuidText(runId)) return empty;
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
