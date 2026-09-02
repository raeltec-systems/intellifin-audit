import { describe, expect, it } from 'vitest';

import { bindingDigest, type DeclaredCountMechanism } from '@intellifin/domain';

import type { AuditEventDraft } from '@intellifin/domain';
import type { AuditUnitOfWork } from '../audit/ports.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  BINDING_ANNOTATED_EVENT,
  BINDING_CHANGED_EVENT,
  BINDING_CREATED_EVENT,
  BINDING_REFUSALS,
  bindingRowVersion,
  changePopulationSource,
  registerPopulationSource,
  type BindingDependencies,
  type BindingFields,
} from './register-population-source.js';
import type { BindingRecord, SourcesUnitOfWorkContext } from './ports.js';

/**
 * The binding commands, against fakes (FR-6, FR-41, FR-45, AD-7, AD-8).
 *
 * The fake unit of work is transactional in the one way that matters: it records writes
 * into a scratch copy and commits them only if the callback resolves. A fake that
 * applied writes immediately would let "nothing was stored" pass while the real
 * transaction stored something, which is the exact claim these tests exist to make.
 * `tests/integration/sources.test.ts` then makes the same claims against a real
 * PostgreSQL, because only PostgreSQL can prove PostgreSQL.
 */

const ADMIN: SessionSnapshot = { userId: 'admin-1', sessionId: 'session-1' };
const AUDITOR: SessionSnapshot = { userId: 'auditor-1', sessionId: 'session-2' };

const FIELDS: BindingFields = {
  displayName: 'HR leavers export',
  kind: 'versioned-file',
  location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
  declaredSchema: ['employee_id', 'employment_status', 'termination_date', 'salary'],
  declaredCountMechanism: 'cover-sheet',
  sensitiveFields: ['salary'],
  note: '',
  status: 'active',
};

interface Harness {
  readonly dependencies: BindingDependencies;
  /** Committed rows, by id. A rolled-back transaction never reaches this. */
  readonly stored: Map<string, BindingRecord>;
  /** Committed audit events, in order. */
  readonly events: AuditEventDraft[];
  /** Set to make the append throw, so a failed append can be observed. */
  failAppend: boolean;
  /**
   * How many transactions COMMITTED, and how many rolled back.
   *
   * Without this a refusal raised from inside the unit of work is indistinguishable from
   * one returned from it, because both leave the store untouched when nothing has been
   * written yet — and "nothing has been written yet" is a property of the current
   * statement order, not of the design. A returned refusal COMMITS, and the day a write
   * moves above the guard that becomes a change PostgreSQL was told to keep.
   */
  readonly transactions: { committed: number; rolledBack: number };
}

function harness(
  options: { readonly role?: 'poc-administrator' | 'auditor' | null } = {},
): Harness {
  const stored = new Map<string, BindingRecord>();
  const events: AuditEventDraft[] = [];
  const state = { failAppend: false };
  const transactions = { committed: 0, rolledBack: 0 };

  const roles: RoleRepository = {
    findRole: async () => (options.role === undefined ? 'poc-administrator' : options.role),
  };

  const unitOfWork: AuditUnitOfWork<SourcesUnitOfWorkContext> = {
    execute: async <TResult,>(work: (context: SourcesUnitOfWorkContext) => Promise<TResult>) => {
      const draftRows = new Map(stored);
      const draftEvents: AuditEventDraft[] = [];
      const context: SourcesUnitOfWorkContext = {
        auditEvents: {
          append: async (event) => {
            if (state.failAppend) throw new Error('the audit append failed');
            draftEvents.push(event);
            return {
              ...event,
              aggregateId: event.aggregateId ?? 'platform',
              eventId: '018f0000-0000-7000-8000-000000000001',
              occurredAt: '2026-09-02T00:00:00.000Z',
              sequence: draftEvents.length,
              previousHash: '0'.repeat(64),
              eventHash: '1'.repeat(64),
            };
          },
        },
        bindings: {
          findBinding: async (id) => draftRows.get(id) ?? null,
          insertBinding: async (record) => {
            draftRows.set(record.bindingId, record);
          },
          updateBinding: async (record) => {
            draftRows.set(record.bindingId, record);
          },
        },
      };
      // Commit only on success. A throw leaves `stored` and `events` untouched, which is
      // what a rolled-back PostgreSQL transaction does — and is COUNTED, so a refusal
      // that returns rather than throws is visible even when it wrote nothing.
      let result: TResult;
      try {
        result = await work(context);
      } catch (error) {
        transactions.rolledBack += 1;
        throw error;
      }
      transactions.committed += 1;
      stored.clear();
      for (const [id, record] of draftRows) stored.set(id, record);
      events.push(...draftEvents);
      return result;
    },
  };

  let counter = 0;
  const dependencies: BindingDependencies = {
    roles,
    unitOfWork,
    ids: { next: () => `018f0000-0000-7000-8000-00000000000${(counter += 1)}` },
  };

  return {
    dependencies,
    stored,
    events,
    transactions,
    get failAppend() {
      return state.failAppend;
    },
    set failAppend(value: boolean) {
      state.failAppend = value;
    },
  };
}

