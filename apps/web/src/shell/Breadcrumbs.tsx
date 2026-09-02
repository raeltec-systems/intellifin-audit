'use client';

import { usePathname } from 'next/navigation';

/** The label a first path segment reads as. Anything else shows its own segment. */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  procedures: 'Procedures',
  runs: 'Runs',
  review: 'Review',
  administration: 'Administration',
  badges: 'Status vocabulary',
};

export interface Crumb {
  readonly href: string;
  readonly label: string;
  /** An identifier segment is monospace, like every other identifier. */
  readonly mono: boolean;
}

/**
 * The trail for a path. EXPERIENCE.md: "Breadcrumbs on every detail surface
 * ('Runs / RUN-2437 / Live')" — a detail surface being one with a parent, so a list
 * route gets none and neither does Overview.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return [];

  const crumbs: Crumb[] = [];
  let href = '';
  for (const [index, segment] of segments.entries()) {
    href += `/${segment}`;
    const known = index === 0 ? SECTION_LABELS[segment] : undefined;
    crumbs.push({
      href,
      label: known ?? decodeURIComponent(segment),
      mono: known === undefined,
    });
  }
  return crumbs;
}

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
                <a href={crumb.href} className={crumb.mono ? 'ls-mono' : undefined}>
                  {crumb.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
