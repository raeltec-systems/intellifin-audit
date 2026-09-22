import { describe, expect, it } from 'vitest';

import { periodNamedIn } from './authoring-period.js';

describe('periodNamedIn — the period an auditor names in their own request (UX-09)', () => {
  it.each([
    ['employees terminated during August 2026', { from: '2026-08-01', to: '2026-08-31' }],
    ['Include employees terminated in Aug 2026, excluding contractors', { from: '2026-08-01', to: '2026-08-31' }],
    ['leavers between 1–31 August 2026', { from: '2026-08-01', to: '2026-08-31' }],
    ['leavers from 1 to 15 September 2026', { from: '2026-09-01', to: '2026-09-15' }],
    ['from 1 August 2026 to 15 September 2026', { from: '2026-08-01', to: '2026-09-15' }],
    ['from 20 December to 5 January 2027', null],
    ['20 December 2026 – 5 January 2027', { from: '2026-12-20', to: '2027-01-05' }],
    ['2026-08-01 to 2026-08-31', { from: '2026-08-01', to: '2026-08-31' }],
    ['July to September 2026', { from: '2026-07-01', to: '2026-09-30' }],
    ['terminated in February 2028', { from: '2028-02-01', to: '2028-02-29' }],
    ['terminated on 3 August 2026', { from: '2026-08-03', to: '2026-08-03' }],
    ['August 2026, that is 1–31 August 2026', { from: '2026-08-01', to: '2026-08-31' }],
  ])('%s', (text, expected) => {
    expect(periodNamedIn(text)).toEqual(expected);
  });

  it('names nothing when the request names no dates', () => {
    expect(periodNamedIn('all terminated employees, excluding contractors')).toBeNull();
    expect(periodNamedIn('')).toBeNull();
    expect(periodNamedIn('the 2026 annual review')).toBeNull();
  });

  it('refuses to choose between two different periods', () => {
    expect(periodNamedIn('August 2026, or maybe September 2026')).toBeNull();
  });

  it('refuses an impossible date rather than rolling it over', () => {
    // `Date.UTC(2026, 1, 30)` is 2 March; a period nobody named must never be proposed.
    expect(periodNamedIn('from 30 February 2026 to 31 March 2026')).toBeNull();
    expect(periodNamedIn('2026-02-30 to 2026-03-31')).toBeNull();
  });

  it('refuses a range whose end is before its start', () => {
    expect(periodNamedIn('31 August 2026 to 1 August 2026')).toBeNull();
  });
});
