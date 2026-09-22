/**
 * Instants and dates, as a person reads them (UI cleanup 2026-09-21, finding UX-02).
 *
 * EXPERIENCE.md's Formats row used to fix ISO 8601 with `Z` on every surface, and the
 * owner's walkthrough met `2026-09-21T12:24:45.656Z` on every ordinary screen — a machine
 * spelling, with milliseconds, for a fact a person compares by eye. The contract now says:
 * readable UTC on ordinary surfaces, and the exact ISO instant in the `datetime` attribute
 * and under Technical details. `Timestamp.tsx` renders both; this module is the words.
 *
 * UTC, spelled out, every time. The environment is UTC everywhere (EXPERIENCE.md →
 * Foundation), the product holds no timezone preference, and a time with no zone beside it
 * is a time somebody reads in their own. When a per-person timezone exists, this is the one
 * place it lands.
 *
 * Hand-formatted rather than `Intl`, on purpose: ICU spells September `Sept` in some
 * versions and `Sep` in others, and a sentence the tests pin has to be the same sentence in
 * CI, in production and in a browser.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type TimePrecision = 'minute' | 'second';

/** The instant a value names, or `null` when it names none. */
export function parseInstant(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The exact instant, ISO 8601 in UTC with `Z`.
 *
 * `labels.ts` re-exports this as `utcStamp`, which is what every `datetime` attribute and
 * every technical detail prints. A value that names no instant is shown as it was stored:
 * a true statement about the row, where a fabricated date would not be.
 */
export function isoStamp(value: string | Date): string {
  const date = parseInstant(value);
  return date === null ? String(value) : date.toISOString();
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `21 Sep 2026`. A date-only string such as `2026-08-01` reads as that UTC day. */
export function readableDate(value: string | Date): string {
  const date = parseInstant(value);
  if (date === null) return String(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `12:24 UTC`, or `12:24:45 UTC` where the order of events matters. */
export function readableTime(value: string | Date, precision: TimePrecision = 'second'): string {
  const date = parseInstant(value);
  if (date === null) return String(value);
  const clock = `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
  return precision === 'second' ? `${clock}:${two(date.getUTCSeconds())} UTC` : `${clock} UTC`;
}

/**
 * `21 Sep 2026, 12:24:45 UTC`.
 *
 * Seconds by default: the surfaces that show several instants of one Run — started,
 * captured, registered, sealed — order them by the second, and a page that dropped it
 * would show two captures a second apart as the same moment. The "Updated" strips use
 * `'minute'`, because nobody reads a page's own read time to the second.
 */
export function readableStamp(value: string | Date, precision: TimePrecision = 'second'): string {
  const date = parseInstant(value);
  if (date === null) return String(value);
  return `${readableDate(date)}, ${readableTime(date, precision)}`;
}

/**
 * A period, in the shortest form that is still exact.
 *
 * `1–31 Aug 2026` for one month, `25 Aug – 3 Sep 2026` across a month, `20 Dec 2025 – 5 Jan
 * 2026` across a year. The contract's `2026-08-01 → 2026-08-31` (`periodText`) stays for
 * technical details and for anything a person types back in.
 */
export function readablePeriod(period: { readonly from: string; readonly to: string }): string {
  const from = parseInstant(period.from);
  const to = parseInstant(period.to);
  if (from === null || to === null) return `${period.from} – ${period.to}`;
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();
  if (sameMonth && from.getUTCDate() === to.getUTCDate()) return readableDate(from);
  if (sameMonth) return `${from.getUTCDate()}–${readableDate(to)}`;
  if (sameYear) return `${from.getUTCDate()} ${MONTHS[from.getUTCMonth()]} – ${readableDate(to)}`;
  return `${readableDate(from)} – ${readableDate(to)}`;
}
