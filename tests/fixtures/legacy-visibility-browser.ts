import { bindingDigest, bindingDigestEnvelope, initialDraftPopulation, initialDraftCompliance, initialDraftEvidence, initialDraftSections, POPULATION_CHECK_NAMES, registrationDigest, snapshotFromRegistration } from '@intellifin/domain';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresAgentWorkRepository, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from './active-run-version';
import { executablePlanInputs } from './executable-plan';
import { ACCOUNTS, assertThrowawayDatabase } from '../e2e/accounts';

const ids = new CryptoUuidV7Generator();
const runAt = '2026-09-10T09:00:00.000Z';
const observationDigest = 'd'.repeat(64);
const sourceKey = (ordinal: number) => `parameter-${String(ordinal).padStart(4, '0')}`;
const json = (value: unknown) => JSON.stringify(value);
export const VISIBILITY_DECIDED_AT = '2026-09-10T08:59:00.000Z';
export const VISIBILITY_CANDIDATE = 'PRIVATE-CANDIDATE-NAME-106';

export interface LegacyVisibilityBrowserFixture {
  readonly runId: string;
  readonly humanOrdinal: number;
  readonly humanKey: string;
  readonly waitId: string;
  readonly auditorName: string;
  readonly adapterDigest: string;
  readonly adapterEvidenceId: string;
  readonly masked: boolean;
  cleanup(): Promise<void>;
}

