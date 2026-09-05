import { describe, it, expect } from 'vitest';
import { deriveExecutablePlan, diffReviewedDefinitions, rejectionRationale, DENIAL_REASONS, type AuditEventDraft } from '@intellifin/domain';
import { initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, submissionUnavailableReason, reviewedDefinition, renameProcedureDraft, type ProcedureVersionRecord, type ProcedureDependencies, type InAppNotification } from '@intellifin/application';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

function harness() {
  const plan = deriveExecutablePlan(executablePlanInputs()); if (!plan.ok) throw new Error(plan.reason);
  let row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(), procedureId: 'p1', versionId: 'v1', versionNumber: 1, state: 'DRAFT', planStatus: 'succeeded', compiledPlan: plan.plan, planDerivable: true, authorship: { createdBy: { type: 'human', id: 'author' }, responsibleAuthorId: 'author', humanAuthorIds: ['author'] } };
  row = { ...row, planInputDigest: planAuthoringDigest(row) };
  const events: AuditEventDraft[] = [], notifications: InAppNotification[] = [];
  let fail = false;
  const dependencies: ProcedureDependencies = { ids: { next: () => 'event' }, roles: { findRole: async id => id === 'admin' ? 'poc-administrator' : id === 'author' ? 'auditor' : 'audit-manager' }, unitOfWork: {
    async execute(work) {
      let pending = row; const audit: AuditEventDraft[] = [], sends: InAppNotification[] = [];
      const result = await work({ authorizationRoles: dependencies.roles, procedures: { insertProcedure: async () => {}, insertVersion: async () => {}, findVersion: async () => pending, findVersionForUpdate: async () => pending, updateVersion: async v => { pending = v; }, maxVersionNumber: async () => 1, findPreviousVersion: async () => null, findLatestActiveVersion: async () => null },
        derivationJobs: { enqueue: async () => {} }, populationSources: { findBindingForShare: async () => null }, targetRegistrations: { lockForSelection: async () => [] },
        notificationRecipients: { auditManagerIds: async () => ['manager','manager2'] }, notifications: { enqueue: async n => { if (fail) throw new Error('forced rollback'); sends.push(n); } },
        auditEvents: { append: async event => { audit.push(event); return { ...event, aggregateId: event.aggregateId ?? 'platform', eventId: 'event', occurredAt: new Date().toISOString(), sequence: 1, previousHash: '0'.repeat(64), eventHash: '1'.repeat(64) }; } } });
      row = pending; events.push(...audit); notifications.push(...sends); return result;
    },
  } };
  const act = (decision: 'submit'|'approve'|'reject'|'edit', actor = 'author', rationale?: string, token = procedureVersionRowVersion(row)) => transitionVersion(dependencies, { session: { userId: actor, sessionId: actor }, procedureId: row.procedureId, versionId: row.versionId, expectedRowVersion: token, correlationId: 'corr', rationale }, decision);
  return { act, dependencies, events, notifications, get row() { return row; }, set row(value) { row = value; }, set fail(value: boolean) { fail = value; } };
}
describe('Procedure Version decisions', () => {
  it('submits saved derivability, records every transition field, and notifies every manager', async () => {
    const h = harness(), revision = procedureVersionRowVersion(h.row);
    expect(await h.act('submit')).toMatchObject({ ok: true, state: 'SUBMITTED' });
    expect(h.row.decisions?.[0]).toMatchObject({ actorId: 'author', priorState: 'DRAFT', decision: 'submit', rationale: null, aggregateRevision: revision, occurredAt: expect.any(String) });
    expect(h.notifications.map(n => n.recipientId)).toEqual(['manager','manager2']);
    expect(h.events).toHaveLength(1);
  });
  it('refuses missing sections, blockers, pending, failed and stale plans without writes', async () => {
    for (const change of [{ sourceSnapshot: null }, { scope: '' }, { period: null }, { schedule: null }, { targets: [] }, { instructions: [] }, { planStatus: 'pending' }, { planStatus: 'failed', planFailureReason: 'Provider unavailable', planDerivable: false }, { planInputDigest: '0'.repeat(64) }] as Partial<ProcedureVersionRecord>[]) {
      const h = harness(); h.row = { ...h.row, ...change }; const before = h.row;
      expect(submissionUnavailableReason(h.row)).not.toBeNull();
      expect(await h.act('submit')).toMatchObject({ ok: false }); expect(h.row).toEqual(before); expect(h.events).toEqual([]); expect(h.notifications).toEqual([]);
    }
  });
  it('freezes the reviewed plan and first-version diff and activates the first version', async () => {
    const h = harness(); await h.act('submit'); const reviewed = h.row.compiledPlan;
    expect(await h.act('approve', 'manager')).toMatchObject({ ok: true, state: 'ACTIVE' });
    expect(h.row.frozenReview?.definition.compiledPlan).toEqual(reviewed);
    expect(h.row.frozenReview?.baseline).toBeNull();
    expect(h.row.frozenReview?.diff.length).toBeGreaterThan(9);
    expect(h.row.frozenReview?.diff.every(s => s.changed)).toBe(true);
    expect(h.notifications.at(-1)).toMatchObject({ recipientId: 'author', kind: 'approved' });
  });
  it('loses the expected revision on the second decision', async () => {
    const h = harness(); await h.act('submit'); const token = procedureVersionRowVersion(h.row);
    expect(await h.act('approve', 'manager', undefined, token)).toMatchObject({ ok: true });
    expect(await h.act('reject', 'manager2', 'Please revise', token)).toMatchObject({ ok: false, reason: expect.stringContaining('changed since') });
    expect(h.row.decisions).toHaveLength(2);
  });
  it('requires storable rationale, notifies the responsible author and permits Edit', async () => {
    const h = harness(); await h.act('submit');
    for (const rationale of ['', ' ', '\u0000', '\ud800', 'x'.repeat(4001)]) expect(await h.act('reject', 'manager', rationale)).toMatchObject({ ok: false });
    expect(await h.act('reject', 'manager', 'Clarify the scope.')).toMatchObject({ ok: true, state: 'REJECTED' });
    expect(h.row.decisions?.at(-1)?.rationale).toBe('Clarify the scope.'); expect(h.notifications.at(-1)?.recipientId).toBe('author');
    expect(await h.act('edit')).toMatchObject({ ok: true, state: 'DRAFT' });
  });
  it('denies a manager who authored changes and audits the requested approval action', async () => {
    const h = harness();
    await renameProcedureDraft(h.dependencies, { session: { userId: 'manager', sessionId: 'm' }, procedureId: 'p1', versionId: 'v1', controlName: 'Edited by manager', expectedRowVersion: procedureVersionRowVersion(h.row), correlationId: 'corr' });
    expect(h.row.authorship?.humanAuthorIds).toEqual(['author','manager']);
    h.row = { ...h.row, state: 'SUBMITTED' };
    expect(await h.act('approve', 'manager')).toEqual({ ok: false, reason: DENIAL_REASONS.AUTHOR_CANNOT_APPROVE });
    expect(h.events.at(-1)?.payload).toMatchObject({ action: 'procedure.version.approve' });
  });
  it('fails closed for missing provenance and refuses Administrator commands', async () => {
    const h = harness(); expect(await h.act('submit','admin')).toMatchObject({ ok: false });
    h.row = { ...h.row, authorship: null }; expect(await h.act('submit')).toMatchObject({ ok: false });
    h.row = { ...h.row, state: 'SUBMITTED' }; expect(await h.act('approve','manager')).toEqual({ ok: false, reason: DENIAL_REASONS.AUTHOR_CANNOT_APPROVE });
  });
  it('audits the locked denial even when the role is restored immediately afterwards', async () => {
    const h = harness(); await h.act('submit'); let reads = 0;
    const roles = { findRole: async () => { reads++; return reads === 2 ? null : 'audit-manager' as const; } };
    const outcome = await transitionVersion({ ...h.dependencies, roles, unitOfWork: { execute: work => h.dependencies.unitOfWork.execute(ctx => work({ ...ctx, authorizationRoles: roles })) } }, { session: { userId:'manager',sessionId:'m' },correlationId:'denial-race',procedureId:'p1',versionId:'v1',expectedRowVersion:procedureVersionRowVersion(h.row) },'approve');
    expect(outcome).toMatchObject({ok:false}); expect(reads).toBe(2);
    expect(h.events.at(-1)).toMatchObject({eventType:'security.denied',payload:{action:'procedure.version.approve',role:null}});
  });
  it.each(['submit','approve','reject'] as const)('rolls state, event and notification back when %s delivery enqueue fails', async decision => {
    const h = harness(); if (decision !== 'submit') await h.act('submit');
    const before = h.row, events = h.events.length, sends = h.notifications.length; h.fail = true;
    await expect(h.act(decision, decision === 'submit' ? 'author' : 'manager', 'Rationale')).rejects.toThrow('forced rollback');
    expect(h.row).toEqual(before); expect(h.events).toHaveLength(events); expect(h.notifications).toHaveLength(sends);
  });
  it('compares sections structurally and changes only the altered sections', () => {
    const h = harness(); const definition = reviewedDefinition(h.row)!;
    expect(diffReviewedDefinitions(definition, definition).every(s => !s.changed)).toBe(true);
    const changed = { ...definition, modelConfiguration: { provider: 'example', modelId: 'new-model', promptVersion: '1' } };
    expect(diffReviewedDefinitions(definition, changed).filter(s => s.changed).map(s => s.section)).toEqual(['Model and tool configuration']);
    expect(rejectionRationale(' valid ')).toEqual({ ok: true, value: 'valid' });
  });
});
