import { POPULATION_CHECK_NAMES } from '@intellifin/domain';
import { raiseEscalation } from '@intellifin/application';
import {
  createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork,
  PostgresWaitRepository, SystemClock, type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from './active-run-version';
import { ACCOUNTS, assertThrowawayDatabase } from '../e2e/accounts';

export interface DeferredPauseBrowserFixture {
  readonly runId: string;
  readonly workItemId: string;
  readonly targetRegistrationId: string;
  readonly waitId: string;
  readonly auditorId: string;
  readonly sql: Sql;
  readonly cleanup: () => Promise<void>;
}

function json(value: unknown): string { return JSON.stringify(value); }

async function seedAgentContext(
  sql: Sql,
  runId: string,
  runAt: string,
  leaseUntil: string,
  values: {
    readonly waitId: string;
    readonly evidenceId: string;
    readonly workItemId: string;
    readonly stepExecutionId: string;
    readonly attemptId: string;
  },
): Promise<void> {
  const response = {
    schemaVersion: 1,
    route: 'synthetic-fixture',
    model: {
      provider: 'synthetic',
      modelId: 'browser-fixture',
      promptVersion: '1',
      buildVersion: 'e2e',
      configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 100, maxActions: 1, temperature: 0 },
    },
    actions: [],
    uncertainty: {
      kind: 'ambiguous',
      rationale: 'The captured record needs an auditor decision before the next action.',
    },
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  };

  await sql`INSERT INTO run_agent_work(
      run_id,revision,status,run_started_at,lease_until,attempt_id,work_item_id,
      wait_id,pending_wait,next_turn,tokens,reserved_tokens,model,diagnostic)
    VALUES(${runId},1,'WAITING',${runAt},${leaseUntil},${values.attemptId},${values.workItemId},
      ${values.waitId},NULL,1,0,0,${JSON.stringify(response.model)}::jsonb,NULL)`;
  await sql`INSERT INTO run_agent_turn(
      run_id,sequence,work_item_id,step_execution_id,snapshot_evidence_id,status,
      reserved_tokens,response,diagnostic)
    VALUES(${runId},1,${values.workItemId},${values.stepExecutionId},${values.evidenceId},
      'COMPLETED',1,${JSON.stringify(response)}::jsonb,NULL)`;
}


