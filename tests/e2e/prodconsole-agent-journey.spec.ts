import type { AgentModelResponse } from '@intellifin/application';
import { planProdConsoleTools } from '../../packages/application/src/runs/agent-prodconsole.js';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  initialDraftCompliance, initialDraftEvidence, initialDraftPopulation, initialDraftSections,
  bindingDigest, bindingDigestEnvelope, registrationDigest, snapshotFromRegistration,
  readStructuralSnapshot, readSnapshotCell, parseSnapshotLocator, sha256HexOfBytes,
  type ExecutablePlan, type StoredSnapshot, type FrozenPlanInputs, type PermittedReadAction,
} from '@intellifin/domain';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { NORTHSTAR_BASE_URL } from './northstar';
import { EXCEPTION_FINGERPRINT_KEY, EXCEPTION_FINGERPRINT_KEY_ID } from './credentials';

// Actual compiled worker, real canonical Northstar HTTP/browser and production S3 adapter.
// The named HTTP provider fixture selects opaque tools only; this is local synthetic model
// acceptance, not live-model autonomy or Solari acceptance. No execution facts are seeded.
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const bindingId = ids.next();
const targetId = ids.next();
const controlName = `E2E ProdConsole golden worker ${procedureId}`;
const fixtureJson = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/northstar/${name}`, import.meta.url)), 'utf8'));
const expectation = fixtureJson('expectations/p-4-config-deviation.json') as {
  run_expectation: { terminal_outcome: string };
  cases: { case_id: string; record_key: string | null; expected_record_evaluation?: string | null }[];
};
const baseline = fixtureJson('datasets/configregistry-baseline.json') as { parameters: { parameter: string }[] };
const expectedKeys = [...new Set(baseline.parameters.map(row => row.parameter))].sort();
const declaredCount = (fixtureJson('generated/prodconsole-parameters.count.json') as { declared_count: number }).declared_count;
const pageDataset = fixtureJson('datasets/prodconsole-parameters.json') as {
  snapshot: { snapshot_id: string; taken_at: string };
  observed_parameters: { parameter: string; description: string }[];
};
const catalogue = (fixtureJson('datasets/systems.json') as { target_systems: {
  id: string; display_name: string; origin_path: string; permitted_actions: PermittedReadAction[];
  attribute_label_patterns: string[]; secondary_key: string;
}[] }).target_systems.find(row => row.id === 'prodconsole');
if (!catalogue) throw new Error('Canonical ProdConsole catalogue entry missing.');
const source = {
  kind: 'versioned-file' as const, location: `${NORTHSTAR_BASE_URL}/files/config-registry.csv`,
  declaredSchema: ['parameter', 'approved_value', 'effective_time', 'disposition'],
  sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const,
};
const registration = {
  registrationId: targetId, displayName: catalogue.display_name, kind: 'web' as const,
  allowedOrigins: [`${NORTHSTAR_BASE_URL}${catalogue.origin_path}`], applicationIdentity: '',
  // Public P-4 access must succeed without resolving this unconfigured reference.
  credentialRef: 'cred://synthetic/prodconsole-public', permittedActions: catalogue.permitted_actions,
  attributeLabelPatterns: catalogue.attribute_label_patterns, secondaryKey: catalogue.secondary_key,
};
function inputs(): FrozenPlanInputs {
  return {
    ...initialDraftPopulation('P-4'), ...initialDraftCompliance('P-4'), ...initialDraftEvidence('P-4'),
    templateId: 'P-4', controlName, sections: initialDraftSections('P-4'),
    scope: 'Compare the published ProdConsole configuration with the frozen ConfigRegistry baseline.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: { bindingId, displayName: 'Canonical ConfigRegistry baseline', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions: [{ registrationId: targetId, text: 'Read the frozen ProdConsole parameter and metadata labels.' }],
  };
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
const workerMarkers: string[] = [];
let workerFailure: string | null = null;

async function startWorker(): Promise<void> {
  workerMarkers.length = 0;
  workerFailure = null;
  let stopping = false;
  let closed = false;
  let outputBuffer = '';
  const worker = spawn(process.execPath, [
    '--import',
    pathToFileURL(resolve('tests/fixtures/prodconsole-agent-worker-preload.mjs')).href,
    resolve('apps/worker/dist/main.js'),
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      ...storage.env,
      SERVICE_NAME: 'worker',
      MODEL_PROVIDER: '',
      MODEL_ID: '',
      MODEL_API_KEY: '',
      ANTHROPIC_API_KEY: 'synthetic-prodconsole-provider-interception',
      AGENT_ANTHROPIC_MODEL: 'synthetic-prodconsole-agent-journey',
      AGENT_OPENAI_MODEL: '',
      MODEL_MAX_OUTPUT_TOKENS: '1024',
      OPENAI_API_KEY: '',
      SOLARI_API_KEY: '',
      CREDENTIAL_TOKENS: '',
      EXCEPTION_FINGERPRINT_KEY,
      EXCEPTION_FINGERPRINT_KEY_ID,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.on('error', () => { workerFailure = 'worker-process-error'; });
  const exited = new Promise<void>((resolveExit) => {
    worker.once('close', (code) => {
      closed = true;
      if ((code !== null && code !== 0) || !stopping) workerFailure = 'worker-exited-unexpectedly';
      resolveExit();
    });
  });
  const retainMarkers = (data: unknown): void => {
    outputBuffer += String(data);
    const lines = outputBuffer.split(/\r?\n/u);
    outputBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes('Heartbeat loop started')) workerMarkers.push('Heartbeat loop started');
      const prefix = 'Synthetic ProdConsole journey provider:';
      const marker = line.indexOf(prefix);
      if (marker >= 0) workerMarkers.push(line.slice(marker).trim());
    }
  };
  worker.stdout.on('data', retainMarkers);
  // Stderr is deliberately discarded. A worker error is reported using a fixed code;
  // provider/configuration text must never become a test failure artifact.
  worker.stderr.on('data', () => undefined);
  stopWorker = async () => {
    stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!closed) worker.kill('SIGTERM');
      const graceful = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 30_000); }),
      ]);
      if (!graceful) {
        worker.kill('SIGKILL');
        const forced = await Promise.race([
          exited.then(() => true),
          new Promise<boolean>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 5_000); }),
        ]);
        if (!forced) throw new Error('ProdConsole fixture worker did not stop after SIGKILL.');
        throw new Error('ProdConsole fixture worker exceeded its graceful shutdown deadline.');
      }
      if (workerFailure) throw new Error('ProdConsole fixture worker exited unexpectedly.');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      stopWorker = undefined;
    }
  };
  await expect.poll(() => {
    if (workerFailure) throw new Error(workerFailure);
    return workerMarkers.includes('Heartbeat loop started');
  }, { timeout: 60_000 }).toBe(true);
}

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function startRun(page: Page): Promise<string> {
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the real P-4 worker journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 5 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest)
    VALUES(${bindingId},'Canonical ConfigRegistry baseline',${source.kind},${source.location},${source.declaredSchema},${source.declaredCountMechanism},${bindingDigest(source)})`;
  const version = activeRunVersion(procedureId, versionId, String(auditor.id), inputs());
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async context => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  storage = await startSyntheticS3();
  await startWorker();
});

