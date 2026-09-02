import { test as setup } from '@playwright/test';

import { createSqlClient } from '@intellifin/infrastructure';

import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';

/**
 * The two real sign-ins in the whole suite.
 *
 * Each one drives the actual form — so the sign-in path is genuinely exercised, and a
 * regression in it fails here first — and then saves the resulting cookie for the specs
 * that only need to be somebody.
 */

/**
 * Start the run with an empty sign-in rate-limit counter.
 *
 * `/sign-in/email` is limited to ten attempts a minute and that limiter is real
 * production behaviour, stored in PostgreSQL so it survives a restart and is shared
 * across containers. A full run spends six of those ten. In CI that is never a problem —
 * the `e2e` job creates the database — but running the suite twice against one database
 * inside a minute makes the second run inherit the first run's budget and fail on its
 * own load, which looks exactly like flakiness and is not.
 *
 * This resets the counter, and nothing else. The limiter stays fully enabled while the
 * suite runs, and `sign-in.spec.ts` still exercises the real endpoint; what is removed is
 * one run's spend leaking into the next. `tests/integration/identity.test.ts` clears the
 * same table for the same reason.
 */
setup('clear the sign-in rate-limit counters', async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  setup.skip(
    databaseUrl === undefined || databaseUrl === '',
    'DATABASE_URL is not set; the suite runs against whatever budget the database holds.',
  );

  // A DELETE aimed at whatever `DATABASE_URL` happens to point at is one mistyped
  // environment variable away from wiping a real deployment's rate-limit counters — and
  // a limiter with no counters is a limiter that has forgotten every attacker mid-run.
  // This suite only ever runs against a throwaway database, so it refuses anything else
  // rather than trusting the operator to have exported the right URL.
  assertThrowawayDatabase(databaseUrl as string);

  const sql = createSqlClient(databaseUrl as string, { max: 1 });
  try {
    await sql`DELETE FROM auth_rate_limit`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

setup('sign in as the Auditor', async ({ page }) => {
  await signIn(page, ACCOUNTS.auditor.email);
  await page.context().storageState({ path: AUTH_STATE.auditor });
});

setup('sign in as the PoC Administrator', async ({ page }) => {
  await signIn(page, ACCOUNTS.administrator.email);
  await page.context().storageState({ path: AUTH_STATE.administrator });
});
