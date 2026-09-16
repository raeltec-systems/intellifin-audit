import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRunOverviewRepository,
  DrizzleSubmittedVersionReader,
  PostgresProceduresUnitOfWork,
  RUN_ATTENTION_LIMIT,
  SUBMITTED_VERSION_LIMIT,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * The Overview's and the Procedures list's reads, against a real PostgreSQL 18
 * (owner findings RUN-04 and RUN-05, 2026-09-16).
 *
 * All three are pure SQL — a state filter with an exact count beside a bounded page, a
 * `DISTINCT ON` over the Runs list's own total order, and a lateral read of one decision
 * out of a `jsonb` array — and none of that is exercised by a component test. The rows are
 * written HERE with raw SQL on purpose: what is under test is what the READ answers about
 * rows that already exist, and driving a whole Run to produce them would test the
 * execution stages instead. That is `run-surfaces.test.ts`'s shape, and the teardown below
 * is its teardown, in its order.
 *
 * Two of the three reads are over the WHOLE table, so nothing here asserts a global total:
 * `run-surfaces.test.ts` learned that a bounded read plus a post-filter is a test the other
 * 43 files can break. This file's own rows are dated LATE on purpose, so a globally
 * ordered, bounded read puts them first whatever else the database is holding, and the
 * totals are asserted as floors rather than as equalities.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the Overview and Procedure card reads', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-overview-reads`;
  const procedureId = ids.next();
  const versionId = ids.next();
  /** A Procedure id no Run names. The read touches `audit_run` only, so no row is needed. */
  const procedureWithNoRun = ids.next();
  const submittedVersions = { first: ids.next(), second: ids.next() };
  const runs = {
    completed: ids.next(),
    inconclusive: ids.next(),
    failed: ids.next(),
    queued: ids.next(),
  };

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(new URL(url!).hostname)) {
      throw new Error('Overview read tests require an isolated database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},${author},${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const row = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });

    // Two versions awaiting a manager's decision, written raw: what is under test is the
    // read, and the submitted-at and the actor come out of the version's own immutable
    // decision record rather than from a column.
    await insertSubmitted(submittedVersions.first, 2, '2026-12-30T09:00:00.000Z');
    await insertSubmitted(submittedVersions.second, 3, '2026-12-31T09:00:00.000Z');

    // Order matters. Generation 21 FREEZES a Run's Evidence once its package is sealed and
    // generations 21/25 refuse a Run REACHING a terminal state with no package and no
    // Result, so every Run is inserted QUEUED and sealed into its terminal state after.
    await insertRun(runs.completed, '2026-08-01', '2026-08-31', '2026-12-31T09:00:00.000Z');
    await terminate(runs.completed, 'COMPLETED');

    await insertRun(runs.inconclusive, '2026-07-01', '2026-07-31', '2026-12-31T09:01:00.000Z');
    await terminate(runs.inconclusive, 'INCONCLUSIVE');

    await insertRun(runs.failed, '2026-06-01', '2026-06-30', '2026-12-31T09:02:00.000Z');
    await terminate(runs.failed, 'RUN_FAILED');

    // The newest Run of this Procedure, and still in flight: the card must describe it
    // rather than the terminal Run before it, or a Procedure that is running right now
    // reports its previous outcome as current.
    await insertRun(runs.queued, '2026-05-01', '2026-05-31', '2026-12-31T09:03:00.000Z');
  });

  async function insertSubmitted(versionId: string, versionNumber: number, at: string): Promise<void> {
    const decisions = JSON.stringify([
      {
        schemaVersion: 1,
        actorId: author,
        occurredAt: at,
        priorState: 'DRAFT',
        decision: 'submit',
        rationale: null,
        aggregateRevision: 'a'.repeat(64),
      },
    ]);
    const authorship = JSON.stringify({
      createdBy: { type: 'human', id: author },
      responsibleAuthorId: author,
      humanAuthorIds: [author],
    });
    // `compliance_conditions` carries one condition because `procedure_version_compliance_shape`
    // requires 1..32 — an empty array is exactly the row that CHECK exists to refuse, and the
    // reader under test does not read the conditions at all.
    // `::text::jsonb`, never `sql.json`: drizzle rewrites the wrapped client's jsonb
    // serializer to the identity, so `sql.json` throws and a bare `::jsonb` double-encodes.
    await sql`INSERT INTO procedure_version(version_id,procedure_id,version_number,state,control_name,template_id,
                sections,compliance_conditions,decisions,authorship)
              VALUES(${versionId},${procedureId},${versionNumber},'SUBMITTED','Overview reads fixture','P-2',
                '[]'::jsonb,'[{"conditionId":"C1"}]'::jsonb,${decisions}::text::jsonb,${authorship}::text::jsonb)`;
  }

  async function insertRun(runId: string, from: string, to: string, at: string): Promise<void> {
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
                period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
              VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Overview reads fixture',
                ${from},${to},'QUEUED','STANDARD',${author},${author},'auditor',${at})`;
  }

  /** Package, Result, then state — the order production commits them in. */
  async function terminate(runId: string, state: 'COMPLETED' | 'INCONCLUSIVE' | 'RUN_FAILED'): Promise<void> {
    const at = '2026-12-31T10:00:00.000Z';
    const outcome = state === 'COMPLETED' ? 'PASS' : state;
    const outcomeRow = state === 'COMPLETED' ? 'pass' : state === 'RUN_FAILED' ? 'run-failed' : 'gate-failed';
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${state},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${outcome},${outcomeRow},true,${state},${state === 'COMPLETED'},${at},'Scope sentence','{}'::jsonb)`;
    await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
  }

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of Object.values(runs)) {
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        // The SEAL goes before what it sealed: generation 27 refuses to delete an Evidence
        // row while its package row survives.
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const overview = (): DrizzleRunOverviewRepository => new DrizzleRunOverviewRepository(db);

  describe('the stopped Runs the Overview names', () => {
    it('returns only the Runs that stopped, newest first', async () => {
      const page = await overview().listStoppedRuns();
      const mine = page.rows.filter((row) => row.procedureId === procedureId);
      // The two that stopped, in the order they were started, newest first. The COMPLETED
      // Run and the QUEUED one are not attention items and must not be here: a summary
      // that listed a Run that concluded would be crying wolf, and one that listed a Run
      // still in flight would be reporting work in progress as a failure.
      expect(mine.map((row) => row.runId)).toEqual([runs.failed, runs.inconclusive]);
      expect(mine.map((row) => row.state)).toEqual(['RUN_FAILED', 'INCONCLUSIVE']);
      expect(mine[0]).toMatchObject({
        procedureName: 'Overview reads fixture',
        versionNumber: 1,
        initiatorId: author,
        period: { from: '2026-06-01', to: '2026-06-30' },
      });
      // Sealed, so it has an end; the Overview measures nothing to it, but the card does.
      expect(mine[0]!.endedAt).toBe('2026-12-31T10:00:00.000Z');
    });

    it('counts every stopped Run, not only the page it returned', async () => {
      const page = await overview().listStoppedRuns(1);
      expect(page.rows).toHaveLength(1);
      // The count is what stops a bounded list reading as a complete one. It is asserted
      // as a floor because every other file's stopped Runs are in it too.
      expect(page.total).toBeGreaterThanOrEqual(2);
      expect(page.total).toBeGreaterThan(page.rows.length);
      // And the bound can never be widened past the page size by a caller.
      expect((await overview().listStoppedRuns(1_000)).rows.length).toBeLessThanOrEqual(RUN_ATTENTION_LIMIT);
    });
  });

  describe('the last Run of each Procedure', () => {
    it('answers with the newest Run whatever state it is in', async () => {
      const found = await overview().latestRunPerProcedure([procedureId]);
      const last = found.get(procedureId);
      // The QUEUED Run is the newest, so it is the last thing that happened to this
      // Procedure. Answering with the terminal Run before it would make a card report a
      // finished outcome for a Procedure that is running right now.
      expect(last).toMatchObject({
        runId: runs.queued,
        state: 'QUEUED',
        kind: 'STANDARD',
        outcome: null,
        gateChecks: 0,
        gateFailed: 0,
        endedAt: null,
      });
      expect(last!.initiatedAt).toBe('2026-12-31T09:03:00.000Z');
    });

    it('carries the Result outcome of a terminal Run', async () => {
      // With the in-flight Run removed from the comparison, the newest is the RUN_FAILED
      // one, and the card has to be able to say "no conclusion issued" about it.
      await sql`UPDATE audit_run SET initiated_at='2026-01-01T00:00:00.000Z' WHERE run_id=${runs.queued}`;
      try {
        const last = (await overview().latestRunPerProcedure([procedureId])).get(procedureId);
        expect(last).toMatchObject({ runId: runs.failed, state: 'RUN_FAILED', outcome: 'RUN_FAILED' });
        expect(last!.endedAt).toBe('2026-12-31T10:00:00.000Z');
      } finally {
        await sql`UPDATE audit_run SET initiated_at='2026-12-31T09:03:00.000Z' WHERE run_id=${runs.queued}`;
      }
    });

    it('leaves a Procedure with no Run out of the map rather than inventing one', async () => {
      const found = await overview().latestRunPerProcedure([procedureId, procedureWithNoRun]);
      expect(found.has(procedureId)).toBe(true);
      // Absent, not a null row: "nothing has been executed" and "a Run issued no
      // conclusion" are different statements and the card says a different thing for each.
      expect(found.has(procedureWithNoRun)).toBe(false);
    });

    it('answers nothing for no ids, and ignores an id that is not a UUID', async () => {
      expect((await overview().latestRunPerProcedure([])).size).toBe(0);
      // PostgreSQL raises 22P02 comparing a `uuid` column against text that is not one,
      // and these ids come from a page of rows, so a malformed one is absence.
      const found = await overview().latestRunPerProcedure(['not-a-uuid', procedureId]);
      expect(found.has(procedureId)).toBe(true);
      expect(found.size).toBe(1);
    });
  });

  describe('the Procedure Versions awaiting approval', () => {
    it('reads the submission time and actor out of the version decision record', async () => {
      const page = await new DrizzleSubmittedVersionReader(db).listSubmitted();
      const mine = page.rows.filter((row) => row.procedureId === procedureId);
      // Newest submission first, which is the Runs register's own order.
      expect(mine.map((row) => row.versionId)).toEqual([submittedVersions.second, submittedVersions.first]);
      expect(mine[0]).toMatchObject({
        controlName: 'Overview reads fixture',
        versionNumber: 3,
        submittedAt: '2026-12-31T09:00:00.000Z',
        submittedBy: author,
        authorId: author,
      });
      expect(page.total).toBeGreaterThanOrEqual(2);
    });

    it('lists no version that is not awaiting a decision', async () => {
      // The ACTIVE version of the same Procedure holds an `approve` decision and must not
      // appear: the state is what decides, never the presence of a decision record.
      const page = await new DrizzleSubmittedVersionReader(db).listSubmitted();
      expect(page.rows.map((row) => row.versionId)).not.toContain(versionId);
    });

    it('counts every waiting version, not only the page it returned', async () => {
      const page = await new DrizzleSubmittedVersionReader(db).listSubmitted(1);
      expect(page.rows).toHaveLength(1);
      expect(page.total).toBeGreaterThanOrEqual(2);
      expect((await new DrizzleSubmittedVersionReader(db).listSubmitted(1_000)).rows.length)
        .toBeLessThanOrEqual(SUBMITTED_VERSION_LIMIT);
    });

    it('says the submission time is unrecorded rather than dating it from another column', async () => {
      // A row an older build wrote, or one whose decisions payload holds no submission.
      await sql`UPDATE procedure_version SET decisions='[]'::text::jsonb WHERE version_id=${submittedVersions.first}`;
      try {
        const page = await new DrizzleSubmittedVersionReader(db).listSubmitted();
        const row = page.rows.find((entry) => entry.versionId === submittedVersions.first);
        expect(row).toBeDefined();
        expect(row!.submittedAt).toBeNull();
        expect(row!.submittedBy).toBeNull();
        // The authorship is a different column and survives.
        expect(row!.authorId).toBe(author);
      } finally {
        await sql`UPDATE procedure_version SET decisions=${JSON.stringify([
          {
            schemaVersion: 1,
            actorId: author,
            occurredAt: '2026-12-30T09:00:00.000Z',
            priorState: 'DRAFT',
            decision: 'submit',
            rationale: null,
            aggregateRevision: 'a'.repeat(64),
          },
        ])}::text::jsonb WHERE version_id=${submittedVersions.first}`;
      }
    });
  });
});
