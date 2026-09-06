/**
 * The post-Run Evidence integrity sweep (Story 3.5, given a caller).
 *
 * `verifySealedPackage` is the "mismatch after the Run" half of the seal rule, and it had
 * no production caller at all: nothing in the product ever re-read a sealed artifact, the
 * only reader of `run_evidence_integrity` was the Run page, and so an object deleted or
 * altered after a Run terminated was never detected — while that page went on printing
 * "Sealed. Every artifact this Run required is registered and verified" in the present
 * tense about storage nothing re-checked. This is the caller.
 *
 * The same shape as `startPopulationRecovery` and the Target System probe runner: a
 * bounded page per tick, one Run at a time, and a stop that lets the active one finish and
 * starts none of the rest. It reads through its OWN read — a background job must not
 * borrow a surface's (`listRegistrations` was capped and included retired rows, and the
 * probe sweep that borrowed it probed nothing while exiting 0).
 *
 * What a mismatch MEANS is `verifySealedPackage`'s and is not re-decided here. In
 * particular a store that cannot be READ is an outage, not proof of tampering: the command
 * lets that failure propagate rather than fabricating an `object-missing` finding, so a
 * throw reaching this loop is reported to the caller's `onError` and never written into
 * the chain.
 */

/**
 * The sweep's own read of the packages it may re-verify.
 *
 * A keyset page, ordered by Run id: `after` is the last id of the previous page, or `null`
 * to start again from the beginning.
 */
export interface SealedPackages {
  verifiableRunIds(after: string | null, limit: number): Promise<string[]>;
}

/**
 * How many Runs one tick re-verifies.
 *
 * Deliberately smaller than the recovery sweeps' 100: each Run here reads every registered
 * artifact out of object storage in full, so the page is a cost as well as a bound.
 */
export const EVIDENCE_INTEGRITY_SWEEP_PAGE = 10;

/** How often a page is taken, when the caller does not say. */
const DEFAULT_INTERVAL_MS = 300_000;

export interface EvidenceIntegritySweepOptions {
  readonly intervalMs?: number;
  /** Test seam. Production takes `EVIDENCE_INTEGRITY_SWEEP_PAGE`, which is the bound. */
  readonly page?: number;
}

export function startEvidenceIntegritySweep(
  repository: SealedPackages,
  verify: (runId: string) => Promise<unknown>,
  onError: () => void,
  options: EvidenceIntegritySweepOptions = {},
): () => Promise<void> {
  const size = options.page ?? EVIDENCE_INTEGRITY_SWEEP_PAGE;
  // The cursor lives for the life of the process and resets on restart, exactly as the
  // Story 2.6 Draft sweep's does. Every sealed package is re-checked in rotation: a cursor
  // that stopped at the end would verify each Run once and never notice a later edit.
  let after: string | null = null;
  let pending: Promise<void> | undefined;
  let stopping = false;
  const tick = (): void => {
    if (pending || stopping) return;
    pending = (async () => {
      const page = await repository.verifiableRunIds(after, size);
      // A short page is the end of the rotation, so the next tick starts over.
      after = page.length < size ? null : (page[page.length - 1] ?? null);
      for (const runId of page) {
        if (stopping) break;
        try {
          await verify(runId);
        } catch {
          // One unreadable Run is not a reason to stop checking the others.
          onError();
        }
      }
    })()
      .catch(onError)
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  tick();
  // The active verification is bounded by its own per-object read timeout. Do not start
  // any more of the selected page while shutdown waits for that one.
  return async () => {
    stopping = true;
    clearInterval(timer);
    await pending;
  };
}
