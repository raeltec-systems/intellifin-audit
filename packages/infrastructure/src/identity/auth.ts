import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { Database } from '../db/client.js';
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from '../db/schema.js';

/**
 * Better Auth, configured for identity and session ONLY (AD-7).
 *
 * There is no role field on the user, no `additionalFields`, and no plugin that could
 * put an authority claim in the session. Everything about what a person may do lives
 * in `user_role` and is read per request by {@link DrizzleRoleRepository}. If a role
 * ever appears here, revoking it stops taking effect until the token expires — which
 * is the failure AD-7 exists to prevent.
 *
 * `better-auth` is imported here and in `apps/web` alone; `packages/domain` and
 * `packages/application` may not name it at all, and `pnpm boundaries` enforces that.
 */

export interface AuthConfig {
  /** Signing secret. Comes from the composition root's validated configuration. */
  readonly secret: string;
  /** Public origin the browser reaches, e.g. `https://audit.example.com`. */
  readonly baseUrl: string;
}

/** Where the authentication endpoints are mounted. The route handler must match. */
export const AUTH_BASE_PATH = '/api/auth';

/** Prefix of Better Auth's session cookie, with and without the `__Secure-` marker. */
export const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
] as const;

interface InternalAuthOptions {
  /** Story 1.5 owns creating users; the running application never enables this. */
  readonly allowSignUp: boolean;
  /** A seeded account must not also hand out a session. */
  readonly autoSignIn: boolean;
}

function buildAuth(db: Database, config: AuthConfig, internal: InternalAuthOptions) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    database: drizzleAdapter(db, {
      provider: 'pg',
      // Keyed by the model names below, which is what the adapter looks up.
      schema: {
        auth_user: authUser,
        auth_session: authSession,
        auth_account: authAccount,
        auth_verification: authVerification,
        auth_rate_limit: authRateLimit,
      },
    }),
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !internal.allowSignUp,
      autoSignIn: internal.autoSignIn,
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
    /**
     * Declared explicitly rather than left to the default, which is OFF outside
     * production. `/api/auth/**` is the one publicly allowlisted surface in the whole
     * application, and `/sign-in/email` is a password oracle: unlimited attempts
     * against it are how a weak password is found. The window is stated here so it
     * behaves the same in a preview environment, in CI and on a developer's machine
     * as it does in production.
     *
     * Storage is the database, not process memory: the deployment can run more than
     * one web container, and a per-process counter is a limit an attacker escapes by
     * being load-balanced elsewhere.
     */
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      // The catch-all for every other authentication endpoint.
      window: 60,
      max: 60,
      customRules: {
        // Ten attempts a minute is far more than a person types and far less than a
        // guessing run needs. `SIGN_IN_RATE_LIMITED_MESSAGE` is what the caller sees.
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/forget-password': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
  });
}

/**
 * The instance the web process serves. Sign-up is disabled in Better Auth itself,
 * not merely hidden in the interface, so there is no self-registration endpoint at all.
 */
export function createAuth(db: Database, config: AuthConfig): Auth {
  return buildAuth(db, config, { allowSignUp: false, autoSignIn: true });
}

/**
 * The ONLY instance that can create a user, and the only one with sign-up enabled.
 *
 * Two callers construct it, and both are deliberate:
 *
 *   1. `scripts/seed-identity.mts`, the operator path — somebody has to exist before
 *      anybody can sign in and use the administration surface at all; and
 *   2. `BetterAuthUserCreator`, reached only from `createUserWithRole`, which runs only
 *      after `administration.users.manage` has been authorized and audited, and only
 *      inside the transaction that also writes the role and the audit event.
 *
 * It is never MOUNTED. `apps/web` serves {@link createAuth}, where sign-up is disabled
 * in Better Auth itself, so the running application has no account-creation endpoint;
 * `tests/integration/manage-users.test.ts` re-asserts that against the real handler
 * precisely because this instance now exists inside the web process.
 *
 * It does not sign the new account in, so creating one never issues a session.
 */
export function createSeedAuth(db: Database, config: AuthConfig): Auth {
  return buildAuth(db, config, { allowSignUp: true, autoSignIn: false });
}

export type Auth = ReturnType<typeof buildAuth>;
