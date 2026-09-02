import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { Database } from '../db/client.js';
import { authAccount, authSession, authUser, authVerification } from '../db/schema.js';

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
 * The instance `scripts/seed-identity.mts` uses, and the ONLY one that can create a
 * user. It exists because somebody must be able to sign in before Story 1.5 builds
 * user administration; it is never constructed by `apps/web` or `apps/worker`.
 * It does not sign the new account in, so seeding never issues a session.
 */
export function createSeedAuth(db: Database, config: AuthConfig): Auth {
  return buildAuth(db, config, { allowSignUp: true, autoSignIn: false });
}

export type Auth = ReturnType<typeof buildAuth>;
