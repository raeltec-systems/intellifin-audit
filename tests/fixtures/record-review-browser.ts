import { POPULATION_CHECK_NAMES } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from './active-run-version';
import { ACCOUNTS, assertThrowawayDatabase } from '../e2e/accounts';

/**
 * The durable fixture for the Record Review browser journey.
 *
 * This is deliberately a database fixture rather than a route fixture. The page is a
 * projection over the frozen Population Source and the rows an execution registered, so
 * stubbing its request would leave the important joins (source ordinal, frozen step and
 * registered Evidence) untested. The two registered Evidence rows are inserted before the
 * sealed package; progress for ordinal 51 adds only the observation-side records after the
 * review snapshot has been created, which proves the cursor reads its immutable copy.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const runId = ids.next();
const sourceRowCount = 51;
const primaryOrdinal = 1;
const progressOrdinal = sourceRowCount;
const targetRegistrationId = '018f0000-0000-7000-8000-0000000000a1';
const runAt = '2026-09-10T09:00:00.000Z';
const generatedAt = '2026-09-01T00:00:00.000Z';
const snapshotDigest = 'a'.repeat(64);
const observationDigest = 'd'.repeat(64);

type RoleRow = { role: string; assigned_by: string | null; assigned_at: Date };

export interface RecordReviewBrowserFixture {
  readonly runId: string;
  readonly procedureId: string;
  readonly sourceRowCount: number;
  readonly primaryOrdinal: number;
  readonly progressOrdinal: number;
  readonly searchTerm: string;
  readonly auditorId: string;
  readonly targetRegistrationId: string;
  readonly sql: Sql;
  seedProgress(): Promise<void>;
  revokeAuditor(): Promise<void>;
  restoreAuditor(): Promise<void>;
  cleanup(): Promise<void>;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sourceKey(ordinal: number): string {
  return `parameter-${String(ordinal).padStart(4, '0')}`;
}

function evidenceKey(run: string, ordinal: number): string {
  return `record-review/${run}/structural-snapshot/${String(ordinal).padStart(4, '0')}`;
}

/** Seed one Observation and its Work Item using the frozen P-4 target step. */
async function insertObservedRecord(
  sql: Sql,
  values: {
    readonly runId: string;
    readonly ordinal: number;
    readonly targetRegistrationId: string;
    readonly inspectStepId: string;
    readonly outcome: 'COMPLIANT' | 'EXCEPTION';
    readonly evidenceId: string;
  },
): Promise<void> {
  const workItemId = ids.next();
  const stepExecutionId = ids.next();
  const observationId = ids.next();
  const key = sourceKey(values.ordinal);
  const observedAt = new Date(Date.parse(runAt) + values.ordinal * 1000).toISOString();
  const evidence = values.evidenceId;

  // P-4's frozen plan maps the web Target to one page Work Item, not one Work Item per
  // source record. Its `subject_key` is therefore NULL and each Observation carries the
  // source key. Reuse that Work Item when progress adds ordinal 51; creating a keyed item
  // here would make the production projection correctly treat the Observation as missing.
  const [existingWorkItem] = await sql<{ work_item_id: string }[]>`
    SELECT work_item_id FROM run_work_item
    WHERE run_id=${values.runId} AND step_id=${values.inspectStepId} AND subject_key IS NULL`;
  const persistedWorkItemId = existingWorkItem?.work_item_id ?? workItemId;
  if (existingWorkItem === undefined) {
    await sql`INSERT INTO run_work_item(
        work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,
        attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${persistedWorkItemId},${values.runId},${values.inspectStepId},1,NULL,
        ${values.targetRegistrationId},'ProdConsole','OBSERVED',1,0,NULL,${evidence},1)`;
  } else {
    await sql`UPDATE run_work_item SET observations=observations+1 WHERE work_item_id=${persistedWorkItemId}`;
  }
  await sql`INSERT INTO run_step_execution(
      step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,
      completed_at,diagnostic)
    VALUES(${stepExecutionId},${values.runId},${values.inspectStepId},${persistedWorkItemId},
      'inspect-record','SUCCEEDED',1,${observedAt},${observedAt},NULL)`;

  const attribute = (name: string, value: string, locator: string) => ({
    name,
    originalValue: value,
    normalizedValue: value,
    grounding: {
      evidenceId: evidence,
      locator,
      label: name,
      extractedText: value,
    },
    corroboration: 'matched',
  });
  const identity = attribute('parameter', key, `$.parameters[${values.ordinal - 1}].parameter`);
  const attributes = [
    attribute('observed_value', values.outcome === 'EXCEPTION' ? 'legacy' : 'approved', `$.parameters[${values.ordinal - 1}].observed_value`),
    attribute('approved_value', 'approved', `$.parameters[${values.ordinal - 1}].approved_value`),
    attribute('observation_time', observedAt, `$.parameters[${values.ordinal - 1}].observation_time`),
  ];
  await sql`INSERT INTO run_observation(
      observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,
      found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,
      evidence_ids,digest,coverage,observed_at_source,corroboration)
    VALUES(${observationId},${values.runId},${persistedWorkItemId},1,${key},${values.targetRegistrationId},
      'true',${observedAt},${stepExecutionId},'agent','platform',${json(identity)}::jsonb,
      ${json(attributes)}::jsonb,${json([evidence])}::jsonb,${observationDigest},'COVERED',
      ${observedAt},'MATCHED')`;

  // A production Observation has one result for every frozen condition. The P-4 plan's
  // conditions are read from the persisted version below, so the caller inserts them in
  // the same order and with the same IDs rather than inventing a browser-only condition.
  const conditions = await sql<{ condition_id: string }[]>`
    SELECT condition."conditionId" AS condition_id
    FROM procedure_version,
      jsonb_to_recordset(compiled_plan->'inputs'->'complianceConditions') AS condition("conditionId" text)
    WHERE version_id=${versionId}`;
  for (const condition of conditions) {
    await sql`INSERT INTO run_observation_evaluation(
        observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,
        confidence,rationale,diagnostic,evidence_ids)
      VALUES(${observationId},'COVERED','MATCHED',${values.runId},${condition.condition_id},
        'RULE',${values.outcome},NULL,NULL,NULL,NULL,${json([evidence])}::jsonb)`;
  }

  // All six per-Observation checks are present and pass. Omitting one would turn a
  // complete captured row into an evidence problem in the projection, so this fixture
  // keeps the same closed vocabulary as the production Gate.
  for (const check of [
    'identity-corroboration',
    'search-completeness',
    'ambiguous-match',
    'required-evidence',
    'freshness',
    'observation-corroboration',
  ]) {
    await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
      VALUES(${observationId},${values.runId},${check},'PASS',NULL)`;
  }

  if (values.outcome === 'EXCEPTION') {
    await sql`INSERT INTO run_exception(
        exception_id,run_id,observation_id,work_item_id,target_system,population_record_key,
        condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
      SELECT ${ids.next()},${values.runId},${observationId},${persistedWorkItemId},${values.targetRegistrationId},
        ${key},jsonb_agg(condition."conditionId"),${json(['P-4 baseline differs from the approved value.'])}::jsonb,
        ${'e'.repeat(64)},'record-review-fixture',${observedAt}
      FROM jsonb_to_recordset((SELECT compiled_plan->'inputs'->'complianceConditions'
        FROM procedure_version WHERE version_id=${versionId})) AS condition("conditionId" text)`;
  }
}

/**
 * Create the real Run/Source/Observation rows used by the browser spec.
 * Call this from `test.beforeAll`; the returned teardown is safe to call even if a later
 * browser assertion fails.
 */
export async function createRecordReviewBrowserFixture(): Promise<RecordReviewBrowserFixture> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Record Review browser journey.');
  assertThrowawayDatabase(databaseUrl);

  const sql = createSqlClient(databaseUrl, { max: 6 });
  const [auditor] = await sql<{ id: string }[]>`
    SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor before the Record Review journey.');
  const auditorId = auditor.id;
  const [role] = await sql<RoleRow[]>`
    SELECT role,assigned_by,assigned_at FROM user_role WHERE user_id=${auditorId}`;
  if (!role || role.role !== 'auditor') throw new Error('The Record Review journey requires the seeded Auditor role.');

  const version = activeRunVersion(procedureId, versionId, auditorId);
  const plan = version.compiledPlan;
  if (plan === null) throw new Error('The browser fixture could not derive its frozen plan.');
  const target = plan.targetSystems.find((entry) => entry.registrationId === targetRegistrationId);
  const inspectStep = target?.planSteps.find((step) => step.action === 'inspect-record');
  const signInStep = plan.sessionSteps.find((step) => step.action === 'sign-in' && step.targetSystemId === targetRegistrationId);
  if (!target || !inspectStep || !signInStep) throw new Error('The P-4 fixture plan is missing its frozen Target step mapping.');
  const inspectStepId = inspectStep.id;
  const signInStepOrdinal = plan.sessionSteps.indexOf(signInStep) + 1;
  const originalRole = role;

  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });

  await sql`INSERT INTO audit_run(
      request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
      period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${version.controlName},
      '2026-08-01','2026-08-31','QUEUED','STANDARD',${auditorId},'record-review-fixture',
      'auditor',${runAt})`;

  const populationChecks = POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true }));
  await sql`INSERT INTO population_snapshot(
      run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,
      retrieved_count)
    VALUES(${runId},${sourceRowCount},0,0,${snapshotDigest},${json(populationChecks)}::jsonb,
      ${generatedAt},${sourceRowCount},${sourceRowCount})`;
  for (let ordinal = 1; ordinal <= sourceRowCount; ordinal += 1) {
    await sql`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
      VALUES(${runId},${ordinal},${json({ parameter: sourceKey(ordinal) })}::jsonb,'included','[]'::jsonb)`;
  }

  // The sign-in Session Step is the frozen plan's real step, even though this browser
  // journey does not invoke a provider. The two registered snapshots are captured before
  // the package is sealed; ordinal 51 is linked to an Observation only in seedProgress().
  const primaryEvidenceId = ids.next();
  const progressEvidenceId = ids.next();
  await sql`INSERT INTO run_session_step(
      run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
    VALUES(${runId},${signInStep.id},${signInStepOrdinal},${targetRegistrationId},
      'ProdConsole','sign-in','ACQUIRED',1,NULL,NULL)`;
  for (const evidenceId of [primaryEvidenceId, progressEvidenceId]) {
    const ordinal = evidenceId === primaryEvidenceId ? primaryOrdinal : progressOrdinal;
    await sql`INSERT INTO run_evidence(
        evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
        captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${runId},'structural-snapshot',${targetRegistrationId},
        ${evidenceKey(runId,ordinal)},'application/vnd.intellifin.web-tree+json',${snapshotDigest},
        256,'REGISTERED',true,${runAt},'agent','registration','evidence')`;
  }

  await insertObservedRecord(sql, {
    runId,
    ordinal: primaryOrdinal,
    targetRegistrationId,
    inspectStepId,
    outcome: 'EXCEPTION',
    evidenceId: primaryEvidenceId,
  });

  await sql`INSERT INTO run_evidence_package(
      run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
    VALUES(${runId},'SEALED','COMPLETED',${runAt},2,2,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(
      run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
    VALUES(${runId},1,'PASS','pass',true,'COMPLETED',true,${runAt},${version.scope},
      ${json({
        templateId: version.templateId,
        controlName: version.controlName,
        period: version.period,
        scope: version.scope,
        population: { rowsParsed: sourceRowCount, included: sourceRowCount, excluded: 0, indeterminate: 0 },
        exclusions: [],
        coverage: [],
        conditions: [],
        exceptions: { total: 1, records: [sourceKey(primaryOrdinal)] },
        unevaluated: { total: 0, records: [] },
        controlFields: ['observed_value', 'approved_value'],
        gate: { passed: true, checks: 20, failed: [] },
        evidence: { state: 'SEALED', requiredTotal: 2, registered: 2, missingRequired: 0, abandoned: 0 },
        statement: 'Every baseline parameter was inspected.',
      })}::jsonb)`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;

  let progressSeeded = false;
  let roleRevoked = false;
  async function seedProgress(): Promise<void> {
    if (progressSeeded) return;
    progressSeeded = true;
    await insertObservedRecord(sql, {
      runId,
      ordinal: progressOrdinal,
      targetRegistrationId,
      inspectStepId,
      outcome: 'COMPLIANT',
      evidenceId: progressEvidenceId,
    });
  }
  async function revokeAuditor(): Promise<void> {
    if (roleRevoked) return;
    await sql`DELETE FROM user_role WHERE user_id=${auditorId}`;
    roleRevoked = true;
  }
  async function restoreAuditor(): Promise<void> {
    if (!roleRevoked) return;
    await sql`INSERT INTO user_role(user_id,role,assigned_at,assigned_by)
      VALUES(${auditorId},${originalRole.role},${originalRole.assigned_at},${originalRole.assigned_by})
      ON CONFLICT (user_id) DO UPDATE SET role=excluded.role,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`;
    roleRevoked = false;
  }
  async function cleanup(): Promise<void> {
    try {
      await restoreAuditor();
      // Observation-owned rows go first; the exception trigger intentionally cascades the
      // durable Exception with its Observation, just as production teardown does.
      await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation_absence WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM population_row WHERE run_id=${runId}`;
      await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  return {
    runId,
    procedureId,
    sourceRowCount,
    primaryOrdinal,
    progressOrdinal,
    searchTerm: sourceKey(primaryOrdinal),
    auditorId,
    targetRegistrationId,
    sql,
    seedProgress,
    revokeAuditor,
    restoreAuditor,
    cleanup,
  };
}
