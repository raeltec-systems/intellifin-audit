import { expect, test } from '@playwright/test';
import { AUTH_STATE } from './accounts';
import { NEW_PROCEDURE_PREPARING, NEW_PROCEDURE_REQUIRES_JAVASCRIPT, UNKNOWN_CREATE_OUTCOME } from '../../apps/web/src/procedures/new-procedure-words';

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
    await expect(page.getByLabel('Procedure name', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create Procedure', exact: true })).toBeDisabled();
    await expect(page.getByText(NEW_PROCEDURE_PREPARING)).toBeVisible();
    expect(creates).toEqual([]);
    release();
    await expect(page.locator('[data-new-procedure-ready]')).toHaveAttribute('data-new-procedure-ready', 'true');
    await page.getByLabel('Template', { exact: true }).selectOption('P-1');
    await expect(page.getByLabel('Procedure name', { exact: true })).toHaveValue('Terminated Users Retaining Access');
    await expect(page.locator('[data-template-preview]')).toBeVisible();
    await page.getByLabel('Procedure name', { exact: true }).fill('Hydration acceptance control');
    expect(creates).toEqual([]);
    // UX-07 (2026-09-22): Create is ONE action now, so the click sends the request with no
    // dialog in between. The decisive assertion is what was SENT (the 2026-09-17 rule):
    // the typed Template and name, not React's initial empty state. The request is held
    // at the network and never reaches the server, so nothing is created, and the form
    // then says honestly that the outcome is unknown.
    let sent = '';
    await page.route('**/procedures/new', async route => {
      if (route.request().method() !== 'POST') { await route.fallback(); return; }
      sent = route.request().postData() ?? '';
      await route.abort();
    });
    await page.getByRole('button', { name: 'Create Procedure', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => sent).toContain('Hydration acceptance control');
    expect(sent).toContain('P-1');
    await expect(page.locator('.ls-banner--warning')).toContainText(UNKNOWN_CREATE_OUTCOME);
    await expect(page.getByLabel('Template', { exact: true })).toHaveValue('P-1');
    await expect(page.getByLabel('Procedure name', { exact: true })).toHaveValue('Hydration acceptance control');
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
