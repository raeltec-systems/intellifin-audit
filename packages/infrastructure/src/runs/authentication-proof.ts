import type { Page, Response } from 'playwright-core';

/** Explicit synthetic-target UI contract, not a generic SSO detector.
 * Cookies and a 200 login page cannot prove authentication. Unknown UI fails closed. */
export async function hasAuthenticatedAccount(page: Page, response: Response): Promise<boolean> {
  if (response.status() < 200 || response.status() >= 300) return false;
  if (await page.locator('input[type="password"]').count() !== 0) return false;
  const account = page.getByRole('status', { name: 'Current signed-in account', exact: true });
  if (await account.count() !== 1 || !await account.isVisible()) return false;
  return /^Signed in as\s+\S/u.test((await account.innerText()).trim());
}
