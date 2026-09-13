import { describe, expect, it } from 'vitest';
import { createPreparationActionRegistry, type PreparationChoices } from './PreparationActions';

describe('conversation choice lifetime', () => {
  function setup() {
    const registry = createPreparationActionRegistry();
    let selection: PreparationChoices = { step: 'evidence', surface: 'evidence:source', active: true, basis: 'saved-revision-1',
      choices: [{ id: 'source-1', label: 'Leavers', description: 'Every leaver in the selected period.' }], select: async () => ({ ok: true, message: 'saved' }) };
    registry.choices.set('source-picker', () => selection);
    registry.focused = { surface: selection.surface, id: 'source-1', basis: `${selection.basis}:${JSON.stringify(selection.choices)}` };
    return { registry, change(update: Partial<PreparationChoices>) { selection = { ...selection, ...update }; registry.notify(); } };
  }
  it('keeps an identified option while the same unchanged question remains active', () => {
    const { registry } = setup(); registry.notify();
    expect(registry.focused?.id).toBe('source-1');
  });
  it('forgets the discussed option after leaving a section, even if the auditor returns', () => {
    const { registry, change } = setup();
    change({ active: false }); change({ active: true });
    expect(registry.focused).toBeNull();
  });
  it('requires identification again after a saved revision or catalogue change', () => {
    const first = setup(); first.change({ basis: 'saved-revision-2' }); expect(first.registry.focused).toBeNull();
    const second = setup(); second.change({ choices: [{ id: 'source-2', label: 'Leavers', description: 'A different source.' }] }); expect(second.registry.focused).toBeNull();
  });
});