async function register(
  test: Harness,
  overrides: Partial<BindingFields> = {},
  session: SessionSnapshot = ADMIN,
) {
  return registerPopulationSource(test.dependencies, {
    ...FIELDS,
    ...overrides,
    session,
    correlationId: 'corr-1',
  });
}

describe('registerPopulationSource', () => {
  it('stores the binding and its digest, with one created event', async () => {
    const test = harness();
    const outcome = await register(test);

    expect(outcome).toMatchObject({ ok: true, declaresNoCount: false });
    const record = [...test.stored.values()][0] as BindingRecord;
    expect(record.digest).toBe(
      bindingDigest({
        kind: 'versioned-file',
        location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
        declaredSchema: ['employee_id', 'employment_status', 'termination_date', 'salary'],
        declaredCountMechanism: 'cover-sheet',
        sensitiveFields: ['salary'],
      }),
    );
    expect(record.location).toBe('s3://synthetic-bucket/hr/leavers/2026-08.csv');
    expect(record.declaredSchema).toEqual(FIELDS.declaredSchema);
    expect(record.sensitiveFields).toEqual(['salary']);
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(BINDING_CREATED_EVENT);
    expect(test.events[0]?.aggregateId).toBe(record.bindingId);
  });

  it('saves a read-only API binding with a count endpoint', async () => {
    const test = harness();
    const outcome = await register(test, {
      kind: 'read-only-api',
      location: 'https://accessgate.synthetic.invalid/api/accounts',
      declaredSchema: ['account_id', 'owner', 'status'],
      declaredCountMechanism: 'count-endpoint',
      sensitiveFields: [],
    });
    expect(outcome).toMatchObject({ ok: true, declaresNoCount: false });
  });

  it('SAVES a binding that declares no expected count, and says so', async () => {
    // FR-6 requires the absence to be surfaced at authoring time, and a binding that
    // cannot be saved cannot be surfaced: nobody can see what is missing on a binding
    // that does not exist.
    const test = harness();
    const outcome = await register(test, { declaredCountMechanism: 'none' });

    expect(outcome).toMatchObject({ ok: true, declaresNoCount: true });
    expect(test.stored.size).toBe(1);
    expect(test.events).toHaveLength(1);
  });

  it('stores a manual upload with no location, whatever was typed', async () => {
    const test = harness();
    const outcome = await register(test, {
      kind: 'manual-upload',
      location: 'https://ignored.synthetic.invalid/never-read',
    });

    expect(outcome.ok).toBe(true);
    const record = [...test.stored.values()][0] as BindingRecord;
    expect(record.location).toBe('');
    expect(record.digest).toBe(
      bindingDigest({
        kind: 'manual-upload',
        location: '',
        declaredSchema: FIELDS.declaredSchema,
        declaredCountMechanism: 'cover-sheet',
        sensitiveFields: ['salary'],
      }),
    );
  });

  it('gives the three kinds three different digests', async () => {
    const digests = new Set<string>();
    for (const kind of ['manual-upload', 'versioned-file', 'read-only-api'] as const) {
      const test = harness();
      const outcome = await register(test, { kind });
      expect(outcome.ok, kind).toBe(true);
      if (outcome.ok) digests.add(outcome.digest);
    }
    expect(digests.size).toBe(3);
  });

  it('refuses an Auditor before it reads any input, and stores nothing', async () => {
    const test = harness({ role: 'auditor' });
    const outcome = await register(test, { displayName: '' });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(test.stored.size).toBe(0);
    // The refusal itself is audited by `authorizeCommand`.
    expect(test.events.map((event) => event.eventType)).toEqual(['security.denied']);
  });

  it('refuses an unauthenticated caller with no role at all', async () => {
    const test = harness({ role: null });
    const outcome = await register(test);
    expect(outcome.ok).toBe(false);
    expect(test.stored.size).toBe(0);
  });

  it('stores nothing when the audit append fails', async () => {
    const test = harness();
    test.failAppend = true;

    await expect(register(test)).rejects.toThrow('the audit append failed');
    expect(test.stored.size).toBe(0);
  });

  it.each([
    [{ displayName: '  ' }, BINDING_REFUSALS.NAME_REQUIRED],
    [{ location: '   ' }, BINDING_REFUSALS.LOCATION_REQUIRED],
    [{ declaredSchema: [] }, BINDING_REFUSALS.SCHEMA_REQUIRED],
    [{ declaredSchema: ['   ', ''] }, BINDING_REFUSALS.SCHEMA_REQUIRED],
    [{ kind: 'ftp' as unknown as 'versioned-file' }, BINDING_REFUSALS.KIND_INVALID],
    [
      { declaredCountMechanism: 'guess' as unknown as DeclaredCountMechanism },
      BINDING_REFUSALS.MECHANISM_INVALID,
    ],
    [{ status: 'deleted' as unknown as 'active' }, BINDING_REFUSALS.STATUS_INVALID],
    [{ displayName: 'x'.repeat(201) }, BINDING_REFUSALS.TOO_LONG],
    [{ location: `s3://${'x'.repeat(1000)}` }, BINDING_REFUSALS.TOO_LONG],
    [{ declaredSchema: ['x'.repeat(201)] }, BINDING_REFUSALS.TOO_LONG],
    [{ note: 'x'.repeat(2001) }, BINDING_REFUSALS.TOO_LONG],
  ])('refuses %j', async (overrides, reason) => {
    const test = harness();
    await expect(register(test, overrides as Partial<BindingFields>)).resolves.toEqual({
      ok: false,
      reason,
    });
    expect(test.stored.size).toBe(0);
    expect(test.events).toHaveLength(0);
  });

  it('refuses a sensitive field the schema does not declare, and stores nothing', async () => {
    // FR-41. A mask over a field that does not exist masks nothing and reads, in a list
    // view, exactly like protection.
    const test = harness();
    const outcome = await register(test, { sensitiveFields: ['salary', 'bonus'] });

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.SENSITIVE_NOT_DECLARED });
    expect(test.stored.size).toBe(0);
    expect(test.events).toHaveLength(0);
  });

  it('refuses a value with no canonical form rather than storing a substitute', async () => {
    // An unpaired surrogate has no UTF-8 encoding: the driver would store U+FFFD, so the
    // row would permanently disagree with the digest taken over the input.
    const test = harness();
    const outcome = await register(test, { declaredSchema: ['salary', '\ud800'] });

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.NOT_STORABLE });
    expect(test.stored.size).toBe(0);
  });

  it('stores the declared schema in the typed order, deduplicated', async () => {
    const test = harness();
    await register(test, {
      declaredSchema: ['salary', '  employee_id  ', 'salary', '', 'termination_date'],
      sensitiveFields: ['salary'],
    });
    const record = [...test.stored.values()][0] as BindingRecord;
    // The row must hold what the digest hashed, or a later save that removes the
    // duplicate changes the column without moving the digest.
    expect(record.declaredSchema).toEqual(['salary', 'employee_id', 'termination_date']);
  });
});

