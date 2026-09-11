import type { ProcedureVersionRecord } from '@intellifin/application';
import type { Sql } from '@intellifin/infrastructure';

type PostgresJsonValue = Parameters<Sql['json']>[0];

/**
 * Insert a Procedure and Version using the columns that existed before guided
 * preparation. Keep this raw: the current Drizzle table includes
 * `section_preparation`, which is intentionally absent from historical prefixes.
 */
export async function insertHistoricalProcedureVersion(sql: Sql, row: ProcedureVersionRecord): Promise<void> {
  const json = (value: unknown) => value == null ? null : sql.json(value as PostgresJsonValue);
  await sql`INSERT INTO procedure(procedure_id, control_name, template_id)
    VALUES(${row.procedureId}, ${row.controlName}, ${row.templateId})`;
  await sql`INSERT INTO procedure_version(
    version_id, procedure_id, version_number, state, control_name, template_id, sections,
    period, scope, source_snapshot, inclusion_rule, zero_record_pass, allow_versioned_duplicates,
    population_blockers, targets, instructions, compliance_schema_version, compliance_compiler_version,
    compliance_conditions, agent_judged_threshold, evidence_schema_version, evidence_requirements,
    schedule, plan_compiler_version, derivation_model, compiled_plan, plan_input_digest, plan_status,
    plan_failure_reason, plan_derivable, plan_attempts, authorship, decisions, frozen_review,
    submitted_review, lifecycle, platform_origin, configuration_revision
  ) VALUES(
    ${row.versionId}, ${row.procedureId}, ${row.versionNumber}, ${row.state}, ${row.controlName}, ${row.templateId},
    ${json(row.sections)}, ${json(row.period)}, ${row.scope}, ${json(row.sourceSnapshot)},
    ${json(row.inclusionRule)}, ${row.zeroRecordPass}, ${row.allowVersionedDuplicates},
    ${json(row.populationBlockers)}, ${json(row.targets)}, ${json(row.instructions)},
    ${row.complianceSchemaVersion}, ${row.complianceCompilerVersion}, ${json(row.complianceConditions)},
    ${row.agentJudgedThreshold}, ${row.evidenceSchemaVersion}, ${json(row.evidenceRequirements)},
    ${json(row.schedule)}, ${row.planCompilerVersion}, ${json(row.derivationModel)}, ${json(row.compiledPlan)},
    ${row.planInputDigest}, ${row.planStatus}, ${row.planFailureReason ?? null}, ${row.planDerivable},
    ${json(row.planAttempts)}, ${json(row.authorship)}, ${json(row.decisions)}, ${json(row.frozenReview)},
    ${json(row.submittedReview)}, ${json(row.lifecycle)}, ${json(row.platformOrigin)}, ${row.configurationRevision ?? null}
  )`;
}
