/** UI-only budget: back off to ten seconds and stop automatic refresh after two minutes. */
export const PLAN_POLL_BUDGET_MS = 120000;
const DELAYS = [1500, 3000, 6000, 10000] as const;

export function startPlanPolling(refresh: () => void, prolonged: () => void): () => void {
  const startedAt = Date.now();
  let cycle = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  function schedule(): void {
    const remaining = PLAN_POLL_BUDGET_MS - (Date.now() - startedAt);
    timer = setTimeout(() => {
      if (stopped) return;
      if (Date.now() - startedAt >= PLAN_POLL_BUDGET_MS) { prolonged(); return; }
      refresh();
      cycle += 1;
      schedule();
    }, Math.min(DELAYS[Math.min(cycle, DELAYS.length - 1)]!, Math.max(0, remaining)));
  }
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}
