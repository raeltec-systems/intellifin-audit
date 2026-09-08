import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  bindingDigest,
  bindingDigestEnvelope,
  registrationDigest,
  readStructuralSnapshot,
  snapshotFromRegistration,
  type FrozenPlanInputs,
  type InclusionRule,
  type PermittedReadAction,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { startSyntheticS3 } from '../fixtures/s3-server';
import { startCanonicalLeaverSource } from '../fixtures/single-leaver-source';
import { canonicalLoanCoreCompliance } from '../fixtures/canonical-loancore-compliance';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { NORTHSTAR_BASE_URL } from './northstar';
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
  LOANCORE_CREDENTIAL,
} from './credentials';

// This journey starts the compiled worker itself. The named preload only intercepts
// the synthetic provider HTTP response; all population, authentication, browser actions,
// captures, Observations, evaluations, review commands and Result transitions are real.
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Agent Evaluation Journey ${procedureId}`;
const EMPLOYEE_ID = 'E-000102';
const REVIEW_RATIONALE = 'The captured evidence supports replacing the proposal with an Exception.';

type TargetSystemCatalogueEntry = {
  readonly id: string;
  readonly display_name: string;
  readonly origin_path: string;
  readonly authentication_destination_path?: string;
  readonly permitted_actions: readonly PermittedReadAction[];
  readonly attribute_label_patterns: readonly string[];
  readonly secondary_key: string;
  readonly credential_ref?: string;
};

const systemsCatalogue = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../fixtures/northstar/datasets/systems.json', import.meta.url)),
  'utf8',
)) as { readonly target_systems: readonly TargetSystemCatalogueEntry[] };
const loancoreCatalogue = systemsCatalogue.target_systems.find((entry) => entry.id === 'loancore');
if (loancoreCatalogue === undefined || loancoreCatalogue.credential_ref === undefined ||
    loancoreCatalogue.authentication_destination_path === undefined) {
  throw new Error('Northstar catalogue has no complete LoanCore agent target contract.');
}
if (loancoreCatalogue.credential_ref !== LOANCORE_CREDENTIAL) {
  throw new Error('LoanCore credential fixture and target catalogue disagree.');
}

const LOANCORE_FIELDS = {
  registrationId: ids.next(),
  displayName: loancoreCatalogue.display_name,
  kind: 'web' as const,
  allowedOrigins: [`${NORTHSTAR_BASE_URL}${loancoreCatalogue.origin_path}`],
  applicationIdentity: '',
  credentialRef: LOANCORE_CREDENTIAL,
  permittedActions: loancoreCatalogue.permitted_actions,
  attributeLabelPatterns: loancoreCatalogue.attribute_label_patterns,
  secondaryKey: loancoreCatalogue.secondary_key,
  authenticationDestination: `${NORTHSTAR_BASE_URL}${loancoreCatalogue.authentication_destination_path}`,
};
const LOANCORE = {
  ...LOANCORE_FIELDS,
  digest: registrationDigest(LOANCORE_FIELDS),
};

const EVALUATION_INCLUSION_RULE: InclusionRule = {
  schemaVersion: 1,
  all: [
    ...initialDraftPopulation('P-1').inclusionRule.all,
    { kind: 'text', column: 'employee_id', operator: 'eq', value: EMPLOYEE_ID },
  ],
};

function inputs(): FrozenPlanInputs {
  const source = {
    kind: 'versioned-file' as const,
    location: populationSource.location,
    declaredSchema: populationSource.schema,
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  return {
    ...initialDraftPopulation('P-1'),
    inclusionRule: EVALUATION_INCLUSION_RULE,
    ...canonicalLoanCoreCompliance(),
    ...initialDraftEvidence('P-1'),
    templateId: 'P-1',
    controlName,
    sections: initialDraftSections('P-1'),
    scope: 'Only the explicitly selected synthetic terminated employee.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(),
      displayName: 'Declared canonical single-leaver source',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration(LOANCORE)],
    instructions: [{
      registrationId: LOANCORE.registrationId,
      text: 'Inspect only the bound synthetic employee and read the account status and roles.',
    }],
  };
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
let sql: Sql;
let populationSource: Awaited<ReturnType<typeof startCanonicalLeaverSource>>;
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
    pathToFileURL(resolve('tests/fixtures/agent-evaluation-worker-preload.mjs')).href,
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
      ANTHROPIC_API_KEY: 'synthetic-agent-abuse-interception',
      AGENT_ANTHROPIC_MODEL: 'synthetic-agent-evaluation-journey',
      AGENT_OPENAI_MODEL: '',
      MODEL_MAX_OUTPUT_TOKENS: '1024',
      OPENAI_API_KEY: '',
      SOLARI_API_KEY: '',
      CREDENTIAL_TOKENS,
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
      const prefix = 'Synthetic evaluation journey provider:';
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
        if (!forced) throw new Error('Agent evaluation fixture worker did not stop after SIGKILL.');
        throw new Error('Agent evaluation fixture worker exceeded its graceful shutdown deadline.');
      }
      if (workerFailure) throw new Error('Agent evaluation fixture worker exited unexpectedly.');
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

async function waitForPending(runId: string): Promise<void> {
  try {
    await expect.poll(async () => {
      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      const [result] = await sql`SELECT outcome,sealed FROM run_result WHERE run_id=${runId}`;
      return { runState: run?.state, outcome: result?.outcome, sealed: result?.sealed };
    }, { timeout: 120_000 }).toMatchObject({
      runState: 'COMPLETED',
      outcome: 'PENDING_CONFIRMATION',
      sealed: false,
    });
  } catch (failure) {
    // Failure diagnostics contain platform state/closed codes only, never captured
    // values, model response text, credentials, SQL errors or worker stderr.
    const gates = await sql`SELECT check_name,outcome,diagnostics FROM run_gate_check WHERE run_id=${runId} ORDER BY check_name`;
    const checks = await sql`SELECT check_name,outcome,diagnostic FROM run_observation_check WHERE run_id=${runId} ORDER BY check_name`;
    const work = await sql`SELECT state,attempts,cycles,observations,diagnostic FROM run_work_item WHERE run_id=${runId}`;
    const turns = await sql`SELECT sequence,status,diagnostic FROM run_agent_turn WHERE run_id=${runId} ORDER BY sequence`;
    const actions = await sql`SELECT action,outcome,status,diagnostic FROM run_tool_action WHERE run_id=${runId} ORDER BY started_at,tool_action_id`;
    const evaluations = await sql`SELECT condition_id,origin,value,confirmation FROM run_observation_evaluation WHERE run_id=${runId}`;
    console.error('Synthetic evaluation journey diagnostics:', JSON.stringify({ gates, checks, work, turns, actions, evaluations, markers: workerMarkers }));
    throw failure;
  }
}

type ReviewSnapshot = {
  readonly observations: readonly string[];
  readonly evaluations: readonly string[];
  readonly evidence: readonly string[];
};

async function reviewSnapshot(runId: string): Promise<ReviewSnapshot> {
  const observations = await sql`SELECT to_jsonb(o)::text AS value FROM run_observation o WHERE run_id=${runId} ORDER BY observation_id`;
  const evaluations = await sql`SELECT to_jsonb(e)::text AS value FROM run_observation_evaluation e WHERE run_id=${runId} ORDER BY observation_id,condition_id`;
  const evidence = await sql`SELECT to_jsonb(e)::text AS value FROM run_evidence e WHERE run_id=${runId} ORDER BY evidence_id`;
  return {
    observations: observations.map((row) => String(row.value)),
    evaluations: evaluations.map((row) => String(row.value)),
    evidence: evidence.map((row) => String(row.value)),
  };
}

async function assertActualExecution(runId: string, markerStart: number): Promise<void> {
  const [execution] = await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`;
  expect(execution?.status).toBe('SIGNED_IN');

  const items = await sql`SELECT state,observations,subject_key FROM run_work_item WHERE run_id=${runId}`;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ state: 'OBSERVED', observations: 1, subject_key: EMPLOYEE_ID });

  const observations = await sql`SELECT population_record_key,found,target_system,match_origin,coverage,attributes FROM run_observation WHERE run_id=${runId}`;
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    population_record_key: EMPLOYEE_ID,
    found: 'true',
    target_system: LOANCORE.registrationId,
    match_origin: 'platform',
    coverage: 'COVERED',
  });
  expect(observations[0]?.attributes).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'account_status', originalValue: 'Disabled', normalizedValue: 'Disabled' }),
    expect.objectContaining({ name: 'roles', originalValue: 'LOAN_VIEWER', normalizedValue: 'LOAN_VIEWER' }),
  ]));

  const evaluations = await sql`SELECT condition_id,origin,value,confirmation,confidence::text AS confidence,rationale,evidence_ids,agent_proposed_value,agent_proposed_confidence::text AS agent_proposed_confidence,agent_proposed_rationale FROM run_observation_evaluation WHERE run_id=${runId} ORDER BY condition_id`;
  const c2 = evaluations.filter((row) => row.condition_id === 'C2');
  expect(c2).toHaveLength(1);
  expect(c2[0]).toMatchObject({
    origin: 'AGENT_JUDGED',
    value: 'COMPLIANT',
    confirmation: 'pending',
    confidence: '0.950000',
    agent_proposed_value: 'COMPLIANT',
    agent_proposed_confidence: '0.950000',
  });
  expect(String(c2[0]?.rationale)).toContain('Synthetic provider proposal');

  const actions = await sql`SELECT action,method,destination,redirected,outcome,parameters FROM run_tool_action WHERE run_id=${runId} ORDER BY started_at,tool_action_id`;
  expect(actions.filter((row) => row.outcome === 'performed').map((row) => row.action)).toEqual(expect.arrayContaining([
    'navigate', 'search', 'open-record', 'read-attribute',
  ]));
  // The sign-in form's POST is followed to the authenticated home page. The immutable
  // action row records the method that reached the wire and the final sanitized location;
  // the frozen authentication destination is deliberately not re-invented as that final
  // location. The sign-in execution itself supplies the destination from the frozen
  // target contract before the browser submits the form.
  const signInAction = actions.find((row) => row.method === 'POST');
  expect(signInAction).toMatchObject({
    destination: `${NORTHSTAR_BASE_URL}/loancore`,
    outcome: 'performed',
    redirected: true,
  });
  expect(actions.filter((row) => row.method === 'POST')).toHaveLength(1);

  // The provider was intercepted, but the model still received and selected only
  // platform-approved tools. These markers are emitted by the named test fixture.
  const runMarkers = workerMarkers.slice(markerStart);
  expect(runMarkers).toContain('Synthetic evaluation journey provider:{"phase":"evaluation","conditionId":"C2","observationBound":true}');
  expect(runMarkers.some((marker) => marker.includes('"action":"navigate"'))).toBe(true);
  expect(runMarkers.some((marker) => marker.includes('"action":"search"'))).toBe(true);
  expect(runMarkers.some((marker) => marker.includes('"action":"open-record"'))).toBe(true);
  expect(runMarkers.some((marker) => marker.includes('"action":"read-attribute"'))).toBe(true);

  const artifacts = await sql`SELECT evidence_id::text AS evidence_id,object_key,kind FROM run_evidence WHERE run_id=${runId} AND state='REGISTERED' ORDER BY evidence_id`;
  const accountSnapshots = artifacts
    .filter((row) => row.kind === 'structural-snapshot')
    .map((row) => {
      const bytes = storage.objects.get(String(row.object_key));
      expect(bytes).toBeDefined();
      const parsed = readStructuralSnapshot({ evidenceId: String(row.evidence_id), substrate: 'web_tree', bytes: bytes! });
      if (!parsed.ok || parsed.substrate !== 'web_tree') return null;
      const nodes = parsed.document.nodes;
      const has = (label: string, value: string | readonly string[]) => nodes.some((node) => node.role === 'datum' && node.label === label && JSON.stringify(node.value) === JSON.stringify(value));
      return has('Employee ID', EMPLOYEE_ID) && has('Status', 'Disabled') && has('Roles', 'LOAN_VIEWER') ? parsed.document : null;
    })
    .filter((document): document is NonNullable<typeof document> => document !== null);
  expect(accountSnapshots.length).toBeGreaterThan(0);
}

