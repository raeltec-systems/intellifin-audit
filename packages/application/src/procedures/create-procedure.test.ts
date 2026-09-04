import { initialPlanDerivation, planAuthoringDigest } from './plan-state.js';
import type { PlanDerivationJob } from './plan-ports.js';
import { describe, expect, it } from 'vitest';

import { DENIAL_REASONS, initialDraftSections, initialDraftPopulation, initialDraftTargets, initialDraftCompliance, initialDraftEvidence, evidenceBlockersFor, complianceInputFromFields, COMPLIANCE_MESSAGES, EVIDENCE_DRAFT_MESSAGES, EVIDENCE_DRAFT_LIMITS, bindingDigest, registrationDigest, POPULATION_DRAFT_MESSAGES, TARGET_DRAFT_MESSAGES, type AuditEventDraft, type ComplianceDraftInput } from '@intellifin/domain';
import type { BindingRecord } from '../sources/ports.js';
import type { RegistrationRecord } from '../registrations/ports.js';
import { updatePopulationDraft, type DraftPopulationEdit } from './update-population-draft.js';
import { updateTargetDraft, type DraftTargetEdit } from './update-target-draft.js';
import { updateComplianceDraft } from './update-compliance-draft.js';
import { updateEvidenceDraft } from './update-evidence-draft.js';

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
  readonly registrations: Map<string, RegistrationRecord>;
  readonly dependencies: ProcedureDependencies;
  /** Committed procedure rows, by id. A rolled-back transaction never reaches this. */
  readonly storedProcedures: Map<string, ProcedureRecord>;
  /** Committed version rows, by version id. */
  readonly storedVersions: Map<string, ProcedureVersionRecord>;
  /** Committed audit events, in order. */
  readonly events: AuditEventDraft[];
  readonly jobs: PlanDerivationJob[];
  /** Set to make the append throw, so a failed append can be observed. */
  failAppend: boolean;
  /** How many transactions committed, and how many rolled back. */
  readonly transactions: { committed: number; rolledBack: number };
}

