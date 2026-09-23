import { describe, expect, it } from 'vitest';

import { isoStamp, parseInstant, readableDate, readablePeriod, readableStamp, readableTime } from './time';

/**
 * The readable formats (UI cleanup 2026-09-21, UX-02).
 *
 * Every sentence here is what a person sees instead of `2026-09-21T12:24:45.656Z`, so each
 * case pins the exact spelling — month abbreviation, comma, zone — rather than a shape.
 */
describe('a readable instant', () => {
  it('spells the date, the clock and the zone, and never a T or a Z', () => {
    expect(readableStamp('2026-09-21T12:24:45.656Z')).toBe('21 Sep 2026, 12:24:45 UTC');
    expect(readableStamp('2026-09-21T12:24:45.656Z', 'minute')).toBe('21 Sep 2026, 12:24 UTC');
    expect(readableStamp(new Date('2026-01-05T03:07:09Z'))).toBe('5 Jan 2026, 03:07:09 UTC');
  });

  it('reads an offset instant in UTC, so two people never see two times for one event', () => {
    expect(readableStamp('2026-09-21T14:24:45+02:00')).toBe('21 Sep 2026, 12:24:45 UTC');
  });

  it('shows a value that names no instant exactly as it was stored', () => {
    // A fabricated date would be a fact nobody measured; the stored text is true of the row.
    expect(readableStamp('not a date')).toBe('not a date');
    expect(readableDate('not a date')).toBe('not a date');
    expect(readableTime('not a date')).toBe('not a date');
    expect(parseInstant('not a date')).toBeNull();
  });

  it('keeps the exact ISO instant for the datetime attribute and technical details', () => {
    expect(isoStamp('2026-09-21T14:24:45+02:00')).toBe('2026-09-21T12:24:45.000Z');
    expect(isoStamp('x')).toBe('x');
  });

  it('reads a date-only value as that UTC day', () => {
    expect(readableDate('2026-08-01')).toBe('1 Aug 2026');
    expect(readableTime('2026-08-01', 'minute')).toBe('00:00 UTC');
  });
});

describe('a readable period', () => {
  it('collapses to one month, one year, or two dates, whichever is exact', () => {
    expect(readablePeriod({ from: '2026-08-01', to: '2026-08-31' })).toBe('1–31 Aug 2026');
    expect(readablePeriod({ from: '2026-08-25', to: '2026-09-03' })).toBe('25 Aug – 3 Sep 2026');
    expect(readablePeriod({ from: '2025-12-20', to: '2026-01-05' })).toBe('20 Dec 2025 – 5 Jan 2026');
    expect(readablePeriod({ from: '2026-08-01', to: '2026-08-01' })).toBe('1 Aug 2026');
  });

  it('falls back to the stored strings when either date does not parse', () => {
    expect(readablePeriod({ from: 'x', to: '2026-08-31' })).toBe('x – 2026-08-31');
  });
});