async function inspectCapturedAccountStatus(page: Page, runId: string): Promise<void> {
  const [row] = await sql`SELECT attributes FROM run_observation WHERE run_id=${runId}`;
  const status = (row?.attributes as { name: string; grounding: { evidenceId: string; locator: string } }[])
    .find(attribute => attribute.name === 'account_status');
  expect(status).toBeDefined();
  const { evidenceId, locator } = status!.grounding;
  const path = `/runs/${runId}/evidence/${evidenceId}?locator=${encodeURIComponent(locator)}`;
  const browserRequests: string[] = [];
  const observe = (request: { url(): string }) => { browserRequests.push(request.url()); };
  page.on('request', observe);
  try {
    await page.goto(`/runs/${runId}/evidence`);
    await expect(page.getByRole('heading', { name: 'Match provenance', exact: true })).toBeVisible();
    const link = page.locator(`a[href="${path}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot', exact: true })).toBeVisible();
    const value = page.locator('.ls-untrusted').filter({ hasText: 'as read at the stored snapshot locator' }).locator('pre');
    await expect(value).toHaveText(JSON.stringify('Disabled'));
    await scan(page);
    expect(await sql`SELECT locator,status FROM evidence_read_grant WHERE run_id=${runId} AND evidence_id=${evidenceId}`)
      .toEqual([{ locator, status: 'issued' }]);
    // The browser follows only the protected application link. The actual worker signs
    // the registered object and the web server reads/checks it without exposing that URL.
    expect(browserRequests.some(url => url.startsWith(storage.env.EVIDENCE_S3_ENDPOINT))).toBe(false);
    expect(browserRequests.some(url => url.includes('X-Amz-'))).toBe(false);
  } finally { page.off('request', observe); }
}

async function assertPendingReview(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText('1 Agent-Judged evaluations await confirmation', { exact: true })).toBeVisible();
  await expect(page.getByText('Original Agent-Judged proposal', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic provider proposal: the captured account is disabled and carries only the frozen read-only role.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject evaluation', exact: true })).toBeVisible();
  await scan(page);
}

async function finishReview(page: Page, runId: string, action: 'confirm' | 'reject'): Promise<void> {
  if (action === 'confirm') {
    await page.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
  } else {
    await page.getByLabel('Replacement value for rejection', { exact: true }).selectOption('EXCEPTION');
    await page.getByRole('button', { name: 'Reject evaluation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Rationale', { exact: true }).fill(REVIEW_RATIONALE);
    await dialog.getByRole('button', { name: 'Reject evaluation', exact: true }).click();
  }
  await expect(page.getByText('Review submitted.', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const [row] = await sql`SELECT status,result_version,result_outcome,result_sealed FROM run_evaluation_review_command WHERE run_id=${runId} ORDER BY requested_at DESC LIMIT 1`;
    return row;
  }, { timeout: 120_000 }).toMatchObject({ status: 'SUCCEEDED', result_version: 2, result_sealed: true });
}

async function assertFinalReview(page: Page, runId: string, action: 'confirm' | 'reject'): Promise<void> {
  const expectedOutcome = action === 'confirm' ? 'PASS' : 'CONTROL_FAILURE';
  await expect.poll(async () => {
    const [row] = await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runId}`;
    return row;
  }, { timeout: 120_000 }).toMatchObject({ version: 2, sealed: true, outcome: expectedOutcome });

  const [decision] = await sql`SELECT action,effective_origin,effective_value,effective_confirmation,replacement_value,rejection_rationale,original_value,original_confirmation,original_confidence::text AS original_confidence,original_rationale,original_evidence_ids FROM run_evaluation_review WHERE run_id=${runId}`;
  expect(decision).toMatchObject(action === 'confirm'
    ? { action: 'confirm', effective_origin: 'AGENT_JUDGED', effective_value: 'COMPLIANT', effective_confirmation: 'confirmed', replacement_value: null, rejection_rationale: null, original_value: 'COMPLIANT', original_confirmation: 'pending', original_confidence: '0.950000' }
    : { action: 'reject', effective_origin: 'HUMAN', effective_value: 'EXCEPTION', effective_confirmation: null, replacement_value: 'EXCEPTION', rejection_rationale: REVIEW_RATIONALE, original_value: 'COMPLIANT', original_confirmation: 'pending', original_confidence: '0.950000' });
  expect(String(decision?.original_rationale)).toContain('Synthetic provider proposal');

  if (action === 'reject') {
    const [exception] = await sql`SELECT condition_ids,diagnostics,fingerprint,fingerprint_key_id,target_system,population_record_key FROM run_exception WHERE run_id=${runId}`;
    expect(exception).toMatchObject({ target_system: LOANCORE.registrationId, population_record_key: EMPLOYEE_ID, fingerprint_key_id: EXCEPTION_FINGERPRINT_KEY_ID });
    expect(exception?.condition_ids).toEqual(['C2']);
    expect(String(exception?.fingerprint)).toMatch(/^[0-9a-f]{64}$/);
  } else {
    await expect.poll(async () => Number((await sql`SELECT count(*)::int AS count FROM run_exception WHERE run_id=${runId}`)[0]?.count ?? 0), { timeout: 30_000 }).toBe(0);
  }

  await page.reload();
  await expect(page.getByText('Stored human review decision', { exact: true })).toBeVisible();
  await expect(page.getByText('The Result is sealed. Review history is read-only.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject evaluation', exact: true })).toHaveCount(0);
  await scan(page);
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the actual Agent Evaluation journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 5 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  // This declared one-row source keeps the canonical employee unchanged. The full
  // golden export deliberately contains unrelated invalid/duplicate rows and must
  // remain Inconclusive even when an inclusion filter excludes their employee IDs.
  populationSource = await startCanonicalLeaverSource(EMPLOYEE_ID);
  const version = activeRunVersion(procedureId, versionId, String(auditor.id), inputs());
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  storage = await startSyntheticS3();
  await startWorker();
});

