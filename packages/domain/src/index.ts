/**
 * `@intellifin/domain` — entities, value objects, state machines and deterministic
 * rules. AD-1: this package imports nothing outward. It has no runtime dependencies
 * and must never import Drizzle, pg-boss, Solari, the AI SDK, Resend, S3,
 * Better Auth, Next.js, Pino or Sentry — enforced by `pnpm boundaries`.
 *
 * Story 1.1 seeds the package only; product entities arrive in Story 1.2 onward.
 */

/** Layer marker used by the bootstrap smoke test to prove the seam is wired. */
export const DOMAIN_LAYER = 'domain' as const;

export type LayerName = 'domain' | 'application' | 'infrastructure';

export * from './audit-event.js';
export * from './identity/index.js';
