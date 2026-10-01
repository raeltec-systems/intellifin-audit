import { expect, test } from '@playwright/test';
import { startRuntime } from './runtime';

test('real database loss is unavailable, then keyboard refresh restores Ready', async ({ page }, testInfo) => {
  const runtime = await startRuntime();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Chromium reports the intentionally verified HTTP 503 as a resource error.
    if (['error', 'warning'].includes(message.type()) &&
      !/Failed to load resource: the server responded with a status of 503/.test(message.text())) {
      errors.push(message.text());
    }
  });

  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(name);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };

  try {
    await page.goto(`${runtime.url}/status`);
    await expect(page).toHaveTitle('Zobba · Pair');
    await expect(page.getByRole('heading', { name: 'Connection status', level: 1 })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    const statuses = page.locator('.status-label');
    const refresh = page.getByRole('button', { name: 'Check again' });
    await expect(statuses).toHaveText(['Responding', 'Ready']);
    await expect(refresh).toHaveAttribute('aria-disabled', 'false');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('img').evaluateAll((images) => images.every((image) =>
      image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('15px "Hanken Grotesk"'))).toBe(true);
    await screenshot('ready-desktop.png');

    runtime.disconnectDatabase();
    await refresh.focus();
    const unavailableResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/health/ready' && response.status() === 503);
    await page.keyboard.press('Enter');
    const response = await unavailableResponse;
    expect(await response.json()).toEqual({ service: 'api', status: 'unavailable', schema_version: null });
    await expect(statuses).toHaveText(['Responding', 'Unavailable']);
    await expect(page.getByText('The workspace connection is unavailable.', { exact: false })).toBeVisible();
    await expect(refresh).toHaveAttribute('aria-disabled', 'false');
    await expect(refresh).toBeFocused();
    await screenshot('unavailable-desktop.png');

    runtime.restoreDatabase();
    const restoredResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/health/ready' && response.status() === 200);
    await page.keyboard.press('Enter');
    expect(await (await restoredResponse).json()).toEqual({ service: 'api', status: 'ready', schema_version: 6 });
    await expect(statuses).toHaveText(['Responding', 'Ready']);
    await expect(page.locator('.connection-help')).toHaveCount(0);
    await expect(refresh).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(statuses).toHaveText(['Responding', 'Ready']);
    await expect(refresh).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot('restored-mobile.png');
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});
