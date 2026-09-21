import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  bindingDigest,
  bindingDigestEnvelope,
  registrationDigest,
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

import { startSyntheticS3 } from './s3-server';
import { startCanonicalLeaverSource } from './single-leaver-source';
import { canonicalLoanCoreCompliance } from './canonical-loancore-compliance';
import { activeRunVersion } from './active-run-version';
import { ACCOUNTS, assertThrowawayDatabase } from '../e2e/accounts';
import { NORTHSTAR_BASE_URL } from '../e2e/northstar';
import {
  LOANCORE_CREDENTIAL,
} from '../e2e/credentials';

// This journey starts the compiled worker itself. The named preload only intercepts
// the synthetic provider HTTP response; all population, authentication, browser actions,
// captures, Observations, evaluations, review commands and Result transitions are real.
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Workspace Preview Worker ${procedureId}`;
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


export let sql: Sql;
export let populationSource: Awaited<ReturnType<typeof startCanonicalLeaverSource>>;
export let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
export async function preparePreviewWorkerFixture() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the actual preview worker proof.');
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

}
export async function startPreviewRun(page: Page): Promise<string> {
  // Compile the development proxy before holding real credential I/O. This is a
  // missing-Run read, not an execution fixture or a preview latency measurement.
  const warm = await page.request.get('/api/runs/00000000-0000-0000-0000-000000000000/preview?image=0');
  expect(warm.status()).toBe(503);
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.locator('#initiate-run[data-client-ready=true]')).toBeVisible();
  await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').at(-1)!;
}


export async function closePreviewWorkerFixture() {
  await storage?.close();
  await populationSource?.close();
  if (!sql) return;
  try {
    await sql.begin(async transaction => {
    const runs = await transaction`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId} FOR UPDATE`;
    const runIds = runs.map((row) => String(row.run_id));
    if (runIds.length > 0) {
      await transaction`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
      await transaction`DELETE FROM notification WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_wait WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_result_review WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_result WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_evidence_integrity WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_evidence_package WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_evidence_capture WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_tool_action WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_agent_turn WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_agent_work WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_observation_evaluation WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_observation_check WHERE run_id = ANY(${runIds}::uuid[])`;
      // Review ledger/command rows cascade from their evaluation, and Exceptions
      // cascade from their Observation. Their immutable-parent guards reject direct
      // deletes while those parents still exist.
      await transaction`DELETE FROM run_observation WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_step_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_session_step WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_work_item WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_gate_check WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM run_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM population_row WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM population_snapshot WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM population_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM population_execution WHERE run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM audit_events WHERE aggregate_id = ANY(${runIds})`;
      await transaction`DELETE FROM audit_event_heads WHERE aggregate_id = ANY(${runIds})`;
      await transaction`DELETE FROM run_initiation_request WHERE run_id = ANY(${runIds}::uuid[]) OR refused_run_id = ANY(${runIds}::uuid[])`;
      await transaction`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
    }
    await transaction`DELETE FROM procedure_version WHERE version_id=${versionId}`;
    await transaction`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    });
  } finally { await sql.end({ timeout: 5 }); }
}
