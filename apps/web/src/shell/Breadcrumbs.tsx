'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { crumbsFor } from './breadcrumb-rules';

export type { Crumb } from './breadcrumb-rules';

/** Every segment but the last is a link; the last is the current page. */
export function Breadcrumbs(): React.JSX.Element | null {
  const pathname = usePathname() ?? '/';
  const crumbs = crumbsFor(pathname);
  if (crumbs.length === 0) return null;

  return (
    <nav className="ls-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.href}>
              {index > 0 ? (
                <span className="ls-breadcrumbs__separator" aria-hidden="true">
                  /{' '}
                </span>
              ) : null}
              {last ? (
                <span aria-current="page" className={crumb.mono ? 'ls-mono' : undefined}>
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className={crumb.mono ? 'ls-mono' : undefined}>
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
