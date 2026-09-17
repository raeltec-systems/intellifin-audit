import { expect, test } from '@playwright/test';
import { AUTH_STATE } from './accounts';
import { NEW_PROCEDURE_PREPARING, NEW_PROCEDURE_REQUIRES_JAVASCRIPT } from '../../apps/web/src/procedures/new-procedure-words';

test.use({ storageState: AUTH_STATE.auditor });

test('slow hydration cannot discard the first Template choice', async ({ page }) => {
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  const creates: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/procedures/new') creates.push(request.url());
  });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'script') await scripts;
    await route.continue();
  });
  try {
    await page.goto('/procedures/new', { waitUntil: 'commit' });
    await expect(page.getByLabel('Template', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Template', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Control name', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create Procedure', exact: true })).toBeDisabled();
    await expect(page.getByText(NEW_PROCEDURE_PREPARING)).toBeVisible();
    expect(creates).toEqual([]);
    release();
    await expect(page.locator('[data-new-procedure-ready]')).toHaveAttribute('data-new-procedure-ready', 'true');
    await page.getByLabel('Template', { exact: true }).selectOption('P-1');
    await expect(page.getByLabel('Control name', { exact: true })).toHaveValue('Terminated Users Retaining Access');
    await expect(page.locator('[data-template-preview]')).toBeVisible();
    await page.getByLabel('Control name', { exact: true }).fill('Hydration acceptance control');
    await page.getByRole('button', { name: 'Create Procedure', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Terminated Users Retaining Access');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Template', { exact: true })).toHaveValue('P-1');
    await expect(page.getByLabel('Control name', { exact: true })).toHaveValue('Hydration acceptance control');
    expect(creates).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('without JavaScript the form remains unavailable and states the requirement', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: AUTH_STATE.auditor, baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/procedures/new');
    // Chromium's javaScriptEnabled:false stops script EXECUTION and leaves the parser's
    // scripting flag on, so `<noscript>` children stay raw text no locator can see. The
    // form therefore states the requirement in ordinary markup, which is also what a
    // reader whose scripts failed to load gets.
    await expect(page.getByText(NEW_PROCEDURE_REQUIRES_JAVASCRIPT)).toBeVisible();
    await expect(page.getByLabel('Template', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create Procedure', exact: true })).toBeDisabled();
  } finally { await context.close(); }
});
