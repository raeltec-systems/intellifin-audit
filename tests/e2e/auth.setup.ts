import { test as setup } from '@playwright/test';

import { ACCOUNTS, AUTH_STATE, signIn } from './accounts';

/**
 * The two real sign-ins in the whole suite.
 *
 * Each one drives the actual form — so the sign-in path is genuinely exercised, and a
 * regression in it fails here first — and then saves the resulting cookie for the specs
 * that only need to be somebody.
 */

setup('sign in as the Auditor', async ({ page }) => {
  await signIn(page, ACCOUNTS.auditor.email);
  await page.context().storageState({ path: AUTH_STATE.auditor });
});

setup('sign in as the PoC Administrator', async ({ page }) => {
  await signIn(page, ACCOUNTS.administrator.email);
  await page.context().storageState({ path: AUTH_STATE.administrator });
});
