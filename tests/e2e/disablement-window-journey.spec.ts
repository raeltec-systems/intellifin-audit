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
  MISSING_OBSERVATION_FIELD,
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

// The 24-hour disablement window (owner decision 2, 2026-09-08) through the ACTUAL
// compiled worker: the termination instant is acquired from the declared population
// source over HTTP with its signed cover sheet, the disablement instant is captured from
// LoanCore's own account page by its labelled field, and compiler 1 compares the two
// with the frozen inclusive boundary. The named preload only intercepts the synthetic
// provider HTTP response; population, authentication, browser actions, captures,
// Observations, evaluations, review commands and Result transitions are real.
//
// Two cases, two frozen versions. The first binds the source that declares the
// termination INSTANT and proves exactly 24 hours is Compliant; the second binds the
// date-only source and proves the window cannot be substantiated from it, saying which
// value is missing rather than guessing one.
const ids = new CryptoUuidV7Generator();
const EMPLOYEE_ID = 'E-000105';
/** LoanCore shows the instant in its source offset; the platform normalizes it to UTC. */
const DISABLED_AT_SOURCE = '2026-08-08T00:00:00+02:00';
const DISABLED_AT_UTC = '2026-08-07T22:00:00.000Z';
/** PeopleHub's instant for the same employee, joined into the declared source by id. */
const TERMINATED_AT_SOURCE = '2026-08-07T00:00:00+02:00';

type WindowCase = {
  readonly key: 'instant' | 'date-only';
  readonly procedureId: string;
  readonly versionId: string;
  readonly controlName: string;
  readonly terminationTime: boolean;
};
function windowCase(key: WindowCase['key'], terminationTime: boolean): WindowCase {
  const procedureId = ids.next();
  return { key, procedureId, versionId: ids.next(), controlName: `E2E Disablement Window ${key} ${procedureId}`, terminationTime };
}
const INSTANT = windowCase('instant', true);
const DATE_ONLY = windowCase('date-only', false);
const CASES: readonly WindowCase[] = [INSTANT, DATE_ONLY];

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
// The variant attribute is registered on the system, in the catalogue, as a label pattern.
// A label the registration does not permit is never captured, so the journey depends on
// the seed catalogue naming it rather than on the test inventing a broader contract.
if (!loancoreCatalogue.attribute_label_patterns.includes('Disabled time')) {
  throw new Error('The LoanCore catalogue does not register the Disabled time label.');
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

const WINDOW_INCLUSION_RULE: InclusionRule = {
  schemaVersion: 1,
  all: [
    ...initialDraftPopulation('P-1').inclusionRule.all,
    { kind: 'text', column: 'employee_id', operator: 'eq', value: EMPLOYEE_ID },
  ],
};

/** The version asks for the variant attribute explicitly; a default P-1 never captures it. */
const DISABLED_TIME_REQUIREMENT = {
  attributeName: 'disabled_time',
  modelRead: false,
  groundedBy: ['structural-snapshot' as const],
  screenshot: false,
  recordingSegment: false,
  platformCaptured: false,
};

type LeaverSource = Awaited<ReturnType<typeof startCanonicalLeaverSource>>;

function inputs(kase: WindowCase, source: LeaverSource): FrozenPlanInputs {
  const binding = {
    kind: 'versioned-file' as const,
    location: source.location,
    declaredSchema: source.schema,
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  const evidence = initialDraftEvidence('P-1');
  return {
    ...initialDraftPopulation('P-1'),
    inclusionRule: WINDOW_INCLUSION_RULE,
    ...canonicalLoanCoreCompliance({ disablementWindow: true }),
    ...evidence,
    evidenceRequirements: [...evidence.evidenceRequirements, DISABLED_TIME_REQUIREMENT],
    templateId: 'P-1',
    controlName: kase.controlName,
    sections: initialDraftSections('P-1'),
    scope: 'Only the explicitly selected synthetic terminated employee, under the 24-hour disablement window.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: ids.next(),
      displayName: kase.terminationTime
        ? 'Declared canonical single-leaver source with the termination instant'
        : 'Declared canonical single-leaver source, date only',
      digest: bindingDigest(binding),
      contract: bindingDigestEnvelope(binding),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration(LOANCORE)],
    instructions: [{
      registrationId: LOANCORE.registrationId,
      text: 'Inspect only the bound synthetic employee and read the account status, the roles and the labelled Disabled time.',
    }],
  };
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
let sql: Sql;
const sources = new Map<WindowCase['key'], LeaverSource>();
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
      AGENT_ANTHROPIC_MODEL: 'synthetic-disablement-window-journey',
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
        if (!forced) throw new Error('Disablement window fixture worker did not stop after SIGKILL.');
        throw new Error('Disablement window fixture worker exceeded its graceful shutdown deadline.');
      }
      if (workerFailure) throw new Error('Disablement window fixture worker exited unexpectedly.');
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

async function startRun(page: Page, kase: WindowCase): Promise<string> {
  await page.goto(`/procedures/${kase.procedureId}`);
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
    const population = await sql`SELECT status,attempts,diagnostic FROM population_execution WHERE run_id=${runId}`;
    const gates = await sql`SELECT check_name,outcome,diagnostics FROM run_gate_check WHERE run_id=${runId} ORDER BY check_name`;
    const checks = await sql`SELECT check_name,outcome,diagnostic FROM run_observation_check WHERE run_id=${runId} ORDER BY check_name`;
    const work = await sql`SELECT state,attempts,cycles,observations,diagnostic FROM run_work_item WHERE run_id=${runId}`;
    const turns = await sql`SELECT sequence,status,diagnostic FROM run_agent_turn WHERE run_id=${runId} ORDER BY sequence`;
    const actions = await sql`SELECT action,outcome,status,diagnostic FROM run_tool_action WHERE run_id=${runId} ORDER BY started_at,tool_action_id`;
    const evaluations = await sql`SELECT condition_id,origin,value,confirmation,diagnostic FROM run_observation_evaluation WHERE run_id=${runId}`;
    console.error('Disablement window journey diagnostics:', JSON.stringify({ population, gates, checks, work, turns, actions, evaluations, markers: workerMarkers }));
    throw failure;
  }
}