describe('changePopulationSource', () => {
  async function seeded(options: Parameters<typeof harness>[0] = {}) {
    const test = harness(options);
    const created = await register(test);
    if (!created.ok) throw new Error('setup failed');
    test.events.length = 0;
    // The register above committed one transaction; the counters measure what the CHANGE
    // under test does.
    test.transactions.committed = 0;
    test.transactions.rolledBack = 0;
    const record = test.stored.get(created.bindingId) as BindingRecord;
    return {
      test,
      bindingId: created.bindingId,
      digest: created.digest,
      /** The token the surface would have rendered, from the row as stored. */
      rowVersion: bindingRowVersion(record),
    };
  }

  it.each([
    ['the location', { location: 's3://synthetic-bucket/hr/leavers/2026-09.csv' }, ['location']],
    [
      'the declared schema',
      { declaredSchema: [...FIELDS.declaredSchema, 'department'] },
      ['declaredSchema'],
    ],
    [
      'the declared-count mechanism',
      { declaredCountMechanism: 'none' as const },
      ['declaredCountMechanism'],
    ],
    ['the sensitive fields', { sensitiveFields: ['employee_id'] }, ['sensitiveFields']],
    // Switching to `manual-upload` also clears the location — the file arrives with the
    // Run — so BOTH fields are named. The event has to say so: a change record that
    // mentioned only the kind would understate what a Procedure Version's frozen
    // contract lost.
    ['the kind', { kind: 'manual-upload' as const }, ['kind', 'location']],
  ])('publishes binding-changed when %s moves', async (_label, overrides, fields) => {
    const { test, bindingId, digest, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      ...(overrides as Partial<BindingFields>),
      session: ADMIN,
      correlationId: 'corr-2',
      bindingId,
      expectedRowVersion: rowVersion,
    });

    expect(outcome).toMatchObject({ ok: true, published: true, priorDigest: digest });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(BINDING_CHANGED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({ priorDigest: digest, changedFields: fields });
    expect((test.stored.get(bindingId) as BindingRecord).digest).not.toBe(digest);
  });

  it('publishes binding-changed when the declared schema is only REORDERED', async () => {
    // The schema is an ordered list: the same names in another order is a different
    // declaration, and a parser told the second reads the wrong column.
    const { test, bindingId, digest, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      declaredSchema: ['salary', 'employee_id', 'employment_status', 'termination_date'],
      session: ADMIN,
      correlationId: 'corr-2b',
      bindingId,
      expectedRowVersion: rowVersion,
    });

    expect(outcome).toMatchObject({ ok: true, published: true, priorDigest: digest });
    expect(test.events[0]?.payload).toMatchObject({ changedFields: ['declaredSchema'] });
  });

  it('publishes NOTHING when the sensitive fields are only reordered', async () => {
    // They are a set: masking asks only whether a field is in the group.
    const { test, bindingId, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      sensitiveFields: ['salary', '  salary  '],
      session: ADMIN,
      correlationId: 'corr-2c',
      bindingId,
      expectedRowVersion: rowVersion,
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    expect(test.events).toHaveLength(0);
  });

  it('publishes binding-annotated when only a non-digest field changes', async () => {
    const { test, bindingId, digest, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3',
      bindingId,
      expectedRowVersion: rowVersion,
      displayName: 'HR leavers export (renamed)',
      note: 'an operator note',
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: true, digest });
    // One event, and it is NOT the one Epic 2 mints drafts from.
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(BINDING_ANNOTATED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({
      digest,
      changedFields: ['displayName', 'note'],
    });
    const record = test.stored.get(bindingId) as BindingRecord;
    expect(record.displayName).toBe('HR leavers export (renamed)');
    expect(record.digest).toBe(digest);
  });

  it('audits a retirement, which moves no digest-bearing field', async () => {
    const { test, bindingId, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3b',
      bindingId,
      expectedRowVersion: rowVersion,
      status: 'retired',
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: true });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(BINDING_ANNOTATED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({ changedFields: ['status'] });
  });

  it('records the rename inside the event when a save moves both halves', async () => {
    const { test, bindingId, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3c',
      bindingId,
      expectedRowVersion: rowVersion,
      displayName: 'HR leavers export (renamed)',
      location: 's3://synthetic-bucket/hr/leavers/2026-09.csv',
    });

    expect(outcome).toMatchObject({ ok: true, published: true, annotated: true });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(BINDING_CHANGED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({
      changedFields: ['location'],
      annotatedFields: ['displayName'],
    });
  });

  it('appends nothing when a save moves nothing at all', async () => {
    const { test, bindingId, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3d',
      bindingId,
      expectedRowVersion: rowVersion,
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    expect(test.events).toHaveLength(0);
  });

  it('refuses a stale row version and changes nothing', async () => {
    const { test, bindingId, digest } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5',
      bindingId,
      expectedRowVersion: '0'.repeat(64),
      location: 's3://synthetic-bucket/hr/leavers/2026-09.csv',
    });

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.STALE_ROW });
    expect((test.stored.get(bindingId) as BindingRecord).digest).toBe(digest);
    expect(test.events).toHaveLength(0);
    // The transaction ROLLED BACK. A refusal returned from inside a unit of work commits
    // whatever had already been written, and today that is nothing only because the guard
    // happens to sit above the write. `CommandRefused` is what makes it nothing whatever
    // the statement order becomes.
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 1 });
  });

  it('refuses a stale tab that would silently un-retire a binding', async () => {
    // The token covers the whole row, not the five the digest covers. `status` is not
    // one of the five, so a digest-shaped token would let this sequence pass and set a
    // retired binding back to active — a silent revert of the control that stops the
    // binding being used, by somebody who never saw the retirement.
    const { test, bindingId, rowVersion } = await seeded();

    const retired = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5a',
      bindingId,
      expectedRowVersion: rowVersion,
      status: 'retired',
    });
    expect(retired).toMatchObject({ ok: true, published: false, annotated: true });

    // The second administrator's tab, opened before the retirement: same digest, and
    // `status: 'active'` because that is what it rendered.
    const stale = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5b',
      bindingId,
      expectedRowVersion: rowVersion,
      note: 'a note typed in the stale tab',
    });

    expect(stale).toEqual({ ok: false, reason: BINDING_REFUSALS.STALE_ROW });
    expect((test.stored.get(bindingId) as BindingRecord).status).toBe('retired');
  });

  it('refuses a stale tab that would silently rename over somebody else', async () => {
    // The same guard from the other side: `displayName` is outside the digest too.
    const { test, bindingId, rowVersion } = await seeded();

    await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5c',
      bindingId,
      expectedRowVersion: rowVersion,
      displayName: 'Renamed by the first administrator',
    });

    const stale = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5d',
      bindingId,
      expectedRowVersion: rowVersion,
      note: 'a note typed in the stale tab',
    });

    expect(stale).toEqual({ ok: false, reason: BINDING_REFUSALS.STALE_ROW });
    expect((test.stored.get(bindingId) as BindingRecord).displayName).toBe(
      'Renamed by the first administrator',
    );
  });

  it('refuses an unknown binding', async () => {
    const test = harness();
    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-6',
      bindingId: '018f0000-0000-7000-8000-0000000000ff',
      expectedRowVersion: '0'.repeat(64),
    });
    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.UNKNOWN_BINDING });
    // Rolled back, not committed. Same reason as the stale-row case above.
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 1 });
  });

  it('refuses a sensitive field outside the schema on a change, leaving the row alone', async () => {
    const { test, bindingId, digest, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-7',
      bindingId,
      expectedRowVersion: rowVersion,
      declaredSchema: ['employee_id'],
      sensitiveFields: ['salary'],
    });

    expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.SENSITIVE_NOT_DECLARED });
    expect((test.stored.get(bindingId) as BindingRecord).digest).toBe(digest);
    expect(test.events).toHaveLength(0);
  });

  it('refuses an Auditor and changes nothing', async () => {
    const { test, bindingId, digest, rowVersion } = await seeded();
    const auditorView = harness({ role: 'auditor' });
    (auditorView.stored as Map<string, BindingRecord>).set(
      bindingId,
      test.stored.get(bindingId) as BindingRecord,
    );

    const outcome = await changePopulationSource(auditorView.dependencies, {
      ...FIELDS,
      session: AUDITOR,
      correlationId: 'corr-8',
      bindingId,
      expectedRowVersion: rowVersion,
      location: 's3://synthetic-bucket/hr/leavers/2026-09.csv',
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect((auditorView.stored.get(bindingId) as BindingRecord).digest).toBe(digest);
  });

  it('leaves the binding untouched when the append fails', async () => {
    const { test, bindingId, digest, rowVersion } = await seeded();
    test.failAppend = true;

    await expect(
      changePopulationSource(test.dependencies, {
        ...FIELDS,
        session: ADMIN,
        correlationId: 'corr-9',
        bindingId,
        expectedRowVersion: rowVersion,
        location: 's3://synthetic-bucket/hr/leavers/2026-09.csv',
      }),
    ).rejects.toThrow('the audit append failed');

    expect((test.stored.get(bindingId) as BindingRecord).digest).toBe(digest);
  });

  it('reports declaresNoCount when a change removes the count mechanism', async () => {
    const { test, bindingId, rowVersion } = await seeded();

    const outcome = await changePopulationSource(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-10',
      bindingId,
      expectedRowVersion: rowVersion,
      declaredCountMechanism: 'none',
    });

    expect(outcome).toMatchObject({ ok: true, published: true, declaresNoCount: true });
  });
});

