import { describe, expect, it } from 'vitest';
import { initialDraftSections, initialDraftPopulation } from './procedure-version.js';
import { initialDraftTargets } from './target-draft.js';
import { initialDraftCompliance } from './plan-compiler.js';
import { initialDraftEvidence } from './evidence-draft.js';
import { PREPARATION_SECTIONS, isSectionPreparation, preparationBasis, preparationStatus, refreshPreparation, sectionReview, type PreparationInputs } from './preparation.js';

const inputs = (): PreparationInputs => ({ templateId: 'P-1', controlName: 'Synthetic leavers', sections: initialDraftSections('P-1'),
  ...initialDraftPopulation('P-1'), ...initialDraftTargets(), ...initialDraftCompliance('P-1'), ...initialDraftEvidence('P-1') });
function reviewed(): PreparationInputs {
  const row = inputs(), prep = refreshPreparation(row);
  return { ...row, sectionPreparation: { ...prep, sections: Object.fromEntries(PREPARATION_SECTIONS.map(id => [id,
    { ...prep.sections[id], review: { actorId: 'auditor', at: '2026-09-11T12:00:00.000Z', basis: prep.sections[id].basis, revision: prep.sections[id].revision } }])) as typeof prep.sections } };
}
describe('saved section preparation', () => {
  it('never interprets prefilled prose or generation as a review', () => {
    expect(preparationStatus(inputs(), 'context')).toBe('drafting');
    expect(sectionReview(inputs(), 'context')).toBeNull();
    expect(preparationStatus(inputs(), 'scope')).toBe('not-started');
  });
  it('invalidates dependencies, preserves unrelated review, and never revives an acknowledgement on reversal', () => {
    const row = reviewed();
    const changed = { ...row, scope: 'Every August leaver, without sampling.' };
    const after = { ...changed, sectionPreparation: refreshPreparation(changed) };
    expect(sectionReview(after, 'scope')).toBeNull();
    expect(sectionReview(after, 'instructions')).toBeNull();
    expect(sectionReview(after, 'evidence')).toBeNull();
    expect(sectionReview(after, 'assessment')).toBeNull();
    expect(sectionReview(after, 'context')).toEqual(sectionReview(row, 'context'));
    expect(sectionReview(after, 'frequency')).toEqual(sectionReview(row, 'frequency'));
    const reversed = { ...after, scope: row.scope };
    expect(sectionReview({ ...reversed, sectionPreparation: refreshPreparation(reversed) }, 'scope')).toBeNull();
    expect(after.sectionPreparation.revision).toBeGreaterThan(row.sectionPreparation!.revision);
  });
  it('detects stale metadata defensively and rejects malformed durable claims', () => {
    const row = reviewed();
    expect(isSectionPreparation(row.sectionPreparation)).toBe(true);
    expect(sectionReview({ ...row, controlName: 'Changed meaning' }, 'context')).toBeNull();
    expect(isSectionPreparation({ ...row.sectionPreparation, sections: {} })).toBe(false);
    const prep = row.sectionPreparation!;
    expect(isSectionPreparation({ ...prep, sections: { ...prep.sections, context: { ...prep.sections.context, needsClarification: true } } })).toBe(false);
  });
  it('keeps explicit clarification open through edits; plan worker metadata does not change content identity', () => {
    const row = reviewed(), prep = row.sectionPreparation!;
    const unclear = { ...row, sectionPreparation: { ...prep, sections: { ...prep.sections, context: { ...prep.sections.context, needsClarification: true, review: null } } } };
    const refreshed = { ...unclear, sectionPreparation: refreshPreparation(unclear) };
    expect(preparationStatus(refreshed, 'context')).toBe('needs-clarification');
    expect(preparationBasis({ ...row, ...{ planStatus: 'succeeded' } }, 'context')).toBe(preparationBasis(row, 'context'));
  });
});
