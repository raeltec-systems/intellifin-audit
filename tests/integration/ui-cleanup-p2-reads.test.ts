import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleActiveRunCounter,
  DrizzlePendingResultReader,
  DrizzleProcedureListReader,
  DrizzleSubmittedVersionReader,
  PostgresProceduresUnitOfWork,
  PROCEDURE_PAGE_SIZE,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

/**
 * The three reads the UI cleanup's landing pages needed and nothing answered
 * (UI cleanup 2026-09-22, package 2: UX-01, UX-03, UX-04, UX-37, sidebar counts).
 *
 * Each one is pure SQL — an access predicate, a lateral count over an append-only review
 * ledger, two `DISTINCT ON` subqueries, an `ILIKE` with an escape, an exact count beside a
 * bounded page — and none of that is exercised by a component test. The rows are written
 * HERE with raw SQL on purpose: what is under test is what the READ answers about rows
 * that already exist, and driving a whole Run to produce them would test the stages.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the UI cleanup landing reads', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const suffix = ids.next();
  const auditor = `${suffix}-p2-auditor`;
  const other = `${suffix}-p2-other`;
  const manager = `${suffix}-p2-manager`;
  const stranger = `${suffix}-p2-stranger`;
  // Named so the list's alphabetical order is deterministic and the search cases are
  // unambiguous against whatever else the database holds.
  const names = {
    draft: `ZZP2 Alpha leaver access ${suffix}`,
    active: `ZZP2 Beta segregation 100% ${suffix}`,
    submitted: `ZZP2 Gamma approvals ${suffix}`,
    foreignSubmitted: `ZZP2 Delta vendor master ${suffix}`,
  } as const;
  const procedures = {
    draft: ids.next(),
    active: ids.next(),
    submitted: ids.next(),
    foreignSubmitted: ids.next(),
  };
  const versions = {
    draft: ids.next(),
    active: ids.next(),
    submitted: ids.next(),
    foreignSubmitted: ids.next(),
  };
  const runs = { pending: ids.next(), sealed: ids.next(), running: ids.next(), foreign: ids.next() };
  const observationId = ids.next();
  const workItemId = ids.next();
  const evidenceId = ids.next();

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(new URL(url!).hostname)) {
      throw new Error('The UI cleanup read tests require an isolated database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    for (const [id, role] of [
      [auditor, 'auditor'],
      [other, 'auditor'],
      [manager, 'audit-manager'],
      [stranger, 'poc-administrator'],
    ] as const) {
      await sql`INSERT INTO auth_user(id,name,email) VALUES (${id},${id},${`${id}@test.invalid`})`;
      await sql`INSERT INTO user_role(user_id,role) VALUES (${id},${role})`;
    }

    // Three Procedures, one per newest-version state the status filter has to tell apart.
    await seedProcedure(procedures.draft, versions.draft, names.draft, 'DRAFT', auditor, null);
    await seedProcedure(procedures.active, versions.active, names.active, 'ACTIVE', other, 'weekly');
    await seedProcedure(procedures.submitted, versions.submitted, names.submitted, 'SUBMITTED', auditor, null);
    // A SECOND version awaiting approval, written by somebody else. The Reviews area shows
    // a manager BOTH and an auditor only their own, so the two rows are what tell the
    // whole-queue read apart from the author-scoped one.
    await seedProcedure(
      procedures.foreignSubmitted,
      versions.foreignSubmitted,
      names.foreignSubmitted,
      'SUBMITTED',
      other,
      null,
    );

    // A Run whose Result is waiting for a person: `run_result_sealed` (generation 25) is
    // `sealed = (outcome <> 'PENDING_CONFIRMATION')`, so this row IS the unsealed state.
    await insertRun(runs.pending, procedures.active, versions.active, auditor, '2026-09-01T09:00:00Z', { from: '2026-08-01', to: '2026-08-31' });
    await seedPendingEvaluations(runs.pending);
    await writeResult(runs.pending, 'PENDING_CONFIRMATION', 'pending-confirmation', false, 'COMPLETED', '2026-09-03T09:00:00Z');
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runs.pending}`;
    // The review ledger refuses a row whose Run is not Completed, which is why the decision
    // is appended after the Result rather than beside the machine rows it overlays.
    await confirmOneEvaluation(runs.pending);

    // A Run whose Result is final: the same reader must not list it.
    await insertRun(runs.sealed, procedures.active, versions.active, auditor, '2026-09-02T09:00:00Z', { from: '2026-07-01', to: '2026-07-31' });
    await writeResult(runs.sealed, 'PASS', 'pass', true, 'COMPLETED', '2026-09-02T10:00:00Z');
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runs.sealed}`;

    // A Run still in flight, for the sidebar's active count.
    await insertRun(runs.running, procedures.active, versions.active, auditor, '2026-09-04T09:00:00Z', { from: '2026-06-01', to: '2026-06-30' });

    // Another auditor's Run, also waiting. The access predicate decides who sees it.
    await insertRun(runs.foreign, procedures.active, versions.active, other, '2026-09-05T09:00:00Z', { from: '2026-05-01', to: '2026-05-31' });
    await writeResult(runs.foreign, 'PENDING_CONFIRMATION', 'pending-confirmation', false, 'COMPLETED', '2026-09-05T10:00:00Z');
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runs.foreign}`;
  });

  /**
   * One Procedure whose newest version is in the named state.
   *
   * The name and the Schedule go through `executablePlanInputs`, so `activeRunVersion`
   * builds its frozen review over the SAME inputs and the row stays self-consistent —
   * overriding a plan authoring input AFTER the fixture has frozen its review produces a
   * version that disagrees with its own review and can never own a period.
   *
   * The state is set on the RECORD rather than by a later UPDATE: generation 14's trigger
   * fires on any row carrying a frozen review, so a `DRAFT` written by UPDATE would be
   * refused as "cannot return to authoring" and the name change as immutable.
   */
  async function seedProcedure(
    procedureId: string,
    versionId: string,
    controlName: string,
    state: 'DRAFT' | 'SUBMITTED' | 'ACTIVE',
    author: string,
    frequency: 'weekly' | null,
  ): Promise<void> {
    const inputs = {
      ...executablePlanInputs(),
      controlName,
      schedule:
        frequency === null
          ? { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const }
          : { frequency, startTime: '00:00', periodDerivationRule: 'previous-monday-sunday' as const },
    };
    const active = activeRunVersion(procedureId, versionId, author, inputs);
    const row =
      state === 'ACTIVE' ? active : { ...active, state, lifecycle: null, ...(state === 'DRAFT' ? { frozenReview: null } : {}) };
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });
    await sql`UPDATE procedure SET control_name=${controlName} WHERE procedure_id=${procedureId}`;
  }

  /**
   * One Run, QUEUED, over its OWN period.
   *
   * `audit_run`'s partial unique index permits one ACTIVE Standard Run per Procedure and
   * period, so two fixtures sharing a period would collide before either could be read.
   */
  async function insertRun(
    runId: string,
    procedureId: string,
    versionId: string,
    initiator: string,
    at: string,
    period: { from: string; to: string },
  ): Promise<void> {
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
                period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
              VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'UI cleanup p2 fixture',
                ${period.from},${period.to},'QUEUED','STANDARD',${initiator},${initiator},'auditor',${at})`;
  }

  /**
   * Two Agent-Judged evaluations awaiting confirmation, one of them already confirmed by a
   * human decision. The reader's count must be ONE: `run_evaluation_review` is an
   * append-only ledger over the immutable machine rows, and the effective confirmation is
   * the review's where one exists.
   */
  async function seedPendingEvaluations(runId: string): Promise<void> {
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,captured_at,capture_method,capture_time_source,role)
              VALUES(${evidenceId},${runId},'adapter-extraction','accessgate',${`runs/${runId}/extract`},
                'application/json',${'c'.repeat(64)},1024,'REGISTERED',false,'2026-09-01T09:01:20Z','adapter','registration','evidence')`;
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
              VALUES(${workItemId},${runId},'step-1',1,'accessgate','AccessGate','OBSERVED',1,0,NULL,${evidenceId},1)`;
    const identity = JSON.stringify({
      name: 'employee_id', originalValue: 'E-001', normalizedValue: 'E-001',
      grounding: { evidenceId, locator: '$.accounts[0].employee_id', label: 'employee_id', extractedText: 'E-001' },
      corroboration: 'matched',
    });
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
                step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
              VALUES(${observationId},${runId},${workItemId},1,'E-001','accessgate','true','2026-09-01T09:01:10Z',
                ${ids.next()},'adapter','platform',${identity}::jsonb,'[]'::jsonb,
                ${JSON.stringify([evidenceId])}::text::jsonb,${'d'.repeat(64)},'COVERED','2026-09-01T09:01:10Z','MATCHED')`;
    for (const conditionId of ['C1', 'C2']) {
      await sql`INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids)
                VALUES(${observationId},'COVERED','MATCHED',${runId},${conditionId},'AGENT_JUDGED','COMPLIANT','pending','0.900000','because',NULL,${JSON.stringify([evidenceId])}::text::jsonb)`;
    }
  }

  /** One of the two conditions decided by a person, appended to the immutable ledger. */
  async function confirmOneEvaluation(runId: string): Promise<void> {
    // Generation 36 keeps the answer revision on its own row beside the frozen ten-key
    // Result, and refuses a decision that does not carry the current one.
    await sql`INSERT INTO run_result_review(run_id,revision) VALUES(${runId},1)`;
    await sql`INSERT INTO run_evaluation_review(decision_id,review_revision,run_id,observation_id,condition_id,action,
                original_origin,original_value,original_confirmation,original_confidence,original_rationale,original_evidence_ids,
                effective_origin,effective_value,effective_confirmation,replacement_value,rejection_rationale,actor_id,decided_at)
              VALUES(${ids.next()},1,${runId},${observationId},'C1','confirm',
                'AGENT_JUDGED','COMPLIANT','pending','0.900000','because',${JSON.stringify([evidenceId])}::text::jsonb,
                'AGENT_JUDGED','COMPLIANT','confirmed',NULL,NULL,${auditor},'2026-09-03T10:00:00Z')`;
  }

  async function writeResult(
    runId: string,
    outcome: string,
    outcomeRow: string,
    sealed: boolean,
    runState: string,
    at: string,
  ): Promise<void> {
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${runState},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${outcome},${outcomeRow},${sealed},${runState},true,${at},'Scope sentence','{}'::jsonb)`;
  }

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of Object.values(runs)) {
        // A review decision may not be deleted while its evaluation exists; the FK to
        // `run_observation_evaluation` cascades, so removing the evaluation takes it.
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_exception WHERE run_id=${runId}`;
        await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        // The SEAL goes before what it sealed (generation 27).
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      }
      for (const procedureId of Object.values(procedures)) {
        await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      }
      for (const id of [auditor, other, manager, stranger]) {
        await sql`DELETE FROM user_role WHERE user_id=${id}`;
        await sql`DELETE FROM auth_user WHERE id=${id}`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  /* ------------------------------ the author-scoped approval queue (UX-30, UX-35) --- */

  const submittedVersions = (): DrizzleSubmittedVersionReader => new DrizzleSubmittedVersionReader(db);

  it('shows a manager every version awaiting approval, including one they did not write', async () => {
    // `listSubmitted` is role-level: whether THIS manager may approve a PARTICULAR version
    // is the author rule, applied where the decision is taken.
    const page = await submittedVersions().listSubmitted(50);
    const ours = page.rows.filter((row) => row.versionId === versions.submitted || row.versionId === versions.foreignSubmitted);
    expect(ours.map((row) => row.versionId).sort()).toEqual(
      [versions.submitted, versions.foreignSubmitted].sort(),
    );
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it("shows an Auditor only the versions they submitted or are accountable for", async () => {
    // The finding: an auditor's Reviews tab is headed "Your versions waiting for an Audit
    // Manager", and `listSubmitted` would have put every other auditor's work under it —
    // a label stating something untrue. Proven by mutation: point the page back at
    // `listSubmitted` and this fails on the foreign version.
    const page = await submittedVersions().listSubmittedFor(auditor, 50);
    const ids = page.rows.map((row) => row.versionId);
    expect(ids).toContain(versions.submitted);
    expect(ids).not.toContain(versions.foreignSubmitted);

    const theirs = await submittedVersions().listSubmittedFor(other, 50);
    expect(theirs.rows.map((row) => row.versionId)).toContain(versions.foreignSubmitted);
    expect(theirs.rows.map((row) => row.versionId)).not.toContain(versions.submitted);
  });

  it('counts the scoped queue exactly, never the length of a bounded page', async () => {
    const whole = await submittedVersions().listSubmitted(50);
    const mine = await submittedVersions().listSubmittedFor(auditor, 50);
    // The author-scoped total is its own `count(*)` under the same predicate, so it is
    // strictly smaller here rather than a copy of the whole queue's number.
    expect(mine.total).toBeLessThan(whole.total);
    expect(mine.total).toBe(mine.rows.length);
  });

  it('claims nothing for a reader with no id, and nothing for a stranger', async () => {
    expect(await submittedVersions().listSubmittedFor('', 50)).toEqual({ rows: [], total: 0 });
    const none = await submittedVersions().listSubmittedFor(stranger, 50);
    expect(none.rows).toHaveLength(0);
    expect(none.total).toBe(0);
  });

  /* ------------------------------------------------- pending Results (UX-01, UX-35) --- */

  const pending = (): DrizzlePendingResultReader => new DrizzlePendingResultReader(db);

  it('lists the Runs whose Result awaits this reader, with the count of what is left', async () => {
    const page = await pending().listPendingResults({ userId: auditor });
    const mine = page.rows.filter((row) => row.runId === runs.pending);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      procedureId: procedures.active,
      versionNumber: 1,
      initiatorId: auditor,
      period: { from: '2026-08-01', to: '2026-08-31' },
    });
    // ONE, not two: the C1 decision is in the review ledger, so the effective
    // confirmation for that condition is `confirmed`. A count over the machine rows alone
    // would say two and send the reader to a Run with nothing left to do.
    expect(mine[0]?.pendingEvaluations).toBe(1);
  });

  it('never lists a Result that is already final', async () => {
    const page = await pending().listPendingResults({ userId: auditor });
    expect(page.rows.map((row) => row.runId)).not.toContain(runs.sealed);
  });

  it('shows an auditor only their own Run, and a manager both', async () => {
    const mine = await pending().listPendingResults({ userId: auditor });
    expect(mine.rows.map((row) => row.runId)).toContain(runs.pending);
    expect(mine.rows.map((row) => row.runId)).not.toContain(runs.foreign);

    const supervised = await pending().listPendingResults({ userId: manager });
    expect(supervised.rows.map((row) => row.runId)).toEqual(
      expect.arrayContaining([runs.pending, runs.foreign]),
    );
  });

  it('shows a role that does not supervise audits nothing at all', async () => {
    // A PoC Administrator may not see Runs, and `/runs` refuses them. A landing page that
    // read this without the role predicate would hand them what that route withholds.
    const page = await pending().listPendingResults({ userId: stranger });
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    expect(await pending().countPendingResults({ userId: stranger })).toBe(0);
  });

  it('counts exactly what the list may not be able to show', async () => {
    const page = await pending().listPendingResults({ userId: manager }, 1);
    expect(page.rows).toHaveLength(1);
    // The bound is on the PAGE; the count is its own statement, so it can exceed it.
    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(page.total).toBe(await pending().countPendingResults({ userId: manager }));
  });

  it('counts the Runs still in flight, over the whole table', async () => {
    const active = await new DrizzleActiveRunCounter(db).countActiveRuns();
    expect(active).toBeGreaterThanOrEqual(1);
    const [row] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM audit_run
      WHERE state IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')`;
    expect(active).toBe(Number(row?.total));
  });

  /* ------------------------------------------ the Procedures list (UX-03, UX-04) --- */

  const procedureList = (): DrizzleProcedureListReader => new DrizzleProcedureListReader(db);

  it('names the ACTIVE version and the NEWEST version separately', async () => {
    const page = await procedureList().listProcedures({ search: suffix });
    const byId = new Map(page.rows.map((row) => [row.procedureId, row]));
    // An Active version: both cells agree.
    expect(byId.get(procedures.active)).toMatchObject({
      activeVersionState: 'ACTIVE',
      latestVersionState: 'ACTIVE',
      plannedFrequency: 'weekly',
      ownerId: other,
    });
    // A Draft: "Active version" is NOTHING, which is the repaired Story 2.1 meaning, while
    // the newest version's own state is what the status filter sees.
    // `plannedFrequency` is read from the CURRENT ACTIVE version and from nowhere else, so
    // a Draft that names a frequency of its own still reports none: the card must not offer
    // a frequency no Run could ever be started from.
    expect(byId.get(procedures.draft)).toMatchObject({
      activeVersionState: null,
      latestVersionState: 'DRAFT',
      plannedFrequency: null,
      ownerId: auditor,
    });
    expect(byId.get(procedures.submitted)?.latestVersionState).toBe('SUBMITTED');
  });

  it('searches the Control name and the Template, and escapes what the reader typed', async () => {
    const byName = await procedureList().listProcedures({ search: `Beta segregation 100% ${suffix}` });
    expect(byName.rows.map((row) => row.procedureId)).toEqual([procedures.active]);
    // `%` is a literal here, not a wildcard. Without the escape this pattern would match
    // every Procedure whose name merely contains "Beta segregation 100".
    const wrong = await procedureList().listProcedures({ search: `Beta segregation 100%X${suffix}` });
    expect(wrong.rows).toEqual([]);
    // The Template leg, proven against rows whose NAME contains no template identifier —
    // and narrowed by owner, because the search is over the whole deployment and a
    // template search alone would be a bounded page of every Procedure built from it.
    const byTemplate = await procedureList().listProcedures({ search: 'P-4', ownerId: auditor });
    expect(byTemplate.rows.map((row) => row.procedureId).sort()).toEqual(
      [procedures.draft, procedures.submitted].sort(),
    );
    expect(await procedureList().listProcedures({ search: 'P-2', ownerId: auditor })).toMatchObject({
      rows: [],
      total: 0,
    });
  });

  it('filters by the newest version state and by owner', async () => {
    const drafts = await procedureList().listProcedures({ search: suffix, states: ['DRAFT'] });
    expect(drafts.rows.map((row) => row.procedureId)).toEqual([procedures.draft]);
    expect(drafts.total).toBe(1);

    const mine = await procedureList().listProcedures({ search: suffix, ownerId: auditor });
    expect(mine.rows.map((row) => row.procedureId).sort()).toEqual(
      [procedures.draft, procedures.submitted].sort(),
    );

    // A state this build does not know narrows to nothing rather than reaching PostgreSQL
    // as an unrecognised literal.
    const unknown = await procedureList().listProcedures({
      search: suffix,
      states: ['NOT_A_STATE' as never],
    });
    expect(unknown.rows.map((row) => row.procedureId).sort()).toEqual(
      Object.values(procedures).sort(),
    );
  });

  it('counts what the filter matched and what the deployment holds, beside a bounded page', async () => {
    const page = await procedureList().listProcedures({ search: suffix, limit: 1 });
    expect(page.rows).toHaveLength(1);
    // `rows.length` after a LIMIT is the bound, never a count — the whole reason both
    // numbers are their own statements.
    // Four, because this file seeds four Procedures under one suffix — and the number is
    // read from the fixture rather than typed, so adding a fifth cannot silently pass.
    expect(page.total).toBe(Object.keys(procedures).length);
    expect(page.unfilteredTotal).toBeGreaterThanOrEqual(Object.keys(procedures).length);
    expect(page.limit).toBe(1);

    const second = await procedureList().listProcedures({ search: suffix, limit: 1, offset: 1 });
    expect(second.rows[0]?.procedureId).not.toBe(page.rows[0]?.procedureId);
    expect(second.total).toBe(Object.keys(procedures).length);
  });

  it('bounds the page size and the offset a query string can ask for', async () => {
    const page = await procedureList().listProcedures({ limit: 10_000, offset: -5 });
    expect(page.limit).toBe(PROCEDURE_PAGE_SIZE);
    expect(page.offset).toBe(0);
  });

  it('answers the drafts this person is accountable for, newest work first', async () => {
    const drafts = await procedureList().listAuthoredDrafts(auditor);
    // The SUBMITTED one is this auditor's too and is deliberately not here: a draft is
    // work they can carry on with, and a submitted version is waiting on somebody else.
    expect(drafts.rows.map((row) => row.procedureId)).toEqual([procedures.draft]);
    expect(await procedureList().listAuthoredDrafts(other)).toMatchObject({ rows: [], total: 0 });
    expect(await procedureList().listAuthoredDrafts('')).toMatchObject({ rows: [], total: 0 });
  });

  it('lists the people who own a Procedure, with how many each owns', async () => {
    const owners = await procedureList().listOwners();
    const mine = owners.find((owner) => owner.userId === auditor);
    expect(mine?.procedures).toBeGreaterThanOrEqual(2);
    // Ids and counts only. `ActorNameReader` is the one port that turns an id into a name.
    expect(Object.keys(owners[0] ?? {}).sort()).toEqual(['procedures', 'userId']);
  });
});