type StoredAttribute = {
  readonly name: string;
  readonly originalValue: unknown;
  readonly normalizedValue: unknown;
  readonly grounding: { readonly evidenceId: string; readonly locator: string; readonly label: string } | null;
};

type EvaluationRows = readonly (readonly [string, string, string, string | null])[];

async function evaluationRows(runId: string): Promise<EvaluationRows> {
  const rows = await sql`SELECT condition_id,origin,value,confirmation FROM run_observation_evaluation WHERE run_id=${runId} ORDER BY condition_id`;
  return rows.map((row) => [String(row.condition_id), String(row.origin), String(row.value), row.confirmation === null ? null : String(row.confirmation)] as const);
}

/** Both instants reached the Run through approved interfaces, and each is attributable. */
async function assertBothInstantsAcquired(runId: string, kase: WindowCase): Promise<StoredAttribute> {
  // The termination side: the declared source served the population and its signed
  // cover sheet to the worker, and the included row carries the instant only when the
  // source declared it. Nothing here reads PeopleHub at Run time.
  const source = sources.get(kase.key)!;
  expect(source.requests).toEqual(expect.arrayContaining(['GET /single-leaver.csv', 'GET /single-leaver.cover-sheet.json']));
  const [row] = await sql`SELECT values FROM population_row WHERE run_id=${runId} AND values->>'employee_id'=${EMPLOYEE_ID}`;
  const values = row?.values as Record<string, unknown> | undefined;
  expect(values).toBeDefined();
  expect(values?.['termination_effective_date']).toBe('2026-08-07');
  if (kase.terminationTime) {
    expect(values?.['termination_effective_time']).toBe(TERMINATED_AT_SOURCE);
  } else {
    expect(Object.hasOwn(values ?? {}, 'termination_effective_time')).toBe(false);
  }

  // The disablement side: captured from the account page by its registered label, kept
  // in its source spelling, normalized to UTC, and grounded at a locator in a REGISTERED
  // Structural Snapshot whose bytes hold that very cell, in the same record group as the
  // employee identity. A wrong employee's page would never reach this point (see the
  // application-level correlation test); this proves the grounding on real bytes.
  const observations = await sql`SELECT population_record_key,found,target_system,match_origin,coverage,attributes FROM run_observation WHERE run_id=${runId}`;
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    population_record_key: EMPLOYEE_ID,
    found: 'true',
    target_system: LOANCORE.registrationId,
    match_origin: 'platform',
    coverage: 'COVERED',
  });
  const attributes = observations[0]?.attributes as readonly StoredAttribute[];
  expect(attributes).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'account_status', originalValue: 'Disabled', normalizedValue: 'Disabled' }),
    expect.objectContaining({ name: 'roles', originalValue: 'COLLECTIONS_AGENT', normalizedValue: 'COLLECTIONS_AGENT' }),
    expect.objectContaining({
      name: 'disabled_time',
      originalValue: DISABLED_AT_SOURCE,
      normalizedValue: DISABLED_AT_UTC,
      grounding: expect.objectContaining({
        label: 'Disabled time',
        locator: expect.stringMatching(/^\$\.nodes\[(?:0|[1-9][0-9]*)\]\.value$/u),
      }),
    }),
  ]));
  const disabled = attributes.find((attribute) => attribute.name === 'disabled_time');
  if (disabled?.grounding == null) throw new Error('The disablement instant is not grounded.');
  const [artifact] = await sql`SELECT object_key,kind,state FROM run_evidence WHERE run_id=${runId} AND evidence_id=${disabled.grounding.evidenceId}`;
  expect(artifact).toMatchObject({ kind: 'structural-snapshot', state: 'REGISTERED' });
  const bytes = storage.objects.get(String(artifact?.object_key));
  expect(bytes).toBeDefined();
  const parsed = readStructuralSnapshot({ evidenceId: disabled.grounding.evidenceId, substrate: 'web_tree', bytes: bytes! });
  if (!parsed.ok || parsed.substrate !== 'web_tree') throw new Error('The grounding snapshot is not a readable web tree.');
  const index = Number(/^\$\.nodes\[([0-9]+)\]\.value$/u.exec(disabled.grounding.locator)?.[1]);
  const cell = parsed.document.nodes[index];
  expect(cell).toMatchObject({ role: 'datum', label: 'Disabled time', value: DISABLED_AT_SOURCE });
  const identity = parsed.document.nodes.find((node) => node.role === 'datum' && node.label === 'Employee ID' && node.value === EMPLOYEE_ID);
  expect(identity).toBeDefined();
  expect(identity?.group).toBe(cell?.group);
  const [check] = await sql`SELECT outcome,diagnostic FROM run_observation_check WHERE run_id=${runId} AND check_name='required-evidence'`;
  expect(check).toMatchObject({ outcome: 'PASS', diagnostic: null });
  return disabled;
}

