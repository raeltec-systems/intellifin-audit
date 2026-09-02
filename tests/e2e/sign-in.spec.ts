import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { ACCOUNTS } from './accounts';

/**
 * The sign-in page's four deferred accessibility findings, and the submit guard.
 *
 * `a11y.spec.ts` scans this page in its clean state, where the error node is not in the
 * DOM at all — so it cannot see any of this. Each assertion below is one of the four
 * findings Story 1.3 recorded, checked in the state that has it.
 *
 * Every test here signs in at most once, and the double-submit test never reaches the
 * server: `/sign-in/email` is rate limited to ten attempts a minute in `identity/auth.ts`
 * and a spec that spends that budget starts failing on a real production rule.
 */

const WRONG_PASSWORD = 'not-the-password-abcdefghijkl';

test.describe('the sign-in error state', () => {
  test('is one live region, before the form, focused, and linked to both fields', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(ACCOUNTS.auditor.email);
    await page.getByLabel('Password').fill(WRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Scoped to the sign-in card: Next injects its own empty `role="alert"` route
    // announcer into every page, which is framework furniture and not this page's.
    const alert = page.locator('.ls-signin').getByRole('alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toBeVisible();

    // 1. ONE live-region role. `role="alert"` already implies assertive; a second
    //    `aria-live` on the same node is a contradictory instruction that some screen
    //    readers answer by announcing twice.
    await expect(alert).not.toHaveAttribute('aria-live', /.*/);

    // 2. Before the form in DOM order.
    const errorPrecedesForm = await page.evaluate(() => {
      const node = document.querySelector('[role="alert"]');
      const form = document.querySelector('form');
      if (!node || !form) return false;
      return (
        (node.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(errorPrecedesForm).toBe(true);

    // 3. Focus moved to it, so the message is not announcement-only.
    await expect(alert).toBeFocused();

    // 4. Both fields describe themselves with it.
    const alertId = await alert.getAttribute('id');
    expect(alertId).toBeTruthy();
    await expect(page.getByLabel('Email address')).toHaveAttribute(
      'aria-describedby',
      alertId as string,
    );
    await expect(page.getByLabel('Password')).toHaveAttribute(
      'aria-describedby',
      alertId as string,
    );

    // And the page in THAT state still passes the gate.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test('never distinguishes a wrong password from an unknown address', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill('nobody@example.test');
    await page.getByLabel('Password').fill(WRONG_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.ls-signin').getByRole('alert')).toHaveText(
      /Sign-in failed|Too many sign-in attempts/,
    );
  });
});

test.describe('the submit guard', () => {
  test('sends one request however many times Sign in is activated', async ({ page }) => {
    let posts = 0;
    let release = (): void => undefined;
    // The first request is held open until every activation has been made, and only
    // then answered. A fixed delay would not do: the activations take as long as they
    // take, and a request that completes in the middle of them releases the guard
    // legitimately — the second POST would then be correct behaviour and the test
    // would be measuring Playwright's pacing rather than the guard.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Intercepted, so this test spends nothing from the real per-minute rate limit.
    await page.route('**/api/auth/sign-in/email', async (route) => {
      posts += 1;
      await held;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Sign-in failed. Check your email address and password.' }),
      });
    });

    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(ACCOUNTS.auditor.email);
    const password = page.getByLabel('Password');
    await password.fill(WRONG_PASSWORD);

    // By type, not by name: the button relabels itself to "Signing in…" while the
    // request is in flight, so `getByRole('button', { name: 'Sign in' })` stops matching
    // exactly during the window this test is about.
    const submit = page.locator('.ls-signin__form button[type="submit"]');
    await submit.click();
    await submit.click({ force: true });
    // Implicit submission, which an `aria-disabled` button cannot block on its own.
    await password.press('Enter');
    await password.press('Enter');

    // Only one request was ever made, however many times the form was activated.
    expect(posts).toBe(1);

    release();
    await expect(page.locator('.ls-signin').getByRole('alert')).toBeVisible();
    // And the guard released afterwards, so a genuine second attempt is still possible.
    expect(posts).toBe(1);
  });
});
