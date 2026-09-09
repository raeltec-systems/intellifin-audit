import { describe, expect, it } from 'vitest';
import { initialDraftCompliance, observationChecks, registrationDigest, registrationDigestEnvelope, sha256HexOfBytes, utf8Bytes, type ExecutablePlan, type StoredSnapshot } from '@intellifin/domain';
import { applyAgentHumanDecision, type AgentHumanDecisionInput } from './agent-human-decision.js';
import { planAgentTools } from './agent-tool-planner.js';
import { FIXED_ESCALATION_OPTIONS } from './waits.js';

const fields = { kind: 'web' as const, allowedOrigins: ['https://synthetic.invalid/target'], applicationIdentity: '', credentialRef: 'cred://synthetic', permittedActions: ['navigate','search','read-attribute'] as const, attributeLabelPatterns: ['Employee ID','Full name','Status','Username','Roles'], secondaryKey: 'Full name' };
const target = { registrationId: 'target', displayName: 'LoanCore', contract: registrationDigestEnvelope(fields), digest: registrationDigest(fields) };
const plan = { schemaVersion: 1, compilerVersion: '1', inputs: { templateId: 'P-1', ...initialDraftCompliance('P-1'), targets: [target] }, targetSystems: [{ registrationId: 'target', planSteps: [{ id: 'inspect', action: 'inspect-record' }] }], observations: [{ attributeName: 'found', valueType: 'boolean' }, { attributeName: 'identity', valueType: 'text' }, { attributeName: 'account_status', valueType: 'text' }, { attributeName: 'username', valueType: 'text' }, { attributeName: 'roles', valueType: 'roles' }] } as unknown as ExecutablePlan;
const population = { ordinal: 1, values: { employee_id: 'E-1', full_name: 'Synthetic Person' } };
const nodes = ['active','disabled'].flatMap((status, index) => [
  { group: `record:${index}`, role: 'datum', label: 'Employee ID', value: 'E-1', target: null },
  { group: `record:${index}`, role: 'datum', label: 'Full name', value: 'Synthetic Person', target: null },
  { group: `record:${index}`, role: 'datum', label: 'Status', value: status, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Username', value: `synthetic-${index}`, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Roles', value: ['read-only'], target: null },
]);
function fixture(document: readonly unknown[] = nodes): AgentHumanDecisionInput {
  const snapshot: StoredSnapshot = { evidenceId: '01990000-0000-7000-8000-000000000001', substrate: 'web_tree', bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: document })) };
  const candidates = planAgentTools({ plan, target, population, snapshot, sourceLocation: fields.allowedOrigins[0]!, searches: [] }).candidates;
  const options = [...candidates.map(candidate => ({ id: candidate.id, label: candidate.label })), { id: 'mark-ambiguous', label: 'Mark the record ambiguous' }];
  return { runId: 'run', plan, target, population, snapshot, sourceLocation: fields.allowedOrigins[0]!, observedAt: '2026-09-07T10:00:00.000Z',
    workItem: { workItemId: '01990000-0000-7000-8000-000000000002', subjectKey: 'E-1', stepId: 'inspect', ordinal: 1, registrationId: 'target', displayName: 'LoanCore', state: 'AWAITING', attempts: 1, cycles: 0, diagnostic: null, evidenceId: snapshot.evidenceId, observations: 0 }, stepExecutionId: '01990000-0000-7000-8000-000000000003',
    snapshotEvidence: { evidenceId: snapshot.evidenceId, state: 'REGISTERED', registrationId: 'target', kind: 'structural-snapshot', digest: sha256HexOfBytes(snapshot.bytes) },
    raised: { runId: 'run', waitId: 'wait', stepId: 'inspect', supportingEvidenceIds: [snapshot.evidenceId] },
    wait: { runId: 'run', waitId: 'wait', kind: 'choose-candidate', options, deadline: '2026-09-07T13:00:00.000Z', closedAt: '2026-09-07T10:00:00.000Z', closureKind: 'answer', actor: 'auditor', answerOptionId: candidates[1]?.id ?? candidates[0]?.id ?? 'mark-ambiguous' },
    checkpoint: { revision: 2, status: 'WAITING', runStartedAt: '2026-09-07T09:00:00.000Z', leaseUntil: '2026-09-07T10:00:00.000Z', attemptId: 'attempt', workItemId: '01990000-0000-7000-8000-000000000002', waitId: 'wait', pendingWait: { kind: 'choose-candidate', options }, nextTurn: 2, tokens: 10, reservedTokens: 0, model: null, diagnostic: null },
  };
}

