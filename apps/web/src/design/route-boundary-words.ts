/**
 * What the route error boundary says (Story 10.8).
 *
 * The boundary (`apps/web/app/error.tsx`) renders when a surface fails to render — and
 * also when a Server Action committed and its acknowledgement was lost, because a flag
 * form's action IS the Server Action and a dropped RSC response reaches the boundary
 * rather than the component. It used to say "Couldn't load this page. Nothing was
 * changed." — EXPERIENCE.md's sentence for an action the platform REFUSED — over a flag
 * that had committed and notified every Audit Manager. The boundary cannot tell a page
 * that failed to build from an action whose answer was lost, so it says only what is true
 * of both: the page did not load, and the reader should look before repeating anything.
 * Whether something changed is a fact only the action's recorded outcome can establish,
 * and only the action's own message may say it.
 *
 * The owner approved all five sentences on 2026-09-26. The Run sentence is the owner's
 * candidate from epics.md Story 10.8, verbatim, and `route-boundary-words.test.ts` pins it
 * there. `other` is the same sentence for a page that shows no Run, because "the Run's
 * current state" on an Administration page names something that is not there.
 *
 * Free of React and `next/navigation`, because the browser specs import it: a sentence
 * retyped in a test is a sentence pinned against nothing (the `run-start-words.ts` rule).
 */
export const ROUTE_BOUNDARY_COPY = {
  heading: 'This page could not be loaded',
  run: "This page could not be loaded. Check the Run's current state before repeating your last action.",
  other: 'This page could not be loaded. Check the current state before repeating your last action.',
  body: 'Reload this page to read it again. Reloading from here does not repeat your last action. If the page keeps failing, tell a PoC Administrator.',
  reload: 'Reload this page',
} as const;

/** A path under one Run: `/runs/<run>` and everything beneath it, never the Runs list. */
const RUN_SURFACE = /^\/runs\/[^/]+(?:\/|$)/;

/**
 * The boundary's sentence for the page that failed.
 *
 * A Run surface names the Run, because that is where the actions whose acknowledgement can
 * be lost live (flag, pause, resume, cancel, answer). Any other page, or a path nobody
 * could read, gets the sentence that names nothing it cannot see.
 */
export function routeBoundarySentence(pathname: string | null | undefined): string {
  return typeof pathname === 'string' && RUN_SURFACE.test(pathname) ? ROUTE_BOUNDARY_COPY.run : ROUTE_BOUNDARY_COPY.other;
}
