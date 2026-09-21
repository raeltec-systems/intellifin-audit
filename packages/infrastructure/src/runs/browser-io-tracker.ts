import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<Set<Promise<unknown>>>();

/** Register the actual Playwright promise, before racing it against an action deadline. */
export function trackBrowserIo<T>(pending: Promise<T>): Promise<T> {
  const active = scope.getStore();
  if (active !== undefined) {
    active.add(pending);
    void pending.then(() => active.delete(pending), () => active.delete(pending));
  }
  return pending;
}

/** A timed-out wrapper is not cancellation. Fence permanently before returning to admission. */
export async function withTrackedBrowserIo<T>(work: () => Promise<T>, fence: () => void): Promise<T> {
  const active = new Set<Promise<unknown>>();
  return scope.run(active, async () => {
    try { return await work(); }
    finally {
      // Nested deadline wrappers remove themselves; actual browser promises remain until
      // they settle. No private input/public sampling may reuse this workspace meanwhile.
      if (active.size > 0) fence();
    }
  });
}