/** Seed one Observation and its Work Item using the frozen P-4 target step. */
async function insertObservedRecord(
  sql: Sql,
  values: {
    readonly runId: string;
    readonly versionId: string;
    readonly keyColumn: string;
    readonly keyed: boolean;
    readonly human: boolean;
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

  // P-4 uses one page Work Item; P-1 uses one keyed Work Item per employee.
  // Preserve the frozen mapping so both projection joins exercise real provenance.
  const [existingWorkItem] = await sql<{ work_item_id: string }[]>`
    SELECT work_item_id FROM run_work_item
    WHERE run_id=${values.runId} AND step_id=${values.inspectStepId} AND subject_key IS NOT DISTINCT FROM ${values.keyed ? key : null}`;
  const persistedWorkItemId = existingWorkItem?.work_item_id ?? workItemId;
  if (existingWorkItem === undefined) {
    await sql`INSERT INTO run_work_item(
        work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,
        attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${persistedWorkItemId},${values.runId},${values.inspectStepId},${values.ordinal},${values.keyed ? key : null},
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
  const identity = attribute(values.keyColumn, key, `$.parameters[${values.ordinal - 1}].parameter`);
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
      'true',${observedAt},${stepExecutionId},'agent',${values.human ? 'human-matched' : 'platform'},${json(identity)}::jsonb,
      ${json(attributes)}::jsonb,${json([evidence])}::jsonb,${observationDigest},'COVERED',
      ${observedAt},'MATCHED')`;

  // A production Observation has one result for every frozen condition. The P-4 plan's
  // conditions are read from the persisted version below, so the caller inserts them in
  // the same order and with the same IDs rather than inventing a browser-only condition.
  const conditions = await sql<{ condition_id: string }[]>`
    SELECT condition."conditionId" AS condition_id
    FROM procedure_version,
      jsonb_to_recordset(compiled_plan->'inputs'->'complianceConditions') AS condition("conditionId" text)
    WHERE version_id=${values.versionId}`;
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
        FROM procedure_version WHERE version_id=${values.versionId})) AS condition("conditionId" text)`;
  }
}

/** Real persisted projections only. No intercepted routes, fake React props, or object-store claims. */
export async function createLegacyVisibilityBrowserFixture(privacy: 'public' | 'key' | 'secondary', adapterState: 'registered' | 'unavailable' | 'absent' = 'registered', unreadablePublication = false): Promise<LegacyVisibilityBrowserFixture> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required for legacy visibility browser acceptance.');
  assertThrowawayDatabase(url);
  const sql = createSqlClient(url, { max: 4 });
  const db = createDb(sql);
  const procedureId = ids.next(), versionId = ids.next(), runId = ids.next(), waitId = ids.next();
  const humanOrdinal = 503;
  const primaryEvidenceId = ids.next(), adapterEvidenceId = ids.next();
  const adapterDigest = 'b'.repeat(64);
  const [actor] = await sql<{ id: string; name: string }[]>`SELECT id,name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!actor) { await sql.end(); throw new Error('Seed the synthetic Auditor before this journey.'); }
  const masked = privacy !== 'public';
  const template = privacy === 'secondary' ? 'P-1' : 'P-4';
  const keyColumn = template === 'P-1' ? 'employee_id' : 'parameter';
  const base = { ...executablePlanInputs(), ...initialDraftPopulation(template), ...initialDraftCompliance(template),
    ...initialDraftEvidence(template), templateId: template as 'P-1' | 'P-4', sections: initialDraftSections(template) };
  const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/legacy-visibility.csv',
    declaredSchema: [keyColumn, 'full_name', 'employment_status', 'termination_effective_date'], sensitiveFields: masked ? [privacy === 'secondary' ? 'full_name' : keyColumn] : [], declaredCountMechanism: 'cover-sheet' as const };
  const apiRegistration = { registrationId: ids.next(), displayName: 'Visibility API', kind: 'api' as const,
    allowedOrigins: ['https://synthetic.invalid'], applicationIdentity: '', credentialRef: 'vault://synthetic/visibility',
    permittedActions: ['list-records', 'read-attribute'] as const, attributeLabelPatterns: ['Parameter'], secondaryKey: '' };
  const inputs = { ...base, sourceSnapshot: { bindingId: ids.next(), displayName: 'Visibility source',
    digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    targets: [...base.targets, snapshotFromRegistration({ ...apiRegistration, digest: registrationDigest(apiRegistration) })] };
  const version = activeRunVersion(procedureId, versionId, actor.id, inputs);
  const plan = version.compiledPlan!;
  const targetRegistrationId = base.targets[0]!.registrationId;
  const inspectStep = plan.targetSystems.find(t => t.registrationId === targetRegistrationId)!.planSteps.find(s => s.action === 'inspect-record')!;
  const adapterStep = plan.sessionSteps.find(s => s.action === 'extract-adapter' && s.targetSystemId === apiRegistration.registrationId)!;
  if (!adapterStep) throw new Error('Expected the frozen API acquisition step.');
  const cleanup = async () => {
    try {
      await sql.begin(async cleanupSql => {
        await cleanupSql`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
        await cleanupSql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_observation_absence WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_result WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM population_row WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await cleanupSql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await cleanupSql`DELETE FROM audit_run WHERE run_id=${runId}`;
        await cleanupSql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await cleanupSql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      });
    } finally { await sql.end({ timeout: 5 }); }
  };
  try {
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
    });
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
      period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${version.controlName},
        '2026-08-01','2026-08-31','QUEUED','STANDARD',${actor.id},'legacy-visibility-fixture','auditor',${runAt})`;
    await sql`INSERT INTO population_snapshot(run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,retrieved_count)
      VALUES(${runId},503,0,0,${'a'.repeat(64)},${json(POPULATION_CHECK_NAMES.map(name => ({ name, passed: true })))}::jsonb,${runAt},503,503)`;
    await sql`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
      SELECT ${runId},n,jsonb_build_object(${keyColumn}::text,'parameter-' || lpad(n::text,4,'0'),'full_name',CASE WHEN n=503 AND ${template}='P-1' THEN ${VISIBILITY_CANDIDATE} ELSE 'Visible person' END,'employment_status','Terminated','termination_effective_date','2026-08-15'),'included','[]'::jsonb FROM generate_series(1,503) n`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${primaryEvidenceId},${runId},'structural-snapshot',${targetRegistrationId},${`visibility/${runId}/snapshot`},
        'application/vnd.intellifin.web-tree+json',${'a'.repeat(64)},256,'REGISTERED',true,${runAt},'agent','registration','evidence'),
      (${adapterEvidenceId},${runId},'adapter-extraction',${apiRegistration.registrationId},${`visibility/${runId}/adapter`},
        'application/json',${adapterState === 'unavailable' ? null : adapterDigest},256,${adapterState === 'unavailable' ? 'ABANDONED' : 'REGISTERED'},true,${runAt},'adapter','registration','evidence')`;
    await sql`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
      VALUES(${runId},${adapterStep.id},${plan.sessionSteps.indexOf(adapterStep) + 1},${apiRegistration.registrationId},
        'Visibility API','extract-adapter',${adapterState === 'absent' ? 'PENDING' : adapterState === 'unavailable' ? 'FAILED' : 'ACQUIRED'},1,NULL,${adapterState === 'absent' ? null : adapterEvidenceId})`;
    for (const ordinal of [1, humanOrdinal]) await insertObservedRecord(sql, { runId, versionId, ordinal, keyColumn, keyed: template === 'P-1', human: ordinal === humanOrdinal,
      targetRegistrationId, inspectStepId: inspectStep.id, outcome: ordinal === humanOrdinal ? 'EXCEPTION' : 'COMPLIANT', evidenceId: primaryEvidenceId });
    const [human] = await sql<{ observation_id: string }[]>`SELECT observation_id FROM run_observation
      WHERE run_id=${runId} AND population_record_key=${sourceKey(humanOrdinal)}`;
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,deadline,closed_at,closure_kind,answer_option_id,actor)
      VALUES(${waitId},${runId},'choose-candidate',${json([{ id: 'candidate-106', label: VISIBILITY_CANDIDATE }])}::jsonb,
        '2026-09-10T08:00:00Z','2026-09-10T12:00:00Z',${VISIBILITY_DECIDED_AT},'answer','candidate-106',${actor.id})`;
    await new PostgresAgentWorkRepository(db).transaction(runId, async context => {
      await context.auditEvents.append({ actor: { type: 'system', id: 'observation-registrar' }, eventType: 'execution.observations-registered',
        source: 'worker', outcome: 'success', aggregateId: runId, correlationId: runId, sessionId: 'legacy-visibility',
        payload: { matchingDecisions: [{ observationId: human!.observation_id, digest: observationDigest, waitId }] } });
    });
    const unavailable = adapterState === 'unavailable';
    const terminalState = unavailable ? 'RUN_FAILED' : 'COMPLETED';
    const packageState = unavailable ? 'INCOMPLETE' : 'SEALED';
    const registered = unavailable ? 1 : 2;
    const missing = unavailable ? [{ evidenceId: adapterEvidenceId, kind: 'adapter-extraction',
      objectKey: `visibility/${runId}/adapter`, required: true, state: 'ABANDONED', role: 'evidence' }] : [];
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
      VALUES(${runId},${packageState},${terminalState},${runAt},2,${registered},${json(missing)}::jsonb,${json(missing)}::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
      VALUES(${runId},1,${unavailable ? 'RUN_FAILED' : 'PASS'},${unavailable ? 'run-failed' : 'pass'},true,${terminalState},${!unavailable},${runAt},${version.scope},${json(unreadablePublication ? {} : {
        templateId: version.templateId, controlName: version.controlName, period: version.period, scope: version.scope,
        population: { rowsParsed: 503, included: 503, excluded: 0, indeterminate: 0 }, exclusions: [], coverage: [], conditions: [],
        exceptions: { total: 1, records: [] }, unevaluated: { total: 0, records: [] },
        controlFields: ['observed_value', 'approved_value'], gate: { passed: !unavailable, checks: unavailable ? 0 : 20, failed: [] },
        evidence: { state: packageState, requiredTotal: 2, registered, missingRequired: missing.length, abandoned: missing.length },
        statement: unavailable ? 'The Run failed before required Evidence was registered.' : 'Every baseline parameter was inspected.',
      })}::jsonb)`;
    await sql`UPDATE audit_run SET state=${terminalState} WHERE run_id=${runId}`;
    return { runId, humanOrdinal, humanKey: sourceKey(humanOrdinal), waitId, auditorName: actor.name, adapterDigest, adapterEvidenceId, masked,
      cleanup };
  } catch (error) { await cleanup(); throw error; }
}
