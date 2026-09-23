import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  bindingDigest,
  initialDraftEvidence,
  registrationDigest,
  type PermittedReadAction,
} from '@intellifin/domain';
import {
  createSqlClient,
  CryptoUuidV7Generator,
  RUN_DETAIL_PAGE_SIZE,
  type Sql,
} from '@intellifin/infrastructure';

import { startSyntheticS3 } from '../fixtures/s3-server';
import { startCanonicalLeaverSource } from '../fixtures/single-leaver-source';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
  LOANCORE_CREDENTIAL,
} from './credentials';
import { NORTHSTAR_BASE_URL } from './northstar';
import { attachAuthoringScreenshot, openPlanDetail, openStep } from './builder';
import { STOP_REASON_TITLE } from '../../apps/web/src/runs/stop-reason';
import {
  NO_STEP_EXECUTIONS_ENDED_SENTENCE,
  NO_STEP_EXECUTIONS_PENDING_SENTENCE,
  stepExecutionsListedSentence,
} from '../../apps/web/src/runs/stage-words';

/**
 * The P-1 journey the owner walked in production on 2026-09-16, end to end and with
 * nothing seeded behind it: author the hero Procedure through the interface, have a
 * SEPARATE Audit Manager approve it, start a Run by hand, and let the REAL worker execute
 * it in local browser mode against the real synthetic LoanCore.
 *
 * `owner-walkthrough.spec.ts` walks the same seam for P-2, which is the ADAPTER path and
 * needs no browser at all. This is the half that path cannot reach: an Agent Workspace,
 * a credential typed into LoanCore's own sign-in form, and target inspection. Every
 * existing agent journey (`agent-sign-in`, `agent-evaluation-journey`,
 * `disablement-window-journey`) INSERTS its frozen version and binds a one-record source;
 * none of them authors anything, and none of them binds the population an auditor would
 * actually pick. That is the gap, and it is where the owner's Runs died.
 *
 * What the owner chose is mirrored exactly, and the choices are load-bearing:
 *
 *  - Period 1–31 August 2026. The synthetic snapshot is generated 2026-09-01, so an
 *    August period passes `freshness` — the check that stopped every production Run when
 *    the period ran to 2026-09-15 (CLAUDE.md, 2026-09-16).
 *  - The Leavers export, as an independently declared ONE-RECORD case source over the
 *    canonical row for E-000102 — the same `startCanonicalLeaverSource` shape every other
 *    agent P-1 journey binds, with its own cover sheet, count, digest and effective period,
 *    and the hero period unchanged. The FULL export is seeded here and deliberately NOT
 *    bound: it is designed to seed every failure mode at once, and "a dataset that seeds
 *    every failure mode at once cannot also be the dataset that demonstrates success"
 *    (CLAUDE.md, 2026-09-06). The three things it would seed are recorded at the step that
 *    binds the source, so what this journey does not exercise is named rather than lost.
 *  - LoanCore alone. LedgerDesk is a desktop system, deferred to Epic 7, and selecting one
 *    would fail the sign-in by name.
 *  - C2 REMOVED rather than given a privileged-role list. That is what the owner did, and
 *    it is a real authoring choice the Builder offers: `Remove rule C2`.
 */

const ids = new CryptoUuidV7Generator();
const STAMP = Date.now();
const CONTROL = `Owner P-1 walkthrough ${STAMP}`;
const PERIOD = { from: '2026-08-01', to: '2026-08-31' } as const;
const SCOPE =
  'Every employee terminated between 1 and 31 August 2026, checked for retained access in LoanCore.';
/** Seven read-only steps, typed by hand. The writing assistant is deliberately not used. */
const INSTRUCTIONS = [
  '1. Sign in to LoanCore with the read-only audit account.',
  '2. Search for the employee by employee ID.',
  '3. If no account matches the ID, search again by full name.',
  '4. If there is still no match, record that no account exists and stop there.',
  '5. Open the account record that matches.',
  '6. Read the account status, the username and the assigned roles from the account page.',
  '7. Change nothing: every step above is a read.',
].join('\n');
const MANAGER_ID = `owner-p1-manager-${STAMP}`;
const MANAGER_EMAIL = `${MANAGER_ID}@example.test`;

/**
 * How long the Run itself is given. The owner's ask is ~8 minutes; the frozen compiler-1
 * Run limit is an hour, so this bound is the TEST's patience and not the product's.
 */
const RUN_BUDGET_MS = 480_000;

/**
 * LoanCore and the Leavers export, read from the catalogue both the seed script and the
 * synthetic system itself read.
 *
 * Read rather than retyped: a hand-copied origin, action list or label pattern agrees with
 * the catalogue right up until somebody changes one of them, and a label the registration
 * does not permit is never captured. Only the display names carry a stamp, so the Builder's
 * pickers are unambiguous and the teardown can find what this file made.
 */
type CatalogueTarget = {
  readonly id: string;
  readonly display_name: string;
  readonly origin_path: string;
  readonly authentication_destination_path?: string;
  readonly permitted_actions: readonly PermittedReadAction[];
  readonly attribute_label_patterns: readonly string[];
  readonly secondary_key: string;
  readonly credential_ref?: string;
};
type CatalogueBinding = {
  readonly id: string;
  readonly kind: string;
  readonly location_path: string | null;
  readonly declared_schema: readonly string[];
  readonly declared_count_mechanism: string;
  readonly sensitive_fields: readonly string[];
};
const CATALOGUE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/northstar/datasets/systems.json', import.meta.url)), 'utf8'),
) as { readonly target_systems: readonly CatalogueTarget[]; readonly population_source_bindings: readonly CatalogueBinding[] };

const LOANCORE = CATALOGUE.target_systems.find((entry) => entry.id === 'loancore');
if (LOANCORE?.authentication_destination_path === undefined || LOANCORE.credential_ref !== LOANCORE_CREDENTIAL) {
  throw new Error('The Northstar catalogue holds no complete LoanCore agent target contract.');
}
const LEAVERS = CATALOGUE.population_source_bindings.find((entry) => entry.id === 'leavers-export-versioned');
if (LEAVERS?.location_path == null || LEAVERS.declared_count_mechanism !== 'cover-sheet') {
  throw new Error('The Northstar catalogue holds no versioned Leavers export binding.');
}

