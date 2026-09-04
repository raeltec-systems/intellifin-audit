import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createProcedure,
  PROCEDURE_AUTHOR_ACTION,
  PROCEDURE_CREATED_EVENT,
  PROCEDURE_DRAFT_CHANGED_EVENT,
  PROCEDURE_REFUSALS,
  procedureVersionRowVersion,
  renameProcedureDraft,
  updatePopulationDraft,
  updateTargetDraft,
  updateComplianceDraft,
  type DraftPopulationEdit,
  type DraftTargetEdit,
  type ComplianceDraftInput,
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
  bindingDigest,
  registrationDigest,
  initialDraftPopulation,
  initialDraftCompliance,
  complianceInputFromFields,
  COMPLIANCE_MESSAGES,
  POPULATION_DRAFT_MESSAGES,
  TARGET_DRAFT_MESSAGES,
} from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleProcedureRepository,
  DrizzleRegistrationRepository,
  DrizzleRoleRepository,
  PostgresAuditChainReader,
  PostgresProceduresUnitOfWork,
  PostgresRegistrationsUnitOfWork,
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

describe('generation 10 Compliance Rule backfill', () => {
  it('contains the exact typed defaults for all four Templates', () => {
    const migration = readFileSync(
      new URL('../../packages/infrastructure/drizzle/0010_lethal_hedge_knight.sql', import.meta.url),
      'utf8',
    );
    for (const templateId of ['P-1', 'P-2', 'P-3', 'P-4'] as const) {
      const match = new RegExp(`WHEN '${templateId}' THEN \\$json\\$(.*?)\\$json\\$::jsonb`, 's').exec(migration);
      expect(match?.[1], `${templateId} backfill`).toBeDefined();
      expect(JSON.parse(match![1]!)).toEqual(initialDraftCompliance(templateId).complianceConditions);
    }
    // The migration promotes this one section. It does not rewrite an older Draft's
    // population, targets, instructions, or retained section payload.
    const update = /UPDATE "procedure_version"([\s\S]*?)END;/.exec(migration)?.[0] ?? '';
    expect(update).not.toMatch(/"(?:period|scope|targets|instructions|sections)"\s*=/);
  });
});

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
  const sourceIds: string[] = [];
  const targetRegistrationIds: string[] = [];

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
    for (const id of sourceIds) await sql`DELETE FROM population_source_binding WHERE binding_id = ${id}`;
    for (const id of targetRegistrationIds) await sql`DELETE FROM target_system_registration WHERE registration_id = ${id}`;
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

    // UX-DR7 labels the card's cell "Active version". Answering it with the newest
    // version instead makes a Procedure whose only version is a Draft render
    // "Active version: Draft" — an absent value reading as present, which is what the
    // card's own wording rule exists to prevent. Story 2.1 writes only DRAFT.
    const repository = new DrizzleProcedureRepository(db);
    const summary = (await repository.listProcedures()).find(
      (candidate) => candidate.procedureId === outcome.procedureId,
    );
    expect(summary?.activeVersionState).toBeNull();
    expect(summary?.activeVersionNumber).toBeNull();
    expect((await repository.findProcedure(outcome.procedureId))?.activeVersionState).toBeNull();
    // The version really is there — the null above is a judgement, not an empty read.
    expect(await repository.listVersions(outcome.procedureId)).toHaveLength(1);

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
        ...draft,
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
      ...draft,
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
      ...draft,
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
          (version_id, procedure_id, version_number, state, control_name, template_id, sections, compliance_conditions)
        VALUES (${versionId}, ${procedureId}, ${overrides.versionNumber ?? 1},
                ${overrides.state ?? 'DRAFT'}, ${overrides.controlName ?? `${prefix}Raw draft`},
                'P-1', ${JSON.stringify({
                  templateId: 'P-1',
                  sections: initialDraftSections('P-1'),
                })}::jsonb, ${JSON.stringify(initialDraftCompliance('P-1').complianceConditions)}::jsonb)
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
            (version_id, procedure_id, version_number, state, control_name, template_id, sections, compliance_conditions)
          VALUES ('018f0000-0000-7000-8000-0000000000cf', ${procedureId}, 1, 'DRAFT',
                  ${`${prefix}Duplicate number`}, 'P-1', '{}'::jsonb, ${JSON.stringify(initialDraftCompliance('P-1').complianceConditions)}::jsonb)
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

  describe('generation 8 population authoring', () => {
    async function setupPopulation() {
      const bindingId = new CryptoUuidV7Generator().next();
      sourceIds.push(bindingId);
      const fields = { kind: 'versioned-file' as const, location: 'https://source.synthetic.invalid/leavers.csv', declaredSchema: ['employment_status', 'termination_effective_date'], declaredCountMechanism: 'none' as const, sensitiveFields: [] };
      const digest = bindingDigest(fields);
      await sql`INSERT INTO population_source_binding (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism, sensitive_fields, note, status, digest) VALUES (${bindingId}, ${`${prefix}source`}, ${fields.kind}, ${fields.location}, ${fields.declaredSchema}, ${fields.declaredCountMechanism}, ${fields.sensitiveFields}, '', 'active', ${digest})`;
      const seed = await createProcedure(dependencies(), createInput({}, `${prefix}population-create-${bindingId}`));
      if (!seed.ok) throw new Error(seed.reason);
      created.push(seed.procedureId);
      const read = async () => {
        const draft = await new DrizzleProcedureRepository(db).findVersion(seed.versionId);
        if (draft === null) throw new Error('Draft missing');
        return draft;
      };
      const edit: DraftPopulationEdit = { section: 'population-source', source: { mode: 'bind', bindingId, expectedDigest: digest }, inclusionRule: initialDraftPopulation('P-1').inclusionRule, zeroRecordPass: true, allowVersionedDuplicates: false };
      const input = { session: auditor, procedureId: seed.procedureId, versionId: seed.versionId, expectedRowVersion: procedureVersionRowVersion(await read()), correlationId: `${prefix}bind-${bindingId}`, edit };
      return { seed, bindingId, digest, input, read };
    }
    it('persists the exact snapshot, independent flags and missing-count blocker with one event', async () => {
      const { input, digest, bindingId, read } = await setupPopulation();
      expect(await updatePopulationDraft(dependencies(), input)).toMatchObject({ ok: true, changed: true });
      const saved = await read();
      expect(saved).toMatchObject({ sourceSnapshot: { bindingId, digest, contract: { declared_count_mechanism: 'none' } }, zeroRecordPass: true, allowVersionedDuplicates: false, populationBlockers: ['declared-count-missing'] });
      expect(await eventsFor(input.correlationId)).toHaveLength(1);
      await sql`UPDATE population_source_binding SET status = 'retired' WHERE binding_id = ${bindingId}`;
      const fresh = { ...input, expectedRowVersion: procedureVersionRowVersion(saved) };
      expect(await updatePopulationDraft(dependencies(), fresh)).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.SOURCE });
      expect(await updatePopulationDraft(dependencies(), { ...fresh, edit: { ...input.edit, source: { mode: 'retain' }, zeroRecordPass: false, allowVersionedDuplicates: true } as DraftPopulationEdit })).toMatchObject({ ok: true });
      const retained = await read();
      expect(retained.sourceSnapshot).toEqual(saved.sourceSnapshot);
      expect(retained.zeroRecordPass).toBe(false);
      expect(retained.allowVersionedDuplicates).toBe(true);
    });
    it('rolls back population fields if the audit append fails and refuses an old whole-row token', async () => {
      const { input, read } = await setupPopulation();
      const before = await read();
      await expect(updatePopulationDraft(dependencies({ failIds: true }), input)).rejects.toThrow();
      expect(await read()).toEqual(before);
      expect(await eventsFor(input.correlationId)).toHaveLength(0);
      const periodEdit = { ...input, edit: { section: 'period-scope' as const, period: { from: '2026-08-01', to: '2026-08-31' }, scope: '  Verbatim scope\n  ' } };
      expect(await updatePopulationDraft(dependencies(), periodEdit)).toMatchObject({ ok: true });
      expect(await read()).toMatchObject({ period: periodEdit.edit.period, scope: periodEdit.edit.scope });
      expect(await updatePopulationDraft(dependencies(), input)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
      expect((await read()).sourceSnapshot).toBeNull();
    });
    it('waits for a source update and refuses the changed digest instead of binding unseen data', async () => {
      const { input, bindingId, read } = await setupPopulation();
      let locked!: () => void, release!: () => void;
      const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
      const releaseGate = new Promise<void>((resolve) => { release = resolve; });
      const writer = sql.begin(async (tx) => {
        await tx`UPDATE population_source_binding SET digest = ${'f'.repeat(64)} WHERE binding_id = ${bindingId}`;
        locked();
        await releaseGate;
      });
      await lockedGate;
      const attempt = updatePopulationDraft(dependencies(), input);
      try {
        const finishedEarly = await Promise.race([attempt.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 75))]);
        expect(finishedEarly).toBe(false);
      } finally { release(); }
      await writer;
      expect(await attempt).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.STALE_SOURCE });
      expect((await read()).sourceSnapshot).toBeNull();
      expect(await eventsFor(input.correlationId)).toHaveLength(0);
    });
    it('refuses invalid raw SQL Period, rule, scope, snapshot and blocker data', async () => {
      const { seed } = await setupPopulation();
      for (const period of [{ from: '2025-02-29', to: '2025-03-01' }, { from: '2026-02-01', to: '2026-01-01' }, { from: '2026-01-01' }]) {
        await expect(sql`UPDATE procedure_version SET period = ${sql.json(period)} WHERE version_id = ${seed.versionId}`).rejects.toThrow();
      }
      await expect(sql`UPDATE procedure_version SET inclusion_rule = '{"schemaVersion":2,"all":[]}'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_rule_shape/);
      await expect(sql`UPDATE procedure_version SET source_snapshot = '{}'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_source_shape/);
      await expect(sql`UPDATE procedure_version SET population_blockers = '["declared-count-missing"]'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_count_blocker/);
      await expect(sql`UPDATE procedure_version SET scope = ${'x'.repeat(10001)} WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_scope_bound/);
      await expect(sql`UPDATE procedure_version SET period = '{"from":"2024-02-29","to":"2024-02-29"}'::jsonb WHERE version_id = ${seed.versionId}`).resolves.toBeDefined();
    });
  });

  describe('generation 9 Target System authoring', () => {
    interface Registered {
      readonly id: string;
      readonly digest: string;
    }
    interface RegFields {
      readonly kind: 'web' | 'desktop' | 'api';
      readonly allowedOrigins: readonly string[];
      readonly applicationIdentity: string;
      readonly credentialRef: string;
      readonly permittedActions: readonly ('navigate' | 'read-attribute' | 'list-records')[];
      readonly attributeLabelPatterns: readonly string[];
      readonly secondaryKey: string;
    }

    async function registerSystem(name: string, fields: RegFields): Promise<Registered> {
      const id = new CryptoUuidV7Generator().next();
      targetRegistrationIds.push(id);
      const digest = registrationDigest(fields);
      await sql`
        INSERT INTO target_system_registration
          (registration_id, display_name, kind, allowed_origins, application_identity,
           credential_ref, permitted_actions, attribute_label_patterns, secondary_key, note, status, digest)
        VALUES (${id}, ${`${prefix}${name}`}, ${fields.kind}, ${fields.allowedOrigins},
                ${fields.applicationIdentity}, ${fields.credentialRef}, ${fields.permittedActions},
                ${fields.attributeLabelPatterns}, ${fields.secondaryKey}, '', 'active', ${digest})
      `;
      return { id, digest };
    }

    async function setupTargets() {
      const web = await registerSystem('LoanCore', {
        kind: 'web',
        allowedOrigins: ['http://localhost:4300/loancore'],
        applicationIdentity: '',
        credentialRef: 'vault://audit/loancore',
        permittedActions: ['navigate', 'read-attribute'],
        attributeLabelPatterns: ['Status', 'Username'],
        secondaryKey: 'Full name',
      });
      const desktop = await registerSystem('LedgerDesk', {
        kind: 'desktop',
        allowedOrigins: [],
        applicationIdentity: 'com.northstar.ledgerdesk',
        credentialRef: 'vault://audit/ledgerdesk',
        permittedActions: ['navigate', 'read-attribute'],
        attributeLabelPatterns: ['Status'],
        secondaryKey: '',
      });
      const seed = await createProcedure(dependencies(), createInput({}, `${prefix}target-create-${web.id}`));
      if (!seed.ok) throw new Error(seed.reason);
      created.push(seed.procedureId);
      const read = async (): Promise<ProcedureVersionView> => {
        const draft = await new DrizzleProcedureRepository(db).findVersion(seed.versionId);
        if (draft === null) throw new Error('the Draft is missing');
        return draft;
      };
      const save = (
        edit: DraftTargetEdit,
        token: string,
        correlationId: string,
        procedureDependencies: ProcedureDependencies = dependencies(),
      ) =>
        updateTargetDraft(procedureDependencies, {
          session: auditor,
          procedureId: seed.procedureId,
          versionId: seed.versionId,
          expectedRowVersion: token,
          correlationId,
          edit,
        });
      const bind = (system: Registered) =>
        ({ mode: 'bind', registrationId: system.id, expectedDigest: system.digest }) as const;
      return { seed, web, desktop, read, save, bind };
    }

    async function waitForBlockedQuery(table: string): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await sql<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE ${`%${table}%`}
          ) AS waiting
        `;
        if (rows[0]?.waiting === true) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`No query waited for the held ${table} row lock`);
    }

    it('lists every active registration for a picker, even when administration reads are capped', async () => {
      const { web, desktop } = await setupTargets();
      const picker = new DrizzleRegistrationRepository(db, 1);

      const active = await picker.listActiveRegistrations();
      expect(active.map((registration) => registration.registrationId)).toEqual(
        expect.arrayContaining([web.id, desktop.id]),
      );

      await sql`UPDATE target_system_registration SET status = 'retired' WHERE registration_id = ${web.id}`;
      const afterRetirement = await picker.listActiveRegistrations();
      expect(afterRetirement.map((registration) => registration.registrationId)).not.toContain(web.id);
      expect(afterRetirement.map((registration) => registration.registrationId)).toContain(desktop.id);
    });

    it('freezes the six-field contract per system, keeps credentials out of the chain, and survives reload', async () => {
      const { seed, web, desktop, read, save, bind } = await setupTargets();
      const correlationId = `${prefix}targets-${seed.versionId}`;

      const outcome = await save(
        { section: 'target-systems', selections: [bind(web), bind(desktop)] },
        procedureVersionRowVersion(await read()),
        correlationId,
      );
      expect(outcome).toMatchObject({ ok: true, changed: true });

      const saved = await read();
      expect(saved.targets.map((target) => target.registrationId)).toEqual([web.id, desktop.id]);
      expect(saved.targets[0]?.contract).toMatchObject({ kind: 'web', credential_ref: 'vault://audit/loancore', secondary_key: 'Full name' });
      // The desktop application identity occupies the allowed_origins slot.
      expect(saved.targets[1]?.contract.allowed_origins).toEqual(['com.northstar.ledgerdesk']);

      const events = await eventsFor(correlationId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
      // The frozen contract carries the credential reference; the chain never does.
      expect(JSON.stringify(events[0]?.payload)).not.toContain('vault://');
    });

    it('refuses a changed digest and a retired newly-selected system without writing', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      // The registration moved after the page rendered its digest.
      await sql`UPDATE target_system_registration SET credential_ref = 'vault://audit/rotated', digest = ${registrationDigest({ kind: 'web', allowedOrigins: ['http://localhost:4300/loancore'], applicationIdentity: '', credentialRef: 'vault://audit/rotated', permittedActions: ['navigate', 'read-attribute'], attributeLabelPatterns: ['Status', 'Username'], secondaryKey: 'Full name' })} WHERE registration_id = ${web.id}`;
      const correlationId = `${prefix}unseen-${seed.versionId}`;
      expect(await save({ section: 'target-systems', selections: [bind(web)] }, procedureVersionRowVersion(await read()), correlationId)).toEqual({
        ok: false,
        reason: TARGET_DRAFT_MESSAGES.UNSEEN,
      });
      expect((await read()).targets).toHaveLength(0);
      await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
    });

    it('refuses a retired registration when binding a new target without writing', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      await sql`UPDATE target_system_registration SET status = 'retired' WHERE registration_id = ${web.id}`;
      const correlationId = `${prefix}retired-bind-${seed.versionId}`;

      expect(
        await save(
          { section: 'target-systems', selections: [bind(web)] },
          procedureVersionRowVersion(await read()),
          correlationId,
        ),
      ).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.INELIGIBLE });
      expect((await read()).targets).toHaveLength(0);
      await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
    });

    it('retains a saved snapshot verbatim after the registration is retired', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      await save({ section: 'target-systems', selections: [bind(web)] }, procedureVersionRowVersion(await read()), `${prefix}retain-a-${seed.versionId}`);
      const frozen = (await read()).targets[0];

      await sql`UPDATE target_system_registration SET status = 'retired' WHERE registration_id = ${web.id}`;
      // Retaining is allowed and refreshes nothing; the snapshot is unchanged.
      expect(await save({ section: 'target-systems', selections: [{ mode: 'retain', registrationId: web.id }] }, procedureVersionRowVersion(await read()), `${prefix}retain-b-${seed.versionId}`)).toMatchObject({ ok: true, changed: false });
      expect((await read()).targets[0]).toEqual(frozen);
    });

    it('stores per-system instructions verbatim, refuses an orphan, and survives reload', async () => {
      const { seed, web, desktop, read, save, bind } = await setupTargets();
      await save({ section: 'target-systems', selections: [bind(web), bind(desktop)] }, procedureVersionRowVersion(await read()), `${prefix}sel-${seed.versionId}`);

      const verbatim = '  Open the account record and note its status and roles.  ';
      const correlationId = `${prefix}instr-${seed.versionId}`;
      expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: web.id, text: verbatim }] }, procedureVersionRowVersion(await read()), correlationId)).toMatchObject({ ok: true, changed: true });
      expect((await read()).instructions).toEqual([{ registrationId: web.id, text: verbatim }]);

      // An instruction for an unselected system is an orphan.
      const orphanId = new CryptoUuidV7Generator().next();
      expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: orphanId, text: 'read it' }] }, procedureVersionRowVersion(await read()), `${prefix}orphan-${seed.versionId}`)).toEqual({
        ok: false,
        reason: TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION,
      });
      await expect(eventsFor(correlationId)).resolves.toHaveLength(1);
    });

    it('rolls back a target edit when the audit append fails', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      const before = await read();
      const correlationId = `${prefix}target-rollback-${seed.versionId}`;

      await expect(
        save(
          { section: 'target-systems', selections: [bind(web)] },
          procedureVersionRowVersion(before),
          correlationId,
          dependencies({ failIds: true }),
        ),
      ).rejects.toThrow();
      expect(await read()).toEqual(before);
      await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
    });

    it('rolls back an instruction edit when the audit append fails', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      await save(
        { section: 'target-systems', selections: [bind(web)] },
        procedureVersionRowVersion(await read()),
        `${prefix}instruction-rollback-selection-${seed.versionId}`,
      );
      const before = await read();
      const correlationId = `${prefix}instruction-rollback-${seed.versionId}`;

      await expect(
        save(
          {
            section: 'audit-instructions',
            instructions: [{ registrationId: web.id, text: 'Read the account status.' }],
          },
          procedureVersionRowVersion(before),
          correlationId,
          dependencies({ failIds: true }),
        ),
      ).rejects.toThrow();
      expect(await read()).toEqual(before);
      await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
    });

    it('waits for an in-flight registration change before refusing an unseen bind', async () => {
      const { seed, web, read, save, bind } = await setupTargets();
      const before = await read();

      let writerOpenedResolve: () => void = () => undefined;
      const writerOpened = new Promise<void>((resolve) => {
        writerOpenedResolve = resolve;
      });
      let releaseWriterResolve: () => void = () => undefined;
      const releaseWriter = new Promise<void>((resolve) => {
        releaseWriterResolve = resolve;
      });
      const writer = new PostgresRegistrationsUnitOfWork(db).execute(async ({ registrations }) => {
        const current = await registrations.findRegistration(web.id);
        if (current === null) throw new Error('the registration is missing');
        const credentialRef = 'vault://audit/rotated';
        await registrations.updateRegistration({
          ...current,
          credentialRef,
          digest: registrationDigest({
            kind: current.kind,
            allowedOrigins: current.allowedOrigins,
            applicationIdentity: current.applicationIdentity,
            credentialRef,
            permittedActions: current.permittedActions,
            attributeLabelPatterns: current.attributeLabelPatterns,
            secondaryKey: current.secondaryKey,
          }),
        });
        writerOpenedResolve();
        await releaseWriter;
      });
      await writerOpened;

      let bindingLockStartedResolve: () => void = () => undefined;
      const bindingLockStarted = new Promise<void>((resolve) => {
        bindingLockStartedResolve = resolve;
      });
      const waitingUnitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext> = {
        execute: (work) =>
          new PostgresProceduresUnitOfWork(db).execute(async (context) =>
            work({
              ...context,
              targetRegistrations: {
                lockForSelection: (registrationIds) => {
                  bindingLockStartedResolve();
                  return context.targetRegistrations.lockForSelection(registrationIds);
                },
              },
            }),
          ),
      };
      const correlationId = `${prefix}registration-lock-${seed.versionId}`;
      const attempt = save(
        { section: 'target-systems', selections: [bind(web)] },
        procedureVersionRowVersion(before),
        correlationId,
        dependencies({ unitOfWork: waitingUnitOfWork }),
      );
      await bindingLockStarted;
      try {
        await waitForBlockedQuery('target_system_registration');
      } finally {
        releaseWriterResolve();
      }

      await writer;
      expect(await attempt).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.UNSEEN });
      expect((await read()).targets).toHaveLength(0);
      await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
    });

    it('refuses a second target save made while the first transaction is still open', async () => {
      const { seed, web, desktop, read, bind } = await setupTargets();
      const token = procedureVersionRowVersion(await read());

      let enteredGateResolve: () => void = () => undefined;
      const enteredGate = new Promise<void>((resolve) => {
        enteredGateResolve = resolve;
      });
      let openGateResolve: () => void = () => undefined;
      const openGate = new Promise<void>((resolve) => {
        openGateResolve = resolve;
      });
      let releaseGateResolve: () => void = () => undefined;
      const releaseGate = new Promise<void>((resolve) => {
        releaseGateResolve = resolve;
      });
      const held: AuditUnitOfWork<never> = {
        execute: (work: (context: never) => Promise<unknown>) =>
          new PostgresProceduresUnitOfWork(db).execute(async (context) => {
            enteredGateResolve();
            const result = await work(context as never);
            openGateResolve();
            await releaseGate;
            return result;
          }) as never,
      };

      const first = updateTargetDraft(
        { ...dependencies(), unitOfWork: held as never },
        { session: auditor, procedureId: seed.procedureId, versionId: seed.versionId, expectedRowVersion: token, correlationId: `${prefix}race-t-a`, edit: { section: 'target-systems', selections: [bind(web)] } },
      );
      await enteredGate;
      await openGate;
      const second = updateTargetDraft(dependencies(), {
        session: auditor,
        procedureId: seed.procedureId,
        versionId: seed.versionId,
        expectedRowVersion: token,
        correlationId: `${prefix}race-t-b`,
        edit: { section: 'target-systems', selections: [bind(desktop)] },
      });
      try {
        await waitForBlockedQuery('procedure_version');
      } finally {
        releaseGateResolve();
      }

      expect(await first).toMatchObject({ ok: true, changed: true });
      expect(await second).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
      const finalTargets = (await read()).targets;
      expect(finalTargets.map((target) => target.registrationId)).toEqual([web.id]);
    });

    it('the database refuses a non-array in targets or instructions', async () => {
      const { seed } = await setupTargets();
      await expect(sql`UPDATE procedure_version SET targets = '"nope"'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_targets_shape/);
      await expect(sql`UPDATE procedure_version SET instructions = '{}'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_instructions_shape/);
      // The empty array the command writes is accepted.
      await expect(sql`UPDATE procedure_version SET targets = '[]'::jsonb WHERE version_id = ${seed.versionId}`).resolves.toBeDefined();
    });

    it('reads a raw snapshot array that fails domain validation as null', async () => {
      const { seed } = await setupTargets();
      await expect(
        sql`UPDATE procedure_version SET targets = '[{"invalid":true}]'::jsonb WHERE version_id = ${seed.versionId}`,
      ).resolves.toBeDefined();
      await expect(new DrizzleProcedureRepository(db).findVersion(seed.versionId)).resolves.toBeNull();
    });
  });

  describe('Compliance Rule authoring', () => {
    async function waitForProcedureVersionLock(): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await sql<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%procedure_version%'
          ) AS waiting
        `;
        if (rows[0]?.waiting === true) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('No query waited for the held procedure_version row lock');
    }

    async function setupCompliance(templateId: 'P-1' | 'P-2' | 'P-3' | 'P-4' = 'P-1') {
      const seed = await createProcedure(dependencies(), createInput({ templateId }, `${prefix}compliance-create-${crypto.randomUUID()}`));
      if (!seed.ok) throw new Error(seed.reason);
      created.push(seed.procedureId);
      const read = async (): Promise<ProcedureVersionView> => {
        const row = await new DrizzleProcedureRepository(db).findVersion(seed.versionId);
        if (row === null) throw new Error('the Compliance Draft is missing');
        return row;
      };
      const save = (
        edit: ComplianceDraftInput,
        expectedRowVersion: string,
        correlationId = `${prefix}compliance-${seed.versionId}`,
        procedureDependencies: ProcedureDependencies = dependencies(),
      ) => updateComplianceDraft(procedureDependencies, {
        session: auditor, procedureId: seed.procedureId, versionId: seed.versionId,
        expectedRowVersion, correlationId, edit,
      });
      return { seed, read, save };
    }

    it('applies generation 10 to a generation-9 row and preserves every prior authored section', async () => {
      const migration = readFileSync(
        new URL('../../packages/infrastructure/drizzle/0010_lethal_hedge_knight.sql', import.meta.url),
        'utf8',
      );
      const statements = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== '');
      const versionId = '018f0000-0000-7000-8000-000000002410';
      const procedureId = '018f0000-0000-7000-8000-000000002411';
      const registrationFields = {
        kind: 'web' as const,
        allowedOrigins: ['https://edited.example.invalid'],
        applicationIdentity: '',
        credentialRef: 'vault://edited-target',
        permittedActions: ['navigate', 'read-attribute'] as const,
        attributeLabelPatterns: ['Account status'],
        secondaryKey: 'Employee ID',
      };
      const registrationId = '018f0000-0000-7000-8000-000000002412';
      const editedTargets = [{
        registrationId,
        displayName: 'Edited target',
        digest: registrationDigest(registrationFields),
        contract: {
          kind: registrationFields.kind,
          allowed_origins: registrationFields.allowedOrigins,
          credential_ref: registrationFields.credentialRef,
          permitted_actions: registrationFields.permittedActions,
          attribute_label_patterns: registrationFields.attributeLabelPatterns,
          secondary_key: registrationFields.secondaryKey,
        },
      }];
      const editedInstructions = [{ registrationId, text: 'Read the edited account status.' }];
      const editedSections = initialDraftSections('P-3').map((section) =>
        section.heading === 'Objective' ? { ...section, content: 'Edited objective retained from generation 9.' } : section,
      );
      const editedPopulation = {
        period: { from: '2026-07-01', to: '2026-07-31' },
        scope: 'Edited population scope retained from generation 9.',
        inclusionRule: initialDraftPopulation('P-3').inclusionRule,
        zeroRecordPass: true,
        allowVersionedDuplicates: true,
        populationBlockers: [] as const,
      };

      const dedicated = createSqlClient(databaseUrl as string, { max: 1 });
      try {
        await dedicated`CREATE TEMP TABLE procedure_version (LIKE public.procedure_version INCLUDING ALL)`;
        await dedicated`ALTER TABLE procedure_version DROP COLUMN compliance_schema_version, DROP COLUMN compliance_compiler_version, DROP COLUMN compliance_conditions, DROP COLUMN agent_judged_threshold`;
        await dedicated`CREATE TEMP TABLE schema_meta (LIKE public.schema_meta INCLUDING ALL)`;
        await dedicated`INSERT INTO schema_meta (version) VALUES (9)`;
        await dedicated`
          INSERT INTO procedure_version
            (version_id, procedure_id, version_number, state, control_name, template_id,
             sections, period, scope, source_snapshot, inclusion_rule, zero_record_pass,
             allow_versioned_duplicates, population_blockers, targets, instructions)
          VALUES
            (${versionId}, ${procedureId}, 1, 'DRAFT', 'Edited generation-9 Draft', 'P-3',
             ${dedicated.json(editedSections as unknown as Parameters<typeof dedicated.json>[0])},
             ${dedicated.json(editedPopulation.period)},
             ${editedPopulation.scope}, NULL,
             ${dedicated.json(editedPopulation.inclusionRule as unknown as Parameters<typeof dedicated.json>[0])},
             ${editedPopulation.zeroRecordPass}, ${editedPopulation.allowVersionedDuplicates},
             ${dedicated.json(editedPopulation.populationBlockers as unknown as Parameters<typeof dedicated.json>[0])},
             ${dedicated.json(editedTargets as unknown as Parameters<typeof dedicated.json>[0])},
             ${dedicated.json(editedInstructions as unknown as Parameters<typeof dedicated.json>[0])})
        `;
        for (const statement of statements) await dedicated.unsafe(statement);

        const repository = new DrizzleProcedureRepository(createDb(dedicated));
        const migrated = await repository.findVersion(versionId);
        expect(migrated).not.toBeNull();
        expect(migrated).toMatchObject({
          ...initialDraftCompliance('P-3'),
          ...editedPopulation,
          sections: editedSections,
          targets: editedTargets,
          instructions: editedInstructions,
        });
        await expect(dedicated`SELECT version FROM schema_meta ORDER BY version`).resolves.toEqual(
          expect.arrayContaining([{ version: 9 }, { version: 10 }]),
        );
      } finally {
        await dedicated.end({ timeout: 5 });
      }
    });

    it.each(['P-1', 'P-2', 'P-3', 'P-4'] as const)('creates %s with typed Template conditions', async (templateId) => {
      const { read } = await setupCompliance(templateId);
      expect(await read()).toMatchObject(initialDraftCompliance(templateId));
    });

    it('persists edits and exact decimals across a repository reload with text-free audit metadata', async () => {
      const { seed, read, save } = await setupCompliance('P-1');
      const before = await read();
      const text = 'Inspect using vault://secret-reference and professional judgment.';
      const input = complianceInputFromFields(before);
      const edit = { ...input, confidenceThreshold: '0.8500', conditions: input.conditions.map((condition, index) => index === 0 ? { ...condition, text } : condition) };
      const correlationId = `${prefix}compliance-edit-${seed.versionId}`;
      expect(await save(edit, procedureVersionRowVersion(before), correlationId)).toMatchObject({ ok: true, changed: true });
      const reloaded = await read();
      expect(reloaded.agentJudgedThreshold).toBe('0.8500');
      expect(reloaded.complianceConditions[0]).toMatchObject({ text, status: 'AGENT_JUDGED', rule: null });
      const events = await eventsFor(correlationId);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        section: 'compliance-rule',
        current: {
          conditions: [
            expect.objectContaining({ textLength: text.length }),
            expect.objectContaining({ conditionId: 'C2' }),
          ],
        },
      });
      expect(JSON.stringify(events)).not.toContain('vault://');
    });

    it('makes an unchanged save idle and refuses malformed input without a row or event', async () => {
      const { seed, read, save } = await setupCompliance();
      const before = await read(), input = complianceInputFromFields(before);
      const correlationId = `${prefix}compliance-idle-${seed.versionId}`;
      expect(await save(input, procedureVersionRowVersion(before), correlationId)).toMatchObject({ ok: true, changed: false });
      expect(await save({ ...input, confidenceThreshold: '1.01' }, procedureVersionRowVersion(before), correlationId)).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.CONFIDENCE });
      expect(await read()).toEqual(before);
      expect(await eventsFor(correlationId)).toHaveLength(0);
    });

    it('refuses a non-Draft, stale cross-section token, and forbidden role', async () => {
      const { seed, read, save } = await setupCompliance();
      const before = await read(), input = complianceInputFromFields(before);
      expect(await save(input, 'stale')).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
      await sql`UPDATE procedure_version SET state = 'SUBMITTED' WHERE version_id = ${seed.versionId}`;
      const submitted = await read();
      expect(await save(input, procedureVersionRowVersion(submitted))).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT });
      await sql`UPDATE procedure_version SET state = 'DRAFT' WHERE version_id = ${seed.versionId}`;
      const restored = await read();
      await expect(updateComplianceDraft(dependencies(), { session: administrator, procedureId: seed.procedureId, versionId: seed.versionId, expectedRowVersion: procedureVersionRowVersion(restored), correlationId: `${prefix}compliance-denied-${seed.versionId}`, edit: input })).resolves.toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });

      const oldToken = procedureVersionRowVersion(restored);
      expect(await save({ ...input, confidenceThreshold: '0.91' }, oldToken)).toMatchObject({ ok: true, changed: true });
      expect(await updatePopulationDraft(dependencies(), { session: auditor, procedureId: seed.procedureId, versionId: seed.versionId, expectedRowVersion: oldToken, correlationId: `${prefix}compliance-cross-section-${seed.versionId}`, edit: { section: 'period-scope', period: { from: '2026-07-01', to: '2026-07-31' }, scope: 'stale save' } })).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
    });

    it('blocks a concurrent population save, then refuses its stale whole-row token', async () => {
      const { seed, read, save } = await setupCompliance();
      const before = await read();
      const token = procedureVersionRowVersion(before);
      let openedResolve: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => { openedResolve = resolve; });
      let releaseResolve: () => void = () => undefined;
      const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
      const held: AuditUnitOfWork<never> = {
        execute: (work: (context: never) => Promise<unknown>) =>
          new PostgresProceduresUnitOfWork(db).execute(async (context) => {
            const result = await work(context as never);
            openedResolve();
            await release;
            return result;
          }) as never,
      };
      const complianceCorrelation = `${prefix}compliance-race-winner-${seed.versionId}`;
      const populationCorrelation = `${prefix}compliance-race-loser-${seed.versionId}`;
      const winner = save(
        { ...complianceInputFromFields(before), confidenceThreshold: '0.92' },
        token,
        complianceCorrelation,
        dependencies({ unitOfWork: held as never }),
      );
      await opened;
      const loser = updatePopulationDraft(dependencies(), {
        session: auditor,
        procedureId: seed.procedureId,
        versionId: seed.versionId,
        expectedRowVersion: token,
        correlationId: populationCorrelation,
        edit: { section: 'period-scope', period: { from: '2026-07-01', to: '2026-07-31' }, scope: 'must not win' },
      });
      try {
        await waitForProcedureVersionLock();
      } finally {
        releaseResolve();
      }

      expect(await winner).toMatchObject({ ok: true, changed: true });
      expect(await loser).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
      expect((await read()).scope).toBe(before.scope);
      await expect(eventsFor(populationCorrelation)).resolves.toHaveLength(0);
    });

    it('rolls back the Compliance edit when its audit append fails', async () => {
      const { seed, read, save } = await setupCompliance();
      const before = await read(), input = complianceInputFromFields(before);
      const correlationId = `${prefix}compliance-rollback-${seed.versionId}`;
      await expect(save({ ...input, confidenceThreshold: '0.91' }, procedureVersionRowVersion(before), correlationId, dependencies({ failIds: true }))).rejects.toThrow();
      expect(await read()).toEqual(before);
      expect(await eventsFor(correlationId)).toHaveLength(0);
    });

    it('reads a row whose deep condition shape was corrupted as null', async () => {
      const { seed } = await setupCompliance();
      await sql`UPDATE procedure_version SET compliance_conditions = '[{"conditionId":"C1"}]'::jsonb WHERE version_id = ${seed.versionId}`;
      await expect(new DrizzleProcedureRepository(db).findVersion(seed.versionId)).resolves.toBeNull();
    });

    it('enforces the version, count, and exact confidence range in PostgreSQL', async () => {
      const { seed } = await setupCompliance();
      await expect(sql`UPDATE procedure_version SET compliance_schema_version = 2 WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_compliance_schema/);
      await expect(sql`UPDATE procedure_version SET compliance_conditions = '[]'::jsonb WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_compliance_shape/);
      await expect(sql`UPDATE procedure_version SET agent_judged_threshold = '1.01' WHERE version_id = ${seed.versionId}`).rejects.toThrow(/procedure_version_confidence_range/);
      await expect(sql`UPDATE procedure_version SET agent_judged_threshold = '0.8000' WHERE version_id = ${seed.versionId}`).resolves.toBeDefined();
    });
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });
});
