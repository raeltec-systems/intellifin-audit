import type { Page, Route } from '@playwright/test';

/**
 * Page routes a test can hold requests in, and then remove without losing a request that
 * is still inside its handler.
 *
 * `page.unrouteAll({ behavior: 'wait' })` is not that wait. Playwright 1.62 empties the
 * page's route list FIRST and waits for the running handlers after. The first handler that
 * finishes then finds the list empty and removes the page's interceptor itself
 * (`Page._onRoute`), and the browser side passes every other request still inside a handler
 * straight to the network. That handler's own `fulfill`, `continue` or `abort` then fails
 * with "Route is already handled!". CI met it in `run-controller-lease.spec.ts`: a held
 * control read was still inside `route.fetch()` when the test released its holds.
 *
 * `settle` closes the gate first, so a request that arrives later falls back at once (a
 * fallback answers without waiting, so it can never still be pending). Then it releases the
 * holds, waits until every handler that had started has answered its request, and only
 * then removes the routes. A handler that fails still fails the test.
 */
export interface HeldRoutes {
  /** `page.route`, with every call of the handler tracked for `settle`. */
  route(url: string, handler: (route: Route) => Promise<void>): Promise<void>;
  /** Stop taking requests, run `release`, wait for every started handler, remove the routes. */
  settle(release?: () => void | Promise<void>): Promise<void>;
}

export function heldRoutes(page: Page): HeldRoutes {
  const running = new Set<Promise<void>>();
  let closed = false;
  return {
    async route(url, handler) {
      await page.route(url, async route => {
        if (closed) { await route.fallback(); return; }
        const answer = handler(route);
        running.add(answer);
        try { await answer; } finally { running.delete(answer); }
      });
    },
    async settle(release) {
      closed = true;
      await release?.();
      while (running.size > 0) await Promise.allSettled([...running]);
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}
