import { describe, expect, it } from 'vitest';
import { derivePlan, reconcilePlanDerivation, ModelGatewayError, retryPlanDerivation, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, type ProcedureVersionRecord, type ProceduresUnitOfWorkContext, type ModelGateway, type AuditUnitOfWork, type PlanDerivationJob } from '@intellifin/application';
import { deriveExecutablePlan, type AuditEventDraft } from '@intellifin/domain';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

function harness(model: ModelGateway | null = null) {
  let row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(model?.identity ?? null), versionId: '018f0000-0000-7000-8000-000000000001', procedureId: '018f0000-0000-7000-8000-000000000002', versionNumber: 1, state: 'DRAFT' };
  const events: AuditEventDraft[] = [];
  let failAudit = false;
  let counter = 10;
  const unitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext> = { execute: async (work) => {
    let pending = row;
    const additions: AuditEventDraft[] = [];
    const result = await work({
      derivationJobs: { enqueue: async () => {} }, populationSources: { findBindingForShare: async () => null }, targetRegistrations: { lockForSelection: async () => [] },
      procedures: { findVersion: async () => pending, findVersionForUpdate: async () => pending, updateVersion: async (next) => { pending = next; }, insertVersion: async () => {}, insertProcedure: async () => {}, maxVersionNumber: async () => 1 },
      auditEvents: { append: async (event) => { if (failAudit) throw new Error('audit failed'); additions.push(event); return { ...event, aggregateId: event.aggregateId!, eventId: 'id', sequence: 1, occurredAt: '2026-09-04T01:00:00.000Z', previousHash: '0'.repeat(64), eventHash: '1'.repeat(64) }; } },
    });
    row = pending; events.push(...additions); return result;
  } };
  const dependencies = { unitOfWork, repository: { findVersion: async () => ({ ...row, createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z', targetBlockers: [], evidenceBlockers: [] }) }, clock: { now: () => new Date('2026-09-04T01:00:00.000Z') }, ids: { next: () => `018f0000-0000-7000-8000-${String(counter++).padStart(12, '0')}` }, model };
  return { dependencies, events, get row() { return row; }, set row(next) { row = next; }, failAudit: (value = true) => { failAudit = value; }, job: (): PlanDerivationJob => ({ schemaVersion: 1, versionId: row.versionId, inputDigest: planAuthoringDigest(row) }) };
}
function successGateway(provider: string): ModelGateway {
  return { identity: { provider, modelId: 'configured-test-model', promptVersion: '1' }, derive: async (inputs) => { const result = deriveExecutablePlan(inputs); if (!result.ok) throw new Error(result.reason); const candidate = structuredClone(result.plan); candidate.sessionSteps[0]!.text = 'Model chose an equivalent label'; return candidate; } };
}

describe('worker plan derivation command', () => {
  it('records every repeat while keeping canonical bytes and authoring digest identical', async () => {
    const test = harness(); const digest = planAuthoringDigest(test.row); const token = procedureVersionRowVersion(test.row);
    expect(await derivePlan(test.dependencies, test.job())).toEqual({ ok: true, outcome: 'success' });
    const bytes = JSON.stringify(test.row.compiledPlan);
    expect(await derivePlan(test.dependencies, test.job())).toEqual({ ok: true, outcome: 'success' });
    expect(JSON.stringify(test.row.compiledPlan)).toBe(bytes);
    expect(test.row.planAttempts).toHaveLength(2); expect(test.events).toHaveLength(4);
    expect(test.row.planAttempts.every((attempt) => attempt.model === null)).toBe(true);
    expect(test.row.planDerivable).toBe(true); expect(planAuthoringDigest(test.row)).toBe(digest);
    expect(procedureVersionRowVersion(test.row)).not.toBe(token);
  });
  it.each(['provider-a', 'provider-b'])('calls the configured %s through the unchanged port and canonicalizes equivalent labels', async (provider) => {
    const test = harness(successGateway(provider));
    await derivePlan(test.dependencies, test.job());
    expect(test.row.planAttempts[0]?.model).toEqual(test.dependencies.model?.identity);
    expect(test.row.compiledPlan?.sessionSteps[0]?.text).not.toContain('Model chose');
    expect(test.row.derivationModel?.provider).toBe(provider);
  });
  it.each(['malformed', 'tampered', 'throws'])('records %s model failure without raw content or a partial plan', async (mode) => {
    const gateway = successGateway('test');
    const test = harness({ ...gateway, derive: async (inputs, version) => {
      if (mode === 'throws') throw new Error('sensitive-provider-payload');
      if (mode === 'malformed') return { raw: 'sensitive-provider-payload' };
      const candidate = await gateway.derive(inputs, version) as any; candidate.inputs.scope = 'changed'; return candidate;
    } });
    expect(await derivePlan(test.dependencies, test.job())).toEqual({ ok: true, outcome: 'failure' });
    expect(test.row.planAttempts).toHaveLength(1); expect(test.row.compiledPlan).toBeNull(); expect(test.row.planDerivable).toBe(false);
    expect(JSON.stringify(test.row)).not.toContain('sensitive-provider-payload'); expect(test.row.planFailureReason).toBeTruthy();
  });
  it('records an underivable attempt and atomically rolls back an audit failure', async () => {
    const test = harness(); test.row = { ...test.row, sourceSnapshot: null };
    await derivePlan(test.dependencies, test.job());
    expect(test.row.planFailureReason).toContain('Population Source'); expect(test.row.planAttempts[0]?.outcome).toBe('failure');
    const before = structuredClone(test.row); test.failAudit();
    await expect(derivePlan(test.dependencies, test.job())).rejects.toThrow('audit failed'); expect(test.row).toEqual(before);
  });
  it('records a stale in-flight result without replacing newer saved data', async () => {
    let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const gateway = successGateway('test'); const test = harness({ ...gateway, derive: async (inputs, version) => { entered(); await gate; return gateway.derive(inputs, version); } });
    const attempt = derivePlan(test.dependencies, test.job()); await ready;
    test.row = { ...test.row, controlName: 'New saved name', planStatus: 'pending' };
    release(); expect(await attempt).toEqual({ ok: true, outcome: 'stale' });
    expect(test.row.controlName).toBe('New saved name'); expect(test.row.planStatus).toBe('pending'); expect(test.row.compiledPlan).toBeNull();
    expect(test.row.planAttempts[0]?.reason).toContain('changed');
  });
  it('refuses a non-Draft and unavailable frozen model configuration', async () => {
    const test = harness(); test.row = { ...test.row, state: 'ACTIVE' };
    expect(await derivePlan(test.dependencies, test.job())).toMatchObject({ ok: false }); expect(test.events).toHaveLength(0);
    test.row = { ...test.row, state: 'DRAFT', derivationModel: { provider: 'unavailable', modelId: 'm', promptVersion: '1' } };
    await derivePlan(test.dependencies, test.job()); expect(test.row.planFailureReason).toContain('unavailable');
  });
});
it('persists start before model work and retains unfinished attempt after final audit failure', async () => {
  const gateway = successGateway('test');
  const test = harness({ ...gateway, derive: async (input, compiler) => {
    expect(test.row.planAttempts[0]?.outcome).toBe('started');
    test.failAudit();
    return gateway.derive(input, compiler);
  } });
  await expect(derivePlan(test.dependencies, test.job())).rejects.toThrow('audit failed');
  expect(test.row.planAttempts).toHaveLength(1);
  expect(test.row.planAttempts[0]?.outcome).toBe('started');
  expect(test.row.compiledPlan).toBeNull();
  test.failAudit(false);
  await reconcilePlanDerivation(test.dependencies, test.job());
  expect(test.row.planAttempts[0]?.outcome).toBe('failure');
  expect(test.row.planStatus).toBe('failed');
});

it('does not call the model when the audited start cannot commit', async () => {
  let calls = 0;
  const test = harness({ ...successGateway('test'), derive: async () => { calls++; return null; } });
  test.failAudit();
  await expect(derivePlan(test.dependencies, test.job())).rejects.toThrow();
  expect(calls).toBe(0); expect(test.row.planAttempts).toHaveLength(0);
});

it('retains successful bytes when a held-open same-digest duplicate later fails', async () => {
  let entered!: () => void; let release!: () => void; let calls = 0;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const gateway = successGateway('test');
  const test = harness({ ...gateway, derive: async (input, compiler) => {
    if (++calls === 1) { entered(); await gate; throw new Error('private'); }
    return gateway.derive(input, compiler);
  } });
  const duplicate = derivePlan(test.dependencies, test.job()); await ready;
  await derivePlan(test.dependencies, test.job());
  const bytes = JSON.stringify(test.row.compiledPlan);
  release(); await duplicate;
  expect(test.row.planStatus).toBe('succeeded'); expect(test.row.planDerivable).toBe(true);
  expect(JSON.stringify(test.row.compiledPlan)).toBe(bytes);
  expect(test.row.planAttempts.map((a) => a.outcome)).toEqual(['failure', 'success']);
});

it('requests bounded queue retries only for classified transport failures', async () => {
  const test = harness({ ...successGateway('test'), derive: async () => { throw new ModelGatewayError('The model service is temporarily unavailable.', true); } });
  expect(await derivePlan(test.dependencies, test.job(), { retriesRemaining: 1 })).toMatchObject({ retry: true });
  expect(test.row.planStatus).toBe('pending');
  expect(await derivePlan(test.dependencies, test.job(), { retriesRemaining: 0 })).not.toHaveProperty('retry');
  expect(test.row.planStatus).toBe('failed');
  expect(test.row.planAttempts.map((a) => a.outcome)).toEqual(['failure', 'failure']);
});

it('authorizes and guards an explicit retry without changing frozen identity or inputs', async () => {
  const test = harness();
  test.row = { ...test.row, sourceSnapshot: null };
  await derivePlan(test.dependencies, test.job());
  const before = structuredClone(test.row);
  const dependencies = { ...test.dependencies, roles: { findRole: async () => 'auditor' as const } };
  const input = { procedureId: before.procedureId, versionId: before.versionId, expectedRowVersion: procedureVersionRowVersion(before), session: { userId: 'auditor', sessionId: 'session' }, correlationId: 'retry' };
  expect(await retryPlanDerivation(dependencies, { ...input, expectedRowVersion: 'old' })).toMatchObject({ ok: false });
  expect(await retryPlanDerivation(dependencies, input)).toMatchObject({ ok: true });
  expect(test.row.planStatus).toBe('pending');
  expect(planAuthoringDigest(test.row)).toBe(planAuthoringDigest(before));
  expect(test.row.planAttempts).toEqual(before.planAttempts);
  expect(await retryPlanDerivation(dependencies, { ...input, expectedRowVersion: procedureVersionRowVersion(test.row) })).toMatchObject({ ok: false });
});

it('marks only the first completed successful publisher when starts finish out of order', async () => {
  let entered!: () => void; let release!: () => void; let calls = 0;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const gateway = successGateway('test');
  const test = harness({ ...gateway, derive: async (input, compiler) => {
    if (++calls === 1) { entered(); await gate; }
    return gateway.derive(input, compiler);
  } });
  const slow = derivePlan(test.dependencies, test.job()); await ready;
  await derivePlan(test.dependencies, test.job()); release(); await slow;
  expect(test.row.planAttempts.map((attempt) => attempt.published)).toEqual([false, true]);
});

it('moves the current publisher marker when inputs return to an earlier digest, even at the same clock time', async () => {
  const test = harness(); const original = test.row.scope;
  await derivePlan(test.dependencies, test.job());
  test.row = { ...test.row, scope: 'B', planStatus: 'pending', compiledPlan: null, planDerivable: false };
  await derivePlan(test.dependencies, test.job());
  test.row = { ...test.row, scope: original, planStatus: 'pending', compiledPlan: null, planDerivable: false };
  await derivePlan(test.dependencies, test.job());
  expect(test.row.planAttempts.map((attempt) => attempt.published)).toEqual([false, false, true]);
  expect(test.row.planAttempts.map((attempt) => attempt.outcome)).toEqual(['success', 'success', 'success']);
});
