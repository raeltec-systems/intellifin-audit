import { describe, expect, it } from 'vitest';

import { DENIAL_REASONS, initialDraftSections, initialDraftPopulation, bindingDigest, POPULATION_DRAFT_MESSAGES, type AuditEventDraft } from '@intellifin/domain';
import type { BindingRecord } from '../sources/ports.js';
import { updatePopulationDraft, type DraftPopulationEdit } from './update-population-draft.js';

import type { AuditUnitOfWork } from '../audit/ports.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  PROCEDURE_DRAFT_CHANGED_EVENT,
  PROCEDURE_REFUSALS,
  createProcedure,
  procedureVersionRowVersion,
  renameProcedureDraft,
  type ProcedureDependencies,
} from './create-procedure.js';
import type {
  ProcedureRecord,
  ProcedureVersionRecord,
  ProceduresUnitOfWorkContext,
} from './ports.js';

/**
 * The Procedure commands, against fakes (FR-4, FR-5, AD-7, AD-8).
 *
 * The fake unit of work is transactional in the one way that matters: it records writes
 * into a scratch copy and commits them only if the callback resolves. A fake that
 * applied writes immediately would let "nothing was stored" pass while the real
 * transaction stored something. `tests/integration/procedures.test.ts` then makes the
 * same claims against a real PostgreSQL, because only PostgreSQL can prove PostgreSQL.
 */

const AUDITOR: SessionSnapshot = { userId: 'auditor-1', sessionId: 'session-1' };
const POC_ADMIN: SessionSnapshot = { userId: 'poc-admin-1', sessionId: 'session-2' };

interface Harness {
  readonly bindings: Map<string, BindingRecord>;
  readonly dependencies: ProcedureDependencies;
  /** Committed procedure rows, by id. A rolled-back transaction never reaches this. */
  readonly storedProcedures: Map<string, ProcedureRecord>;
  /** Committed version rows, by version id. */
  readonly storedVersions: Map<string, ProcedureVersionRecord>;
  /** Committed audit events, in order. */
  readonly events: AuditEventDraft[];
  /** Set to make the append throw, so a failed append can be observed. */
  failAppend: boolean;
  /** How many transactions committed, and how many rolled back. */
  readonly transactions: { committed: number; rolledBack: number };
}

