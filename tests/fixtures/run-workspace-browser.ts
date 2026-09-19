import { POPULATION_CHECK_NAMES } from '@intellifin/domain';
import { raiseEscalation } from '@intellifin/application';
import {
  ConversationContentCipher,
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from './active-run-version';
import { ACCOUNTS, assertThrowawayDatabase } from '../e2e/accounts';

/**
 * The browser test server uses this disposable synthetic key. It is deliberately a
 * test-only value and must stay in agreement with the Playwright web-server environment.
 */
export const RUN_WORKSPACE_CONVERSATION_KEY = 'ab'.repeat(32);
export const RUN_WORKSPACE_RECORD_ORDINAL = 1;
export const RUN_WORKSPACE_SUBMITTED_TEXT = 'Why is this Run awaiting a decision?';

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const runId = ids.next();
const targetRegistrationId = '018f0000-0000-7000-8000-0000000000a1';
const sourceKey = 'parameter-0001';
const initialMessageCount = 55;
const runAt = '2026-09-10T09:00:00.000Z';
// Keep every active checkpoint leased beyond the browser journey. The historical run
// timestamp makes the fixture readable while a dynamic lease prevents a recovery worker
// from reclaiming it during CI.
const leaseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

type RoleRow = { role: string; assigned_by: string | null; assigned_at: string | null };

export interface RunWorkspaceConversationRow {
  readonly message_id: string;
  readonly sequence: number;
  readonly actor_id: string;
  readonly kind: string;
  readonly ciphertext: string | null;
}

export interface RunWorkspaceBrowserFixture {
  readonly runId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly waitId: string;
  readonly evidenceId: string;
  readonly auditorId: string;
  readonly targetRegistrationId: string;
  readonly sourceOrdinal: number;
  readonly initialMessageCount: number;
  readonly sql: Sql;
  readonly readConversationRows: () => Promise<readonly RunWorkspaceConversationRow[]>;
  readonly revokeAuditor: () => Promise<void>;
  readonly restoreAuditor: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Seed the current agent context before opening the wait. The wait repository then writes
 * the real immutable `execution.escalation-raised` event and Run state transition.
 */
async function seedAgentContext(
  sql: Sql,
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

async function seedConversation(sql: Sql, auditorId: string): Promise<void> {
  const cipher = new ConversationContentCipher(RUN_WORKSPACE_CONVERSATION_KEY);
  await sql.begin(async (transaction) => {
    for (let sequence = 1; sequence <= initialMessageCount; sequence += 1) {
      const messageId = ids.next();
      const text = sequence === initialMessageCount
        ? 'The historical decision context is retained for this Run.'
        : `Historical conversation message ${sequence}.`;
      const createdAt = new Date(Date.parse(runAt) + sequence * 1000).toISOString();
      await transaction`INSERT INTO run_conversation_message(
          message_id,run_id,sequence,actor_id,kind,created_at,parent_message_id,
          request_key,semantic_fingerprint,context_revision,source_ordinal,reply_to_wait_id,
          source_event_sequence)
        VALUES(${messageId},${runId},${sequence},${auditorId},'annotation',${createdAt},NULL,
          NULL,NULL,'1',${sequence === initialMessageCount ? RUN_WORKSPACE_RECORD_ORDINAL : null},NULL,NULL)`;
      await transaction`INSERT INTO run_conversation_content(message_id,ciphertext,content_epoch,removed_at)
        VALUES(${messageId},${cipher.seal(runId, messageId, JSON.stringify({ schemaVersion: 1, text, links: [] }))},1,NULL)`;
    }
  });
}

/**
 * The durable fixture for the Run Workspace browser journey. The page is a projection over
 * the frozen plan, real stage checkpoints, a persisted open wait and encrypted conversation
 * content. No browser request or model response is replaced by a test double.
 */
export async function createRunWorkspaceBrowserFixture(): Promise<RunWorkspaceBrowserFixture> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Run Workspace browser journey.');
  assertThrowawayDatabase(databaseUrl);

  const sql = createSqlClient(databaseUrl, { max: 6 });
  const [auditor] = await sql<{ id: string; name: string }[]>`
    SELECT id,name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor before the Run Workspace journey.');
  const auditorId = auditor.id;
  const [role] = await sql<RoleRow[]>`
    SELECT role,assigned_by,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${auditorId}`;
  if (!role || role.role !== 'auditor') throw new Error('The Run Workspace journey requires the seeded Auditor role.');
  const originalRole = role;

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
      '2026-08-01','2026-08-31','RUNNING','STANDARD',${auditorId},'run-workspace-fixture',
      'auditor',${runAt})`;

  // Population and source rows are real frozen Run inputs. The one selected row has no
  // Observation yet, so the Record Inspector honestly says Not captured.
  const populationChecks = POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true }));
  await sql`INSERT INTO population_snapshot(
      run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,retrieved_count)
    VALUES(${runId},1,0,0,${'a'.repeat(64)},${json(populationChecks)}::jsonb,
      '2026-09-01T00:00:00.000Z',1,1)`;
  await sql`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
    VALUES(${runId},${RUN_WORKSPACE_RECORD_ORDINAL},${json({ parameter: sourceKey })}::jsonb,'included','[]'::jsonb)`;

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
      ${`run-workspace/${runId}/snapshot`},'application/json',${'b'.repeat(64)},128,'REGISTERED',false,
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

  // Historical conversation precedes the actual raised decision. The audit writer
  // appends its own operational entry; never seed over its authoritative sequence.
  await seedConversation(sql, auditorId);
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
  await seedAgentContext(sql, { waitId, evidenceId, workItemId, stepExecutionId, attemptId });

  let roleRevoked = false;
  const readConversationRows = async (): Promise<readonly RunWorkspaceConversationRow[]> => sql`
    SELECT m.message_id,m.sequence,m.actor_id,m.kind,c.ciphertext
    FROM run_conversation_message m
    LEFT JOIN run_conversation_content c ON c.message_id=m.message_id
    WHERE m.run_id=${runId}
    ORDER BY m.sequence`;
  const revokeAuditor = async (): Promise<void> => {
    if (roleRevoked) return;
    await sql`DELETE FROM user_role WHERE user_id=${auditorId}`;
    roleRevoked = true;
  };
  const restoreAuditor = async (): Promise<void> => {
    if (!roleRevoked) return;
    await sql`INSERT INTO user_role(user_id,role,assigned_at,assigned_by)
      VALUES(${auditorId},${originalRole.role},${originalRole.assigned_at}::timestamptz,${originalRole.assigned_by})
      ON CONFLICT (user_id) DO UPDATE SET role=excluded.role,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`;
    roleRevoked = false;
  };
  const cleanup = async (): Promise<void> => {
    try {
      await restoreAuditor();
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_work WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await sql`DELETE FROM run_workspace WHERE run_id=${runId}`;
      await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM population_row WHERE run_id=${runId}`;
      await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      // Conversation metadata and content are immutable while the Run exists. Removing
      // the aggregate last lets their ON DELETE CASCADE remove the governed rows together.
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  return {
    runId,
    procedureId,
    versionId,
    waitId,
    evidenceId,
    auditorId,
    targetRegistrationId,
    sourceOrdinal: RUN_WORKSPACE_RECORD_ORDINAL,
    initialMessageCount: (await readConversationRows()).length,
    sql,
    readConversationRows,
    revokeAuditor,
    restoreAuditor,
    cleanup,
  };
}
