'use client';

import { useRef, useState } from 'react';

// From `route-access`, not from the handler: that module reaches postgres.js and Better
// Auth, and a client component importing it would drag both into the browser bundle.
import { SIGN_OUT_PATH } from '../route-access';

/**
 * The top bar's sign-out control (FR-1).
 *
 * **A real form, submitted by the browser.** The whole control is
 * `<form method="post" action="/api/auth/sign-out">` with a submit button, so it works
 * from the moment the HTML lands: before React hydrates, and with JavaScript disabled
 * entirely. That is not a nicety. The first version of this control was an `onClick`
 * handler that called `fetch`, and a click during the hydration window did nothing at
 * all — no request, no navigation, no message. At a shared workstation somebody clicks
 * Sign out, sees the page unchanged for a moment, and walks away believing the session
 * ended. For a product built on attributable action that is a security defect, and it is
 * the same defect class the sign-in form's `method="post"` fallback exists to avoid.
 *
 * The server answers a 303 to `/sign-in`, which a browser follows on its own. Nothing
 * here interprets a response, so there is nothing for a missing bundle to break.
 *
 * A POST, never a link: a GET that ends a session can be triggered by any page that
 * embeds an image, and a browser or a scanner prefetching it would sign people out.
 *
 * No confirmation dialog. EXPERIENCE.md reserves those for mutating actions on audit
 * state; signing out changes nothing a person would need to reconsider, and a dialog
 * between somebody and the exit at a shared workstation is a hazard, not a safeguard.
 *
 * The only JavaScript is the double-submit guard below, and it is an ENHANCEMENT: with
 * it, a second activation before the navigation completes is dropped; without it, the
 * route is idempotent and a second sign-out answers the same redirect. Neither the guard
 * nor the busy label is required for the control to work.
 */
export function SignOutButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  /**
   * Written and read in the same tick; `busy` is a render behind. The FIRST submission
   * is never prevented — the browser performs it — and only a repeat is dropped. The
   * button is deliberately not `disabled` on submit either: disabling a submit button
   * while its own submission is being dispatched can cancel it in some browsers, which
   * would reintroduce the silent no-op this control exists to avoid.
   */
  const submittingRef = useRef(false);

  return (
    <form
      className="ls-signout"
      method="post"
      action={SIGN_OUT_PATH}
      onSubmit={(event) => {
        if (submittingRef.current) {
          event.preventDefault();
          return;
        }
        submittingRef.current = true;
        setBusy(true);
      }}
    >
      {/*
        A plain <button type="submit">, not the `Button` component: `Button` is a
        `type="button"` control whose behaviour is an onClick handler, which is exactly
        the JavaScript-only path this control must not have. It wears the same classes,
        so it is the same control visually and the same focus ring applies.
        No icon: DESIGN.md fixes the glyph set, and none of it names a sign-out.
      */}
      <button type="submit" className="ls-button ls-button--ghost ls-button--sm">
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </form>
  );
}
