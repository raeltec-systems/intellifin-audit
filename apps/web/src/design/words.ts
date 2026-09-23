/**
 * Small words every surface needs and each one used to spell for itself
 * (UI cleanup 2026-09-21, UX-31).
 */

/**
 * A count with its noun, pluralised: `1 Observation`, `2 Observations`, `1,842 records`.
 *
 * The walkthrough found `1 Observations`, `1 attempts` and `1 Step Executions` on the
 * session surfaces — a count and a noun joined by a template that never asked how many.
 * Thousands separators follow EXPERIENCE.md's Counts format.
 */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  const shown = Number.isFinite(count) ? count.toLocaleString('en-US') : String(count);
  return `${shown} ${count === 1 ? singular : plural}`;
}
