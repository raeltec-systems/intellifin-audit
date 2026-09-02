'use client';

import { useRef, useState } from 'react';

import { Button } from '../design/Button';

/**
 * The top bar's sign-out control (FR-1).
 *
 * A POST, never a link: a GET that ends a session can be triggered by any page that
 * embeds an image, and a browser or a scanner prefetching it would sign people out.
 *
 * No confirmation dialog. EXPERIENCE.md reserves those for mutating actions on audit
 * state; signing out changes nothing a person would need to reconsider, and a dialog
 * between somebody and the exit at a shared workstation is a hazard, not a safeguard.
 *
 * On success the browser is sent to `/sign-in` with a full navigation, so no server
 * component rendered under the old session survives in the router cache.
 */
export function SignOutButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function onClick(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (response.ok) {
        window.location.assign('/sign-in');
        return;
      }
      setError('Sign-out failed. Try again.');
    } catch {
      setError('Sign-out failed. Try again.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="ls-signout">
      {error === null ? null : (
        <p className="ls-signout__error" role="alert">
          {error}
        </p>
      )}
      {/* No icon: DESIGN.md fixes the glyph set, and none of it names a sign-out. */}
      <Button
        variant="ghost"
        busy={busy}
        onClick={() => {
          void onClick();
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}
