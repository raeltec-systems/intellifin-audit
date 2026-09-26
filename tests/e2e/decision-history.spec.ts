import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { answerEscalation, ESCALATION_OPTION_IDS, MARK_AMBIGUOUS_OPTION, raiseEscalation, type Clock } from '@intellifin/application';
import { classifyPlanTargets, sha256HexOfBytes, type ExecutablePlan } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { UNTRUSTED_CONTENT_SENTENCE, fillTemplate } from '../../apps/web/src/design/copy';
import { readableStamp } from '../../apps/web/src/design/time';
import { ESCALATION_ANSWER_WORDS, ESCALATION_REPLAY_WORDS, escalationRaiseSentences } from '../../apps/web/src/runs/decision-words';
import { pauseStepNamer } from '../../apps/web/src/runs/pause-words';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * An answered Escalation is an entry on the Execution Timeline (Story 10.10, legacy 4.8 AC 4
 * and 5.6 AC 3), in a real browser.
 *
 * Every decision is made by the REAL commands — `raiseEscalation` and `answerEscalation`,
 * the second one ending the Run through the one cancellation path when the answer is Abort —
 * over a Run whose capture chain is the one the agent path writes: a Work Item, its Step
 * Executions, Tool Actions that name no Work Item of their own, the screenshots Replay plays
 * and the Structural Snapshot the question named. The page is what is under test: the entry,
 * its words, its keyboard reach, and the Replay link opening at the Escalation's own frame.
 *
 * The frame BYTES are not: a frame read needs a worker-signed grant, and `replay.spec.ts`
 * proves that path with a real worker. Here the frame route is answered in the browser with
 * a one-pixel PNG, so this spec leaves no grant or queue row behind.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** The candidate text the Audit Agent wrote, markup and all: it must reach the page inert. */
const CANDIDATE = '<b>Ada Musonda</b> (second account)';
const SUBJECT = 'E-000102';

