import Link from 'next/link';

/**
 * The breadcrumb trail a detail surface renders for itself.
 *
 * The shell's `Breadcrumbs` is a client component reading only the pathname, so the
 * best it can say for `/procedures/018f…` is a monospace UUID. UX-DR7 requires the
 * Control name and Template identity on every surface that opens the Procedure, and
 * EXPERIENCE.md requires "Breadcrumbs on every detail surface" — so the detail page
 * renders its own trail here, server-side, where the Control name is known.
 *
 * Only the last crumb is current; every earlier one is a link, and each crumb is an
 * `<li>` with the separator inside it, exactly as the shell's trail renders — a
 * separator as a direct child of the `<ol>` would be invalid HTML and an axe finding.
 * `aria-label` matches the shell's, which is exactly why the shell must NOT also render
 * its trail here: two `<nav aria-label="Breadcrumb">` on one page are two landmarks a
 * screen reader cannot tell apart, and the shell's would show a raw UUID. `crumbsFor`
 * returns nothing for a self-trailed path (`rendersOwnTrail` in `breadcrumb-rules.ts`).
 */
export function DetailTrail({
  trail,
}: {
  readonly trail: readonly {
    readonly href: string;
    readonly label: string;
    readonly mono?: boolean;
  }[];
}): React.JSX.Element {
  if (trail.length === 0) return <></>;

  return (
    <nav className="ls-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
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
