import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { AUTH_STATE } from './accounts';
import {
  createRecordReviewBrowserFixture,
  type RecordReviewBrowserFixture,
} from '../fixtures/record-review-browser';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let fixture: RecordReviewBrowserFixture;

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

function queue(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Records and findings', exact: true });
}

function rows(page: Page): ReturnType<Page['locator']> {
  return queue(page).locator('ol[aria-label="Record review queue"] > li');
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await createRecordReviewBrowserFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

test.describe('Record Review through the authenticated application', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('keeps the real queue and inspector bounded, searchable, and cursor-stable', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    // The first page is the meaningful queue: it is populated by the persisted Source
    // rows and contains the captured Exception that the search/filter path will find.
    await page.goto(`/runs/${fixture.runId}/evidence`);
    await expect(queue(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(25);
    await expect(queue(page).getByText('51 shown', { exact: true })).toBeVisible();
    await expect(queue(page).getByRole('link', { name: 'Next page', exact: true })).toBeVisible();
    await attachScreenshot(page, testInfo, 'record-review-queue-1440x900');
    await scan(page);

    // Search and filter use a normal GET form. That keeps the query part of the URL and
    // means a reload can prove the same list context without client-side state.
    await queue(page).getByLabel('Search records').fill(fixture.searchTerm);
    await queue(page).getByLabel('Filter').selectOption('exceptions');
    await queue(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(queue(page)).toBeVisible();
    const filteredUrl = new URL(page.url());
    expect(filteredUrl.searchParams.get('search')).toBe(fixture.searchTerm);
    expect(filteredUrl.searchParams.get('filter')).toBe('exceptions');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByRole('heading', { name: fixture.searchTerm, exact: true })).toBeVisible();
    await expect(rows(page).first()).toContainText('Exception');
    await scan(page);

    // The selected source ordinal is carried alongside the list query. The inspector is
    // reading Observation, frozen condition and registered Evidence metadata from the DB.
    await rows(page).first().getByRole('link', { name: 'Review evidence', exact: true }).click();
    const selectedUrl = page.url();
    const selected = new URL(selectedUrl);
    expect(selected.searchParams.get('selected')).toBe(String(fixture.primaryOrdinal));
    expect(selected.searchParams.get('filter')).toBe('exceptions');
    expect(selected.searchParams.get('search')).toBe(fixture.searchTerm);
    const inspector = page.getByRole('region', { name: 'Record inspector', exact: true });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { name: fixture.searchTerm, exact: true })).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'What was captured', exact: true })).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Supporting evidence', exact: true })).toBeVisible();
    await expect(inspector.getByText('1 item recorded', { exact: true })).toBeVisible();
    const evidenceLink = inspector.getByRole('link', { name: 'Open recorded page data', exact: true });
    await expect(evidenceLink).toBeVisible();
    await expect(evidenceLink).toHaveAttribute('href', /\/runs\/[^/]+\/evidence\/[^/?]+\?locator=/);
    await evidenceLink.click();
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot', exact: true })).toBeVisible();
    // This queue fixture registers Evidence metadata but intentionally does not fabricate
    // object-store bytes. The protected route must surface its typed unavailable state,
    // rather than implying that a metadata row is a readable artifact.
    await expect(page.getByText('The stored snapshot could not be made available before its read window closed.', { exact: true })).toBeVisible();
    await expect(page.locator('.ls-untrusted')).toHaveCount(0);
    await page.goto(selectedUrl);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { name: fixture.searchTerm, exact: true })).toBeVisible();
    await attachScreenshot(page, testInfo, 'record-review-inspector-1440x900');
    await scan(page);

    // The same URL is request state, so both the filter and the selected inspector survive
    // a full document reload. Capture the narrow desktop proof at the requested viewport.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await expect(page).toHaveURL(selectedUrl);
    await expect(inspector.getByRole('heading', { name: fixture.searchTerm, exact: true })).toBeVisible();
    await expect(queue(page).getByLabel('Search records')).toHaveValue(fixture.searchTerm);
    await expect(queue(page).getByLabel('Filter')).toHaveValue('exceptions');
    await expect(inspector).toBeVisible();
    await attachScreenshot(page, testInfo, 'record-review-inspector-1280x800');
    await scan(page);

    // Request a fifty-row immutable list, move to the second page, then add durable
    // Observation progress. The cursor still returns the old row-51 projection and names
    // the newer progress as available; a separate Refresh is required to mint a new list.
    await queue(page).getByLabel('Search records').fill('');
    await queue(page).getByLabel('Filter').selectOption('all');
    await queue(page).getByLabel('Rows per page').selectOption('50');
    await queue(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(rows(page)).toHaveCount(50);
    await expect(queue(page).getByText('51 shown', { exact: true })).toBeVisible();
    await queue(page).getByRole('link', { name: 'Next page', exact: true }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`parameter-${String(fixture.progressOrdinal).padStart(4, '0')}`);
    const cursorUrl = new URL(page.url());
    const cursor = cursorUrl.searchParams.get('cursor');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{70}$/);
    await expect(rows(page).first()).toContainText('Not inspected');

    await fixture.seedProgress();
    await page.reload();
    await expect(page).toHaveURL(cursorUrl.toString());
    await expect(queue(page).getByText('Changes available', { exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`parameter-${String(fixture.progressOrdinal).padStart(4, '0')}`);
    await expect(rows(page).first()).toContainText('Not inspected');
    await scan(page);

    // Revoking the actor before a new request must bypass the presentation snapshot. The
    // previous page was visible, but reload authorizes first and cannot serve cached rows.
    await fixture.revokeAuditor();
    try {
      await page.reload();
      await expect(page.locator('main#content').getByRole('alert')).toContainText('Your role does not permit this action.');
      await expect(page.getByRole('region', { name: 'Records and findings', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Record inspector', exact: true })).toHaveCount(0);
      await expect(page.getByText(fixture.searchTerm, { exact: true })).toHaveCount(0);
      await scan(page);
    } finally {
      await fixture.restoreAuditor();
    }
    await expect(consoleErrors).toEqual([]);
  });
});
