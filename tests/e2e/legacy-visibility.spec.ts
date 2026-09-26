import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { AUTH_STATE } from './accounts';
import { MASKED_VALUE } from '../../apps/web/src/design/copy';
import { RESULT_WORDS } from '../../apps/web/src/runs/result-words';
import {
  createLegacyVisibilityBrowserFixture, VISIBILITY_CANDIDATE, VISIBILITY_DECIDED_AT,
  type LegacyVisibilityBrowserFixture,
} from '../fixtures/legacy-visibility-browser';

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
}

async function assertPrivateResponse(response: Response | null, fixture: LegacyVisibilityBrowserFixture, page: Page): Promise<void> {
  expect(response?.ok()).toBe(true);
  if (!fixture.masked) return;
  // Inspect the server response including serialized component props, not only visible text.
  expect(await response!.text()).not.toContain(VISIBILITY_CANDIDATE);
  await expect(page.locator('body')).not.toContainText(VISIBILITY_CANDIDATE);
}

async function assertDecision(scope: Locator, fixture: LegacyVisibilityBrowserFixture): Promise<void> {
  const decision = scope.getByText('Human-matched', { exact: true }).locator('..');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText(fixture.auditorName);
  await expect(decision.locator(`time[datetime="${VISIBILITY_DECIDED_AT}"]`)).toBeVisible();
  await expect(decision.locator('pre')).toHaveText(fixture.masked ? MASKED_VALUE : VISIBILITY_CANDIDATE);
  await expect(decision).toContainText('Untrusted source content — Answer.');
  await decision.locator('summary').click();
  await expect(decision.getByText(fixture.waitId, { exact: true })).toBeVisible();
  await expect(decision.getByText('candidate-106', { exact: true })).toBeVisible();
}

test.describe('Story 10.6 legacy visibility through authenticated pages', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  for (const privacy of ['public', 'key', 'secondary'] as const) {
    test(`human matching reaches all four surfaces with ${privacy} lookup visibility`, async ({ page }) => {
      test.setTimeout(120_000);
      const fixture = await createLegacyVisibilityBrowserFixture(privacy);
      try {
        let response = await page.goto(`/runs/${fixture.runId}`);
        await assertPrivateResponse(response, fixture, page);
        const result = page.getByRole('region', { name: 'Human-matched · 1 record', exact: true });
        await assertDecision(result, fixture);
        // The matching record is beyond the first 500 Source rows. Its actual ordinal must
        // survive the Result link instead of a fallback into an unrelated initial page.
        const exactRecord = result.locator(`a[href="/runs/${fixture.runId}/evidence?selected=${fixture.humanOrdinal}"]`);
        await expect(exactRecord).toHaveCount(1);
        await scan(page);
        await exactRecord.click();
        await expect(page).toHaveURL(url => url.searchParams.get('selected') === String(fixture.humanOrdinal));
        const inspector = page.getByRole('region', { name: 'Record inspector', exact: true });
        await assertDecision(inspector, fixture);
        await scan(page);

        // Filter to the one real Exception so the selected record is on the queue page.
        // Navigation is a full server read, allowing response-body redaction assertions.
        response = await page.goto(`/runs/${fixture.runId}/evidence?filter=exceptions&selected=${fixture.humanOrdinal}`);
        await assertPrivateResponse(response, fixture, page);
        const queue = page.getByRole('region', { name: 'Records and findings', exact: true });
        await expect(queue.locator('ol[aria-label="Record review queue"] > li')).toHaveCount(1);
        await assertDecision(queue, fixture);
        await assertDecision(page.getByRole('region', { name: 'Record inspector', exact: true }), fixture);
        await scan(page);

        response = await page.goto(`/runs/${fixture.runId}/exceptions`);
        await assertPrivateResponse(response, fixture, page);
        await assertDecision(page.getByRole('region', { name: 'Exceptions', exact: true }), fixture);
        await scan(page);

        response = await page.goto(`/runs/${fixture.runId}/evidence?selected=1`);
        await assertPrivateResponse(response, fixture, page);
        await expect(page.getByRole('region', { name: 'Record inspector', exact: true }).getByText('Human-matched', { exact: true })).toHaveCount(0);
        const platformRow = page.locator('ol[aria-label="Record review queue"] > li').filter({ has: page.locator('a[href*="selected=1&"], a[href$="selected=1"]') });
        await expect(platformRow).toHaveCount(1);
        await expect(platformRow.getByText('Human-matched', { exact: true })).toHaveCount(0);

        // An unreadable publication cannot suppress independently persisted provenance.
        const unreadable = await createLegacyVisibilityBrowserFixture(privacy, 'registered', true);
        try {
          response = await page.goto(`/runs/${unreadable.runId}`);
          await assertPrivateResponse(response, unreadable, page);
          await expect(page.getByText(RESULT_WORDS.unreadableDocument, { exact: true })).toBeVisible();
          await assertDecision(page.getByRole('region', { name: 'Human-matched · 1 record', exact: true }), unreadable);
          await scan(page);
        } finally { await unreadable.cleanup(); }
      } finally { await fixture.cleanup(); }
    });
  }

  for (const state of ['registered', 'unavailable', 'absent'] as const) {
    test(`Live View resolves adapter Evidence identity: ${state}`, async ({ page }) => {
      test.setTimeout(120_000);
      const fixture = await createLegacyVisibilityBrowserFixture('public', state);
      try {
        await page.goto(`/runs/${fixture.runId}/live`);
        const adapter = page.getByRole('region', { name: 'Systems read without a screen', exact: true });
        await expect(adapter).toContainText('Visibility API');
        if (state === 'registered') {
          await expect(adapter.locator('.ls-digest')).toHaveText(fixture.adapterDigest);
          await expect(adapter).not.toContainText('No artifact registered.');
          await expect(adapter.getByRole('link', { name: 'Evidence', exact: true })).toHaveCount(0);
        } else {
          await expect(adapter.locator('.ls-digest')).toHaveCount(0);
          if (state === 'absent') await expect(adapter.getByText('No artifact registered.', { exact: true })).toBeVisible();
          else await expect(adapter.getByRole('link', { name: 'Evidence', exact: true }))
            .toHaveAttribute('href', `/runs/${fixture.runId}/evidence/technical#evidence-${fixture.adapterEvidenceId}`);
        }
        await scan(page);
      } finally { await fixture.cleanup(); }
    });
  }
});