function harness(role: 'auditor' | 'poc-administrator' = 'auditor'): Harness {
  const bindings = new Map<string, BindingRecord>();
  const registrations = new Map<string, RegistrationRecord>();
  const storedProcedures = new Map<string, ProcedureRecord>();
  const storedVersions = new Map<string, ProcedureVersionRecord>();
  const events: AuditEventDraft[] = [];
  const jobs: PlanDerivationJob[] = [];
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
      const draftJobs: PlanDerivationJob[] = [];
      const context: ProceduresUnitOfWorkContext = {
        derivationJobs: { enqueue: async (job) => { draftJobs.push(job); } },
        populationSources: { findBindingForShare: async (id) => bindings.get(id) ?? null },
        targetRegistrations: {
          // Sorted, deduplicated, present-only — the same contract the Drizzle reader keeps.
          lockForSelection: async (ids) =>
            [...new Set(ids)]
              .sort()
              .map((id) => registrations.get(id))
              .filter((record): record is RegistrationRecord => record !== undefined),
        },
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
      // Every changed authored version has one transactional job; idle/refused saves have none.
      expect(draftJobs).toHaveLength(draftEvents.filter((event) => event.eventType === 'lifecycle.procedure-created' || event.eventType === PROCEDURE_DRAFT_CHANGED_EVENT).length);
      for (const job of draftJobs) expect(job.inputDigest).toBe(planAuthoringDigest(draftVersions.get(job.versionId)!));
      transactions.committed += 1;
      storedProcedures.clear();
      for (const [id, record] of draftProcedures) storedProcedures.set(id, record);
      storedVersions.clear();
      for (const [id, record] of draftVersions) storedVersions.set(id, record);
      events.push(...draftEvents);
      jobs.push(...draftJobs);
      return result;
    },
  };

  let counter = 0;
  const ids = {
    next: () => `018f0000-0000-7000-8000-${String(counter++).padStart(12, '0')}`,
  };

  return {
    bindings,
    registrations,
    dependencies: { roles, unitOfWork, ids } satisfies ProcedureDependencies,
    storedProcedures,
    storedVersions,
    events,
    jobs,
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

describe('updateComplianceDraft', () => {
  async function setup() {
    const test = harness();
    const created = await create(test);
    if (!created.ok) throw new Error(created.reason);
    const record = () => test.storedVersions.get(created.versionId)!;
    const save = (edit: ComplianceDraftInput, expectedRowVersion = procedureVersionRowVersion(record())) =>
      updateComplianceDraft(test.dependencies, {
        session: AUDITOR, correlationId: 'compliance-save', procedureId: created.procedureId,
        versionId: created.versionId, expectedRowVersion, edit,
      });
    test.events.length = 0;
    return { test, created, record, save };
  }

  it('stores verbatim edited text and an exact threshold, discards old compilation, and audits metadata', async () => {
    const { test, record, save } = await setup();
    const before = record();
    const text = '  Check vault://private/compliance using human judgment.  ';
    const edit = complianceInputFromFields(before);
    const changed = { ...edit, confidenceThreshold: '0.9000', conditions: edit.conditions.map((condition, index) => index === 0 ? { ...condition, text } : condition) };
    const result = await save(changed);
    expect(result).toMatchObject({ ok: true, changed: true, rowVersion: procedureVersionRowVersion(record()) });
    expect(record().complianceConditions[0]).toMatchObject({ text, status: 'AGENT_JUDGED', rule: null });
    expect(record().agentJudgedThreshold).toBe('0.9000');
    expect(record().inclusionRule).toEqual(before.inclusionRule);
    expect(test.events).toHaveLength(1);
    expect(test.events[0]).toMatchObject({ eventType: PROCEDURE_DRAFT_CHANGED_EVENT, payload: { section: 'compliance-rule' } });
    expect(JSON.stringify(test.events)).not.toContain('vault://');
    expect(test.events[0]?.payload).toMatchObject({ current: { conditions: [
      expect.objectContaining({ conditionId: changed.conditions[0]!.conditionId, textLength: text.length, textDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      expect.anything(),
    ] } });
  });

  it('does not write or append when an unchanged save recompiles identically', async () => {
    const { test, record, save } = await setup();
    const before = record();
    expect(await save(complianceInputFromFields(before))).toEqual({ ok: true, changed: false, rowVersion: procedureVersionRowVersion(before) });
    expect(record()).toBe(before);
    expect(test.events).toEqual([]);
  });

  it('refuses malformed authored input and client compilation claims without an event', async () => {
    const { test, record, save } = await setup();
    const before = record();
    const edit = complianceInputFromFields(before);
    const first = edit.conditions[0]!;
    for (const invalid of [
      { ...edit, conditions: [first, first] },
      { ...edit, conditions: [{ ...first, applicability: 'do arbitrary code()' }] },
      { ...edit, conditions: [{ ...first, status: 'RULE', rule: { kind: 'constant', value: true } }] },
      { ...edit, confidenceThreshold: 'NaN' },
      { ...edit, confidenceThreshold: '1.00001' },
      { ...edit, conditions: [{ ...first, text: 'bad\u0000text' }] },
    ]) {
      expect(await save(invalid as ComplianceDraftInput)).toMatchObject({ ok: false });
      expect(record()).toEqual(before);
    }
    expect(test.events).toEqual([]);
  });

  it('refuses stale, unknown, non-Draft and unsupported-compiler rows', async () => {
    const { test, created, record, save } = await setup();
    const before = record(), edit = complianceInputFromFields(before);
    expect(await save(edit, 'old')).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
    test.storedVersions.set(created.versionId, { ...before, state: 'SUBMITTED' });
    expect(await save(edit)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT });
    test.storedVersions.set(created.versionId, { ...before, complianceCompilerVersion: 'future' } as unknown as ProcedureVersionRecord);
    expect(await save(edit)).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.COMPILER });
    test.storedVersions.delete(created.versionId);
    expect(await save(edit, 'token')).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.UNKNOWN_VERSION });
    expect(test.events).toEqual([]);
  });

  it('rolls the whole change back after a failed audit append', async () => {
    const { test, record, save } = await setup();
    const before = record();
    test.failAppend = true;
    await expect(save({ ...complianceInputFromFields(before), confidenceThreshold: '0.95' })).rejects.toThrow('the audit append failed');
    expect(record()).toEqual(before);
    expect(test.events).toEqual([]);
    expect(test.transactions.rolledBack).toBe(1);
  });

  it('refuses a forbidden role before reading the authored input', async () => {
    const test = harness('poc-administrator');
    const input = { session: POC_ADMIN, correlationId: 'denied-compliance', get edit(): never { throw new Error('must not parse'); } };
    await expect(updateComplianceDraft(test.dependencies, input as never)).resolves.toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });
  });
});

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
      expect(version).toMatchObject(initialDraftCompliance(templateId));
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
      rowVersion: procedureVersionRowVersion(test.storedVersions.get(versionId)!),
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
    ...initialDraftCompliance('P-1'),
    ...initialDraftPopulation('P-1'),
    ...initialDraftTargets(),
    ...initialDraftEvidence('P-1'),
    ...initialPlanDerivation(),
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
      { ...RECORD, agentJudgedThreshold: '0.90' },
      { ...RECORD, complianceConditions: initialDraftCompliance('P-3').complianceConditions },
      { ...RECORD, populationBlockers: ['declared-count-missing'] },
      {
        ...RECORD,
        targets: [
          {
            registrationId: '018f0000-0000-7000-8000-0000000000a1',
            displayName: 'LoanCore',
            digest: '0'.repeat(64),
            contract: {
              allowed_origins: ['http://localhost:4300/loancore'],
              attribute_label_patterns: ['Status'],
              credential_ref: 'vault://loancore',
              kind: 'web',
              permitted_actions: ['navigate'],
              secondary_key: null,
            },
          },
        ],
      },
      { ...RECORD, instructions: [{ registrationId: '018f0000-0000-7000-8000-0000000000a1', text: 'Open the record and read the status.' }] },
      { ...RECORD, evidenceRequirements: [{ attributeName: 'notes', modelRead: true, groundedBy: [], screenshot: false, recordingSegment: false, platformCaptured: false }] },
      { ...RECORD, schedule: { frequency: 'weekly', startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' } },
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
  it('the manual-upload/recurring-Schedule pairing is a completeness blocker, not a save-time refusal (Story 2.5)', async () => {
    const { test, record, save } = await setup();
    const manual = { ...binding, kind: 'manual-upload' as const, location: '' };
    const digest = bindingDigest(manual);
    test.bindings.set(binding.bindingId, { ...manual, digest });
    const edit = { ...bindEdit, source: { mode: 'bind' as const, bindingId: binding.bindingId, expectedDigest: digest } };
    // A Draft starts with no Schedule (`initialDraftEvidence`), so binding manual-upload
    // BEFORE a Schedule is chosen succeeds — `validatePopulationBinding` no longer reads
    // the Schedule at all.
    expect(await save(edit)).toMatchObject({ ok: true, changed: true });
    expect(evidenceBlockersFor(record().sourceSnapshot, null)).toEqual([]);
    // Saving a recurring Schedule afterwards ALSO succeeds — the pairing is advisory —
    // and the blocker now shows on both sections.
    const scheduled = await updateEvidenceDraft(test.dependencies, {
      session: AUDITOR,
      correlationId: 'schedule-save',
      procedureId: record().procedureId,
      versionId: record().versionId,
      expectedRowVersion: procedureVersionRowVersion(record()),
      edit: { section: 'schedule', frequency: 'weekly', startTime: '02:00' },
    });
    expect(scheduled).toMatchObject({ ok: true, changed: true });
    expect(evidenceBlockersFor(record().sourceSnapshot, record().schedule)).toEqual(['upload-frequency-mismatch']);
    // A `once` Schedule clears the blocker.
    const onceSaved = await updateEvidenceDraft(test.dependencies, {
      session: AUDITOR,
      correlationId: 'schedule-save-once',
      procedureId: record().procedureId,
      versionId: record().versionId,
      expectedRowVersion: procedureVersionRowVersion(record()),
      edit: { section: 'schedule', frequency: 'once', startTime: '02:00' },
    });
    expect(onceSaved).toMatchObject({ ok: true, changed: true });
    expect(evidenceBlockersFor(record().sourceSnapshot, record().schedule)).toEqual([]);
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

describe('Draft Target System and Audit Instruction changes', () => {
  const WEB = '018f0000-0000-7000-8000-0000000000d1';
  const DESKTOP = '018f0000-0000-7000-8000-0000000000d2';
  const API = '018f0000-0000-7000-8000-0000000000d3';

  function reg(
    registrationId: string,
    over: Partial<RegistrationRecord> & Pick<RegistrationRecord, 'kind'>,
  ): RegistrationRecord {
    const fields = {
      kind: over.kind,
      allowedOrigins: over.allowedOrigins ?? ['http://localhost:4300/loancore'],
      applicationIdentity: over.applicationIdentity ?? '',
      credentialRef: over.credentialRef ?? 'vault://audit/loancore',
      permittedActions: over.permittedActions ?? (['navigate', 'read-attribute'] as const),
      attributeLabelPatterns: over.attributeLabelPatterns ?? ['Status', 'Username'],
      secondaryKey: over.secondaryKey ?? '',
    };
    return {
      registrationId,
      displayName: over.displayName ?? 'LoanCore',
      note: '',
      status: over.status ?? 'active',
      ...fields,
      digest: registrationDigest(fields),
    };
  }

  const webReg = reg(WEB, { kind: 'web', displayName: 'LoanCore' });
  const desktopReg = reg(DESKTOP, {
    kind: 'desktop',
    displayName: 'LedgerDesk',
    allowedOrigins: [],
    applicationIdentity: 'com.northstar.ledgerdesk',
    credentialRef: 'vault://audit/ledgerdesk',
  });
  const apiReg = reg(API, {
    kind: 'api',
    displayName: 'AccessGate',
    allowedOrigins: ['https://accessgate.synthetic.invalid'],
    permittedActions: ['list-records', 'read-attribute'],
  });

  async function setup() {
    const test = harness();
    for (const record of [webReg, desktopReg, apiReg]) test.registrations.set(record.registrationId, record);
    const created = await create(test);
    if (!created.ok) throw new Error(created.reason);
    test.events.length = 0;
    const record = () => test.storedVersions.get(created.versionId)!;
    const save = (edit: DraftTargetEdit, token = procedureVersionRowVersion(record())) =>
      updateTargetDraft(test.dependencies, {
        session: AUDITOR,
        correlationId: 'target-save',
        procedureId: created.procedureId,
        versionId: created.versionId,
        expectedRowVersion: token,
        edit,
      });
    const bind = (registration: RegistrationRecord) =>
      ({ mode: 'bind', registrationId: registration.registrationId, expectedDigest: registration.digest }) as const;
    return { test, created, record, save, bind };
  }

  it('freezes the exact six-field contract per selected system and keeps credentials out of the chain', async () => {
    const { test, record, save, bind } = await setup();
    const outcome = await save({ section: 'target-systems', selections: [bind(webReg), bind(desktopReg)] });
    expect(outcome).toMatchObject({ ok: true, changed: true });

    const targets = record().targets;
    expect(targets.map((target) => target.registrationId)).toEqual([WEB, DESKTOP]);
    expect(targets[0]).toMatchObject({
      registrationId: WEB,
      displayName: 'LoanCore',
      digest: webReg.digest,
      contract: { kind: 'web', credential_ref: 'vault://audit/loancore', secondary_key: null },
    });
    // The desktop application identity occupies the allowed_origins slot.
    expect(targets[1]?.contract).toMatchObject({ kind: 'desktop', allowed_origins: ['com.northstar.ledgerdesk'] });

    // One event, and no credential reference anywhere in its payload.
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
    expect(JSON.stringify(test.events[0]?.payload)).not.toContain('vault://');
  });

  it('refuses a duplicate selection and stores nothing', async () => {
    const { record, save, bind } = await setup();
    const before = record().targets;
    expect(await save({ section: 'target-systems', selections: [bind(webReg), bind(webReg)] })).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.DUPLICATE,
    });
    expect(record().targets).toEqual(before);
  });

  it('refuses a changed digest (unseen data) and a retired selection (ineligible) without writes', async () => {
    const { test, record, save, bind } = await setup();
    // The registration moved after the page rendered its digest.
    test.registrations.set(WEB, reg(WEB, { kind: 'web', displayName: 'LoanCore', credentialRef: 'vault://audit/rotated' }));
    expect(await save({ section: 'target-systems', selections: [bind(webReg)] })).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.UNSEEN,
    });
    // A retired registration cannot be newly selected.
    test.registrations.set(API, { ...apiReg, status: 'retired' });
    expect(await save({ section: 'target-systems', selections: [bind(apiReg)] })).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.INELIGIBLE,
    });
    expect(record().targets).toHaveLength(0);
    expect(test.events).toHaveLength(0);
  });

  it('retains a saved snapshot unchanged after the registration changes or retires', async () => {
    const { test, record, save, bind } = await setup();
    expect(await save({ section: 'target-systems', selections: [bind(webReg)] })).toMatchObject({ ok: true });
    const frozen = record().targets[0];

    // The registration is changed and then retired; the retained snapshot never refreshes.
    test.registrations.set(WEB, reg(WEB, { kind: 'web', displayName: 'LoanCore renamed', credentialRef: 'vault://audit/new', status: 'retired' }));
    expect(await save({ section: 'target-systems', selections: [{ mode: 'retain', registrationId: WEB }] })).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(record().targets[0]).toEqual(frozen);

    // Retaining a system that was never saved is refused.
    expect(await save({ section: 'target-systems', selections: [{ mode: 'retain', registrationId: DESKTOP }] })).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.RETAIN_UNKNOWN,
    });
  });

  it('refuses a stored digest that disagrees with its contract without repairing it', async () => {
    const { test, record, save, bind } = await setup();
    const inconsistent = { ...webReg, digest: '0'.repeat(64) };
    test.registrations.set(WEB, inconsistent);
    // The rendered stored digest matches, but the contract is not the one it attests to.
    expect(await save({ section: 'target-systems', selections: [bind(inconsistent)] })).toEqual({
      ok: false, reason: TARGET_DRAFT_MESSAGES.INVALID_SNAPSHOT,
    });
    // Posting the recomputed value instead must not bypass the stored digest guard.
    expect(await save({ section: 'target-systems', selections: [bind(webReg)] })).toEqual({
      ok: false, reason: TARGET_DRAFT_MESSAGES.UNSEEN,
    });
    expect(record().targets).toEqual([]);
    expect(test.events).toEqual([]);
  });

  it('returns domain refusals for malformed edits before writing or appending an event', async () => {
    const { test, record, save, bind } = await setup();
    await save({ section: 'target-systems', selections: [bind(webReg), bind(apiReg)] });
    test.events.length = 0;
    const before = record();
    for (const edit of [null, undefined, { section: 'audit-instructions', instructions: null },
      { section: 'audit-instructions', instructions: [{ registrationId: API, text: '' }] },
      { section: 'audit-instructions', instructions: [{ registrationId: DESKTOP, text: '' }] },
      { section: 'audit-instructions', instructions: [{ registrationId: WEB, text: '' }, { registrationId: WEB, text: 'Read it.' }] },
      { section: 'audit-instructions', instructions: [{ registrationId: WEB, text: ' '.repeat(10001) }] },
    ]) {
      expect(await save(edit as DraftTargetEdit)).toMatchObject({ ok: false, reason: expect.any(String) });
      expect(record()).toEqual(before);
      expect(test.events).toEqual([]);
    }
  });

  it('refuses target and instruction edits to a non-Draft version', async () => {
    const { test, record, save, bind, created } = await setup();
    test.storedVersions.set(created.versionId, { ...record(), state: 'SUBMITTED' });
    for (const edit of [
      { section: 'target-systems', selections: [bind(webReg)] },
      { section: 'audit-instructions', instructions: [] },
    ] as const) {
      expect(await save(edit)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT });
    }
    expect(test.events).toEqual([]);
  });

  it('saves advisory text verbatim, then clears it without a stale warning or event on an idle clear', async () => {
    const { test, record, save, bind } = await setup();
    await save({ section: 'target-systems', selections: [bind(webReg)] });
    const text = '  Open PayrollVault with vault://audit/loancore, then disable the account.\n';
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: WEB, text }] })).toMatchObject({ ok: true, changed: true });
    expect(record().instructions).toEqual([{ registrationId: WEB, text }]);
    expect(JSON.stringify(test.events.at(-1)?.payload)).not.toContain('vault://');
    expect(test.events.at(-1)?.payload).toMatchObject({ current: { instructions: [
      { registrationId: WEB, textDigest: expect.stringMatching(/^[0-9a-f]{64}$/), textLength: text.length },
    ] } });
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: WEB, text: '' }] })).toMatchObject({ ok: true, changed: true });
    expect(record().instructions).toEqual([]);
    test.events.length = 0;
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: WEB, text: '' }] })).toMatchObject({ ok: true, changed: false });
    expect(test.events).toEqual([]);
  });

  it('stores instructions verbatim for agent systems and refuses an orphan or an API instruction', async () => {
    const { test, record, save, bind } = await setup();
    await save({ section: 'target-systems', selections: [bind(webReg), bind(apiReg)] });
    const token = procedureVersionRowVersion(record());

    // An API system takes no agent instructions.
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: API, text: 'read it' }] }, token)).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION,
    });
    // An instruction for a system that is not selected at all is an orphan.
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: DESKTOP, text: 'read it' }] }, token)).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION,
    });

    const verbatim = '  Open the account record and note its status.  ';
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: WEB, text: verbatim }] }, token)).toMatchObject({ ok: true, changed: true });
    expect(record().instructions).toEqual([{ registrationId: WEB, text: verbatim }]);
    expect(test.events.at(-1)?.eventType).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
  });

  it('prunes an instruction when its system is deselected, and refuses an unstorable one', async () => {
    const { record, save, bind } = await setup();
    await save({ section: 'target-systems', selections: [bind(webReg), bind(desktopReg)] });
    await save({ section: 'audit-instructions', instructions: [{ registrationId: WEB, text: 'Read the status.' }, { registrationId: DESKTOP, text: 'Read the roles.' }] }, procedureVersionRowVersion(record()));
    expect(record().instructions).toHaveLength(2);

    // Deselect LoanCore; its instruction is pruned, LedgerDesk's survives.
    await save({ section: 'target-systems', selections: [{ mode: 'retain', registrationId: DESKTOP }] }, procedureVersionRowVersion(record()));
    expect(record().instructions).toEqual([{ registrationId: DESKTOP, text: 'Read the roles.' }]);

    // A NUL cannot be stored: a sentence, not a driver error.
    expect(await save({ section: 'audit-instructions', instructions: [{ registrationId: DESKTOP, text: 'bad\u0000text' }] }, procedureVersionRowVersion(record()))).toEqual({
      ok: false,
      reason: TARGET_DRAFT_MESSAGES.NOT_STORABLE,
    });
  });

  it('writes nothing on an idle save, refuses a stale token, and rolls back a failed append', async () => {
    const { test, record, save, bind } = await setup();
    await save({ section: 'target-systems', selections: [bind(webReg)] });
    const token = procedureVersionRowVersion(record());
    test.events.length = 0;

    // Idle re-save of the same selection.
    expect(await save({ section: 'target-systems', selections: [{ mode: 'retain', registrationId: WEB }] }, token)).toMatchObject({ ok: true, changed: false });
    expect(test.events).toHaveLength(0);

    // A stale tab loses.
    expect(await save({ section: 'target-systems', selections: [] }, '0'.repeat(64))).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });

    // A failed append rolls the change back.
    const before = record();
    test.failAppend = true;
    await expect(save({ section: 'target-systems', selections: [] }, token)).rejects.toThrow('audit append failed');
    expect(record()).toEqual(before);
  });

  it('refuses a PoC Administrator before reading the edit', async () => {
    const test = harness('poc-administrator');
    const input = { session: POC_ADMIN, correlationId: 'denied', get edit(): never { throw new Error('must not parse'); } };
    await expect(updateTargetDraft(test.dependencies, input as never)).resolves.toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });
  });
});

