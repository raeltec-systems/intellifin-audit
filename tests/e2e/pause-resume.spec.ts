import { captureStoryState } from './story-visual-capture';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { performPause, resumeLinker } from '@intellifin/application';
import type { ExecutablePlan } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresWaitRepository,
  readPendingResume,
  type Sql,
} from '@intellifin/infrastructure';

import { ESCALATION_PANEL_COPY, PAUSE_COPY } from '../../apps/web/src/design/copy';
import { planActionWord } from '../../apps/web/src/runs/labels';
import {
  PAUSE_WORDS,
  bannerHeldBeforeWords,
  bannerHeldInFlightWords,
  heldBeforeWords,
  heldInFlightWords,
  pauseStepNamer,
  pauseTitleWords,
  restartedWords,
  startedWords,
} from '../../apps/web/src/runs/pause-words';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { acquireControl, expectRunEvents, resumeWithControl } from './run-control';

/**
 * Pausing and resuming a Run, in a real browser (Story 5.4, FR-25, AD-16, UX-DR25).
 *
 * The SURFACE half is entirely real: the auditor's own session, the Server Actions, the
 * commands, PostgreSQL, the revision compare-and-set, the durable wake, and the Timeline.
 * The one thing standing in for production is the worker's Tool Action boundary — the
 * journey calls the SAME `performPause` the three stages call, through the same
 * `PostgresWaitRepository`, rather than starting a worker and racing it to a boundary. The
 * boundary itself (which marker it reads, what it supersedes, that the attempt is given
 * back, that a cancellation wins) is proven in `execute-agent-work-item.test.ts`,
 * `execute-agent-steps.test.ts` and `tests/integration/pause-run.test.ts`.
 *
 * Run rows are seeded, the `live-view.spec.ts` pattern: what is under test is the surface,
 * and the checkpoints are the truthful ones of a Run a worker is holding, so a concurrently
 * running worker spec's recovery sweeps cannot claim these Runs out from under it.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();

let sql: Sql;
let author = '';
let authorName = '';
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the pause journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id, name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the pause journey.');
  author = auditor.id as string;
  authorName = auditor.name as string;
  const version = activeRunVersion(procedureId, versionId, author);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of runs) await sql.begin(async tx => {
      // Retained command/renewal facts and their Run leave together. Lock the Run
      // first so late controller reads cannot invert cleanup lock ordering.
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await tx`DELETE FROM notification WHERE run_id=${runId}`;
      await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
      // The logical-step test seeds Step Executions (UX-47).
      await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      // The pause-linkage journey seeds the Work Item its second pause holds (Story 10.6).
      await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await tx`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await tx`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM run_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
      await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
    });
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

async function seedRun(state: 'RUNNING' | 'AWAITING_AUDITOR'): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Pause journey',
    ${`2026-08-${day}`},${`2026-08-${day}`},${state},'STANDARD',${author},'pause-fixture','auditor',${at})`;
  runs.push(runId);
  // The truthful checkpoints of a Run whose worker is holding it.
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  return runId;
}

/**
 * Where a stage's boundary holds the Run (Story 10.6, legacy 5.4). The default is the
 * boundary before the fixture plan's sign-in — ProdConsole's `session-3`, a Run-level
 * Session Step with no attempt in flight.
 */
type PauseHold = Parameters<typeof performPause>[1]['hold'];
const SIGN_IN_HOLD: PauseHold = { planStepId: 'session-3', workItemId: null, superseded: null };

/**
 * Exactly what a stage does at its next boundary, through the same repository. `inFlight`
 * is the Work Item whose attempt the pause supersedes: the existing `workItemId` key the
 * Work Item stage writes beside the hold (`execute-agent-work-item.ts`).
 */
async function honourPause(runId: string, hold: PauseHold = SIGN_IN_HOLD, inFlight: string | null = null): Promise<string> {
  return new PostgresWaitRepository(createDb(sql)).transaction(runId, async (context) => {
    const run = context.run!;
    const request = run.pauseRequest!;
    await context.saveRunState('PAUSED');
    const wait = await performPause(context as never, {
      run,
      request,
      waitId: ids.next(),
      at: new Date().toISOString(),
      hold,
      workItemId: inFlight,
    });
    return wait.waitId;
  });
}

