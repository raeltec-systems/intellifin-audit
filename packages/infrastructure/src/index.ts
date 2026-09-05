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
// Deliberately NOT exported here. The acquisition adapter makes the outbound call to a
// registered Target System, and the evidence store holds the object credentials; the web
// imports this barrel, so a re-export would put both one transitive import away from the
// process AD-10 forbids an outbound call — and drag the S3 SDK into the web bundle graph.
// The worker composes them through the ./acquisition and ./evidence subpaths, and
// `no-population-acquisition-in-web` / `no-evidence-store-in-web` fail the build on any
// import from apps/web. Same discipline as ./probe.
