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
export * from './identity/manage-users.js';
export * from './identity/ports.js';
export * from './identity/record-sign-in.js';
export * from './identity/record-sign-out.js';
export * from './procedures/ports.js';
export * from './procedures/create-procedure.js';
export * from './procedures/update-population-draft.js';
export * from './procedures/update-target-draft.js';
export * from './procedures/update-compliance-draft.js';
export * from './procedures/update-evidence-draft.js';
export * from './registrations/ports.js';
export * from './registrations/register-target-system.js';
export * from './sources/ports.js';
export * from './sources/register-population-source.js';
export * from './procedures/plan-ports.js';
export * from './procedures/plan-state.js';
export * from './procedures/derive-plan.js';
export * from './procedures/retry-plan-derivation.js';
export * from './procedures/submit-version.js';
export * from './procedures/decide-version.js';
export * from './notifications/ports.js';

export * from './procedures/mint-platform-draft.js';
export * from './procedures/new-version.js';
export * from './procedures/apply-platform-configuration.js';
export * from './runs/ports.js';
export * from './runs/initiate-run.js';
export * from './runs/execution-ports.js';
export * from './runs/acquire-population.js';
export * from './runs/execute-adapter-steps.js';
export * from './runs/register-observations.js';
export * from './runs/evidence-package.js';
export * from './runs/seal-package.js';
