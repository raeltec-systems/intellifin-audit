import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  GateCheckRow,
  RunGatePopulationFacts,
  RunResultContext,
  StoredRunResult,
} from '@intellifin/application';
import {
  GATE_AFFECTED_LIMIT,
  POPULATION_LIMITS,
  RESULT_SAMPLE_LIMIT,
  type CoverageObservation,
  type GateCheckResult,
  type ObservationAttribute,
  type OutcomeRowId,
  type PopulationCheck,
  type PopulationGateRow,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFinding,
  type RunResultFindings,
  type RunResultPublication,
  type SystemOutcome,
} from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import {
  auditRun,
  populationRow,
  populationSnapshot,
  runGateCheck,
  runObservation,
  runObservationEvaluation,
  runResult,
} from '../db/schema.js';

/**
 * The facts a Run's Result and its Run-level Gate are decided on, in ONE place.
 *
 * Both execution stages reach a terminal transition, and both must complete the Run there:
 * `PostgresPopulationRepository` for a Run that fails before its first Work Item, and
 * `PostgresAdapterExecutionRepository` for every other outcome. A second copy of these
 * reads — the population counts, the parsed rows, the Observations, the Gate rows — would
 * agree on every case anybody thought to try and diverge on the first one nobody did, and
 * here the divergence would be an audit conclusion.
 *
 * Every method is bound to the caller's transaction. Nothing here writes outside it.
 */