test.afterAll(async () => {
  let shutdownFailure: unknown;
  try { await stopWorker?.(); } catch (error) { shutdownFailure = error; }
  stopWorker = undefined;
  await storage?.close();
  if (!sql) { if (shutdownFailure) throw shutdownFailure; return; }
  try {
    const runs = await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`;
    const runIds = runs.map((row) => String(row.run_id));
    if (runIds.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
      await sql`DELETE FROM notification WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_wait WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_result_review WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_result WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence_package WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_tool_action WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_agent_turn WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_agent_work WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_observation_evaluation WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_observation_check WHERE run_id = ANY(${runIds}::uuid[])`;
      // Review ledger/command rows cascade from their evaluation, and Exceptions
      // cascade from their Observation. Their immutable-parent guards reject direct
      // deletes while those parents still exist.
      await sql`DELETE FROM run_observation WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_step_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_session_step WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_work_item WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_gate_check WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM run_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_row WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_snapshot WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM population_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM audit_events WHERE aggregate_id = ANY(${runIds})`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id = ANY(${runIds})`;
      await sql`DELETE FROM run_initiation_request WHERE run_id = ANY(${runIds}::uuid[]) OR refused_run_id = ANY(${runIds}::uuid[])`;
      await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
    }
    await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM population_source_binding WHERE binding_id=${bindingId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (shutdownFailure) throw shutdownFailure;
});

test.describe('canonical P-4 through the real compiled worker', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('reconciles every baseline parameter and seals the golden Inconclusive Result', async ({ page }) => {
    test.setTimeout(240_000);
    const runId = await startRun(page);
    await expect.poll(async () => {
      if (workerFailure) throw new Error(workerFailure);
      const [row] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      return ['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'].includes(String(row?.state));
    }, { timeout: 150_000 }).toBe(true);

    // Assert the complete failing §H set BEFORE reading the Result. Neither the declared
    // count nor the baseline is corrected to agree with the other in this fixture.
    const checks = await sql`SELECT check_name,outcome,diagnostics FROM run_gate_check WHERE run_id=${runId} ORDER BY check_name`;
    expect(checks).toHaveLength(20);
    expect(checks.filter(row => row.outcome === 'FAIL').map(row => row.check_name).sort()).toEqual([
      'count-reconciliation-file', 'duplicate-primary-keys', 'per-record-coverage',
      'required-evidence', 'search-completeness',
    ].sort());
    expect(checks.find(row => row.check_name === 'count-reconciliation-file')?.diagnostics).toContain('declared-count-mismatch');

    const populationRows = await sql<{ values: { parameter: string } }[]>`SELECT values FROM population_row WHERE run_id=${runId} AND disposition='included' ORDER BY ordinal`;
    expect(populationRows.map(row => row.values.parameter).sort()).toEqual(baseline.parameters.map(row => row.parameter).sort());
    const items = await sql`SELECT work_item_id,subject_key,registration_id,state,observations,evidence_id FROM run_work_item WHERE run_id=${runId}`;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ subject_key: null, registration_id: targetId, state: 'OBSERVED', observations: expectedKeys.length });

    const observations = await sql<{
      observation_id: string; population_record_key: string; found: string; coverage: string;
      capture_method: string; identity: { name: string; normalizedValue: string; grounding: { evidenceId: string } } | null;
      attributes: { name: string; originalValue: unknown; grounding: unknown }[]; evidence_ids: string[];
    }[]>`SELECT observation_id,population_record_key,found,coverage,capture_method,identity,attributes,evidence_ids FROM run_observation WHERE run_id=${runId} ORDER BY population_record_key`;
    expect(observations.map(row => row.population_record_key)).toEqual(expectedKeys);
    expect(new Set(observations.map(row => row.observation_id)).size).toBe(expectedKeys.length);
    expect(observations.every(row => row.capture_method === 'agent')).toBe(true);
    for (const row of observations.filter(row => row.found === 'true')) {
      expect(row.identity).toMatchObject({ name: 'parameter', normalizedValue: row.population_record_key });
      expect(row.identity?.grounding.evidenceId).toBe(items[0]?.evidence_id);
    }

    // D2-a and D5 share a key. The canonical specification explicitly resolves that
    // ambiguity to UNEVALUATED; the later D5 fixture entry is its applicable expectation.
    const expectedEvaluations = new Map(expectation.cases.filter(row => row.record_key && row.expected_record_evaluation)
      .map(row => [row.record_key!, row.expected_record_evaluation!]));
    const evaluations = await sql`SELECT o.population_record_key,e.value,e.origin,e.rationale FROM run_observation o
      JOIN run_observation_evaluation e ON e.observation_id=o.observation_id WHERE o.run_id=${runId} ORDER BY o.population_record_key`;
    expect(evaluations).toHaveLength(expectedKeys.length);
    for (const row of evaluations) {
      expect(row.origin).toBe('RULE');
      expect(row.value).toBe(expectedEvaluations.get(String(row.population_record_key)));
    }
    for (const caseId of ['D4', 'D5', 'D2-b']) {
      const expectedCase = expectation.cases.find(row => row.case_id === caseId)!;
      const row = observations.find(row => row.population_record_key === expectedCase.record_key);
      expect(row).toBeDefined();
      expect(evaluations.find(row => row.population_record_key === expectedCase.record_key)?.value).toBe(expectedCase.expected_record_evaluation);
      if (caseId === 'D4') {
        expect(row).toMatchObject({ found: 'false', identity: null, coverage: 'UNINSPECTED' });
        expect(row?.attributes.find(attribute => attribute.name === 'observed_value')).toMatchObject({ originalValue: null, grounding: null });
      }
      if (caseId === 'D2-b') expect(row?.found).toBe('true');
    }
    expect(JSON.stringify(evaluations)).not.toContain('CR-0000');

    const declarations = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='execution.agent-page-declaration'`;
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.payload).toMatchObject({
      snapshotIdentifier: pageDataset.snapshot.snapshot_id,
      expectedParameterCount: declaredCount, pageParameterCount: pageDataset.observed_parameters.length,
      registeredObservations: expectedKeys.length, snapshotEvidenceId: items[0]?.evidence_id,
    });
    expect(declarations[0]?.payload.expectedParameterCountLocator).toMatch(/^\$\.nodes\[\d+\]\.value$/);
    expect(expectedKeys.length).not.toBe(declaredCount);

    const actions = await sql`SELECT action,method,destination,outcome FROM run_tool_action WHERE run_id=${runId}`;
    // Only navigation reaches the browser. P-4's model-selected reads consume frozen
    // snapshot cells inside registration; they must not invent extra network actions.
    expect(actions.filter(row => row.outcome === 'performed').map(row => row.action)).toContain('navigate');
    expect(actions.every(row => row.method === 'GET')).toBe(true);
    expect(actions.every(row => String(row.destination).startsWith(`${NORTHSTAR_BASE_URL}/prodconsole`))).toBe(true);
    const turns = await sql<{ status: string; snapshot_evidence_id: string; response: AgentModelResponse }[]>`SELECT status,snapshot_evidence_id,response FROM run_agent_turn WHERE run_id=${runId} ORDER BY sequence`;
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every(row => row.status === 'COMPLETED')).toBe(true);
    expect(workerMarkers.some(marker => marker.includes('"snapshotTimeToolPresent":true'))).toBe(true);

    const artifacts = await sql`SELECT evidence_id,object_key,kind,digest FROM run_evidence WHERE run_id=${runId} AND state='REGISTERED'`;
    expect(artifacts.some(row => row.kind === 'structural-snapshot')).toBe(true);
    expect(artifacts.some(row => row.kind === 'screenshot')).toBe(true);
    const structuralDocuments: unknown[] = [];
    const snapshots = new Map<string, StoredSnapshot>();
    for (const artifact of artifacts) {
      const bytes = storage.objects.get(String(artifact.object_key));
      expect(bytes).toBeDefined();
      expect(sha256HexOfBytes(bytes!)).toBe(artifact.digest);
      if (artifact.kind === 'structural-snapshot') {
        const parsed = readStructuralSnapshot({ evidenceId: String(artifact.evidence_id), substrate: 'web_tree', bytes: bytes! });
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.substrate === 'web_tree') {
          structuralDocuments.push(parsed.document);
          snapshots.set(String(artifact.evidence_id), { evidenceId: String(artifact.evidence_id), substrate: 'web_tree', bytes: bytes! });
        }
      }
    }
    // Prove the persisted model selected actual approved reads from this exact stored
    // capture. Rebuild the platform catalogue from the Run's frozen plan and capture
    // location, then independently resolve every persisted locator through the domain.
    const [frozenVersion] = await sql<{ compiled_plan: ExecutablePlan }[]>`SELECT v.compiled_plan FROM audit_run r
      JOIN procedure_version v ON v.version_id=r.version_id WHERE r.run_id=${runId} AND v.version_id=${versionId}`;
    expect(frozenVersion).toBeDefined();
    const plan = frozenVersion!.compiled_plan;
    const target = plan.inputs.targets.find(row => row.registrationId === targetId);
    expect(target).toBeDefined();
    const readTurns = turns.filter(turn => turn.response.actions.some(action => action.action === 'read-attribute' || action.action === 'read-metadata'));
    expect(readTurns).toHaveLength(1);
    const readTurn = readTurns[0]!;
    expect(readTurn.snapshot_evidence_id).toBe(items[0]?.evidence_id);
    expect(readTurn.snapshot_evidence_id).toBe(declarations[0]?.payload.snapshotEvidenceId);
    const snapshot = snapshots.get(readTurn.snapshot_evidence_id);
    expect(snapshot).toBeDefined();
    const [capture] = await sql`SELECT source_location FROM run_evidence_capture WHERE run_id=${runId} AND evidence_id=${readTurn.snapshot_evidence_id}`;
    expect(capture).toBeDefined();
    const planner = planProdConsoleTools({ plan, target: target!, snapshot: snapshot!, sourceLocation: String(capture!.source_location) });
    expect(planner).not.toBeNull();
    expect(readTurn.response.actions.map(action => action.toolId).sort()).toEqual(planner!.tools.map(tool => tool.toolId).sort());
    const parsedSnapshot = readStructuralSnapshot(snapshot!);
    const labels: string[] = [];
    for (const proposal of readTurn.response.actions) {
      const approved = planner!.tools.find(tool => tool.toolId === proposal.toolId);
      expect(approved).toBeDefined();
      expect(proposal).toEqual({ toolId: approved!.toolId, action: approved!.action,
        destination: approved!.destination, locator: approved!.locator, parameters: [] });
      const locator = parseSnapshotLocator(proposal.locator?.path);
      expect(locator).not.toBeNull();
      const cell = readSnapshotCell(parsedSnapshot, locator!);
      expect(cell).not.toBeNull();
      expect(target!.contract.attribute_label_patterns).toContain(cell!.label);
      labels.push(cell!.label);
      if (cell!.label === 'Snapshot taken at') {
        expect(proposal.action).toBe('read-metadata');
        expect(cell!.value).toBe(pageDataset.snapshot.taken_at);
      }
      if (cell!.label === 'Snapshot identifier') {
        expect(proposal.locator?.path).toBe(declarations[0]?.payload.snapshotIdentifierLocator);
        expect(cell!.value).toBe(pageDataset.snapshot.snapshot_id);
      }
      if (cell!.label === 'Expected parameter count') {
        expect(proposal.locator?.path).toBe(declarations[0]?.payload.expectedParameterCountLocator);
        expect(String(cell!.value)).toBe(String(declaredCount));
      }
    }
    expect(readTurn.response.actions.map(action => action.action)).toEqual(expect.arrayContaining(['read-attribute', 'read-metadata']));
    expect(labels.sort()).toEqual([
      ...pageDataset.observed_parameters.flatMap(() => ['Parameter', 'Value']),
      'Snapshot identifier', 'Expected parameter count', 'Snapshot taken at',
    ].sort());

    const hostileDescription = pageDataset.observed_parameters.find(row => row.description.includes('ATTENTION AGENT'))!.description;
    expect(structuralDocuments.some(document => JSON.stringify(document).includes(hostileDescription))).toBe(true);

    const outcome = expectation.run_expectation.terminal_outcome === 'Inconclusive' ? 'INCONCLUSIVE' : expectation.run_expectation.terminal_outcome;
    const [result] = await sql`SELECT outcome,outcome_row,gate_passed,sealed,version FROM run_result WHERE run_id=${runId}`;
    expect(result).toMatchObject({ outcome, outcome_row: 'gate-failed', gate_passed: false, sealed: true, version: 1 });
    expect(await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${runId}`).toMatchObject([{ state: 'SEALED', run_state: 'INCONCLUSIVE' }]);
    await page.reload();
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Safe next action', exact: true })).toBeVisible();
    await scan(page);
    await page.getByRole('link', { name: 'Evidence', exact: true }).click();
    for (const observation of observations) {
      await expect(page.locator(`#observation-${observation.observation_id}`).getByText(observation.population_record_key, { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('.ls-untrusted script')).toHaveCount(0);
    await scan(page);
  });
});
