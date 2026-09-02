import { describe, expect, it } from 'vitest';

import { crumbsFor, readableSegment, sectionLabel, subsectionLabel } from './breadcrumb-rules';

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
