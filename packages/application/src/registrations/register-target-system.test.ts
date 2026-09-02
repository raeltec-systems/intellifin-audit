import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registrationDigest, type PermittedReadAction } from '@intellifin/domain';

import type { AuditEventDraft } from '@intellifin/domain';
import type { AuditUnitOfWork } from '../audit/ports.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  REGISTRATION_ANNOTATED_EVENT,
  REGISTRATION_CHANGED_EVENT,
  REGISTRATION_CREATED_EVENT,
  REGISTRATION_REFUSALS,
  REGISTRATION_REFUSED_EVENT,
  changeTargetSystem,
  registerTargetSystem,
  type RegistrationDependencies,
  type RegistrationFields,
} from './register-target-system.js';
import type {
  CredentialCapability,
  CredentialCapabilityReport,
  CredentialProvider,
  RegistrationRecord,
  RegistrationsUnitOfWorkContext,
} from './ports.js';

/**
 * The registration commands, against fakes (FR-8, FR-45, AD-2, AD-7, AD-8).
 *
 * The fake unit of work is deliberately transactional in the one way that matters: it
 * records writes into a scratch copy and only commits them if the callback resolves.
 * A fake that applied writes immediately would let "nothing was stored" pass while the
 * real transaction stored something, which is the exact claim these tests exist to make.
 * `tests/integration/registrations.test.ts` then makes the same claims against a real
 * PostgreSQL, because only PostgreSQL can prove PostgreSQL.
 */

const ADMIN: SessionSnapshot = { userId: 'admin-1', sessionId: 'session-1' };
const AUDITOR: SessionSnapshot = { userId: 'auditor-1', sessionId: 'session-2' };

