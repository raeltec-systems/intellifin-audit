/**
 * The Procedure adapters a composition root may import.
 *
 * Nothing in this folder makes an outbound call: a Procedure names its Template and its
 * pre-filled sections, and deriving a plan from them is Story 2.6's queued worker job
 * (AD-23), never this process's.
 */
export * from './procedure-repository.js';
export * from './procedures-unit-of-work.js';
