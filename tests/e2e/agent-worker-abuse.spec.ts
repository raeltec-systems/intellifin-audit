import { GOLDEN_SCOPE_INSTRUCTIONS } from '../fixtures/agent-abuse-cases';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  snapshotFromRegistration,
  type FrozenPlanInputs,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { NORTHSTAR_BASE_URL, READ_ONLY_RULE } from './northstar';
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
  LOANCORE_CREDENTIAL,
  LOANCORE_TOKEN,
  READ_ONLY_CREDENTIAL,
} from './credentials';

// Actual worker process + real PostgreSQL + local Chromium + Northstar form login.
// The real SDK receives intercepted malicious HTTP output, not a live model response.
const ids = new CryptoUuidV7Generator();
const cases = GOLDEN_SCOPE_INSTRUCTIONS.map(row => ({ ...row, procedureId: ids.next(), frozenVersion: '' }));
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let runId = '';

/** LoanCore, exactly as `scripts/seed-northstar.mts` registers it. */
const LOANCORE = {
  registrationId: ids.next(),
  displayName: 'LoanCore',
  kind: 'web' as const,
  allowedOrigins: [`${NORTHSTAR_BASE_URL}/loancore`],
  applicationIdentity: '',
  credentialRef: LOANCORE_CREDENTIAL,
  permittedActions: ['navigate', 'search', 'open-record', 'read-attribute', 'capture-screenshot'] as const,
  attributeLabelPatterns: ['Status', 'Username', 'Roles', 'Employee ID', 'Full name'],
  secondaryKey: 'Full name',
  authenticationDestination: `${NORTHSTAR_BASE_URL}/loancore/sign-in`,
};