test.afterAll(async () => {
  await stopWorker?.();
  stopWorker = undefined;
  await storage?.close();
  await populationSource?.close();
  if (!sql) return;
  try {
    const runs = await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`;
    const runIds = runs.map((row) => String(row.run_id));
    if (runIds.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
      await sql`DELETE FROM notification WHERE run_id = ANY(${runIds}::uuid[])`;
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
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe.serial('actual P-1 execution through human Agent-Judged review', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('executes the compiled worker, reaches pending, and confirms from Run Detail', async ({ page }) => {
    test.setTimeout(240_000);
    const markerStart = workerMarkers.length;
    const runId = await startRun(page);
    await waitForPending(runId);
    await assertActualExecution(runId, markerStart);
    const before = await reviewSnapshot(runId);
    await inspectCapturedAccountStatus(page, runId);
    await assertPendingReview(page, runId);
    await finishReview(page, runId, 'confirm');
    await assertFinalReview(page, runId, 'confirm');
    expect(await reviewSnapshot(runId)).toEqual(before);
  });

  test('executes a fresh worker run, reaches pending, and rejects with a worker-signed Exception', async ({ page }) => {
    test.setTimeout(240_000);
    const markerStart = workerMarkers.length;
    const runId = await startRun(page);
    await waitForPending(runId);
    await assertActualExecution(runId, markerStart);
    const before = await reviewSnapshot(runId);
    await assertPendingReview(page, runId);
    await finishReview(page, runId, 'reject');
    await assertFinalReview(page, runId, 'reject');
    expect(await reviewSnapshot(runId)).toEqual(before);
  });
});
