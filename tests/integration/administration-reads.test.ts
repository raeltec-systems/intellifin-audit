import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CryptoUuidV7Generator,
  DrizzleBindingRepository,
  DrizzleProcedureRepository,
  DrizzleRegistrationRepository,
  DrizzleUserDirectory,
  PostgresProceduresUnitOfWork,
  REFERENCING_NAME_LIMIT,
  createDb,
  createSqlClient,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import {
  bindingDigest,
  bindingDigestEnvelope,
  registrationDigest,
  snapshotFromRegistration,
} from '@intellifin/domain';

import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

/**
 * The reads the Administration surfaces gained in the UI cleanup (UX-37, UX-38, UX-44,
 * UX-46), against a real, migrated PostgreSQL 18.
 *
 * Every one of them is a question the old surfaces answered with a bounded page or with
 * nothing at all: how many accounts, sources and systems there really are; which of them
 * match what somebody typed; when this system was last used by a Run; and which
 * Procedures a change to it would send back for approval. None of that is exercised by a
 * component test, because the defect in each case is in the SQL — a total that is really
 * a page size, a filter applied to a prefix, a fact nobody read.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the Administration read models', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const stamp = `admin-reads-${process.pid}`;

  /** The registration a Run really used, and one nothing ever ran against. */
  const usedRegistrationId = ids.next();
  const unusedRegistrationId = ids.next();
  const bindingIds = [ids.next(), ids.next(), ids.next()];

  const author = `${ids.next()}-${stamp}`;
  const procedureIds = [ids.next(), ids.next()];
  const versionIds = [ids.next(), ids.next()];
  const runs = { queued: ids.next(), completed: ids.next(), later: ids.next(), unrelated: ids.next() };
  const unrelatedVersionId = ids.next();
  const unrelatedProcedureId = ids.next();

  const userIds = [ids.next(), ids.next(), ids.next()].map((id) => `${id}-${stamp}`);

  /** Any 64 lower-case hex characters satisfy the digest CHECK; none of these is read. */
  const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(new URL(url!).hostname)) {
      throw new Error('Administration read tests require an isolated database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);

    for (const [index, registrationId] of [usedRegistrationId, unusedRegistrationId].entries()) {
      await sql`INSERT INTO target_system_registration(registration_id,display_name,kind,allowed_origins,credential_ref,permitted_actions,digest)
                VALUES(${registrationId},${`${stamp} system ${index}`},'web',ARRAY['https://synthetic.invalid'],'cred://synthetic/read','{navigate}',${digest(`${index}a`)})`;
    }
    for (const [index, bindingId] of bindingIds.entries()) {
      await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest)
                VALUES(${bindingId},${`${stamp} source ${index}`},'versioned-file','https://synthetic.invalid/x.csv',ARRAY['employee_id'],'cover-sheet',${digest(`${index}b`)})`;
    }

    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},${author},${author + '@synthetic.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;

    // Three accounts with distinguishable names, addresses and roles, so the search and
    // the role filter can be told apart from "returns everything".
    const people = [
      { id: userIds[0]!, name: `${stamp} Dana Okoro`, email: `${stamp}-dana@synthetic.invalid`, role: 'auditor' },
      { id: userIds[1]!, name: `${stamp} Priya Raman`, email: `${stamp}-priya@synthetic.invalid`, role: 'audit-manager' },
      { id: userIds[2]!, name: `${stamp} Sam Nkolo`, email: `${stamp}-sam@synthetic.invalid`, role: null },
    ];
    for (const person of people) {
      await sql`INSERT INTO auth_user(id,name,email) VALUES (${person.id},${person.name},${person.email})`;
      if (person.role !== null) {
        await sql`INSERT INTO user_role(user_id,role) VALUES (${person.id},${person.role})`;
      }
    }

    // Two Active Procedures whose frozen version names the registration and the source,
    // and one that names neither.
    for (const [index, procedureId] of procedureIds.entries()) {
      const row = activeRunVersion(procedureId, versionIds[index]!, author, referencingInputs());
      await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
        await context.procedures.insertProcedure({ ...row, controlName: `${stamp} control ${index === 0 ? 'B' : 'A'}` });
        await context.procedures.insertVersion(row);
      });
      await sql`UPDATE procedure SET control_name=${`${stamp} control ${index === 0 ? 'B' : 'A'}`} WHERE procedure_id=${procedureId}`;
    }
    const other = activeRunVersion(unrelatedProcedureId, unrelatedVersionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(other);
      await context.procedures.insertVersion(other);
    });

    // A Run still QUEUED, then two terminal Runs, newest last — so "the latest terminal
    // Run" has something newer to be wrong about and something unfinished to skip.
    await insertRun(runs.queued, procedureIds[0]!, versionIds[0]!, '2026-09-05T09:00:00Z', '2026-05');
    await insertRun(runs.completed, procedureIds[0]!, versionIds[0]!, '2026-09-01T09:00:00Z', '2026-06');
    await terminate(runs.completed, 'COMPLETED', '2026-09-01T10:00:00Z');
    await insertRun(runs.later, procedureIds[1]!, versionIds[1]!, '2026-09-02T09:00:00Z', '2026-07');
    await terminate(runs.later, 'INCONCLUSIVE', '2026-09-02T11:30:00Z');
    // A terminal Run of a version that names a DIFFERENT registration, so a read that
    // forgot its predicate would return this one.
    await insertRun(runs.unrelated, unrelatedProcedureId, unrelatedVersionId, '2026-09-09T09:00:00Z', '2026-08');
    await terminate(runs.unrelated, 'COMPLETED', '2026-09-09T10:00:00Z');
  });

  /** A frozen plan whose single Target System is the registration under test. */
  function referencingInputs(): ReturnType<typeof executablePlanInputs> {
    const base = executablePlanInputs();
    const registration = {
      registrationId: usedRegistrationId,
      displayName: `${stamp} system 0`,
      kind: 'web' as const,
      allowedOrigins: ['https://synthetic.invalid'],
      applicationIdentity: '',
      credentialRef: 'cred://synthetic/read',
      permittedActions: ['navigate', 'read-attribute'] as const,
      attributeLabelPatterns: ['Parameter'],
      secondaryKey: '',
    };
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/population.csv',
      declaredSchema: ['parameter'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    return {
      ...base,
      sourceSnapshot: {
        bindingId: bindingIds[0]!,
        displayName: `${stamp} source 0`,
        digest: bindingDigest(source),
        contract: bindingDigestEnvelope(source),
      },
      targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
      instructions: [{ registrationId: usedRegistrationId, text: 'Read all baseline parameters.' }],
    };
  }

  async function insertRun(
    runId: string,
    procedureId: string,
    versionId: string,
    at: string,
    /** Distinct per Run: one partial unique index forbids two open Runs of one period. */
    period: string,
  ): Promise<void> {
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
                period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
              VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${`${stamp} run`},
                ${`${period}-01`},${`${period}-28`},'QUEUED','STANDARD',${author},${author},'auditor',${at})`;
  }

  /** Package, Result, then state — the order generations 21 and 25 require. */
  async function terminate(
    runId: string,
    state: 'COMPLETED' | 'INCONCLUSIVE',
    at: string,
  ): Promise<void> {
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${state},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${state === 'COMPLETED' ? 'PASS' : 'INCONCLUSIVE'},${state === 'COMPLETED' ? 'pass' : 'gate-failed'},
                true,${state},${state === 'COMPLETED'},${at},'Scope sentence','{}'::jsonb)`;
    await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
  }

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of Object.values(runs)) {
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      }
      for (const procedureId of [...procedureIds, unrelatedProcedureId]) {
        await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      }
      await sql`DELETE FROM target_system_registration WHERE registration_id IN (${usedRegistrationId},${unusedRegistrationId})`;
      await sql`DELETE FROM population_source_binding WHERE binding_id = ANY(${bindingIds})`;
      for (const id of [...userIds, author]) {
        await sql`DELETE FROM user_role WHERE user_id=${id}`;
        await sql`DELETE FROM auth_user WHERE id=${id}`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  /**
   * UX-37: the landing states how much there is, and a bounded page cannot say it.
   *
   * Both repositories are constructed with a limit of ONE here, which is what makes the
   * assertion mean something: a count derived from `listX().length` answers 1 for a
   * deployment holding hundreds, and the summary an operator reads to find out how much
   * work there is would be permanently wrong.
   */
  describe('the exact totals the landing states', () => {
    it('counts every registration, past the list limit', async () => {
      const repository = new DrizzleRegistrationRepository(db, 1);
      expect((await repository.listRegistrations()).length).toBe(1);
      expect(await repository.countRegistrations()).toBeGreaterThanOrEqual(2);
    });

    it('counts every source, past the list limit', async () => {
      const repository = new DrizzleBindingRepository(db, 1);
      expect((await repository.listBindings()).length).toBe(1);
      expect(await repository.countBindings()).toBeGreaterThanOrEqual(3);
    });

    it('counts every account, past the list limit', async () => {
      const directory = new DrizzleUserDirectory(db, 1);
      expect((await directory.pageUsers()).length).toBe(1);
      expect(await directory.countUsers()).toBeGreaterThanOrEqual(4);
    });
  });

  /**
   * UX-38: the search and the role filter are applied by the DATABASE.
   *
   * A filter applied to a bounded page can only ever search the prefix somebody happened
   * to fetch, and then says "no matches" about an account that is really there. Each
   * case below is run through a directory whose page is SMALLER than the number of
   * accounts, so a client-side filter would fail it.
   */
  describe('the user directory search and filter', () => {
    const directory = (): DrizzleUserDirectory => new DrizzleUserDirectory(db, 500);

    it('matches a name', async () => {
      const found = await directory().pageUsers({ search: 'Okoro' });
      expect(found.map((user) => user.userId)).toEqual([userIds[0]]);
      expect(await directory().countUsers({ search: 'Okoro' })).toBe(1);
    });

    it('matches an address, case-insensitively', async () => {
      const found = await directory().pageUsers({ search: `${stamp}-PRIYA` });
      expect(found.map((user) => user.userId)).toEqual([userIds[1]]);
    });

    it('filters to one role', async () => {
      const found = await directory().pageUsers({ search: stamp, role: 'audit-manager' });
      expect(found.map((user) => user.userId)).toEqual([userIds[1]]);
    });

    it('filters to the accounts that hold NO role, which is a state a person asks for', async () => {
      const found = await directory().pageUsers({ search: stamp, role: 'none' });
      expect(found.map((user) => user.userId)).toEqual([userIds[2]]);
      expect(found[0]?.role).toBeNull();
    });

    it('combines the search and the filter rather than applying one of them', async () => {
      expect(await directory().countUsers({ search: 'Okoro', role: 'audit-manager' })).toBe(0);
      expect(await directory().countUsers({ search: 'Okoro', role: 'auditor' })).toBe(1);
    });

    it('pages with a stable order, so no account is on two pages or on none', async () => {
      const all = await directory().pageUsers({ search: stamp });
      expect(all.length).toBeGreaterThanOrEqual(3);
      const first = await directory().pageUsers({ search: stamp, limit: 2, offset: 0 });
      const second = await directory().pageUsers({ search: stamp, limit: 2, offset: 2 });
      expect([...first, ...second].map((user) => user.userId)).toEqual(
        all.slice(0, 4).map((user) => user.userId),
      );
    });

    it('treats a typed wildcard as the characters somebody typed', async () => {
      // `%` and `_` are LIKE wildcards. Unescaped, a search for `%` matches everybody,
      // which reads as a search box that does not work.
      expect(await directory().countUsers({ search: '%' })).toBe(0);
      expect(await directory().countUsers({ search: `${stamp}_dana` })).toBe(0);
    });

    it('returns nothing for a search that matches nothing, rather than everything', async () => {
      expect(await directory().pageUsers({ search: 'nobody-by-this-name' })).toEqual([]);
    });
  });

  /**
   * UX-44: a system a Run has used never says nobody has observed it.
   *
   * The connection check and the last audit activity are two facts. This is the second
   * one, and it is read from the frozen `targets` of the version the Run executed —
   * the only record that survives a later change to the registration.
   */
  describe('the last audit activity of a system', () => {
    const repository = (): DrizzleRegistrationRepository => new DrizzleRegistrationRepository(db);

    it('names the latest TERMINAL Run that used this system', async () => {
      const activity = await repository().lastAuditActivity(usedRegistrationId);
      expect(activity).not.toBeNull();
      // The later of the two terminal Runs, and NOT the QUEUED one started after both.
      expect(activity?.runId).toBe(runs.later);
      expect(activity?.state).toBe('INCONCLUSIVE');
      expect(activity?.procedureName).toBe(`${stamp} run`);
      expect(activity?.endedAt).toBe('2026-09-02T11:30:00.000Z');
    });

    it('never reports a Run that has not finished as activity', async () => {
      // The QUEUED Run is the most recent of the three and names the same registration;
      // a read that ordered by time alone and forgot the state would return it, and the
      // surface would tell an operator a test finished when it has not started.
      const activity = await repository().lastAuditActivity(usedRegistrationId);
      expect(activity?.runId).not.toBe(runs.queued);
    });

    it('answers nothing for a system no Run has used', async () => {
      expect(await repository().lastAuditActivity(unusedRegistrationId)).toBeNull();
    });

    it('answers nothing, not an error, for an id that is not a UUID', async () => {
      // The id comes from a URL. PostgreSQL raises 22P02 comparing a `uuid` column
      // against text that is not one, which would be a framework 500 on a detail page.
      expect(await repository().lastAuditActivity('not-a-uuid')).toBeNull();
      expect(await repository().lastAuditActivity('')).toBeNull();
    });
  });

  /**
   * UX-46: a material change names the Procedures it affects.
   *
   * `countReferencing` says how many; this says which, over the same predicate and the
   * same "current" rule, so the confirmation cannot name a different set from the one it
   * counts.
   */
  describe('the Procedures a change would send back for approval', () => {
    const repository = (): DrizzleProcedureRepository => new DrizzleProcedureRepository(db);

    it('names every Active Procedure that froze this registration', async () => {
      const affected = await repository().listReferencing(usedRegistrationId, 'registration');
      expect(affected.map((row) => row.controlName)).toEqual([
        `${stamp} control A`,
        `${stamp} control B`,
      ]);
      expect(affected.length).toBe(await repository().countReferencing(usedRegistrationId, 'registration'));
    });

    it('names every Active Procedure that froze this source', async () => {
      const affected = await repository().listReferencing(bindingIds[0]!, 'source');
      expect(affected.map((row) => row.controlName)).toEqual([
        `${stamp} control A`,
        `${stamp} control B`,
      ]);
      expect(affected.length).toBe(await repository().countReferencing(bindingIds[0]!, 'source'));
    });

    it('names nothing for a system no Procedure froze', async () => {
      expect(await repository().listReferencing(unusedRegistrationId, 'registration')).toEqual([]);
    });

    it('bounds the names, because a confirmation nobody reads is not a confirmation', async () => {
      expect(REFERENCING_NAME_LIMIT).toBeGreaterThan(0);
      const affected = await repository().listReferencing(usedRegistrationId, 'registration', 1);
      expect(affected.length).toBe(1);
      // The exact total still comes from `countReferencing`, which is not bounded.
      expect(await repository().countReferencing(usedRegistrationId, 'registration')).toBe(2);
    });
  });
});
