/** Poll starts are one second apart while work fits inside that interval. Network,
 * decode and authority-check time consume the interval instead of extending it.
 * Only a settled poll can arm the next timer: slow work never overlaps or builds a
 * catch-up queue. The caller owns outcome presentation and in-flight cancellation.
 */
export function startWorkspacePreviewPolling(poll: () => Promise<void>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    const started = performance.now();
    const settled = () => {
      if (!stopped) timer = setTimeout(run, Math.max(0, 1000 - (performance.now() - started)));
    };
    void poll().then(settled, settled);
  };
  run();
  return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
}
