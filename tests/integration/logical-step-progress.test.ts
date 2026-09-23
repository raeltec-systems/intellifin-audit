import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  PostgresProceduresUnitOfWork,
  RUN_DETAIL_PAGE_SIZE,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { logicalStepProgress } from '../../apps/web/src/runs/live-view.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Live View's Step counter, counted EXACTLY (UI cleanup 2026-09-22, UX-47).
 *
 * The chrome read "Step 7 of 6" after a pause and a resume: its numerator was the row
 * total of `run_step_execution`, which counts ATTEMPTS. The repair counts distinct plan
 * steps — and does it in SQL over every row, because the same rule applied to the bounded
 * page `readStepExecutions` returns would UNDER-report a long Run whose first page had not
 * reached a later plan step. This file seeds more attempts of the first step than a page
 * holds, and asserts both: that the exact read agrees with the pure rule in `live-view.ts`
 * over the same rows, and that the bounded page would have answered differently.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the exact logical step progress read', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-step-progress`;
  const procedureId = ids.next();
  const versionId = ids.next();
  const runId = ids.next();
  const PLAN = ['s1', 's2', 's3'];
  const FIRST_STEP_ATTEMPTS = RUN_DETAIL_PAGE_SIZE + 5;

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(new URL(url!).hostname)) {
      throw new Error('Step progress tests require an isolated database');
    }
    sql = createSqlClient(url!, { max: 4 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},${author},${author + '@test.invalid'})`;
    const row = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
                period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
              VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Step progress fixture',
                '2026-08-01','2026-08-31','QUEUED','STANDARD',${author},${author},'auditor','2026-09-01T09:00:00Z')`;
    const base = Date.parse('2026-09-01T09:00:00Z');
    let second = 0;
    const at = (): string => new Date(base + 1000 * second++).toISOString();
    // The first plan step, retried more times than a detail page holds.
    for (let attempt = 1; attempt <= FIRST_STEP_ATTEMPTS; attempt += 1) {
      await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
                VALUES(${ids.next()},${runId},'s1',NULL,'inspect-record','FAILED',${attempt},${at()})`;
    }
    // The second, interrupted by a pause and restarted by the resume: the shape that made
    // the counter pass its own denominator.
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,superseded_by)
              VALUES(${ids.next()},${runId},'s2',NULL,'capture-observation','SUPERSEDED',1,${at()},'resume')`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
              VALUES(${ids.next()},${runId},'s2',NULL,'capture-observation','SUCCEEDED',2,${at()})`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
              VALUES(${ids.next()},${runId},'s3',NULL,'evaluate-conditions','RUNNING',1,${at()})`;
    // A row naming a step this version does not declare cannot push the counter over.
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
              VALUES(${ids.next()},${runId},'not-in-the-plan',NULL,'inspect-record','SUCCEEDED',1,${at()})`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('counts distinct declared plan steps over every row, never attempts', async () => {
    const progress = await new DrizzleRunDetailRepository(db).readLogicalStepProgress(runId, PLAN);
    expect(progress).toEqual({ started: 3, units: 4, retries: FIRST_STEP_ATTEMPTS - 1 + 1 });
    expect(progress.started).toBeLessThanOrEqual(PLAN.length);
  });

  it('agrees with the rule in live-view.ts over the same rows, and the bounded page would not', async () => {
    const detail = new DrizzleRunDetailRepository(db);
    const all = await sql`SELECT plan_step_id, work_item_id, attempt FROM run_step_execution WHERE run_id=${runId}`;
    const rows = all.map((row) => ({
      planStepId: row.plan_step_id as string,
      workItemId: row.work_item_id as string | null,
      attempt: row.attempt as number,
    }));
    expect(await detail.readLogicalStepProgress(runId, PLAN)).toEqual(logicalStepProgress(rows, PLAN));
    // The same rule over the first page reaches only the first step: exactly the
    // under-report an exact count exists to prevent.
    const page = await detail.readStepExecutions(runId);
    expect(page.total).toBe(FIRST_STEP_ATTEMPTS + 4);
    expect(logicalStepProgress(page.rows, PLAN).started).toBe(1);
  });

  it('counts every distinct step when the plan could not be read, and none when it declares none', async () => {
    const detail = new DrizzleRunDetailRepository(db);
    expect((await detail.readLogicalStepProgress(runId, null)).started).toBe(4);
    expect((await detail.readLogicalStepProgress(runId, [])).started).toBe(0);
    expect(await detail.readLogicalStepProgress('not-a-run-id', PLAN)).toEqual({ started: 0, units: 0, retries: 0 });
  });
});
