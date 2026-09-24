import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** AW-P0 design proof only. These tests intentionally do not claim domain/worker proof. */
const prototype = pathToFileURL(resolve('docs/prototypes/auditor-workspace/index.html')).href;

test.describe('AW-P0 interactive screen designs', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    for (const state of ['active', 'decision', 'findings']) {
      test(`${state} is usable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize(viewport);
        await page.goto(`${prototype}?state=${state}`);
        await expect(page).toHaveTitle('Auditor Workspace · P0 design preview');
        await expect(page.getByRole('heading', { name: 'Leavers’ access review' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (state !== 'findings') {
          const stage = await page.getByRole('region', { name: 'Agent workspace', exact: true }).boundingBox();
          const composer = await page.getByRole('textbox', { name: /Question context/ }).boundingBox();
          expect(stage).not.toBeNull();
          expect(composer).not.toBeNull();
          expect(stage!.y).toBeLessThan(viewport.height / 2);
          expect(composer!.y + composer!.height).toBeLessThanOrEqual(viewport.height);
          await expect(page.getByText('Synthetic screen specimen for layout review.', { exact: false })).toBeVisible();
          if (state === 'decision') await expect(page.getByRole('heading', { name: 'Which account matches this record?' })).toBeVisible();
        } else {
          await expect(page.getByRole('region', { name: 'Record inspector' })).toContainText('What the approved test expected');
          await expect(page.getByText('Not loaded', { exact: true })).toBeVisible();
        }
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(axe.violations).toEqual([]);
        expect(errors).toEqual([]);
        const screenshot = testInfo.outputPath(`aw-p0-${state}-${viewport.width}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`aw-p0-${state}-${viewport.width}`, { path: screenshot, contentType: 'image/png' });
      });
    }
  }

  test('decision stays contextual and historical answer is inert', async ({ page }) => {
    await page.goto(`${prototype}?state=decision`);
    await expect(page.getByRole('button', { name: 'Use this candidate', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: 'j.mwale · Employee ID E-000103', exact: true }).check();
    await page.getByRole('button', { name: 'Use this candidate', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('E-000103');
    await expect(page.getByRole('dialog')).toContainText('It does not confirm an assessment');
    await page.getByRole('dialog').getByRole('button', { name: 'Use this candidate', exact: true }).click();
    await expect(page.locator('#request')).toBeHidden();
    await expect(page.locator('#history')).toContainText('no runtime wait was closed');
    await expect(page.locator('#history').getByRole('button', { name: 'Use this candidate' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Agent workspace', exact: true })).toBeVisible();
  });

  test('requested pause and applied fixture boundary are distinct', async ({ page }) => {
    await page.goto(prototype);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#run-state')).toHaveText('Pausing after current action');
    await expect(page.locator('#history')).toContainText('The agent is not yet paused');
    await page.getByRole('button', { name: 'Apply fixture boundary' }).click();
    await expect(page.locator('#run-state')).toHaveText('Paused');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  });

  test('no substring commands; question context survives selected evidence', async ({ page }) => {
    await page.goto(`${prototype}?state=findings`);
    await page.getByRole('button', { name: /E-000102.*LoanCore/ }).click();
    await page.getByRole('button', { name: 'Ask about this record' }).click();
    const composer = page.getByRole('textbox', { name: /Question context/ });
    await expect(composer).toHaveAccessibleName(/E-000102.*Execution remains E-000103/);
    await composer.fill('Do not pause now');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#run-state')).not.toHaveText('Pausing after current action');
    await expect(page.locator('#history')).toContainText('does not interpret arbitrary instructions');
  });

  test('opening capture is not a review; record links select a read-only replay', async ({ page }) => {
    await page.goto(`${prototype}?state=findings`);
    await page.getByRole('button', { name: 'Open account capture' }).click();
    await expect(page.locator('#evidence-state')).toHaveText('Loaded specimen · No integrity verification claimed');
    await expect(page.locator('#review-receipt')).toHaveText('Original agent proposal is preserved.');
    await expect(page.locator('#pending')).toHaveText('2');
    await page.getByRole('button', { name: 'Replay this inspection' }).click();
    await expect(page.locator('#view-label')).toHaveText('Replay · Workspace released · Read-only');
    await expect(page.locator('#replay-position')).toHaveText('Selected inspection · E-000103');
    await expect(page.locator('#fact-record')).toHaveText('E-000103');
  });

  test('draft, divider and filter survive reload without claiming server persistence', async ({ page }) => {
    await page.goto(prototype);
    const composer = page.getByRole('textbox', { name: /Question context/ });
    await composer.fill('Synthetic draft for layout testing');
    await page.getByRole('separator', { name: 'Conversation pane width' }).press('ArrowRight');
    await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '42');
    await page.reload();
    await expect(composer).toHaveValue('Synthetic draft for layout testing');
    await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '42');
    await page.getByRole('tab', { name: 'Records & findings' }).click();
    await page.getByRole('combobox', { name: 'Filter records' }).selectOption('uninspected');
    await expect(page.locator('#page-status')).toContainText('approved population still contains 3');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Filter records' })).toHaveValue('uninspected');
  });

  test('focus, native size and narrow read-only state', async ({ page }) => {
    await page.goto(prototype);
    await page.getByRole('button', { name: 'Expand workspace' }).click();
    await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '100% size' }).click();
    expect((await page.locator('#target-screen').boundingBox())!.width).toBe(1100);
    await page.getByRole('button', { name: 'Fit to pane' }).click();
    await page.getByRole('button', { name: 'Return to split view' }).click();
    await page.setViewportSize({ width: 720, height: 450 }); // 1440px viewport equivalent at 200% browser zoom.
    await expect(page.getByText('Desktop supervision is required', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
