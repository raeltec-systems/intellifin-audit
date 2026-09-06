import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  bindingDigest, bindingDigestEnvelope, initialDraftCompliance, initialDraftEvidence,
  initialDraftPopulation, initialDraftSections, registrationDigest, snapshotFromRegistration,
  type FrozenPlanInputs,
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
} from './credentials';

/**
 * The two terminal outcomes no golden population can produce: Pass and Control Failure.
 *
 * `tests/e2e/population.spec.ts` already drives both golden populations through the real
 * worker and both are Inconclusive — correctly. `accessgate-accounts.json` lists AG-1007
 * twice and `ledgerflow-transactions.json` carries a transaction with no processed time;
 * §H counts duplicate Source primary keys over EVERY parsed row and counts every row the
 * inclusion rule could not place, so both read the SOURCE rather than the included set,
 * no scope escapes either, and a failed §H row is Inconclusive. A golden dataset that
 * seeds every failure mode at once is exactly what it should be. It just cannot also be
 * the dataset that demonstrates success.
 *
 * So this file binds a THIRD population source, `coredirectory-accounts`, which seeds
 * nothing at all — and one of whose two published populations carries a single true
 * conflict. The two Runs below are identical in every other respect: the same Template,
 * the same period, the same cover-sheet generation, the same extraction endpoint and the
 * same RoleMatrix Reference Source the golden P-2 Run freezes. They differ by ONE role on
 * ONE account, which is what makes the difference in outcome attributable to the rule.
 *
 * Everything is real: the worker is a spawned process, the synthetic systems are served
 * over the network, PostgreSQL is real and the object store is a real HTTP surface the
 * AWS SDK talks to. Every assertion reads what the Run actually STORED and compares it
 * with `fixtures/northstar/expectations/clean-*.json`, read off disk (AD-12).
 *
 * **The failing Gate set is asserted EMPTY, before the outcome.** A Pass reached by
 * weakening a check is not a Pass, and naming the empty set is what says so.
 */

const ids = new CryptoUuidV7Generator();
/** The auditor's own scope sentence. The sealed Result shows it VERBATIM (Story 3.9). */
const SCOPE = 'Every active CoreDirectory account for August 2026.';

interface Case {
  /** The expectation file, read off disk and never imported. */
  readonly expectations: string;
  /** The published population the Run binds. */
  readonly file: string;
  readonly label: string;
  readonly procedureId: string;
}

const CASES: readonly Case[] = [
  {
    expectations: 'fixtures/northstar/expectations/clean-pass.json',
    file: 'coredirectory-accounts-compliant.csv',
    label: 'Pass',
    procedureId: ids.next(),
  },
  {
    expectations: 'fixtures/northstar/expectations/clean-control-failure.json',
    file: 'coredirectory-accounts-conflict.csv',
    label: 'Control Failure',
    procedureId: ids.next(),
  },
];

const procedures = CASES.map((entry) => entry.procedureId);

let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';

/** What the expectation files declare, in the shape this spec reads them. */
interface Expectation {
  readonly is_data_not_code: string;
  readonly run_expectation: {
    readonly terminal_outcome: string;
    readonly run_state: string;
    readonly outcome_row: string;
  };
  readonly gate_expectation: { readonly checks_recorded: number; readonly failed_checks: string[] };
  readonly exception_expectation: {
    readonly records: string[];
    readonly reported_pairs?: readonly (readonly string[])[];
  };
  readonly cases: readonly {
    readonly case_id: string;
    readonly record_key: string | null;
    readonly expected_record_evaluation: string | null;
  }[];
}

/** The addendum §E.1 outcome name each expectation file uses, mapped to the stored one. */
const STORED_OUTCOME: Readonly<Record<string, string>> = {
  Pass: 'PASS',
  'Control Failure': 'CONTROL_FAILURE',
  Inconclusive: 'INCONCLUSIVE',
  'Run Failed': 'RUN_FAILED',
};

async function expectationsOf(file: string): Promise<Expectation> {
  const parsed = JSON.parse(await readFile(join(process.cwd(), file), 'utf8')) as Expectation;
  // A read that silently returned nothing would make every assertion below vacuous.
  expect(parsed.is_data_not_code, file).toContain('DATA (AD-12)');
  expect(parsed.cases.length, file).toBeGreaterThanOrEqual(4);
  return parsed;
}