async function assertActualExecution(runId: string, markerStart: number, kase: WindowCase): Promise<void> {
  const [execution] = await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`;
  expect(execution?.status).toBe('SIGNED_IN');

  const items = await sql`SELECT state,observations,subject_key FROM run_work_item WHERE run_id=${runId}`;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ state: 'OBSERVED', observations: 1, subject_key: EMPLOYEE_ID });

  // C1 and C3 are the platform's own arithmetic (origin RULE, nothing to confirm); C2
  // stays Agent-Judged under the frozen policy and pends human confirmation. Exactly 24
  // hours under the inclusive boundary is Compliant; the date-only source cannot
  // substantiate the window and the row says which value is missing.
  expect(await evaluationRows(runId)).toEqual([
    ['C1', 'RULE', 'COMPLIANT', null],
    ['C2', 'AGENT_JUDGED', 'COMPLIANT', 'pending'],
    ['C3', 'RULE', kase.terminationTime ? 'COMPLIANT' : 'UNEVALUATED', null],
  ]);
  const [c3] = await sql`SELECT diagnostic,rationale FROM run_observation_evaluation WHERE run_id=${runId} AND condition_id='C3'`;
  expect(c3?.rationale).toBeNull();
  if (!kase.terminationTime) expect(c3?.diagnostic).toBe(`${MISSING_OBSERVATION_FIELD}termination_time`);

  const actions = await sql`SELECT action,method,destination,redirected,outcome FROM run_tool_action WHERE run_id=${runId} ORDER BY started_at,tool_action_id`;
  expect(actions.filter((row) => row.outcome === 'performed').map((row) => row.action)).toEqual(expect.arrayContaining([
    'navigate', 'search', 'open-record', 'read-attribute',
  ]));
  expect(actions.filter((row) => row.outcome === 'denied')).toHaveLength(0);
  const signInAction = actions.find((row) => row.method === 'POST');
  expect(signInAction).toMatchObject({
    destination: `${NORTHSTAR_BASE_URL}/loancore`,
    outcome: 'performed',
    redirected: true,
  });
  expect(actions.filter((row) => row.method === 'POST')).toHaveLength(1);

  // The provider was intercepted, but the model still received and selected only
  // platform-approved tools, and was asked about exactly one frozen condition.
  const runMarkers = workerMarkers.slice(markerStart);
  expect(runMarkers).toContain('Synthetic evaluation journey provider:{"phase":"evaluation","conditionId":"C2","observationBound":true}');
  expect(runMarkers.filter((marker) => marker.includes('"phase":"evaluation"'))).toHaveLength(1);
  for (const action of ['navigate', 'search', 'open-record', 'read-attribute']) {
    expect(runMarkers.some((marker) => marker.includes(`"action":"${action}"`))).toBe(true);
  }
}

async function inspectDisabledTime(page: Page, runId: string, disabled: StoredAttribute): Promise<void> {
  if (disabled.grounding === null) throw new Error('The disablement instant is not grounded.');
  const { evidenceId, locator } = disabled.grounding;
  const path = `/runs/${runId}/evidence/${evidenceId}?locator=${encodeURIComponent(locator)}`;
  const browserRequests: string[] = [];
  const observe = (request: { url(): string }) => { browserRequests.push(request.url()); };
  page.on('request', observe);
  try {
    await page.goto(`/runs/${runId}/evidence`);
    await expect(page.getByRole('heading', { name: 'Match provenance', exact: true })).toBeVisible();
    // The Evidence surface names the captured field by the label the page carried, as
    // untrusted text, beside the protected inspector link for its locator.
    await expect(page.locator('.ls-untrusted').filter({ hasText: 'disabled_time, field label' }).locator('pre')).toHaveText('Disabled time');
    const link = page.locator(`a[href="${path}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot', exact: true })).toBeVisible();
    const value = page.locator('.ls-untrusted').filter({ hasText: 'as read at the stored snapshot locator' }).locator('pre');
    await expect(value).toHaveText(JSON.stringify(DISABLED_AT_SOURCE));
    await scan(page);
    expect(await sql`SELECT locator,status FROM evidence_read_grant WHERE run_id=${runId} AND evidence_id=${evidenceId}`)
      .toEqual([{ locator, status: 'issued' }]);
    // The browser follows only the protected application link. The actual worker signs
    // the registered object and the web server reads/checks it without exposing that URL.
    expect(browserRequests.some((url) => url.startsWith(storage.env.EVIDENCE_S3_ENDPOINT))).toBe(false);
    expect(browserRequests.some((url) => url.includes('X-Amz-'))).toBe(false);
  } finally { page.off('request', observe); }
}

