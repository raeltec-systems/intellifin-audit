import type { Metadata } from 'next';

import { EmptyState } from '../src/design/EmptyState';

export const metadata: Metadata = { title: 'Not found · IntelliFin Audit' };

/**
 * A path that resolves to nothing.
 *
 * It renders through the root layout, so it keeps the shell and — the point — the
 * environment ribbon. A bare 404 would drop the standing statement about what this
 * deployment is at the moment somebody is furthest from knowing where they are.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Page not found</h1>
      </header>
      <EmptyState
        headline="There is nothing at this address."
        sentence="The link may be from an older version of the interface, or the record may never have existed. Nothing was changed."
        link={{ href: '/', label: 'Go to Overview' }}
      />
    </div>
  );
}
