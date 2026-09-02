/**
 * The names Better Auth may give its session cookie.
 *
 * Duplicated here rather than imported from `@intellifin/infrastructure` because
 * `middleware.ts` runs on the edge runtime, where pulling in postgres.js, Pino and
 * Sentry through the infrastructure barrel would not even bundle. The list is
 * asserted against the infrastructure constant in `route-access.test.ts`, so the two
 * cannot drift apart unnoticed.
 */
export const SESSION_COOKIE_PREFIXES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
] as const;