/**
 * One ACTIVE P-2 version over the clean source.
 *
 * The population is the published CSV with its signed cover sheet; the Target System is
 * CoreDirectory's read-only service index, which the adapter follows exactly one hop —
 * the shape `scripts/seed-northstar.mts` registers, so a seeded row is executable. The
 * Reference Source is the SAME RoleMatrix artifact the golden P-2 Run freezes; a second
 * copy would be a second source of truth for one role expansion.
 */
function inputs(entry: Case): FrozenPlanInputs {
  const declaredSchema = ['account_id', 'employee_id', 'username', 'status', 'roles', 'disabled_time'];
  const source = {
    kind: 'versioned-file' as const,
    location: `${NORTHSTAR_BASE_URL}/files/${entry.file}`,
    declaredSchema,
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  const registration = {
    registrationId: ids.next(), displayName: 'CoreDirectory', kind: 'api' as const,
    allowedOrigins: [`${NORTHSTAR_BASE_URL}/coredirectory`], applicationIdentity: '',
    credentialRef: READ_ONLY_CREDENTIAL, permittedActions: ['list-records', 'read-attribute'] as const,
    attributeLabelPatterns: declaredSchema, secondaryKey: '',
  };
  const referenceSource = {
    registrationId: ids.next(), displayName: 'RoleMatrix', kind: 'versioned-file' as const,
    allowedOrigins: [`${NORTHSTAR_BASE_URL}/files/role-matrix.csv`], applicationIdentity: '',
    credentialRef: READ_ONLY_CREDENTIAL, permittedActions: ['read-file', 'read-metadata'] as const,
    attributeLabelPatterns: ['entry', 'role', 'permission'], secondaryKey: '',
  };
  return {
    ...initialDraftPopulation('P-2'), ...initialDraftCompliance('P-2'), ...initialDraftEvidence('P-2'),
    templateId: 'P-2', controlName: `Clean source ${entry.label} ${entry.procedureId}`,
    sections: initialDraftSections('P-2'),
    scope: SCOPE,
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(), displayName: `CoreDirectory ${entry.label}`,
      digest: bindingDigest(source), contract: bindingDigestEnvelope(source),
    },
    targets: [
      snapshotFromRegistration({ ...referenceSource, digest: registrationDigest(referenceSource) }),
      snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) }),
    ],
    instructions: [],
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
  };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Clean-source browser verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  const uow = new PostgresProceduresUnitOfWork(db);
  for (const entry of CASES) {
    const row = activeRunVersion(entry.procedureId, ids.next(), String(auditor.id), inputs(entry));
    await uow.execute(async context => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });
  }
  storage = await startSyntheticS3();
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
  }, { timeout: 45_000 }).toBe(true);
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (!sql) return;
  try {
    // Order is the foreign keys, and a teardown that does not know about a table throws —
    // after which EVERY row this file created survives and `procedures.spec.ts`'s
    // empty-list assertion fails for a reason that is not its own.
    await sql`DELETE FROM pgboss.job WHERE data->>'runId' IN (SELECT run_id::text FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_observation_evaluation WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_observation_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    // Generation 23 cascades an Exception away with its Observation.
    await sql`DELETE FROM run_observation WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_exception WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_step_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_session_step WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_work_item WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
    await sql`DELETE FROM run_gate_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=ANY(${procedures}::uuid[]))`;
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
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/**
 * What a Run that ended somewhere unexpected actually did, in one line.
 *
 * A Run that stops before its first Work Item leaves no population snapshot, no Gate row
 * and no Observation, so every assertion below reads `undefined` and the failure says
 * "received value must be a non-null object" — which names nothing. This reads the
 * checkpoints and the closed diagnostic vocabulary the stages recorded, so the first
 * failure names the stage that stopped.
 */
async function describeRun(runId: string): Promise<string> {
  const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
  const [population] = await sql`SELECT status,attempts,diagnostic FROM population_execution WHERE run_id=${runId}`;
  const [execution] = await sql`SELECT status,attempts,diagnostic FROM run_execution WHERE run_id=${runId}`;
  const events = await sql`SELECT event_type,payload->>'diagnostic' AS diagnostic FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
  return JSON.stringify({
    state: run?.state ?? null,
    population: population ?? null,
    execution: execution ?? null,
    events: events.map(row => `${String(row.event_type)}:${String(row.diagnostic ?? '')}`),
  });
}

/** Initiate one Run through the real interface and wait for it to conclude. */
async function runToTerminal(page: Page, entry: Case): Promise<string> {
  await page.goto(`/procedures/${entry.procedureId}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect
    .poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state,
      { timeout: 90_000 })
    .toMatch(/COMPLETED|INCONCLUSIVE|RUN_FAILED|CANCELED/);
  return runId;
}

