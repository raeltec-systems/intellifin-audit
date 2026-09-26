import { describe, expect, it } from 'vitest';
import type { ExecutablePlan } from '@intellifin/domain';
import { maskHumanMatchDecision } from './record-review.js';
const decision = { waitId: 'wait', answerOptionId: 'candidate-2', answerLabel: 'PRIVATE SECONDARY NAME', actorId: 'auditor', decidedAt: '2026-09-26T12:00:00Z' };
const plan = (sensitive: string[]): ExecutablePlan => ({ inputs: { templateId: 'P-1', sourceSnapshot: { contract: { sensitive_fields: sensitive } } } } as unknown as ExecutablePlan);
describe('frozen lookup masking before a presentation snapshot', () => {
  it.each(['employee_id', 'full_name'])('removes candidate source text when %s is sensitive', key => {
    const masked = maskHumanMatchDecision(decision, plan([key]));
    expect(masked).toMatchObject({ answerLabel: null, answerMasked: true, waitId: 'wait' });
    expect(JSON.stringify(masked)).not.toContain(decision.answerLabel);
  });
  it('fails closed without a readable frozen plan, but retains a permitted answer', () => {
    expect(maskHumanMatchDecision(decision, null)?.answerLabel).toBeNull();
    expect(maskHumanMatchDecision(decision, plan([]))).toMatchObject({ answerLabel: decision.answerLabel, answerMasked: false });
  });
});