describe('the row version token', () => {
  const RECORD: BindingRecord = {
    bindingId: '018f0000-0000-7000-8000-000000000001',
    displayName: 'HR leavers export',
    kind: 'versioned-file',
    location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
    declaredSchema: ['employee_id', 'salary'],
    declaredCountMechanism: 'cover-sheet',
    sensitiveFields: ['salary'],
    note: '',
    status: 'active',
    digest: 'a'.repeat(64),
  };

  it.each([
    ['displayName', { displayName: 'Something else' }],
    ['kind', { kind: 'read-only-api' as const }],
    ['location', { location: 's3://elsewhere' }],
    ['declaredSchema', { declaredSchema: ['salary', 'employee_id'] }],
    ['declaredCountMechanism', { declaredCountMechanism: 'none' as const }],
    ['sensitiveFields', { sensitiveFields: [] }],
    ['note', { note: 'a note' }],
    ['status', { status: 'retired' as const }],
    ['bindingId', { bindingId: '018f0000-0000-7000-8000-000000000002' }],
  ])('moves when %s moves', (_field, overrides) => {
    // EVERY field a save replaces, not the digest-bearing subset: that is the whole
    // point of the token, and each of the three non-digest fields below is one the
    // digest could not have protected.
    expect(bindingRowVersion({ ...RECORD, ...overrides })).not.toBe(bindingRowVersion(RECORD));
  });

  it('does not move when only the derived digest differs', () => {
    // The digest is derived from five of the fields above, so including it would make
    // the token no stronger — and would couple it to the digest function, which is where
    // Story 1.6's defect came from.
    expect(bindingRowVersion({ ...RECORD, digest: 'b'.repeat(64) })).toBe(
      bindingRowVersion(RECORD),
    );
  });

  it('is 64 lower-case hex characters', () => {
    expect(bindingRowVersion(RECORD)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('values PostgreSQL cannot store', () => {
  it('refuses a NUL character rather than letting the driver raise 22021', async () => {
    // U+0000 is valid JSON — `JSON.stringify` escapes it — so it canonicalized and
    // hashed cleanly and then failed at the driver with `invalid byte sequence for
    // encoding "UTF8": 0x00`, which reaches the caller as a framework 500. It has no
    // storable form, so the canonicalizer refuses it and the command says so.
    const test = harness();
    for (const field of [
      { displayName: `north\u0000star` },
      { location: `https://a.invalid/\u0000` },
      // No sensitive fields here: with a NUL inside a schema NAME the subset rule
      // fires first, which is a correct refusal but not the one under test.
      { declaredSchema: ['employee_id', `sal\u0000ary`], sensitiveFields: [] },
      { note: `a\u0000note` },
    ]) {
      const outcome = await registerPopulationSource(test.dependencies, {
        ...FIELDS,
        ...field,
        session: ADMIN,
        correlationId: 'corr-nul',
      });
      expect(outcome).toEqual({ ok: false, reason: BINDING_REFUSALS.NOT_STORABLE });
    }
    expect(test.stored.size).toBe(0);
  });
});

describe('what the row actually holds', () => {
  it('stores the sensitive fields in the sorted form the digest hashes', async () => {
    // Nothing pinned this. With `setOf` no longer sorting, every unit test stayed green
    // — and then retyping the same masked fields in another order rewrote the row, moved
    // the row version, and appended no event at all. The `<@` CHECK is order-blind and
    // is no backstop.
    const test = harness();
    const created = await registerPopulationSource(test.dependencies, {
      ...FIELDS,
      declaredSchema: ['employee_id', 'salary', 'manager'],
      sensitiveFields: ['salary', 'employee_id'],
      session: ADMIN,
      correlationId: 'corr-sorted',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const record = test.stored.get(created.bindingId) as BindingRecord;
    expect(record.sensitiveFields).toEqual(['employee_id', 'salary']);
  });
});