const FIELDS: RegistrationFields = {
  displayName: 'Northstar Web',
  kind: 'web',
  allowedOrigins: ['https://northstar.synthetic.invalid'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/northstar-readonly',
  permittedActions: ['navigate', 'read-attribute'],
  attributeLabelPatterns: ['Invoice *'],
  secondaryKey: '',
  note: '',
  status: 'active',
};

interface Harness {
  readonly dependencies: RegistrationDependencies;
  /** Committed rows, by id. A rolled-back transaction never reaches this. */
  readonly stored: Map<string, RegistrationRecord>;
  /** Committed audit events, in order. */
  readonly events: AuditEventDraft[];
  /** Set to make the append throw, so a failed append can be observed. */
  failAppend: boolean;
}

function harness(options: {
  readonly role?: 'poc-administrator' | 'auditor' | null;
  readonly capability?: CredentialCapability;
  /** The provider itself throws — a network drop rather than a verdict. */
  readonly providerThrows?: boolean;
} = {}): Harness {
  const stored = new Map<string, RegistrationRecord>();
  const events: AuditEventDraft[] = [];
  const state = { failAppend: false };

  const roles: RoleRepository = {
    findRole: async () => (options.role === undefined ? 'poc-administrator' : options.role),
  };

  const credentials: CredentialProvider = {
    describe: async (credentialRef): Promise<CredentialCapabilityReport> => {
      if (options.providerThrows === true) throw new Error('the capability service is down');
      return { credentialRef, capability: options.capability ?? 'read-only' };
    },
  };

  const unitOfWork: AuditUnitOfWork<RegistrationsUnitOfWorkContext> = {
    execute: async (work) => {
      const draftRows = new Map(stored);
      const draftEvents: AuditEventDraft[] = [];
      const context: RegistrationsUnitOfWorkContext = {
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
        registrations: {
          findRegistration: async (id) => draftRows.get(id) ?? null,
          insertRegistration: async (record) => {
            draftRows.set(record.registrationId, record);
          },
          updateRegistration: async (record) => {
            draftRows.set(record.registrationId, record);
          },
        },
      };
      // Commit only on success. A throw leaves `stored` and `events` untouched, which
      // is what a rolled-back PostgreSQL transaction does.
      const result = await work(context);
      stored.clear();
      for (const [id, record] of draftRows) stored.set(id, record);
      events.push(...draftEvents);
      return result;
    },
  };

  let counter = 0;
  const dependencies: RegistrationDependencies = {
    roles,
    credentials,
    unitOfWork,
    ids: { next: () => `018f0000-0000-7000-8000-00000000000${(counter += 1)}` },
  };

  return {
    dependencies,
    stored,
    events,
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
  overrides: Partial<RegistrationFields> = {},
  session: SessionSnapshot = ADMIN,
) {
  return registerTargetSystem(test.dependencies, {
    ...FIELDS,
    ...overrides,
    session,
    correlationId: 'corr-1',
  });
}

describe('registerTargetSystem', () => {
  it('stores the registration and its digest, with one created event', async () => {
    const test = harness();
    const outcome = await register(test);

    expect(outcome.ok).toBe(true);
    const record = [...test.stored.values()][0] as RegistrationRecord;
    expect(record.digest).toBe(
      registrationDigest({
        kind: 'web',
        allowedOrigins: ['https://northstar.synthetic.invalid'],
        applicationIdentity: '',
        credentialRef: 'cred://synthetic/northstar-readonly',
        permittedActions: ['navigate', 'read-attribute'],
        attributeLabelPatterns: ['Invoice *'],
        secondaryKey: '',
      }),
    );
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_CREATED_EVENT);
    expect(test.events[0]?.aggregateId).toBe(record.registrationId);
  });

  it('refuses an Auditor before it reads any input, and stores nothing', async () => {
    const test = harness({ role: 'auditor' });
    const outcome = await register(test, { displayName: '' });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect(test.stored.size).toBe(0);
    // The refusal itself is audited by `authorizeCommand`.
    expect(test.events.map((event) => event.eventType)).toEqual(['security.denied']);
  });

  it('refuses a write-capable credential with the verbatim sentence, storing nothing', async () => {
    const test = harness({ capability: 'write-capable' });
    const outcome = await register(test);

    expect(outcome).toEqual({
      ok: false,
      reason: 'Audit credentials must be read-only.',
    });
    expect(test.stored.size).toBe(0);
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_REFUSED_EVENT);
    expect(test.events[0]?.outcome).toBe('denied');
    expect(test.events[0]?.payload).toMatchObject({ capability: 'write-capable' });
  });

  it('fails closed when the capability cannot be determined', async () => {
    const test = harness({ capability: 'unknown' });
    const outcome = await register(test);

    expect(outcome).toEqual({ ok: false, reason: REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY });
    expect(test.stored.size).toBe(0);
    expect(test.events[0]?.payload).toMatchObject({ capability: 'unknown' });
  });

  it('fails closed when the provider itself throws', async () => {
    const test = harness({ providerThrows: true });
    const outcome = await register(test);

    // A network drop and "cannot be determined" must not be different outcomes: one of
    // them would otherwise be a path on which an unproven credential is stored.
    expect(outcome).toEqual({ ok: false, reason: REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY });
    expect(test.stored.size).toBe(0);
    expect(test.events[0]?.payload).toMatchObject({ capability: 'unknown' });
  });

  it('never puts the credential reference in the audit payload', async () => {
    const test = harness({ capability: 'write-capable' });
    await register(test);
    const serialized = JSON.stringify(test.events.map((event) => event.payload));
    expect(serialized).not.toContain('cred://synthetic/northstar-readonly');
  });

  it('stores nothing when the audit append fails', async () => {
    const test = harness();
    test.failAppend = true;

    await expect(register(test)).rejects.toThrow('the audit append failed');
    expect(test.stored.size).toBe(0);
  });

  it.each([
    [{ displayName: '  ' }, REGISTRATION_REFUSALS.NAME_REQUIRED],
    [{ credentialRef: '' }, REGISTRATION_REFUSALS.CREDENTIAL_REQUIRED],
    [{ allowedOrigins: [] }, REGISTRATION_REFUSALS.ORIGIN_REQUIRED],
    [{ permittedActions: [] }, REGISTRATION_REFUSALS.ACTIONS_REQUIRED],
    [
      { permittedActions: ['create-record'] as unknown as readonly PermittedReadAction[] },
      REGISTRATION_REFUSALS.ACTION_NOT_READ_ONLY,
    ],
    [
      { kind: 'desktop' as const, allowedOrigins: [], applicationIdentity: '' },
      REGISTRATION_REFUSALS.IDENTITY_REQUIRED,
    ],
    [{ kind: 'ftp' as unknown as 'web' }, REGISTRATION_REFUSALS.KIND_INVALID],
  ])('refuses %j', async (overrides, reason) => {
    const test = harness();
    await expect(register(test, overrides as Partial<RegistrationFields>)).resolves.toEqual({
      ok: false,
      reason,
    });
    expect(test.stored.size).toBe(0);
    expect(test.events).toHaveLength(0);
  });

  it('accepts a desktop system with an application identity and no origins', async () => {
    const test = harness();
    const outcome = await register(test, {
      kind: 'desktop',
      allowedOrigins: [],
      applicationIdentity: 'com.synthetic.northstar.ledger',
    });
    expect(outcome.ok).toBe(true);
    const record = [...test.stored.values()][0] as RegistrationRecord;
    expect(record.allowedOrigins).toEqual([]);
    expect(record.applicationIdentity).toBe('com.synthetic.northstar.ledger');
  });
});

