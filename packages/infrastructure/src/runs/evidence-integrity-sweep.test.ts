import { describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_INTEGRITY_SWEEP_PAGE,
  startEvidenceIntegritySweep,
  type SealedPackages,
} from './evidence-integrity-sweep.js';

/**
 * The post-Run integrity sweep's loop, on its own.
 *
 * What `verifySealedPackage` decides is proved in `seal-package.test.ts`. What is proved
 * here is that something actually CALLS it: the command existed with tests and no
 * production caller at all, so an object deleted or altered after a Run terminated was
 * never detected, while the Run page went on printing "Sealed. Every artifact this Run
 * required is registered and verified" in the present tense about storage nothing
 * re-checked.
 */
describe('the post-Run Evidence integrity sweep', () => {
  /** A repository whose pages are handed out in order, keyset style. */
  function pages(...batches: readonly string[][]): SealedPackages & { seen: (string | null)[] } {
    const seen: (string | null)[] = [];
    let index = 0;
    return {
      seen,
      verifiableRunIds: vi.fn(async (after: string | null) => {
        seen.push(after);
        return batches[index++] ?? [];
      }),
    };
  }

  it('verifies a bounded page per tick and carries its cursor to the next one', async () => {
    const repository = pages(['run-a', 'run-b'], ['run-c']);
    const verified: string[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const verify = vi.fn(async (runId: string) => {
      verified.push(runId);
      if (runId === 'run-c') complete();
    });
    const stop = startEvidenceIntegritySweep(repository, verify, vi.fn(), { intervalMs: 1, page: 2 });
    try {
      await done;
      expect(verified.slice(0, 3)).toEqual(['run-a', 'run-b', 'run-c']);
      // The cursor advances across ticks, so a deployment with more sealed Runs than one
      // page still re-checks every one of them.
      expect(repository.seen.slice(0, 2)).toEqual([null, 'run-b']);
    } finally {
      await stop();
    }
  });

  it('asks for the bounded page a deployment actually gets', async () => {
    // A background job must not borrow a surface's read, and it must not take the whole
    // table either: each Run here reads every registered artifact out of object storage.
    const repository = pages([]);
    const stop = startEvidenceIntegritySweep(repository, vi.fn(), vi.fn(), { intervalMs: 60_000 });
    try {
      expect(repository.verifiableRunIds).toHaveBeenCalledWith(null, EVIDENCE_INTEGRITY_SWEEP_PAGE);
    } finally {
      await stop();
    }
  });

  it('starts again from the beginning when a page runs short', async () => {
    // Every sealed package is re-checked, forever, in rotation. A cursor that stopped at
    // the end would verify each Run exactly once and never notice a later edit.
    const repository = pages(['run-a'], [], ['run-a']);
    const verified: string[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const stop = startEvidenceIntegritySweep(
      repository,
      async (runId) => {
        verified.push(runId);
        if (verified.length === 2) complete();
      },
      vi.fn(),
      { intervalMs: 1, page: 1 },
    );
    try {
      await done;
      expect(repository.seen.slice(0, 3)).toEqual([null, 'run-a', null]);
    } finally {
      await stop();
    }
  });

  it('reports a Run it could not verify and carries on with the rest', async () => {
    // A store that cannot be READ is not proof of tampering — `verifySealedPackage` gets
    // that right and does not write a finding for it — so a throw here is an outage to
    // report, never a reason to stop checking the other Runs.
    const repository = pages(['run-a', 'run-b']);
    const onError = vi.fn();
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const verify = vi.fn(async (runId: string) => {
      if (runId === 'run-a') throw new Error('the store is unreachable');
      complete();
    });
    const stop = startEvidenceIntegritySweep(repository, verify, onError, { intervalMs: 1, page: 2 });
    try {
      await done;
      expect(verify.mock.calls.map(([runId]) => runId)).toEqual(['run-a', 'run-b']);
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
    }
  });

  it('waits for the active verification and starts no more of the page on shutdown', async () => {
    const repository = pages(['run-a', 'run-b']);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const verify = vi.fn(async () => {
      started();
      await held;
    });
    const stop = startEvidenceIntegritySweep(repository, verify, vi.fn(), { intervalMs: 1, page: 2 });
    await active;
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    // The second Run of the selected page was never started.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
  });
});
