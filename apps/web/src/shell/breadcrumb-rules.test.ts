import { describe, expect, it } from 'vitest';

import {
  crumbsFor,
  readableSegment,
  rendersOwnTrail,
  sectionLabel,
  subsectionLabel,
} from './breadcrumb-rules';

/**
 * The breadcrumb rules, including the two ways a path from the address bar can be
 * hostile: an escape sequence that does not decode, and a segment that names something
 * on `Object.prototype`.
 */

describe('which routes get a trail', () => {
  it('gives none to Overview or to a list route', () => {
    expect(crumbsFor('/')).toEqual([]);
    expect(crumbsFor('/runs')).toEqual([]);
    expect(crumbsFor('/procedures')).toEqual([]);
  });

  it('gives a detail route one crumb per segment, the last one current', () => {
    // Not a Run route: Story 3.11 made Run Detail trail itself, so the shell stands
    // down there. Administration still gets the shell's trail.
    expect(crumbsFor('/administration/registrations/REG-1')).toEqual([
      { href: '/administration', label: 'Administration', mono: false },
      { href: '/administration/registrations', label: 'Target systems', mono: false },
      { href: '/administration/registrations/REG-1', label: 'REG-1', mono: true },
    ]);
  });

  it('labels a known section and leaves an identifier as it is', () => {
    expect(sectionLabel('runs')).toBe('Runs');
    expect(sectionLabel('nothing-of-the-sort')).toBeUndefined();
  });
});

describe('hostile path segments', () => {
  it('does not inherit a label from Object.prototype', () => {
    // A plain `SECTION_LABELS[segment]` returns a FUNCTION here, and the crumb renders
    // the source of `Object.prototype.toString`.
    expect(sectionLabel('toString')).toBeUndefined();
    expect(sectionLabel('constructor')).toBeUndefined();
    expect(sectionLabel('__proto__')).toBeUndefined();
    expect(crumbsFor('/toString/x')).toEqual([
      { href: '/toString', label: 'toString', mono: true },
      { href: '/toString/x', label: 'x', mono: true },
    ]);
  });

  it('survives an escape sequence that cannot be decoded', () => {
    // `decodeURIComponent('%E0%A4%A')` throws URIError; unhandled, that is a 500 on
    // every page under the shell.
    expect(readableSegment('%E0%A4%A')).toBe('%E0%A4%A');
    // `/runs/%E0%A4%A` is still the URL anybody can type; it is checked below on a
    // route the shell trails, plus here for the throw itself.
    expect(() => crumbsFor('/runs/%E0%A4%A')).not.toThrow();
    expect(() => crumbsFor('/administration/%E0%A4%A')).not.toThrow();
    expect(crumbsFor('/administration/%E0%A4%A')[1]?.label).toBe('%E0%A4%A');
  });

  it('decodes an escape sequence that is valid', () => {
    expect(readableSegment('RUN%2D1')).toBe('RUN-1');
  });
});

describe('a named sub-route', () => {
  it('reads as its name, not as an identifier', () => {
    expect(crumbsFor('/administration/registrations')).toEqual([
      { href: '/administration', label: 'Administration', mono: false },
      { href: '/administration/registrations', label: 'Target systems', mono: false },
    ]);
  });

  it('names the population sources surface, and the id below it stays raw', () => {
    // Every label in SECTION_LABELS needs a case: deleting this one left the suite
    // green, which makes the table a list nothing checks.
    expect(crumbsFor('/administration/sources')).toEqual([
      { href: '/administration', label: 'Administration', mono: false },
      { href: '/administration/sources', label: 'Population sources', mono: false },
    ]);
  });

  it('still treats a real identifier under it as one', () => {
    const crumbs = crumbsFor('/administration/registrations/018f0000-0000-7000-8000-000000000001');
    expect(crumbs[2]).toEqual({
      href: '/administration/registrations/018f0000-0000-7000-8000-000000000001',
      label: '018f0000-0000-7000-8000-000000000001',
      mono: true,
    });
  });

  it('does not inherit a label from Object.prototype', () => {
    expect(subsectionLabel('/administration/constructor')).toBeUndefined();
    expect(subsectionLabel('/toString')).toBeUndefined();
  });
});

describe('surfaces that trail themselves', () => {
  const id = '018f4d0a-1c2b-7e3d-9a4b-5c6d7e8f9a0b';

  it('renders NO shell trail for a Procedure detail surface', () => {
    // Both trails are `<nav aria-label="Breadcrumb">`. Two of them on one page is two
    // landmarks a screen reader cannot tell apart, and the shell's shows a raw UUID
    // where UX-DR7 asks for the Control name. axe cannot catch it: `landmark-unique`
    // is a best-practice rule, so it never reaches `results.violations`.
    expect(rendersOwnTrail(`/procedures/${id}`)).toBe(true);
    expect(crumbsFor(`/procedures/${id}`)).toEqual([]);
    expect(rendersOwnTrail(`/procedures/${id}/builder`)).toBe(true);
    expect(crumbsFor(`/procedures/${id}/builder`)).toEqual([]);
  });

  it('still trails a NAMED route under Procedures, which renders no trail of its own', () => {
    expect(rendersOwnTrail('/procedures/new')).toBe(false);
    expect(crumbsFor('/procedures/new')).toEqual([
      { href: '/procedures', label: 'Procedures', mono: false },
      { href: '/procedures/new', label: 'new', mono: true },
    ]);
  });

  it('stands down on Run Detail and on every one of its five tabs', () => {
    // Story 3.10 shipped a page trail beside the shell's, which gave Run Detail two
    // `<nav aria-label="Breadcrumb">` landmarks nobody could tell apart — and the
    // accessibility gate could not see it, because `landmark-unique` is a best-practice
    // rule rather than a WCAG-tagged one and never reaches `results.violations`. The
    // page's trail is the one worth keeping: it knows the Control name and the tab.
    const id = '019823ab-0000-7000-8000-000000000001';
    for (const tab of ['', '/evidence', '/exceptions', '/review', '/timeline']) {
      expect(rendersOwnTrail(`/runs/${id}${tab}`), tab).toBe(true);
      expect(crumbsFor(`/runs/${id}${tab}`), tab).toEqual([]);
    }
  });

  it('leaves every other section alone', () => {
    expect(rendersOwnTrail('/administration/sources')).toBe(false);
    expect(rendersOwnTrail('/procedures')).toBe(false);
    // A list route has no parent, so it gets no trail either way.
    expect(rendersOwnTrail('/runs')).toBe(false);
    expect(crumbsFor('/runs')).toEqual([]);
  });

  it('answers a prototype-shaped segment as an identifier, not an inherited value', () => {
    // `PROCEDURE_NAMED_ROUTES['constructor']` inherits a truthy function from
    // Object.prototype; a bare index would call `/procedures/constructor` a named
    // route and let the shell render a second trail on a self-trailed page.
    expect(rendersOwnTrail('/procedures/constructor')).toBe(true);
    expect(rendersOwnTrail('/procedures/toString')).toBe(true);
  });
});