let sql: Sql;
let db: Database;
let author = '';
let authorName = '';
let plan: ExecutablePlan;
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the decision history journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id, name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the decision history journey.');
  author = String(auditor.id);
  authorName = String(auditor.name);
  const version = activeRunVersion(procedureId, versionId, author);
  plan = version.compiledPlan!;
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of runs) await sql.begin(async (tx) => {
      // The Run first, then everything it owns, in ONE transaction: the seal before what it
      // sealed, the capture bindings before the actions and Evidence they name.
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await tx`DELETE FROM notification WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result WHERE run_id=${runId}`;
      await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
      await tx`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
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

interface Seeded {
  readonly runId: string;
  readonly inspect: string;
  readonly workItemId: string;
  readonly frames: readonly string[];
  /** The choose-candidate Escalation, answered with the second candidate. */
  readonly chose: string;
  /** The retry-or-skip Escalation, answered Abort, which ended the Run. */
  readonly aborted: string;
}

/**
 * A Run that captured three screens of one record, was asked which candidate it had found
 * (the question naming the snapshot captured with the second screen), and was then aborted
 * by a second answer after the third screen.
 */
async function seedDecisions(): Promise<Seeded> {
  const runId = ids.next();
  const at = Date.now() - 10 * 60_000;
  const stamp = (seconds: number): string => new Date(at + seconds * 1_000).toISOString();
  const clock = (seconds: number): Clock => ({ now: () => new Date(at + seconds * 1_000) });
  const target = classifyPlanTargets(plan).agents[0]!;
  const inspect = target.stepId;
  const registrationId = target.target.registrationId;
  const day = String(runs.length + 1).padStart(2, '0');

  // The Run and the checkpoints a Run a worker is holding really has, in ONE transaction, so
  // a recovery sweep of any worker still running cannot claim it as abandoned.
  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Decision history journey',
      ${`2026-06-${day}`},${`2026-06-${day}`},'RUNNING','STANDARD',${author},'decision-history-e2e','auditor',${stamp(0)})`;
    await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${stamp(0)},${stamp(0)},${LEASE},'session-1',${ids.next()})`;
    await tx`INSERT INTO run_agent_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${stamp(0)},${stamp(0)},${stamp(0)},${LEASE},${ids.next()})`;
  });
  runs.push(runId);

  const workItemId = ids.next();
  await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,
      state,attempts,cycles,diagnostic,evidence_id,observations)
    VALUES(${workItemId},${runId},${inspect},1,${SUBJECT},${registrationId},'ProdConsole','OBSERVED',1,0,NULL,NULL,0)`;

  // Three screens, one Step Execution and one Tool Action each. The Tool Action names no
  // Work Item of its own, so the owner is found through the Step Execution first.
  const frames = [ids.next(), ids.next(), ids.next()];
  const actions: string[] = [];
  for (const [index, evidenceId] of frames.entries()) {
    const stepExecutionId = ids.next();
    const toolActionId = ids.next();
    actions.push(toolActionId);
    const location = `https://prodconsole.invalid/records/${SUBJECT}/${index + 1}`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},${inspect},${workItemId},'inspect-record','SUCCEEDED',1,${stamp(index * 10)})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      VALUES(${toolActionId},${runId},${stepExecutionId},NULL,'agent',${registrationId},'read-attribute','GET',
        ${location},'[]'::jsonb,'performed',200,false,0,${stamp(index * 10)},${stamp(index * 10 + 1)},'PERMITTED')`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
        state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${runId},'screenshot',${registrationId},${`screenshot/${runId}/${evidenceId}`},'image/png',
        ${sha256HexOfBytes(new Uint8Array(PNG))},${PNG.byteLength},'REGISTERED',false,${stamp(index * 10)},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${runId},${toolActionId},${location})`;
  }
  // The Structural Snapshot captured with the second screen: the Evidence the question names.
  const snapshotId = ids.next();
  await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
    VALUES(${snapshotId},${runId},'structural-snapshot',${registrationId},${`snapshot/${runId}/${snapshotId}`},
      'application/vnd.intellifin.web-tree+json',${'e'.repeat(64)},64,'REGISTERED',false,${stamp(10)},'agent','registration','evidence')`;
  await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
    VALUES(${snapshotId},${runId},${actions[1]!},${`https://prodconsole.invalid/records/${SUBJECT}/2`})`;

  // Raised between the second and third screens, and answered with the second candidate.
  const repository = new PostgresWaitRepository(db);
  const choseRaised = await raiseEscalation({ repository, ids, clock: clock(15) }, {
    runId,
    kind: 'choose-candidate',
    options: [{ id: 'candidate-1', label: 'Ada Musonda' }, { id: 'candidate-2', label: CANDIDATE }, MARK_AMBIGUOUS_OPTION],
    stepId: inspect,
    supportingEvidenceIds: [snapshotId],
  });
  if (!choseRaised.ok) throw new Error(`The fixture could not raise its first Escalation: ${choseRaised.reason}`);
  await answer(runId, choseRaised.wait.waitId, 'candidate-2', clock(16));

  // Raised after the third screen with no Evidence of its own, and aborted: the answer's own
  // command ends the Run through the one cancellation path.
  const abortRaised = await raiseEscalation({ repository, ids, clock: clock(25) }, { runId, kind: 'retry-or-skip', stepId: inspect });
  if (!abortRaised.ok) throw new Error(`The fixture could not raise its second Escalation: ${abortRaised.reason}`);
  await answer(runId, abortRaised.wait.waitId, ESCALATION_OPTION_IDS.abort, clock(26));
  // The Run has ended, so its agent phase has too: a live claim on a terminal Run is a
  // state no worker leaves behind.
  await sql`UPDATE run_agent_execution SET status='TERMINAL' WHERE run_id=${runId}`;
  return { runId, inspect, workItemId, frames, chose: choseRaised.wait.waitId, aborted: abortRaised.wait.waitId };
}

async function answer(runId: string, waitId: string, answerOptionId: string, clock: Clock): Promise<void> {
  const [run] = await sql`SELECT revision FROM audit_run WHERE run_id=${runId}`;
  const answered = await answerEscalation(
    { repository: new PostgresWaitRepository(db), roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock },
    { session: { userId: author, sessionId: 'decision-history-e2e' }, request: { runId, waitId, expectedRunRevision: Number(run!.revision), answerOptionId } },
  );
  if (!answered.ok) throw new Error(`The fixture could not answer its Escalation: ${answered.code}`);
}

/** When the wait row says the answer was given, as the canonical instant the page renders. */
async function answeredAt(waitId: string): Promise<string> {
  const [row] = await sql<{ closed_at: string }[]>`
    SELECT to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at FROM run_wait WHERE wait_id=${waitId}`;
  return row!.closed_at;
}