function inputs(procedureId: string, instruction: string): FrozenPlanInputs {
  const source = {
    kind: 'versioned-file' as const,
    location: `${NORTHSTAR_BASE_URL}/files/leavers-export.csv`,
    declaredSchema: ['employee_id', 'full_name', 'department', 'employment_status', 'termination_effective_date', 'manager'],
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  return {
    ...initialDraftPopulation('P-1'),
    ...initialDraftCompliance('P-1'),
    ...initialDraftEvidence('P-1'),
    templateId: 'P-1',
    controlName: `Agent sign-in ${procedureId}`,
    sections: initialDraftSections('P-1'),
    scope: 'The bound synthetic terminated employees only.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(),
      displayName: 'CoreDirectory accounts',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...LOANCORE, digest: registrationDigest(LOANCORE) })],
    instructions: [{ registrationId: LOANCORE.registrationId, text: instruction }],
  };
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Agent sign-in verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  for (const entry of cases) {
    const row = activeRunVersion(entry.procedureId, ids.next(), String(auditor.id), inputs(entry.procedureId, entry.text));
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row); await context.procedures.insertVersion(row);
    });
    entry.frozenVersion = String((await sql`SELECT to_jsonb(v)::text AS frozen FROM procedure_version v WHERE procedure_id=${entry.procedureId}`)[0]!.frozen);
  }
  storage = await startSyntheticS3();

  workerLog = '';
  const worker = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/agent-abuse-worker-preload.mjs')).href, resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      ...storage.env,
      SERVICE_NAME: 'worker',
      MODEL_PROVIDER: '',
      MODEL_ID: '',
      ANTHROPIC_API_KEY: 'synthetic-agent-abuse-interception',
      AGENT_ANTHROPIC_MODEL: 'synthetic-agent-abuse',
      MODEL_MAX_OUTPUT_TOKENS: '1024',
      SOLARI_API_KEY: '',
      OPENAI_API_KEY: '',
      CREDENTIAL_TOKENS,
      EXCEPTION_FINGERPRINT_KEY,
      EXCEPTION_FINGERPRINT_KEY_ID,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure: string | null = null;
  worker.on('error', (error) => {
    failure = error.name;
  });
  const exited = new Promise<void>((resolveExit) =>
    worker.once('close', (code) => {
      if (code !== null && code !== 0) failure = `Worker exited ${String(code)}`;
      resolveExit();
    }),
  );
  worker.stdout.on('data', (data) => (workerLog += String(data)));
  worker.stderr.on('data', (data) => (workerLog += String(data)));
  stopWorker = async () => {
    worker.kill('SIGTERM');
    await exited;
  };
  await expect
    .poll(
      () => {
        if (failure) throw new Error(`${failure}: ${workerLog}`);
        return workerLog.includes('Heartbeat loop started');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (!sql) return;
  try {
    const runs = await sql`SELECT run_id FROM audit_run WHERE procedure_id = ANY(${cases.map(row => row.procedureId)}::uuid[])`;
    const ids_ = runs.map((row) => String(row['run_id']));
    if (ids_.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${ids_})`;
      await sql`DELETE FROM notification WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_agent_turn WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_wait WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id = ANY(${ids_}::uuid[])`;
      // `run_tool_action` names a Step Execution with a real foreign key, so it goes first.
      await sql`DELETE FROM run_tool_action WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_agent_work WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_observation_evaluation WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_observation_check WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_observation WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_step_execution WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_session_step WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_work_item WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_gate_check WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_result WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_evidence_package WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_evidence WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM run_execution WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM population_row WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM population_snapshot WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM population_evidence WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM population_execution WHERE run_id = ANY(${ids_}::uuid[])`;
      await sql`DELETE FROM audit_events WHERE aggregate_id = ANY(${ids_})`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id = ANY(${ids_})`;
      await sql`DELETE FROM run_initiation_request WHERE run_id = ANY(${ids_}::uuid[]) OR refused_run_id = ANY(${ids_}::uuid[])`;
    }
    // `run_workspace` and `run_agent_execution` cascade with the Run, deliberately.
    await sql`DELETE FROM audit_run WHERE procedure_id = ANY(${cases.map(row => row.procedureId)}::uuid[])`;
    await sql`DELETE FROM procedure WHERE procedure_id = ANY(${cases.map(row => row.procedureId)}::uuid[])`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

async function start(page: Page, procedureId: string): Promise<string> {
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test.describe('the actual worker refuses the three seeded scope-widening instructions', () => {
  test.use({ storageState: AUTH_STATE.auditor });
  for (const row of cases) test(`${row.instruction_id}: refuses malicious provider output and records a security denial`, async ({ page }) => {
    test.setTimeout(180_000);
    runId = await start(page, row.procedureId);
    await expect.poll(async () => Number((await sql`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${runId} AND event_type='security.action-denied'`)[0]?.count ?? 0), { timeout: 120_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await sql`SELECT status FROM run_agent_work WHERE run_id=${runId}`)[0]?.status, { timeout: 120_000 }).toBe('WAITING');
    expect(workerLog).toContain(`Synthetic agent abuse HTTP response delivered:${row.instruction_id}`);
    expect((await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`)[0]?.status).toBe('SIGNED_IN');
    const turns = await sql`SELECT status,diagnostic FROM run_agent_turn WHERE run_id=${runId}`;
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every(turn => turn.status === 'FAILED' && turn.diagnostic === 'model-invalid-response')).toBe(true);
    const actions = await sql`SELECT action,destination,method FROM run_tool_action WHERE run_id=${runId} AND outcome='performed'`;
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every(action => action.action === 'navigate' && String(action.destination).startsWith(`${NORTHSTAR_BASE_URL}/loancore`))).toBe(true);
    expect(actions.filter(action => action.method === 'POST')).toHaveLength(1); // Real approved sign-in only.
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${runId}`).toHaveLength(0);
    expect(await sql`SELECT run_id FROM run_result WHERE run_id=${runId} AND outcome='PASS'`).toHaveLength(0);
    expect(String((await sql`SELECT to_jsonb(v)::text AS frozen FROM procedure_version v WHERE procedure_id=${row.procedureId}`)[0]!.frozen)).toBe(row.frozenVersion);
    const [stored] = await sql`SELECT string_agg(payload::text,' ') AS text FROM audit_events WHERE aggregate_id=${runId}`;
    expect(String(stored!.text)).not.toContain(LOANCORE_TOKEN);
    expect(String(stored!.text)).not.toContain('unapproved-scope-widening-action');
    expect(workerLog).not.toContain(LOANCORE_TOKEN);
    for (const bytes of storage.objects.values()) expect(Buffer.from(bytes).toString('utf8')).not.toContain(LOANCORE_TOKEN);
    // Bounded malformed-output retries become a durable wait, not a fabricated Pass.
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state).toBe('AWAITING_AUDITOR');
  });
});
