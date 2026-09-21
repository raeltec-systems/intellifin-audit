import { describe, expect, it } from 'vitest';
import { clearControlTransfer, pendingControlTransfer, retainControlTransfer } from './control-transfer-storage';
const request = { actorId: 'manager', runId: '019823ab-0000-7000-8000-000000000001', requestKey: '019823ab-0000-7000-8000-000000000002', expectedEpoch: 7, reason: 'Covering the handover' };
const commandId = '019823ab-0000-7000-8000-000000000003';
function storage() { let value: string | null = null; return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } }; }
describe('transfer recovery storage', () => {
  it('keeps exact proposal data across a new reader without claiming confirmation was requested', () => {
    const store = storage(); retainControlTransfer(store, request);
    expect(pendingControlTransfer(store, request.runId, request.actorId)).toEqual(request);
    retainControlTransfer(store, { ...request, commandId });
    expect(pendingControlTransfer(store, request.runId, request.actorId)).toEqual({ ...request, commandId });
    expect(pendingControlTransfer(store, request.runId, request.actorId)?.confirmRequested).toBeUndefined();
    retainControlTransfer(store, { ...request, commandId, confirmRequested: true });
    expect(pendingControlTransfer(store, request.runId, request.actorId)?.confirmRequested).toBe(true);
    expect(() => retainControlTransfer(store, { ...request, commandId })).toThrow();
  });
  it('refuses to replace unresolved identity or meaning and cannot erase a newer request', () => {
    const store = storage(); retainControlTransfer(store, request);
    for (const changed of [{ ...request, reason: 'Different reason' }, { ...request, expectedEpoch: 8 }, { ...request, requestKey: commandId }])
      expect(() => retainControlTransfer(store, changed)).toThrow();
    clearControlTransfer(store, { ...request, requestKey: commandId });
    expect(pendingControlTransfer(store, request.runId, request.actorId)).toEqual(request);
    clearControlTransfer(store, request); expect(pendingControlTransfer(store, request.runId, request.actorId)).toBeNull();
  });
  it('bounds storage and refuses corrupt recovery rather than dropping unresolved requests', () => {
    const store = storage();
    expect(() => retainControlTransfer(store, { ...request, reason: 'x'.repeat(4001) })).toThrow();
    store.setItem('', '[{"runId":"broken"}]');
    expect(() => pendingControlTransfer(store, request.runId, request.actorId)).toThrow();
    store.setItem('', 'x'.repeat(60001)); expect(() => pendingControlTransfer(store, request.runId, request.actorId)).toThrow();
  });
  it('does not send when storage cannot retain the request', () => {
    expect(() => retainControlTransfer({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, request)).toThrow();
  });
});

it('purges another account’s retained reason before recovery and never returns it', () => {
  const store = storage(); retainControlTransfer(store, request);
  expect(pendingControlTransfer(store, request.runId, 'different-manager')).toBeNull();
  expect(store.getItem()).not.toContain(request.reason);
  expect(pendingControlTransfer(store, request.runId, request.actorId)).toBeNull();
});
