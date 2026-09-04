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
    expect(crumbsFor('/runs/RUN-2437/live')).toEqual([
      { href: '/runs', label: 'Runs', mono: false },
      { href: '/runs/RUN-2437', label: 'RUN-2437', mono: true },
      { href: '/runs/RUN-2437/live', label: 'live', mono: true },
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
    expect(() => crumbsFor('/runs/%E0%A4%A')).not.toThrow();
    expect(crumbsFor('/runs/%E0%A4%A')[1]?.label).toBe('%E0%A4%A');
  });

  it('decodes an escape sequence that is valid', () => {
    expect(readableSegment('RUN%2D1')).toBe('RUN-1');
  });
});

describe('a named sub-route', () => {
  it('reads as its name, not as an identifier', () => {
    expect(crumbsFor('/administration/registrations')).toEqual([
      { href: '/administration', label: 'Administration', mono: false },
      { href: '/administration/registrations', label: 'Target System registrations', mono: false },
    ]);
  });

  it('names the Population Source bindings surface, and the id below it stays raw', () => {
    // Every label in SECTION_LABELS needs a case: deleting this one left the suite
    // green, which makes the table a list nothing checks.
    expect(crumbsFor('/administration/sources')).toEqual([
      { href: '/administration', label: 'Administration', mono: false },
      { href: '/administration/sources', label: 'Population Source bindings', mono: false },
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

  it('leaves every other section alone', () => {
    expect(rendersOwnTrail('/runs/RUN-2437')).toBe(false);
    expect(rendersOwnTrail('/administration/sources')).toBe(false);
    expect(rendersOwnTrail('/procedures')).toBe(false);
  });

  it('answers a prototype-shaped segment as an identifier, not an inherited value', () => {
    // `PROCEDURE_NAMED_ROUTES['constructor']` inherits a truthy function from
    // Object.prototype; a bare index would call `/procedures/constructor` a named
    // route and let the shell render a second trail on a self-trailed page.
    expect(rendersOwnTrail('/procedures/constructor')).toBe(true);
    expect(rendersOwnTrail('/procedures/toString')).toBe(true);
  });
});
