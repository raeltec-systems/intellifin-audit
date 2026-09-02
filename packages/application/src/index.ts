/**
 * `@intellifin/application` — commands, queries, plans and the ports this layer
 * owns. AD-1: it may import `@intellifin/domain` and nothing else outward, and
 * must never import Drizzle, pg-boss, Solari, the AI SDK, Resend, S3,
 * Better Auth, Next.js, Pino or Sentry — enforced by `pnpm boundaries`.
 *
 * Story 1.1 seeds the package only; commands and ports arrive in Story 1.2 onward.
 */
import { DOMAIN_LAYER, type LayerName } from '@intellifin/domain';

/** Layer marker used by the bootstrap smoke test to prove the seam is wired. */
export const APPLICATION_LAYER = 'application' as const;

/** Proves `application -> domain` is the only outward edge this layer has. */
export function layersBelow(): readonly LayerName[] {
  return [DOMAIN_LAYER];
}

export * from './audit/clock.js';
export * from './audit/ports.js';
export * from './identity/authorize.js';
export * from './identity/ports.js';
export * from './identity/record-sign-in.js';
