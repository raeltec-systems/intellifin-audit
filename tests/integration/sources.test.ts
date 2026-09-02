import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BINDING_ANNOTATED_EVENT,
  BINDING_CHANGED_EVENT,
  BINDING_REFUSALS,
  bindingRowVersion,
  changePopulationSource,
  registerPopulationSource,
  type AuditUnitOfWork,
  type BindingDependencies,
  type BindingFields,
  type SessionSnapshot,
  type SourcesUnitOfWorkContext,
} from '@intellifin/application';
import { bindingDigest } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleBindingRepository,
  DrizzleRoleRepository,
  PostgresAuditChainReader,
  PostgresSourcesUnitOfWork,
  createDb,
  createSeedAuth,
  createSqlClient,
  type Auth,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

/**
 * Population Source bindings against a real, migrated PostgreSQL 18 (FR-6, FR-41, FR-45,
 * AD-8).
 *
 * Everything here is about promises only a real transaction can keep: the binding and its
 * `configuration.binding-changed` event commit together or not at all, and a refused save
 * leaves the table exactly as it was. A fake unit of work can be written to behave that
 * way; PostgreSQL either does or does not.
 *
 * It also asserts the guarantees that live in the DATABASE rather than in code — the
 * masking subset CHECK, the non-empty schema CHECK, the location rule, the vocabularies
 * and the digest format. All are attempted with raw SQL, because the point of a
 * constraint is that it holds against a writer that has not read the command.
 *
 * And it exercises the stale-row guard with one transaction HELD OPEN. Two calls started
 * at once prove nothing: they finish quickly enough that one commits before the other
 * reads, and the test passes with the `SELECT ... FOR UPDATE` removed.
 *
 * Nothing here migrates. Rows are namespaced by process id and deleted afterwards, and
 * the `platform` chain is verified at the end.
 */

const databaseUrl = process.env['DATABASE_URL'];
const SECRET = 'integration-test-secret-not-a-real-one';
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const AUTH_CONFIG = { secret: SECRET, baseUrl: BASE_URL };

