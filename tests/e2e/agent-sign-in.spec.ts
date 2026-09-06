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

/**
 * The agent signs in to LoanCore, through the real worker and the real synthetic system
 * (Story 4.2).
 *
 * The Session Step is proved by the SESSION BEING ESTABLISHED — a 401 before it, a 200
 * after it, the credential resolved through the port, the retrieval audited by Target
 * System — and never by "a form submitted", which LoanCore still does not have: a sign-in
 * is a POST, and every Northstar system refuses one above routing.
 *
 * Everything here runs the actual `apps/worker/dist/main.js` against the actual Northstar
 * process. A stub browser or a stub system would prove the shape of this code and nothing
 * about whether a credential reached a system or a denial stayed off the wire.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
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
};

function inputs(): FrozenPlanInputs {
  const source = {
    kind: 'versioned-file' as const,
    location: `${NORTHSTAR_BASE_URL}/files/coredirectory-accounts-compliant.csv`,
    declaredSchema: ['account_id', 'employee_id', 'username', 'status', 'roles', 'disabled_time'],
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  return {
    ...initialDraftPopulation('P-2'),
    ...initialDraftCompliance('P-2'),
    ...initialDraftEvidence('P-2'),
    templateId: 'P-2',
    controlName: `Agent sign-in ${procedureId}`,
    sections: initialDraftSections('P-2'),
    scope: 'Every account of the clean synthetic population.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(),
      displayName: 'CoreDirectory accounts',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...LOANCORE, digest: registrationDigest(LOANCORE) })],
    instructions: [{ registrationId: LOANCORE.registrationId, text: 'Open each account and read its Status.' }],
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
  const row = activeRunVersion(procedureId, ids.next(), String(auditor.id), inputs());
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
  storage = await startSyntheticS3();

  workerLog = '';
  const worker = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      ...storage.env,
      SERVICE_NAME: 'worker',
      MODEL_PROVIDER: '',
      MODEL_ID: '',
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
    const runs = await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`;
    const ids_ = runs.map((row) => String(row['run_id']));
    if (ids_.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${ids_})`;
      // `run_tool_action` names a Step Execution with a real foreign key, so it goes first.
      await sql`DELETE FROM run_tool_action WHERE run_id = ANY(${ids_}::uuid[])`;
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
      await sql`DELETE FROM run_initiation_request WHERE run_id = ANY(${ids_}::uuid[])`;
    }
    // `run_workspace` and `run_agent_execution` cascade with the Run, deliberately.
    await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

async function start(page: Page): Promise<string> {
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test.describe('the agent signs in to LoanCore', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('LoanCore refuses an unauthenticated read, and still refuses every write', async ({ page }) => {
    // A 401 BEFORE. This is the half that makes the 200 after it mean anything: without a
    // system that actually requires a credential, "the agent signed in" is an assertion
    // that passes because nothing happened.
    const anonymous = await page.request.get(`${NORTHSTAR_BASE_URL}/loancore`, {
      failOnStatusCode: false,
    });
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()['www-authenticate']).toContain('Bearer');
    expect((await anonymous.json())['error']).toBe('authentication_required');

    // The read-only rule is UNTOUCHED by this story: a POST is refused above routing, with
    // or without the credential, and the refusal still names the rule verbatim.
    const write = await page.request.post(`${NORTHSTAR_BASE_URL}/loancore`, {
      failOnStatusCode: false,
      headers: { authorization: `Bearer ${LOANCORE_TOKEN}` },
    });
    expect(write.status()).toBe(405);
    expect(write.headers()['allow']).toBe('GET, HEAD');
    expect((await write.json())['rule']).toBe(READ_ONLY_RULE);

    // A 200 after, for a request carrying the credential — the sign-in the agent performs.
    const authorized = await page.request.get(`${NORTHSTAR_BASE_URL}/loancore`, {
      headers: { authorization: `Bearer ${LOANCORE_TOKEN}` },
    });
    expect(authorized.status()).toBe(200);
    expect(authorized.headers()['set-cookie'] ?? '').toContain('loancore_session=');
  });

  test('the Run signs in, and the session is held in the workspace', async ({ page }) => {
    test.setTimeout(180_000);
    runId = await start(page);
    await expect
      .poll(
        async () => (await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`)[0]?.status,
        { timeout: 120_000 },
      )
      .toBe('SIGNED_IN');

    const [step] = await sql`SELECT action,state,attempts,evidence_id FROM run_session_step WHERE run_id=${runId}`;
    expect(step).toMatchObject({ action: 'sign-in', state: 'ACQUIRED', attempts: 1 });
    // A sign-in freezes no bytes. `run_session_step_acquired` reads the ACTION for exactly
    // this row: written the obvious way, the constraint refuses a successful sign-in.
    expect(step!['evidence_id']).toBeNull();

    const [action] = await sql`SELECT * FROM run_tool_action WHERE run_id=${runId}`;
    expect(action).toMatchObject({
      surface: 'agent',
      action: 'navigate',
      method: 'GET',
      outcome: 'performed',
      denial: null,
      status: 200,
      redirected: false,
      downloads: 0,
    });
    expect(String(action!['destination'])).toBe(`${NORTHSTAR_BASE_URL}/loancore`);
    expect(String(action!['target_system'])).toBe(LOANCORE.registrationId);

    // The workspace the sign-in happened in. Its STATUS is deliberately not asserted: this
    // Run goes on to be refused by the adapter stage and the worker releases the workspace
    // in its `finally`, so by the time this reads the row it may say OPEN or RELEASED. What
    // must be true is that the Run had one, and which guarantee it was.
    const [workspace] = await sql`SELECT status,mode,workspace_id FROM run_workspace WHERE run_id=${runId}`;
    expect(workspace).toMatchObject({ mode: 'local' });
    expect(workspace!['workspace_id']).not.toBeNull();

    const events = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    const diagnostics = events.map((row) => String((row['payload'] as Record<string, unknown>)['diagnostic'] ?? ''));
    expect(diagnostics).toContain('session-established');
    expect(diagnostics).toContain('agent-sign-in-complete');
  });

  test('the credential appears in nothing the Run stored, and not in the worker log', async () => {
    // Read from the database rather than from module state: Playwright restarts its worker
    // after a failure, and a later test would then assert about an empty string rather
    // than failing for its own reason.
    runId = runId || String((await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`)[0]?.['run_id'] ?? '');
    expect(runId).not.toBe('');
    const [dump] = await sql`
      SELECT coalesce(string_agg(t, ' '), '') AS text FROM (
        SELECT payload::text AS t FROM audit_events WHERE aggregate_id=${runId}
        UNION ALL SELECT to_jsonb(a)::text FROM run_tool_action a WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(s)::text FROM run_session_step s WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(w)::text FROM run_workspace w WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(c)::text FROM run_agent_execution c WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(e)::text FROM run_step_execution e WHERE run_id=${runId}
      ) rows`;
    expect(String(dump!['text'])).not.toContain(LOANCORE_TOKEN);
    // "Audited by reference" does NOT mean putting the reference in a payload: the Target
    // System is named instead, and `FORBIDDEN_PAYLOAD_KEYS` refuses the key outright.
    expect(String(dump!['text'])).not.toContain(LOANCORE_CREDENTIAL);
    expect(String(dump!['text'])).not.toContain(READ_ONLY_CREDENTIAL);
    // Every object the Run wrote to the store, too.
    for (const bytes of storage.objects.values()) {
      expect(Buffer.from(bytes).toString('utf8')).not.toContain(LOANCORE_TOKEN);
    }
    expect(workerLog).not.toContain(LOANCORE_TOKEN);
  });

  test('the Run then ends RUN_FAILED, because the record-level steps are Story 4.4', async () => {
    // Named rather than hidden. Story 4.2 signs in and stops; the adapter stage still
    // refuses a plan naming an agent-driven Target BY NAME, so this Run ends `RUN_FAILED`
    // with the sign-in durably recorded before it. Asserting the DIAGNOSTIC is what stops
    // a later regression turning this into a Run that failed for some other reason.
    runId = runId || String((await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`)[0]?.['run_id'] ?? '');
    expect(runId).not.toBe('');
    await expect
      .poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state, {
        timeout: 120_000,
      })
      .toBe('RUN_FAILED');
    const [stage] = await sql`SELECT status,diagnostic FROM run_execution WHERE run_id=${runId}`;
    expect(stage).toMatchObject({ status: 'TERMINAL', diagnostic: 'agent-driven-target' });
    // The sign-in survives the Run's failure: it is what this story delivered.
    const [step] = await sql`SELECT state FROM run_session_step WHERE run_id=${runId} AND action='sign-in'`;
    expect(step).toMatchObject({ state: 'ACQUIRED' });
    // And the Run sealed a Result, like every other terminal transition.
    const [result] = await sql`SELECT outcome FROM run_result WHERE run_id=${runId}`;
    expect(result).toMatchObject({ outcome: 'RUN_FAILED' });
  });
});
