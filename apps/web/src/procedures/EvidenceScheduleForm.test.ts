import { describe, expect, it } from 'vitest';
import { createSectionMachine, reconcileSection, type SectionState } from './use-section';

const original = { frequency: 'weekly', startTime: '00:00' };
const remote = { frequency: 'daily', startTime: '06:00' };
const edited = { frequency: 'monthly', startTime: '09:00' };
const state = (value = original): SectionState<typeof original> => ({ value, baseline: original, token: 'original-token', conflict: false });

describe('Builder section refreshes', () => {
  it('preserves incomplete non-storable input so field validation can explain it', () => {
    const machine = createSectionMachine({ text: 'saved' }, 'a');
    machine.edit({ text: '\ud800' });
    expect(() => machine.observe({ text: 'saved' }, 'b')).not.toThrow();
    expect(machine.state.value.text).toBe('\ud800');
    expect(machine.state.conflict).toBe(false);
  });
  it('accepts reordered source-contract object keys without losing dirty authoring or acknowledgement', () => {
    const snapshot = { source: { digest: 'digest', contract: { location: 'source', declared_schema: ['id', 'name'] } }, scope: 'saved' };
    const reordered = { scope: 'saved', source: { contract: { declared_schema: ['id', 'name'], location: 'source' }, digest: 'digest' } };
    const machine = createSectionMachine(snapshot, 'a');
    machine.edit({ ...snapshot, scope: 'local' });
    machine.observe(reordered, 'b');
    expect(machine.state.conflict).toBe(false);
    expect(machine.state.token).toBe('b');
    expect(machine.state.value.scope).toBe('local');
    machine.begin({ ...snapshot, scope: 'local' });
    machine.observe({ ...reordered, scope: 'local' }, 'c');
    expect(machine.finish('c')).toBe(true);
    expect(machine.state.conflict).toBe(false);
    machine.edit({ ...snapshot, scope: 'later local' });
    machine.observe({ ...reordered, source: { ...reordered.source, contract: { ...reordered.source.contract, declared_schema: ['name', 'id'] } } }, 'd');
    expect(machine.state.conflict).toBe(true);
  });
  it('refreshes pristine fields together with their token', () => {
    expect(reconcileSection(state(), remote, 'remote-token')).toEqual({ value: remote, baseline: remote, token: 'remote-token', conflict: false });
  });
  it('keeps unsaved fields while adopting an unrelated-section token', () => {
    expect(reconcileSection(state(edited), original, 'rename-token')).toEqual({ ...state(edited), token: 'rename-token' });
  });
  it('does not grant dirty inputs permission to overwrite another author’s section', () => {
    expect(reconcileSection(state(edited), remote, 'remote-token')).toEqual({ ...state(edited), conflict: true });
  });
  it('does not clear a detected conflict on a later unrelated refresh', () => {
    const conflicted = reconcileSection(state(edited), remote, 'remote-token');
    expect(reconcileSection(conflicted, original, 'later-token')).toEqual(conflicted);
  });
  it('accepts a refresh that acknowledges exactly the local values', () => {
    expect(reconcileSection(state(edited), edited, 'saved-token')).toEqual({ value: edited, baseline: edited, token: 'saved-token', conflict: false });
  });
});

describe('Builder section request event ordering', () => {
  it('preserves a newer remote conflict when an older save succeeds late', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    section.observe(remote, 'c');
    expect(section.state.conflict).toBe(true);
    expect(section.finish('b')).toBe(false);
    section.observe(remote, 'c-other-section');
    expect(section.state).toEqual({ value: edited, baseline: original, token: 'a', conflict: true });
    section.reset();
    expect(section.state).toEqual({ value: remote, baseline: remote, token: 'c-other-section', conflict: false });
  });
  it('keeps the action token across old snapshots until the acknowledged snapshot arrives', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    expect(section.finish('b')).toBe(true);
    section.observe(original, 'a');
    section.observe(original, 'b');
    section.observe(original, 'old-unrelated');
    expect(section.state.token).toBe('b');
    section.observe(edited, 'b');
    section.observe(edited, 'a');
    expect(section.state).toEqual({ value: edited, baseline: edited, token: 'b', conflict: false });
    section.observe(edited, 'c');
    expect(section.state.token).toBe('c');
  });
  it('retains a newer refreshed token when the action response arrives last', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    section.observe(edited, 'b');
    section.observe(edited, 'c');
    expect(section.finish('b')).toBe(true);
    expect(section.state.token).toBe('c');
    section.observe(edited, 'b');
    expect(section.state.token).toBe('c');
  });
  it('preserves edits made while saving and acknowledges only the submitted baseline', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    section.edit(remote);
    expect(section.finish('b')).toBe(false);
    section.observe(original, 'a');
    section.observe(edited, 'b');
    expect(section.state).toEqual({ value: remote, baseline: edited, token: 'b', conflict: false });
  });
  it('does not let a late response undo an explicit conflict reset', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    section.observe(remote, 'c');
    section.reset();
    expect(section.finish('b')).toBe(false);
    expect(section.state).toEqual({ value: remote, baseline: remote, token: 'c', conflict: false });
  });
  it('clears normalized saved values without dropping subsequent edits', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(remote);
    section.observe(remote, 'b');
    expect(section.finish('b')).toBe(true);
    expect(section.state.value).toEqual(remote);
    expect(section.state.baseline).toEqual(remote);
  });
  it('keeps a conflict sticky even if a later refresh happens to match local values', () => {
    const section = createSectionMachine(original, 'a');
    section.edit(edited);
    section.begin(edited);
    section.observe(remote, 'c');
    section.observe(edited, 'd');
    section.finish('b');
    expect(section.state.conflict).toBe(true);
    expect(section.state.token).toBe('a');
  });
});


it('preserves a change following the refreshed acknowledgement while its response is pending', () => {
  const section = createSectionMachine(original, 'a');
  section.edit(edited);
  section.begin(edited);
  section.observe(edited, 'b');
  section.observe(remote, 'c');
  expect(section.finish('b')).toBe(false);
  expect(section.state.conflict).toBe(true);
  expect(section.state.token).toBe('b');
  section.reset();
  expect(section.state.value).toEqual(remote);
  expect(section.state.token).toBe('c');
});

it('adopts the response token when a save has unchanged values and no refreshed acknowledgement', () => {
  const section = createSectionMachine(original, 'a');
  section.begin(original);
  section.observe(original, 'a');
  expect(section.finish('b')).toBe(true);
  section.observe(original, 'a');
  expect(section.state.token).toBe('b');
});
