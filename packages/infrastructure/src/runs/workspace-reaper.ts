/**
 * The Agent Workspace reaper (Story 4.1, NFR-5).
 *
 * A workspace is released at the Run's terminal transition by the worker that was carrying
 * that Run — but a release is network I/O and a transaction cannot be held across it, so
 * "released at the Run's end" cannot be a step inside the transaction that ends the Run.
 * A worker that dies between the two leaves a browser held by nobody, and a Solari session
 * holds its pool slot until the provider's own grace timer reaps it. This is the backstop
 * that makes the guarantee true rather than usual.
 *
 * The THIRD sweep of an existing shape, not a new pattern: its own read, a bounded page per
 * tick, one Run at a time, and a stop that lets the active release finish and starts none
 * of the rest — exactly `startEvidenceIntegritySweep` and the Target System probe runner.
 * A background job must not borrow a surface's read; the probe sweep that borrowed
 * `listRegistrations` probed nothing while exiting 0 (Story 1.8).
 *
 * What a release MEANS is `releaseWorkspace`'s and is not re-decided here. In particular a
 * workspace whose Run is still running is not reaped: the read never selects one, and the
 * command refuses one it is handed anyway.
 */

/** The sweep's own read of the workspaces it may reap. A keyset page, ordered by Run id. */
export interface ReapableWorkspaces {
  reapableRunIds(after: string | null, limit: number): Promise<string[]>;
}

/**
 * How many Runs one tick releases.
 *
 * Each release is a provider round trip, so the page is a cost as well as a bound — the
 * same reasoning that makes the Evidence integrity sweep's page ten rather than a hundred.
 */
export const WORKSPACE_REAPER_PAGE = 10;

/** How often a page is taken, when the caller does not say. */
const DEFAULT_INTERVAL_MS = 60_000;

export interface WorkspaceReaperOptions {
  readonly intervalMs?: number;
  /** Test seam. Production takes `WORKSPACE_REAPER_PAGE`, which is the bound. */
  readonly page?: number;
}

export function startWorkspaceReaper(
  repository: ReapableWorkspaces,
  release: (runId: string) => Promise<unknown>,
  onError: () => void,
  options: WorkspaceReaperOptions = {},
): () => Promise<void> {
  const size = options.page ?? WORKSPACE_REAPER_PAGE;
  // The cursor lives for the life of the process and resets on restart, exactly as the
  // Evidence integrity sweep's does. A released workspace leaves the selected set, so the
  // rotation drains rather than repeating; starting over on a short page is what stops a
  // row that failed to release from parking the cursor past everything behind it.
  let after: string | null = null;
  let pending: Promise<void> | undefined;
  let stopping = false;
  const tick = (): void => {
    if (pending || stopping) return;
    pending = (async () => {
      const page = await repository.reapableRunIds(after, size);
      after = page.length < size ? null : (page[page.length - 1] ?? null);
      for (const runId of page) {
        if (stopping) break;
        try {
          await release(runId);
        } catch {
          // One workspace this process cannot give back is not a reason to stop giving
          // back the others. The row stays as it is and the next rotation tries again.
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
  // The active release is bounded by its own timeout. Do not start any more of the
  // selected page while shutdown waits for that one.
  return async () => {
    stopping = true;
    clearInterval(timer);
    await pending;
  };
}
