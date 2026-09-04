/**
 * The `procedures` domain module (AD-2).
 *
 * It owns the four Template contracts as build constants and the Procedure Version
 * state machine, and shares neither with any other module: a Template is a contract
 * between the addendum and this codebase, and nothing outside `procedures/` may read or
 * write a `procedures` table (AD-2 — each module owns its own tables).
 */
export * from './procedure-version.js';
export * from './templates.js';
export * from './population-draft.js';
export * from './target-draft.js';
export * from './compliance-draft.js';
export * from './evidence-draft.js';
export * from './plan-compiler.js';