export function runResultContext(
  tx: Database | Transaction,
  runId: string,
): Omit<RunResultContext, keyof import('@intellifin/application').EvidencePackageContext> {
  return {
    async readGateChecks(): Promise<readonly GateCheckRow[]> {
      const rows = await tx
        .select()
        .from(runGateCheck)
        .where(eq(runGateCheck.runId, runId))
        .orderBy(asc(runGateCheck.checkName));
      return rows.map(
        (row): GateCheckRow => ({
          check: row.checkName as GateCheckResult['check'],
          outcome: row.outcome as GateCheckResult['outcome'],
          diagnostics: row.diagnostics,
          targetSystems: row.targetSystems,
          workItems: row.workItems,
          records: row.records,
          total: row.total,
        }),
      );
    },

    async saveRunState(state) {
      await tx.update(auditRun).set({ state }).where(eq(auditRun.runId, runId));
    },

    async readPopulationFacts(): Promise<RunGatePopulationFacts | null> {
      const snapshot = (
        await tx.select().from(populationSnapshot).where(eq(populationSnapshot.runId, runId))
      )[0];
      if (!snapshot) return null;
      // Counted, never derived from the three stored counts: the arithmetic §H's
      // inclusion row performs is exactly the thing a defect in them would have broken.
      const counted = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(populationRow)
        .where(eq(populationRow.runId, runId));
      const unexplained = await tx
        .select({ ordinal: populationRow.ordinal })
        .from(populationRow)
        .where(
          sql`${populationRow.runId}=${runId} AND ${populationRow.disposition} <> 'included' AND coalesce(jsonb_array_length(${populationRow.reasons}),0)=0`,
        )
        .orderBy(asc(populationRow.ordinal))
        .limit(GATE_AFFECTED_LIMIT);
      return {
        checks: snapshot.checks as readonly PopulationCheck[],
        included: snapshot.included,
        excluded: snapshot.excluded,
        indeterminate: snapshot.indeterminate,
        rowsParsed: counted[0]?.total ?? 0,
        unexplained: unexplained.map((row) => row.ordinal),
        generatedAt: snapshot.generatedAt?.toISOString() ?? null,
      };
    },

    async readPopulationRows(): Promise<readonly PopulationGateRow[]> {
      const rows = await tx
        .select({
          ordinal: populationRow.ordinal,
          values: populationRow.values,
          disposition: populationRow.disposition,
        })
        .from(populationRow)
        .where(eq(populationRow.runId, runId))
        .orderBy(asc(populationRow.ordinal))
        .limit(POPULATION_LIMITS.rows);
      return rows;
    },

    async readGateObservations(): Promise<readonly CoverageObservation[]> {
      const rows = await tx
        .select({
          targetSystem: runObservation.targetSystem,
          populationRecordKey: runObservation.populationRecordKey,
          coverage: runObservation.coverage,
          workItemId: runObservation.workItemId,
        })
        .from(runObservation)
        .where(eq(runObservation.runId, runId))
        .limit(POPULATION_LIMITS.rows);
      return rows.map((row) => ({
        ...row,
        coverage: row.coverage as CoverageObservation['coverage'],
      }));
    },

    /* ------------------------------------------------------------ Story 3.9 --- */

    async readResult(): Promise<StoredRunResult | null> {
      const row = (await tx.select().from(runResult).where(eq(runResult.runId, runId)))[0];
      if (!row) return null;
      return {
        runId: row.runId,
        version: row.version,
        outcome: row.outcome as SystemOutcome,
        row: row.outcomeRow as OutcomeRowId,
        sealed: row.sealed,
        runState: row.runState as StoredRunResult['runState'],
        gatePassed: row.gatePassed,
        sealedAt: row.sealedAt.toISOString(),
        scope: row.scope,
        publication: row.publication as RunResultPublication,
      };
    },

    /**
     * Write the Result. The FIRST one wins.
     *
     * `DO NOTHING` on the Run, exactly as the Gate's rows are inserted: the command
     * already reads the Result back before deciding, but that is a habit and this is the
     * rule. Generation 25 refuses every UPDATE but the one sealing of a pending Result,
     * so there is no path from here that can change an outcome.
     */
    async writeResult(result: StoredRunResult): Promise<void> {
      await tx
        .insert(runResult)
        .values({
          runId,
          version: result.version,
          outcome: result.outcome,
          outcomeRow: result.row,
          sealed: result.sealed,
          runState: result.runState,
          gatePassed: result.gatePassed,
          sealedAt: new Date(result.sealedAt),
          scope: result.scope,
          publication: result.publication,
        })
        .onConflictDoNothing({ target: runResult.runId });
    },

    /**
     * Every exclusion reason, with an exact total and a bounded sample of its rows.
     *
     * A row carries a LIST of reasons — an indeterminate row records the invalid columns
     * and the failing predicates together — so the reasons are unnested and counted per
     * reason. The reason text is the inclusion rule's own sentence, stored verbatim.
     */
    async readResultExclusions(): Promise<readonly RunResultExclusion[]> {
      const totals = await tx.execute<{ reason: string; total: number }>(
        sql`SELECT reason, count(*)::int AS total
            FROM (SELECT jsonb_array_elements_text(${populationRow.reasons}) AS reason
                  FROM ${populationRow}
                  WHERE ${populationRow.runId}=${runId}
                    AND ${populationRow.disposition} <> 'included') AS reasons
            GROUP BY reason ORDER BY total DESC, reason ASC
            LIMIT ${RESULT_SAMPLE_LIMIT}`,
      );
      const exclusions: RunResultExclusion[] = [];
      for (const entry of totals) {
        const records = await tx.execute<{ ordinal: number }>(
          sql`SELECT ${populationRow.ordinal} AS ordinal FROM ${populationRow}
              WHERE ${populationRow.runId}=${runId}
                AND ${populationRow.disposition} <> 'included'
                AND ${populationRow.reasons} ? ${entry.reason}
              ORDER BY ${populationRow.ordinal} ASC LIMIT ${RESULT_SAMPLE_LIMIT}`,
        );
        exclusions.push({
          reason: entry.reason,
          total: Number(entry.total),
          records: records.map((row) => `#${String(row.ordinal)}`),
        });
      }
      return exclusions;
    },

    /** Per-condition evaluation counts by origin, confirmation state and value (§B.1). */
    async readConditionCounts(): Promise<readonly RunResultConditionCount[]> {
      const rows = await tx
        .select({
          conditionId: runObservationEvaluation.conditionId,
          origin: runObservationEvaluation.origin,
          confirmation: runObservationEvaluation.confirmation,
          value: runObservationEvaluation.value,
          total: sql<number>`count(*)::int`,
        })
        .from(runObservationEvaluation)
        .where(eq(runObservationEvaluation.runId, runId))
        .groupBy(
          runObservationEvaluation.conditionId,
          runObservationEvaluation.origin,
          runObservationEvaluation.confirmation,
          runObservationEvaluation.value,
        )
        .orderBy(asc(runObservationEvaluation.conditionId), asc(runObservationEvaluation.value));
      return rows.map(
        (row): RunResultConditionCount => ({
          conditionId: row.conditionId,
          origin: row.origin as RunResultConditionCount['origin'],
          confirmation: row.confirmation as RunResultConditionCount['confirmation'],
          value: row.value as RunResultConditionCount['value'],
          total: row.total,
        }),
      );
    },

    /**
     * The records the Result names: every Exception, and every record left Unevaluated.
     *
     * An exact total beside a bounded sample. A record with BOTH an Exception and an
     * Unevaluated condition is an Exception here and nothing else: §E.1 says a Control
     * Failure lists the Unevaluated records beside it, and listing one record on both
     * lists would count it twice.
     */
    async readResultFindings(): Promise<{
      readonly exceptions: RunResultFindings;
      readonly unevaluated: RunResultFindings;
    }> {
      const raised = await tx
        .select({ observationId: runObservationEvaluation.observationId })
        .from(runObservationEvaluation)
        .where(
          and(eq(runObservationEvaluation.runId, runId), eq(runObservationEvaluation.value, 'EXCEPTION')),
        )
        .groupBy(runObservationEvaluation.observationId);
      const raisedIds = new Set(raised.map((row) => row.observationId));

      const collect = async (value: 'EXCEPTION' | 'UNEVALUATED'): Promise<RunResultFindings> => {
        const observations = await tx
          .select({ observationId: runObservationEvaluation.observationId })
          .from(runObservationEvaluation)
          .where(and(eq(runObservationEvaluation.runId, runId), eq(runObservationEvaluation.value, value)))
          .groupBy(runObservationEvaluation.observationId)
          // A bounded sample needs a deterministic order, or two Runs over identical data
          // publish different records. The Observation id is derived from the Work Item
          // and the record key, so this is stable across Runs of the same population.
          .orderBy(asc(runObservationEvaluation.observationId));
        const ids = observations
          .map((row) => row.observationId)
          .filter((id) => value === 'EXCEPTION' || !raisedIds.has(id));
        const records: RunResultFinding[] = [];
        for (const observationId of ids.slice(0, RESULT_SAMPLE_LIMIT)) {
          const observation = (
            await tx
              .select({
                populationRecordKey: runObservation.populationRecordKey,
                targetSystem: runObservation.targetSystem,
                identity: runObservation.identity,
                attributes: runObservation.attributes,
              })
              .from(runObservation)
              .where(eq(runObservation.observationId, observationId))
          )[0];
          if (!observation) continue;
          const evaluations = await tx
            .select({
              conditionId: runObservationEvaluation.conditionId,
              diagnostic: runObservationEvaluation.diagnostic,
            })
            .from(runObservationEvaluation)
            .where(
              and(
                eq(runObservationEvaluation.observationId, observationId),
                eq(runObservationEvaluation.value, value),
              ),
            )
            .orderBy(asc(runObservationEvaluation.conditionId));
          // The identity attribute is carried APART from the declared ones (§B.1 lets them
          // share a name), so both are read and the declared ones win — a Template naming
          // its identity column as a control-specific field reads the value the Target
          // System displayed for it.
          const attributes: readonly (ObservationAttribute | null)[] = [
            observation.identity,
            ...observation.attributes,
          ];
          records.push({
            populationRecordKey: observation.populationRecordKey,
            targetSystem: observation.targetSystem,
            value,
            conditionIds: evaluations.map((entry) => entry.conditionId),
            diagnostics: evaluations
              .map((entry) => entry.diagnostic)
              .filter((entry): entry is string => entry !== null),
            fields: Object.fromEntries(
              attributes
                .filter((attribute): attribute is ObservationAttribute => attribute !== null)
                .map((attribute) => [attribute.name, attribute.normalizedValue]),
            ),
          });
        }
        return { total: ids.length, records };
      };

      return { exceptions: await collect('EXCEPTION'), unevaluated: await collect('UNEVALUATED') };
    },
  };
}
