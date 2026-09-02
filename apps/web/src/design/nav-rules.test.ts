import { describe, expect, it } from 'vitest';

import { ROLES, type Role } from '@intellifin/domain';

import {
  ADMINISTRATION_ITEM,
  NAV_ITEMS,
  countDescription,
  isActiveNavItem,
  navItemsFor,
  showsAdministration,
} from './nav-rules';

/**
 * The sidebar's rules.
 *
 * Highlighting is specified in prose — "Run Detail, Exception Detail, Live View, and
 * Replay keep the Runs sidebar item highlighted; Builder, Procedure Detail, and Version
 * review keep Procedures highlighted" — and implemented as one prefix test. These cases
 * are the prose, restated as inputs.
 */

describe('the sidebar item order', () => {
  it('is Overview, Procedures, Runs, Review, with Administration last', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Overview',
      'Procedures',
      'Runs',
      'Review',
    ]);
    expect(ADMINISTRATION_ITEM.label).toBe('Administration');
  });

  it('puts a count on Runs and Review and on nothing else', () => {
    expect(NAV_ITEMS.filter((item) => item.count).map((item) => item.label)).toEqual([
      'Runs',
      'Review',
    ]);
  });
});

describe('Administration visibility', () => {
  it.each(ROLES)('%s sees Administration only if the domain policy allows it', (role: Role) => {
    expect(showsAdministration(role)).toBe(role === 'poc-administrator');
    expect(navItemsFor(role).includes(ADMINISTRATION_ITEM)).toBe(role === 'poc-administrator');
  });

  it('hides it from a signed-in person with no role at all', () => {
    expect(showsAdministration(null)).toBe(false);
    expect(navItemsFor(null)).toHaveLength(4);
  });
});

describe('which item a route highlights', () => {
  const cases: readonly [string, string | null][] = [
    // [pathname, the href that should be current — null for none]
    ['/', '/'],
    ['/runs', '/runs'],
    ['/runs/RUN-2437', '/runs'],
    ['/runs/RUN-2437/live', '/runs'],
    ['/runs/RUN-2437/replay', '/runs'],
    ['/runs/RUN-2437/exceptions/EX-1', '/runs'],
    ['/procedures', '/procedures'],
    ['/procedures/PRC-1', '/procedures'],
    ['/procedures/PRC-1/versions/2', '/procedures'],
    ['/procedures/new', '/procedures'],
    ['/review', '/review'],
    ['/review/RES-1', '/review'],
    ['/administration', '/administration'],
    ['/administration/users', '/administration'],
    // Not a nav route at all.
    ['/badges', null],
  ];

  it.each(cases)('%s highlights %s', (pathname, expected) => {
    const items = navItemsFor('poc-administrator');
    const current = items.filter((item) => isActiveNavItem(item.href, pathname));
    expect(current.map((item) => item.href)).toEqual(expected === null ? [] : [expected]);
  });

  it('never highlights Overview on a route that merely starts with a slash', () => {
    // `/` is a prefix of every path, so it is the one item matched exactly.
    expect(isActiveNavItem('/', '/runs')).toBe(false);
    expect(isActiveNavItem('/', '/')).toBe(true);
  });

  it('does not treat a look-alike prefix as the same section', () => {
    expect(isActiveNavItem('/runs', '/runs-archive')).toBe(false);
    expect(isActiveNavItem('/review', '/reviewer')).toBe(false);
  });
});

describe('what a count reads as', () => {
  it('counts one Run and one Result in the singular', () => {
    expect(countDescription('runs', 1)).toBe(' active Run');
    expect(countDescription('review', 1)).toBe(' Result awaiting your decision');
  });

  it('counts more than one in the plural', () => {
    expect(countDescription('runs', 4)).toBe(' active Runs');
    expect(countDescription('review', 4)).toBe(' Results awaiting your decision');
  });
});
