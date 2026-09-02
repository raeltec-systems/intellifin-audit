import type { Metadata } from 'next';

import { SignInForm } from '../../src/sign-in-form';

/**
 * The fourth deferred finding: the page had no metadata, so every browser tab and every
 * bookmark of it read "IntelliFin Audit", indistinguishable from any other page.
 */
export const metadata: Metadata = {
  title: 'Sign in · IntelliFin Audit',
  description: 'Sign in to IntelliFin Audit.',
};

/**
 * Sign in.
 *
 * A server component so it can carry page metadata; the interactive part is
 * `SignInForm`. There is no sign-up link and no password-reset link — Story 1.5 owns
 * managing users, and self-registration is disabled in Better Auth itself, not merely
 * hidden here.
 *
 * This page renders outside the application shell: `layout.tsx` wraps children in the
 * shell only when a session resolves, and a sign-in page inside the product's own
 * navigation would offer links nobody signed in can follow.
 */
export default function SignInPage(): React.JSX.Element {
  return (
    <main className="ls-signin">
      <div className="ls-signin__card">
        <h1>Sign in</h1>
        <SignInForm />
        <p className="ls-caption">
          Accounts are created by a PoC Administrator. There is no self-registration.
        </p>
      </div>
    </main>
  );
}
