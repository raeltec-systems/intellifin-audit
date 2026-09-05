import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  bindingDigest, bindingDigestEnvelope, initialDraftCompliance, initialDraftEvidence,
  initialDraftPopulation, initialDraftSections, observationBatchDigest, observationDigest,
  observationIdFor, registrationDigest, snapshotFromRegistration,
  type FrozenPlanInputs, type ObservationRecord,
} from '@intellifin/domain';
import {
  createDb, createSqlClient, CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { NORTHSTAR_BASE_URL } from './northstar';
import { CREDENTIAL_TOKENS, READ_ONLY_CREDENTIAL, READ_ONLY_TOKEN } from './credentials';

const ids = new CryptoUuidV7Generator();
const procedures = [ids.next(), ids.next(), ids.next(), ids.next(), ids.next()];
const files = ['accessgate-active-accounts.csv', 'accessgate-active-accounts-truncated.csv'];
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: ((force?: boolean) => Promise<void>) | undefined;
let workerLog = '';
let firstRunId: string;

function inputs(templateId: 'P-2' | 'P-3', index: number): FrozenPlanInputs {
  const declaredSchema = templateId === 'P-2'
    ? ['account_id', 'employee_id', 'username', 'status', 'roles', 'disabled_time']
    : ['transaction_id', 'amount', 'currency', 'initiator', 'processed_time', 'approval_id', 'memo'];
  const source = {
    kind: index !== 2 ? 'versioned-file' as const : 'read-only-api' as const,
    location: `${NORTHSTAR_BASE_URL}/${index === 4 ? 'files/count' : index !== 2 ? `files/${files[index === 3 ? 0 : index]}` : 'ledgerflow/transactions'}`,
    declaredSchema, sensitiveFields: [],
    declaredCountMechanism: index !== 2 ? 'cover-sheet' as const : 'count-endpoint' as const,
  };
  // The frozen allowed origin IS the extraction location (adapter-extraction-v1). Here it
  // is the system's read-only service index, which the adapter follows exactly one hop —
  // the shape `scripts/seed-northstar.mts` registers, so the seeded rows are executable.
  const registration = {
    registrationId: ids.next(), displayName: templateId === 'P-2' ? 'AccessGate' : 'ApproveNow',
    kind: 'api' as const,
    allowedOrigins: [`${NORTHSTAR_BASE_URL}/${templateId === 'P-2' ? 'accessgate' : 'approvenow'}`],
    applicationIdentity: '',
    credentialRef: READ_ONLY_CREDENTIAL, permittedActions: ['list-records', 'read-attribute'] as const,
    attributeLabelPatterns: declaredSchema, secondaryKey: '',
  };
  // RoleMatrix: a `versioned-file` Target System, so a Reference Source Session Step and
  // no Work Item at all. Only the first P-2 Procedure carries it; the others are the
  // Story 3.2 population cases and stay as they were.
  const referenceSource = {
    registrationId: ids.next(), displayName: 'RoleMatrix', kind: 'versioned-file' as const,
    allowedOrigins: [`${NORTHSTAR_BASE_URL}/files/role-matrix.csv`], applicationIdentity: '',
    credentialRef: READ_ONLY_CREDENTIAL, permittedActions: ['read-file', 'read-metadata'] as const,
    attributeLabelPatterns: ['entry', 'role', 'permission'], secondaryKey: '',
  };
  return {
    ...initialDraftPopulation(templateId), ...initialDraftCompliance(templateId), ...initialDraftEvidence(templateId),
    templateId, controlName: `Population browser ${procedures[index]}`, sections: initialDraftSections(templateId),
    scope: 'The independently declared synthetic population for August 2026.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: { bindingId: ids.next(), displayName: 'Synthetic source', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    targets: [
      ...(index === 0
        ? [snapshotFromRegistration({ ...referenceSource, digest: registrationDigest(referenceSource) })]
        : []),
      snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) }),
    ],
    instructions: [],
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
  };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Population browser verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  const uow = new PostgresProceduresUnitOfWork(db);
  for (const [index, procedureId] of procedures.entries()) {
    const row = activeRunVersion(procedureId, ids.next(), String(auditor.id), inputs(index !== 2 ? 'P-2' : 'P-3', index));
    await uow.execute(async context => { await context.procedures.insertProcedure(row); await context.procedures.insertVersion(row); });
  }
  storage = await startSyntheticS3();
  await startWorker();
});