/**
 * Trimmed, deduplicated and SORTED, exactly as `registerTargetSystem` stores them.
 *
 * A raw-SQL seed that stores an unsorted list disagrees with the frozen snapshot's own
 * normalized envelope, so the Target System editor reconciles a value it never changed and
 * reports a saved-value CONFLICT — which then blocks submission for a reason that has
 * nothing to do with the journey (`hero-workflow.spec.ts`). `declaredSchema` is ORDERED
 * and is left alone: a schema declares field POSITIONS.
 */
function sortedSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))].sort();
}

/**
 * The canonical row this journey audits: Terminated 2026-08-04, inside the owner's period,
 * with a `normal` LoanCore account page whose Status is `Disabled` and whose only role is
 * `LOAN_VIEWER` (addendum §D case D1-b). Nothing about it is seeded to fail.
 */
const EMPLOYEE_ID = 'E-000102';
const TARGET_NAME = `E2E owner P-1 LoanCore ${STAMP}`;
const SOURCE_NAME = `E2E owner P-1 leaver ${EMPLOYEE_ID} ${STAMP}`;
const FULL_EXPORT_NAME = `E2E owner P-1 full leavers export ${STAMP}`;

/**
 * What LoanCore actually DISPLAYS, which is not what the P-1 Template names.
 *
 * Compiler-1 named sets compare exact strings and corroboration permits no case folding,
 * so the Template's `[disabled]`/`[active]` match nothing on a page that says `Disabled`
 * and `Active`. The auditor types the displayed spelling; the saved rule is asserted
 * afterwards so this file pins that the interface really wrote it.
 */
const COMPLIANT_STATUS = 'Disabled';
const EXCEPTION_STATUS = 'Active';
const C1_SAVED_RULE = `found = false or account_status in [${COMPLIANT_STATUS}] else [${EXCEPTION_STATUS}]`;
const TARGET_FIELDS = {
  kind: 'web' as const,
  allowedOrigins: [`${NORTHSTAR_BASE_URL}${LOANCORE.origin_path}`],
  applicationIdentity: '',
  credentialRef: LOANCORE_CREDENTIAL,
  permittedActions: sortedSet(LOANCORE.permitted_actions) as PermittedReadAction[],
  attributeLabelPatterns: sortedSet(LOANCORE.attribute_label_patterns),
  secondaryKey: LOANCORE.secondary_key,
  authenticationDestination: `${NORTHSTAR_BASE_URL}${LOANCORE.authentication_destination_path}`,
};
const FULL_EXPORT_FIELDS = {
  kind: 'versioned-file' as const,
  location: `${NORTHSTAR_BASE_URL}${LEAVERS.location_path}`,
  declaredSchema: [...LEAVERS.declared_schema],
  declaredCountMechanism: 'cover-sheet' as const,
  sensitiveFields: sortedSet(LEAVERS.sensitive_fields),
};

/**
 * The case source's own binding contract.
 *
 * Its location is a loopback port the fixture binds at start-up, so unlike the full
 * export's this cannot be a module constant. The declared schema is the fixture's own —
 * the six canonical columns, `employee_id` and `full_name` among them, which is what a
 * P-1 Draft needs to be complete because the plan looks up by id and falls back to the
 * name.
 */