/**
 * The worker starting the held step again after a resume (Story 10.6, legacy 5.4): a new
 * Step Execution and the stage's own attempt-start event. Which resume the attempt names is
 * decided by the stages' own linker over the stages' own read — `resumeLinker` and
 * `readPendingResume` — so the link under test is production's, not the fixture's.
 */
async function startResumedAttempt(runId: string, planStepId: string, registrationId: string, stepExecutionId: string, attempt: number): Promise<string | null> {
  const db = createDb(sql);
  const resumedWaitId = await resumeLinker()({ readPendingResume: () => readPendingResume(db, runId) }, { planStepId, workItemId: null });
  await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
    VALUES(${stepExecutionId},${runId},${planStepId},NULL,'sign-in','RUNNING',${attempt},${new Date().toISOString()})`;
  await new PostgresWaitRepository(db).transaction(runId, async (context) => {
    const run = context.run!;
    // The shape `execute-agent-steps.ts` appends for `sign-in-attempt-started`.
    await context.auditEvents.append({
      actor: { type: 'system', id: 'agent-worker' },
      eventType: 'lifecycle.agent-execution',
      source: 'worker',
      outcome: 'success',
      aggregateId: runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: {
        state: 'RUNNING',
        diagnostic: 'sign-in-attempt-started',
        attempts: attempt,
        attemptId: ids.next(),
        stepId: planStepId,
        registrationId,
        stepExecutionId,
        attempt,
        ...(resumedWaitId === null ? {} : { resumedWaitId }),
      },
    });
  });
  return resumedWaitId;
}

/**
 * The worker starting the held Work Item's inspection again after a resume: its Step
 * Execution and the stage's own `work-item-attempt-started` event, linked by the same
 * production linker over the same production read as `startResumedAttempt`.
 */
async function startResumedWorkItemAttempt(runId: string, planStepId: string, workItemId: string, stepExecutionId: string, attempt: number): Promise<string | null> {
  const db = createDb(sql);
  const resumedWaitId = await resumeLinker()({ readPendingResume: () => readPendingResume(db, runId) }, { planStepId, workItemId });
  await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
    VALUES(${stepExecutionId},${runId},${planStepId},${workItemId},'inspect-record','RUNNING',${attempt},${new Date().toISOString()})`;
  await new PostgresWaitRepository(db).transaction(runId, async (context) => {
    const run = context.run!;
    // The shape `execute-agent-work-item.ts` appends for `work-item-attempt-started`.
    await context.auditEvents.append({
      actor: { type: 'system', id: 'agent-worker' },
      eventType: 'lifecycle.agent-work',
      source: 'worker',
      outcome: 'success',
      aggregateId: runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: {
        state: 'RUNNING',
        diagnostic: 'work-item-attempt-started',
        attemptId: ids.next(),
        workItemId,
        nextTurn: 1,
        tokens: 0,
        reservedTokens: 0,
        stepExecutionId,
        attempt,
        ...(resumedWaitId === null ? {} : { resumedWaitId }),
      },
    });
  });
  return resumedWaitId;
}

/** Requests a pause through the control, clicking it only while it is enabled. */
async function requestPause(page: Page): Promise<void> {
  const enabled = page.locator(':not([aria-disabled="true"])');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Pause', exact: true }).and(enabled).click({ timeout: 5_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Pause Run', exact: true }).click();
  await expect(page.getByText(`Pause requested by ${authorName}`, { exact: false })).toBeVisible();
}

