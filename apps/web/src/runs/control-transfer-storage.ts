/** Recovery data only; neither local names nor a retained command establish authority. */
export interface PendingControlTransfer {
  readonly actorId: string; readonly runId: string; readonly expectedEpoch: number; readonly requestKey: string;
  readonly reason: string; readonly commandId?: string; readonly confirmRequested?: true;
}
const KEY = 'intellifin.control-transfers.v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
function read(storage: Store): PendingControlTransfer[] {
  const raw = storage.getItem(KEY);
  if (raw === null) return [];
  if (raw.length > 60_000) throw new Error('Transfer recovery storage unavailable');
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 8 || items.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const e = entry as Record<string, unknown>;
    return Object.keys(e).some(key => !['actorId', 'runId', 'expectedEpoch', 'requestKey', 'reason', 'commandId', 'confirmRequested'].includes(key)) ||
      typeof e.actorId !== 'string' || !e.actorId || e.actorId.length > 255 ||
      typeof e.runId !== 'string' || !UUID.test(e.runId) || typeof e.requestKey !== 'string' || !UUID.test(e.requestKey) ||
      typeof e.expectedEpoch !== 'number' || !Number.isSafeInteger(e.expectedEpoch) || e.expectedEpoch < 1 || e.expectedEpoch > 2_147_483_647 ||
      typeof e.reason !== 'string' || !e.reason.trim() || e.reason.length > 2000 || new TextEncoder().encode(e.reason).length > 4000 ||
      (e.confirmRequested !== undefined && (e.confirmRequested !== true || e.commandId === undefined)) ||
      (e.commandId !== undefined && (typeof e.commandId !== 'string' || !UUID.test(e.commandId)));
  }) || new Set(items.map((entry: PendingControlTransfer) => entry.runId)).size !== items.length)
    throw new Error('Transfer recovery storage unavailable');
  return items as PendingControlTransfer[];
}
export function pendingControlTransfer(storage: Store, runId: string, actorId: string): PendingControlTransfer | null {
  const all = read(storage);
  const own = all.filter(entry => entry.actorId === actorId);
  if (own.length !== all.length) storage.setItem(KEY, JSON.stringify(own));
  return own.find(entry => entry.runId === runId) ?? null;
}
export function retainControlTransfer(storage: Store, request: PendingControlTransfer): void {
  const entries = read(storage);
  const prior = entries.find(entry => entry.runId === request.runId);
  if (prior && (prior.actorId !== request.actorId || prior.requestKey !== request.requestKey || prior.reason !== request.reason || prior.expectedEpoch !== request.expectedEpoch ||
    (prior.commandId !== undefined && prior.commandId !== request.commandId) ||
    (prior.confirmRequested === true && request.confirmRequested !== true))) throw new Error('Resolve the existing transfer first');
  if (!prior && entries.length >= 8) throw new Error('Resolve pending transfers before opening more Runs');
  const next = [...entries.filter(entry => entry.runId !== request.runId), request];
  // Validate before committing so invalid browser data cannot poison other recoveries.
  const encoded = JSON.stringify(next);
  read({ getItem: () => encoded, setItem: () => {} });
  storage.setItem(KEY, encoded);
}
export function clearControlTransfer(storage: Store, request: PendingControlTransfer): void {
  storage.setItem(KEY, JSON.stringify(read(storage).filter(entry => entry.actorId !== request.actorId || entry.runId !== request.runId || entry.requestKey !== request.requestKey)));
}
