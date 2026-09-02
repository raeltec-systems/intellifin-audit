/**
 * `@intellifin/infrastructure` — the only layer that may touch Drizzle, postgres.js
 * and the process environment. Composition roots (`apps/web`, `apps/worker`) are its
 * only consumers; `domain` and `application` never import it (AD-1).
 */
export * from './config.js';
export * from './db/index.js';
export * from './identity/index.js';
export * from './telemetry/index.js';
