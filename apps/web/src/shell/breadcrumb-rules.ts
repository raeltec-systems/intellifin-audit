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
    const known = index === 0 ? sectionLabel(segment) : undefined;
    crumbs.push({
      href,
      label: known ?? readableSegment(segment),
      mono: known === undefined,
    });
  }
  return crumbs;
}
