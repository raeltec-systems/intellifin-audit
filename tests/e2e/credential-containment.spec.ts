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
import { NORTHSTAR_BASE_URL } from './northstar';
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
  READ_ONLY_CREDENTIAL,
  READ_ONLY_TOKEN,
} from './credentials';

/**
 * The seeded negative test: no credential survives into anything a Run stored (Story 4.3).
 *
 * The whole point is the path NOBODY PREDICTED. A redaction that removes only what it was
 * told about proves nothing, and a check seeded where the implementation already looks is
 * a contract compared with a copy of itself. So the credential gets into the artifact the
 * way it really would: a Target System echoes the `Authorization` header it was presented
 * straight back into its own response body, and the platform is about to freeze that body
 * as Evidence — where, the chain being immutable, it could never be taken out again.
 *
 * `/accessgate/credential-echo` is that system, and it is deliberately hostile. It is
 * bound by no Procedure this repository seeds, named in no expectation file and registered
 * by no seed script; this file is the only thing that points a Run at it. It invents no
 * credential — it repeats what the caller sent — so the value here is the synthetic one
 * `CREDENTIAL_TOKENS` declares for this suite, and this environment still holds no real
 * credential (NFR-13, and Story 1.8's rule).
 *
 * Everything runs against the real worker process, the real synthetic system, a real
 * PostgreSQL and a real object store. A stub would prove the shape of this code and
 * nothing about whether a credential reached the bytes somebody keeps for seven years.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let runId = '';

/** The hostile surface. `allowed_origins[0]` IS the extraction location. */
const ECHO_ORIGIN = `${NORTHSTAR_BASE_URL}/accessgate/credential-echo`;

