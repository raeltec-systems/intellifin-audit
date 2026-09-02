'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Button } from './design/Button';

/**
 * The sign-in form (FR-1).
 *
 * Story 1.3 shipped this unstyled and with four accessibility findings deferred to the
 * story that owns the accessibility floor. This is that story, and all four are fixed
 * here:
 *
 *   1. ONE live-region role. `role="alert"` already implies `aria-live="assertive"`;
 *      adding `aria-live="polite"` on the same element gave two contradictory
 *      instructions, and some screen readers announced the message twice.
 *   2. The error is linked to the fields with `aria-describedby`, so a person who tabs
 *      back into the email field hears why the attempt failed instead of silence.
 *   3. The error is BEFORE the form in DOM order, so reading order matches the order
 *      the message applies in.
 *   4. Focus moves to the error when it appears. Without it the announcement is the
 *      only signal, and a magnifier user is left looking at an unchanged form.
 *
 * The form still shows exactly what the server said. It never distinguishes an unknown
 * email address from a wrong password, because the server does not either.
 */
export function SignInForm(): React.JSX.Element {
  const errorId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Which attempt the current error belongs to. Keying the focus effect on the error
   * STRING alone means two identical failures in a row — the common case, since every
   * failed sign-in is rewritten to the same sentence — do not re-run it: the second
   * failure would neither move focus nor re-announce, and the form would look like it
   * had done nothing at all.
   */
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  /**
   * The guard that actually holds. `busy` is state: two submit events dispatched before
   * React re-renders — a click plus an implicit submission, or a held Enter key — both
   * read the value from the render that is still on screen, which is `false`. A ref is
   * written and read in the same tick.
   */
  const submittingRef = useRef(false);

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error, attempt]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Holding Enter in a text field fires submit repeatedly. Without this guard each
    // repeat is another POST, and ten of them exhaust the real per-minute sign-in rate
    // limit. The button's `aria-disabled` cannot stop implicit submission.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setAttempt((current) => current + 1);
    setError(null);
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        window.location.assign('/');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Sign-in failed. Check your email address and password.');
    } catch {
      setError('Sign-in is temporarily unavailable. Try again.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const describedBy = error === null ? undefined : errorId;

  return (
    <>
      {error === null ? null : (
        <p
          className="ls-banner ls-banner--danger"
          id={errorId}
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </p>
      )}
      {/*
        `method="post"` matters even though the submit handler never lets a native
        submission happen: if the client bundle fails to load, a `<form>` with no method
        submits as a GET, which puts the password in the URL, in browser history, and in
        every server access log. A POST to this path has no handler and answers 405,
        which discloses nothing.
      */}
      <form className="ls-signin__form" method="post" onSubmit={onSubmit}>
        <div className="ls-dialog__field">
          <label htmlFor="email">Email address</label>
          <input
            className="ls-input"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-describedby={describedBy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="ls-dialog__field">
          <label htmlFor="password">Password</label>
          <input
            className="ls-input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={describedBy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" size="md" busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </>
  );
}
