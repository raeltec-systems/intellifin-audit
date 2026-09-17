/**
 * The two sentences the sign-in form shows before its handlers attach.
 *
 * They live in their own module, free of React, because a BROWSER SPEC asserts them and
 * importing the component would pull the client runtime into the Playwright process —
 * the `new-procedure-words.ts` rule, on the surface a person meets first.
 */

/** Shown while the server-rendered fields are still unavailable. */
export const SIGN_IN_PREPARING =
  'Preparing the sign-in form. The fields will be available when loading finishes.';

/**
 * Rendered as ordinary markup, never inside `<noscript>`.
 *
 * `<noscript>` reaches only a browser whose scripting flag is off at parse time. The
 * failures that happen are a blocked bundle, a chunk that 404s after a deploy and an
 * exception during hydration, and in every one of those this form can never be used —
 * so the sentence has to be in the page the server sent.
 */
export const SIGN_IN_REQUIRES_JAVASCRIPT =
  'Signing in needs JavaScript. If the fields stay unavailable, enable JavaScript and reload this page.';
