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
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
  READ_ONLY_CREDENTIAL,
  READ_ONLY_TOKEN,
} from './credentials';

const ids = new CryptoUuidV7Generator();
/** The auditor's own scope sentence. The sealed Result shows it VERBATIM (Story 3.9). */
const SCOPE = 'The independently declared synthetic population for August 2026.';
const procedures = [ids.next(), ids.next(), ids.next(), ids.next(), ids.next()];
const files = ['accessgate-active-accounts.csv', 'accessgate-active-accounts-truncated.csv'];
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: ((force?: boolean) => Promise<void>) | undefined;
let workerLog = '';
let firstRunId: string;
let p3RunId: string;

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
    scope: SCOPE,
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
    env: {
      ...process.env, ...storage.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '',
      CREDENTIAL_TOKENS, EXCEPTION_FINGERPRINT_KEY, EXCEPTION_FINGERPRINT_KEY_ID,
    },
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
      await sql`DELETE FROM run_gate_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      // Story 3.9: the sealed Result carries a real foreign key to its Run.
      await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_evidence WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_row WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_snapshot WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_evidence WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM population_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
      await sql`DELETE FROM run_initiation_request WHERE procedure_id=ANY(${procedures}::uuid[])`;
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

/**
 * One acquisition count, on the Evidence tab.
 *
 * Story 3.11 split Run Detail into five tab ROUTES: the acquisition and its artifact live
 * under Evidence, and the Result tab carries the sealed Result's own reconciliation. The
 * journey is unchanged; only the address is.
 */
async function openEvidence(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}/evidence`);
  await expect(page.getByRole('region', { name: 'Population acquisition' })).toBeVisible();
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
    // The population is ready. The lifecycle label is whatever the Run has reached by now
    // and NOT asserted here: Story 3.8 made the adapter stage run the Run-level Gate when
    // its last Work Item completes, so this Run goes on to conclude on its own — the
    // journey below waits for that deliberately rather than racing it.
    await openEvidence(page, firstRunId);
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
    // Every per-Observation check outcome committed with them: five apiece for the ten
    // resolved matches, four for the ambiguous one (no identity check without a match).
    const checks = await sql`SELECT check_name,outcome,count(*)::int AS n FROM run_observation_check WHERE run_id=${firstRunId} GROUP BY 1,2 ORDER BY 1`;
    expect(checks.reduce((total, row) => total + Number(row.n), 0)).toBe(54);
    expect(checks.filter((row) => row.outcome === 'FAIL')).toEqual([
      { check_name: 'ambiguous-match', outcome: 'FAIL', n: 1 },
    ]);

    // Story 3.6, against the bytes the synthetic system really served: every grounding was
    // re-read out of the stored extraction and agreed, so the ten resolved records are
    // MATCHED. The ambiguous one grounded nothing, so it is UNJUDGED — which is not a
    // pass, and `ambiguous-match` above is where it is judged.
    expect(checks.find((row) => row.check_name === 'observation-corroboration')).toEqual({
      check_name: 'observation-corroboration', outcome: 'PASS', n: 11,
    });
    expect(payload['corroboration']).toEqual({ MATCHED: 10, CONTRADICTORY: 0, UNJUDGED: 1 });
    const corroborated = await sql`SELECT corroboration,count(*)::int AS n FROM run_observation WHERE run_id=${firstRunId} GROUP BY 1 ORDER BY 1`;
    expect(corroborated).toEqual([
      { corroboration: 'MATCHED', n: 10 },
      { corroboration: 'UNJUDGED', n: 1 },
    ]);
    // Not only the rollup: every stored attribute carries its own verdict.
    const verdicts = new Set(
      registered.flatMap((row) => [
        ...(row.identity === null ? [] : [(row.identity as { corroboration: string }).corroboration]),
        ...(row.attributes as { corroboration: string }[]).map((attribute) => attribute.corroboration),
      ]),
    );
    expect(verdicts).toEqual(new Set(['matched']));

    // Story 3.7, against the real golden population: every named per-record case of
    // `fixtures/northstar/expectations/p-2-sod-conflicts.json`, produced by a real Run of
    // the real Procedure against the real synthetic system. The expectation file is DATA
    // (AD-12) and is read here off disk, never imported by anything that decides an
    // outcome. If a case disagrees, the implementation is wrong.
    const expectations = JSON.parse(
      await readFile(join(process.cwd(), 'fixtures/northstar/expectations/p-2-sod-conflicts.json'), 'utf8'),
    ) as {
      run_expectation: { terminal_outcome: string };
      cases: { case_id: string; record_key: string | null; expected_record_evaluation: string | null }[];
    };
    const evaluations = await sql`SELECT o.population_record_key AS key,e.value,e.origin,e.diagnostic FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${firstRunId} ORDER BY o.population_record_key`;
    expect(evaluations).toHaveLength(11);
    expect(evaluations.every(row => row.origin === 'RULE')).toBe(true);
    const verdict = new Map(evaluations.map(row => [String(row.key), String(row.value)]));
    const named = expectations.cases.filter(entry => entry.record_key !== null);
    expect(named).toHaveLength(11);
    for (const entry of named) {
      expect(verdict.get(entry.record_key!), `${entry.case_id} (${entry.record_key!})`)
        .toBe(entry.expected_record_evaluation);
    }
    // The P-2 form of an unnamed value, quoted verbatim.
    expect(String(evaluations.find(row => row.key === 'AG-1006')?.diagnostic))
      .toContain('rule does not name value UNKNOWN_ROLE_X');

    // One permanent Exception per failing record, fingerprinted with the deployment's key
    // and created in the transaction that registered the Observation.
    const raised = await sql`SELECT population_record_key AS key,condition_ids,fingerprint,fingerprint_key_id,diagnostics FROM run_exception WHERE run_id=${firstRunId} ORDER BY population_record_key`;
    expect(raised.map(row => String(row.key))).toEqual(['AG-1003', 'AG-1004', 'AG-1005']);
    expect(raised.every(row => /^[0-9a-f]{64}$/.test(String(row.fingerprint)))).toBe(true);
    expect(raised.every(row => row.fingerprint_key_id === EXCEPTION_FINGERPRINT_KEY_ID)).toBe(true);
    expect(String(raised[0]!.diagnostics)).toContain('CREATE_VENDOR + APPROVE_VENDOR');
    // Never deleted, and never rewritten.
    await expect(sql`UPDATE run_exception SET population_record_key='x' WHERE run_id=${firstRunId}`)
      .rejects.toThrow(/cannot be changed/);

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

    // Story 3.8, against the real golden population: the Run-level Gate ran when the last
    // Work Item completed, wrote one row per addendum §H check, and concluded the Run at
    // the terminal outcome the EXPECTATION FILE names — read off disk, never imported.
    // P-2's golden population carries an unknown role, a duplicate account and a duplicate
    // conflicting policy entry, and each of those prevents Pass.
    const outcome = expectations.run_expectation.terminal_outcome;
    expect(outcome).toBe('Inconclusive');
    await expect
      .poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${firstRunId}`)[0]?.state,
        { timeout: 60_000 })
      .toBe(outcome.toUpperCase());
    // `records` is in the SELECT deliberately: without it the assertions below read
    // `undefined` and could not fail — the trap `diagnostic` fell into on the Work Item
    // read a few stories ago.
    const gate = await sql`SELECT check_name,outcome,diagnostics,records,total FROM run_gate_check WHERE run_id=${firstRunId} ORDER BY check_name`;
    expect(gate).toHaveLength(20);
    const failed = gate.filter(row => row.outcome === 'FAIL');
    // AG-1007 is seeded twice in the population AND resolves twice in the extraction, so
    // its match is ambiguous, its coverage is not `COVERED`, and the Source primary key is
    // duplicated. AG-1006 carries UNKNOWN_ROLE_X, which RoleMatrix does not declare, so a
    // compiled condition met a value outside the set it names (§B). Four §H rows, each
    // naming a different defect on a different seeded record.
    expect(failed.map(row => String(row.check_name)).sort()).toEqual([
      'ambiguous-match', 'duplicate-primary-keys', 'per-record-coverage', 'unnamed-value',
    ]);
    expect(failed.find(row => row.check_name === 'unnamed-value')?.diagnostics).toEqual(['unnamed-value']);
    expect(failed.find(row => row.check_name === 'unnamed-value')?.records).toEqual(['AG-1006']);
    expect(failed.find(row => row.check_name === 'per-record-coverage')?.diagnostics)
      .toEqual(['record-ambiguous']);
    expect(failed.find(row => row.check_name === 'duplicate-primary-keys')?.diagnostics)
      .toEqual(['duplicate-primary-key']);
    // Every check outcome is a Timeline event, and the terminal transition sealed.
    const gateEvents = await sql`SELECT payload->>'check' AS check FROM audit_events WHERE aggregate_id=${firstRunId} AND event_type='execution.gate-checked'`;
    expect(gateEvents.length).toBeGreaterThanOrEqual(21);
    expect((await sql`SELECT run_state FROM run_evidence_package WHERE run_id=${firstRunId}`)[0]?.run_state)
      .toBe('INCONCLUSIVE');

    // Story 3.9, against the same golden Run: the Result sealed in that transaction, at the
    // outcome the expectation file names. Three accounts really did raise an Exception, and
    // the outcome is still Inconclusive — the §E.1 Gate row sits ABOVE Control Failure, and
    // this is that ordering over a real Run rather than over constructed facts.
    const [sealed] = await sql`SELECT version,outcome,outcome_row,sealed,run_state,gate_passed,scope,publication FROM run_result WHERE run_id=${firstRunId}`;
    expect(sealed).toMatchObject({
      version: 1, outcome: outcome.toUpperCase(), outcome_row: 'gate-failed',
      sealed: true, run_state: 'INCONCLUSIVE', gate_passed: false,
    });
    const published = sealed!.publication as {
      scope: string; population: Record<string, number>; exceptions: { total: number };
      unevaluated: { total: number }; controlFields: string[]; statement: string;
      gate: { passed: boolean; failed: string[] };
    };
    // The auditor's own sentence, verbatim, exactly as the version stored it.
    expect(published.scope).toBe(SCOPE);
    // Twelve rows over ELEVEN distinct accounts: the served file already carries only the
    // active ones, so nothing is excluded, and AG-1007 is seeded twice — which is what
    // failed the duplicate-primary-keys row. The counts are over ROWS, so
    // `inspected + uninspected` is `included` and an auditor can check the arithmetic.
    expect(published.population).toEqual({ rowsParsed: 12, included: 12, excluded: 0, indeterminate: 0 });
    expect(published.exceptions.total).toBe(3);
    expect(published.unevaluated.total).toBeGreaterThan(0);
    expect(published.controlFields).toEqual(['roles']);
    expect(published.gate.passed).toBe(false);
    expect(published.statement).toBe('The Evidence does not support a conclusion.');
    expect((await sql`SELECT count(*)::int AS total FROM audit_events WHERE aggregate_id=${firstRunId} AND event_type='lifecycle.result-sealed'`)[0]?.total).toBe(1);

    await page.goto(`/runs/${firstRunId}`);
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    // Story 3.11: the Reference Sources and the Work Items are the Execution Timeline's
    // own nested rows, not a table on the Result tab. The journey is the same — what ran,
    // in what order, with what state — and the address and the shape are the contract's.
    await page.goto(`/runs/${firstRunId}/timeline`);
    const section = page.getByRole('region', { name: 'Execution Timeline' });
    await expect(section.getByText('RoleMatrix', { exact: true })).toBeVisible();
    await expect(section.getByText('Acquired', { exact: true })).toBeVisible();
    await expect(section.getByText('AccessGate', { exact: true })).toBeVisible();
    await expect(section.getByText('Observed', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  });

  test('truncated file retains Evidence and reports failed independent count and digest', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await start(page, 1);
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    await openEvidence(page, runId);
    await expect(page.getByText('declared-count: Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('declared-digest: Failed', { exact: true })).toBeVisible();
    const [evidence] = await sql`SELECT object_key FROM population_evidence WHERE run_id=${runId}`;
    expect(Buffer.from((storage.objects.get(String(evidence!.object_key)))!)).toEqual(await readFile(join(process.cwd(), 'fixtures/northstar/generated', files[1]!)));
  });
  test('API population preserves the decimal boundary, exclusions and unknown date', async ({ page }) => {
    test.setTimeout(90_000);
    p3RunId = await start(page, 2);
    // The lifecycle label is NOT asserted here. TX-500007 carries no processed_time, so
    // the inclusion accounting is incomplete — and that no longer ends the Run at
    // acquisition: §H's early-stop row is "Population acquisition", which is about
    // acquisition FAILING, and §E decides the Gate rows after the last Work Item. The Run
    // carries on into its adapter stage and the journey below waits for it deliberately
    // rather than racing it.
    await openEvidence(page, p3RunId);
    await displayedCount(page, 'Rows acquired', 13);
    await displayedCount(page, 'Included', 10);
    await displayedCount(page, 'Excluded', 2);
    await displayedCount(page, 'Indeterminate', 1);
    const rows = await sql`SELECT values->>'transaction_id' AS key,disposition,reasons FROM population_row WHERE run_id=${p3RunId} ORDER BY ordinal`;
    expect(rows.find(row => row.key === 'TX-500001')?.disposition).toBe('included');
    expect(rows.find(row => row.key === 'TX-500010')?.disposition).toBe('excluded');
    expect(rows.find(row => row.key === 'TX-500011')?.disposition).toBe('excluded');
    expect(rows.find(row => row.key === 'TX-500007')?.disposition).toBe('indeterminate');
    // Scoped to the population region: the Evidence tab also carries the integrity table
    // when a sweep has run, so a bare `getByRole('table')` is ambiguous.
    await expect(
      page.getByRole('region', { name: 'Population acquisition' }).getByRole('table'),
    ).toContainText('Invalid date: processed_time');
    // The check the Run will conclude on was recorded here, at acquisition, and the Run is
    // still executable: the included set is well defined, only its accounting is short.
    const [snapshot] = await sql`SELECT checks FROM population_snapshot WHERE run_id=${p3RunId}`;
    expect((snapshot!.checks as { name: string; passed: boolean }[]).filter(check => !check.passed))
      .toEqual([{ name: 'complete-inclusion', passed: false }]);
    expect((await sql`SELECT status FROM population_execution WHERE run_id=${p3RunId}`)[0]?.status)
      .toBe('POPULATION_READY');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  });

  test('observes the ApproveNow extraction and concludes P-3 at the Run-level Gate', async ({ page }) => {
    test.setTimeout(120_000);
    // The P-3 counterpart of the AccessGate journey above: a real worker, the real
    // synthetic ApproveNow service, the real golden LedgerFlow population, and every named
    // per-record case of `fixtures/northstar/expectations/p-3-high-value-approvals.json`
    // asserted against what the Run actually stored. Before the inclusion check moved to
    // the Gate, none of these cases could be produced by a Run at all: one indeterminate
    // row ended it before its first Work Item, and twelve of the thirteen were reachable
    // only through a hand-built unit test.
    // Playwright restarts its worker after a failure, which reloads this module and loses
    // the id the previous test set. Say so, rather than letting the driver report
    // `UNDEFINED_VALUE` from inside a query and hiding which failure was the first one.
    expect(p3RunId, 'the P-3 Run was never initiated: read the FIRST failure in this run').toBeTruthy();
    await expect.poll(async () => (await sql`SELECT status FROM run_execution WHERE run_id=${p3RunId}`)[0]?.status,
      { timeout: 60_000 }).toBe('EXTRACTION_COMPLETE');

    const [item] = await sql`SELECT state,attempts,observations,diagnostic FROM run_work_item WHERE run_id=${p3RunId}`;
    // Ten included rows, nine distinct: TX-500008 is seeded twice with different amounts.
    expect(item).toMatchObject({ state: 'OBSERVED', attempts: 1, observations: 9 });
    expect(item!.diagnostic).toBe('duplicate-record-keys:1');
    const observations = await sql`SELECT population_record_key AS key,found,coverage FROM run_observation WHERE run_id=${p3RunId} ORDER BY population_record_key`;
    expect(observations.map(row => [String(row.key), String(row.found)])).toEqual([
      ['TX-500001', 'true'], ['TX-500002', 'true'],
      // No approval row names TX-500003, and P-3's §C coverage rule accepts "found or
      // proven absent", so the absence is COVERED and the Exception is a real finding.
      ['TX-500003', 'false'],
      ['TX-500004', 'true'], ['TX-500005', 'true'], ['TX-500006', 'true'], ['TX-500008', 'true'],
      // APV-9009 APPROVED and APV-9009B REJECTED both name TX-500009.
      ['TX-500009', 'ambiguous'],
      ['TX-500012', 'true'],
    ]);
    expect(observations.find(row => row.key === 'TX-500003')?.coverage).toBe('COVERED');

    const expectations = JSON.parse(
      await readFile(join(process.cwd(), 'fixtures/northstar/expectations/p-3-high-value-approvals.json'), 'utf8'),
    ) as {
      run_expectation: { terminal_outcome: string };
      cases: { case_id: string; record_key: string | null; expected_record_evaluation: string | null }[];
    };
    const evaluations = await sql`SELECT o.population_record_key AS key,e.value,e.origin FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${p3RunId} ORDER BY o.population_record_key`;
    expect(evaluations.every(row => row.origin === 'RULE')).toBe(true);
    const verdict = new Map(evaluations.map(row => [String(row.key), String(row.value)]));
    const named = expectations.cases.filter(entry => entry.record_key !== null);
    expect(named).toHaveLength(13);
    for (const entry of named) {
      const key = entry.record_key!;
      if (entry.expected_record_evaluation === null) {
        // TX-500010 (one cent under the threshold) and TX-500011 (not USD) are outside the
        // population: their correct treatment is absence, so nothing evaluated them.
        expect(verdict.has(key), `${entry.case_id} (${key}) must not be evaluated`).toBe(false);
        continue;
      }
      if (key === 'TX-500007') {
        // Case D4, and the only one reached this way: no processed_time, so the frozen
        // inclusion rule cannot place it in or out of the Period. It never becomes an
        // Observation, and it is the unaccounted row the Gate concludes the Run on below.
        expect(verdict.has(key)).toBe(false);
        expect(
          (await sql`SELECT disposition FROM population_row WHERE run_id=${p3RunId} AND values->>'transaction_id'=${key}`)[0]?.disposition,
        ).toBe('indeterminate');
        continue;
      }
      expect(verdict.get(key), `${entry.case_id} (${key})`).toBe(entry.expected_record_evaluation);
    }

    // One permanent Exception per failing record, and no others.
    const raised = await sql`SELECT population_record_key AS key,fingerprint,fingerprint_key_id FROM run_exception WHERE run_id=${p3RunId} ORDER BY population_record_key`;
    expect(raised.map(row => String(row.key))).toEqual([
      'TX-500003', 'TX-500004', 'TX-500005', 'TX-500006',
    ]);
    expect(raised.every(row => /^[0-9a-f]{64}$/.test(String(row.fingerprint)))).toBe(true);
    expect(raised.every(row => row.fingerprint_key_id === EXCEPTION_FINGERPRINT_KEY_ID)).toBe(true);

    // The terminal outcome the EXPECTATION FILE names, read off disk. Its own `why` names
    // three causes — a missing processed time, a duplicate transaction id and
    // contradictory approval decisions — and only a Run that reaches all three can have
    // them. Each is one of the failing §H rows below.
    const outcome = expectations.run_expectation.terminal_outcome;
    expect(outcome).toBe('Inconclusive');
    await expect
      .poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${p3RunId}`)[0]?.state,
        { timeout: 60_000 })
      .toBe(outcome.toUpperCase());
    const gate = await sql`SELECT check_name,outcome,diagnostics,records,total FROM run_gate_check WHERE run_id=${p3RunId} ORDER BY check_name`;
    expect(gate).toHaveLength(20);
    const failed = gate.filter(row => row.outcome === 'FAIL');
    expect(failed.map(row => String(row.check_name)).sort()).toEqual([
      'ambiguous-match', 'count-reconciliation-inclusion', 'duplicate-primary-keys',
      'mandatory-values', 'per-record-coverage',
    ]);
    // The missing processed time: ONE unaccounted row, counted once.
    const inclusion = failed.find(row => row.check_name === 'count-reconciliation-inclusion')!;
    expect(inclusion.diagnostics).toEqual(['rows-unaccounted']);
    expect(inclusion.total).toBe(1);
    // The duplicate transaction id, and the contradictory decisions.
    expect(failed.find(row => row.check_name === 'duplicate-primary-keys')?.records).toEqual(['TX-500008']);
    expect(failed.find(row => row.check_name === 'ambiguous-match')?.records).toEqual(['TX-500009']);
    expect(failed.find(row => row.check_name === 'per-record-coverage')?.diagnostics).toEqual(['record-ambiguous']);
    // TX-500003 has no approval id in the population row: a mandatory evaluation field the
    // binding declared and the row does not carry.
    expect(failed.find(row => row.check_name === 'mandatory-values')?.records).toEqual(['TX-500003']);
    expect((await sql`SELECT run_state FROM run_evidence_package WHERE run_id=${p3RunId}`)[0]?.run_state)
      .toBe('INCONCLUSIVE');

    // Story 3.9: the same reconciliation for P-3. Four Exceptions, and still Inconclusive.
    const [p3Result] = await sql`SELECT outcome,outcome_row,sealed,gate_passed,publication FROM run_result WHERE run_id=${p3RunId}`;
    expect(p3Result).toMatchObject({
      outcome: outcome.toUpperCase(), outcome_row: 'gate-failed', sealed: true, gate_passed: false,
    });
    const p3Published = p3Result!.publication as {
      exceptions: { total: number; records: { populationRecordKey: string; fields: Record<string, unknown> }[] };
      controlFields: string[]; population: Record<string, number>;
    };
    expect(p3Published.exceptions.total).toBe(4);
    // §C P-3: the Result reports the approval decision and the approver limit.
    expect(p3Published.controlFields).toEqual(['decision', 'approver_limit']);
    const byKey = new Map(p3Published.exceptions.records.map(record => [record.populationRecordKey, record]));
    expect([...byKey.keys()].sort()).toEqual(['TX-500003', 'TX-500004', 'TX-500005', 'TX-500006']);
    // TX-500006 was approved by somebody whose limit was lower than the amount, so the two
    // §C values are exactly what an auditor needs to see beside the finding.
    expect(byKey.get('TX-500006')!.fields).toEqual({ decision: 'APPROVED', approver_limit: '200000.00' });
    // TX-500003 has NO approval row at all — a proven absence — so there is nothing to
    // report for it, and the Result publishes nothing rather than inventing a value.
    expect(byKey.get('TX-500003')!.fields).toEqual({});
    expect(p3Published.population.indeterminate).toBe(1);

    await page.goto(`/runs/${p3RunId}`);
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    await page.goto(`/runs/${p3RunId}/timeline`);
    const section = page.getByRole('region', { name: 'Execution Timeline' });
    await expect(section.getByText('ApproveNow', { exact: true })).toBeVisible();
    await expect(section.getByText('Observed', { exact: true })).toBeVisible();
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
      await openEvidence(page, runId);
      // The lifecycle label is not asserted here: the resumed worker carries this Run on
      // into its adapter stage and the Run-level Gate concludes it (Story 3.8), so
      // "Running" is a race against the very stage this test just restarted. What the test
      // is about — the envelope reused, the Evidence not replaced, the attempt counted —
      // is asserted above against the rows.
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
    await expect(page.getByText('Run Failed', { exact: true }).first()).toBeVisible();
    await openEvidence(page, runId);
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