function harness(role: 'auditor' | 'poc-administrator' = 'auditor'): Harness {
  const bindings = new Map<string, BindingRecord>();
  const storedProcedures = new Map<string, ProcedureRecord>();
  const storedVersions = new Map<string, ProcedureVersionRecord>();
  const events: AuditEventDraft[] = [];
  const state = { failAppend: false };
  const transactions = { committed: 0, rolledBack: 0 };

  const roles: RoleRepository = {
    findRole: async (userId: string) => (userId === POC_ADMIN.userId ? 'poc-administrator' : role),
  };

  const unitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext> = {
    execute: async <TResult,>(
      work: (context: ProceduresUnitOfWorkContext) => Promise<TResult>,
    ) => {
      const draftProcedures = new Map(storedProcedures);
      const draftVersions = new Map(storedVersions);
      const draftEvents: AuditEventDraft[] = [];
      const context: ProceduresUnitOfWorkContext = {
        populationSources: { findBindingForShare: async (id) => bindings.get(id) ?? null },
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
        procedures: {
          insertProcedure: async (record) => {
            draftProcedures.set(record.procedureId, record);
          },
          insertVersion: async (record) => {
            draftVersions.set(record.versionId, record);
          },
          findVersion: async (versionId) => draftVersions.get(versionId) ?? null,
          findVersionForUpdate: async (versionId) => draftVersions.get(versionId) ?? null,
          updateVersion: async (record) => {
            draftVersions.set(record.versionId, record);
          },
          maxVersionNumber: async (procedureId) => {
            let max = 0;
            for (const version of draftVersions.values()) {
              if (version.procedureId === procedureId && version.versionNumber > max) {
                max = version.versionNumber;
              }
            }
            return max;
          },
        },
      };
      // Commit only on success. A throw leaves the stores untouched, which is what a
      // rolled-back PostgreSQL transaction does — and is COUNTED, so a refusal that
      // returns rather than throws is visible even when it wrote nothing.
      let result: TResult;
      try {
        result = await work(context);
      } catch (error) {
        transactions.rolledBack += 1;
        throw error;
      }
      transactions.committed += 1;
      storedProcedures.clear();
      for (const [id, record] of draftProcedures) storedProcedures.set(id, record);
      storedVersions.clear();
      for (const [id, record] of draftVersions) storedVersions.set(id, record);
      events.push(...draftEvents);
      return result;
    },
  };

  let counter = 0;
  const ids = {
    next: () => `018f0000-0000-7000-8000-${String(counter++).padStart(12, '0')}`,
  };

  return {
    bindings,
    dependencies: { roles, unitOfWork, ids } satisfies ProcedureDependencies,
    storedProcedures,
    storedVersions,
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

function create(
  test: Harness,
  overrides: Partial<Parameters<typeof createProcedure>[1]> = {},
  session: SessionSnapshot = AUDITOR,
) {
  return createProcedure(test.dependencies, {
    templateId: 'P-1',
    controlName: 'Terminated users retain no access',
    session,
    correlationId: 'corr-1',
    ...overrides,
  });
}

describe('createProcedure', () => {
  it('stores the Procedure, its DRAFT version 1, and one created event', async () => {
    const test = harness();
    const outcome = await create(test);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(test.storedProcedures.size).toBe(1);
    expect(test.storedVersions.size).toBe(1);
    const version = [...test.storedVersions.values()][0] as ProcedureVersionRecord;
    expect(version.state).toBe('DRAFT');
    expect(version.versionNumber).toBe(1);
    expect(version.templateId).toBe('P-1');
    expect(version.controlName).toBe('Terminated users retain no access');
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe('lifecycle.procedure-created');
    expect(test.events[0]?.aggregateId).toBe(outcome.procedureId);
  });

  it.each(['P-1', 'P-2', 'P-3', 'P-4'] as const)(
    'pre-fills the sections from %s exactly as the domain pre-fill does',
    async (templateId) => {
      const test = harness();
      const outcome = await create(test, { templateId });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.sections).toEqual(initialDraftSections(templateId));
      const version = [...test.storedVersions.values()][0] as ProcedureVersionRecord;
      expect(version.sections).toEqual(initialDraftSections(templateId));
    },
  );

  it('writes the Procedure row, the version row and the event in ONE transaction', async () => {
    const test = harness();
    await create(test);
    // One unit of work; the three writes are inside it. The atomicity both ways is
    // proved against PostgreSQL in the integration suite; this asserts the command uses
    // the one transaction it has.
    expect(test.transactions).toEqual({ committed: 1, rolledBack: 0 });
  });

  it('refuses a PoC Administrator before reading any input, and stores nothing', async () => {
    const test = harness();
    const outcome = await create(
      test,
      { templateId: 'not-a-template', controlName: '' },
      POC_ADMIN,
    );

    expect(outcome).toEqual({
      ok: false,
      // The EXPERIENCE.md sentence, verbatim from the domain's denial table.
      reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
    });
    expect(test.storedProcedures.size).toBe(0);
    expect(test.storedVersions.size).toBe(0);
    // The refusal itself is audited by `authorizeCommand`.
    expect(test.events.map((event) => event.eventType)).toEqual(['security.denied']);
  });

  it.each([
    [{ templateId: undefined }, PROCEDURE_REFUSALS.TEMPLATE_REQUIRED],
    [{ templateId: null }, PROCEDURE_REFUSALS.TEMPLATE_REQUIRED],
    [{ templateId: 'P-5' }, PROCEDURE_REFUSALS.TEMPLATE_REQUIRED],
    [{ templateId: 3 }, PROCEDURE_REFUSALS.TEMPLATE_REQUIRED],
    [{ templateId: 'p-1' }, PROCEDURE_REFUSALS.TEMPLATE_REQUIRED],
    [{ controlName: '' }, PROCEDURE_REFUSALS.NAME_REQUIRED],
    [{ controlName: '   ' }, PROCEDURE_REFUSALS.NAME_REQUIRED],
    [{ controlName: 'x'.repeat(201) }, PROCEDURE_REFUSALS.TOO_LONG],
  ])('refuses %j with a sentence and stores nothing', async (overrides, reason) => {
    const test = harness();
    const outcome = await create(test, overrides as Record<string, unknown>);

    expect(outcome).toEqual({ ok: false, reason });
    expect(test.storedProcedures.size).toBe(0);
    expect(test.storedVersions.size).toBe(0);
    expect(test.events).toHaveLength(0);
  });

  it('refuses a Control name with no canonical form rather than storing a substitute', async () => {
    const test = harness();
    const outcome = await create(test, { controlName: 'terminated\u0000users' });
    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_STORABLE });
    expect(test.storedProcedures.size).toBe(0);

    const loneSurrogate = await create(test, { controlName: 'terminated\ud800users' });
    expect(loneSurrogate).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_STORABLE });
  });

  it('stores nothing when the audit append fails', async () => {
    const test = harness();
    test.failAppend = true;

    await expect(create(test)).rejects.toThrow('the audit append failed');
    expect(test.storedProcedures.size).toBe(0);
    expect(test.storedVersions.size).toBe(0);
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 1 });
  });

  it('stores the Control name trimmed', async () => {
    const test = harness();
    await create(test, { controlName: '  P-1 leavers check  ' });
    const procedure = [...test.storedProcedures.values()][0] as ProcedureRecord;
    expect(procedure.controlName).toBe('P-1 leavers check');
  });
});

