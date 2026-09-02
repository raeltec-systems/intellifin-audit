import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { AUTH_STATE } from './accounts';

/**
 * The WCAG 2.1 AA gate (NFR-11).
 *
 * Three targets: the shell with an empty Overview inside it, the badge gallery with
 * every state in the vocabulary plus one live instance of each component, and the
 * sign-in page — which is outside the shell and carries the four accessibility findings
 * Story 1.3 deferred to this story.
 *
 * A violation fails the run, and the run gates the pull request. There is no allowlist
 * of accepted violations on purpose: the first one added is the last one anybody looks
 * at.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // Report the rule and the node, so a failure names what to fix, not just a count.
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

test.describe('WCAG 2.1 AA — signed out', () => {
  test('the sign-in page has no violations', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await scan(page);
  });
});

test.describe('WCAG 2.1 AA — signed in', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the shell and the empty Overview have no violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // Both verbatim empty-state sentences are on the page being scanned.
    await expect(page.getByText('An empty Overview does not mean a control passed.')).toBeVisible();
    await scan(page);
  });

  test('the shell with the notifications panel open has no violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByText('No Run is waiting on you.')).toBeVisible();
    await scan(page);
  });

  test('the badge gallery has no violations', async ({ page }) => {
    await page.goto('/badges');
    await expect(page.getByRole('heading', { name: 'Status vocabulary', level: 1 })).toBeVisible();
    await scan(page);
  });

  test('an open confirmation dialog has no violations', async ({ page }) => {
    await page.goto('/badges');
    await page.getByRole('button', { name: 'Routine', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page);
  });
});