for (const entry of CASES) {
  test.describe(`the clean source concludes ${entry.label}`, () => {
    test.use({ storageState: AUTH_STATE.auditor });

    test(`stores ${entry.label} with every Gate row passing`, async ({ page }) => {
      test.setTimeout(180_000);
      const declared = await expectationsOf(entry.expectations);
      const runId = await runToTerminal(page, entry);
      // First, and with the stages' own checkpoints in the message: a Run that stopped
      // early leaves every table below empty, and "received value must be a non-null
      // object" names nothing at all.
      expect(
        (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state,
        await describeRun(runId),
      ).toBe(declared.run_expectation.run_state);

      // The population reconciled: four rows, four included, nothing excluded and nothing
      // the inclusion rule could not place. The counts come from the acquisition the
      // worker really performed against the file the service really served.
      const [snapshot] = await sql`SELECT checks,included,excluded,indeterminate FROM population_snapshot WHERE run_id=${runId}`;
      expect(snapshot).toMatchObject({ included: 4, excluded: 0, indeterminate: 0 });
      expect((snapshot!.checks as { name: string; passed: boolean }[]).filter(check => !check.passed))
        .toEqual([]);
      expect((await sql`SELECT count(*)::int AS parsed FROM population_row WHERE run_id=${runId}`)[0]?.parsed)
        .toBe(4);

      // The Reference Source was frozen as a Session Step before the one Work Item, and
      // the Work Item observed all four accounts.
      const [step] = await sql`SELECT state,attempts,evidence_id FROM run_session_step WHERE run_id=${runId}`;
      expect(step).toMatchObject({ state: 'ACQUIRED', attempts: 1 });
      const [referenceEvidence] = await sql`SELECT object_key,kind,state FROM run_evidence WHERE evidence_id=${step!.evidence_id}`;
      expect(referenceEvidence).toMatchObject({ state: 'REGISTERED', kind: 'reference-source' });
      expect(Buffer.from(storage.objects.get(String(referenceEvidence!.object_key))!))
        .toEqual(await readFile(join(process.cwd(), 'fixtures/northstar/generated/role-matrix.csv')));

      const [item] = await sql`SELECT state,attempts,observations,diagnostic FROM run_work_item WHERE run_id=${runId}`;
      expect(item).toMatchObject({ state: 'OBSERVED', attempts: 1, observations: 4 });
      // No duplicate key and no unkeyed record: the clean source seeds neither.
      expect(item!.diagnostic).toBeNull();

      // Every Observation resolved to exactly one extraction row, is COVERED under P-2's
      // `must-appear` coverage rule, and its grounding re-read out of the frozen bytes.
      const observations = await sql`SELECT population_record_key AS key,found,coverage,corroboration FROM run_observation WHERE run_id=${runId} ORDER BY population_record_key`;
      expect(observations).toHaveLength(4);
      expect(observations.every(row => row.found === 'true')).toBe(true);
      expect(observations.every(row => row.coverage === 'COVERED')).toBe(true);
      expect(observations.every(row => row.corroboration === 'MATCHED')).toBe(true);
      // No per-Observation check failed either — the six §H rows they roll up into are
      // among the twenty asserted below, and this says which side they came from.
      expect(await sql`SELECT check_name FROM run_observation_check WHERE run_id=${runId} AND outcome='FAIL'`)
        .toEqual([]);

      // Story 3.8: twenty §H rows, and NOT ONE of them failed. This assertion comes
      // BEFORE the outcome deliberately. A Pass produced by weakening a check is not a
      // Pass, so the expectation file names the failing set as empty and this compares
      // against that rather than against a list of rows somebody hoped about.
      const gate = await sql`SELECT check_name,outcome,diagnostics,records,total FROM run_gate_check WHERE run_id=${runId} ORDER BY check_name`;
      expect(gate).toHaveLength(declared.gate_expectation.checks_recorded);
      expect(gate.filter(row => row.outcome === 'FAIL').map(row => String(row.check_name)))
        .toEqual(declared.gate_expectation.failed_checks);

      // Every named per-record case, against what the Run stored.
      const evaluations = await sql`SELECT o.population_record_key AS key,e.value,e.origin,e.diagnostic FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${runId} ORDER BY o.population_record_key`;
      expect(evaluations).toHaveLength(4);
      expect(evaluations.every(row => row.origin === 'RULE')).toBe(true);
      const verdict = new Map(evaluations.map(row => [String(row.key), String(row.value)]));
      const named = declared.cases.filter(caseEntry => caseEntry.record_key !== null);
      expect(named).toHaveLength(4);
      for (const caseEntry of named) {
        expect(verdict.get(caseEntry.record_key!), `${caseEntry.case_id} (${caseEntry.record_key!})`)
          .toBe(caseEntry.expected_record_evaluation);
      }

      // The Exceptions the expectation file names, and no others.
      const raised = await sql`SELECT population_record_key AS key,diagnostics,fingerprint,fingerprint_key_id FROM run_exception WHERE run_id=${runId} ORDER BY population_record_key`;
      expect(raised.map(row => String(row.key))).toEqual(declared.exception_expectation.records);
      expect(raised.every(row => /^[0-9a-f]{64}$/.test(String(row.fingerprint)))).toBe(true);
      expect(raised.every(row => row.fingerprint_key_id === EXCEPTION_FINGERPRINT_KEY_ID)).toBe(true);
      for (const pair of declared.exception_expectation.reported_pairs ?? []) {
        expect(String(raised[0]!.diagnostics))
          .toContain(`prohibited permission pair ${pair[0]!} + ${pair[1]!}`);
      }

      // Story 3.9: the sealed Result, at the outcome the expectation file names.
      const outcome = STORED_OUTCOME[declared.run_expectation.terminal_outcome]!;
      expect((await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state)
        .toBe(declared.run_expectation.run_state);
      const [sealed] = await sql`SELECT version,outcome,outcome_row,sealed,run_state,gate_passed,scope,publication FROM run_result WHERE run_id=${runId}`;
      expect(sealed).toMatchObject({
        version: 1, outcome, outcome_row: declared.run_expectation.outcome_row,
        sealed: true, run_state: declared.run_expectation.run_state, gate_passed: true,
      });
      const published = sealed!.publication as {
        scope: string; population: Record<string, number>; exceptions: { total: number };
        unevaluated: { total: number }; controlFields: string[]; statement: string;
        gate: { passed: boolean; failed: string[]; checks: number };
      };
      // The auditor's own sentence, verbatim, exactly as the version stored it.
      expect(published.scope).toBe(SCOPE);
      expect(published.population).toEqual({ rowsParsed: 4, included: 4, excluded: 0, indeterminate: 0 });
      expect(published.exceptions.total).toBe(declared.exception_expectation.records.length);
      expect(published.unevaluated.total).toBe(0);
      expect(published.controlFields).toEqual(['roles']);
      expect(published.gate).toMatchObject({ passed: true, failed: [] });
      expect(published.statement).toBe(
        outcome === 'PASS'
          ? 'Every condition on every inspected record is Compliant.'
          : 'At least one record failed a condition of this control.',
      );
      // The Evidence package sealed at the state the Run reached, with nothing missing.
      expect((await sql`SELECT state,run_state,missing_required,abandoned FROM run_evidence_package WHERE run_id=${runId}`)[0])
        .toMatchObject({
          state: 'SEALED', run_state: declared.run_expectation.run_state,
          missing_required: [], abandoned: [],
        });
      expect((await sql`SELECT count(*)::int AS total FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.result-sealed'`)[0]?.total)
        .toBe(1);

      // And what a person actually sees. The navigation is committed before axe runs: a
      // scan that starts while one is still committing reads a document that is not the
      // page under test and reports a missing title.
      await page.goto(`/runs/${runId}`);
      await expect(page).toHaveTitle(/./);
      await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(entry.label, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Sealed', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('20 of 20 checks passed')).toBeVisible();
      await expect(page.getByText(published.statement)).toBeVisible();
      await expect(page.getByText(SCOPE)).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations)
        .toEqual([]);
    });
  });
}
