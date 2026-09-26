import { captureStoryState } from './story-visual-capture';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  answerEscalation,
  NO_CORROBORATION,
  NO_EVALUATION,
  raiseEscalation,
  registerObservations,
  runRunLevelGate,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  observationDigest,
  observationIdFor,
  POPULATION_CHECK_NAMES,
  registrationDigest,
  snapshotFromRegistration,
  type FrozenPlanInputs,
  type ObservationRecord,
  type PermittedReadAction,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  withRunExecutionContext,
  type Sql,
} from '@intellifin/infrastructure';

import { MATCH_DECISION_WORDS, choseCandidateWords } from '../../apps/web/src/runs/match-words';
import { activeRunVersion } from '../fixtures/active-run-version';
import { canonicalLoanCoreCompliance } from '../fixtures/canonical-loancore-compliance';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { LOANCORE_CREDENTIAL } from './credentials';
import { NORTHSTAR_BASE_URL } from './northstar';

/**
 * Story 10.6 (legacy 4.7): a record a PERSON matched is flagged, with the decision that
 * matched it, on the Result, the record review queue and inspector and the Exceptions list;
 * a platform match shows no flag.
 *
 * The Run is a P-1 Run, because only P-1 matches a record by a person's choice: a name
 * search that finds two accounts raises a choose-candidate question, and the P-4 page path
 * refuses such a decision. The target is LoanCore from the Northstar catalogue, each
 * population record has its own Work Item as the agent path writes it, and the leavers
 * binding masks `full_name`, as the synthetic export declares.
 *
 * The decision is made by the REAL commands — `raiseEscalation` and `answerEscalation` —
 * and the human-matched Observation is registered by the REAL `registerObservations` in the
 * Run's own transaction, which writes the link into its registration event. The Run ends
 * through the real Run-level Gate, which seals the Result. Only what no command writes is
 * seeded: the frozen population rows, each inspection's capture (the reading action, its
 * structural snapshot and its screenshot, bound as the agent capture path binds them), the
 * rule evaluations and the Exception (the deterministic evaluator is not what this story
 * is about), and ONE historical human-matched Observation written the way a build before
 * this story wrote it — with no link — which the current command refuses to write.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const runId = ids.next();
const runAt = '2026-09-10T09:00:00.000Z';
const leaseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const KEYS = { linked: 'E-000101', legacy: 'E-000102', platform: 'E-000103' } as const;
const CHOSEN_LABEL = 'Synthetic candidate B';

/** LoanCore as the Northstar catalogue registers it: the one P-1 agent-driven target. */
const loancore = (JSON.parse(readFileSync(
  fileURLToPath(new URL('../../fixtures/northstar/datasets/systems.json', import.meta.url)),
  'utf8',
)) as {
  readonly target_systems: readonly {
    readonly id: string;
    readonly display_name: string;
    readonly origin_path: string;
    readonly authentication_destination_path?: string;
    readonly permitted_actions: readonly PermittedReadAction[];
    readonly attribute_label_patterns: readonly string[];
    readonly secondary_key: string;
  }[];
}).target_systems.find((entry) => entry.id === 'loancore');
if (loancore?.authentication_destination_path === undefined) {
  throw new Error('The Northstar catalogue has no complete LoanCore target.');
}
const LOANCORE_FIELDS = {
  registrationId: ids.next(),
  displayName: loancore.display_name,
  kind: 'web' as const,
  allowedOrigins: [`${NORTHSTAR_BASE_URL}${loancore.origin_path}`],
  applicationIdentity: '',
  credentialRef: LOANCORE_CREDENTIAL,
  permittedActions: loancore.permitted_actions,
  attributeLabelPatterns: loancore.attribute_label_patterns,
  secondaryKey: loancore.secondary_key,
  authenticationDestination: `${NORTHSTAR_BASE_URL}${loancore.authentication_destination_path}`,
};
const LOANCORE = { ...LOANCORE_FIELDS, digest: registrationDigest(LOANCORE_FIELDS) };
const targetRegistrationId = LOANCORE.registrationId;

/** What each record's account shows on LoanCore: the Exception is the account left Active. */
const ACCOUNT_STATUS: Readonly<Record<string, string>> = { 'E-000101': 'Active', 'E-000102': 'Disabled', 'E-000103': 'Disabled' };

