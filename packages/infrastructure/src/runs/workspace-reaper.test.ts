import { describe, expect, it } from 'vitest';

import { WORKSPACE_REAPER_PAGE, startWorkspaceReaper } from './workspace-reaper.js';

/**
 * The reaper's loop, over a fake read.
 *
 * `tests/integration/agent-workspace.test.ts` proves the READ — that it selects a workspace
 * whose Run has ended and not one whose Run can still act — against PostgreSQL. What is
 * pinned here is the loop: bounded, rotating, and stopping without abandoning the release
 * it is in the middle of.
 */

const NEVER = 3_600_000;

function pages(...batches: string[][]): {
  reapableRunIds: (after: string | null, limit: number) => Promise<string[]>;
  calls: { after: string | null; limit: number }[];
} {
  const calls: { after: string | null; limit: number }[] = [];
  let index = 0;
  return {
    calls,
    reapableRunIds: async (after, limit) => {
      calls.push({ after, limit });
      return batches[index++] ?? [];
    },
  };
}

describe('the Agent Workspace reaper', () => {
  it('takes a bounded page and releases each Run in it, once', async () => {
    const read = pages(['run-1', 'run-2']);
    const released: string[] = [];
    const stop = startWorkspaceReaper(
      read,
      async (runId) => {
        released.push(runId);
      },
      () => undefined,
      { intervalMs: NEVER },
    );
    // The first tick starts synchronously but its read is a promise, and `stop()` wins the
    // moment it is called — deliberately, so a shutdown starts none of a selected page.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await stop();
    expect(released).toEqual(['run-1', 'run-2']);
    expect(read.calls).toEqual([{ after: null, limit: WORKSPACE_REAPER_PAGE }]);
  });

  it('carries the cursor forward on a full page and starts over on a short one', async () => {
    const read = pages(['a', 'b'], ['c']);
    const stop = startWorkspaceReaper(read, async () => undefined, () => undefined, {
      intervalMs: 1,
      page: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await stop();
    expect(read.calls[0]).toEqual({ after: null, limit: 2 });
    // A full page continues from its last id; a short page is the end of the rotation, so
    // the next tick starts again rather than parking the cursor past everything behind it.
    expect(read.calls[1]).toEqual({ after: 'b', limit: 2 });
    expect(read.calls[2]).toEqual({ after: null, limit: 2 });
  });

  it('keeps releasing the rest of a page when one workspace cannot be given back', async () => {
    const read = pages(['run-1', 'run-2', 'run-3']);
    const released: string[] = [];
    let errors = 0;
    const stop = startWorkspaceReaper(
      read,
      async (runId) => {
        if (runId === 'run-2') throw new Error('provider unreachable');
        released.push(runId);
      },
      () => {
        errors += 1;
      },
      { intervalMs: NEVER },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await stop();
    expect(released).toEqual(['run-1', 'run-3']);
    expect(errors).toBe(1);
  });

  it('lets the active release finish and starts none of the rest', async () => {
    const read = pages(['run-1', 'run-2', 'run-3']);
    const released: string[] = [];
    let finish: (() => void) | undefined;
    const stop = startWorkspaceReaper(
      read,
      async (runId) => {
        released.push(runId);
        if (runId === 'run-1') await new Promise<void>((resolve) => (finish = resolve));
      },
      () => undefined,
      { intervalMs: NEVER },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stopping = stop();
    finish?.();
    await stopping;
    // The one in flight completed; the two behind it were never started.
    expect(released).toEqual(['run-1']);
  });

  it('never runs two ticks at once', async () => {
    const read = pages(['run-1'], ['run-2']);
    let inFlight = 0;
    let overlapped = false;
    const stop = startWorkspaceReaper(
      read,
      async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
      },
      () => undefined,
      { intervalMs: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    await stop();
    expect(overlapped).toBe(false);
  });
});