test.describe('pausing and resuming a Run', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('holds a Running Run, says who paused it and when it ends, and resumes it', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun('RUNNING');

    await page.goto(`/runs/${runId}`);
    await expect(page.getByRole('heading', { name: /^Run · / })).toBeVisible();
    // Every mutating control needs a focus-trapping dialog, which cannot exist without
    // script — so the marker says when the handlers are attached rather than racing them.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ends Inconclusive if it is still paused after 30 minutes', { exact: false })).toBeVisible();
    await captureStoryState(page, 'pause-confirmation', dialog);
    await dialog.getByRole('button', { name: 'Pause Run', exact: true }).click();

    // The REQUEST succeeded. It never claims the Run is paused: the worker does that. The
    // server's own banner says so once the page re-reads, and the control's transitional
    // "Pause requested." is gone by then (UI cleanup 2026-09-22, UX-49): this spec used to
    // require that sentence, which is how it came to stand beside a CONFIRMED "Paused by"
    // banner on the walkthrough's screen. The state that announced it has settled.
    // The PERSON, never the user id: the spec used to pin the id as the expected text.
    await expect(page.getByText(`Pause requested by ${authorName}`, { exact: false })).toBeVisible();
    await expect(page.getByText(PAUSE_COPY.requested, { exact: true })).toHaveCount(0);
    const [requested] = await sql`SELECT state, pause_requested_by FROM audit_run WHERE run_id=${runId}`;
    expect(requested).toMatchObject({ state: 'RUNNING', pause_requested_by: author });
    await captureStoryState(page, 'pause-requested');
    await page.reload();
    await expect(page.getByText(`Pause requested by ${authorName}`, { exact: false })).toBeVisible();

    // The worker's next Tool Action boundary.
    const waitId = await honourPause(runId);
    const [wait] = await sql`SELECT opened_by, opened_at, deadline FROM run_wait WHERE wait_id=${waitId}`;

    await page.reload();
    // EXPERIENCE.md's Run Detail / Paused banner, with the actor and both instants.
    await expect(page.getByText('Paused by', { exact: false })).toBeVisible();
    await expect(page.getByText('Resumes on your action; ends Inconclusive at', { exact: false })).toBeVisible();
    await expect(page.getByText(`Paused by ${authorName} at`, { exact: false })).toBeVisible();
    await expect(page.locator('.ls-banner__title', { hasText: author })).toHaveCount(0);
    // Resume REPLACES Pause on a Paused Run.
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);

    const paused = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(paused.violations).toEqual([]);
    await captureStoryState(page, 'pause-detail-legacy-hold');

    // Live View carries the same control and the same banner.
    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    await expect(page.getByText('Session PAUSED.', { exact: false })).toBeVisible();
    await expect(page.getByText('Paused by', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const live = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(live.violations).toEqual([]);
    await captureStoryState(page, 'pause-live-legacy-hold');

    // v1.1 requires current controller ownership and explicit confirmation on every surface.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await expect(page.getByRole('button', { name: 'Acquire control', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    await acquireControl(page.getByRole('region', { name: 'Run controller', exact: true }));
    // Acquisition can trigger a live refresh between the controller message and
    // activation; `resumeWithControl` clicks only enabled controls, and again only while
    // the click has not yet taken effect.
    await resumeWithControl(page);
    // The page re-reads a Running Run: Pause is offered again, the Paused banner is gone,
    // and so is the control's transitional "Run resumed." — the state it announced has
    // settled and the page says so itself (UX-49).
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByText('Paused by', { exact: false })).toHaveCount(0);
    await expect(page.getByText(PAUSE_COPY.resumed, { exact: true })).toHaveCount(0);

    const [resumed] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(resumed).toMatchObject({ state: 'RUNNING' });
    const [closed] = await sql`SELECT closure_kind, answer_option_id, actor FROM run_wait WHERE wait_id=${waitId}`;
    // `resume`, never `answer`: generation 45 refuses the other pairing outright.
    expect(closed).toMatchObject({ closure_kind: 'resume', answer_option_id: 'resume', actor: author });
    const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    // This page still holds control, so lease renewals are set apart (`expectRunEvents`).
    expectRunEvents(events.map((row) => String(row.event_type)), [
      'lifecycle.run-pause-requested',
      'lifecycle.run-paused',
      'lifecycle.run-control-lease-acquired',
      'lifecycle.run-resumed',
    ]);
    // The pause is over, so the Run has no open wait and Pause is offered again.
    expect(new Date(wait!.deadline as string).getTime() - new Date(wait!.opened_at as string).getTime()).toBe(30 * 60 * 1000);
    await page.goto(`/runs/${runId}`);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  // UI cleanup 2026-09-22, UX-47. After a pause and a resume the chrome read "Step 7 of 6":
  // its numerator was the number of Step Execution ROWS, and a pause supersedes the attempt
  // in flight while the resume starts another. This walks pause -> resume -> complete through
  // the real controls and reads the counter at every stage; the numerator counts LOGICAL
  // plan steps and can never pass the plan's own step count.
  test('counts logical steps, so pause, resume and completion never take the counter past its denominator', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun('RUNNING');
    const [version] = await sql`SELECT compiled_plan FROM procedure_version WHERE version_id=${versionId}`;
    const plan = version!.compiled_plan as {
      sessionSteps: { id: string }[];
      targetSystems: { planSteps: { id: string }[] }[];
    };
    const stepIds = [...plan.sessionSteps.map((step) => step.id), ...plan.targetSystems.flatMap((target) => target.planSteps.map((step) => step.id))];
    expect(stepIds.length).toBeGreaterThan(1);
    const counter = page.locator('.ls-session__counter');
    const expectWithin = async (started: number): Promise<void> => {
      await expect(counter).toHaveText(`Step ${started} of ${stepIds.length}`);
    };
    const at = (offset: number): string => new Date(Date.now() + offset * 1000).toISOString();

    // The attempt the pause will interrupt.
    const interrupted = ids.next();
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${interrupted},${runId},${stepIds[0]!},NULL,'inspect-record','RUNNING',1,${at(0)})`;
    await page.goto(`/runs/${runId}/live`);
    await expectWithin(1);

    // Pause through the control, and honour it at the worker's boundary, which supersedes
    // the attempt in flight exactly as `lifecycleBoundary` does.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pause Run', exact: true }).click();
    await expect(page.getByText(`Pause requested by ${authorName}`, { exact: false })).toBeVisible();
    await honourPause(runId);
    await sql`UPDATE run_step_execution SET state='SUPERSEDED', superseded_by='resume', completed_at=${at(1)} WHERE step_execution_id=${interrupted}`;
    await page.reload();
    await expect(page.getByText('Session PAUSED.', { exact: false })).toBeVisible();
    await expectWithin(1);

    // Resume through the control; the Run restarts the step as a NEW attempt and goes on to
    // run every other step of the plan. v1.1 requires current controller ownership and an
    // explicit confirmation, exactly as the journey above walks it.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await expect(page.getByRole('button', { name: 'Acquire control', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    await acquireControl(page.getByRole('region', { name: 'Run controller', exact: true }));
    await resumeWithControl(page);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at)
      VALUES(${ids.next()},${runId},${stepIds[0]!},NULL,'inspect-record','SUCCEEDED',2,${at(2)},${at(3)})`;
    for (const [index, stepId] of stepIds.slice(1).entries()) {
      await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at)
        VALUES(${ids.next()},${runId},${stepId},NULL,'inspect-record','SUCCEEDED',1,${at(4 + index)},${at(5 + index)})`;
    }
    // One more ROW than the plan has steps: the arithmetic the old counter did.
    expect((await sql`SELECT count(*)::int AS n FROM run_step_execution WHERE run_id=${runId}`)[0]!.n).toBe(stepIds.length + 1);
    await page.reload();
    await expectWithin(stepIds.length);

    // Complete: the package, the Result, then the state (generations 21 and 25).
    const sealedAt = at(60);
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
      VALUES(${runId},'SEALED','COMPLETED',${sealedAt},0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
      VALUES(${runId},1,'PASS','pass',true,'COMPLETED',true,${sealedAt},'Scope sentence',
      ${'{"statement":"x","population":{"rowsParsed":0,"included":0,"excluded":0,"indeterminate":0},"period":{"from":"2026-01-01","to":"2026-01-31"},"exclusions":[],"coverage":[],"conditions":[],"controlFields":[],"exceptions":{"total":0,"records":[]},"unevaluated":{"total":0,"records":[]},"gate":{"passed":true,"checks":20,"failed":[]},"evidence":{"state":"SEALED","requiredTotal":0,"registered":0,"missingRequired":0,"abandoned":0}}'}::jsonb)`;
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
    await page.reload();
    await expectWithin(stepIds.length);
    // The retry is said beside the counter where a step is running; it is never IN it.
    await expect(counter).not.toContainText(String(stepIds.length + 1));
  });

  // Story 10.6, legacy 5.4: "Given a Run paused and resumed more than once, when its
  // Timeline is read, then each pause and each resume names its exact plan step and Step
  // Execution attempt from durable records, and a resume names the attempt it starts."
  //
  // Each pause is held where a stage really holds one. The sign-in stage pauses only
  // BETWEEN units, before a sign-in, with nothing in flight (`execute-agent-steps.ts`). The
  // Work Item stage pauses MID-ATTEMPT, supersedes the attempt and gives it back, so the
  // attempt its resume restarts carries the same number and only the Step Execution tells
  // the two apart (`execute-agent-work-item.ts`).
  test('names where each pause held the Run and the attempt each resume started, over two pauses and two resumes', async ({ page }) => {
    test.setTimeout(240_000);
    const runId = await seedRun('RUNNING');
    const [version] = await sql`SELECT compiled_plan FROM procedure_version WHERE version_id=${versionId}`;
    const plan = version!.compiled_plan as ExecutablePlan;
    const signIn = plan.sessionSteps.find((step) => step.action === 'sign-in')!;
    const inspect = plan.targetSystems[0]!.planSteps.find((step) => step.action === 'inspect-record')!;
    const system = plan.inputs.targets[0]!;
    // The page's one Work Item. A P-4 Run inspects one page, so its Work Item has no record
    // of its own (subject key NULL, as `agent-prodconsole.ts` writes it).
    const item = { workItemId: ids.next(), subjectKey: null };
    const name = pauseStepNamer(plan, new Map());
    const signInStep = name.step(signIn.id, null);
    const inspectStep = name.step(inspect.id, item);
    // A step is named by its action and its system, never by the plan's identifier for it,
    // and a Work Item with no record of its own gains no dangling "for".
    expect(signInStep).toContain(planActionWord('sign-in'));
    expect(signInStep).toContain(system.displayName);
    expect(signInStep).not.toContain(signIn.id);
    expect(inspectStep).toContain(system.displayName);
    expect(inspectStep).not.toContain(' for ');

    // Pause 1, between units: requested through the control and honoured before the
    // sign-in, with no attempt in flight.
    await page.goto(`/runs/${runId}/live`);
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await requestPause(page);
    const firstWait = await honourPause(runId, { planStepId: signIn.id, workItemId: null, superseded: null });

    // The Paused banner says where the Run is held, and that nothing was in flight.
    await page.reload();
    const banner = page.locator('.ls-banner', { hasText: `Paused by ${authorName}` });
    await expect(banner).toContainText(bannerHeldBeforeWords(signInStep));
    await expect(banner).toContainText(PAUSE_WORDS.noStepInFlight);
    // And what Resume does here: it STARTS the held step, which never began.
    await expect(banner).toContainText(PAUSE_WORDS.resumeStarts);
    await captureStoryState(page, 'pause-before-step', banner);

    // Resume 1, through the controls, and the worker's first sign-in attempt names it.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await acquireControl(page.getByRole('region', { name: 'Run controller', exact: true }));
    await resumeWithControl(page);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const signingIn = ids.next();
    expect(await startResumedAttempt(runId, signIn.id, system.registrationId, signingIn, 1)).toBe(firstWait);
    await sql`UPDATE run_step_execution SET state='SUCCEEDED', completed_at=${new Date().toISOString()} WHERE step_execution_id=${signingIn}`;

    // The Run advances to the page's inspection: its Work Item, and the attempt in flight.
    const interrupted = ids.next();
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,subject_key,
      state,attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${item.workItemId},${runId},${inspect.id},1,${system.registrationId},${system.displayName},${item.subjectKey},
      'IN_PROGRESS',1,0,NULL,NULL,0)`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${interrupted},${runId},${inspect.id},${item.workItemId},'inspect-record','RUNNING',1,${new Date().toISOString()})`;

    // Pause 2, mid-attempt: the Work Item stage's boundary supersedes the attempt and gives
    // it back, because a person pausing is not the agent failing.
    await page.reload();
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await requestPause(page);
    const secondWait = await honourPause(runId,
      { planStepId: inspect.id, workItemId: item.workItemId, superseded: { stepExecutionId: interrupted, attempt: 1 } },
      item.workItemId);
    await sql`UPDATE run_step_execution SET state='SUPERSEDED', superseded_by='resume', completed_at=${new Date().toISOString()} WHERE step_execution_id=${interrupted}`;
    await sql`UPDATE run_work_item SET attempts=0 WHERE work_item_id=${item.workItemId}`;

    // The banner names the attempt this pause superseded, and that Resume restarts it.
    await page.reload();
    await expect(banner).toContainText(bannerHeldInFlightWords(inspectStep, 1));
    await expect(banner.locator(`[title="${interrupted}"]`)).toBeVisible();
    await expect(banner).toContainText(PAUSE_WORDS.resumeRestarts);
    await captureStoryState(page, 'pause-in-flight', banner);

    // The Timeline: both pauses, in order, each with where it held the Run and how it ended.
    await page.goto(`/runs/${runId}/timeline`);
    const history = page.getByRole('region', { name: PAUSE_WORDS.heading });
    await expect(history).toBeVisible();
    const entries = history.locator('.ls-pause-history__entry');
    await expect(entries).toHaveCount(2);
    const first = entries.nth(0);
    await expect(first.getByRole('heading', { name: pauseTitleWords(1), exact: true })).toBeVisible();
    await expect(first).toContainText(`Paused by ${authorName} at`);
    await expect(first).toContainText(heldBeforeWords(signInStep));
    await expect(first).toContainText(PAUSE_WORDS.noStepInFlight);
    await expect(first).toContainText(`Resumed by ${authorName} at`);
    // The sign-in never began before this pause, so the resume STARTED it.
    await expect(first).toContainText(startedWords(signInStep, 1));
    await expect(first).not.toContainText('It restarted');
    await expect(first.locator(`[title="${signingIn}"]`)).toBeVisible();
    const second = entries.nth(1);
    await expect(second.getByRole('heading', { name: pauseTitleWords(2), exact: true })).toBeVisible();
    await expect(second).toContainText(heldInFlightWords(inspectStep, 1));
    await expect(second.locator(`[title="${interrupted}"]`)).toBeVisible();
    await expect(second).toContainText(PAUSE_WORDS.stillPaused);
    // The banner on the same page names the second pause's hold, in the present tense.
    await expect(banner).toContainText(bannerHeldInFlightWords(inspectStep, 1));
    // A person, never a user id.
    await expect(history).not.toContainText(author);
    const whilePaused = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(whilePaused.violations).toEqual([]);
    await captureStoryState(page, 'pause-timeline-held', history);

    // Resume 2, through the controls, and the worker restarts the page's inspection. The
    // attempt was given back, so the restart is attempt 1 again, in a new Step Execution.
    await page.goto(`/runs/${runId}/live`);
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await acquireControl(page.getByRole('region', { name: 'Run controller', exact: true }));
    await resumeWithControl(page);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const restarted = ids.next();
    expect(await startResumedWorkItemAttempt(runId, inspect.id, item.workItemId, restarted, 1)).toBe(secondWait);

    // Both resumes now name the attempt each started.
    await page.goto(`/runs/${runId}/timeline`);
    await expect(second).toContainText(`Resumed by ${authorName} at`);
    await expect(second).toContainText(restartedWords(inspectStep, 1));
    await expect(second.locator(`[title="${restarted}"]`)).toBeVisible();
    await expect(second).not.toContainText(PAUSE_WORDS.stillPaused);
    // The Run is no longer paused, so no banner says where a pause holds it.
    await expect(banner).toHaveCount(0);
    const afterResume = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(afterResume.violations).toEqual([]);
    await captureStoryState(page, 'pause-timeline-resumed', history);

    // The durable facts the surface read, by identity: each pause's own event, and each
    // restarted attempt's start event naming the wait of the pause its resume closed.
    const pauses = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-paused' ORDER BY sequence`;
    expect(pauses.map((row) => row.payload)).toEqual([
      expect.objectContaining({ waitId: firstWait, planStepId: signIn.id }),
      expect.objectContaining({
        waitId: secondWait, planStepId: inspect.id, heldWorkItemId: item.workItemId,
        workItemId: item.workItemId, stepExecutionId: interrupted, attempt: 1,
      }),
    ]);
    expect(pauses[0]!.payload).not.toHaveProperty('stepExecutionId');
    expect(pauses[0]!.payload).not.toHaveProperty('heldWorkItemId');
    const [linkedFirst] = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND payload->>'resumedWaitId'=${firstWait}`;
    expect(linkedFirst!.payload).toMatchObject({ stepExecutionId: signingIn, attempt: 1 });
    const [linkedSecond] = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND payload->>'resumedWaitId'=${secondWait}`;
    expect(linkedSecond!.payload).toMatchObject({ stepExecutionId: restarted, workItemId: item.workItemId, attempt: 1 });
  });

  test('disables Pause on a Run waiting on an answer, and says why in words', async ({ page }) => {
    const runId = await seedRun('AWAITING_AUDITOR');
    await page.goto(`/runs/${runId}`);

    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    // `aria-disabled`, never `disabled`: a disabled element cannot be focused, so its
    // reason would be unreachable by keyboard — the tooltip-only explanation DESIGN.md
    // forbids. The reason is also rendered visibly.
    await expect(pause).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(ESCALATION_PANEL_COPY.pauseUnavailable, { exact: false }).first()).toBeVisible();

    // Refused at the command as well, not only hidden on the surface.
    await pause.click({ force: true });
    const [row] = await sql`SELECT state, pause_requested_at FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'AWAITING_AUDITOR', pause_requested_at: null });

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
