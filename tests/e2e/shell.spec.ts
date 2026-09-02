import { expect, test } from '@playwright/test';

import { AUTH_STATE } from './accounts';

/**
 * The shell's behavioural rules, in a real browser.
 *
 * Four things are checked here that no unit test can check: what a role sees in the
 * nav, what the server does when somebody types the path anyway, whether a keyboard
 * alone can traverse the shell with a visible ring, and whether the layout collapses
 * rather than clipping below 1024px.
 */

/** The exact sentence `packages/domain/src/identity/roles.ts` gives for an unspecified cell. */
const DEFAULT_DENIAL_REASON = 'Your role does not permit this action.';

test.describe('as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the sidebar shows four items and no Administration', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Overview', 'Procedures', 'Runs', 'Review']);
    await expect(nav.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  });

  test('typing /administration is refused by the server', async ({ page }) => {
    await page.goto('/administration');

    // The refusal names the reason the domain policy gives, verbatim.
    await expect(page.getByRole('alert')).toHaveText(DEFAULT_DENIAL_REASON);
    // And no administration content reaches the browser at all.
    await expect(page.getByText('Target System registrations')).toHaveCount(0);
    await expect(page.getByText('Nothing is registered yet.')).toHaveCount(0);
  });

  test('the environment ribbon carries the DESIGN.md sentence verbatim', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByText(
        'Synthetic PoC environment — Population Sources and Target Systems are read-only synthetic systems. Results are not assurance conclusions.',
      ),
    ).toBeVisible();
  });

  test('the active item follows the route, and a list gets no breadcrumb', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Runs' }).click();
    await expect(page.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  });

  test('the skip link is the first stop and jumps to the content', async ({ page }) => {
    await page.goto('/');
    // No click first: sequential focus navigation starts from the clicked element, and
    // a click anywhere in the page would start the walk past the skip link, which is
    // deliberately the very first thing in the document.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#content$/);
  });
});

test.describe('as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('the sidebar additionally shows Administration', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText([
      'Overview',
      'Procedures',
      'Runs',
      'Review',
      'Administration',
    ]);
  });

  test('the Administration surface is reachable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Administration' }).click();
    await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
    await expect(page.getByText('Nothing is registered yet.')).toBeVisible();
  });

  test('every nav item is reachable by Tab and shows the #0F766E focus ring', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    const reached = new Set<string>();
    const ringFailures: string[] = [];

    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        return {
          text: (element.textContent ?? '').trim(),
          inNav: element.closest('.ls-sidebar__nav') !== null,
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      if (!focused) continue;

      // #0F766E, and never suppressed.
      if (
        focused.outlineColor !== 'rgb(15, 118, 110)' ||
        focused.outlineStyle === 'none' ||
        Number.parseFloat(focused.outlineWidth) < 2
      ) {
        ringFailures.push(
          `${focused.text}: ${focused.outlineStyle} ${focused.outlineWidth} ${focused.outlineColor}`,
        );
      }
      if (focused.inNav) reached.add(focused.text.split('\n')[0]?.trim() ?? '');
      if (reached.size === 5) break;
    }

    expect(ringFailures, ringFailures.join(' | ')).toEqual([]);
    expect([...reached].sort()).toEqual([
      'Administration',
      'Overview',
      'Procedures',
      'Review',
      'Runs',
    ]);
  });
});

test.describe('the confirmation dialog', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('traps focus, closes on Escape, and restores focus to the invoking control', async ({
    page,
  }) => {
    await page.goto('/badges');

    const invoker = page.getByRole('button', { name: 'Routine', exact: true });
    await invoker.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Initial focus is Cancel, never the confirm button: the dialog never auto-confirms.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Tab all the way round; focus never leaves the dialog.
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside, `focus escaped the dialog after ${step + 1} tabs`).toBe(true);
    }
    // And backwards.
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside, `focus escaped the dialog after ${step + 1} back-tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(invoker).toBeFocused();
  });

  test('a rationale dialog refuses an empty rationale', async ({ page }) => {
    await page.goto('/badges');

    await page.getByRole('button', { name: 'Routine with rationale' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Rationale')).toBeFocused();

    await dialog.getByRole('button', { name: 'Reject evaluation' }).click();
    await expect(dialog.getByText('A rationale is required.')).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Rationale').fill('The identity match is not corroborated.');
    await dialog.getByRole('button', { name: 'Reject evaluation' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('the disabled-action rule', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('an unavailable action keeps its position and states its reason twice', async ({ page }) => {
    await page.goto('/badges');

    const button = page.getByRole('button', { name: 'Approve version' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-disabled', 'true');

    // Its accessible description is the SAME node the panel shows, not a second copy.
    const describedBy = await button.getAttribute('aria-describedby');
    expect(describedBy).toBe('unavailable-approve-version');
    await expect(page.locator('#unavailable-approve-version')).toContainText(
      'Only an Audit Manager can approve a Procedure Version.',
    );
  });
});

test.describe('breakpoints', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the sidebar sits beside the content at 1440px and above it below 1024px', async ({
    page,
  }) => {
    await page.goto('/');

    const sidebar = page.locator('.ls-sidebar');
    const content = page.locator('main#content');

    await page.setViewportSize({ width: 1440, height: 900 });
    const wideSidebar = await sidebar.boundingBox();
    const wideContent = await content.boundingBox();
    expect(wideSidebar).not.toBeNull();
    expect(wideContent).not.toBeNull();
    // Side by side: the rail ends where the column begins.
    expect((wideSidebar?.x ?? 0) + (wideSidebar?.width ?? 0)).toBeLessThanOrEqual(
      (wideContent?.x ?? 0) + 1,
    );
    expect(wideSidebar?.width).toBe(240);

    await page.setViewportSize({ width: 900, height: 900 });
    const narrowSidebar = await sidebar.boundingBox();
    const narrowContent = await content.boundingBox();
    // Stacked: the rail ends above the content, and nothing is clipped horizontally.
    expect((narrowSidebar?.y ?? 0) + (narrowSidebar?.height ?? 0)).toBeLessThanOrEqual(
      (narrowContent?.y ?? 0) + 1,
    );
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);

    // Every nav item is still reachable.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(4);
  });
});
