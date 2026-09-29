'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { Banner } from '../src/design/Banner';
import { ROUTE_BOUNDARY_COPY, routeBoundarySentence } from '../src/design/route-boundary-words';

/**
 * The page's own address, query included: a reload of `?cursor=…` is not page one.
 *
 * Built from the router's own path and query, which the server renders too, so the link is
 * the same with JavaScript and without it, and a navigation that changes only the query while
 * the boundary is showing moves it with the page.
 */
function boundaryAddress(pathname: string | null, search: string): string {
  const path = pathname ?? '/';
  return search === '' ? path : `${path}?${search}`;
}

/**
 * A surface that failed to render.
 *
 * Like `not-found.tsx`, this replaces the page and keeps the root layout, so the shell
 * and the environment ribbon survive the failure.
 *
 * It states ONLY what it knows (Story 10.8). The boundary is reached by two things it
 * cannot tell apart — a page that could not be built, and a Server Action that committed
 * and whose acknowledgement was lost — so it never says that nothing was changed: after a
 * committed flag that sentence was false, with the flag and its notifications already
 * stored. The sentences live in `route-boundary-words.ts`.
 *
 * The one control is a plain link to this page's own address. A link is a GET, so
 * following it reads the page again and can never resubmit the action that led here; it
 * is a full document load rather than `reset()`, because `reset()` re-renders from the
 * router's cache — the page as it was BEFORE the action — which is exactly the view that
 * invites a second submission. And a link works with no JavaScript at all.
 *
 * It never renders the error message. A driver error, a query, or a stack would be
 * disclosure; the server already logged the real cause with its digest.
 */
export default function ErrorBoundary({
  error,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): React.JSX.Element {
  const pathname = usePathname();
  const here = boundaryAddress(pathname, useSearchParams().toString());
  useEffect(() => {
    // The server logs the cause. This is the browser's half: the digest ties the two
    // together without putting anything from the error itself on the screen.
    console.error('Surface failed to render', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>{ROUTE_BOUNDARY_COPY.heading}</h1>
      </header>
      <Banner tone="danger" title={routeBoundarySentence(pathname)}>
        {ROUTE_BOUNDARY_COPY.body}
      </Banner>
      <div>
        <a className="ls-button ls-button--primary ls-button--md" href={here}>
          {ROUTE_BOUNDARY_COPY.reload}
        </a>
      </div>
    </div>
  );
}
