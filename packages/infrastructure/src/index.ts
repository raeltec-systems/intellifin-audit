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
export * from './runs/run-list-repository.js';
export * from './runs/run-detail-repository.js';
export * from './runs/runs-unit-of-work.js';
export * from './runs/population-repository.js';
export * from './runs/population-queue.js';
export * from './runs/adapter-execution-repository.js';
export * from './runs/agent-execution-repository.js';
export * from './runs/evidence-package-repository.js';
export * from './runs/evidence-integrity-sweep.js';
export * from './runs/exception-fingerprinter.js';
// Story 4.1. The workspace repository and the reaper LOOP are safe here: neither imports
// the browser client, and the reaper takes its ports rather than building them — so the
// worker can compose the sweep without the Playwright and Solari clients entering the
// web bundle graph. `browser-execution.ts` itself is deliberately absent; see below.
export * from './runs/workspace-repository.js';
export * from './runs/workspace-reaper.js';
// Deliberately NOT exported here. The acquisition adapter makes the outbound call to a
// registered Target System, and the evidence store holds the object credentials; the web
// imports this barrel, so a re-export would put both one transitive import away from the
// process AD-10 forbids an outbound call — and drag the S3 SDK into the web bundle graph.
// The worker composes them through the ./acquisition and ./evidence subpaths, and
// `no-population-acquisition-in-web` / `no-evidence-store-in-web` fail the build on any
// import from apps/web. Same discipline as ./probe.
//
// Story 3.3 adds two more for the same reason: ./extraction makes the outbound call to a
// registered Target System and presents an audit credential, and ./credentials is the
// only module that turns a reference into a usable one. `no-adapter-extraction-in-web`
// and `no-credential-resolver-in-web` fail the build on any import from apps/web.
//
// Story 4.1 adds ./browser: the Agent Workspace implementation drives a real browser and
// holds the provider API key, which is a capability the web must never be able to reach.
// `no-browser-execution-in-web` fails the build on any import from apps/web.

export * from './runs/wait-repository.js';
export * from './runs/wait-wake.js';

export * from './notifications/notification-worker.js';
export * from './runs/agent-work-repository.js';

export { PostgresEvaluationReviewRepository } from './runs/evaluation-review-repository.js';
