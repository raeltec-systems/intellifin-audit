import type { Page, Response } from 'playwright-core';

/**
 * The only account this synthetic build is approved to establish a session for.
 *
 * Northstar includes a short explanation around the account name, while the browser
 * regression fixture uses the compact form. Both are frozen outputs of this repository;
 * accepting an arbitrary suffix would turn a target-controlled status element into an
 * authentication oracle for any account it chose to name.
 */
const APPROVED_ACCOUNT_MARKERS = new Set([
  'Signed in as audit.readonly',
  'Signed in as the read-only audit account audit.readonly. This account cannot change anything; the system refuses every write.',
]);
const MAX_ACCOUNT_MARKER_LENGTH = 256;

/** Explicit synthetic-target UI contract, not a generic SSO detector.
 * Cookies and a 200 login page cannot prove authentication. Unknown UI fails closed. */
export async function hasAuthenticatedAccount(page: Page, response: Response): Promise<boolean> {
  if (response.status() < 200 || response.status() >= 300) return false;
  if (await page.locator('input[type="password"]').count() !== 0) return false;
  const account = page.getByRole('status', { name: 'Current signed-in account', exact: true });
  if (await account.count() !== 1 || !await account.isVisible()) return false;
  const marker = (await account.innerText()).trim().replace(/\s+/gu, ' ');
  return marker.length <= MAX_ACCOUNT_MARKER_LENGTH && APPROVED_ACCOUNT_MARKERS.has(marker);
}