describe('renameProcedureDraft', () => {
  async function seeded() {
    const test = harness();
    const created = await create(test);
    if (!created.ok) throw new Error('setup failed');
    test.events.length = 0;
    test.transactions.committed = 0;
    test.transactions.rolledBack = 0;
    const version = test.storedVersions.get(created.versionId) as ProcedureVersionRecord;
    return {
      test,
      procedureId: created.procedureId,
      versionId: created.versionId,
      version,
      rowVersion: procedureVersionRowVersion(version),
    };
  }

  it('renames the Draft and appends procedure-draft-changed in the same transaction', async () => {
    const { test, procedureId, versionId, version, rowVersion } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: 'Renamed by the auditor',
      expectedRowVersion: rowVersion,
      correlationId: 'corr-2',
    });

    expect(outcome).toEqual({
      ok: true,
      versionId,
      controlName: 'Renamed by the auditor',
      changed: true,
      // The token comes back over the row as the command left it, so the surface's
      // next save guards against the row as it now is.
      rowVersion: procedureVersionRowVersion({
        ...version,
        controlName: 'Renamed by the auditor',
      }),
    });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
    expect(test.events[0]?.aggregateId).toBe(procedureId);
    const stored = test.storedVersions.get(versionId) as ProcedureVersionRecord;
    expect(stored.controlName).toBe('Renamed by the auditor');
    expect(test.transactions).toEqual({ committed: 1, rolledBack: 0 });
  });

  it('changes only the named Draft — the Procedure row and other versions untouched', async () => {
    const { test, procedureId, versionId, rowVersion } = await seeded();
    const before = new Map(test.storedProcedures);

    await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: 'Renamed again',
      expectedRowVersion: rowVersion,
      correlationId: 'corr-3',
    });

    expect(test.storedProcedures).toEqual(before);
    expect([...test.storedVersions.values()]).toHaveLength(1);
  });

  it('writes and appends NOTHING when the save changes nothing', async () => {
    const { test, procedureId, versionId, version, rowVersion } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: version.controlName,
      expectedRowVersion: rowVersion,
      correlationId: 'corr-4',
    });

    expect(outcome).toMatchObject({ ok: true, changed: false, rowVersion });
    expect(test.events).toHaveLength(0);
    // The UPDATE was unconditional in Story 1.6's first cut and an idle submit still
    // moved the row. Here there is nothing to observe on the row — which is the point —
    // so the transaction count is what proves no write path ran to commit.
    expect(test.transactions).toEqual({ committed: 1, rolledBack: 0 });
  });

  it('refuses an unstorable Control name with a sentence, not a driver error', async () => {
    // The storability check lived in the create path only, so a NUL or a lone surrogate
    // walked past the rename guard and threw a raw NotCanonicalizableError from inside
    // the transaction — a framework 500 where the spec's matrix requires a refusal.
    const { test, procedureId, versionId, rowVersion } = await seeded();

    for (const unstorable of ['A name with a NUL\u0000in it', 'A lone surrogate \ud800 here']) {
      const outcome = await renameProcedureDraft(test.dependencies, {
        session: AUDITOR,
        procedureId,
        versionId,
        controlName: unstorable,
        expectedRowVersion: rowVersion,
        correlationId: 'corr-unstorable',
      });

      expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_STORABLE });
    }

    // Refused before the transaction opened: nothing written, nothing rolled back.
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 0 });
    expect((test.storedVersions.get(versionId) as ProcedureVersionRecord).controlName).not.toContain(
      'NUL',
    );
  });

  it('refuses a stale row version and changes nothing', async () => {
    const { test, procedureId, versionId, version, rowVersion } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: 'A rename from a stale tab',
      expectedRowVersion: rowVersion,
      correlationId: 'corr-5',
    });
    expect(outcome.ok).toBe(true);

    // The second tab, opened before the first rename.
    const stale = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: 'A rename that loses',
      expectedRowVersion: rowVersion,
      correlationId: 'corr-6',
    });

    expect(stale).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
    expect((test.storedVersions.get(versionId) as ProcedureVersionRecord).controlName).toBe(
      'A rename from a stale tab',
    );
    expect(test.transactions).toEqual({ committed: 1, rolledBack: 1 });
  });

  it('refuses a version that is not a DRAFT', async () => {
    const { test, procedureId, versionId, rowVersion } = await seeded();
    const version = test.storedVersions.get(versionId) as ProcedureVersionRecord;
    test.storedVersions.set(versionId, { ...version, state: 'ACTIVE' });

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      controlName: 'Renaming an Active version',
      expectedRowVersion: procedureVersionRowVersion({ ...version, state: 'ACTIVE' }),
      correlationId: 'corr-7',
    });

    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT });
  });

  it('refuses a version that belongs to another Procedure', async () => {
    const { test, versionId, rowVersion } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId: '018f0000-0000-7000-8000-0000000000ff',
      versionId,
      controlName: 'Renamed',
      expectedRowVersion: rowVersion,
      correlationId: 'corr-8',
    });

    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.UNKNOWN_VERSION });
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 1 });
  });

  it('refuses an unknown version', async () => {
    const { test, procedureId } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId: '018f0000-0000-7000-8000-0000000000fe',
      controlName: 'Renamed',
      expectedRowVersion: '0'.repeat(64),
      correlationId: 'corr-9',
    });

    expect(outcome).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.UNKNOWN_VERSION });
  });

  it('refuses a PoC Administrator, and stores nothing', async () => {
    const test = harness();
    const outcome = await renameProcedureDraft(test.dependencies, {
      session: POC_ADMIN,
      procedureId: '018f0000-0000-7000-8000-0000000000aa',
      versionId: '018f0000-0000-7000-8000-0000000000bb',
      controlName: 'Renamed',
      expectedRowVersion: '0'.repeat(64),
      correlationId: 'corr-10',
    });

    expect(outcome).toEqual({
      ok: false,
      reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
    });
    expect(test.events.map((event) => event.eventType)).toEqual(['security.denied']);
  });

  it.each([
    [{ controlName: '' }, PROCEDURE_REFUSALS.NAME_REQUIRED],
    [{ controlName: 'x'.repeat(201) }, PROCEDURE_REFUSALS.TOO_LONG],
  ])('refuses a bad Control name (%j) before opening a transaction', async (overrides, reason) => {
    const { test, procedureId, versionId, rowVersion } = await seeded();

    const outcome = await renameProcedureDraft(test.dependencies, {
      session: AUDITOR,
      procedureId,
      versionId,
      expectedRowVersion: rowVersion,
      correlationId: 'corr-11',
      ...overrides,
    });

    expect(outcome).toEqual({ ok: false, reason });
    expect(test.transactions).toEqual({ committed: 0, rolledBack: 0 });
  });

  it('leaves the Draft untouched when the append fails', async () => {
    const { test, procedureId, versionId, version, rowVersion } = await seeded();
    test.failAppend = true;

    await expect(
      renameProcedureDraft(test.dependencies, {
        session: AUDITOR,
        procedureId,
        versionId,
        controlName: 'Renamed',
        expectedRowVersion: rowVersion,
        correlationId: 'corr-12',
      }),
    ).rejects.toThrow('the audit append failed');

    expect((test.storedVersions.get(versionId) as ProcedureVersionRecord).controlName).toBe(
      version.controlName,
    );
  });
});