async function startWorker(): Promise<void> {
  workerLog = '';
  const worker = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, ...storage.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '', CREDENTIAL_TOKENS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure: string | null = null;
  worker.on('error', error => { failure = error.name; });
  const exited = new Promise<void>(resolveExit => worker.once('close', code => { if (code !== null && code !== 0) failure = `Worker exited ${code}`; resolveExit(); }));
  worker.stdout.on('data', data => { workerLog += String(data); });
  worker.stderr.on('data', data => { workerLog += String(data); });
  stopWorker = async (force = false) => { worker.kill(force ? 'SIGKILL' : 'SIGTERM'); await exited; };
  await expect.poll(() => { if (failure) throw new Error(`${failure}: ${workerLog}`); return workerLog.includes('Heartbeat loop started'); }, { timeout: 45_000 }).toBe(true);
}

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (sql) {
    try {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' IN (SELECT run_id::text FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      // The check outcomes and evaluations name their Observation with a real foreign
      // key, so they go first. A cleanup that does not know about a new table throws, and
      // then EVERY row this file created survives — which is how one missing DELETE made
      // `procedures.spec.ts`'s empty-list test fail for a reason that was not its own.
      await sql`DELETE FROM run_observation_evaluation WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_observation_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_observation WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_step_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_session_step WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_work_item WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_row WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_snapshot WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_evidence WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_initiation_request WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[])`;
      await sql`DELETE FROM procedure WHERE procedure_id=ANY(${procedures}::uuid[])`;
    } finally { await sql.end({ timeout: 5 }); }
  }

});

