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
/**
 * The addresses default because they are not secrets — they name two synthetic accounts
 * in a synthetic environment, and CI passes the same two. The password does not.
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

/**
 * No default. A committed password is a standing credential in a repository whichever
 * file it sits in, and this suite exists partly to prove the sign-in path works — a
 * fallback would let it pass against an environment nobody configured, or silently
 * spend the rate-limit budget failing against the wrong one.
 */
export const PASSWORD = ((): string => {
  const value = process.env['E2E_PASSWORD'];
  if (value === undefined || value === '') {
    throw new Error(
      'E2E_PASSWORD is required: it must be the password `pnpm seed:identity` was run with.',
    );
  }
  return value;
})();

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

/**
 * Refuse to write to anything that is not obviously a throwaway database.
 *
 * Local (`localhost`, a loopback address, a Docker service name) or a CI runner. It is a
 * deliberately blunt allowlist: a hostname that is not plainly disposable is refused, and
 * the fix is to point the suite at one rather than to widen this list.
 */
export function assertThrowawayDatabase(databaseUrl: string): void {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a URL; refusing to modify an unknown database.');
  }
  const disposable =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === 'postgres' ||
    host === 'db' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    process.env['CI'] === 'true';
  if (!disposable) {
    throw new Error(
      `Refusing to modify auth_rate_limit on "${host}": this suite runs only against a ` +
        'throwaway database. Point DATABASE_URL at a local or CI database.',
    );
  }
}
