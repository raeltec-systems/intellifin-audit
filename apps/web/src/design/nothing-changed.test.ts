import { describe, expect, it } from 'vitest';

import { NOTHING_CHANGED_CLAIM, claimsNothingChanged } from './nothing-changed';
import { ROUTE_BOUNDARY_COPY } from './route-boundary-words';
import { FLAG_COPY, RUN_LOST_RESPONSE } from './copy';

/**
 * The one pattern for "nothing changed" (Story 10.8 review, P5).
 *
 * Every phrasing below is a way a sentence could claim what only a recorded outcome can
 * establish. Each must be caught; the sentences the platform really says where the outcome is
 * unknown must not be.
 */
describe('a claim that nothing changed', () => {
  it.each([
    // The phrasings the four retyped patterns missed.
    'Nothing changed.',
    'No changes were made.',
    'The Run has not changed.',
    'The Run is unchanged.',
    'Nothing was altered.',
    'Nothing has been changed.',
    // The phrasings they already caught.
    "Couldn't load this page. Nothing was changed.",
    'Nothing has changed since you opened it.',
    'The note was not recorded.',
    'Your changes were not saved.',
    'No Run, result, or evidence was affected.',
    // And the obvious neighbours of each.
    'NOTHING WAS CHANGED',
    'No change was made.',
    "The flag hasn't been recorded.",
    'It wasn’t saved.',
    'Nothing got saved.',
    'nothing was modified',
  ])('catches %j', (sentence) => {
    expect(claimsNothingChanged(sentence)).toBe(true);
  });

  it.each([
    ROUTE_BOUNDARY_COPY.heading,
    ROUTE_BOUNDARY_COPY.run,
    ROUTE_BOUNDARY_COPY.other,
    ROUTE_BOUNDARY_COPY.body,
    ROUTE_BOUNDARY_COPY.reload,
    FLAG_COPY.unknown,
    RUN_LOST_RESPONSE,
    'Check whether anything changed before repeating your last action.',
    'Reloading from here does not repeat your last action.',
  ])('does not catch a sentence that claims nothing: %j', (sentence) => {
    expect(claimsNothingChanged(sentence)).toBe(false);
  });

  it('holds no state between calls, so a second test of the same text answers the same', () => {
    expect(NOTHING_CHANGED_CLAIM.flags).not.toContain('g');
    expect(NOTHING_CHANGED_CLAIM.flags).toContain('i');
    expect(claimsNothingChanged('Nothing changed.')).toBe(true);
    expect(claimsNothingChanged('Nothing changed.')).toBe(true);
  });
});
