'use client';

import { useState, type FormEvent } from 'react';

/**
 * The minimal sign-in form (FR-1).
 *
 * Deliberately unstyled and component-free: Story 1.4 owns the Ledger Signal shell and
 * the design system, and anything built here would be thrown away or, worse, kept.
 * There is no sign-up link and no password-reset link — Story 1.5 owns managing users,
 * and self-registration is disabled in Better Auth itself, not only hidden here.
 *
 * The form shows exactly what the server said. It never distinguishes an unknown email
 * address from a wrong password, because the server does not either.
 */
export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <p>
          <label htmlFor="email">Email address</label>
          <br />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </p>
        <p>
          <label htmlFor="password">Password</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </p>
        <p>
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </p>
      </form>
      {error ? (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
      <p>Accounts are created by a PoC Administrator. There is no self-registration.</p>
    </main>
  );
}
