import { fillTemplate } from '../design/copy';

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
 * What the Builder says the instant a Draft is created (UX-07).
 *
 * Creating a Draft used to stand behind a confirmation dialog that restated the same
 * fact the click already implied — "A Draft Procedure Version is created from…" — and
 * then asked the auditor to confirm doing the thing they had just asked to do. It is
 * one action now: the click creates the Draft and lands on its Builder, and THIS is
 * where the person actually sees the confirmation, because the form they clicked from
 * is gone by the time they would read one there.
 *
 * A retyped name is a name that drifts: `fillTemplate` from `design/copy.ts` is the one
 * substitution mechanism this codebase uses for a value that could contain `$&`.
 */
export const DRAFT_CREATED_TEMPLATE = 'Draft “{name}” created.';
export const DRAFT_CREATED_BODY =
  'Prepare it below, then submit it for independent approval when it is ready.';

export function draftCreatedBanner(name: string): string {
  return fillTemplate(DRAFT_CREATED_TEMPLATE, { name });
}

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

/**
 * Said when the create response was lost. It never claims nothing was created, because
 * this path cannot know: `createProcedure` mints its ids inside the command and carries
 * no request token, so a retry after a lost response creates a SECOND Procedure.
 */
export const UNKNOWN_CREATE_OUTCOME =
  'The create response was lost. The Procedure may have been created. Open Procedures to check before creating another.';
