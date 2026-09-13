import { describe, expect, it } from 'vitest';
import { createPreparationActionRegistry, preparationActionTurns, type ActionTurn, type PreparationChoices } from './PreparationActions';

describe('action result ownership', () => {
  const saved: ActionTurn = { id: 1, step: 'instructions', thread: { key: 'instructions:system-a', requestId: 'proposal-a' },
    message: 'Record that', result: { ok: true, message: 'Saved the displayed proposal.' } };
  it('shows the acknowledgement with its original proposal, including when that proposal moves into history', () => {
    expect(preparationActionTurns([saved], 'instructions', saved.thread)).toEqual([saved]);
  });
  it('does not show a saved result under a newer proposal, another target, or a general section question', () => {
    expect(preparationActionTurns([saved], 'instructions', { key: 'instructions:system-a', requestId: 'proposal-b' })).toEqual([]);
    expect(preparationActionTurns([saved], 'instructions', { key: 'instructions:system-b', requestId: 'proposal-a' })).toEqual([]);
    expect(preparationActionTurns([saved], 'instructions')).toEqual([]);
  });
});

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
