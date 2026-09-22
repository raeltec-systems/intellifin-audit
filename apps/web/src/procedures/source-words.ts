/**
 * What the records step says before a source is chosen (UI cleanup 2026-09-22, UX-12).
 *
 * The filters under "Which records to test" used to say a field was missing from "this
 * source" when no source had been chosen at all — a compatibility error about nothing.
 * Until a source is chosen the step says what to do next, and only a save attempted with
 * no source says it is needed.
 */
export const NO_SOURCE_FIELDS_YET = 'Choose a source to see its fields.';
export const NO_SOURCE_ON_SAVE = 'Choose where the records come from before saving this step.';