describe('Draft Evidence Requirements and Schedule changes', () => {
  const WEB = '018f0000-0000-7000-8000-0000000000e1';
  const API = '018f0000-0000-7000-8000-0000000000e2';

  function reg(registrationId: string, over: Partial<RegistrationRecord> & Pick<RegistrationRecord, 'kind'>): RegistrationRecord {
    const fields = {
      kind: over.kind,
      allowedOrigins: over.allowedOrigins ?? ['http://localhost:4300/loancore'],
      applicationIdentity: over.applicationIdentity ?? '',
      credentialRef: over.credentialRef ?? 'vault://audit/loancore',
      permittedActions: over.permittedActions ?? (['navigate', 'read-attribute'] as const),
      attributeLabelPatterns: over.attributeLabelPatterns ?? ['Status'],
      secondaryKey: over.secondaryKey ?? '',
    };
    return { registrationId, displayName: over.displayName ?? 'LoanCore', note: '', status: over.status ?? 'active', ...fields, digest: registrationDigest(fields) };
  }
  const webReg = reg(WEB, { kind: 'web', displayName: 'LoanCore' });
  const apiReg = reg(API, { kind: 'api', displayName: 'AccessGate', allowedOrigins: ['https://accessgate.synthetic.invalid'], permittedActions: ['list-records', 'read-attribute'] });

  function requirement(over: Partial<{ attributeName: string; modelRead: boolean; groundedBy: readonly ('structural-snapshot' | 'source-file-excerpt')[]; screenshot: boolean; recordingSegment: boolean }> = {}) {
    return { attributeName: 'account_status', modelRead: false, groundedBy: ['structural-snapshot'] as const, screenshot: true, recordingSegment: false, ...over };
  }

  async function setup(templateId: 'P-1' | 'P-2' = 'P-2') {
    const test = harness();
    for (const record of [webReg, apiReg]) test.registrations.set(record.registrationId, record);
    const created = await create(test, { templateId });
    if (!created.ok) throw new Error(created.reason);
    test.events.length = 0;
    const record = () => test.storedVersions.get(created.versionId)!;
    const save = (edit: Parameters<typeof updateEvidenceDraft>[1]['edit'], token = procedureVersionRowVersion(record())) =>
      updateEvidenceDraft(test.dependencies, { session: AUDITOR, correlationId: 'evidence-save', procedureId: created.procedureId, versionId: created.versionId, expectedRowVersion: token, edit });
    const selectTargets = (selections: readonly { readonly mode: 'bind'; readonly registrationId: string; readonly expectedDigest: string }[]) =>
      updateTargetDraft(test.dependencies, { session: AUDITOR, correlationId: 'target-save', procedureId: created.procedureId, versionId: created.versionId, expectedRowVersion: procedureVersionRowVersion(record()), edit: { section: 'target-systems', selections } });
    return { test, created, record, save, selectTargets };
  }

  it('saves typed Evidence Requirements that survive a reload, grounded by a Structural Snapshot', async () => {
    const { test, record, save } = await setup();
    const outcome = await save({ section: 'evidence-requirements', requirements: [requirement()] });
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(record().evidenceRequirements).toEqual([{ ...requirement(), platformCaptured: false }]);
    expect(test.events).toHaveLength(1);
    expect(test.events[0]?.eventType).toBe(PROCEDURE_DRAFT_CHANGED_EVENT);
  });

  it('refuses an attribute grounded only by a screenshot or a recording segment, naming the attribute, and writes nothing', async () => {
    const { test, record, save } = await setup();
    const before = record();
    const outcome = await save({ section: 'evidence-requirements', requirements: [requirement({ groundedBy: [], screenshot: true, recordingSegment: true })] });
    expect(outcome).toEqual({ ok: false, reason: 'Attribute "account_status": ' + EVIDENCE_DRAFT_MESSAGES.GROUNDING });
    expect(record()).toEqual(before);
    expect(test.events).toEqual([]);
  });

  it('accepts and records a model-read attribute, exempt from deterministic grounding, and it survives reload', async () => {
    const { record, save } = await setup();
    const outcome = await save({ section: 'evidence-requirements', requirements: [requirement({ modelRead: true, groundedBy: [], screenshot: false })] });
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(record().evidenceRequirements).toEqual([{ ...requirement({ modelRead: true, groundedBy: [], screenshot: false }), platformCaptured: false }]);
  });

  it('derives mandatory grounding before validation for an agent-driven target', async () => {
    const { record, save, selectTargets } = await setup();
    await selectTargets([{ mode: 'bind', registrationId: WEB, expectedDigest: webReg.digest }]);
    const asked = requirement({ groundedBy: [], screenshot: false });
    expect(await save({ section: 'evidence-requirements', requirements: [asked] })).toMatchObject({ ok: true, changed: true });
    expect(record().evidenceRequirements).toEqual([
      { ...asked, groundedBy: ['structural-snapshot'], screenshot: true, platformCaptured: true },
    ]);
  });

  it('records platformCaptured from the CURRENT Target System selection, never from the caller', async () => {
    const { record, save, selectTargets } = await setup();
    await selectTargets([{ mode: 'bind', registrationId: WEB, expectedDigest: webReg.digest }]);
    // The caller asks for grounding by a source file excerpt and no screenshot; the
    // command overrides the screenshot flag and adds Structural Snapshot grounding
    // because a web system is agent-driven and that capture is the platform's, not a
    // choice offered here.
    const asked = requirement({ groundedBy: ['source-file-excerpt'], screenshot: false });
    const outcome = await save({ section: 'evidence-requirements', requirements: [asked] }, procedureVersionRowVersion(record()));
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(record().evidenceRequirements).toEqual([
      { ...asked, groundedBy: ['source-file-excerpt', 'structural-snapshot'], screenshot: true, platformCaptured: true },
    ]);

    // Deselecting the agent-driven system and re-saving the SAME asked requirement drops
    // the platform-captured flag and the forced grounding — it is recomputed every save.
    await selectTargets([{ mode: 'bind', registrationId: API, expectedDigest: apiReg.digest }]);
    const outcome2 = await save({ section: 'evidence-requirements', requirements: [requirement()] }, procedureVersionRowVersion(record()));
    expect(outcome2).toMatchObject({ ok: true });
    expect(record().evidenceRequirements[0]?.platformCaptured).toBe(false);
  });

  it('saves a frequency and fixed UTC start with the matching recorded period-derivation rule, surviving reload', async () => {
    const { record, save } = await setup();
    const outcome = await save({ section: 'schedule', frequency: 'weekly', startTime: '02:00' });
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(record().schedule).toEqual({ frequency: 'weekly', startTime: '02:00', periodDerivationRule: 'previous-monday-sunday' });
  });

  it('updates capture metadata atomically when targets change, preserving authored evidence', async () => {
    const { test, record, save, selectTargets } = await setup();
    const authored = requirement({ attributeName: 'notes', modelRead: true, groundedBy: [], screenshot: false, recordingSegment: true });
    await save({ section: 'evidence-requirements', requirements: [authored] });
    const token = procedureVersionRowVersion(record());
    test.events.length = 0;
    await selectTargets([{ mode: 'bind', registrationId: WEB, expectedDigest: webReg.digest }]);
    expect(record().evidenceRequirements).toEqual([{ ...authored, groundedBy: ['structural-snapshot'], screenshot: true, platformCaptured: true }]);
    expect(test.events).toHaveLength(1);
    expect(await save({ section: 'evidence-requirements', requirements: [authored] }, token)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });
    await selectTargets([{ mode: 'bind', registrationId: API, expectedDigest: apiReg.digest }]);
    expect(record().evidenceRequirements[0]).toMatchObject({ attributeName: 'notes', modelRead: true, recordingSegment: true, platformCaptured: false });
  });

  it('never refuses the manual-upload/recurring-Schedule pairing on either section; it is surfaced as a blocker only', async () => {
    const { record, save } = await setup();
    expect(await save({ section: 'schedule', frequency: 'daily', startTime: '00:00' })).toMatchObject({ ok: true });
    expect(record().schedule).toMatchObject({ frequency: 'daily' });
  });

  it('refuses an unknown frequency, a malformed start time, a duplicate attribute, and too many requirements', async () => {
    const { test, record, save } = await setup();
    const before = record();
    for (const edit of [
      { section: 'schedule', frequency: 'yearly', startTime: '02:00' },
      { section: 'schedule', frequency: 'daily', startTime: 'noon' },
      { section: 'evidence-requirements', requirements: [requirement({ attributeName: 'Status' }), requirement({ attributeName: ' status ' })] },
      { section: 'evidence-requirements', requirements: Array.from({ length: EVIDENCE_DRAFT_LIMITS.requirements + 1 }, (_, i) => requirement({ attributeName: `a${i}` })) },
    ]) {
      expect(await save(edit as never)).toMatchObject({ ok: false, reason: expect.any(String) });
    }
    expect(record()).toEqual(before);
    expect(test.events).toEqual([]);
  });

  it('refuses evidence and schedule edits to a non-Draft version', async () => {
    const { test, created, record, save } = await setup();
    test.storedVersions.set(created.versionId, { ...record(), state: 'SUBMITTED' });
    for (const edit of [
      { section: 'evidence-requirements', requirements: [requirement()] },
      { section: 'schedule', frequency: 'once', startTime: '00:00' },
    ] as const) {
      expect(await save(edit)).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.NOT_A_DRAFT });
    }
    expect(test.events).toEqual([]);
  });

  it('writes nothing on an idle save, refuses a stale token, and rolls back a failed append', async () => {
    const { test, record, save } = await setup();
    await save({ section: 'schedule', frequency: 'once', startTime: '00:00' });
    const token = procedureVersionRowVersion(record());
    test.events.length = 0;

    expect(await save({ section: 'schedule', frequency: 'once', startTime: '00:00' }, token)).toMatchObject({ ok: true, changed: false });
    expect(test.events).toHaveLength(0);

    expect(await save({ section: 'schedule', frequency: 'weekly', startTime: '00:00' }, '0'.repeat(64))).toEqual({ ok: false, reason: PROCEDURE_REFUSALS.STALE_ROW });

    const before = record();
    test.failAppend = true;
    await expect(save({ section: 'schedule', frequency: 'weekly', startTime: '00:00' }, token)).rejects.toThrow('audit append failed');
    expect(record()).toEqual(before);
  });

  it('refuses a PoC Administrator before reading the edit', async () => {
    const test = harness('poc-administrator');
    const input = { session: POC_ADMIN, correlationId: 'denied', get edit(): never { throw new Error('must not parse'); } };
    await expect(updateEvidenceDraft(test.dependencies, input as never)).resolves.toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });
  });

  it('seeds P-1 evidence suggestions without claiming platform capture before target selection', async () => {
    const test = harness();
    for (const record of [webReg, apiReg]) test.registrations.set(record.registrationId, record);
    const created = await create(test, { templateId: 'P-1' });
    if (!created.ok) throw new Error(created.reason);
    const record = test.storedVersions.get(created.versionId)!;
    expect(record.evidenceRequirements.map((r) => r.attributeName).sort()).toEqual(['account_status', 'roles', 'username']);
    expect(record.targets).toEqual([]);
    expect(record.evidenceRequirements.every((r) => !r.platformCaptured)).toBe(true);
    expect(record.schedule).toEqual({ frequency: 'weekly', startTime: '00:00', periodDerivationRule: 'previous-monday-sunday' });
  });
});
