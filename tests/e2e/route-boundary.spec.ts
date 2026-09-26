import { captureStoryState } from './story-visual-capture';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { USER_FILTER_SUBMIT } from '../../apps/web/src/admin/administration-words';
import { NOTHING_CHANGED_CLAIM } from '../../apps/web/src/design/nothing-changed';
import { ROUTE_BOUNDARY_COPY } from '../../apps/web/src/design/route-boundary-words';
import { AUTH_STATE } from './accounts';

/**
 * The route boundary on a page that shows no Run (Story 10.8 review, P2 and P10).
 *
 * `flag-run.spec.ts` reaches the boundary on a Run page. This reaches its OTHER variant, the
 * way a reader really would: a Server Action whose form action is the action itself, on a
 * page outside `/runs`, whose response never arrives. The Users search is that form, and it
 * is safe to break — it reads and redirects, and changes nothing — which is why it is the
 * one used here.
 *
 * The page is opened on an address WITH a query, so the boundary's one control is proven to
 * keep it: a reload of a filtered list is not the unfiltered list.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('the route boundary on a page with no Run', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('names no Run, keeps the query in its reload link, and passes WCAG 2.1 AA', async ({ page }) => {
    test.setTimeout(120_000);
    const address = '/administration/users?q=route-boundary-check';
    await page.goto(address);
    const form = page.locator('form.ls-admin-filter');
    await expect(form).toBeVisible();
    // Wait until React has attached to the form: before that a submission is the browser's
    // own POST navigation, which an aborted request turns into the browser's error page
    // rather than into this boundary.
    await page.waitForFunction(() => {
      const element = document.querySelector('form.ls-admin-filter');
      return element !== null && Object.keys(element).some((key) => key.startsWith('__reactFiber$'));
    });

    // The Server Action posts to the page's own address; its response is dropped.
    const users = (url: URL): boolean => url.pathname === '/administration/users';
    let aborted = 0;
    await page.route(users, async (route) => {
      if (route.request().method() !== 'POST') { await route.fallback(); return; }
      aborted += 1;
      await route.abort('failed');
    });
    await form.getByRole('button', { name: USER_FILTER_SUBMIT, exact: true }).click();

    await expect(page.getByRole('heading', { name: ROUTE_BOUNDARY_COPY.heading, level: 1 })).toBeVisible();
    await page.unroute(users);
    expect(aborted).toBeGreaterThan(0);

    // The sentence for a page with no Run: it names nothing that is not there, and it never
    // says whether anything changed.
    await expect(page.getByRole('alert').filter({ hasText: ROUTE_BOUNDARY_COPY.other })).toBeVisible();
    await expect(page.getByText(ROUTE_BOUNDARY_COPY.run)).toHaveCount(0);
    await expect(page.getByText(ROUTE_BOUNDARY_COPY.body)).toBeVisible();
    await expect(page.getByText(NOTHING_CHANGED_CLAIM)).toHaveCount(0);

    // The one control is a plain link to this page's own address, query included.
    const reload = page.getByRole('link', { name: ROUTE_BOUNDARY_COPY.reload });
    await expect(reload).toHaveAttribute('href', address);
    await captureStoryState(page, 'route-boundary-other');

    await expect(page).toHaveTitle(/.+/);
    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);

    // Following it reads the page again, filtered as it was.
    await reload.click();
    await expect(page.getByRole('heading', { name: ROUTE_BOUNDARY_COPY.heading, level: 1 })).toHaveCount(0);
    await expect(page.locator('form.ls-admin-filter input[name="q"]')).toHaveValue('route-boundary-check');
    expect(new URL(page.url()).search).toBe('?q=route-boundary-check');
  });
});
