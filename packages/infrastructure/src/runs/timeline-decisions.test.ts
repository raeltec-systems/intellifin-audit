import { describe, expect, it } from 'vitest';
import type { ExecutablePlan } from '@intellifin/domain';
import { maskTimelineCandidate, type TimelineDecision } from './timeline-decisions.js';
const decision: TimelineDecision = {
  sequence: 1, kind: 'escalation', occurredAt: '2026-09-26T12:00:00Z', actorId: 'auditor', waitId: 'wait',
  escalationKind: 'choose-candidate', answerOptionId: 'candidate-1', answerLabel: 'PRIVATE SOURCE VALUE',
  requestedAt: null, state: null, stepId: null, workItemId: null,
};
const plan = (sensitive: string[]): ExecutablePlan => ({ inputs: { templateId: 'P-1',
  sourceSnapshot: { contract: { sensitive_fields: sensitive } } } } as unknown as ExecutablePlan);
describe('Timeline source masking before reader projection', () => {
  it.each(['full_name', 'employee_id'])('masks the secondary or primary fallback when %s is sensitive', field => {
    const masked = maskTimelineCandidate(decision, plan([field]));
    expect(masked).toMatchObject({ answerLabel: null, answerMasked: true });
    expect(JSON.stringify(masked)).not.toContain('PRIVATE SOURCE VALUE');
  });
  it('fails closed for unavailable or unknown frozen policy', () => {
    for (const unknown of [null, { inputs: { templateId: 'unknown' } } as unknown as ExecutablePlan,
      { inputs: { templateId: 'P-1' } } as unknown as ExecutablePlan]) {
      expect(maskTimelineCandidate(decision, unknown)).toMatchObject({ answerLabel: null, answerMasked: true });
    }
  });
  it('keeps source text only when the frozen lookup policy permits it', () => {
    expect(maskTimelineCandidate(decision, plan([]))).toMatchObject({ answerLabel: decision.answerLabel, answerMasked: false });
  });
  it('never treats fixed answers as freely disclosable candidate labels', () => {
    expect(maskTimelineCandidate({ ...decision, escalationKind: 'retry-or-skip', answerOptionId: 'retry' }, null).answerMasked).toBe(true);
    expect(maskTimelineCandidate({ ...decision, answerOptionId: 'mark-ambiguous' }, null).answerMasked).toBe(true);
  });
});
