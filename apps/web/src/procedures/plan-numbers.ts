/**
 * How a plan's own numbers are said to a person.
 *
 * The executable plan freezes `10000`, `3600` and `1000000`, and printing those at an
 * auditor is the same defect as printing a domain field name at one: correct, and not
 * what the reader is trying to find out. These render the SAME frozen values in the
 * form somebody reads — never a different value, never a rounded one.
 *
 * The read-only contract preview keeps the exact digits beside them, because that is
 * the surface whose job is to be checked rather than skimmed.
 */

/** `1000000` → `1,000,000`. Grouping only; the value is untouched. */
export function countWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const digits = String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${digits}` : digits;
}

/** `3600` → `1 hour`; `90` → `1 minute 30 seconds`. Exact, never rounded. */
export function durationWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return `${countWords(seconds)} seconds`;
  const whole = Math.trunc(seconds);
  const hours = Math.trunc(whole / 3600);
  const minutes = Math.trunc((whole % 3600) / 60);
  const rest = whole % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${countWords(hours)} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} second${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}
