import { describe, expect, it, vi } from 'vitest';
import { DENIAL_REASONS, deriveExecutablePlan, draftContext, refreshPreparation, sectionReview, validateAuditEventDraft, type AuditEventDraft, type Role } from '@intellifin/domain';
import { AUTHORING_IDENTITY, AUTHORING_LIMITS, acceptAuthoringSuggestion, authoringContext, authoringCurrentText, generateAuthoringSuggestion, initialPlanDerivation, isAuthoringDraftFields, isAuthoringProposal, planAuthoringDigest, procedureVersionRowVersion, rejectAuthoringSuggestion, reviewSection, transitionVersion, updateContextDraft, updatePopulationDraft, type AuthoringDependencies, type AuthoringDraftFields, type AuthoringRequestRecord, type AuthoringSection, type ProcedureAuthoringModel, type ProcedureVersionRecord } from '@intellifin/application';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

const procedureId = '018f0000-0000-7000-8000-000000000001';
const versionId = '018f0000-0000-7000-8000-000000000002';
const actor = { session: { userId: 'editor', sessionId: 'editor-session' }, correlationId: 'synthetic-authoring' };
const requestId = (n = 1) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const response = (
  proposedText: string | null = 'Review all production parameters against the approved baseline.',
  extra: { readonly clarifications?: readonly string[]; readonly explanation?: string } = {},
) => ({ proposal: { proposedText, clarifications: [], ...extra }, usage: { inputTokens: 100, outputTokens: 30 } });
function harness(propose: ProcedureAuthoringModel['propose'] = async () => response()) {
  const inputs = executablePlanInputs(), compiled = deriveExecutablePlan(inputs);
  if (!compiled.ok) throw new Error(compiled.reason);
  let row: ProcedureVersionRecord = { ...inputs, ...initialPlanDerivation(), procedureId, versionId, versionNumber: 1, state: 'DRAFT', planStatus: 'succeeded', compiledPlan: compiled.plan, planDerivable: true,
    authorship: { createdBy: { type: 'human', id: 'creator' }, responsibleAuthorId: 'creator', humanAuthorIds: ['creator'] } };
  row = { ...row, sectionPreparation: refreshPreparation(row), planInputDigest: planAuthoringDigest(row) };
  let now = new Date('2026-09-11T12:00:00.000Z'), failAudit = false, versionWrites = 0, jobs = 0;
  let records = new Map<string, AuthoringRequestRecord>();
  const events: AuditEventDraft[] = [], roles = new Map<string, Role>([['editor', 'auditor'], ['creator', 'auditor'], ['manager', 'audit-manager'], ['admin', 'poc-administrator']]);
  const model = { identity: AUTHORING_IDENTITY, propose: vi.fn(propose) };
  let tail: Promise<unknown> = Promise.resolve();
  const deps: AuthoringDependencies = { model, clock: { now: () => now }, ids: { next: () => requestId(999) }, roles: { findRole: async id => roles.get(id) ?? null }, unitOfWork: {
    execute(work) {
      const execution = tail.then(async () => {
        let pending = row, writes = 0, enqueues = 0;
        const requests = new Map(records), audit: AuditEventDraft[] = [];
        const result = await work({ authorizationRoles: deps.roles,
          procedures: { insertProcedure: async () => {}, insertVersion: async () => {}, findVersion: async id => id === versionId ? pending : null, findVersionForUpdate: async id => id === versionId ? pending : null, updateVersion: async v => { pending = v; writes++; }, maxVersionNumber: async () => 1, findPreviousVersion: async () => null, findLatestActiveVersion: async () => null },
          derivationJobs: { enqueue: async () => { enqueues++; } }, populationSources: { findBindingForShare: async () => null }, targetRegistrations: { lockForSelection: async () => [] },
          notificationRecipients: { auditManagerIds: async () => ['manager'] }, notifications: { enqueue: async () => {} },
          authoringRequests: { find: async id => requests.get(id) ?? null, countSince: async (id, since) => [...requests.values()].filter(r => r.actorId === id && r.createdAt >= since).length, insert: async r => { if (requests.has(r.requestId)) throw new Error('Duplicate request'); requests.set(r.requestId, r); }, update: async r => { requests.set(r.requestId, r); } },
          auditEvents: { append: async event => { validateAuditEventDraft(event); if (failAudit) throw new Error('Synthetic rollback'); audit.push(event); return { ...event, aggregateId: event.aggregateId ?? 'platform', eventId: requestId(999), occurredAt: now.toISOString(), sequence: 1, previousHash: '0'.repeat(64), eventHash: '1'.repeat(64) }; } },
        });
        row = pending; records = requests; events.push(...audit); versionWrites += writes; jobs += enqueues; return result;
      });
      tail = execution.catch(() => {}); return execution;
    },
  } };
  const fields = (extra: Partial<AuthoringDraftFields> = {}): AuthoringDraftFields => ({ procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(row), requestId: requestId(), section: { kind: 'objective' }, mode: 'draft', notes: 'Rough synthetic notes', changes: '', ...extra });
  const generate = (extra: Partial<AuthoringDraftFields> = {}) => generateAuthoringSuggestion(deps, { ...fields(extra), ...actor });
  const accept = (replacement = response().proposal.proposedText!, id = requestId(), token = procedureVersionRowVersion(row)) => acceptAuthoringSuggestion(deps, { ...actor, procedureId, versionId, requestId: id, expectedRowVersion: token, replacement });
  const edit = (objective: string) => updateContextDraft(deps, { ...actor, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(row), edit: { ...draftContext(row.sections), objective } });
  return { deps, model, roles, events, fields, generate, accept, edit, get row() { return row; }, set row(value) { row = value; }, get requests() { return records; }, get writes() { return versionWrites; }, get jobs() { return jobs; }, set failAudit(value: boolean) { failAudit = value; }, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}
function pendingModel() {
  let complete!: (r: ReturnType<typeof response>) => void;
  let started!: () => void;
  const entered = new Promise<void>(done => { started = done; });
  const promise = new Promise<ReturnType<typeof response>>(done => { complete = done; });
  return { entered, complete: () => complete(response()), propose: async () => { started(); return promise; } };
}

describe('bounded procedure writing commands (synthetic provider)', () => {
  it('reserves before streaming, leaves the draft untouched, and replays only the completed receipt', async () => {
    const progress = { explanation: 'Inspect every record.', proposedText: 'Do not sample', clarification: null };
    const seen = vi.fn();
    const h = harness(async (_input, emit) => {
      expect(h.requests.get(requestId())?.state).toBe('pending');
      await emit?.(progress);
      expect(await h.accept()).toMatchObject({ ok: false });
      return response();
    });
    const before = structuredClone(h.row), fields = h.fields();
    expect(await generateAuthoringSuggestion(h.deps, { ...fields, ...actor }, seen)).toMatchObject({ ok: true, suggestion: { state: 'ready' } });
    expect(seen).toHaveBeenCalledExactlyOnceWith(progress);
    expect(h.row).toEqual(before); expect(h.writes).toBe(0);
    seen.mockClear();
    await generateAuthoringSuggestion(h.deps, { ...fields, ...actor }, seen);
    expect(seen).not.toHaveBeenCalled(); expect(h.model.propose).toHaveBeenCalledTimes(1);
  });
  it.each(['invalid', 'revoked'] as const)('does not disclose %s progress or leave an acceptable suggestion', async kind => {
    const seen = vi.fn();
    const h = harness(async (_input, emit) => {
      if (kind === 'revoked') h.roles.delete('editor');
      await emit?.({ explanation: kind === 'invalid' ? 'x'.repeat(2001) : 'Private response', proposedText: null, clarification: null });
      return response();
    });
    await generateAuthoringSuggestion(h.deps, { ...h.fields(), ...actor }, seen);
    expect(seen).not.toHaveBeenCalled();
    expect(h.requests.get(requestId())?.state).toBe('failed');
    expect(await h.accept()).toMatchObject({ ok: false });
  });
  it('generates a proposal without changing content, plan, authorship or review', async () => {
    const h = harness(), before = structuredClone(h.row);
    expect(await h.generate()).toMatchObject({ ok: true, suggestion: { state: 'ready', stale: false, currentText: draftContext(before.sections).objective } });
    expect(h.row).toEqual(before); expect(h.writes).toBe(0); expect(h.jobs).toBe(0);
    expect(sectionReview(h.row, 'context')).toBeNull();
    expect(h.requests.get(requestId())).toMatchObject({ identity: AUTHORING_IDENTITY, usage: { inputTokens: 100, outputTokens: 30 } });
    expect(JSON.stringify(h.events)).not.toContain('Rough synthetic notes');
    expect(JSON.stringify(h.events)).not.toContain(response().proposal.proposedText);
  });
  it.each(['objective', 'scope', 'instructions'] as const)('accepts edited %s wording through the same human draft writer', async kind => {
    const h = harness(), section: AuthoringSection = kind === 'instructions' ? { kind, registrationId: h.row.targets[0]!.registrationId } : { kind };
    const before = structuredClone(h.row), replacement = 'Human edited wording: review every specified item and retain evidence.';
    await h.generate({ section });
    expect(await h.accept(replacement)).toMatchObject({ ok: true, alreadyApplied: false });
    expect(authoringCurrentText(h.row, section)).toBe(replacement);
    expect(h.row.authorship?.humanAuthorIds).toEqual(['creator', 'editor']);
    expect(h.row).toMatchObject({ planStatus: 'pending', compiledPlan: null, planDerivable: false });
    expect(h.jobs).toBe(1); expect(h.row.sectionPreparation!.revision).toBe(before.sectionPreparation!.revision + 1);
    for (const field of ['period', 'sourceSnapshot', 'targets', 'complianceConditions', 'evidenceRequirements', 'schedule'] as const) expect(h.row[field]).toEqual(before[field]);
  });
  it('attributes an identical-wording acceptance, including when the editor later becomes a manager', async () => {
    const h = harness(), original = draftContext(h.row.sections).objective;
    await h.generate(); expect(await h.accept(original)).toMatchObject({ ok: true });
    expect(h.jobs).toBe(0); expect(h.row.authorship?.humanAuthorIds).toEqual(['creator', 'editor']);
    h.roles.set('editor', 'audit-manager'); h.row = { ...h.row, state: 'SUBMITTED' };
    expect(await transitionVersion(h.deps, { ...actor, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row) }, 'approve')).toEqual({ ok: false, reason: DENIAL_REASONS.AUTHOR_CANNOT_APPROVE });
  });
  it('rejects without modifying the draft and allows manual writing after provider failure', async () => {
    const h = harness(), before = structuredClone(h.row); await h.generate();
    expect(await rejectAuthoringSuggestion(h.deps, { ...actor, procedureId, versionId, requestId: requestId() })).toEqual({ ok: true });
    expect(h.row).toEqual(before); expect(await h.accept()).toMatchObject({ ok: false });
    h.model.propose.mockRejectedValueOnce(new Error('sensitive provider body'));
    expect(await h.generate({ requestId: requestId(2) })).toMatchObject({ ok: true, suggestion: { state: 'failed', proposedText: null } });
    expect(h.row).toEqual(before); expect(JSON.stringify(h.requests.get(requestId(2)))).not.toContain('sensitive');
    expect(await h.edit('Manual objective remains available.')).toMatchObject({ ok: true });
  });
  it('replays the exact pending request without a second provider call', async () => {
    const model = pendingModel(), h = harness(model.propose), fields = h.fields();
    const first = h.generate(fields); await model.entered;
    expect(await h.generate(fields)).toMatchObject({ ok: true, suggestion: { state: 'pending' } });
    expect(await h.generate({ ...fields, notes: 'Different notes' })).toMatchObject({ ok: false });
    model.complete(); await first;
    expect(await h.generate(fields)).toMatchObject({ ok: true, suggestion: { state: 'ready' } });
    expect(h.model.propose).toHaveBeenCalledTimes(1);
  });
  it('returns an honest stale response after an edit and cannot overwrite it', async () => {
    const model = pendingModel(), h = harness(model.propose), first = h.generate(); await model.entered;
    await h.edit('Newer saved objective from an authorised editor.'); const saved = structuredClone(h.row);
    model.complete(); expect(await first).toMatchObject({ ok: true, suggestion: { stale: true } });
    expect(await h.accept()).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
    expect(h.row).toEqual(saved);
  });
  it('does not revive an old suggestion when edited content is reverted', async () => {
    const h = harness(), original = draftContext(h.row.sections).objective;
    await h.generate(); await h.edit('Temporary objective'); await h.edit(original);
    expect(await h.accept()).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
  });
  it('conservatively invalidates a suggestion when other accepted scope changes', async () => {
    const h = harness(); await h.generate();
    await updatePopulationDraft(h.deps, { ...actor, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row), edit: { section: 'scope-note', scope: 'A different accepted population.' } });
    expect(await h.accept()).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
  });
  it('does not stale prose for a plan-worker refresh or a review acknowledgement alone', async () => {
    const h = harness(); await h.generate();
    h.row = { ...h.row, planFailureReason: 'Synthetic worker-only status' };
    expect(await reviewSection(h.deps, { ...actor, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row), section: 'context', decision: 'review' })).toMatchObject({ ok: true });
    expect(sectionReview(h.row, 'context')).not.toBeNull();
    expect(await h.accept()).toMatchObject({ ok: true });
    expect(sectionReview(h.row, 'context')).toBeNull();
  });
  it('serializes duplicate acceptance and refuses contradictory wording on replay', async () => {
    const h = harness(); await h.generate(); const token = procedureVersionRowVersion(h.row);
    const results = await Promise.all([h.accept(undefined, undefined, token), h.accept(undefined, undefined, token)]);
    expect(results).toEqual([expect.objectContaining({ ok: true, alreadyApplied: false }), expect.objectContaining({ ok: true, alreadyApplied: true })]);
    expect(h.writes).toBe(1); expect(h.jobs).toBe(1);
    expect(await h.accept('Contradictory duplicate')).toMatchObject({ ok: false });
  });
  it.each(['SUBMITTED', 'APPROVED', 'ACTIVE'] as const)('refuses acceptance after the version becomes %s while generation is pending', async state => {
    const model = pendingModel(), h = harness(model.propose), first = h.generate(); await model.entered;
    h.row = { ...h.row, state }; const saved = structuredClone(h.row);
    model.complete(); expect(await first).toMatchObject({ ok: true, suggestion: { stale: true } });
    expect(await h.accept()).toMatchObject({ ok: false }); expect(h.row).toEqual(saved);
  });
  it('lets rejection win over a late provider response', async () => {
    const model = pendingModel(), h = harness(model.propose), first = h.generate(); await model.entered;
    const before = structuredClone(h.row);
    await rejectAuthoringSuggestion(h.deps, { ...actor, procedureId, versionId, requestId: requestId() });
    model.complete(); expect(await first).toMatchObject({ ok: true, suggestion: { state: 'rejected', proposedText: null } });
    expect(await h.accept()).toMatchObject({ ok: false }); expect(h.writes).toBe(0);
    expect(h.row).toEqual(before); expect(h.jobs).toBe(0);
    expect(h.requests.get(requestId())).toMatchObject({ state: 'rejected', proposedText: null, usage: { inputTokens: 100, outputTokens: 30 } });
    expect(h.events.at(-1)?.payload).toMatchObject({ decision: 'responded-after-rejection', usage: { inputTokens: 100, outputTokens: 30 } });
    expect(JSON.stringify(h.events)).not.toContain(response().proposal.proposedText);
  });
  it('requires reconciliation after submission, manager rejection and return to the same Draft content', async () => {
    const h = harness(); await h.generate();
    const decide = (decision: 'submit'|'reject'|'edit', userId: string) => transitionVersion(h.deps, { ...actor, session: { userId, sessionId: userId }, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row), rationale: 'Please clarify this objective.' }, decision);
    expect(await decide('submit', 'creator')).toMatchObject({ ok: true });
    expect(await decide('reject', 'manager')).toMatchObject({ ok: true });
    expect(await decide('edit', 'creator')).toMatchObject({ ok: true, state: 'DRAFT' });
    expect(await h.accept()).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
  });
  it('rolls back the content, author, plan job and acceptance record if audit persistence fails', async () => {
    const h = harness(); await h.generate(); const saved = structuredClone(h.row); h.failAudit = true;
    await expect(h.accept()).rejects.toThrow('Synthetic rollback');
    expect(h.row).toEqual(saved); expect(h.jobs).toBe(0); expect(h.requests.get(requestId())?.state).toBe('ready');
  });
  it('refuses unknown authorship, another actor’s suggestion, wrong procedure and revoked access', async () => {
    const h = harness(); await h.generate();
    expect(await acceptAuthoringSuggestion(h.deps, { ...actor, session: { userId: 'manager', sessionId: 'manager' }, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row), requestId: requestId(), replacement: 'Different actor' })).toMatchObject({ ok: false });
    expect(await h.generate({ procedureId: requestId(99), requestId: requestId(2) })).toMatchObject({ ok: false });
    h.row = { ...h.row, authorship: null }; expect(await h.accept()).toMatchObject({ ok: false }); expect(await h.generate({ requestId: requestId(3) })).toMatchObject({ ok: false });
    h.roles.delete('editor'); expect(await h.accept()).toMatchObject({ ok: false }); expect(h.writes).toBe(0);
  });
  it('expires requests and reports a lost response honestly without reissuing it', async () => {
    const model = pendingModel(), h = harness(model.propose), fields = h.fields(), first = h.generate(fields); await model.entered;
    h.advance(AUTHORING_LIMITS.timeoutMs + 5001);
    expect(await h.generate(fields)).toMatchObject({ ok: true, suggestion: { state: 'failed', message: expect.stringContaining('No response was confirmed') } });
    model.complete(); await first; h.advance(AUTHORING_LIMITS.lifetimeMs);
    expect(await h.accept()).toMatchObject({ ok: false }); expect(h.model.propose).toHaveBeenCalledTimes(1);
  });
  it('bounds requests per user across procedures before calling the provider', async () => {
    const h = harness(); for (let i = 0; i < AUTHORING_LIMITS.perMinute; i++) expect(await h.generate({ requestId: requestId(i + 1) })).toMatchObject({ ok: true });
    expect(await h.generate({ requestId: requestId(20) })).toMatchObject({ ok: false, reason: expect.stringContaining('limit') });
    expect(h.model.propose).toHaveBeenCalledTimes(6);
  });
  it('keeps manual work usable without configuration and refuses oversized input/output', async () => {
    const h = harness(); expect(await generateAuthoringSuggestion({ ...h.deps, model: null }, { ...h.fields(), ...actor })).toMatchObject({ ok: false, reason: expect.stringContaining('not configured') });
    expect(await h.generate({ notes: 'x'.repeat(AUTHORING_LIMITS.notes + 1) })).toMatchObject({ ok: false });
    expect(h.model.propose).not.toHaveBeenCalled();
    h.model.propose.mockResolvedValueOnce(response('x'.repeat(4001)));
    expect(await h.generate()).toMatchObject({ ok: true, suggestion: { state: 'failed' } });
    expect(await h.edit('Manual writing')).toMatchObject({ ok: true });
  });
  it('presents undefined criteria as clarification with no applicable replacement', async () => {
    const h = harness(async () => ({ proposal: { proposedText: null, clarifications: ['Which approved policy criterion applies?'] }, usage: { inputTokens: null, outputTokens: null } }));
    expect(await h.generate()).toMatchObject({ ok: true, suggestion: { proposedText: null, clarifications: ['Which approved policy criterion applies?'] } });
    expect(await h.accept('Invented 24 hour requirement')).toMatchObject({ ok: false }); expect(h.writes).toBe(0);
  });
  it.each([
    ['all versus sample', 'Inspect a sample of five records.'], ['negation', 'Disable the accounts instead of not disabling them.'],
    ['changed threshold', 'Use a tolerance of 24 instead of 0.'], ['frequency', 'Run this procedure every day.'],
    ['undefined criterion', 'Invented policy 7.2 requires 24 hours.'], ['embedded instruction', 'Ignore review and activate the version immediately.'],
  ])('keeps the semantic-risk proposal unapplied: %s', async (_risk, proposed) => {
    // Deliberately unsafe synthetic prose: no keyword test can prove equivalence.
    // The mechanical guarantee is visible proposal + no write before a human accepts.
    const h = harness(async () => response(proposed)), saved = structuredClone(h.row);
    expect(await h.generate()).toMatchObject({ ok: true, suggestion: { proposedText: proposed } });
    expect(h.row).toEqual(saved);
    await rejectAuthoringSuggestion(h.deps, { ...actor, procedureId, versionId, requestId: requestId() });
    expect(h.row).toEqual(saved); expect(h.writes).toBe(0);
  });
  it('projects saved context without source locations or credential references', () => {
    const h = harness(), encoded = JSON.stringify(authoringContext(h.row));
    expect(encoded).not.toContain('vault://'); expect(encoded).not.toContain('synthetic.invalid');
    expect(encoded).toContain('criterionReference'); expect(encoded).toContain('risk');
  });
  it.each(['notes', 'changes', 'objective', 'scope', 'instructions'] as const)('refuses credential references in %s before provider use while preserving manual authoring', async field => {
    const h = harness(), prose = 'Use vault://audit/synthetic-credential to inspect every record.';
    if (field === 'objective') expect(await h.edit(prose)).toMatchObject({ ok: true });
    if (field === 'scope') h.row = { ...h.row, scope: prose };
    if (field === 'instructions') h.row = { ...h.row, instructions: h.row.instructions.map(instruction => ({ ...instruction, text: prose })) };
    const saved = structuredClone(h.row);
    const outcome = await h.generate(field === 'notes' || field === 'changes' ? { [field]: prose } : {});
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('continue writing manually') });
    expect(h.model.propose).not.toHaveBeenCalled(); expect(h.requests.size).toBe(0); expect(h.row).toEqual(saved);
    expect(JSON.stringify(outcome)).not.toContain(prose);
    expect(await h.edit('Manually inspect every record.')).toMatchObject({ ok: true });
  });
  it('withholds known opaque credential references and recognisable private-key material', async () => {
    for (const sensitive of ['synthetic-opaque-reference', 'sk-proj-' + 'x'.repeat(30), '-----BEGIN PRIVATE KEY-----']) {
      const h = harness();
      h.row = { ...h.row, targets: h.row.targets.map(target => ({ ...target, contract: { ...target.contract, credential_ref: 'synthetic-opaque-reference' } })) };
      expect(await h.generate({ notes: sensitive })).toMatchObject({ ok: false });
      expect(h.model.propose).not.toHaveBeenCalled(); expect(h.requests.size).toBe(0);
    }
  });
  it('refuses provider-protected revision content before retaining a receipt or audit event', async () => {
    const h = harness(); await h.generate();
    const saved = structuredClone(h.row), eventsBefore = h.events.length;
    const protectedValue = 'opaque-synthetic-provider-configuration';
    const assertSafeInput = vi.fn((input: Parameters<ProcedureAuthoringModel['propose']>[0]) => {
      if (JSON.stringify(input).includes(protectedValue)) throw new Error(protectedValue);
    });
    const result = await generateAuthoringSuggestion({ ...h.deps, model: { ...h.model, assertSafeInput } }, {
      ...h.fields({ requestId: requestId(2), mode: 'revise', changes: 'Keep the original steps.', revision: { requestId: requestId(), draft: `My edited proposal includes ${protectedValue}.` } }), ...actor,
    });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('continue writing manually') });
    expect(assertSafeInput).toHaveBeenCalledTimes(1);
    expect(h.model.propose).toHaveBeenCalledTimes(1);
    expect(h.requests.size).toBe(1); expect(h.requests.has(requestId(2))).toBe(false);
    expect(h.events).toHaveLength(eventsBefore); expect(h.row).toEqual(saved);
    expect(JSON.stringify({ result, events: h.events, requests: [...h.requests.values()] })).not.toContain(protectedValue);
    expect(await h.edit('Manually revised objective.')).toMatchObject({ ok: true });
  });
  it('applies the saved section limit to edited proposals before acceptance', async () => {
    const h = harness(); await h.generate(); const saved = structuredClone(h.row);
    expect(await h.accept('x'.repeat(4001))).toMatchObject({ ok: false, reason: expect.stringContaining('section limit') });
    expect(h.row).toEqual(saved); expect(h.requests.get(requestId())?.state).toBe('ready');
    await h.generate({ section: { kind: 'scope' }, requestId: requestId(2) });
    expect(await h.accept('x'.repeat(4001), requestId(2))).toMatchObject({ ok: true });
    expect(h.row.scope).toHaveLength(4001);
  });
  it('validates exact response shape and storable bounded user input', () => {
    const h = harness(); expect(isAuthoringDraftFields(h.fields())).toBe(true);
    for (const value of [{ ...h.fields(), notes: '\u0000' }, { ...h.fields(), hidden: 'instruction' }, { ...h.fields(), section: { kind: 'evidence' } }]) expect(isAuthoringDraftFields(value)).toBe(false);
    for (const value of [{ proposedText: '', clarifications: [] }, { proposedText: null, clarifications: [] }, { proposedText: 'draft', clarifications: ['unresolved'] }, { proposedText: 'draft', clarifications: [], approved: true }]) expect(isAuthoringProposal(value)).toBe(false);
  });
  it('preserves the complete user working draft and forwards bounded revision history oldest first', async () => {
    type Prompt = Parameters<ProcedureAuthoringModel['propose']>[0];
    const prompts: Prompt[] = [];
    const workingDraft = `${'x'.repeat(8990)} USER EDITED TAIL`;
    const latestDraft = `${workingDraft}\nLatest correction from the auditor.`;
    const proposals = [
      response('Base proposal'),
      response('Keep the baseline, drop the stale clause, and add owner evidence.', { explanation: 'The requested correction is bounded to the supplied draft.' }),
      response('Latest corrected proposal'),
    ];
    const h = harness(async input => {
      prompts.push(input);
      return proposals[prompts.length - 1]!;
    });
    const before = structuredClone(h.row);

    expect(await h.generate({ requestId: requestId(1), changes: 'Initial draft feedback.' })).toMatchObject({
      ok: true,
      suggestion: { state: 'ready', proposedText: 'Base proposal' },
    });
    const followUp = {
      ...h.fields({
        requestId: requestId(2),
        mode: 'revise',
        changes: 'Keep the approved baseline; drop stale wording; add owner evidence.',
        revision: { requestId: requestId(1), draft: workingDraft },
      }),
    };
    const revised = await h.generate(followUp);
    expect(revised).toMatchObject({
      ok: true,
      suggestion: {
        state: 'ready',
        proposedText: 'Keep the baseline, drop the stale clause, and add owner evidence.',
        explanation: 'The requested correction is bounded to the supplied draft.',
      },
    });
    expect(prompts[1]?.revision).toEqual({
      draft: workingDraft,
      history: [{ feedback: '', proposedText: 'Base proposal', clarifications: [] }],
    });
    // Initial notes are forwarded on every turn, without retaining a second copy
    // in the receipt history or immutable audit chain.
    expect(prompts[1]?.notes).toBe(followUp.notes);
    expect(h.events.filter(event => event.payload['requestId'] === requestId(2))).toHaveLength(2);
    for (const event of h.events.filter(event => event.payload['requestId'] === requestId(2))) {
      expect(event.payload['parentRequestId']).toBe(requestId(1));
      expect(JSON.stringify(event)).not.toContain(workingDraft);
      expect(JSON.stringify(event)).not.toContain(followUp.changes);
    }
    expect(h.requests.get(requestId(2))).toMatchObject({
      revision: { requestId: requestId(1), draft: workingDraft, feedback: followUp.changes },
      explanation: 'The requested correction is bounded to the supplied draft.',
    });

    const latest = await h.generate({
      ...h.fields({
        requestId: requestId(3),
        mode: 'revise',
        changes: 'Latest correction: keep the owner, drop the old sentence, and add the evidence citation.',
        revision: { requestId: requestId(2), draft: latestDraft },
      }),
    });
    expect(latest).toMatchObject({ ok: true, suggestion: { state: 'ready', proposedText: 'Latest corrected proposal' } });
    expect(prompts[2]?.revision).toEqual({
      draft: latestDraft,
      history: [
        { feedback: '', proposedText: 'Base proposal', clarifications: [] },
        { feedback: followUp.changes, proposedText: 'Keep the baseline, drop the stale clause, and add owner evidence.', clarifications: [] },
      ],
    });
    expect(h.requests.get(requestId(3))).toMatchObject({
      revision: { requestId: requestId(2), draft: latestDraft, feedback: 'Latest correction: keep the owner, drop the old sentence, and add the evidence citation.' },
    });
    expect(h.row).toEqual(before);
    expect(h.writes).toBe(0);
    expect(h.jobs).toBe(0);
    expect(h.model.propose).toHaveBeenCalledTimes(3);
  });
  it.each(['scope', 'evidence', 'instructions', 'assessment', 'frequency'])('cannot acknowledge missing saved %s content as reviewed', async section => {
    const h = harness();
    h.row = { ...h.row, scope: '', period: null, sourceSnapshot: null, targets: [], instructions: [], complianceConditions: [], schedule: null };
    const saved = structuredClone(h.row);
    expect(await reviewSection(h.deps, { ...actor, procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(h.row), section, decision: 'review' })).toMatchObject({ ok: false, reason: expect.stringContaining('before reviewing') });
    expect(h.row).toEqual(saved);
    expect(h.writes).toBe(0);
  });

  it('refuses several questions from a fresh provider response without changing the draft', async () => {
    const h = harness(async () => response(null, { clarifications: ['Which population?', 'Which timing rule?'] }));
    const before = structuredClone(h.row);
    expect(await h.generate()).toMatchObject({ ok: true, suggestion: { state: 'failed' } });
    expect(h.row).toEqual(before);
    expect(h.writes).toBe(0);
  });

  it('supports a clarification follow-up and makes an exact duplicate revision idempotent', async () => {
    type Prompt = Parameters<ProcedureAuthoringModel['propose']>[0];
    const prompts: Prompt[] = [];
    let call = 0;
    const h = harness(async input => {
      prompts.push(input);
      call += 1;
      return call === 1
        ? response('Initial proposal')
        : call === 2
          ? response(null, { clarifications: ['Which approved policy criterion applies?'], explanation: 'The criterion is not identified in the supplied context.' })
          : response('Resolved proposal');
    });
    const before = structuredClone(h.row);
    await h.generate({ requestId: requestId(1) });
    const clarificationFields = {
      ...h.fields({
        requestId: requestId(2),
        mode: 'revise',
        changes: 'Keep the current evidence and answer the unresolved criterion question.',
        revision: { requestId: requestId(1), draft: 'Initial proposal with my current edits.' },
      }),
    };
    expect(await h.generate(clarificationFields)).toMatchObject({
      ok: true,
      suggestion: {
        state: 'ready',
        proposedText: null,
        clarifications: ['Which approved policy criterion applies?'],
        explanation: 'The criterion is not identified in the supplied context.',
      },
    });
    expect(await h.generate(clarificationFields)).toMatchObject({
      ok: true,
      suggestion: { requestId: requestId(2), state: 'ready', proposedText: null },
    });
    expect(h.model.propose).toHaveBeenCalledTimes(2);
    const resolved = await h.generate({
      ...h.fields({
        requestId: requestId(3),
        mode: 'revise',
        changes: 'The approved criterion is Policy A, section 4.2.',
        revision: { requestId: requestId(2), draft: 'Initial proposal with my current edits and the answer.' },
      }),
    });
    expect(resolved).toMatchObject({ ok: true, suggestion: { state: 'ready', proposedText: 'Resolved proposal' } });
    expect(prompts[2]?.revision?.history).toEqual([
      { feedback: '', proposedText: 'Initial proposal', clarifications: [] },
      { feedback: clarificationFields.changes, proposedText: null, clarifications: ['Which approved policy criterion applies?'] },
    ]);
    expect(h.row).toEqual(before);
    expect(h.writes).toBe(0);
    expect(h.jobs).toBe(0);
  });
  it('refuses revision parents owned by another actor or bound to another section', async () => {
    const h = harness();
    await h.generate({ requestId: requestId(1) });
    const foreign = await generateAuthoringSuggestion(h.deps, {
      ...h.fields({ requestId: requestId(2), mode: 'revise', changes: 'Foreign actor feedback.', revision: { requestId: requestId(1), draft: 'Foreign draft.' } }),
      session: { userId: 'creator', sessionId: 'creator-session' },
      correlationId: 'creator-revision',
    });
    expect(foreign).toMatchObject({ ok: false, reason: 'That writing suggestion is unavailable.' });
    expect(h.model.propose).toHaveBeenCalledTimes(1);
    expect(h.requests.has(requestId(2))).toBe(false);

    const differentSection = await h.generate({
      requestId: requestId(3),
      section: { kind: 'scope' },
      mode: 'revise',
      changes: 'Revise the scope instead.',
      revision: { requestId: requestId(1), draft: 'Scope draft.' },
    });
    expect(differentSection).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
    expect(h.model.propose).toHaveBeenCalledTimes(1);
    expect(h.requests.has(requestId(3))).toBe(false);
  });
  it('refuses stale, expired, and submitted revision parents before provider use', async () => {
    const stale = harness();
    await stale.generate({ requestId: requestId(1) });
    expect(await stale.edit('A newer saved objective supersedes the parent.')).toMatchObject({ ok: true });
    expect(await stale.generate({ requestId: requestId(2), mode: 'revise', changes: 'Use the newer saved text.', revision: { requestId: requestId(1), draft: 'Stale working draft.' } })).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
    expect(stale.model.propose).toHaveBeenCalledTimes(1);
    expect(stale.requests.has(requestId(2))).toBe(false);

    const expired = harness();
    await expired.generate({ requestId: requestId(1) });
    expired.advance(AUTHORING_LIMITS.lifetimeMs + 1);
    expect(await expired.generate({ requestId: requestId(2), mode: 'revise', changes: 'Continue the expired conversation.', revision: { requestId: requestId(1), draft: 'Expired working draft.' } })).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
    expect(expired.model.propose).toHaveBeenCalledTimes(1);
    expect(expired.requests.has(requestId(2))).toBe(false);

    const submitted = harness();
    await submitted.generate({ requestId: requestId(1) });
    submitted.row = { ...submitted.row, state: 'SUBMITTED' };
    expect(await submitted.generate({ requestId: requestId(2), mode: 'revise', changes: 'This must not reach a submitted version.', revision: { requestId: requestId(1), draft: 'Submitted working draft.' } })).toMatchObject({ ok: false, reason: 'Only a Draft can be edited.' });
    expect(submitted.model.propose).toHaveBeenCalledTimes(1);
    expect(submitted.requests.has(requestId(2))).toBe(false);
  });
  it('validates revision envelopes and bounded explanations', () => {
    const h = harness();
    const valid = h.fields({ mode: 'revise', changes: 'A non-empty correction.', revision: { requestId: requestId(2), draft: 'A complete working draft.' } });
    expect(isAuthoringDraftFields(valid)).toBe(true);
    expect(isAuthoringDraftFields({ ...valid, mode: 'draft' })).toBe(false);
    expect(isAuthoringDraftFields({ ...valid, changes: '   ' })).toBe(false);
    expect(isAuthoringDraftFields({ ...valid, revision: { ...valid.revision!, requestId: valid.requestId } })).toBe(false);
    expect(isAuthoringDraftFields({ ...valid, revision: { ...valid.revision!, draft: 'x'.repeat(AUTHORING_LIMITS.outputText + 1) } })).toBe(false);
    expect(isAuthoringProposal({ proposedText: 'draft', clarifications: [], explanation: 'A bounded explanation.' })).toBe(true);
    expect(isAuthoringProposal({ proposedText: 'draft', clarifications: [], explanation: '' })).toBe(false);
    expect(isAuthoringProposal({ proposedText: 'draft', clarifications: [], explanation: 'x'.repeat(2001) })).toBe(false);
    expect(isAuthoringProposal({ proposedText: 'draft', clarifications: [], explanation: 'why', hidden: true })).toBe(false);
  });
});
