/**
 * A claim that nothing changed, in any of the ways a sentence can make one (Story 10.8).
 *
 * Whether anything changed is a fact only an action's recorded outcome can establish. The
 * route boundary is reached after a committed action whose acknowledgement was lost, and
 * there "Couldn't load this page. Nothing was changed." was false, with the flag and its
 * notifications already stored. So the boundary, and every result whose outcome is unknown,
 * must not say it in any wording.
 *
 * Four tests said so with four retyped patterns, and together they missed "Nothing
 * changed.", "No changes were made.", "has not changed", "unchanged", "Nothing was
 * altered." and "Nothing has been changed.". This is the one pattern they share, and
 * `nothing-changed.test.ts` lists every phrasing it must catch.
 *
 * Free of React, because the browser specs import it; no `g` flag, so `test` holds no
 * state between calls.
 */
export const NOTHING_CHANGED_CLAIM = new RegExp([
  // Nothing (was / has been / …) changed.
  String.raw`\bnothing\s+(?:(?:was|has|had|is|got|have)\s+(?:been\s+)?)?(?:changed|altered|modified|updated|saved|recorded)\b`,
  // No change(s) (were / have been / …) made.
  String.raw`\bno\s+changes?\s+(?:(?:were|was|have|has|had|got)\s+(?:been\s+)?)?(?:made|saved|recorded|applied)\b`,
  // … has not (been) changed / wasn't recorded.
  String.raw`\b(?:has|have|had|was|were|is|are)(?:\s+not|n['’]t)\s+(?:been\s+)?(?:changed|altered|modified|updated|saved|recorded)\b`,
  String.raw`\bunchanged\b`,
  // The Run-specific form the boundary once used.
  String.raw`\bno\s+run,\s+result,\s+or\s+evidence\b`,
].join('|'), 'i');

export function claimsNothingChanged(text: string): boolean {
  return NOTHING_CHANGED_CLAIM.test(text);
}