/** The leavers export's own columns, and its own mask on `full_name`. */
const LEAVERS_SCHEMA = ['employee_id', 'full_name', 'department', 'employment_status', 'termination_effective_date', 'manager'];
const LEAVERS = {
  kind: 'versioned-file' as const,
  location: 'https://synthetic.invalid/leavers-export.csv',
  declaredSchema: LEAVERS_SCHEMA,
  sensitiveFields: ['full_name'],
  declaredCountMechanism: 'cover-sheet' as const,
};

function p1Inputs(): FrozenPlanInputs {
  return {
    ...initialDraftPopulation('P-1'),
    ...canonicalLoanCoreCompliance(),
    ...initialDraftEvidence('P-1'),
    templateId: 'P-1',
    controlName: `Human match ${procedureId}`,
    sections: initialDraftSections('P-1'),
    scope: 'Every terminated employee in the period.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: { bindingId: ids.next(), displayName: 'Leavers export', digest: bindingDigest(LEAVERS), contract: bindingDigestEnvelope(LEAVERS) },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration(LOANCORE)],
    instructions: [{ registrationId: LOANCORE.registrationId, text: 'Find each leaver and read the account status and roles.' }],
  };
}

let sql: Sql;
let auditorName = '';
let waitId = '';

async function scan(page: Page): Promise<void> {
  // The leavers binding masks `full_name`, so no surface that carries a human match may
  // show one: the decision note names the person who chose and the candidate the agent
  // described, never the population's masked value.
  for (const index of [1, 2, 3]) await expect(page.locator('main')).not.toContainText(`Synthetic Leaver ${index}`);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id, impact: violation.impact, help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the human-match browser journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 6 });
  const db = createDb(sql);
  const [auditor] = await sql<{ id: string; name: string }[]>`SELECT id,name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor before the human-match journey.');
  auditorName = auditor.name;

  const version = activeRunVersion(procedureId, versionId, auditor.id, p1Inputs());
  const plan = version.compiledPlan;
  if (plan === null) throw new Error('The human-match fixture could not derive its frozen plan.');
  const inspectStep = plan.targetSystems.find((entry) => entry.registrationId === targetRegistrationId)
    ?.planSteps.find((step) => step.action === 'inspect-record');
  if (!inspectStep) throw new Error('The human-match fixture plan has no inspect step for its Target.');
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });

  // A RUNNING Run and the held checkpoints every recovery sweep respects, in ONE
  // transaction, so no worker can claim a half-seeded Run.
  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
        period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${version.controlName},
        '2026-08-01','2026-08-31','RUNNING','STANDARD',${auditor.id},'human-match-fixture','auditor',${runAt})`;
    await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${runAt},${runAt},${leaseUntil},'session-1',${ids.next()})`;
    await tx`INSERT INTO run_agent_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${runAt},${runAt},${runAt},${leaseUntil},${ids.next()})`;
    const checks = POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true }));
    await tx`INSERT INTO population_snapshot(run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,retrieved_count)
      VALUES(${runId},3,0,0,${'a'.repeat(64)},${json(checks)}::jsonb,'2026-09-01T00:00:00.000Z',3,3)`;
    for (const [index, key] of [KEYS.linked, KEYS.legacy, KEYS.platform].entries()) {
      const values = {
        employee_id: key, full_name: `Synthetic Leaver ${index + 1}`, department: 'Servicing',
        employment_status: 'Terminated', termination_effective_date: '2026-08-04', manager: 'Synthetic Manager',
      };
      await tx`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
        VALUES(${runId},${index + 1},${json(values)}::jsonb,'included','[]'::jsonb)`;
    }
  });

  // The decision, made by the real commands: a choose-candidate question, answered with the
  // SECOND candidate by the signed-in Auditor.
  const waits = { repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() };
  const raised = await raiseEscalation(waits, {
    runId,
    kind: 'choose-candidate',
    options: [
      { id: 'candidate-a', label: 'Synthetic candidate A' },
      { id: 'candidate-b', label: CHOSEN_LABEL },
      { id: 'mark-ambiguous', label: 'Mark the record ambiguous' },
    ],
  });
  if (!raised.ok) throw new Error(`human-match fixture could not raise its question: ${raised.reason}`);
  waitId = raised.wait.waitId;
  const [revision] = await sql<{ revision: number }[]>`SELECT revision FROM audit_run WHERE run_id=${runId}`;
  const answer = await answerEscalation(
    { ...waits, roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db) },
    { session: { userId: auditor.id, sessionId: 'human-match-fixture' },
      request: { runId, waitId, expectedRunRevision: Number(revision!.revision), answerOptionId: 'candidate-b' } },
  );
  if (!answer.ok) throw new Error(`human-match fixture could not answer its question: ${answer.reason}`);

  // What the agent path writes for P-1: ONE Work Item per population record, subject key
  // the record's key, each inspected in its own Step Execution on its own captured page —
  // the reading action, its structural snapshot and its screenshot, bound to that action
  // as the agent capture path binds them, so the Observation's own evidence checks pass.
  const at = new Date().toISOString();
  const units = new Map<string, { workItemId: string; stepExecutionId: string; evidenceId: string; screenshotId: string }>();
  for (const [index, key] of [KEYS.linked, KEYS.legacy, KEYS.platform].entries()) {
    const unit = { workItemId: ids.next(), stepExecutionId: ids.next(), evidenceId: ids.next(), screenshotId: ids.next() };
    units.set(key, unit);
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
        captured_at,capture_method,capture_time_source,role)
      VALUES(${unit.evidenceId},${runId},'structural-snapshot',${targetRegistrationId},${`human-match/${runId}/snapshot-${index + 1}`},
        'application/vnd.intellifin.web-tree+json',${String(index + 1).repeat(64)},128,'REGISTERED',false,${runAt},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
        captured_at,capture_method,capture_time_source,role)
      VALUES(${unit.screenshotId},${runId},'screenshot',${targetRegistrationId},${`human-match/${runId}/screenshot-${index + 1}`},
        'image/png',${String(index + 4).repeat(64)},256,'REGISTERED',false,${runAt},'agent','registration','evidence')`;
    await db.transaction((tx) => withRunExecutionContext(tx, runId, async (context) => {
      await context.saveWorkItem({ workItemId: unit.workItemId, subjectKey: key, stepId: inspectStep.id, ordinal: index + 1,
        registrationId: targetRegistrationId, displayName: LOANCORE.displayName, state: 'OBSERVED', attempts: 1, cycles: 0,
        diagnostic: null, evidenceId: unit.evidenceId, observations: 1 });
      await context.saveStepExecution({ stepExecutionId: unit.stepExecutionId, planStepId: inspectStep.id, workItemId: unit.workItemId,
        action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
    }));
    const toolActionId = ids.next();
    const page = `${NORTHSTAR_BASE_URL}${loancore.origin_path}/accounts/${key}`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,redirected,downloads,started_at,capture)
      VALUES(${toolActionId},${runId},${unit.stepExecutionId},${unit.workItemId},'agent',${targetRegistrationId},'read-attribute','GET',
        ${page},'[]'::jsonb,'performed',false,0,${at},'PERMITTED')`;
    for (const evidenceId of [unit.evidenceId, unit.screenshotId]) {
      await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
        VALUES(${evidenceId},${runId},${toolActionId},${page})`;
    }
  }
  const unitOf = (key: string) => units.get(key)!;
  const record = (key: string, matchOrigin: ObservationRecord['matchOrigin']): ObservationRecord => ({
    schemaVersion: 1,
    observationId: observationIdFor(unitOf(key).workItemId, key),
    workItemId: unitOf(key).workItemId,
    populationRecordKey: key,
    targetSystem: targetRegistrationId,
    found: 'true',
    observedAt: at,
    stepExecutionId: unitOf(key).stepExecutionId,
    captureMethod: 'agent',
    matchOrigin,
    identity: {
      name: 'employee_id', originalValue: key, normalizedValue: key, corroboration: null,
      grounding: { evidenceId: unitOf(key).evidenceId, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: key },
    },
    // What the account page shows, grounded in the same captured page.
    attributes: [
      {
        name: 'username', originalValue: `synthetic.${key.toLowerCase()}`, normalizedValue: `synthetic.${key.toLowerCase()}`, corroboration: null,
        grounding: { evidenceId: unitOf(key).evidenceId, locator: '$.nodes[1].value', label: 'Username', extractedText: `synthetic.${key.toLowerCase()}` },
      },
      {
        name: 'account_status', originalValue: ACCOUNT_STATUS[key]!, normalizedValue: ACCOUNT_STATUS[key]!, corroboration: null,
        grounding: { evidenceId: unitOf(key).evidenceId, locator: '$.nodes[2].value', label: 'Account status', extractedText: ACCOUNT_STATUS[key]! },
      },
    ],
    evidenceIds: [unitOf(key).evidenceId, unitOf(key).screenshotId],
  });
  const linked = record(KEYS.linked, 'human-matched');
  const platform = record(KEYS.platform, 'platform');
  // Each record's batch, registered by the real command in the Run's own transaction.
  for (const [observation, decision] of [[linked, { waitId }], [platform, undefined]] as const) {
    await db.transaction((tx) => withRunExecutionContext(tx, runId, (context) => registerObservations(context, {
      run: context.run!, workItemId: observation.workItemId, stepExecutionId: observation.stepExecutionId,
      targetSystem: targetRegistrationId, templateId: 'P-1', runStartedAt: runAt, registeredAt: at, evidenceRequirements: [],
      items: [{
        record: observation, observedAtSource: at, absence: null,
        expectedQueryKeys: [{ key: 'employee_id', value: observation.populationRecordKey }],
        ...(decision === undefined ? {} : { matchDecision: decision }),
      }],
    }, {
      corroboration: NO_CORROBORATION,
      evaluation: NO_EVALUATION,
      exceptions: { keyId: 'human-match-fixture', fingerprint: () => { throw new Error('The evaluator is not exercised here.'); } },
    })));
  }

  // A human-matched Observation an earlier build registered: no link in any event.
  const legacy = record(KEYS.legacy, 'human-matched');
  await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,
      found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,
      observed_at_source,corroboration)
    VALUES(${legacy.observationId},${runId},${legacy.workItemId},1,${KEYS.legacy},${targetRegistrationId},'true',${at},${legacy.stepExecutionId},
      'agent','human-matched',${json(legacy.identity)}::jsonb,${json(legacy.attributes)}::jsonb,${json(legacy.evidenceIds)}::jsonb,${observationDigest(legacy)},
      'COVERED',${at},'UNJUDGED')`;
  // That build recorded its per-Observation checks too; only the link is what it lacked.
  // Its checks are the ones the current command wrote for a record captured the same way.
  await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
    SELECT ${legacy.observationId},run_id,check_name,outcome,diagnostic FROM run_observation_check
    WHERE observation_id=${platform.observationId}`;

  // The rule evaluations the deterministic evaluator would write: the linked record fails
  // every frozen condition, the other two pass. Then the Exception on the linked record.
  const conditions = await sql<{ condition_id: string }[]>`
    SELECT condition."conditionId" AS condition_id FROM procedure_version,
      jsonb_to_recordset(compiled_plan->'inputs'->'complianceConditions') AS condition("conditionId" text)
    WHERE version_id=${versionId}`;
  for (const [observation, value] of [[linked, 'EXCEPTION'], [legacy, 'COMPLIANT'], [platform, 'COMPLIANT']] as const) {
    for (const condition of conditions) {
      await sql`INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,
          confirmation,confidence,rationale,diagnostic,evidence_ids)
        VALUES(${observation.observationId},'COVERED','UNJUDGED',${runId},${condition.condition_id},'RULE',${value},NULL,NULL,NULL,NULL,
          ${json(observation.evidenceIds)}::jsonb)`;
    }
  }
  await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,population_record_key,
      condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
    VALUES(${ids.next()},${runId},${linked.observationId},${linked.workItemId},${targetRegistrationId},${KEYS.linked},
      ${json(conditions.map((condition) => condition.condition_id))}::jsonb,'[]'::jsonb,${'e'.repeat(64)},'human-match-fixture',${at})`;

  // The Run ends through the real Run-level Gate, which records every §H row over what
  // the Run recorded, moves the Run to its terminal state and seals the Result.
  await db.transaction((tx) => withRunExecutionContext(tx, runId, (context) =>
    runRunLevelGate(context, { run: context.run!, plan, decidedAt: new Date().toISOString() })));
  await sql`UPDATE run_agent_execution SET status='TERMINAL' WHERE run_id=${runId}`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await tx`DELETE FROM notification WHERE run_id=${runId}`;
      await tx`DELETE FROM run_review_snapshot WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result_review WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await tx`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await tx`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      // The Exception cascades with its Observation; its guard refuses a direct delete.
      await tx`DELETE FROM run_observation WHERE run_id=${runId}`;
      await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
      await tx`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM population_row WHERE run_id=${runId}`;
      await tx`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
    });
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/** The flag, the person, the candidate and the Escalation, as the decision line says them. */
async function expectLinked(scope: Locator): Promise<void> {
  const note = scope.locator('[data-human-match="linked"]');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(MATCH_DECISION_WORDS.flag);
  await expect(note).toContainText(`${auditorName} ${choseCandidateWords(2, 2)} on`);
  await expect(note.locator('time')).toHaveCount(1);
  await expect(note.locator('.ls-reference')).toHaveAttribute('title', waitId);
}

test.describe('a human-selected match, traced to its decision (Story 10.6, legacy 4.7)', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the Result flags the named record and lists every record a person matched', async ({ page }) => {
    await page.goto(`/runs/${runId}`);
    const findings = page.getByRole('region', { name: 'Records the Result names', exact: true });
    await expect(findings).toBeVisible();
    const named = findings.locator('li.ls-finding').filter({ hasText: KEYS.linked });
    await expect(named).toHaveCount(1);
    await expectLinked(named);

    const list = page.getByRole('region', { name: MATCH_DECISION_WORDS.sectionHeading, exact: true });
    await expect(list).toContainText(MATCH_DECISION_WORDS.sectionIntro);
    await expectLinked(list.locator('li').filter({ hasText: KEYS.linked }));
    const legacy = list.locator('li').filter({ hasText: KEYS.legacy });
    await expect(legacy.locator('[data-human-match="not-linked"]')).toContainText(MATCH_DECISION_WORDS.notLinked);
    // A platform match shows no flag anywhere on the Result.
    await expect(list.locator('li').filter({ hasText: KEYS.platform })).toHaveCount(0);
    await expect(page.locator('.ls-human-match__flag')).toHaveCount(3);
    await captureStoryState(page, 'human-match-result', list);
    await scan(page);
  });

  test('the Exceptions list shows the decision behind the finding, with the candidate’s own text inert', async ({ page }) => {
    await page.goto(`/runs/${runId}/exceptions`);
    const card = page.locator('li.ls-exception').filter({ hasText: KEYS.linked });
    await expect(card).toHaveCount(1);
    await expectLinked(card);
    await expect(card).toContainText(`Untrusted source content — ${MATCH_DECISION_WORDS.candidateField}.`);
    await expect(card.locator('pre.ls-untrusted__body').filter({ hasText: CHOSEN_LABEL })).toHaveCount(1);
    await expect(page.locator('.ls-human-match__flag')).toHaveCount(1);
    await captureStoryState(page, 'human-match-exception', card);
    await scan(page);
  });

  test('the record review flags each matched row and the inspector shows the decision', async ({ page }) => {
    await page.goto(`/runs/${runId}/evidence`);
    const queue = page.getByRole('region', { name: 'Records and findings', exact: true });
    const rows = queue.locator('ol[aria-label="Record review queue"] > li');
    await expect(rows).toHaveCount(3);
    await expectLinked(rows.filter({ hasText: KEYS.linked }));
    await expect(rows.filter({ hasText: KEYS.legacy }).locator('[data-human-match="not-linked"]'))
      .toContainText(MATCH_DECISION_WORDS.notLinked);
    await expect(rows.filter({ hasText: KEYS.platform }).locator('.ls-human-match__flag')).toHaveCount(0);

    // The reader lands on the first Exception, which is the record a person matched.
    const inspector = page.getByRole('region', { name: 'Record inspector', exact: true });
    await expect(inspector).toContainText(KEYS.linked);
    await expectLinked(inspector);
    await expect(inspector.locator('pre.ls-untrusted__body').filter({ hasText: CHOSEN_LABEL })).toHaveCount(1);
    await captureStoryState(page, 'human-match-inspector', inspector);
    await scan(page);
  });
});