async function confirmFromRunDetail(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText('1 Agent-Judged evaluations await confirmation', { exact: true })).toBeVisible();
  await expect(page.getByText('Original Agent-Judged proposal', { exact: true })).toBeVisible();
  await scan(page);
  await page.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
  await expect(page.getByText('Review submitted.', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const [row] = await sql`SELECT status,result_version,result_sealed FROM run_evaluation_review_command WHERE run_id=${runId} ORDER BY requested_at DESC LIMIT 1`;
    return row;
  }, { timeout: 120_000 }).toMatchObject({ status: 'SUCCEEDED', result_version: 2, result_sealed: true });
}

async function assertSealed(page: Page, runId: string, expected: { readonly outcome: 'PASS' | 'INCONCLUSIVE'; readonly runState: 'COMPLETED' | 'INCONCLUSIVE' }): Promise<void> {
  await expect.poll(async () => {
    const [result] = await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runId}`;
    const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    return { ...result, runState: run?.state };
  }, { timeout: 120_000 }).toMatchObject({ version: 2, sealed: true, outcome: expected.outcome, runState: expected.runState });
  const [decision] = await sql`SELECT action,effective_origin,effective_value,effective_confirmation,original_value,original_confirmation FROM run_evaluation_review WHERE run_id=${runId}`;
  expect(decision).toMatchObject({
    action: 'confirm', effective_origin: 'AGENT_JUDGED', effective_value: 'COMPLIANT', effective_confirmation: 'confirmed',
    original_value: 'COMPLIANT', original_confirmation: 'pending',
  });
  expect(Number((await sql`SELECT count(*)::int AS count FROM run_exception WHERE run_id=${runId}`)[0]?.count ?? 0)).toBe(0);
  await page.reload();
  await expect(page.getByText('Stored human review decision', { exact: true })).toBeVisible();
  await expect(page.getByText('The Result is sealed. Review history is read-only.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject evaluation', exact: true })).toHaveCount(0);
  await scan(page);
}

async function deleteRuns(procedureId: string): Promise<void> {
  const runs = await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`;
  const runIds = runs.map((row) => String(row.run_id));
  if (runIds.length === 0) return;
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
  // Review ledger/command rows cascade from their evaluation, and Exceptions cascade
  // from their Observation. Their immutable-parent guards reject direct deletes while
  // those parents still exist.
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

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the actual disablement window journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 5 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  // Two independently declared one-row sources keep the canonical employee unchanged.
  // The full golden export deliberately contains unrelated invalid/duplicate rows and
  // must remain Inconclusive even when an inclusion filter excludes their employee IDs.
  for (const kase of CASES) {
    const source = await startCanonicalLeaverSource(EMPLOYEE_ID, { terminationTime: kase.terminationTime });
    sources.set(kase.key, source);
    const version = activeRunVersion(kase.procedureId, kase.versionId, String(auditor.id), inputs(kase, source));
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
  }
  storage = await startSyntheticS3();
  await startWorker();
});

