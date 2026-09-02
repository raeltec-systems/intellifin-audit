/**
 * The Population Source binding adapters a composition root may import.
 *
 * There is no probe-style subpath here and no module hidden from `apps/`: nothing in
 * this folder makes an outbound call. A binding names a location; acquiring the
 * population against it belongs to Epic 2's Adapters, which run in the worker.
 */
export * from './binding-repository.js';
export * from './sources-unit-of-work.js';
