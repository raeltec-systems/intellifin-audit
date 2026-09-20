import { describe, expect, it } from 'vitest';
import { clearControlRenewal, pendingControlRenewal, retainControlRenewal } from './control-renewal-storage';
const request = { runId: '019823ab-0000-7000-8000-000000000001', expectedEpoch: 3,
  requestKey: '019823ab-0000-7000-8000-000000000002' };
function storage(initial: string | null = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}
describe('pending controller renewal recovery', () => {
  it('retains exact identity across a new reader and clears only that definite request', () => {
    const store = storage();
    retainControlRenewal(store, request);
    expect(pendingControlRenewal(store, request.runId)).toEqual(request);
    retainControlRenewal(store, request);
    clearControlRenewal(store, { ...request, requestKey: '019823ab-0000-7000-8000-000000000003' });
    expect(pendingControlRenewal(store, request.runId)).toEqual(request);
    expect(() => retainControlRenewal(store, { ...request, expectedEpoch: 4 })).toThrow('unresolved renewal');
    clearControlRenewal(store, request);
    expect(pendingControlRenewal(store, request.runId)).toBeNull();
  });
  it.each(['{}', 'null', '[{}]', '[null]', '["secret"]', 'x'.repeat(2049),
    JSON.stringify([{ ...request, actorId: 'forged' }]), JSON.stringify([{ ...request, expectedEpoch: '3' }]),
    JSON.stringify([{ ...request, requestKey: 'invalid' }]), JSON.stringify([request, request])])('refuses malformed stored identity', value => {
    expect(() => pendingControlRenewal(storage(value), request.runId)).toThrow();
  });
  it('bounds storage without discarding any unresolved request', () => {
    const store = storage();
    for (let i = 1; i <= 8; i++) retainControlRenewal(store, { ...request, runId: request.runId.slice(0, -1) + i });
    expect(() => retainControlRenewal(store, { ...request, runId: request.runId.slice(0, -1) + '9' })).toThrow('Resolve pending renewals');
    expect(pendingControlRenewal(store, request.runId)).toEqual(request);
  });
});
