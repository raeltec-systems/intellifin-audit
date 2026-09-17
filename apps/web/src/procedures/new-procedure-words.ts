/**
 * The two sentences the New-procedure form shows before its handlers attach.
 *
 * They live in their own module, free of React and of `next/navigation`, because a
 * BROWSER SPEC has to assert them and importing the component would pull the client
 * runtime into the Playwright process. The same reason `run-start-words.ts` exists: a
 * sentence retyped in a test is a sentence pinned against nothing.
 */

/** Shown while the server-rendered fields are still unavailable. */
export const NEW_PROCEDURE_PREPARING =
  'Preparing the form. Choices will be available when loading finishes.';

/**
 * Said beside the preparing status, and NOT inside a `<noscript>`.
 *
 * `<noscript>` speaks to exactly one failure — a browser whose scripting flag is off at
 * parse time — and is invisible in every other one: scripts blocked by a proxy, a chunk
 * that 404s after a deploy, an execution error during hydration. In all of those the
 * preparing status stays on the screen for ever, and on its own it says the opposite of
 * what is true ("when loading finishes" — it never will). This sentence is rendered by
 * the server every time and removed by hydration, so whatever stops the handlers from
 * attaching, the reader is told what to do about it.
 *
 * It is also the only form a BROWSER TEST can observe: Chromium's
 * `javaScriptEnabled: false` disables script EXECUTION and leaves the parser's scripting
 * flag ON, so `<noscript>` children stay raw text that no locator matches — which is why
 * the first version of this repair passed its unit test and failed in CI.
 */
export const NEW_PROCEDURE_REQUIRES_JAVASCRIPT =
  'Creating a Procedure needs JavaScript. If the choices stay unavailable, enable JavaScript and reload this page.';