/** Owns a frozen P4 page inspection and an actual open wait; it never changes shared roles. */
export async function createDeferredPauseBrowserFixture(): Promise<DeferredPauseBrowserFixture> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the deferred-pause journey.');
  assertThrowawayDatabase(databaseUrl);
  const sql = createSqlClient(databaseUrl, { max: 6 });
  const ids = new CryptoUuidV7Generator();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runId = ids.next();
  const targetRegistrationId = '018f0000-0000-7000-8000-0000000000a1';
  const sourceKey = 'parameter-0001';
  const runAt = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const [auditor] = await sql<{ id: string }[]>`
    SELECT u.id FROM auth_user u JOIN user_role r ON r.user_id=u.id
    WHERE u.email=${ACCOUNTS.auditor.email} AND r.role='auditor'`;
  if (!auditor) throw new Error('Seed the synthetic Auditor before the deferred-pause journey.');
  const auditorId = auditor.id;
  const version = activeRunVersion(procedureId, versionId, auditorId);
  const plan = version.compiledPlan;
  if (plan === null) throw new Error('The browser fixture could not derive its frozen plan.');
  const target = plan.targetSystems.find((entry) => entry.registrationId === targetRegistrationId);
  const inspectStep = target?.planSteps.find((step) => step.action === 'inspect-record');
  const createWorkspaceStep = plan.sessionSteps.find((step) => step.action === 'create-workspace');
  const signInStep = plan.sessionSteps.find((step) => step.action === 'sign-in' && step.targetSystemId === targetRegistrationId);
  if (!target || !inspectStep || !createWorkspaceStep || !signInStep) {
    throw new Error('The Run Workspace fixture plan is missing its frozen workspace or Target step mapping.');
  }

  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });

  const evidenceId = ids.next();
  const workItemId = ids.next();
  const stepExecutionId = ids.next();
  const attemptId = ids.next();
  await sql`INSERT INTO audit_run(
      request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
      period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${version.controlName},
      '2026-08-01','2026-08-31','RUNNING','STANDARD',${auditorId},'deferred-pause-fixture',
      'auditor',${runAt})`;

  // Population and source rows are real frozen Run inputs. The one selected row has no
  // Observation yet, so the Record Inspector honestly says Not captured.
  const populationChecks = POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true }));
  await sql`INSERT INTO population_snapshot(
      run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,retrieved_count)
    VALUES(${runId},1,0,0,${'a'.repeat(64)},${json(populationChecks)}::jsonb,
      '2026-09-01T00:00:00.000Z',1,1)`;
  await sql`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
    VALUES(${runId},${1},${json({ parameter: sourceKey })}::jsonb,'included','[]'::jsonb)`;

  await sql`INSERT INTO population_execution(
      run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${runAt},${runAt},${leaseUntil},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_agent_execution(
      run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${runAt},${runAt},${runAt},${leaseUntil},${ids.next()})`;
  await sql`INSERT INTO run_workspace(
      run_id,revision,status,attempts,step_id,workspace_id,mode,expires_at,started_at,
      attempt_started_at,lease_until,released_at,diagnostic)
    VALUES(${runId},1,'OPEN',1,${createWorkspaceStep.id},${`workspace-${runId}`},'local',NULL,
      ${runAt},${runAt},${leaseUntil},NULL,NULL)`;
  await sql`INSERT INTO run_session_step(
      run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
    VALUES(${runId},${signInStep.id},${plan.sessionSteps.indexOf(signInStep) + 1},${targetRegistrationId},
      'ProdConsole','sign-in','ACQUIRED',1,NULL,NULL)`;

  // A registered synthetic snapshot gives the persisted wait a real Evidence reference;
  // because the selected source row is uninspected, the Record Inspector still reports
  // its evidence state as Not captured instead of implying bytes that were never read.
  await sql`INSERT INTO run_evidence(
      evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
      captured_at,capture_method,capture_time_source,role)
    VALUES(${evidenceId},${runId},'structural-snapshot',${targetRegistrationId},
      ${`deferred-pause/${runId}/snapshot`},'application/json',${'b'.repeat(64)},128,'REGISTERED',false,
      ${runAt},'agent','registration','evidence')`;
  await sql`INSERT INTO run_work_item(
      work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,
      attempts,cycles,diagnostic,evidence_id,observations)
    VALUES(${workItemId},${runId},${inspectStep.id},1,NULL,${targetRegistrationId},'ProdConsole',
      'AWAITING',1,0,NULL,${evidenceId},0)`;
  await sql`INSERT INTO run_step_execution(
      step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,
      completed_at,diagnostic)
    VALUES(${stepExecutionId},${runId},${inspectStep.id},${workItemId},'inspect-record','RUNNING',1,
      ${runAt},NULL,NULL)`;

  // Raise the actual durable question through the existing wait mechanism.
  const raised = await raiseEscalation(
    { repository: new PostgresWaitRepository(createDb(sql)), ids, clock: new SystemClock() },
    {
      runId,
      kind: 'choose-candidate',
      options: [
        { id: 'candidate-a', label: 'Synthetic candidate A' },
        { id: 'candidate-b', label: 'Synthetic candidate B' },
        { id: 'mark-ambiguous', label: 'ignored persisted label' },
      ],
      stepId: inspectStep.id,
      supportingEvidenceIds: [evidenceId],
    },
  );
  if (!raised.ok) throw new Error(`Run Workspace fixture could not open its persisted wait: ${raised.reason}`);
  const waitId = raised.wait.waitId;
  await seedAgentContext(sql, runId, runAt, leaseUntil, { waitId, evidenceId, workItemId, stepExecutionId, attemptId });


  const cleanup = async (): Promise<void> => {
    try {
      // The deferred latch is retained until the Run aggregate is deleted. Its Work Item
      // foreign key is deferred: remove dependent checkpoints and the aggregate in ONE
      // transaction, so the final cascade clears the command, receipts and latch together.
      await sql.begin(async tx => {
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM notification WHERE run_id=${runId}`;
        await tx`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
        await tx`DELETE FROM run_agent_work WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await tx`DELETE FROM run_workspace WHERE run_id=${runId}`;
        await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await tx`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM run_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM population_row WHERE run_id=${runId}`;
        await tx`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
        await tx`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await tx`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      });
    } finally { await sql.end({ timeout: 5 }); }
  };
  return { runId, workItemId, targetRegistrationId, waitId, auditorId, sql, cleanup };
}
