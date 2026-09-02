import { describe, expect, it } from 'vitest';

import { ROUTES } from './routes.js';

/**
 * The route table's own guarantees.
 *
 * `read-only.test.ts` walks this table and asserts the denial on each entry. That claim is
 * only as good as the table: a route whose `probe` does not match its own pattern would be
 * "covered" by a case that actually exercises the 404 path, and a duplicate pattern would
 * hide a surface behind an earlier one.
 */

describe('the route table', () => {
  it('gives every route a probe path its own pattern matches', () => {
    for (const route of ROUTES) {
      expect(route.pattern.test(route.probe), `${route.id}: ${route.probe} vs ${String(route.pattern)}`).toBe(
        true,
      );
    }
  });

  it('anchors every pattern at both ends', () => {
    // An unanchored pattern matches a longer path, so a surface can be reached at a URL
    // nobody wrote down and the table stops describing what is served.
    for (const route of ROUTES) {
      expect(route.pattern.source.startsWith('^'), route.id).toBe(true);
      expect(route.pattern.source.endsWith('$'), route.id).toBe(true);
    }
  });

  it('uses no global or sticky flag', () => {
    // `lastIndex` survives a call on a `g` or `y` regex, so the SECOND request for a path
    // would miss. A shared regex with state is a route that works intermittently.
    for (const route of ROUTES) {
      expect(route.pattern.global, route.id).toBe(false);
      expect(route.pattern.sticky, route.id).toBe(false);
    }
  });

  it('has unique ids and unique probe paths', () => {
    expect(new Set(ROUTES.map((route) => route.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((route) => route.probe)).size).toBe(ROUTES.length);
  });

  it('resolves each probe to the route that declares it, and not to an earlier one', () => {
    for (const route of ROUTES) {
      const first = ROUTES.find((candidate) => candidate.pattern.test(route.probe));
      expect(first?.id, `${route.probe} is shadowed by ${first?.id ?? '(none)'}`).toBe(route.id);
    }
  });

  it('names a system and a summary for every route', () => {
    for (const route of ROUTES) {
      expect(route.system.length, route.id).toBeGreaterThan(0);
      expect(route.summary.length, route.id).toBeGreaterThan(0);
    }
  });
});
