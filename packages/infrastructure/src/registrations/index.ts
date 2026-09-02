/**
 * The registration adapters that a composition root may import.
 *
 * `probe.ts` is deliberately NOT here. AD-10 makes probing the worker's job and the web
 * process's forbidden one, and a module reachable through this barrel is a module every
 * `apps/` bundle can reach. It has its own `@intellifin/infrastructure/probe` subpath and
 * a dependency-cruiser rule that fails the build on any import of it from `apps/` — the
 * same shape as the release migrator.
 */
export * from './credential-provider.js';
export * from './deadline.js';
export * from './registration-repository.js';
export * from './registrations-unit-of-work.js';