describe('the row version token', () => {
  const RECORD: ProcedureVersionRecord = {
    ...initialDraftPopulation('P-1'),
    versionId: '018f0000-0000-7000-8000-000000000001',
    procedureId: '018f0000-0000-7000-8000-000000000002',
    versionNumber: 1,
    state: 'DRAFT',
    controlName: 'A Control name',
    templateId: 'P-1',
    sections: initialDraftSections('P-1'),
  };

  it('moves when any field a save would replace moves', () => {
    const variants: readonly ProcedureVersionRecord[] = [
      { ...RECORD, controlName: 'Another name' },
      { ...RECORD, versionNumber: 2 },
      { ...RECORD, state: 'ACTIVE' },
      { ...RECORD, sections: initialDraftSections('P-2') },
      { ...RECORD, templateId: 'P-2' },
      { ...RECORD, versionId: '018f0000-0000-7000-8000-000000000003' },
      { ...RECORD, procedureId: '018f0000-0000-7000-8000-000000000004' },
      { ...RECORD, period: { from: '2026-01-01', to: '2026-01-31' } },
      { ...RECORD, scope: 'Scope' },
      { ...RECORD, inclusionRule: { schemaVersion: 1, all: [] } },
      { ...RECORD, zeroRecordPass: true },
      { ...RECORD, allowVersionedDuplicates: true },
      { ...RECORD, populationBlockers: ['declared-count-missing'] },
    ];
    for (const variant of variants) {
      expect(procedureVersionRowVersion(variant)).not.toBe(procedureVersionRowVersion(RECORD));
    }
  });

  it('is 64 lower-case hex characters', () => {
    expect(procedureVersionRowVersion(RECORD)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Draft Period and Population Source changes', () => {
  const bindingFields = { kind: 'versioned-file' as const, location: 'https://data.synthetic.invalid/leavers.csv', declaredSchema: ['employment_status', 'termination_effective_date'], declaredCountMechanism: 'cover-sheet' as const, sensitiveFields: [] };
  const binding: BindingRecord = { ...bindingFields, bindingId: '018f0000-0000-7000-8000-000000000099', displayName: 'Synthetic leavers', status: 'active', note: '', digest: bindingDigest(bindingFields) };
  const bindEdit: DraftPopulationEdit = { section: 'population-source', source: { mode: 'bind', bindingId: binding.bindingId, expectedDigest: binding.digest }, inclusionRule: initialDraftPopulation('P-1').inclusionRule, zeroRecordPass: false, allowVersionedDuplicates: false };
  async function setup() {
    const test = harness();
    const created = await create(test);
    if (!created.ok) throw new Error(created.reason);
    test.bindings.set(binding.bindingId, binding);
    const record = () => test.storedVersions.get(created.versionId)!;
    const save = (edit: DraftPopulationEdit, token = procedureVersionRowVersion(record())) => updatePopulationDraft(test.dependencies, { session: AUDITOR, correlationId: 'population-save', procedureId: created.procedureId, versionId: created.versionId, expectedRowVersion: token, edit });
    return { test, record, save };
  }
  it('saves a date-only Period and verbatim scope, and guards the shared row', async () => {
    const { test, record, save } = await setup();
    const token = procedureVersionRowVersion(record());
    const edit: DraftPopulationEdit = { section: 'period-scope', period: { from: '2024-02-29', to: '2024-03-01' }, scope: '  All terminated staff.\nExcept contractors.  ' };
    expect(await save(edit)).toMatchObject({ ok: true, changed: true });
    expect(record().period).toEqual(edit.period);
    expect(record().scope).toBe(edit.scope);
    expect(await save(edit)).toMatchObject({ ok: true, changed: false });
    expect(await save(bindEdit, token)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
    expect(test.events).toHaveLength(2);
  });
  it('freezes the exact source contract and keeps independent flags and blockers', async () => {
    const { test, record, save } = await setup();
    const noCount = { ...binding, declaredCountMechanism: 'none' as const };
    const digest = bindingDigest(noCount);
    test.bindings.set(binding.bindingId, { ...noCount, digest });
    expect(await save({ ...bindEdit, source: { mode: 'bind', bindingId: binding.bindingId, expectedDigest: digest }, zeroRecordPass: true })).toMatchObject({ ok: true });
    expect(record()).toMatchObject({ sourceSnapshot: { bindingId: binding.bindingId, digest, contract: { declared_count_mechanism: 'none', declared_schema: binding.declaredSchema, kind: binding.kind, location: binding.location, sensitive_fields: [] } }, populationBlockers: ['declared-count-missing'], zeroRecordPass: true, allowVersionedDuplicates: false });
    expect(await save({ ...bindEdit, source: { mode: 'retain' }, zeroRecordPass: false, allowVersionedDuplicates: true })).toMatchObject({ ok: true });
    expect(record()).toMatchObject({ zeroRecordPass: false, allowVersionedDuplicates: true });
    expect(test.events.at(-1)?.eventType).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
  });
  it('refuses a retired new selection and changed digest without writes, but retains a historical snapshot', async () => {
    const { test, record, save } = await setup();
    expect(await save(bindEdit)).toMatchObject({ ok: true });
    const snapshot = record().sourceSnapshot;
    test.bindings.set(binding.bindingId, { ...binding, status: 'retired' });
    expect(await save(bindEdit)).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.SOURCE });
    expect(await save({ ...bindEdit, source: { mode: 'retain' }, zeroRecordPass: true })).toMatchObject({ ok: true });
    expect(record().sourceSnapshot).toEqual(snapshot);
    test.bindings.set(binding.bindingId, { ...binding, digest: '0'.repeat(64) });
    const count = test.events.length;
    expect(await save(bindEdit)).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.STALE_SOURCE });
    expect(record().sourceSnapshot).toEqual(snapshot);
    expect(test.events).toHaveLength(count);
  });
  it('refuses the exact manual-upload blocker for recurring Schedule and accepts once', async () => {
    const { test, record, save } = await setup();
    const manual = { ...binding, kind: 'manual-upload' as const, location: '' };
    const digest = bindingDigest(manual);
    test.bindings.set(binding.bindingId, { ...manual, digest });
    const edit = { ...bindEdit, source: { mode: 'bind' as const, bindingId: binding.bindingId, expectedDigest: digest } };
    expect(await save(edit)).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.MANUAL_UPLOAD });
    expect(test.events).toHaveLength(1);
    const before = record();
    test.storedVersions.set(before.versionId, { ...before, sections: before.sections.map((s) => s.heading === 'Schedule' ? { ...s, content: 'once' } : s) });
    expect(await save(edit)).toMatchObject({ ok: true });
  });
  it('rejects an incompatible Template column without falling back to include-all', async () => {
    const { test, record, save } = await setup();
    const other = { ...binding, declaredSchema: ['employee_id'] };
    const digest = bindingDigest(other);
    test.bindings.set(binding.bindingId, { ...other, digest });
    expect(await save({ ...bindEdit, source: { mode: 'bind', bindingId: binding.bindingId, expectedDigest: digest } })).toEqual({ ok: false, reason: POPULATION_DRAFT_MESSAGES.RULE });
    expect(record().sourceSnapshot).toBeNull();
    expect(record().inclusionRule.all).toHaveLength(2);
    expect(test.events).toHaveLength(1);
  });
  it('rolls the changed row back when the audit append fails', async () => {
    const { test, record, save } = await setup();
    const before = record();
    test.failAppend = true;
    await expect(save(bindEdit)).rejects.toThrow('audit append failed');
    expect(record()).toEqual(before);
    expect(test.events).toHaveLength(1);
  });
  it('authorizes before reading an edit', async () => {
    const test = harness('poc-administrator');
    const input = { session: POC_ADMIN, correlationId: 'denied', get edit(): never { throw new Error('must not parse'); } };
    await expect(updatePopulationDraft(test.dependencies, input as never)).resolves.toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });
  });
});
