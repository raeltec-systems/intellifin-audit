/**
 * The breadcrumb trail, as plain functions, so the rules can be tested without a DOM.
 */

/** The label a first path segment reads as. Anything else shows its own segment. */
export const SECTION_LABELS: Readonly<Record<string, string>> = {
  procedures: 'Procedures',
  runs: 'Runs',
  review: 'Review',
  administration: 'Administration',
  badges: 'Status vocabulary',
};

/**
 * Sub-routes whose segment is a NAME, not an identifier.
 *
 * Without this every segment after the first is treated as an identifier and rendered in
 * monospace, because that is what a second segment usually is — `/runs/RUN-2437`. A
 * named sub-route such as `/administration/registrations` is not an identifier, and
 * showing it as one tells the reader something false about what it is. Keyed by the full
 * path so `/administration/registrations` and some later `/procedures/registrations`
 * cannot be forced to share a label.
 */
export const SUBSECTION_LABELS: Readonly<Record<string, string>> = {
  '/administration/registrations': 'Target System registrations',
  '/administration/sources': 'Population Source bindings',
};

/**
 * Routes under `/procedures` that are NOT a Procedure identifier.
 *
 * A plain object indexed by a URL segment, so the lookup below uses `Object.hasOwn`:
 * `/procedures/constructor` is a path anybody can type, and a bare index would answer
 * it with an inherited function.
 */
export const PROCEDURE_NAMED_ROUTES: Readonly<Record<string, true>> = {
  new: true,
};

/**
 * Whether the page at this path renders its own breadcrumb trail server-side.
 *
 * A Procedure detail surface does, because UX-DR7 puts the Control name in the trail
 * and the shell — a client component reading only the pathname — can only say the raw
 * identifier. Both trails are `<nav aria-label="Breadcrumb">`, so rendering both gives
 * one page two landmarks with the same accessible name: a screen reader offers two
 * identical "Breadcrumb" navigations and the first one is a UUID. The accessibility
 * gate cannot catch it — `landmark-unique` is a best-practice rule, not a WCAG-tagged
 * one, so axe reports it nowhere near `results.violations`. The shell therefore stands
 * down here rather than the page dropping its `aria-label`, because the trail that
 * carries the Control name is the one worth keeping.
 */
export function rendersOwnTrail(pathname: string): boolean {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return false;
  if (segments[0] !== 'procedures') return false;
  return !Object.hasOwn(PROCEDURE_NAMED_ROUTES, segments[1] as string);
}

export interface Crumb {
  readonly href: string;
  readonly label: string;
  /** An identifier segment is monospace, like every other identifier. */
  readonly mono: boolean;
}

/**
 * A path segment as text. `decodeURIComponent` THROWS on a malformed escape, and the
 * segment comes straight from the URL bar: `/runs/%E0%A4%A` would otherwise take down
 * every page under the shell with an unhandled URIError.
 */
export function readableSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The label for a first segment, or `undefined`.
 *
 * `Object.hasOwn`, not a plain lookup: `SECTION_LABELS` is keyed by request input, so
 * `/toString/x` would otherwise inherit `Object.prototype.toString` and render a
 * function as a breadcrumb label.
 */
export function sectionLabel(segment: string): string | undefined {
  return Object.hasOwn(SECTION_LABELS, segment) ? SECTION_LABELS[segment] : undefined;
}

/** The label for a known sub-route, or `undefined`. Same `Object.hasOwn` reason. */
export function subsectionLabel(href: string): string | undefined {
  return Object.hasOwn(SUBSECTION_LABELS, href) ? SUBSECTION_LABELS[href] : undefined;
}

/**
 * The trail for a path. EXPERIENCE.md: "Breadcrumbs on every detail surface
 * ('Runs / RUN-2437 / Live')" — a detail surface being one with a parent, so a list
 * route gets none and neither does Overview.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return [];
  // The page trails itself; a second trail would be a duplicate landmark.
  if (rendersOwnTrail(pathname)) return [];

  const crumbs: Crumb[] = [];
  let href = '';
  for (const [index, segment] of segments.entries()) {
    href += `/${segment}`;
    const known = index === 0 ? sectionLabel(segment) : subsectionLabel(href);
    crumbs.push({
      href,
      label: known ?? readableSegment(segment),
      mono: known === undefined,
    });
  }
  return crumbs;
}
