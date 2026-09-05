/**
 * `@intellifin/infrastructure` — the only layer that may touch Drizzle, postgres.js
 * and the process environment. Composition roots (`apps/web`, `apps/worker`) are its
 * only consumers; `domain` and `application` never import it (AD-1).
 */
export * from './config.js';
export * from './db/index.js';
export * from './identity/index.js';
export * from './procedures/index.js';
export * from './registrations/index.js';
export * from './sources/index.js';
export * from './telemetry/index.js';
export * from './notifications/notification-repository.js';
export * from './runs/run-repository.js';
export * from './runs/runs-unit-of-work.js';
export * from './runs/population-repository.js';
export * from './runs/population-queue.js';
export * from './runs/population-acquisition-http.js';
export * from './evidence/s3-evidence-store.js';