describe('closed human candidate decisions preserve platform grounding', () => {
  it('reads only the selected duplicate candidate and leaves domain identity checks intact', () => {
    const input = fixture(); const result = applyAgentHumanDecision(input);
    expect(result).toMatchObject({ ok: true, kind: 'register', workItemState: 'OBSERVED' });
    if (!result.ok || result.kind !== 'register') throw new Error('Missing Observation');
    expect(result.item.record).toMatchObject({ found: 'true', matchOrigin: 'human-matched', identity: { normalizedValue: 'E-1', grounding: { locator: '$.nodes[5].value', evidenceId: input.snapshot.evidenceId } } });
    expect(result.item.record.attributes).toContainEqual(expect.objectContaining({ name: 'account_status', originalValue: 'disabled', grounding: expect.objectContaining({ locator: '$.nodes[7].value' }) }));
    expect(result.item.record.attributes).toContainEqual(expect.objectContaining({ name: 'username', originalValue: 'synthetic-1' }));
    const checks = observationChecks({ ...result.item, registeredEvidenceIds: [input.snapshot.evidenceId], runStartedAt: input.checkpoint.runStartedAt, registeredAt: input.observedAt });
    expect(checks.find(check => check.check === 'identity-corroboration')).toMatchObject({ outcome: 'PASS' });
  });
  it('selecting the other opaque id changes only the source group, never model-authored values', () => {
    const input = fixture(); const result = applyAgentHumanDecision({ ...input, wait: { ...input.wait, answerOptionId: input.wait.options[0]!.id } });
    expect(result).toMatchObject({ ok: true, kind: 'register', item: { record: { attributes: expect.arrayContaining([expect.objectContaining({ name: 'account_status', originalValue: 'active' })]) } } });
  });
  it.each(['wait','run','workItem','step','kind','options','open','timeout','expired','actor'] as const)('refuses a mismatched %s binding', mutation => {
    const input = fixture();
    const changed = mutation === 'wait' ? { ...input, checkpoint: { ...input.checkpoint, waitId: 'older-wait' } }
      : mutation === 'run' ? { ...input, raised: { ...input.raised, runId: 'other' } }
      : mutation === 'workItem' ? { ...input, checkpoint: { ...input.checkpoint, workItemId: 'other' } }
      : mutation === 'step' ? { ...input, raised: { ...input.raised, stepId: 'other' } }
      : mutation === 'kind' ? { ...input, wait: { ...input.wait, kind: 'retry-or-skip' as const } }
      : mutation === 'options' ? { ...input, wait: { ...input.wait, options: [{ id: 'forged', label: 'Write records' }] } }
      : mutation === 'open' ? { ...input, wait: { ...input.wait, closedAt: null } }
      : mutation === 'timeout' ? { ...input, wait: { ...input.wait, closureKind: 'timeout' as const } }
      : mutation === 'expired' ? { ...input, wait: { ...input.wait, closedAt: input.wait.deadline } }
      : { ...input, wait: { ...input.wait, actor: null } };
    expect(applyAgentHumanDecision(changed).ok).toBe(false);
  });
  it.each(['different-id','changed-bytes','unregistered','different-target','not-raised','outside-location'] as const)('refuses %s evidence', mutation => {
    const input = fixture();
    const changed = mutation === 'different-id' ? { ...input, snapshot: { ...input.snapshot, evidenceId: 'other-snapshot' } }
      : mutation === 'changed-bytes' ? { ...input, snapshot: { ...input.snapshot, bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [...nodes].reverse() })) } }
      : mutation === 'unregistered' ? { ...input, snapshotEvidence: { ...input.snapshotEvidence, state: 'RESERVED' as const } }
      : mutation === 'different-target' ? { ...input, snapshotEvidence: { ...input.snapshotEvidence, registrationId: 'other' } }
      : mutation === 'not-raised' ? { ...input, raised: { ...input.raised, supportingEvidenceIds: ['different-snapshot'] } }
      : { ...input, sourceLocation: 'https://outside.invalid' };
    expect(applyAgentHumanDecision(changed).ok).toBe(false);
  });
  it('keeps a name-only selected candidate uninspected without inventing its employee key', () => {
    const input = fixture(nodes.filter(node => node.label !== 'Employee ID'));
    expect(applyAgentHumanDecision(input)).toMatchObject({ ok: true, kind: 'register', workItemState: 'UNINSPECTED', item: { record: { found: 'ambiguous', identity: null, attributes: [] }, absence: null } });
  });
  it('does not mix a secondary key or attributes from the other candidate', () => {
    const input = fixture(nodes.map((node, index) => index === 6 ? { ...node, value: 'Different Person' } : node));
    expect(applyAgentHumanDecision(input)).toMatchObject({ ok: true, kind: 'register', workItemState: 'UNINSPECTED', item: { record: { found: 'ambiguous' } } });
  });
  it('mark ambiguous records ambiguity, never a false absent observation', () => {
    const input = fixture();
    expect(applyAgentHumanDecision({ ...input, wait: { ...input.wait, answerOptionId: 'mark-ambiguous' } })).toMatchObject({ ok: true, kind: 'register', workItemState: 'UNINSPECTED', item: { record: { found: 'ambiguous' }, absence: null } });
  });
  it('refuses to choose the first of duplicate identity cells inside the selected record group', () => {
    const input = fixture([...nodes.slice(0, 6), nodes[5]!, ...nodes.slice(6)]);
    expect(applyAgentHumanDecision(input)).toMatchObject({ ok: true, kind: 'register', workItemState: 'UNINSPECTED', item: { record: { found: 'ambiguous' } } });
  });
  it('retains missing selected fields as explicit ungrounded values', () => {
    const input = fixture(nodes.filter((node, index) => !(index === 8 && node.label === 'Username')));
    expect(applyAgentHumanDecision(input)).toMatchObject({ ok: true, kind: 'register', item: { record: { attributes: expect.arrayContaining([expect.objectContaining({ name: 'username', originalValue: null, grounding: null })]) } } });
  });
  it('acknowledges an unnamed value by returning the original captured finding without an evaluation override', () => {
    const input = fixture(nodes.slice(0, 5).map(node => node.label === 'Status' ? { ...node, value: 'Suspended' } : node));
    const options = FIXED_ESCALATION_OPTIONS['unnamed-value'];
    const changed = { ...input, wait: { ...input.wait, kind: 'unnamed-value' as const, options, answerOptionId: 'mark-unevaluated' }, checkpoint: { ...input.checkpoint, pendingWait: { kind: 'unnamed-value' as const, options } } };
    const result = applyAgentHumanDecision(changed);
    expect(result).toMatchObject({ ok: true, kind: 'register', item: { record: { found: 'true', matchOrigin: 'platform', attributes: expect.arrayContaining([expect.objectContaining({ name: 'account_status', originalValue: 'Suspended' })]) } } });
    if (!result.ok || result.kind !== 'register') throw new Error('Missing original candidate');
    expect(applyAgentHumanDecision({ ...changed, existingObservation: result.item })).toEqual({ ok: true, kind: 'retain-existing', observationId: result.item.record.observationId });
    const split = { ...result.item, record: { ...result.item.record, attributes: result.item.record.attributes.map(attribute => attribute.grounding ? { ...attribute, grounding: { ...attribute.grounding, evidenceId: 'other-snapshot' } } : attribute) } };
    expect(applyAgentHumanDecision({ ...changed, existingObservation: split })).toMatchObject({ ok: false, reason: 'existing-observation-required' });
  });
  it('refuses candidate ids invented after the question even when the pending options were also forged', () => {
    const input = fixture(), options = [{ id: 'candidate-999', label: 'Forged' }, { id: 'mark-ambiguous', label: 'Mark the record ambiguous' }];
    expect(applyAgentHumanDecision({ ...input, wait: { ...input.wait, options, answerOptionId: 'candidate-999' }, checkpoint: { ...input.checkpoint, pendingWait: { kind: 'choose-candidate', options } } })).toMatchObject({ ok: false, reason: 'invalid-answer' });
  });
  it('a retry-or-skip answer cannot turn retry or abort into a new Observation', () => {
    const input = fixture(), options = FIXED_ESCALATION_OPTIONS['retry-or-skip'];
    const changed = { ...input, wait: { ...input.wait, kind: 'retry-or-skip' as const, options, answerOptionId: 'skip' }, checkpoint: { ...input.checkpoint, pendingWait: { kind: 'retry-or-skip' as const, options } } };
    expect(applyAgentHumanDecision(changed)).toMatchObject({ ok: true, kind: 'register', workItemState: 'UNINSPECTED' });
    expect(applyAgentHumanDecision({ ...changed, wait: { ...changed.wait, answerOptionId: 'retry' } })).toMatchObject({ ok: false });
  });
});