describe('changeTargetSystem', () => {
  async function seeded(options: Parameters<typeof harness>[0] = {}) {
    const test = harness(options);
    const created = await register(test);
    if (!created.ok) throw new Error('setup failed');
    test.events.length = 0;
    return { test, registrationId: created.registrationId, digest: created.digest };
  }

  it('publishes RegistrationChanged when a digest-bearing field changes', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-2',
      registrationId,
      expectedDigest: digest,
      allowedOrigins: ['https://other.synthetic.invalid'],
    });

    expect(outcome).toMatchObject({ ok: true, published: true, priorDigest: digest });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_CHANGED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({
      priorDigest: digest,
      changedFields: ['allowedOrigins'],
    });
    expect((test.stored.get(registrationId) as RegistrationRecord).digest).not.toBe(digest);
  });

  it('publishes no RegistrationChanged when only a non-digest field changes, but audits it', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3',
      registrationId,
      expectedDigest: digest,
      displayName: 'Northstar Web (renamed)',
      note: 'an operator note',
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: true, digest });
    // One event, and it is NOT the one Epic 2 mints drafts from. A rename must not
    // create work for every Procedure that froze this digest — and it must not reach
    // the database with nothing in the chain either.
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_ANNOTATED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({
      digest,
      changedFields: ['displayName', 'note'],
    });
    const record = test.stored.get(registrationId) as RegistrationRecord;
    expect(record.displayName).toBe('Northstar Web (renamed)');
    expect(record.digest).toBe(digest);
  });

  it('audits a retirement, which moves no digest-bearing field', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3b',
      registrationId,
      expectedDigest: digest,
      status: 'retired',
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: true });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_ANNOTATED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({ changedFields: ['status'] });
  });

  it('records the rename inside the event when a save moves both halves', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3c',
      registrationId,
      expectedDigest: digest,
      displayName: 'Northstar Web (renamed)',
      allowedOrigins: ['https://other.synthetic.invalid'],
    });

    expect(outcome).toMatchObject({ ok: true, published: true, annotated: true });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(REGISTRATION_CHANGED_EVENT);
    expect(test.events[0]?.payload).toMatchObject({
      changedFields: ['allowedOrigins'],
      annotatedFields: ['displayName'],
    });
  });

  it('appends nothing when a save moves nothing at all', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-3d',
      registrationId,
      expectedDigest: digest,
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    expect(test.events).toHaveLength(0);
  });

  it('publishes nothing when the six are retyped in another order', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-4',
      registrationId,
      expectedDigest: digest,
      permittedActions: ['read-attribute', 'navigate'],
    });

    expect(outcome).toMatchObject({ ok: true, published: false, annotated: false });
    expect(test.events).toHaveLength(0);
  });

  it('refuses a stale expected digest and changes nothing', async () => {
    const { test, registrationId, digest } = await seeded();

    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-5',
      registrationId,
      expectedDigest: '0'.repeat(64),
      allowedOrigins: ['https://other.synthetic.invalid'],
    });

    expect(outcome).toEqual({ ok: false, reason: REGISTRATION_REFUSALS.STALE_DIGEST });
    expect((test.stored.get(registrationId) as RegistrationRecord).digest).toBe(digest);
    expect(test.events).toHaveLength(0);
  });

  it('refuses an unknown registration', async () => {
    const test = harness();
    const outcome = await changeTargetSystem(test.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-6',
      registrationId: '018f0000-0000-7000-8000-0000000000ff',
    });
    expect(outcome).toEqual({ ok: false, reason: REGISTRATION_REFUSALS.UNKNOWN_REGISTRATION });
  });

  it('refuses a write-capable credential on a change, leaving the row untouched', async () => {
    const { test, registrationId, digest } = await seeded();
    const writeCapable = harness({ capability: 'write-capable' });
    // Reuse the seeded row with a provider that reports write access.
    (writeCapable.stored as Map<string, RegistrationRecord>).set(
      registrationId,
      test.stored.get(registrationId) as RegistrationRecord,
    );

    const outcome = await changeTargetSystem(writeCapable.dependencies, {
      ...FIELDS,
      session: ADMIN,
      correlationId: 'corr-7',
      registrationId,
      expectedDigest: digest,
      credentialRef: 'cred://synthetic/writes-things',
    });

    expect(outcome).toEqual({ ok: false, reason: REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY });
    expect((writeCapable.stored.get(registrationId) as RegistrationRecord).digest).toBe(digest);
    expect(writeCapable.events.map((event) => event.eventType)).toEqual([
      REGISTRATION_REFUSED_EVENT,
    ]);
  });

  it('refuses an Auditor and changes nothing', async () => {
    const { test, registrationId, digest } = await seeded();
    const auditorView = harness({ role: 'auditor' });
    (auditorView.stored as Map<string, RegistrationRecord>).set(
      registrationId,
      test.stored.get(registrationId) as RegistrationRecord,
    );

    const outcome = await changeTargetSystem(auditorView.dependencies, {
      ...FIELDS,
      session: AUDITOR,
      correlationId: 'corr-8',
      registrationId,
      allowedOrigins: ['https://other.synthetic.invalid'],
    });

    expect(outcome).toEqual({ ok: false, reason: 'Your role does not permit this action.' });
    expect((auditorView.stored.get(registrationId) as RegistrationRecord).digest).toBe(digest);
  });

  it('leaves the registration untouched when the append fails', async () => {
    const { test, registrationId, digest } = await seeded();
    test.failAppend = true;

    await expect(
      changeTargetSystem(test.dependencies, {
        ...FIELDS,
        session: ADMIN,
        correlationId: 'corr-9',
        registrationId,
        expectedDigest: digest,
        allowedOrigins: ['https://other.synthetic.invalid'],
      }),
    ).rejects.toThrow('the audit append failed');

    expect((test.stored.get(registrationId) as RegistrationRecord).digest).toBe(digest);
  });
});

describe('the credential report shape', () => {
  it('has exactly two fields, so a provider has nowhere to put a secret', async () => {
    const describe_ = vi.fn(
      async (credentialRef: string): Promise<CredentialCapabilityReport> => ({
        credentialRef,
        capability: 'read-only',
      }),
    );
    const report = await describe_('cred://x');
    expect(Object.keys(report).sort()).toEqual(['capability', 'credentialRef']);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
