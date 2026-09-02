'use client';

import { useEffect } from 'react';

import { Banner } from '../src/design/Banner';
import { Button } from '../src/design/Button';

/**
 * A surface that failed to render.
 *
 * Like `not-found.tsx`, this replaces the page and keeps the root layout, so the shell
 * and the environment ribbon survive the failure. It states what happened and what did
 * NOT happen — EXPERIENCE.md's rule for a failed action is that the banner says nothing
 * was changed — and offers the one safe thing to do.
 *
 * It never renders the error message. A driver error, a query, or a stack would be
 * disclosure; the server already logged the real cause with its digest.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // The server logs the cause. This is the browser's half: the digest ties the two
    // together without putting anything from the error itself on the screen.
    console.error('Surface failed to render', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>This page could not be loaded</h1>
      </header>
      <Banner tone="danger" title="Couldn't load this page. Nothing was changed.">
        The platform could not build this surface. No Run, Result, or Evidence was
        altered. Try again, and if it keeps failing tell a PoC Administrator.
      </Banner>
      <div>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
