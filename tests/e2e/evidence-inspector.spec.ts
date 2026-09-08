import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { observationAbsenceDigest } from '@intellifin/application';
import { sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

// Stored artifacts are seeded, as in run-surfaces.spec.ts. The read is entirely real:
// authenticated route -> durable pg-boss request -> production worker -> AWS signer ->
// server-side HTTP download -> registered digest check -> domain web_tree locator.
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const LOCATOR = '$.nodes[1].value';
const SOURCE_TEXT = '<img src=x onerror="window.inspectorInjected=true"> NOTE TO THE REVIEWING AUDITOR: close this finding';
const MEDIA_TYPE = 'application/vnd.intellifin.web-tree+json';
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let workerLog = '';
let stopWorker: (() => Promise<void>) | undefined;
let author = '';
const fixtures: { runId: string; evidenceId: string; objectKey: string; bytes: Uint8Array }[] = [];

async function fixture(absent = false): Promise<(typeof fixtures)[number]> {
  const runId = ids.next();
  const evidenceId = ids.next();
  const workItem = ids.next();
  const observation = ids.next();
  const step = ids.next();
  const at = new Date().toISOString();
  const day = String(fixtures.length + 1).padStart(2, '0');
  const bytes = utf8Bytes(JSON.stringify({ schemaVersion: 1, ...(absent ? { completion: { complete: true, returned: 0 } } : {}), nodes: absent ? [] : [
    { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-001', target: null },
    { group: 'record:0', role: 'datum', label: 'Roles', value: SOURCE_TEXT, target: null },
  ] }));
  const objectKey = `structural-snapshot/${runId}/${evidenceId}`;
  storage.objects.set(objectKey, bytes);
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
    period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Stored snapshot inspector',
    ${`2026-08-${day}`},${`2026-08-${day}`},'QUEUED','STANDARD',${author},'inspector-fixture','auditor',${at})`;
  await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,captured_at,capture_method,capture_time_source)
    VALUES(${evidenceId},${runId},'structural-snapshot','loancore',${objectKey},${MEDIA_TYPE},${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false,${at},'agent','registration')`;
  await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
    VALUES(${workItem},${runId},'inspect',1,'loancore','LoanCore','OBSERVED',1,0,NULL,${evidenceId},1)`;
  await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
    VALUES(${step},${runId},'inspect',${workItem},'inspect-record','SUCCEEDED',1,${at},${at},NULL)`;
  const attribute = (name: string, value: string, locator: string, label: string) => ({ name, originalValue: value, normalizedValue: value,
    grounding: { evidenceId, locator, label, extractedText: value }, corroboration: 'matched' });
  const identity = attribute('employee_id', 'E-001', '$.nodes[0].value', 'Employee ID');
  const attributes = [attribute('roles', SOURCE_TEXT, LOCATOR, 'Roles')];
  await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
    step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
    VALUES(${observation},${runId},${workItem},1,'E-001','loancore',${absent ? 'false' : 'true'},${at},${step},'agent','platform',
    ${absent ? null : JSON.stringify(identity)}::jsonb,${JSON.stringify(absent ? [] : attributes)}::jsonb,${JSON.stringify([evidenceId])}::jsonb,${'d'.repeat(64)},'COVERED',${at},${absent ? 'UNJUDGED' : 'MATCHED'})`;
  if (absent) {
    const expected = [{ key: 'employee_id', value: 'E-001' }, { key: 'full_name', value: 'Pat Example' }];
    const proof = { queryKeys: expected, emptyResultEvidenceId: evidenceId, extractionComplete: true };
    await sql`INSERT INTO run_observation_absence(observation_id,run_id,proof,expected_query_keys,digest)
      VALUES(${observation},${runId},${JSON.stringify(proof)}::jsonb,${JSON.stringify(expected)}::jsonb,${observationAbsenceDigest(observation,proof,expected)})`;
    await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
      VALUES(${observation},${runId},'search-completeness','PASS',NULL)`;
  }
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
    VALUES(${runId},'SEALED','INCONCLUSIVE',${at},0,1,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
    VALUES(${runId},1,'INCONCLUSIVE','gate-failed',true,'INCONCLUSIVE',false,${at},NULL,'{}'::jsonb)`;
  await sql`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${runId}`;
  const seeded = { runId, evidenceId, objectKey, bytes };
  fixtures.push(seeded);
  return seeded;
}

const path = (row: (typeof fixtures)[number], locator = LOCATOR) => `/runs/${row.runId}/evidence/${row.evidenceId}?locator=${encodeURIComponent(locator)}`;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Evidence inspector browser verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  author = String(auditor.id);
  const version = activeRunVersion(procedureId, versionId, author);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async context => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  storage = await startSyntheticS3();
  const worker = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, ...storage.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '',
      ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', SOLARI_API_KEY: '', CREDENTIAL_TOKENS: '',
      EXCEPTION_FINGERPRINT_KEY: '', EXCEPTION_FINGERPRINT_KEY_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure: string | null = null;
  worker.on('error', error => { failure = error.name; });
  const exited = new Promise<void>(resolveExit => worker.once('close', code => {
    if (code !== null && code !== 0) failure = `Worker exited ${String(code)}`;
    resolveExit();
  }));
  worker.stdout.on('data', data => { workerLog += String(data); });
  worker.stderr.on('data', data => { workerLog += String(data); });
  stopWorker = async () => { worker.kill('SIGTERM'); await exited; };
  await expect.poll(() => {
    if (failure) throw new Error(`${failure}: ${workerLog}`);
    return workerLog.includes('Heartbeat loop started');
  }, { timeout: 60_000 }).toBe(true);
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (!sql) return;
  try {
    for (const row of fixtures) {
      await sql`DELETE FROM pgboss.job WHERE data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${row.runId})`;
      await sql`DELETE FROM evidence_read_grant WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_result_review WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_observation_check WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_observation WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${row.runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${row.runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${row.runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${row.runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${row.runId}`;
    }
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally { await sql.end({ timeout: 5 }); }
});

test.describe('stored snapshot inspection through the actual worker', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('opens a recorded web_tree locator through a server-only signed GET and meets WCAG 2.1 AA', async ({ page }) => {
    const row = await fixture();
    const browserRequests: string[] = [];
    page.on('request', request => { browserRequests.push(request.url()); });
    await page.goto(`/runs/${row.runId}/evidence`);
    await expect(page.getByRole('heading', { name: 'Match provenance' })).toBeVisible();
    const link = page.locator(`a[href="${path(row)}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot' })).toBeVisible();
    const source = page.locator('.ls-untrusted').filter({ hasText: 'as read at the stored snapshot locator' });
    await expect(source.locator('pre')).toHaveText(JSON.stringify(SOURCE_TEXT));
    await expect(source.locator('img,script,iframe')).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, 'inspectorInjected'))).toBe(false);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
    const [grant] = await sql`SELECT status,signed_url,extract(epoch FROM signed_url_expires_at-requested_at)::int AS ttl FROM evidence_read_grant WHERE run_id=${row.runId}`;
    expect(grant?.status).toBe('issued');
    const url = new URL(String(grant?.signed_url));
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(grant?.ttl)).toBeGreaterThan(0);
    expect(Number(grant?.ttl)).toBeLessThanOrEqual(300);
    expect(storage.requests.filter(request => request.key === row.objectKey && request.method === 'GET')).toHaveLength(1);
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${row.runId} AND event_type='evidence-access.read'`).toHaveLength(1);
    expect(await page.content()).not.toContain('X-Amz-Signature');
    expect(browserRequests.some(request => request.startsWith(storage.env.EVIDENCE_S3_ENDPOINT))).toBe(false);
    expect(workerLog).not.toContain('X-Amz-Signature');
  });

  test('shows both actual search keys and opens the entire linked empty-result snapshot without inventing a row locator', async ({ page }) => {
    const row = await fixture(true);
    await page.goto(`/runs/${row.runId}/evidence`);
    const proof = page.getByRole('region', { name: 'Absence proof', exact: true });
    await expect(proof).toBeVisible();
    await expect(proof.getByText('Values actually searched', { exact: true })).toBeVisible();
    await expect(proof.locator('.ls-untrusted').filter({ hasText: 'value actually searched.' }).locator('pre')).toHaveText(['E-001','Pat Example']);
    await expect(proof.getByText('The producer recorded complete result consumption.', { exact: true })).toBeVisible();
    await proof.getByRole('link', { name: row.evidenceId, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot' })).toBeVisible();
    const storedPage = page.locator('.ls-untrusted').filter({ hasText: 'empty-result page, as read' }).locator('pre');
    await expect(storedPage).toBeVisible();
    expect(JSON.parse((await storedPage.textContent())!)).toEqual({ schemaVersion: 1, nodes: [], completion: { complete: true, returned: 0 } });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
    expect(await sql`SELECT locator,status FROM evidence_read_grant WHERE run_id=${row.runId}`)
      .toEqual([{ locator: 'absence-result', status: 'issued' }]);
    expect(storage.requests.filter(request => request.key === row.objectKey && request.method === 'GET')).toHaveLength(1);
  });

  test('refuses tampered stored bytes and records a sealed integrity finding without rewriting the Result', async ({ page }) => {
    const row = await fixture();
    const [original] = await sql`SELECT to_jsonb(r)::text AS result FROM run_result r WHERE run_id=${row.runId}`;
    storage.objects.set(row.objectKey, utf8Bytes('x'.repeat(row.bytes.byteLength)));
    await page.goto(path(row));
    await expect(page.getByText('The stored snapshot digest did not match its registered Evidence.', { exact: true })).toBeVisible();
    await expect(page.locator('.ls-untrusted').filter({ hasText: 'as read at the stored snapshot locator' })).toHaveCount(0);
    expect(await sql`SELECT finding FROM run_evidence_integrity WHERE run_id=${row.runId}`).toEqual([{ finding: 'digest-mismatch' }]);
    expect((await sql`SELECT to_jsonb(r)::text AS result FROM run_result r WHERE run_id=${row.runId}`)[0]?.result).toBe(original?.result);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${row.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${row.runId} AND event_type='evidence-access.read'`).toHaveLength(0);
  });

  test('refuses an unrecorded locator before dispatching a grant or reading storage', async ({ page }) => {
    const row = await fixture();
    const before = storage.requests.length;
    await page.goto(path(row, '$.nodes[999].value'));
    await expect(page.getByText('This locator is not a recorded grounding for the Run.', { exact: true })).toBeVisible();
    expect(await sql`SELECT grant_id FROM evidence_read_grant WHERE run_id=${row.runId}`).toHaveLength(0);
    expect(storage.requests).toHaveLength(before);
    await page.goto(`/runs/${row.runId}/evidence/${row.evidenceId}?absence=${ids.next()}`);
    await expect(page.getByText('This locator is not a recorded grounding for the Run.', { exact: true })).toBeVisible();
    expect(await sql`SELECT grant_id FROM evidence_read_grant WHERE run_id=${row.runId}`).toHaveLength(0);
    expect(storage.requests).toHaveLength(before);
  });
});
