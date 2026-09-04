import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProcedure,
  PROCEDURE_AUTHOR_ACTION,
  PROCEDURE_CREATED_EVENT,
  PROCEDURE_DRAFT_CHANGED_EVENT,
  PROCEDURE_REFUSALS,
  procedureVersionRowVersion,
  renameProcedureDraft,
  type AuditUnitOfWork,
  type ProcedureDependencies,
  type ProceduresUnitOfWorkContext,
  type ProcedureVersionRecord,
  type ProcedureVersionView,
  type SessionSnapshot,
} from '@intellifin/application';
import {
  DENIAL_REASONS,
  PROCEDURE_VERSION_STATES,
  initialDraftSections,
} from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleProcedureRepository,
  DrizzleRoleRepository,
  PostgresAuditChainReader,
  PostgresProceduresUnitOfWork,
  createDb,
  createSeedAuth,
  createSqlClient,
  type Auth,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

/**
 * Procedures against a real, migrated PostgreSQL 18 (FR-4, FR-5, AD-8).
 *
 * Everything here is about promises only a real transaction can keep: the Procedure
 * row, its DRAFT version row and the `lifecycle.procedure-created` event commit
 * together or not at all. A fake unit of work can be written to behave that way;
 * PostgreSQL either does or does not.
 *
 * It also asserts the guarantees that live in the DATABASE rather than in code — the
 * state vocabulary, the Template vocabulary, the non-blank Control name, the
 * version-number floor and the UNIQUE (procedure_id, version_number) index — all with
 * raw SQL, because the point of a constraint is that it holds against a writer that has
 * not read the command.
 *
 * And it exercises the stale-row guard with one transaction HELD OPEN, exactly as the
 * binding suite does: two calls started at once finish quickly enough that one commits
 * before the other reads, and the test passes with the row lock removed.
 *
 * Nothing here migrates. Rows are namespaced by process id and deleted afterwards, and
 * the `platform` chain is verified at the end.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const AUTH_CONFIG = { secret: SECRET, baseUrl: BASE_URL };

describe.skipIf(!databaseUrl)('Procedures against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seedAuth: Auth;
  const prefix = `story-2-1-${process.pid}-`;
  const emailFor = (label: string) => `${prefix}${label}@synthetic.invalid`;

  let auditor: SessionSnapshot;
  let administrator: SessionSnapshot;
  /** Procedure ids this suite created, deleted in `afterAll`. */
  const created: string[] = [];

  function dependencies(
    options: {
      failIds?: boolean;
      unitOfWork?: AuditUnitOfWork<ProceduresUnitOfWorkContext>;
    } = {},
  ): ProcedureDependencies {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork:
        options.unitOfWork ??
        new PostgresProceduresUnitOfWork(
          db,
          // An id generator that produces something the canonical envelope rejects, so
          // the append throws AFTER the rows are written inside the same transaction —
          // the ordering the atomicity claim is actually about.
          options.failIds ? { ids: { next: () => 'not-a-uuid-v7' } } : {},
        ),
      ids: new CryptoUuidV7Generator(),
    };
  }

  async function eventsFor(correlationId: string) {
    return sql<
      {
        event_type: string;
        outcome: string;
        actor_id: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT event_type, outcome, actor_id, aggregate_id, payload
      FROM audit_events
      WHERE correlation_id = ${correlationId}
      ORDER BY sequence
    `;
  }

  async function rowsFor(procedureId: string) {
    const procedures = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM procedure WHERE procedure_id = ${procedureId}
    `;
    const versions = await sql<
      {
        version_number: number;
        state: string;
        control_name: string;
        template_id: string;
        sections: Record<string, unknown>;
      }[]
    >`
      SELECT version_number, state, control_name, template_id, sections
      FROM procedure_version WHERE procedure_id = ${procedureId}
      ORDER BY version_number
    `;
    return { procedures: procedures[0]?.c ?? 0, versions };
  }

  async function createSession(userId: string, label: string): Promise<SessionSnapshot> {
    const sessionId = `${prefix}session-${label}`;
    await sql`
      INSERT INTO auth_session (id, user_id, token, expires_at)
      VALUES (${sessionId}, ${userId}, ${`${prefix}token-${label}`}, now() + interval '1 hour')
      ON CONFLICT (id) DO NOTHING
    `;
    return { userId, sessionId };
  }

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl as string, { max: 5 });
    db = createDb(sql);
    seedAuth = createSeedAuth(db, AUTH_CONFIG);

    await sql`DELETE FROM procedure WHERE control_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM audit_events WHERE correlation_id LIKE ${`${prefix}%`}`;

    const one = await seedAuth.api.signUpEmail({
      body: { email: emailFor('auditor'), name: 'Synthetic Auditor', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${one.user.id}, 'auditor')`;
    auditor = await createSession(one.user.id, 'auditor');

    const two = await seedAuth.api.signUpEmail({
      body: {
        email: emailFor('admin'),
        name: 'Synthetic Administrator',
        password: PASSWORD,
      },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${two.user.id}, 'poc-administrator')`;
    administrator = await createSession(two.user.id, 'admin');
  });

  afterAll(async () => {
    for (const procedureId of created) {
      // Versions cascade with the Procedure row.
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    await sql`DELETE FROM procedure WHERE control_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    // The events stay: deleting them would leave `audit_event_heads` pointing past the
    // rows that remain, which is a corrupt chain — the thing the last test verifies.
    await sql.end({ timeout: 5 });
  });

  function createInput(
    overrides: { templateId?: string; controlName?: string } = {},
    correlationId = `${prefix}create`,
  ) {
    return {
      templateId: overrides.templateId ?? 'P-1',
      controlName: overrides.controlName ?? `${prefix}Terminated users retain no access`,
      session: auditor,
      correlationId,
    } as const;
  }

  it('writes the Procedure, its DRAFT version and one event in ONE transaction', async () => {
    const correlationId = `${prefix}create`;
    const outcome = await createProcedure(dependencies(), createInput({}, correlationId));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    created.push(outcome.procedureId);

    const { procedures, versions } = await rowsFor(outcome.procedureId);
    expect(procedures).toBe(1);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      state: 'DRAFT',
      template_id: 'P-1',
    });
    expect(versions[0]?.control_name).toBe(`${prefix}Terminated users retain no access`);
    // Every section pre-filled from the Template, in Builder order.
    expect(versions[0]?.sections).toEqual(initialDraftSections('P-1'));

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: PROCEDURE_CREATED_EVENT,
      outcome: 'success',
      actor_id: auditor.userId,
      aggregate_id: outcome.procedureId,
    });
  });

  it.each(['P-2', 'P-3', 'P-4'])(
    'pre-fills %s with its own defaults, through the same code path',
    async (templateId) => {
      const outcome = await createProcedure(
        dependencies(),
        createInput(
          { templateId, controlName: `${prefix}${templateId} control` },
          `${prefix}create-${templateId}`,
        ),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      created.push(outcome.procedureId);

      const { versions } = await rowsFor(outcome.procedureId);
      expect(versions[0]?.template_id).toBe(templateId);
      expect(versions[0]?.sections).toEqual(initialDraftSections(templateId as never));
    },
  );

  it('refuses an unchosen Template, storing nothing', async () => {
    const correlationId = `${prefix}no-template`;
    const outcome = await createProcedure(dependencies(), {
      ...createInput({}, correlationId),
      // An unchosen select posts an empty string. TypeScript would call it a Template;
      // it is a missing value.
      templateId: '' as unknown as 'P-1',
    });

    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.TEMPLATE_REQUIRED });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM procedure WHERE control_name LIKE ${`${prefix}%`}
    `;
    // Only the rows the earlier tests created; nothing new.
    expect(rows[0]?.c).toBe(created.length);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses a blank Control name, storing nothing', async () => {
    const correlationId = `${prefix}blank-name`;
    const outcome = await createProcedure(dependencies(), {
      ...createInput({}, correlationId),
      controlName: '   ',
    });

    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NAME_REQUIRED });
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses a PoC Administrator and appends security.denied instead', async () => {
    const correlationId = `${prefix}denied`;
    const outcome = await createProcedure(dependencies(), {
      ...createInput({}, correlationId),
      session: administrator,
    });

    expect(outcome).toEqual({
      ok: false,
      reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
    });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM procedure
      WHERE control_name = ${`${prefix}Should not exist`}
    `;
    expect(rows[0]?.c).toBe(0);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'security.denied', outcome: 'denied' });
    expect(events[0]?.payload).toMatchObject({ action: PROCEDURE_AUTHOR_ACTION });
  });

  it('stores nothing when the audit append fails after the rows are written', async () => {
    const correlationId = `${prefix}append-fails`;

    await expect(
      createProcedure(
        dependencies({ failIds: true }),
        createInput({ controlName: `${prefix}Never stored` }, correlationId),
      ),
    ).rejects.toThrow();

    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM procedure
      WHERE control_name = ${`${prefix}Never stored`}
    `;
    expect(rows[0]?.c).toBe(0);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('renames the Draft and appends procedure-draft-changed in the same transaction', async () => {
    const seed = await createProcedure(dependencies(), createInput({}, `${prefix}rename-setup`));
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    created.push(seed.procedureId);
    const correlationId = `${prefix}rename`;

    const listed = await new DrizzleProcedureRepository(db).listVersions(seed.procedureId);
    const draft = listed[0];
    if (draft === undefined) throw new Error('the seeded Draft is missing');

    const outcome = await renameProcedureDraft(dependencies(), {
      session: auditor,
      procedureId: seed.procedureId,
      versionId: draft.versionId,
      controlName: `${prefix}Renamed by the auditor`,
      expectedRowVersion: procedureVersionRowVersion({
        versionId: draft.versionId,
        procedureId: draft.procedureId,
        versionNumber: draft.versionNumber,
        state: draft.state,
        controlName: draft.controlName,
        templateId: draft.templateId,
        sections: draft.sections,
      }),
      correlationId,
    });

    expect(outcome).toMatchObject({ ok: true, changed: true });
    const { versions } = await rowsFor(seed.procedureId);
    expect(versions[0]?.control_name).toBe(`${prefix}Renamed by the auditor`);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: PROCEDURE_DRAFT_CHANGED_EVENT,
      aggregate_id: seed.procedureId,
    });
    expect(events[0]?.payload).toMatchObject({
      priorControlName: `${prefix}Terminated users retain no access`,
      controlName: `${prefix}Renamed by the auditor`,
    });
  });

  it('writes nothing when a rename changes nothing at all', async () => {
    const seed = await createProcedure(dependencies(), createInput({}, `${prefix}idle-setup`));
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    created.push(seed.procedureId);
    const correlationId = `${prefix}idle`;

    const listed = await new DrizzleProcedureRepository(db).listVersions(seed.procedureId);
    const draft = listed[0];
    if (draft === undefined) throw new Error('the seeded Draft is missing');
    const token = procedureVersionRowVersion({
      versionId: draft.versionId,
      procedureId: draft.procedureId,
      versionNumber: draft.versionNumber,
      state: draft.state,
      controlName: draft.controlName,
      templateId: draft.templateId,
      sections: draft.sections,
    });

    const outcome = await renameProcedureDraft(dependencies(), {
      session: auditor,
      procedureId: seed.procedureId,
      versionId: draft.versionId,
      controlName: draft.controlName,
      expectedRowVersion: token,
      correlationId,
    });

    expect(outcome).toMatchObject({ ok: true, changed: false });
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses a second rename made while the first transaction is still open', async () => {
    const seed = await createProcedure(dependencies(), createInput({}, `${prefix}race-setup`));
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    created.push(seed.procedureId);

    /** Resolves when the test lets the first transaction commit. */
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * The real unit of work, held open after the command's work is done. Everything
     * inside — the lock, the read, the write, the append — has happened; the COMMIT has
     * not.
     */
    const held: AuditUnitOfWork<never> = {
      execute: (work: (context: never) => Promise<unknown>) =>
        new PostgresProceduresUnitOfWork(db).execute(async (context) => {
          const result = await work(context as never);
          await gate;
          return result;
        }) as never,
    };

    const listed = await new DrizzleProcedureRepository(db).listVersions(seed.procedureId);
    const draft = listed[0];
    if (draft === undefined) throw new Error('the seeded Draft is missing');
    const token = procedureVersionRowVersion({
      versionId: draft.versionId,
      procedureId: draft.procedureId,
      versionNumber: draft.versionNumber,
      state: draft.state,
      controlName: draft.controlName,
      templateId: draft.templateId,
      sections: draft.sections,
    });

    // The first rename wins the row lock, and its transaction stays open.
    const first = renameProcedureDraft(
      { ...dependencies(), unitOfWork: held as never },
      {
        session: auditor,
        procedureId: seed.procedureId,
        versionId: draft.versionId,
        controlName: `${prefix}Racing rename A`,
        expectedRowVersion: token,
        correlationId: `${prefix}race-a`,
      },
    );
    await wait(250);

    // The second tab was opened before the first rename, so it carries the same row
    // version. It must block on the row lock, then find the row changed — not sail
    // past and overwrite.
    const second = renameProcedureDraft(dependencies(), {
      session: auditor,
      procedureId: seed.procedureId,
      versionId: draft.versionId,
      controlName: `${prefix}Racing rename B`,
      expectedRowVersion: token,
      correlationId: `${prefix}race-b`,
    });
    await wait(250);
    openGate();

    expect(await first).toMatchObject({ ok: true, changed: true });
    expect(await second).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });

    // The first rename stands, and the stale tab wrote nothing.
    const { versions } = await rowsFor(seed.procedureId);
    expect(versions[0]?.control_name).toBe(`${prefix}Racing rename A`);
    await expect(eventsFor(`${prefix}race-b`)).resolves.toHaveLength(0);
  });

  /**
   * The guarantees that live in the table.
   *
   * These use raw SQL on purpose. A CHECK constraint exists precisely for the writer
   * that has not read the command — a migration, a restored dump, a psql session — so
   * asserting it through the command would prove nothing about the constraint.
   */
  describe('the database refuses what the command refuses', () => {
    const procedureId = '018f0000-0000-7000-8000-0000000000cc';
    const versionId = '018f0000-0000-7000-8000-0000000000cd';

    async function seedProcedureRow(): Promise<void> {
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
      await sql`
        INSERT INTO procedure (procedure_id, control_name, template_id)
        VALUES (${procedureId}, ${`${prefix}Raw host`}, 'P-1')
      `;
    }

    async function seedVersionRow(overrides: {
      versionNumber?: number;
      state?: string;
      controlName?: string;
    }): Promise<void> {
      await sql`DELETE FROM procedure_version WHERE version_id = ${versionId}`;
      await sql`
        INSERT INTO procedure_version
          (version_id, procedure_id, version_number, state, control_name, template_id, sections)
        VALUES (${versionId}, ${procedureId}, ${overrides.versionNumber ?? 1},
                ${overrides.state ?? 'DRAFT'}, ${overrides.controlName ?? `${prefix}Raw draft`},
                'P-1', ${JSON.stringify({
                  templateId: 'P-1',
                  sections: initialDraftSections('P-1'),
                })}::jsonb)
      `;
    }

    it('rejects a version state outside the addendum §E vocabulary', async () => {
      await seedProcedureRow();
      await expect(seedVersionRow({ state: 'CLOSED' })).rejects.toThrow(
        /procedure_version_state_vocabulary/,
      );
      // Every word of the real vocabulary is accepted, so the refusal above is about
      // the vocabulary and not about some other malformation.
      for (const state of PROCEDURE_VERSION_STATES) {
        await expect(seedVersionRow({ state })).resolves.toBeUndefined();
      }
      await sql`DELETE FROM procedure_version WHERE version_id = ${versionId}`;
    });

    it('rejects a Template id outside the four shipped Templates', async () => {
      await seedProcedureRow();
      await expect(
        sql`
          INSERT INTO procedure (procedure_id, control_name, template_id)
          VALUES ('018f0000-0000-7000-8000-0000000000ce', ${`${prefix}Raw P-9`}, 'P-9')
        `,
      ).rejects.toThrow(/procedure_template_vocabulary/);
    });

    it('rejects a blank Control name — btrim, so whitespace-only is blank', async () => {
      await seedProcedureRow();
      await expect(
        sql`
          INSERT INTO procedure (procedure_id, control_name, template_id)
          VALUES ('018f0000-0000-7000-8000-0000000000ce', '   ', 'P-1')
        `,
      ).rejects.toThrow(/procedure_control_name_present/);
      // The version table carries the same rule.
      await expect(seedVersionRow({ controlName: '   ' })).rejects.toThrow(
        /procedure_version_control_name_present/,
      );
    });

    it('rejects a version number below 1', async () => {
      await seedProcedureRow();
      await expect(seedVersionRow({ versionNumber: 0 })).rejects.toThrow(
        /procedure_version_number_at_least_one/,
      );
    });

    it('rejects two versions of one Procedure sharing a number', async () => {
      await seedProcedureRow();
      await seedVersionRow({ versionNumber: 1 });
      await expect(
        sql`
          INSERT INTO procedure_version
            (version_id, procedure_id, version_number, state, control_name, template_id, sections)
          VALUES ('018f0000-0000-7000-8000-0000000000cf', ${procedureId}, 1, 'DRAFT',
                  ${`${prefix}Duplicate number`}, 'P-1', '{}'::jsonb)
        `,
      ).rejects.toThrow(/procedure_version_procedure_number_uidx/);
      await sql`DELETE FROM procedure_version WHERE version_id = ${versionId}`;
    });

    it('ACCEPTS the rows the command would write, so the refusals above mean something', async () => {
      await seedProcedureRow();
      await expect(seedVersionRow({ versionNumber: 1 })).resolves.toBeUndefined();
      const { procedures, versions } = await rowsFor(procedureId);
      expect(procedures).toBe(1);
      expect(versions).toHaveLength(1);
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    });
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });
});
