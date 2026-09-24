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
  sha256HexOfBytes,
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

// The only seeded product data is a synthetic active Procedure. A dedicated preload
// substitutes one authenticated Northstar search response with duplicate candidates
// and intercepts provider HTTP. The actual compiled worker creates every capture,
// question, checkpoint and Observation; the authenticated browser confirms the answer.
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Conversation Answer Worker ${procedureId}`;
const EMPLOYEE_ID = 'E-000102';

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

let sql: Sql;
let populationSource: Awaited<ReturnType<typeof startCanonicalLeaverSource>>;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
const workerMarkers: string[] = [];
let workerFailure: string | null = null;

async function startWorker(runId: string): Promise<void> {
  workerMarkers.length = 0;
  workerFailure = null;
  let stopping = false;
  let closed = false;
  let outputBuffer = '';
  const worker = spawn(process.execPath, [
    '--import',
    pathToFileURL(resolve('tests/fixtures/conversation-answer-worker-preload.mjs')).href,
    resolve('apps/worker/dist/main.js'),
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      ...storage.env,
      SERVICE_NAME: 'worker',
      CONVERSATION_ANSWER_RUN_ID: runId,
      CONVERSATION_ANSWER_TARGET_ORIGIN: NORTHSTAR_BASE_URL,
      CONVERSATION_ANSWER_FULL_NAME: populationSource.row.full_name!,
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
      if (line === 'Synthetic conversation answer target:duplicate-search-substituted') workerMarkers.push(line);
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
        if (!forced) throw new Error('Conversation answer fixture worker did not stop after SIGKILL.');
        throw new Error('Conversation answer fixture worker exceeded its graceful shutdown deadline.');
      }
      if (workerFailure) throw new Error('Conversation answer fixture worker exited unexpectedly.');
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
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the actual conversation answer worker journey.');
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
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  const [stopped] = await Promise.allSettled([stopWorker?.()]);
  stopWorker = undefined;
  await storage?.close();
  await populationSource?.close();
  if (!sql) return;
  try {
    await sql.begin(async tx => {
      const sql = tx;
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
        await sql`DELETE FROM run_wait WHERE run_id = ANY(${runIds}::uuid[])`;
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
    });
  } finally {
    await sql.end({ timeout: 5 });
    if (stopped.status === 'rejected') throw stopped.reason;
  }
});

test.describe('conversation answer consumed by the actual P-1 worker', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('uses only the explicitly confirmed snapshot-bound candidate', async ({ page }) => {
    test.setTimeout(240_000);
    const [versionBefore] = await sql`SELECT to_jsonb(v)::text AS value FROM procedure_version v WHERE version_id=${versionId}`;
    const runId = await startRun(page);
    const [planBefore] = await sql`SELECT version_id,version_number,period_from,period_to,kind FROM audit_run WHERE run_id=${runId}`;
    await startWorker(runId);
    await expect.poll(async () => {
      if (workerFailure) throw new Error(workerFailure);
      const [state] = await sql`SELECT r.state,a.status,a.wait_id,w.kind FROM audit_run r
        LEFT JOIN run_agent_work a USING(run_id) LEFT JOIN run_wait w ON w.wait_id=a.wait_id
        WHERE r.run_id=${runId}`;
      if (state && ['RUN_FAILED', 'INCONCLUSIVE', 'CANCELED', 'COMPLETED'].includes(String(state.state))) {
        const actions = await sql`SELECT action,outcome,diagnostic FROM run_tool_action WHERE run_id=${runId} ORDER BY started_at,tool_action_id`;
        const turns = await sql`SELECT status,diagnostic FROM run_agent_turn WHERE run_id=${runId} ORDER BY sequence`;
        // Fixed marker and platform diagnostic vocabulary only; never print HTTP
        // bodies, credentials, provider prompts or arbitrary worker stderr.
        const targetSubstituted = workerMarkers.includes('Synthetic conversation answer target:duplicate-search-substituted');
        throw new Error(`Worker stopped before its candidate question: ${String(state.state)} ${JSON.stringify({ targetSubstituted, actions, turns })}`);
      }
      return { state: state?.state, status: state?.status, kind: state?.kind };
    }, { timeout: 120_000 }).toEqual({ state: 'AWAITING_AUDITOR', status: 'WAITING', kind: 'choose-candidate' });

    const [question] = await sql`SELECT w.wait_id,w.options,w.closed_at,a.pending_wait,a.work_item_id,
      i.evidence_id,i.step_id,i.subject_key FROM run_agent_work a JOIN run_wait w ON w.wait_id=a.wait_id
      JOIN run_work_item i ON i.work_item_id=a.work_item_id AND i.run_id=a.run_id WHERE a.run_id=${runId}`;
    if (!question) throw new Error('Worker candidate checkpoint missing.');
    const options = question.options as { id: string; label: string }[];
    expect(question.closed_at).toBeNull();
    expect(question.subject_key).toBe(EMPLOYEE_ID);
    expect(question.pending_wait).toMatchObject({ kind: 'choose-candidate', options });
    expect(options).toHaveLength(3);
    const [evidence] = await sql`SELECT evidence_id,object_key,digest,state,kind,registration_id
      FROM run_evidence WHERE run_id=${runId} AND evidence_id=${question.evidence_id}`;
    if (!evidence) throw new Error('Worker question evidence missing.');
    expect(evidence).toMatchObject({ state: 'REGISTERED', kind: 'structural-snapshot', registration_id: LOANCORE.registrationId });
    const bytes = storage.objects.get(String(evidence.object_key));
    if (!bytes) throw new Error('Worker snapshot bytes missing from synthetic evidence store.');
    expect(sha256HexOfBytes(bytes)).toBe(evidence.digest);
    const parsed = readStructuralSnapshot({ evidenceId: String(evidence.evidence_id), substrate: 'web_tree', bytes });
    if (!parsed.ok || parsed.substrate !== 'web_tree') throw new Error('Worker snapshot is not a readable captured web tree.');
    const nodes = parsed.document.nodes;
    const selectedGroup = nodes.find(node => node.label === 'Username' && node.value === 'answer-selected')?.group;
    const unselectedGroup = nodes.find(node => node.label === 'Username' && node.value === 'answer-unselected')?.group;
    expect(selectedGroup).toBeDefined();
    expect(unselectedGroup).toBeDefined();
    expect(selectedGroup).not.toBe(unselectedGroup);
    const identityIndex = nodes.findIndex(node => node.group === selectedGroup && node.label === 'Employee ID');
    const unselectedIndex = nodes.findIndex(node => node.group === unselectedGroup && node.label === 'Employee ID');
    const selectedOption = options.find(option => option.id === `candidate-${identityIndex}`);
    if (!selectedOption) throw new Error('No worker option bound to the selected snapshot group.');
    expect(options[0]?.id).toBe(`candidate-${unselectedIndex}`);
    expect(options[1]).toEqual(selectedOption); // Deliberately prove selection of the second candidate.
    const [raised] = await sql`SELECT event_id,payload FROM audit_events WHERE aggregate_id=${runId}
      AND event_type='execution.escalation-raised' AND payload->>'waitId'=${String(question.wait_id)}`;
    expect(raised?.payload).toMatchObject({ waitId: question.wait_id, kind: 'choose-candidate', stepId: question.step_id,
      supportingEvidenceIds: expect.arrayContaining([evidence.evidence_id]) });
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${runId}`).toHaveLength(0);
    expect(workerMarkers).toContain('Synthetic conversation answer target:duplicate-search-substituted');

    await page.goto(`/runs/${runId}/workspace`);
    const composer = page.getByLabel('Message the Run', { exact: true });
    await expect(composer).toBeEditable();
    await expect(page.locator('.run-conversation__composer-form')).toContainText('Current question:');
    await composer.fill(selectedOption.id);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('button', { name: 'Review answer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm this answer?', exact: true });
    await expect(dialog).toContainText(selectedOption.label);
    await expect(dialog).toContainText('Confirm before');
    const [command] = await sql`SELECT command_id,actor_id,answer_anchor,answer_option_id,expected_run_revision,plan_digest
      FROM run_interaction_command WHERE run_id=${runId} AND kind='answer'`;
    if (!command) throw new Error('Conversation answer proposal missing.');
    expect(command.answer_option_id).toBe(selectedOption.id);
    expect(command.answer_anchor).toMatchObject({ runId, waitId: question.wait_id, kind: 'choose-candidate', raisedEventId: raised!.event_id });
    // A retained proposal alone cannot close the question or create an Observation.
    expect((await sql`SELECT closed_at FROM run_wait WHERE wait_id=${question.wait_id}`)[0]?.closed_at).toBeNull();
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${runId}`).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Confirm answer', exact: true }).click();

    await expect.poll(async () => {
      if (workerFailure) throw new Error(workerFailure);
      const [row] = await sql`SELECT i.state,i.observations,a.status FROM run_work_item i JOIN run_agent_work a USING(run_id)
        WHERE i.run_id=${runId} AND i.work_item_id=${question.work_item_id}`;
      return { state: row?.state, observations: row?.observations, status: row?.status };
    }, { timeout: 120_000 }).toEqual({ state: 'OBSERVED', observations: 1, status: 'COMPLETE' });

    const events = await sql`SELECT event_id,actor_id,source,outcome,payload FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='execution.escalation-answered'`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: command.actor_id, source: 'web', outcome: 'success', payload: {
      commandId: command.command_id, waitId: question.wait_id, answerOptionId: selectedOption.id,
      questionAnchor: command.answer_anchor, expectedRunRevision: command.expected_run_revision,
      planDigest: command.plan_digest, closureKind: 'answer', priorState: 'AWAITING_AUDITOR', state: 'RUNNING',
    } });
    const [closed] = await sql`SELECT actor,answer_option_id,closure_kind,
      to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') closed_at
      FROM run_wait WHERE wait_id=${question.wait_id}`;
    expect(closed).toEqual({ actor: command.actor_id, answer_option_id: selectedOption.id, closure_kind: 'answer', closed_at: events[0]!.payload.occurredAt });
    const receipts = await sql`SELECT state,reason_code,source_event_id FROM run_interaction_transition
      WHERE command_id=${command.command_id} ORDER BY sequence`;
    expect(receipts.map(row => row.state)).toEqual(['received', 'interpreted', 'applied']);
    expect(receipts.at(-1)).toEqual({ state: 'applied', reason_code: 'question-answered', source_event_id: events[0]!.event_id });

    const observations = await sql`SELECT work_item_id,population_record_key,target_system,found,match_origin,identity,attributes,evidence_ids
      FROM run_observation WHERE run_id=${runId}`;
    expect(observations).toHaveLength(1);
    const observation = observations[0]!;
    expect(observation).toMatchObject({ work_item_id: question.work_item_id, population_record_key: EMPLOYEE_ID,
      target_system: LOANCORE.registrationId, found: 'true', match_origin: 'human-matched',
      evidence_ids: expect.arrayContaining([evidence.evidence_id]), identity: {
        originalValue: EMPLOYEE_ID, normalizedValue: EMPLOYEE_ID,
        grounding: { evidenceId: evidence.evidence_id, locator: `$.nodes[${identityIndex}].value` },
      } });
    const attributes = observation.attributes as { name: string; originalValue: unknown; grounding: { evidenceId: string; locator: string } | null }[];
    for (const [name, label, expected] of [['account_status', 'Status', 'Disabled'], ['username', 'Username', 'answer-selected'], ['roles', 'Roles', 'LOAN_VIEWER']]) {
      const index = nodes.findIndex(node => node.group === selectedGroup && node.label === label);
      expect(attributes.find(attribute => attribute.name === name)).toMatchObject({ originalValue: expected,
        grounding: { evidenceId: evidence.evidence_id, locator: `$.nodes[${index}].value` } });
    }
    // Every grounded value must refer to the chosen group of the exact raised snapshot.
    const grounded = [observation.identity, ...attributes] as { grounding: { evidenceId: string; locator: string } | null }[];
    for (const attribute of grounded) {
      if (!attribute.grounding) continue;
      expect(attribute.grounding.evidenceId).toBe(evidence.evidence_id);
      const match = /^\$\.nodes\[(\d+)\]\.value$/u.exec(attribute.grounding.locator);
      expect(match).not.toBeNull();
      expect(nodes[Number(match![1])]?.group).toBe(selectedGroup);
      expect(nodes[Number(match![1])]?.group).not.toBe(unselectedGroup);
    }
    expect(await sql`SELECT version_id,version_number,period_from,period_to,kind FROM audit_run WHERE run_id=${runId}`).toEqual([planBefore]);
    expect((await sql`SELECT to_jsonb(v)::text AS value FROM procedure_version v WHERE version_id=${versionId}`)[0]).toEqual(versionBefore);
    expect((await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`)[0]?.status).toBe('SIGNED_IN');
    // No role is changed by this fixture; the shared authenticated identity is preserved.
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Answer request: applied.');
  });
});