function caseBindingFields(source: LeaverSource) {
  return {
    kind: 'versioned-file' as const,
    location: source.location,
    declaredSchema: [...source.schema],
    declaredCountMechanism: 'cover-sheet' as const,
    sensitiveFields: sortedSet(LEAVERS!.sensitive_fields),
  };
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TARGET_ID = ids.next();
const SOURCE_ID = ids.next();
const FULL_EXPORT_ID = ids.next();

type LeaverSource = Awaited<ReturnType<typeof startCanonicalLeaverSource>>;

let sql: Sql | undefined;
let caseSource: LeaverSource | undefined;
let storage: Awaited<ReturnType<typeof startSyntheticS3>> | undefined;
let stopWorker: (() => Promise<void>) | undefined;
let procedureId = '';
let runId = '';

/**
 * Marker lines only, never the worker's own log.
 *
 * This Run TYPES a credential into a sign-in form, so the whole-log retention
 * `owner-walkthrough.spec.ts` uses on the adapter path is the wrong trade here: a failure
 * message is an artifact, and the containment contract is that the value has nowhere to
 * land. What is kept is the preload's closed markers, the worker's own `Run ended` line
 * (run id, state, stage, closed diagnostic) and the mode line — the same discipline
 * `disablement-window-journey.spec.ts` follows.
 */
const workerMarkers: string[] = [];
let workerFailure: string | null = null;

async function startWorker(): Promise<void> {
  workerMarkers.length = 0;
  workerFailure = null;
  let stopping = false;
  let buffer = '';
  const worker = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(resolve('tests/fixtures/owner-walkthrough-p1-worker-preload.mjs')).href,
      resolve('apps/worker/dist/main.js'),
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        ...storage!.env,
        SERVICE_NAME: 'worker',
        // The model identity a version freezes comes from the WEB, and `playwright.config.ts`
        // gives its server `anthropic` / `synthetic-http-fixture` — so the worker that
        // derives the plan has to hold the SAME identity and the fixture that answers for
        // it, or derivation reports the frozen configuration as unavailable and the Draft
        // never becomes submittable.
        MODEL_PROVIDER: 'anthropic',
        MODEL_ID: 'synthetic-http-fixture',
        MODEL_PROMPT_VERSION: '1',
        MODEL_API_KEY: 'isolated-synthetic-http-fixture',
        MODEL_MAX_OUTPUT_TOKENS: '65536',
        // The agent gateway is composed from provider-native keys, INDEPENDENTLY of the
        // derivation settings above. Both reach `api.anthropic.com`, which is why one
        // preload answers both.
        ANTHROPIC_API_KEY: 'synthetic-owner-walkthrough-p1-interception',
        AGENT_ANTHROPIC_MODEL: 'synthetic-owner-walkthrough-p1',
        AGENT_OPENAI_MODEL: '',
        OPENAI_API_KEY: '',
        // No provider key, so the Agent Workspace is a locally launched Chromium. The two
        // modes are not the same guarantee and the row records which one this Run had.
        SOLARI_API_KEY: '',
        CREDENTIAL_TOKENS,
        EXCEPTION_FINGERPRINT_KEY,
        EXCEPTION_FINGERPRINT_KEY_ID,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  worker.on('error', () => {
    workerFailure = 'worker-process-error';
  });
  const exited = new Promise<void>((done) =>
    worker.once('close', (code) => {
      if ((code !== null && code !== 0) || !stopping) workerFailure = 'worker-exited-unexpectedly';
      done();
    }),
  );
  const retain = (data: unknown): void => {
    buffer += String(data);
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes('Heartbeat loop started')) workerMarkers.push('Heartbeat loop started');
      if (line.includes('Agent Workspace mode selected')) workerMarkers.push('Agent Workspace mode selected');
      const provider = line.indexOf('Synthetic owner P-1 provider:');
      if (provider >= 0) workerMarkers.push(line.slice(provider).trim());
      // The worker's own end-of-Run line: run id, terminal state, stage, closed diagnostic.
      // Nothing a Target System said is in it, which is why it may be kept.
      if (line.includes('"Run ended"')) workerMarkers.push(line.trim().slice(0, 500));
    }
  };
  worker.stdout.on('data', retain);
  // Stderr is discarded: a worker error is reported by fixed code, and provider or
  // configuration text must never become a test failure artifact.
  worker.stderr.on('data', () => undefined);
  stopWorker = async () => {
    stopping = true;
    worker.kill('SIGTERM');
    await exited;
    stopWorker = undefined;
  };
  await expect
    .poll(
      () => {
        if (workerFailure) throw new Error(workerFailure);
        return workerMarkers.includes('Heartbeat loop started');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE.auditor });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });

  // The Audit Manager this journey needs. `procedure.version.approve` is an Audit Manager's
  // alone AND is denied to the version's own author, so an environment holding one auditor
  // and one administrator cannot approve anything. Its password hash is copied from the
  // seeded auditor's credential row rather than read into a payload: the value never
  // enters this process.
  await sql`INSERT INTO auth_user(id,name,email,email_verified) VALUES (${MANAGER_ID},'Owner P-1 Audit Manager',${MANAGER_EMAIL},true)`;
  await sql`INSERT INTO auth_account(id,issuer,account_id,provider_id,user_id,password)
    SELECT ${ids.next()},issuer,${MANAGER_ID},provider_id,${MANAGER_ID},password FROM auth_account
    WHERE user_id = (SELECT id FROM auth_user WHERE email = ${ACCOUNTS.auditor.email}) AND provider_id = 'credential'`;
  await sql`INSERT INTO user_role(user_id,role) VALUES (${MANAGER_ID},'audit-manager')`;

  await sql`INSERT INTO target_system_registration
    (registration_id, display_name, kind, allowed_origins, application_identity, credential_ref,
     permitted_actions, attribute_label_patterns, secondary_key, authentication_destination,
     note, status, digest)
    VALUES (${TARGET_ID}, ${TARGET_NAME}, ${TARGET_FIELDS.kind}, ${TARGET_FIELDS.allowedOrigins},
     ${TARGET_FIELDS.applicationIdentity}, ${TARGET_FIELDS.credentialRef},
     ${TARGET_FIELDS.permittedActions}, ${TARGET_FIELDS.attributeLabelPatterns},
     ${TARGET_FIELDS.secondaryKey}, ${TARGET_FIELDS.authenticationDestination},
     '', 'active', ${registrationDigest(TARGET_FIELDS)})`;
  // The case source publishes the canonical row with its own cover sheet, count, digest,
  // generation and effective period — the full export's own `2026-09-01` generation and
  // `2026-01-01..2026-08-31` coverage, so `freshness` and `declared-period` are decided by
  // the same facts the owner's Run met rather than by numbers this file invented.
  caseSource = await startCanonicalLeaverSource(EMPLOYEE_ID);
  const caseFields = caseBindingFields(caseSource);
  await sql`INSERT INTO population_source_binding
    (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism,
     sensitive_fields, note, status, digest)
    VALUES (${SOURCE_ID}, ${SOURCE_NAME}, ${caseFields.kind}, ${caseFields.location},
     ${caseFields.declaredSchema}, ${caseFields.declaredCountMechanism},
     ${caseFields.sensitiveFields}, '', 'active', ${bindingDigest(caseFields)})`;
  // Seeded and never bound, so the Builder offers both and the choice this journey makes
  // is a choice rather than the only option on the page.
  await sql`INSERT INTO population_source_binding
    (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism,
     sensitive_fields, note, status, digest)
    VALUES (${FULL_EXPORT_ID}, ${FULL_EXPORT_NAME}, ${FULL_EXPORT_FIELDS.kind}, ${FULL_EXPORT_FIELDS.location},
     ${FULL_EXPORT_FIELDS.declaredSchema}, ${FULL_EXPORT_FIELDS.declaredCountMechanism},
     ${FULL_EXPORT_FIELDS.sensitiveFields}, '', 'active', ${bindingDigest(FULL_EXPORT_FIELDS)})`;

  storage = await startSyntheticS3();
  await startWorker();
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  await caseSource?.close();
  if (!sql) return;
  try {
    if (procedureId) {
      // A refused initiation request has a NULL `run_id` and names the blocking Run in
      // `refused_run_id`, so a teardown keyed on `run_id` alone leaves it behind and the
      // `audit_run` delete then fails on its foreign key.
      await sql`DELETE FROM run_initiation_request WHERE procedure_id = ${procedureId}`;
      const runs = await sql<{ run_id: string }[]>`SELECT run_id FROM audit_run WHERE procedure_id = ${procedureId}`;
      const runIds = runs.map((row) => row.run_id);
      if (runIds.length) {
        // A Run still queued when the journey failed must not be left for the next file's
        // worker to pick up.
        await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
        // The SEAL goes first, then children deepest-first — the `owner-walkthrough.spec.ts`
        // list. Only eight of `audit_run`'s children cascade (`run_workspace`,
        // `run_agent_execution` and `run_replay_recording` among them); the rest record an
        // OUTCOME and refuse to be removed silently. A teardown that does not know about one
        // table throws, and then EVERY row this file created survives and some unrelated
        // file's empty-list assertion fails for a reason that is not its own.
        //
        // `run_evidence_package` is deleted BEFORE the three tables generation 27 and
        // generation 32 freeze behind it — `run_evidence`, `population_evidence` AND
        // `run_evidence_capture`. The third is the one that is easy to miss: the agent
        // capture carries the same `run_evidence_frozen_after_seal` trigger, so a list that
        // puts captures near the other Tool Action rows deletes them while the seal still
        // stands and is refused. Its four siblings here reference only `audit_run`, so
        // moving them to the front costs nothing.
        for (const table of [
          'run_gate_check', 'run_evidence_integrity', 'run_result', 'run_evidence_package',
          'run_observation_absence', 'run_observation_check', 'run_observation_evaluation', 'run_observation',
          'run_agent_work', 'run_agent_turn', 'run_agent_execution',
          'run_evidence_capture', 'run_tool_action', 'run_step_execution', 'run_work_item', 'run_session_step',
          'run_evaluation_review_command', 'run_evaluation_review',
          'notification', 'run_wait', 'run_flag',
          'run_evidence', 'population_evidence', 'population_row', 'population_snapshot',
          'population_execution', 'run_execution', 'run_initiation_request',
        ]) {
          await sql`DELETE FROM ${sql(table)} WHERE run_id = ANY(${runIds}::uuid[])`;
        }
        await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[]) AND predecessor_run_id IS NOT NULL`;
        await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
      }
      // Submitted and approved notices name the VERSION, so they go before it.
      await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${procedureId})`;
      await sql`DELETE FROM notification WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure_succession WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    await sql`DELETE FROM population_source_binding WHERE binding_id = ANY(${[SOURCE_ID, FULL_EXPORT_ID]}::uuid[])`;
    await sql`DELETE FROM target_system_registration WHERE registration_id = ${TARGET_ID}`;
    await sql`DELETE FROM notification WHERE recipient_id = ${MANAGER_ID}`;
    await sql`DELETE FROM user_role WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_session WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_account WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_user WHERE id = ${MANAGER_ID}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/* --------------------------------------------------------------- authoring --- */

/** Choose the one option in a native select whose visible label matches. */
async function chooseOption(select: Locator, pattern: RegExp): Promise<void> {
  const labels = await select.locator('option').allTextContents();
  const values = await select
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const matches = labels
    .map((label, index) => ({ label, value: values[index] ?? '' }))
    .filter((option) => pattern.test(option.label) && option.value !== '');
  expect(matches, `no option matched ${String(pattern)} in [${labels.join(' | ')}]`).toHaveLength(1);
  await select.selectOption(matches[0]!.value);
}

/**
 * Every save carries the row version the page was rendered with, and creating a Procedure
 * immediately queues a plan derivation whose attempt record lands on that same row a second
 * or two later. A save made before the Builder's own poll has caught up is refused with
 * this sentence — the optimistic guard working, and it names its own remedy. A person
 * filling three fields rarely meets it; a browser filling them in 300ms meets it every
 * time, so this does what the sentence says: reload, redo, save.
 */
const STALE = 'That procedure changed since this page was loaded. Reload the page and try again.';

/** A real worker is running. Observe its terminal preview before the next authoring
 * decision rather than racing three immediate retries against its queued attempt writes. */
async function waitForPlanAttempt(page: Page): Promise<void> {
  await openPlanDetail(page);
  await expect(
    page.getByTestId('executable-plan-preview').locator(':scope > [role="status"]'),
  ).toContainText(/Test plan prepared|could not be prepared/, { timeout: 120_000 });
}

/** Await this action, not a success or stale banner retained from the preceding save. */
async function acknowledgedAction(page: Page, action: () => Promise<void>): Promise<void> {
  const address = page.url();
  const response = page.waitForResponse(
    (candidate) => candidate.url() === address && candidate.request().method() === 'POST',
  );
  await action();
  await (await response).finished();
}

async function step(
  page: Page,
  heading: string,
  fill: () => Promise<void>,
  save: () => Promise<void>,
  saved: string | RegExp,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForPlanAttempt(page);
    await openStep(page, heading);
    await fill();
    await acknowledgedAction(page, save);
    const ok = page.getByText(saved).first();
    const stale = page.getByText(STALE).first();
    await expect(ok.or(stale).first()).toBeVisible();
    if (await ok.isVisible()) return;
    await page.reload();
  }
  throw new Error(`${heading} would not save: the row version kept moving underneath it.`);
}

/** Confirm a control that keeps its focus-trapping dialog. */
async function confirmed(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function markReviewed(page: Page, section: string, title: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForPlanAttempt(page);
    await expect(page.locator('[data-guided-preparation]')).toHaveAttribute('data-guided-ready', 'true');
    await page.locator(`[data-preparation-nav="${section}"]`).click();
    const panel = page.locator(`[data-preparation-panel="${section}"]`);
    await expect(panel).toBeVisible();
    await acknowledgedAction(page, () =>
      panel.getByRole('button', { name: /^(Yes, use this control|Mark reviewed and continue)$/ }).click(),
    );
    const done = page.getByText(`Review recorded for ${title}.`, { exact: true });
    const stale = page.getByText(STALE, { exact: true });
    await expect(done.or(stale).first()).toBeVisible();
    if (await done.isVisible()) {
      await expect(page.locator(`[data-preparation-nav="${section}"]`)).toContainText('Reviewed by auditor');
      return;
    }
    await page.reload();
  }
  throw new Error(`The saved ${title} review could not be acknowledged.`);
}

/**
 * The six section reviews, LAST. Every save moves the basis of the sections that depend on
 * it and clears their review, so reviewing as you go would leave the last save having
 * undone the first review.
 */
async function reviewPreparedSections(page: Page): Promise<void> {
  for (const [section, title] of [
    ['context', 'Risk, control and objective'],
    ['scope', 'Scope and period'],
    ['evidence', 'Evidence to review'],
    ['instructions', 'Audit steps'],
    ['assessment', 'Assessment criteria'],
    // The step's own title, which UX-09 renamed: the acknowledgement is built from
    // `SECTION_WORDS[section].title`, so a retyped old name waits for a sentence the
    // product no longer writes while the review itself has already been recorded.
    ['frequency', 'Planned frequency'],
  ]) {
    await markReviewed(page, section!, title!);
  }
  await expect(page.locator('[data-preparation-progress]')).toContainText(
    '6 of 6 sections reviewed by auditor.',
  );
}

async function waitForSubmittablePlan(page: Page): Promise<void> {
  let blocker = '(not read)';
  await expect
    .poll(
      async () => {
        await page.reload();
        await openPlanDetail(page);
        const submit = page.getByRole('button', { name: 'Submit for approval', exact: true });
        const unavailable = await submit.getAttribute('aria-disabled');
        blocker =
          unavailable === 'true'
            ? await submit.evaluate((node) => {
                const id = node.getAttribute('aria-describedby')?.split(' ')[0];
                return (id ? document.getElementById(id)?.textContent : null) ?? '(no reason given)';
              })
            : '';
        return unavailable;
      },
      { timeout: 180_000, intervals: [3_000] },
    )
    .toBeNull()
    .catch((error: unknown) => {
      throw new Error(
        `Submit stayed unavailable. It says: "${blocker}"\nWorker markers:\n${workerMarkers.join('\n')}\n${String(error)}`,
      );
    });
}

/* ------------------------------------------------------------- the outcome --- */

/** Everything a reader needs to say WHERE this journey stopped, and nothing a system said. */
async function facts(id: string): Promise<Record<string, unknown>> {
  const one = async <T>(query: Promise<T[]>): Promise<T | null> => (await query)[0] ?? null;
  return {
    runId: id,
    run: await one(sql!`SELECT state FROM audit_run WHERE run_id = ${id}::uuid`),
    population: await one(sql!`SELECT status, attempts, diagnostic FROM population_execution WHERE run_id = ${id}::uuid`),
    snapshot: await one(sql!`SELECT included, excluded, indeterminate, declared_count, retrieved_count, generated_at FROM population_snapshot WHERE run_id = ${id}::uuid`),
    workspace: await one(sql!`SELECT status, mode, diagnostic FROM run_workspace WHERE run_id = ${id}::uuid`),
    access: await one(sql!`SELECT status, diagnostic FROM run_agent_execution WHERE run_id = ${id}::uuid`),
    extraction: await one(sql!`SELECT status, diagnostic FROM run_execution WHERE run_id = ${id}::uuid`),
    inspection: await one(sql!`SELECT status, diagnostic FROM run_agent_work WHERE run_id = ${id}::uuid`),
    sessionSteps: await sql!`SELECT action, state, attempts, diagnostic FROM run_session_step WHERE run_id = ${id}::uuid ORDER BY step_id`,
    workItems: await sql!`SELECT state, attempts, cycles, observations, diagnostic FROM run_work_item WHERE run_id = ${id}::uuid ORDER BY ordinal`,
    counts: await one(sql!`SELECT
        (SELECT count(*)::int FROM run_step_execution WHERE run_id = ${id}::uuid) AS step_executions,
        (SELECT count(*)::int FROM run_tool_action WHERE run_id = ${id}::uuid) AS tool_actions,
        (SELECT count(*)::int FROM run_observation WHERE run_id = ${id}::uuid) AS observations,
        (SELECT count(*)::int FROM run_wait WHERE run_id = ${id}::uuid AND closed_at IS NULL) AS open_waits`),
    failedGateChecks: await sql!`SELECT check_name, total, diagnostics FROM run_gate_check WHERE run_id = ${id}::uuid AND outcome <> 'PASS' ORDER BY check_name`,
    result: await one(sql!`SELECT outcome, sealed, gate_passed FROM run_result WHERE run_id = ${id}::uuid`),
    markers: workerMarkers,
  };
}

/**
 * Wait for a Run that has finished, or for one that is holding a question.
 *
 * `AWAITING_AUDITOR` is NOT terminal and never becomes so without a person: the wake that
 * ends it is the wait's own deadline, half an hour away. Polling only for a terminal state
 * would spend the whole budget and then fail on a timeout that names nothing, so this stops
 * there and the caller reports the question.
 */
const TERMINAL = /^(COMPLETED|INCONCLUSIVE|RUN_FAILED|CANCELED)$/;
async function settle(id: string): Promise<string> {
  let state = '';
  try {
    await expect
      .poll(
        async () => {
          const [row] = await sql!<{ state: string }[]>`SELECT state FROM audit_run WHERE run_id = ${id}::uuid`;
          state = row?.state ?? '';
          if (workerFailure) throw new Error(`The worker stopped: ${workerFailure}`);
          return state === 'AWAITING_AUDITOR' || TERMINAL.test(state);
        },
        { timeout: RUN_BUDGET_MS, intervals: [2_000] },
      )
      .toBe(true);
  } catch (failure) {
    throw new Error(
      `The Run never finished. It is ${state || '(no row)'}.\n${JSON.stringify(await facts(id), null, 2)}\n${String(failure)}`,
    );
  }
  return state;
}

async function scan(page: Page): Promise<void> {
  // The title is asserted BEFORE the scan: a navigation that has begun committing briefly
  // has no <title>, and re-running an intermittent accessibility failure until it is green
  // is exactly what the no-allowlist gate exists to prevent.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

/* ------------------------------------------------------------- the journey --- */

test('an auditor authors P-1, a manager approves it, and the agent Run inspects LoanCore', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(20_000);

  /* --------------------------------------------------------- 1. create ----- */
  await page.goto('/procedures/new');
  await page.getByLabel('Template').selectOption('P-1');
  await expect(page.getByLabel('Procedure name', { exact: true })).toHaveValue(
    'Terminated Users Retaining Access',
  );
  await page.getByLabel('Procedure name').fill(CONTROL);
  // UX-07: creating a Draft is one action, with no confirmation dialog.
  await page.getByRole('button', { name: 'Create Procedure', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: CONTROL })).toBeVisible();
  await expect(page.locator('[data-guided-preparation]')).toHaveAttribute('data-guided-ready', 'true');
  procedureId = new URL(page.url()).pathname.split('/')[2] ?? '';
  expect(procedureId).not.toBe('');

  /* ------------------------------------------------- 2. period and scope --- */
  await step(
    page,
    'Period and scope',
    async () => {
      await page.getByLabel('Period start', { exact: true }).fill(PERIOD.from);
      await page.getByLabel('Period end', { exact: true }).fill(PERIOD.to);
      await page.getByLabel('Scope statement').fill(SCOPE);
    },
    async () => {
      await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
    },
    'Saved. The Draft change is recorded in the audit chain.',
  );

  /* ------------------------------------------------ 3. records to test ----- */
  // The independently declared one-record case source. The FULL export is offered beside
  // it and deliberately not chosen, because it seeds three separate things this journey is
  // not about — each a real finding, each named here so it is visible rather than lost:
  //
  //  1. It carries employee id E-000107 TWICE, both rows Terminated inside the period and
  //     both `included`. `execute-agent-work-item.ts` creates NO Work Item at all when two
  //     included records share the lookup key: it writes the terminal
  //     `population-key-unresolved` checkpoint and goes straight to the Run-level Gate, so
  //     one duplicate costs the Run every OTHER record's inspection — while the adapter
  //     path over the same shape deduplicates and reports `duplicate-record-keys`, §H's own
  //     row counts duplicate Source primary keys as a finding, and expectation D5 in
  //     `p-1-terminated-users.json` declares E-000107 alone Unevaluated with a per-record
  //     outcome still declared for all eighteen others.
  //  2. It reaches two seeded Escalations — E-000116's `Suspended` status is a value C1
  //     names nowhere (unnamed value), and E-000117 matches two candidate rows by name
  //     with no employee id on either (choose candidate). Both open a `run_wait` and hold
  //     the Run `AWAITING_AUDITOR` until a person answers or the deadline passes, so the
  //     full export cannot reach a terminal state unattended at all.
  //  3. Four rows carry no termination date, which §H counts as unaccounted and which makes
  //     the Run Inconclusive however well every inspected record went.
  await step(
    page,
    'Population Source binding',
    async () => {
      await expect(page.getByLabel('Where the records come from').locator('option')
        .filter({ hasText: FULL_EXPORT_NAME })).toHaveCount(1);
      await chooseOption(page.getByLabel('Where the records come from'), new RegExp(SOURCE_NAME));
    },
    async () => {
      await page.getByRole('button', { name: 'Save records to test', exact: true }).click();
    },
    'Saved. The Draft change is recorded in the audit chain.',
  );

  /* ------------------------------------------------ 4. systems to check ---- */
  // Adding a system WIDENS scope, so this one save keeps its confirmation. The Template
  // suggests LoanCore and LedgerDesk BY NAME and mints neither: this deployment registers
  // no desktop system, and selecting one would fail the sign-in as `desktop-unsupported`.
  await step(
    page,
    'Target System selection',
    async () => {
      await expect(page.locator('[data-suggested-target="LoanCore"]')).toBeVisible();
      await expect(page.locator('[data-suggested-target="LedgerDesk"]')).toBeVisible();
      await chooseOption(page.getByLabel('Add a system'), new RegExp(TARGET_NAME));
      await page.getByRole('button', { name: 'Add Target System', exact: true }).click();
    },
    async () => {
      await confirmed(page, 'Save Target Systems');
    },
    'Target systems saved. Next, choose the proof to retain.',
  );

  /* ------------------------------------------------ 5. the audit steps ----- */
  await step(
    page,
    'Audit Instructions',
    async () => {
      await page.getByLabel(`What the agent should do in ${TARGET_NAME}`).fill(INSTRUCTIONS);
    },
    async () => {
      await page.getByRole('button', { name: 'Save Audit Instructions', exact: true }).click();
    },
    'Saved. The Audit Instructions are recorded in the audit chain.',
  );

  /* --------------------------------- 6. the assessment criteria, minus C2 -- */
  // Two authoring acts in one save.
  //
  // C2 is REMOVED rather than given a privileged-role list — what the owner did, and a real
  // choice the Builder offers: an Agent-Judged condition with no policy is a readiness
  // finding, and a condition that is not there raises nothing.
  //
  // C1's values are retyped in LoanCore's own spelling, which the Template does not carry.
  // P-1 ships `[disabled]`/`[active]`, compiler-1 compares named sets EXACTLY and
  // corroboration permits no case folding, so an auditor who accepts the P-1 default meets
  // an unnamed-value Escalation on EVERY record whose page says `Disabled` — the third
  // thing the full export would have shown, reachable from the Template alone.
  await step(
    page,
    'Compliance Rule conditions',
    async () => {
      const c1 = page.locator('[data-condition-id="C1"]');
      // The simple block only exists once React has rendered the client tree, so waiting
      // for it is also the hydration proof before anything is typed.
      await expect(page.locator('[data-simple-for="C1"]')).toBeVisible();
      const compliant = c1.getByLabel('Values that count as Compliant C1');
      const exception = c1.getByLabel('Values that count as an Exception C1');
      await expect(compliant, 'the P-1 Template default LoanCore never displays').toHaveValue('disabled');
      await expect(exception).toHaveValue('active');
      await compliant.fill(COMPLIANT_STATUS);
      await exception.fill(EXCEPTION_STATUS);
      await expect(c1.locator('[data-simple-text="C1"]')).toHaveText(C1_SAVED_RULE);

      await page.locator('[data-condition-id="C2"]').getByRole('button', { name: 'Remove rule C2', exact: true }).click();
      await expect(page.locator('[data-condition-id="C2"]')).toHaveCount(0);
      // The removal must not disturb the condition beside it.
      await expect(c1.locator('[data-simple-text="C1"]')).toHaveText(C1_SAVED_RULE);
    },
    async () => {
      await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    },
    'Saved. The Compliance Rule is recorded in the audit chain.',
  );

  // Reloaded, so what is asserted is the SAVED rule rather than the editor's own state:
  // this is the pin that the interface really wrote LoanCore's spelling into the Draft.
  await page.reload();
  await openStep(page, 'Compliance Rule conditions');
  await expect(page.locator('[data-condition-id="C1"]').locator('[data-simple-text="C1"]')).toHaveText(C1_SAVED_RULE);
  await expect(page.locator('[data-condition-id="C1"]').getByLabel('Values that count as Compliant C1')).toHaveValue(COMPLIANT_STATUS);
  await expect(page.locator('[data-condition-id="C2"]')).toHaveCount(0);

  /* ---------------------------------------------------------- 7. Schedule -- */
  // P-1 is the one Template that pins a Schedule (weekly at an editable midnight). The
  // owner chose Once, which starts nothing at all: no scheduler exists, and the Run is
  // started by hand from the Procedure page.
  await step(
    page,
    'Schedule',
    async () => {
      await expect(page.getByLabel('Frequency', { exact: true })).toHaveValue('weekly');
      await page.getByLabel('Frequency', { exact: true }).selectOption('once');
      await expect(page.getByLabel('Start time (UTC)')).toHaveValue('00:00');
    },
    async () => {
      await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
    },
    'Saved. The Schedule is recorded in the audit chain.',
  );

  /* ------------------------------------ 8. the P-1 Evidence defaults, kept -- */
  // Nothing is saved here: the owner kept what the Template asked for. The three attribute
  // names are read from the Template rather than retyped, and the forced capture is checked
  // structurally — selecting an agent-driven Target System overlays a Structural Snapshot
  // and a screenshot on every item and locks both, so six checkboxes are checked AND
  // disabled and no label has to be copied into this file to say so.
  await openStep(page, 'Evidence Requirements');
  const capture = page.locator('[data-preparation-panel="evidence"]');
  const recorded = await capture
    .getByRole('textbox', { name: 'What to record' })
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  expect(recorded).toEqual(initialDraftEvidence('P-1').evidenceRequirements.map((item) => item.attributeName));
  let locked = 0;
  for (const box of await capture.getByRole('checkbox').all()) {
    if ((await box.isDisabled()) && (await box.isChecked())) locked += 1;
  }
  expect(locked, 'a Structural Snapshot and a screenshot are forced on each item').toBe(recorded.length * 2);

  /* -------------------------------------- 9. the plan derives, then review -- */
  await waitForSubmittablePlan(page);
  await reviewPreparedSections(page);
  await openPlanDetail(page);
  await expect(page.getByLabel('Saved procedure context')).toContainText(SCOPE);
  await attachAuthoringScreenshot(page, testInfo, 'owner-p1-reviewed-draft');

  /* --------------------------------------------------------- 10. submit ---- */
  await confirmed(page, 'Submit for approval');
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  const reviewUrl = page.url();
  // The author is refused, by name, on the surface — the state the owner's deployment was
  // stuck in before it held a second person.
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveAccessibleDescription(
    /You cannot approve a version you authored\./,
  );

  /* ---------------------------------------- 11. an independent approval ---- */
  const managerContext = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const manager = await managerContext.newPage();
  try {
    await signIn(manager, MANAGER_EMAIL);
    await manager.goto('/notifications');
    await expect(
      manager.getByRole('link', { name: /Procedure Version submitted/ }).filter({ hasText: CONTROL }),
    ).toBeVisible({ timeout: 20_000 });
    await manager.goto(reviewUrl);
    await expect(manager.getByText(SCOPE, { exact: true }).first()).toBeVisible();
    await confirmed(manager, 'Approve');
    await expect(manager.getByText('Active', { exact: true }).first()).toBeVisible();
  } finally {
    await managerContext.close();
  }

  /* --------------------------------------------------------- 12. run it ---- */
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.locator('#initiate-run')).toHaveAttribute('data-client-ready', 'true');
  await page.getByLabel('Period from', { exact: true }).fill(PERIOD.from);
  await page.getByLabel('Period to', { exact: true }).fill(PERIOD.to);
  await confirmed(page, 'Initiate Run');
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 30_000 });
  runId = new URL(page.url()).pathname.split('/')[2] ?? '';
  expect(runId).not.toBe('');

  /* ------------------------------------------------ 13. what it executed --- */
  const state = await settle(runId);
  const stopped = await facts(runId);
  // Recorded whatever happens: one run of this file should say the whole story without
  // anyone re-running it.
  // eslint-disable-next-line no-console
  console.log(`Owner P-1 walkthrough: ${JSON.stringify(stopped, null, 2)}`);
  const where = `\n${JSON.stringify(stopped, null, 2)}`;

  // A Run holding a question is not a Run that finished, and nothing here can answer it.
  expect(
    state,
    `The Run is holding a question and no person is here to answer it.${where}`,
  ).not.toBe('AWAITING_AUDITOR');

  // (1) The journey must not FAIL. The full export carries §H findings on purpose, so
  // Inconclusive is the honest outcome; what a working deployment must never produce is a
  // Run that could not execute at all.
  expect(state, `The Run failed rather than concluding.${where}`).toMatch(/^(COMPLETED|INCONCLUSIVE)$/);

  // (2) The Agent Workspace. `workspace-missing` is the diagnostic the owner's Runs carried
  // when a second claimant acquired the population under somebody else's lease, so it is
  // asserted against the CHAIN as well as the checkpoint: the checkpoint holds only the
  // latest value, and the chain holds every one.
  const diagnostics = (
    await sql!<{ diagnostic: string }[]>`
      SELECT coalesce(payload->>'diagnostic','') AS diagnostic FROM audit_events
      WHERE aggregate_id = ${runId} ORDER BY sequence`
  ).map((row) => row.diagnostic);
  expect(diagnostics, `The Run recorded workspace-missing.${where}`).not.toContain('workspace-missing');
  expect(diagnostics, `No Agent Workspace was ever created.${where}`).toContain('workspace-created');
  const [access] = await sql!<{ status: string; diagnostic: string | null }[]>`
    SELECT status, diagnostic FROM run_agent_execution WHERE run_id = ${runId}::uuid`;
  expect(access, `The agent phase never ran.${where}`).not.toBeUndefined();
  expect(access!.diagnostic, `The agent phase ended on workspace-missing.${where}`).not.toBe('workspace-missing');
  // The worker releases in a `finally` that runs AFTER the transaction which made the Run
  // terminal, so a read taken the instant the state flips can legitimately still say OPEN.
  // What must be true is that the workspace really is given back, and shortly — polling
  // for it is the assertion; asserting it once is a race.
  await expect
    .poll(
      async () => {
        const [row] = await sql!<{ status: string; mode: string }[]>`
          SELECT status, mode FROM run_workspace WHERE run_id = ${runId}::uuid`;
        return row ?? null;
      },
      { timeout: 60_000, intervals: [1_000], message: `The Agent Workspace was never released.${where}` },
    )
    // Local, because this worker holds no provider key. The two modes are not the same
    // guarantee, and this row is where a reader finds out which one this Run had.
    .toMatchObject({ mode: 'local', status: 'RELEASED' });
  const [workspace] = await sql!<{ workspace_id: string | null }[]>`
    SELECT workspace_id FROM run_workspace WHERE run_id = ${runId}::uuid`;
  expect(workspace!.workspace_id, `The workspace row names no provider session.${where}`).not.toBeNull();

  // (3) The sign-in really happened: a Session Step ACQUIRED against LoanCore's own form,
  // and a Step Execution for it.
  const [signInStep] = await sql!<{ state: string; attempts: number }[]>`
    SELECT state, attempts FROM run_session_step WHERE run_id = ${runId}::uuid AND action = 'sign-in'`;
  expect(signInStep, `LoanCore was never signed in to.${where}`).toMatchObject({ state: 'ACQUIRED' });
  const [counts] = await sql!<{ step_executions: number; observations: number }[]>`
    SELECT (SELECT count(*)::int FROM run_step_execution WHERE run_id = ${runId}::uuid) AS step_executions,
           (SELECT count(*)::int FROM run_observation WHERE run_id = ${runId}::uuid) AS observations`;
  expect(counts!.step_executions, `No Step Execution started.${where}`).toBeGreaterThan(0);

  // (4) Target inspection happened — the claim the rest of the journey exists to reach.
  const stop = await sql!<{ diagnostic: string | null }[]>`
    SELECT diagnostic FROM run_agent_work WHERE run_id = ${runId}::uuid`;
  expect(
    counts!.observations,
    `Target inspection produced no Observation. The agent work stage recorded ` +
      `"${stop[0]?.diagnostic ?? '(none)'}".${where}`,
  ).toBeGreaterThan(0);
  // And the agent really acted on the Target System, asserted directly rather than inferred
  // from an Observation count. The second half is the one that means inspection: the
  // sign-in is itself a performed agent `navigate`, so a bare count of performed agent
  // actions is satisfied before any record is looked at.
  const performed = (
    await sql!<{ action: string }[]>`
      SELECT action FROM run_tool_action
      WHERE run_id = ${runId}::uuid AND surface = 'agent' AND outcome = 'performed'`
  ).map((row) => row.action);
  expect(performed.length, `The agent performed no Tool Action.${where}`).toBeGreaterThan(0);
  expect(performed, `The agent never read an attribute from the account page.${where}`).toContain(
    'read-attribute',
  );

  // (5) The Run's own page says why it stopped, in words, and the Timeline counts the Step
  // Executions it really has.
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (state === 'COMPLETED') {
    // A stop reason is a statement that the Run did not conclude. On a Run that did, the
    // banner must not be there at all — the other half of "say why a Run stopped".
    await expect(
      page.getByText(STOP_REASON_TITLE, { exact: true }),
      `A completed Run claimed it had stopped.${where}`,
    ).toHaveCount(0);
  } else {
    const banner = page.getByText(STOP_REASON_TITLE, { exact: true });
    await expect(banner, `An Inconclusive Run said nothing about why it stopped.${where}`).toBeVisible();
    const sentence = await page.locator('.ls-banner').filter({ hasText: STOP_REASON_TITLE }).first().innerText();
    // Only a HYPHENATED name is ever a code word: the sentence for a check called
    // `declaration` legitimately contains the English word "declaration".
    const code = stop[0]?.diagnostic ?? '';
    if (code.includes('-')) {
      expect(sentence, `The stop reason printed the code word "${code}".${where}`).not.toContain(code);
    }
  }
  await attachAuthoringScreenshot(page, testInfo, 'owner-p1-run-detail');
  // (6) The accessibility floor, on the surface the owner was reading.
  await scan(page);

  await page.goto(`/runs/${runId}/timeline`);
  const listed = Math.min(counts!.step_executions, RUN_DETAIL_PAGE_SIZE);
  await expect(
    page.getByText(stepExecutionsListedSentence(listed, counts!.step_executions), { exact: true }),
    `The Timeline did not count the Step Executions the Run recorded.${where}`,
  ).toBeVisible();
  for (const empty of [NO_STEP_EXECUTIONS_ENDED_SENTENCE, NO_STEP_EXECUTIONS_PENDING_SENTENCE]) {
    await expect(page.getByText(empty, { exact: true })).toHaveCount(0);
  }
});
