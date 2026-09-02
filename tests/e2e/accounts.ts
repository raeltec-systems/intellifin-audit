import { expect, type Page } from '@playwright/test';

/**
 * The two accounts the browser specs sign in as, and the sessions they reuse.
 *
 * The accounts are created by `pnpm seed:identity`, which is the only path that can
 * create a user at all — Better Auth has `disableSignUp: true`, so the running
 * application has no sign-up endpoint. CI seeds them before this suite runs.
 *
 * The password comes from the environment. A committed password would be a standing
 * credential in a repository, which is why the seed script refuses one as an argument.
 *
 * Signing in ONCE per role and reusing the saved cookie is not a speed optimisation:
 * `/sign-in/email` is rate limited to ten attempts a minute in `identity/auth.ts`, and
 * a suite that signs in per test spends its budget and then starts failing on a real
 * production rule. `auth.setup.ts` performs the two real sign-ins; every other spec
 * loads the saved state.
 */
export const ACCOUNTS = {
  auditor: {
    email: process.env['E2E_AUDITOR_EMAIL'] ?? 'auditor@example.test',
    role: 'auditor',
  },
  administrator: {
    email: process.env['E2E_ADMIN_EMAIL'] ?? 'administrator@example.test',
    role: 'poc-administrator',
  },
} as const;

export const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-at-least-12-chars';

/** Where `auth.setup.ts` saves each role's signed-in browser state. Git-ignored. */
export const AUTH_STATE = {
  auditor: 'playwright/.auth/auditor.json',
  administrator: 'playwright/.auth/administrator.json',
} as const;

/** Sign in through the real form and wait for the shell to render. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The shell is proof of a session: `layout.tsx` renders it only when one resolves.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}