/** Replay's own note under the session bar: what the link opened it at, or why it could not. */
function replayNote(page: Page) {
  return page.locator('.ls-session > p[role="status"]');
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('the decisions a Run recorded, on the Execution Timeline', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('lists each answered Escalation — the answer, who gave it, when, where it was raised — and opens it on Replay from the keyboard', async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seedDecisions();
    const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${seeded.runId}`;
    expect(run).toMatchObject({ state: 'CANCELED' });
    // The frame bytes are `replay.spec.ts`'s subject; here they are answered in the browser.
    await page.route('**/api/runs/*/frames/*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));

    await page.goto(`/runs/${seeded.runId}/timeline`);
    const answers = page.getByRole('region', { name: ESCALATION_ANSWER_WORDS.heading, exact: true });
    await expect(answers).toBeVisible();
    await expect(answers).toContainText(ESCALATION_ANSWER_WORDS.intro);
    const entries = answers.locator('.ls-escalation-answers__entry');
    await expect(entries).toHaveCount(2);
    const name = pauseStepNamer(plan, new Map());

    // The candidate answer: its position among the candidates offered, the candidate's own
    // text only inside the untrusted box, and the record the question's Evidence reaches.
    const chose = entries.nth(0);
    await expect(chose).toHaveAttribute('data-wait-id', seeded.chose);
    await expect(chose.getByRole('heading', { level: 3, name: 'Choose candidate', exact: true })).toBeVisible();
    await expect(chose).toContainText(`Answered by ${authorName} at ${readableStamp(await answeredAt(seeded.chose))}.`);
    await expect(chose).toContainText(fillTemplate(ESCALATION_ANSWER_WORDS.candidate, { n: '2', m: '2' }));
    await expect(chose.locator('.ls-untrusted__body')).toHaveText(CANDIDATE);
    await expect(chose.locator('.ls-untrusted b')).toHaveCount(0);
    const established = escalationRaiseSentences(
      { kind: 'recorded', planStepId: seeded.inspect, workItem: { workItemId: seeded.workItemId, subjectKey: SUBJECT } },
      name,
    ).join(' ');
    expect(established).toContain(SUBJECT);
    await expect(chose).toContainText(established);
    await expect(chose).not.toContainText(ESCALATION_ANSWER_WORDS.workItemNotRecorded);

    // The Abort: the platform's own words, and the consequence its own event records.
    const aborted = entries.nth(1);
    await expect(aborted).toHaveAttribute('data-wait-id', seeded.aborted);
    await expect(aborted.getByRole('heading', { level: 3, name: 'Retry or skip', exact: true })).toBeVisible();
    await expect(aborted).toContainText(`Answered by ${authorName} at ${readableStamp(await answeredAt(seeded.aborted))}.`);
    await expect(aborted).toContainText(`${fillTemplate(ESCALATION_ANSWER_WORDS.option, { option: 'Abort' })} ${ESCALATION_ANSWER_WORDS.aborted}`);
    // A raise that named no Evidence names its step and says its record was not recorded.
    await expect(aborted).toContainText(escalationRaiseSentences({ kind: 'recorded', planStepId: seeded.inspect, workItem: null }, name).join(' '));

    // The policy is said once for the section, and a person is named, never an id.
    await expect(answers.getByText(UNTRUSTED_CONTENT_SENTENCE, { exact: false })).toHaveCount(1);
    await expect(answers).not.toContainText(author);
    await scan(page);

    // Reached from the keyboard, the entry's link opens Replay at the Escalation's own target:
    // the last screen captured before it was raised — the second of three.
    const link = chose.getByRole('link', { name: ESCALATION_ANSWER_WORDS.openInReplay, exact: true });
    await expect(link).toHaveAttribute('href', `/runs/${seeded.runId}/replay?escalation=${seeded.chose}`);
    await expect(aborted.getByRole('link', { name: ESCALATION_ANSWER_WORDS.openInReplay, exact: true }))
      .toHaveAttribute('href', `/runs/${seeded.runId}/replay?escalation=${seeded.aborted}`);
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/runs/${seeded.runId}/replay\\?escalation=${seeded.chose}$`));
    // The note is Replay's own status line; the stage beside it shows the frame.
    await expect(replayNote(page)).toHaveText(fillTemplate(ESCALATION_REPLAY_WORDS.opened, { kind: 'Choose candidate' }));
    await expect(page.getByText('Frame 2 of 3')).toBeVisible();
    await expect(page.locator('.ls-session__frame')).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[1]}`);
    await scan(page);

    // The Abort was raised after the third screen, so its target is the third.
    await page.goto(`/runs/${seeded.runId}/replay?escalation=${seeded.aborted}`);
    await expect(replayNote(page)).toHaveText(fillTemplate(ESCALATION_REPLAY_WORDS.opened, { kind: 'Retry or skip' }));
    await expect(page.getByText('Frame 3 of 3')).toBeVisible();

    // An Escalation this Run does not hold opens no screen at all, and says so — and points
    // at the "Jump to" list, which here holds recorded targets to choose.
    await page.goto(`/runs/${seeded.runId}/replay?escalation=${ids.next()}`);
    await expect(replayNote(page)).toHaveText(`${ESCALATION_REPLAY_WORDS.unavailable} ${ESCALATION_REPLAY_WORDS.chooseTarget}`);
    await expect(page.locator('.ls-session__frame')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Jump to' }).getByRole('button').first()).toBeVisible();
  });
});