describe.skipIf(!databaseUrl)('Population Source bindings against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let seedAuth: Auth;
  const prefix = `story-1-7-${process.pid}-`;
  const emailFor = (label: string) => `${prefix}${label}@synthetic.invalid`;

  let admin: SessionSnapshot;
  let auditor: SessionSnapshot;
  /** Binding ids this suite created, deleted in `afterAll`. */
  const created: string[] = [];

  function fields(overrides: Partial<BindingFields> = {}): BindingFields {
    return {
      displayName: `${prefix}HR leavers export`,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
      declaredSchema: ['employee_id', 'employment_status', 'termination_date', 'salary'],
      declaredCountMechanism: 'cover-sheet',
      sensitiveFields: ['salary'],
      note: '',
      status: 'active',
      ...overrides,
    };
  }

  function dependencies(
    options: { failIds?: boolean; unitOfWork?: AuditUnitOfWork<SourcesUnitOfWorkContext> } = {},
  ): BindingDependencies {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork:
        options.unitOfWork ??
        new PostgresSourcesUnitOfWork(
          db,
          // An id generator that produces something the canonical envelope rejects, so the
          // append throws AFTER the state write inside the same transaction — the ordering
          // the atomicity claim is actually about.
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

  async function rowFor(bindingId: string) {
    const rows = await sql<
      {
        digest: string;
        display_name: string;
        location: string;
        declared_schema: string[];
        declared_count_mechanism: string;
        sensitive_fields: string[];
        status: string;
      }[]
    >`
      SELECT digest, display_name, location, declared_schema, declared_count_mechanism,
             sensitive_fields, status
      FROM population_source_binding WHERE binding_id = ${bindingId}
    `;
    return rows[0] ?? null;
  }

  /**
   * The row version the surface would have rendered, read from the real row.
   *
   * Read through the repository rather than reconstructed in the test: a token the test
   * builds from its own idea of the row would agree with itself and prove nothing about
   * what the command compares against.
   */
  async function rowVersionOf(bindingId: string): Promise<string> {
    const record = await new DrizzleBindingRepository(db).findBinding(bindingId);
    if (record === null) throw new Error(`no binding ${bindingId}`);
    return bindingRowVersion(record);
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

    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM audit_events WHERE correlation_id LIKE ${`${prefix}%`}`;

    const one = await seedAuth.api.signUpEmail({
      body: { email: emailFor('admin'), name: 'Synthetic Administrator', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${one.user.id}, 'poc-administrator')`;
    admin = await createSession(one.user.id, 'admin');

    const two = await seedAuth.api.signUpEmail({
      body: { email: emailFor('auditor'), name: 'Synthetic Auditor', password: PASSWORD },
    });
    await sql`INSERT INTO user_role (user_id, role) VALUES (${two.user.id}, 'auditor')`;
    auditor = await createSession(two.user.id, 'auditor');
  });

  afterAll(async () => {
    for (const bindingId of created) {
      await sql`DELETE FROM population_source_binding WHERE binding_id = ${bindingId}`;
    }
    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`${prefix}%`}`;
    // The events stay: deleting them would leave `audit_event_heads` pointing past the
    // rows that remain, which is a corrupt chain — the thing the last test verifies.
    await sql.end({ timeout: 5 });
  });

  async function register(
    overrides: Partial<BindingFields> = {},
    correlationId = `${prefix}create`,
    options: Parameters<typeof dependencies>[0] = {},
  ) {
    const outcome = await registerPopulationSource(dependencies(options), {
      ...fields(overrides),
      session: admin,
      correlationId,
    });
    if (outcome.ok) created.push(outcome.bindingId);
    return outcome;
  }

  it('writes the binding, its digest and one event in one transaction', async () => {
    const correlationId = `${prefix}create`;
    const outcome = await register({}, correlationId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const row = await rowFor(outcome.bindingId);
    expect(row?.digest).toBe(outcome.digest);
    // The stored digest is the domain module's, not something the adapter recomputed.
    expect(row?.digest).toBe(
      bindingDigest({
        kind: 'versioned-file',
        location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
        declaredSchema: ['employee_id', 'employment_status', 'termination_date', 'salary'],
        declaredCountMechanism: 'cover-sheet',
        sensitiveFields: ['salary'],
      }),
    );
    // The row holds exactly what the digest hashed: the schema in the typed order, the
    // sensitive fields sorted. If they disagreed, a later save that changed neither would
    // move the digest.
    expect(row?.declared_schema).toEqual([
      'employee_id',
      'employment_status',
      'termination_date',
      'salary',
    ]);
    expect(row?.sensitive_fields).toEqual(['salary']);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'configuration.binding-created',
      outcome: 'success',
      actor_id: admin.userId,
      aggregate_id: outcome.bindingId,
    });
  });

  it('gives all three kinds different digests, and reads them all back', async () => {
    const digests = new Set<string>();
    for (const [index, kind] of (
      ['manual-upload', 'versioned-file', 'read-only-api'] as const
    ).entries()) {
      const outcome = await register(
        {
          displayName: `${prefix}Kind ${kind}`,
          kind,
          location: kind === 'manual-upload' ? '' : 'https://kinds.synthetic.invalid/rows',
        },
        `${prefix}kind-${index}`,
      );
      expect(outcome.ok, kind).toBe(true);
      if (outcome.ok) digests.add(outcome.digest);
    }
    expect(digests.size).toBe(3);

    const listed = await new DrizzleBindingRepository(db).listBindings();
    const mine = listed.filter((row) => row.displayName.startsWith(`${prefix}Kind `));
    expect(mine).toHaveLength(3);
    const upload = mine.find((row) => row.kind === 'manual-upload');
    expect(upload?.location).toBe('');
  });

  it('SAVES a binding that declares no expected count, and says so', async () => {
    const correlationId = `${prefix}no-count`;
    const outcome = await register(
      { displayName: `${prefix}No count`, declaredCountMechanism: 'none' },
      correlationId,
    );

    expect(outcome).toMatchObject({ ok: true, declaresNoCount: true });
    if (!outcome.ok) return;
    expect((await rowFor(outcome.bindingId))?.declared_count_mechanism).toBe('none');
    // It is a save, not a refusal: the absence has to be visible somewhere a person can
    // close it, and a binding that does not exist shows nobody anything.
    expect(await eventsFor(correlationId)).toHaveLength(1);
  });

  it('refuses a sensitive field the schema does not declare, storing nothing', async () => {
    const correlationId = `${prefix}bad-mask`;
    const outcome = await register(
      { displayName: `${prefix}Bad mask`, sensitiveFields: ['salary', 'bonus'] },
      correlationId,
    );

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.SENSITIVE_NOT_DECLARED });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM population_source_binding
      WHERE display_name = ${`${prefix}Bad mask`}
    `;
    expect(rows[0]?.c).toBe(0);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('stores nothing when the audit append fails', async () => {
    const correlationId = `${prefix}append-fails`;

    await expect(
      register({ displayName: `${prefix}Never stored` }, correlationId, { failIds: true }),
    ).rejects.toThrow();

    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM population_source_binding
      WHERE display_name = ${`${prefix}Never stored`}
    `;
    expect(rows[0]?.c).toBe(0);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('recomputes the digest and publishes binding-changed in the same transaction', async () => {
    const seed = await register({ displayName: `${prefix}Changing` }, `${prefix}change-setup`);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const correlationId = `${prefix}change`;

    const outcome = await changePopulationSource(dependencies(), {
      ...fields({
        displayName: `${prefix}Changing`,
        location: 's3://synthetic-bucket/hr/leavers/2026-09.csv',
      }),
      session: admin,
      correlationId,
      bindingId: seed.bindingId,
      expectedRowVersion: await rowVersionOf(seed.bindingId),
    });

    expect(outcome).toMatchObject({ ok: true, published: true, priorDigest: seed.digest });
    expect((await rowFor(seed.bindingId))?.digest).not.toBe(seed.digest);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: BINDING_CHANGED_EVENT,
      aggregate_id: seed.bindingId,
    });
    expect(events[0]?.payload).toMatchObject({
      priorDigest: seed.digest,
      changedFields: ['location'],
    });
  });

  it('writes binding-annotated and no new digest when only a non-digest field changes', async () => {
    const seed = await register({ displayName: `${prefix}Renaming` }, `${prefix}rename-setup`);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const correlationId = `${prefix}rename`;

    const outcome = await changePopulationSource(dependencies(), {
      ...fields({ displayName: `${prefix}Renamed`, note: 'an operator note' }),
      session: admin,
      correlationId,
      bindingId: seed.bindingId,
      expectedRowVersion: await rowVersionOf(seed.bindingId),
    });

    expect(outcome).toMatchObject({
      ok: true,
      published: false,
      annotated: true,
      digest: seed.digest,
    });
    const row = await rowFor(seed.bindingId);
    expect(row?.display_name).toBe(`${prefix}Renamed`);
    expect(row?.digest).toBe(seed.digest);
    // The row moved, so the chain has to say so — under the event type Epic 2 does not
    // read, so a rename mints no platform-authored draft.
    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe(BINDING_ANNOTATED_EVENT);
  });

  it('writes nothing to the chain when a save moves nothing at all', async () => {
    const seed = await register({ displayName: `${prefix}Idle` }, `${prefix}idle-setup`);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const correlationId = `${prefix}idle`;

    const outcome = await changePopulationSource(dependencies(), {
      ...fields({ displayName: `${prefix}Idle` }),
      session: admin,
      correlationId,
      bindingId: seed.bindingId,
      expectedRowVersion: await rowVersionOf(seed.bindingId),
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('leaves the binding untouched when the change event cannot be appended', async () => {
    const seed = await register({ displayName: `${prefix}Untouched` }, `${prefix}untouched-setup`);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const correlationId = `${prefix}untouched`;

    await expect(
      changePopulationSource(dependencies({ failIds: true }), {
        ...fields({
          displayName: `${prefix}Untouched`,
          location: 's3://never.synthetic.invalid/rows.csv',
        }),
        session: admin,
        correlationId,
        bindingId: seed.bindingId,
        expectedRowVersion: await rowVersionOf(seed.bindingId),
      }),
    ).rejects.toThrow();

    // The write happened before the append inside the same transaction, and it is gone.
    expect((await rowFor(seed.bindingId))?.digest).toBe(seed.digest);
    await expect(eventsFor(correlationId)).resolves.toHaveLength(0);
  });

  it('refuses an Auditor and appends security.denied instead', async () => {
    const correlationId = `${prefix}denied`;
    const outcome = await registerPopulationSource(dependencies(), {
      ...fields({ displayName: `${prefix}Should not exist` }),
      session: auditor,
      correlationId,
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    const rows = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM population_source_binding
      WHERE display_name = ${`${prefix}Should not exist`}
    `;
    expect(rows[0]?.c).toBe(0);

    const events = await eventsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'security.denied', outcome: 'denied' });
    expect(events[0]?.payload).toMatchObject({ action: 'administration.bindings.manage' });
  });

  /**
   * The stale-row guard, against the interleaving it exists for.
   *
   * Starting two changes at once does NOT reproduce it: they finish quickly enough that
   * one commits before the other reads, and the test passes with the `SELECT ... FOR
   * UPDATE` in `DrizzleBindingWriter.findBinding` removed — which makes it evidence of
   * nothing. So the first transaction is held OPEN after its work and before its commit,
   * and the second is run inside that window.
   *
   * The retirement is the case that matters. `status` is not one of the five
   * digest-bearing fields, so a digest-shaped token would let the second save through and
   * silently set a retired binding back to active.
   */
  it('refuses a second change made while the first transaction is still open', async () => {
    const seed = await register({ displayName: `${prefix}Racing` }, `${prefix}race-setup`);
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;

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
    const held: AuditUnitOfWork<SourcesUnitOfWorkContext> = {
      execute: (work) =>
        new PostgresSourcesUnitOfWork(db).execute(async (context) => {
          const result = await work(context);
          await gate;
          return result;
        }),
    };

    const rowVersion = await rowVersionOf(seed.bindingId);

    // The first administrator retires the binding, and the transaction stays open.
    const first = changePopulationSource(dependencies({ unitOfWork: held }), {
      ...fields({ displayName: `${prefix}Racing`, status: 'retired' }),
      session: admin,
      correlationId: `${prefix}race-a`,
      bindingId: seed.bindingId,
      expectedRowVersion: rowVersion,
    });
    await wait(250);

    // The second administrator's tab was opened before the retirement, so it carries the
    // same row version and `status: 'active'`. It must block on the row lock, then find
    // the row changed — not sail past and revert the retirement.
    const second = changePopulationSource(dependencies(), {
      ...fields({ displayName: `${prefix}Racing`, note: 'typed in the stale tab' }),
      session: admin,
      correlationId: `${prefix}race-b`,
      bindingId: seed.bindingId,
      expectedRowVersion: rowVersion,
    });
    await wait(250);
    openGate();

    expect(await first).toMatchObject({ ok: true, annotated: true });
    expect(await second).toEqual({ ok: false, reason: BINDING_REFUSALS.STALE_ROW });

    // The retirement stands, and the stale tab wrote nothing.
    const row = await rowFor(seed.bindingId);
    expect(row?.status).toBe('retired');
    await expect(eventsFor(`${prefix}race-b`)).resolves.toHaveLength(0);
  });

  /**
   * The guarantees that live in the table.
   *
   * These use raw SQL on purpose. A CHECK constraint exists precisely for the writer that
   * has not read the command — a migration, a restored dump, a psql session — so
   * asserting it through the command would prove nothing about the constraint.
   */
  describe('the database refuses what the command refuses', () => {
    const id = '018f0000-0000-7000-8000-0000000000cc';
    const digest = 'a'.repeat(64);

    it('rejects a mask over a field the schema does not declare', async () => {
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'versioned-file', 's3://x/y.csv',
                  ARRAY['employee_id'], 'cover-sheet', ARRAY['salary'], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_sensitive_fields_declared/);
    });

    it('rejects an empty declared schema', async () => {
      // `cardinality`, not `array_length(x, 1)`: the latter is NULL for an empty array and
      // a NULL CHECK passes, so the obvious spelling accepts exactly this row.
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'versioned-file', 's3://x/y.csv',
                  ARRAY[]::text[], 'cover-sheet', ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_schema_present/);
    });

    it('rejects a versioned file with no location', async () => {
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'versioned-file', '   ',
                  ARRAY['employee_id'], 'cover-sheet', ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_location_matches_kind/);
    });

    it('rejects a manual upload that names a location', async () => {
      // The digest deliberately drops it, so the row would say something the frozen
      // contract does not.
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'manual-upload', 's3://x/y.csv',
                  ARRAY['employee_id'], 'cover-sheet', ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_location_matches_kind/);
    });

    it('rejects a kind outside the vocabulary', async () => {
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'sftp', 's3://x/y.csv',
                  ARRAY['employee_id'], 'cover-sheet', ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_kind_vocabulary/);
    });

    it('rejects a declared-count mechanism outside the vocabulary', async () => {
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'versioned-file', 's3://x/y.csv',
                  ARRAY['employee_id'], 'trust-me', ARRAY[]::text[], ${digest})
        `,
      ).rejects.toThrow(/population_source_binding_mechanism_vocabulary/);
    });

    it('rejects a digest that is not lower-case SHA-256 hex', async () => {
      await expect(
        sql`
          INSERT INTO population_source_binding
            (binding_id, display_name, kind, location, declared_schema,
             declared_count_mechanism, sensitive_fields, digest)
          VALUES (${id}, ${`${prefix}Raw`}, 'versioned-file', 's3://x/y.csv',
                  ARRAY['employee_id'], 'cover-sheet', ARRAY[]::text[], 'NOT-A-DIGEST')
        `,
      ).rejects.toThrow(/population_source_binding_digest_format/);
    });

    it('ACCEPTS the row the command would write, so the refusals above mean something', async () => {
      // Without this, every constraint test above would still pass if the INSERT were
      // malformed for some unrelated reason. The delete first keeps this independent of
      // whether an earlier insert in this block unexpectedly succeeded.
      await sql`DELETE FROM population_source_binding WHERE binding_id = ${id}`;
      await sql`
        INSERT INTO population_source_binding
          (binding_id, display_name, kind, location, declared_schema,
           declared_count_mechanism, sensitive_fields, digest)
        VALUES (${id}, ${`${prefix}Raw accepted`}, 'versioned-file', 's3://x/y.csv',
                ARRAY['employee_id', 'salary'], 'cover-sheet', ARRAY['salary'], ${digest})
      `;
      await sql`DELETE FROM population_source_binding WHERE binding_id = ${id}`;
    });
  });

  it('leaves the platform chain verifiable after every event this suite appended', async () => {
    const result = await new PostgresAuditChainReader(db).verify('platform');
    expect(result.valid).toBe(true);
  });
});
