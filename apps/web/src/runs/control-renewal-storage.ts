/** Session storage is request recovery only; it never establishes actor or ownership. */
export interface PendingControlRenewal {
  readonly runId: string;
  readonly expectedEpoch: number;
  readonly requestKey: string;
}
const STORAGE_KEY = 'intellifin.control-renewals.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIMIT = 8;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
function requests(storage: Store): PendingControlRenewal[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  if (raw.length > 2048) throw new Error('Pending renewal storage is unavailable');
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > LIMIT || value.some((entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const item = entry as Record<string, unknown>;
    return Object.keys(item).length !== 3 || typeof item.runId !== 'string' || !UUID.test(item.runId) ||
      typeof item.requestKey !== 'string' || !UUID.test(item.requestKey) || typeof item.expectedEpoch !== 'number' ||
      !Number.isSafeInteger(item.expectedEpoch) || item.expectedEpoch < 1 || item.expectedEpoch > 2_147_483_647;
  }) || new Set(value.map((entry: PendingControlRenewal) => entry.runId)).size !== value.length)
    throw new Error('Pending renewal storage is unavailable');
  return value as PendingControlRenewal[];
}
export function pendingControlRenewal(storage: Store, runId: string): PendingControlRenewal | null {
  return requests(storage).find(request => request.runId === runId) ?? null;
}
export function retainControlRenewal(storage: Store, request: PendingControlRenewal): void {
  const entries = requests(storage);
  const prior = entries.find(entry => entry.runId === request.runId);
  if (prior) {
    if (prior.requestKey !== request.requestKey || prior.expectedEpoch !== request.expectedEpoch)
      throw new Error('An unresolved renewal already exists');
    return;
  }
  if (entries.length >= LIMIT) throw new Error('Resolve pending renewals before opening more Runs');
  storage.setItem(STORAGE_KEY, JSON.stringify([...entries, request]));
}
export function clearControlRenewal(storage: Store, request: PendingControlRenewal): void {
  // An older lifetime cannot erase a different pending request.
  storage.setItem(STORAGE_KEY, JSON.stringify(requests(storage).filter(entry =>
    entry.runId !== request.runId || entry.requestKey !== request.requestKey || entry.expectedEpoch !== request.expectedEpoch)));
}