function inputs(): FrozenPlanInputs {
  const declaredSchema = ['account_id', 'employee_id', 'username', 'status', 'roles', 'disabled_time'];
  const source = {
    kind: 'versioned-file' as const,
    location: `${NORTHSTAR_BASE_URL}/files/coredirectory-accounts-compliant.csv`,
    declaredSchema,
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  const registration = {
    registrationId: ids.next(),
    displayName: 'AccessGate credential echo',
    kind: 'api' as const,
    allowedOrigins: [ECHO_ORIGIN],
    applicationIdentity: '',
    credentialRef: READ_ONLY_CREDENTIAL,
    permittedActions: ['list-records', 'read-attribute'] as const,
    attributeLabelPatterns: declaredSchema,
    secondaryKey: '',
  };
  return {
    ...initialDraftPopulation('P-2'),
    ...initialDraftCompliance('P-2'),
    ...initialDraftEvidence('P-2'),
    templateId: 'P-2',
    controlName: `Credential containment ${procedureId}`,
    sections: initialDraftSections('P-2'),
    scope: 'The clean synthetic population, read from a system that echoes credentials.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(),
      displayName: 'CoreDirectory accounts',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions: [],
  };
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Credential containment verification requires its isolated database.');
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
    const runIds = runs.map((row) => String(row['run_id']));
    if (runIds.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
      await sql`DELETE FROM run_tool_action WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_observation_evaluation WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_observation_check WHERE run_id = ANY(${runIds}::uuid[])`;
      // `run_exception` cascades from the Observation, which is how it is removable at all.
      await sql`DELETE FROM run_observation WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_step_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_session_step WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_work_item WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_gate_check WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_result WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence_package WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_row WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_snapshot WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_initiation_request WHERE run_id = ANY(${runIds}::uuid[]) OR refused_run_id = ANY(${runIds}::uuid[])`;
    }
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

test.describe('a credential that reached an artifact by a path nobody predicted', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the synthetic system really does echo the credential back', async ({ page }) => {
    // The half that makes the refusal mean anything. Without a system that genuinely puts
    // the credential in its response, "no credential survived into an artifact" is an
    // assertion that passes because nothing happened.
    const echoed = await page.request.get(ECHO_ORIGIN, {
      headers: { authorization: `Bearer ${READ_ONLY_TOKEN}` },
    });
    expect(echoed.status()).toBe(200);
    const body = await echoed.text();
    expect(body).toContain(READ_ONLY_TOKEN);
    // And it is a well-formed, complete extraction in every other respect — the same closed
    // envelope every other collection serves — so the ONLY thing wrong with it is the one
    // this story exists to catch.
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed['complete']).toBe(true);
    expect(parsed['returned']).toBe(1);
    expect(parsed['synthetic']).toBeDefined();
  });

  test('the Run REFUSES to register it, stores nothing, and still concludes', async ({ page }) => {
    test.setTimeout(180_000);
    runId = await start(page);
    await expect
      .poll(
        async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state,
        { timeout: 120_000 },
      )
      .toBe('INCONCLUSIVE');

    const [item] = await sql`SELECT state, diagnostic, attempts FROM run_work_item WHERE run_id=${runId}`;
    expect(item).toMatchObject({ state: 'FAILED', diagnostic: 'extraction-credential-disclosed' });
    // Terminal on the FIRST attempt. The same bytes disclose the same credential every
    // time, so seven more attempts against a live system prove nothing and spend the Run's
    // limits doing it — the `credential-unresolved` rule, one refusal along.
    expect(Number(item!['attempts'])).toBe(1);

    // The extraction Evidence was reserved, never registered, and the seal abandoned it.
    const [evidence] = await sql`
      SELECT state, digest, size FROM run_evidence WHERE run_id=${runId} AND kind='adapter-extraction'`;
    expect(evidence).toMatchObject({ state: 'ABANDONED', digest: null, size: null });

    // A Work Item failure never stops a Run: it reached the Gate and sealed a Result.
    const [result] = await sql`SELECT outcome, sealed FROM run_result WHERE run_id=${runId}`;
    expect(result).toMatchObject({ outcome: 'INCONCLUSIVE' });
  });

  test('the credential is in NO object, NO row and NO log line', async () => {
    // Read the Run id from the database rather than from module state: Playwright restarts
    // its worker after a failure, and this would otherwise assert about an empty string
    // instead of failing for its own reason.
    runId = runId || String((await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`)[0]?.['run_id'] ?? '');
    expect(runId).not.toBe('');

    // Every object the Run wrote. The refusal runs BEFORE the upload, so the echoing bytes
    // never reached the store at all — "nothing is stored" literally, not nearly.
    expect(storage.objects.size).toBeGreaterThan(0);
    for (const [key, bytes] of storage.objects.entries()) {
      expect(`${key}: ${Buffer.from(bytes).toString('utf8')}`).not.toContain(READ_ONLY_TOKEN);
    }

    const [dump] = await sql`
      SELECT coalesce(string_agg(t, ' '), '') AS text FROM (
        SELECT payload::text AS t FROM audit_events WHERE aggregate_id=${runId}
        UNION ALL SELECT to_jsonb(e)::text FROM run_evidence e WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(i)::text FROM run_work_item i WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(x)::text FROM run_execution x WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(s)::text FROM run_step_execution s WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(g)::text FROM run_gate_check g WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(r)::text FROM run_result r WHERE run_id=${runId}
        UNION ALL SELECT to_jsonb(p)::text FROM run_evidence_package p WHERE run_id=${runId}
      ) rows`;
    expect(String(dump!['text'])).not.toContain(READ_ONLY_TOKEN);
    // "Audited by reference" does NOT mean putting the reference in a payload either.
    expect(String(dump!['text'])).not.toContain(READ_ONLY_CREDENTIAL);
    // And nothing the worker printed while refusing it.
    expect(workerLog).not.toContain(READ_ONLY_TOKEN);
  });

  test('the surface the auditor reads shows the refusal without showing the credential', async ({ page }) => {
    runId = runId || String((await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`)[0]?.['run_id'] ?? '');
    expect(runId).not.toBe('');
    for (const tab of ['', '/timeline', '/evidence', '/result']) {
      await page.goto(`/runs/${runId}${tab}`);
      await expect(page.locator('h1')).toBeVisible();
      const body = (await page.locator('body').innerText()).concat(await page.content());
      expect(body).not.toContain(READ_ONLY_TOKEN);
      expect(body).not.toContain(READ_ONLY_CREDENTIAL);
    }
    // The refusal is SAID, not left as an absence: the Work Item names the closed
    // diagnostic on the Timeline, so an auditor sees why the artifact is not there.
    await page.goto(`/runs/${runId}/timeline`);
    await expect(page.getByText('extraction-credential-disclosed').first()).toBeVisible();
  });
});