test.afterAll(async () => {
  await stopWorker?.();
  stopWorker = undefined;
  await storage?.close();
  for (const source of sources.values()) await source.close();
  if (!sql) return;
  try {
    for (const kase of CASES) {
      await deleteRuns(kase.procedureId);
      await sql`DELETE FROM procedure_version WHERE version_id=${kase.versionId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${kase.procedureId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe.serial('the 24-hour disablement window through the compiled worker', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('acquires both instants, grounds the disablement time by its label, and seals exactly 24 hours as a Pass', async ({ page }) => {
    test.setTimeout(240_000);
    const markerStart = workerMarkers.length;
    const runId = await startRun(page, INSTANT);
    await waitForPending(runId);
    await assertActualExecution(runId, markerStart, INSTANT);
    const disabled = await assertBothInstantsAcquired(runId, INSTANT);
    const before = await evaluationRows(runId);
    await inspectDisabledTime(page, runId, disabled);
    await confirmFromRunDetail(page, runId);
    await assertSealed(page, runId, { outcome: 'PASS', runState: 'COMPLETED' });
    // Confirming C2 changes nothing the platform decided: the window row is untouched.
    expect(await evaluationRows(runId)).toEqual(before);
  });

  test('cannot substantiate the window from a date-only source, names the missing value, and seals Inconclusive', async ({ page }) => {
    test.setTimeout(240_000);
    const markerStart = workerMarkers.length;
    const runId = await startRun(page, DATE_ONLY);
    await waitForPending(runId);
    await assertActualExecution(runId, markerStart, DATE_ONLY);
    await assertBothInstantsAcquired(runId, DATE_ONLY);
    await confirmFromRunDetail(page, runId);
    // The one Agent-Judged condition is confirmed, yet the Run cannot conclude: an
    // Unevaluated window under §E.1 seals Inconclusive rather than borrowing a Pass.
    await assertSealed(page, runId, { outcome: 'INCONCLUSIVE', runState: 'INCONCLUSIVE' });
  });
});