async function start(page: Page, index: number, waitForPopulation = true): Promise<string> {
  await page.goto(`/procedures/${procedures[index]}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  if (!waitForPopulation) return runId;
  await expect.poll(async () => (await sql`SELECT status FROM population_execution WHERE run_id=${runId}`)[0]?.status, { timeout: 30_000 }).toMatch(/POPULATION_READY|TERMINAL/);
  await page.reload();
  return runId;
}

async function displayedCount(page: Page, label: string, value: number): Promise<void> {
  const section = page.getByRole('region', { name: 'Population acquisition' });
  await expect(section.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText(String(value));
}

test.describe('Auditor population acquisition', () => {
  test.use({ storageState: AUTH_STATE.auditor });
  test('file population is processed by the queue and preserves original Evidence', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    firstRunId = await start(page, 0);
    await expect(page.getByText('Running', { exact: true })).toBeVisible();
    await displayedCount(page, 'Rows acquired', 12);
    await displayedCount(page, 'Included', 12);
    await displayedCount(page, 'Excluded', 0);
    await displayedCount(page, 'Indeterminate', 0);
    const [evidence] = await sql`SELECT * FROM population_evidence WHERE run_id=${firstRunId}`;
    expect(evidence).toBeTruthy();
    expect(storage.requests.filter(request => request.method === 'PUT').every(request => request.conditional)).toBe(true);
    expect(storage.requests.some(request => request.method === 'GET' && request.key === evidence!.object_key)).toBe(true);
    const storedBytes = storage.objects.get(String(evidence!.object_key));
    expect(Buffer.from(storedBytes!)).toEqual(await readFile(join(process.cwd(), 'fixtures/northstar/generated', files[0]!)));
    await expect(page.getByText(String(evidence!.evidence_id), { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('population-ready.png'), fullPage: true });
  });
  test('freezes the Reference Source first, then observes the AccessGate extraction', async ({ page }) => {
    test.setTimeout(120_000);
    // The population Run is the one above; wait for its execution stage to finish.
    await expect.poll(async () => (await sql`SELECT status FROM run_execution WHERE run_id=${firstRunId}`)[0]?.status,
      { timeout: 60_000 }).toBe('EXTRACTION_COMPLETE');

    const [step] = await sql`SELECT step_id,state,attempts,evidence_id FROM run_session_step WHERE run_id=${firstRunId}`;
    expect(step).toMatchObject({ state: 'ACQUIRED', attempts: 1 });
    const [referenceEvidence] = await sql`SELECT object_key,digest,size,state,kind FROM run_evidence WHERE evidence_id=${step!.evidence_id}`;
    expect(referenceEvidence).toMatchObject({ state: 'REGISTERED', kind: 'reference-source' });
    // The bytes the synthetic system actually served, unchanged — including the `entry`
    // ordinals that keep two conflicting RoleMatrix policy entries distinguishable.
    const served = await readFile(join(process.cwd(), 'fixtures/northstar/generated/role-matrix.csv'));
    expect(Buffer.from(storage.objects.get(String(referenceEvidence!.object_key))!)).toEqual(served);
    expect(String(referenceEvidence!.digest)).toBe(createHash('sha256').update(served).digest('hex'));

    const [item] = await sql`SELECT work_item_id,state,attempts,observations,evidence_id,diagnostic FROM run_work_item WHERE run_id=${firstRunId}`;
    expect(item).toMatchObject({ state: 'OBSERVED', attempts: 1 });
    // Twelve Active accounts, eleven distinct: AG-1007 is seeded twice.
    expect(Number(item!.observations)).toBe(11);
    const observations = await sql`SELECT population_record_key,found,identity FROM run_observation WHERE run_id=${firstRunId} ORDER BY population_record_key`;
    expect(observations).toHaveLength(11);
    expect(observations.filter(row => row.found === 'true')).toHaveLength(10);
    const ambiguous = observations.find(row => row.population_record_key === 'AG-1007')!;
    expect(ambiguous.found).toBe('ambiguous');
    expect(ambiguous.identity).toBeNull();
    const grounded = observations.find(row => row.population_record_key === 'AG-1001')!;
    expect((grounded.identity as { grounding: { evidenceId: string } }).grounding.evidenceId).toBe(item!.evidence_id);
    const [roles] = await sql`SELECT attributes FROM run_observation WHERE run_id=${firstRunId} AND population_record_key='AG-1001'`;
    expect((roles!.attributes as { name: string; originalValue: unknown }[]).find(a => a.name === 'roles')?.originalValue).toEqual(['AP_CLERK']);

    // Story 3.4, against the bytes the synthetic system really served. The real
    // AccessGate collection envelope satisfies the closed-envelope completeness rule, so
    // the extraction is PROVABLY complete: a key outside `EXTRACTION_ENVELOPE_KEYS`, or a
    // missing `complete`, would put `extraction-incomplete` here and make every absence
    // from this extraction UNINSPECTED.
    // `diagnostic` is in the SELECT above, deliberately: without it this read `undefined`
    // and the assertion could not fail — which is how it stayed green against a build
    // whose closed envelope did not name `synthetic` and judged this extraction partial.
    expect(item!.diagnostic).toBe('duplicate-record-keys:1');

    // Every stored row's digest recomputed FROM THE ROW, the way an integrity check does.
    const registered = await sql`SELECT observation_id::text AS id,work_item_id::text AS item,step_execution_id::text AS step,population_record_key AS key,target_system,found,capture_method,match_origin,schema_version,identity,attributes,evidence_ids,digest,coverage,observed_at_source,to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at FROM run_observation WHERE run_id=${firstRunId} ORDER BY population_record_key`;
    const digests = registered.map((row) => {
      const record: ObservationRecord = {
        schemaVersion: Number(row.schema_version) as 1,
        observationId: String(row.id),
        workItemId: String(row.item),
        populationRecordKey: String(row.key),
        targetSystem: String(row.target_system),
        found: String(row.found) as ObservationRecord['found'],
        observedAt: String(row.observed_at),
        stepExecutionId: String(row.step),
        captureMethod: String(row.capture_method) as ObservationRecord['captureMethod'],
        matchOrigin: String(row.match_origin) as ObservationRecord['matchOrigin'],
        identity: row.identity as ObservationRecord['identity'],
        attributes: row.attributes as ObservationRecord['attributes'],
        evidenceIds: row.evidence_ids as string[],
      };
      expect(String(row.digest)).toBe(observationDigest(record));
      // Derived, not minted, so a redelivery names the same Observation.
      expect(String(row.id)).toBe(observationIdFor(String(row.item), String(row.key)));
      // The retained source and the normalized column are the same instant.
      expect(Date.parse(String(row.observed_at_source))).toBe(Date.parse(String(row.observed_at)));
      return String(row.digest);
    });
    // Ten resolved matches are COVERED; the ambiguous one is its own coverage state,
    // because H's per-record coverage counts found in {true, false} only.
    expect(registered.filter((row) => row.coverage === 'COVERED')).toHaveLength(10);
    // `population_record_key AS key` in the SELECT above: the row property is `key`.
    expect(registered.find((row) => row.key === 'AG-1007')?.coverage).toBe('AMBIGUOUS');

    // ONE registration event, carrying every digest, committed with the rows.
    const registrations = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${firstRunId} AND event_type='execution.observations-registered'`;
    expect(registrations).toHaveLength(1);
    const payload = registrations[0]!.payload as Record<string, unknown>;
    expect(new Set(payload['digests'] as string[])).toEqual(new Set(digests));
    expect(payload['batchDigest']).toBe(observationBatchDigest(payload['digests'] as string[]));
    expect(payload['coverage']).toEqual({ COVERED: 10, UNINSPECTED: 0, AMBIGUOUS: 1 });
    // Every per-Observation check outcome committed with them: four apiece for the ten
    // resolved matches, three for the ambiguous one (no identity check without a match).
    const checks = await sql`SELECT check_name,outcome,count(*)::int AS n FROM run_observation_check WHERE run_id=${firstRunId} GROUP BY 1,2 ORDER BY 1`;
    expect(checks.reduce((total, row) => total + Number(row.n), 0)).toBe(43);
    expect(checks.filter((row) => row.outcome === 'FAIL')).toEqual([
      { check_name: 'ambiguous-match', outcome: 'FAIL', n: 1 },
    ]);

    // The one Session Step ran before the one Work Item, in the chain itself.
    const events = await sql`SELECT payload->>'diagnostic' AS diagnostic FROM audit_events WHERE aggregate_id=${firstRunId} AND event_type='lifecycle.adapter-execution' ORDER BY sequence`;
    const order = events.map(row => String(row.diagnostic));
    expect(order.indexOf('reference-source-acquired')).toBeLessThan(order.indexOf('work-item-attempt-started'));

    // The token appears in NOTHING the Run stored, and not in the worker's own log.
    const stored = await sql`
      SELECT string_agg(t, ' ') AS text FROM (
        SELECT payload::text AS t FROM audit_events WHERE aggregate_id=${firstRunId}
        UNION ALL SELECT row_to_json(e)::text FROM run_evidence e WHERE run_id=${firstRunId}
        UNION ALL SELECT row_to_json(x)::text FROM run_execution x WHERE run_id=${firstRunId}
        UNION ALL SELECT row_to_json(w)::text FROM run_work_item w WHERE run_id=${firstRunId}
        UNION ALL SELECT row_to_json(s)::text FROM run_step_execution s WHERE run_id=${firstRunId}
        UNION ALL SELECT row_to_json(o)::text FROM run_observation o WHERE run_id=${firstRunId}
      ) AS rows(t)`;
    expect(String(stored[0]?.text ?? '')).not.toContain(READ_ONLY_TOKEN);
    for (const bytes of storage.objects.values()) {
      expect(Buffer.from(bytes).toString('utf8')).not.toContain(READ_ONLY_TOKEN);
    }
    expect(workerLog).not.toContain(READ_ONLY_TOKEN);

    await page.goto(`/runs/${firstRunId}`);
    const section = page.getByRole('region', { name: 'Target System execution' });
    await expect(section.getByRole('cell', { name: 'RoleMatrix', exact: true })).toBeVisible();
    await expect(section.getByRole('cell', { name: 'Acquired', exact: true })).toBeVisible();
    await expect(section.getByRole('cell', { name: 'AccessGate', exact: true })).toBeVisible();
    await expect(section.getByText('Observed', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  });

  test('truncated file retains Evidence and reports failed independent count and digest', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await start(page, 1);
    await expect(page.getByText('Inconclusive', { exact: true })).toBeVisible();
    await expect(page.getByText('declared-count: Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('declared-digest: Failed', { exact: true })).toBeVisible();
    const [evidence] = await sql`SELECT object_key FROM population_evidence WHERE run_id=${runId}`;
    expect(Buffer.from((storage.objects.get(String(evidence!.object_key)))!)).toEqual(await readFile(join(process.cwd(), 'fixtures/northstar/generated', files[1]!)));
  });
  test('API population preserves the decimal boundary, exclusions and unknown date', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await start(page, 2);
    await expect(page.getByText('Inconclusive', { exact: true })).toBeVisible();
    await displayedCount(page, 'Rows acquired', 13);
    await displayedCount(page, 'Included', 10);
    await displayedCount(page, 'Excluded', 2);
    await displayedCount(page, 'Indeterminate', 1);
    const rows = await sql`SELECT values->>'transaction_id' AS key,disposition,reasons FROM population_row WHERE run_id=${runId} ORDER BY ordinal`;
    expect(rows.find(row => row.key === 'TX-500001')?.disposition).toBe('included');
    expect(rows.find(row => row.key === 'TX-500010')?.disposition).toBe('excluded');
    expect(rows.find(row => row.key === 'TX-500011')?.disposition).toBe('excluded');
    expect(rows.find(row => row.key === 'TX-500007')?.disposition).toBe('indeterminate');
    await expect(page.getByRole('table')).toContainText('Invalid date: processed_time');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  });
  test('a killed worker resumes the stored acquisition envelope without replacing Evidence', async ({ page }) => {
    test.setTimeout(120_000);
    const hold = storage.holdNextPut('/acquisition-v1');
    try {
      const runId = await start(page, 3, false);
      const envelopeKey = await hold.stored;
      expect(envelopeKey).toBe(`population/${runId}/acquisition-v1`);
      const [reserved] = await sql`SELECT * FROM population_evidence WHERE run_id=${runId}`;
      expect(reserved?.state).toBe('RESERVED');
      const originalEnvelope = Buffer.from(storage.objects.get(envelopeKey)!);
      const [before] = await sql`SELECT attempts,status,started_at FROM population_execution WHERE run_id=${runId}`;
      expect(before).toMatchObject({ attempts: 1, status: 'ACQUIRING' });

      // SIGKILL prevents graceful shutdown from finishing or releasing the claim.
      await stopWorker!(true);
      hold.release();
      // Advance only this dead worker's persisted lease instead of waiting 120 seconds.
      // Keep the original Run/attempt start times and attempt counter unchanged.
      await sql`UPDATE population_execution SET lease_until=now()-interval '1 second' WHERE run_id=${runId} AND status='ACQUIRING'`;
      await startWorker();
      await expect.poll(async () => (await sql`SELECT status FROM population_execution WHERE run_id=${runId}`)[0]?.status, { timeout: 30_000 }).toBe('POPULATION_READY');
      const [after] = await sql`SELECT attempts,status,started_at FROM population_execution WHERE run_id=${runId}`;
      expect(after).toMatchObject({ attempts: 2, status: 'POPULATION_READY', started_at: before!.started_at });
      const [registered] = await sql`SELECT * FROM population_evidence WHERE run_id=${runId}`;
      expect(registered).toMatchObject({ evidence_id: reserved!.evidence_id, envelope_key: envelopeKey, envelope_digest: reserved!.envelope_digest, state: 'REGISTERED' });
      expect(Buffer.from(storage.objects.get(envelopeKey)!)).toEqual(originalEnvelope);
      expect(storage.requests.filter(request => request.key === envelopeKey && request.method === 'PUT')).toHaveLength(1);
      expect(storage.requests.some(request => request.key === envelopeKey && request.method === 'GET')).toBe(true);
      expect(Buffer.from(storage.objects.get(String(registered!.object_key))!)).toEqual(await readFile(join(process.cwd(), 'fixtures/northstar/generated', files[0]!)));
      expect(storage.requests.filter(request => request.key === registered!.object_key && request.method === 'PUT')).toHaveLength(1);
      expect((await sql`SELECT count(*)::int AS count FROM population_row WHERE run_id=${runId}`)[0]?.count).toBe(12);
      await page.reload();
      await expect(page.getByText('Running', { exact: true })).toBeVisible();
      await displayedCount(page, 'Included', 12);
      await expect(page.getByRole('region', { name: 'Population acquisition' })).toContainText('Attempts: 2');
      await expect(page.getByText(String(reserved!.evidence_id), { exact: true })).toBeVisible();
    } finally {
      hold.release();
    }
  });
  test('an unsupported source displays abandoned Evidence without pending verification', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await start(page, 4);
    await expect(page.getByText('Run Failed', { exact: true })).toBeVisible();
    const population = page.getByRole('region', { name: 'Population acquisition' });
    await expect(population.getByText('Abandoned', { exact: true })).toBeVisible();
    await expect(population.getByText('Not registered; acquisition stopped.', { exact: true })).toBeVisible();
    await expect(population.getByText('Reserved; verification pending', { exact: true })).toHaveCount(0);
    expect((await sql`SELECT state,raw_digest FROM population_evidence WHERE run_id=${runId}`)[0]).toMatchObject({ state: 'ABANDONED', raw_digest: null });

    // Story 3.5: the terminal transition sealed the package, and the Result names the gap
    // and the abandonment rather than leaving either as an absence a reader takes for
    // "fine". A reservation nothing was written to is never silently dropped.
    const sealed = page.getByRole('region', { name: 'Evidence package' });
    await expect(sealed).toContainText('Sealed as incomplete.');
    await expect(sealed.getByRole('heading', { name: 'Required artifacts that were never registered' })).toBeVisible();
    await expect(sealed.getByRole('heading', { name: 'Abandoned reservations' })).toBeVisible();
    await expect(sealed.getByText(`Population: population/${runId}/raw`, { exact: true })).toHaveCount(2);
    expect((await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${runId}`)[0]).toMatchObject({ state: 'INCOMPLETE', run_state: 'RUN_FAILED' });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  });
});
