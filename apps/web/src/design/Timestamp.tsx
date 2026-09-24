import { isoStamp, readableStamp, type TimePrecision } from './time';

/**
 * One instant, readable to a person and exact to a machine.
 *
 * The visible text is `21 Sep 2026, 12:24:45 UTC`; the `datetime` attribute and the
 * `title` carry the ISO 8601 instant, so a browser test, a screen reader with the
 * attribute exposed, and anybody who hovers can still get the exact value. This is the
 * ONE way an instant is rendered on an ordinary surface (UI cleanup 2026-09-21, UX-02);
 * `utcStamp` alone belongs under Technical details.
 */
export function Timestamp({
  value,
  precision = 'second',
}: {
  readonly value: string | Date;
  readonly precision?: TimePrecision;
}): React.JSX.Element {
  const iso = isoStamp(value);
  return (
    <time dateTime={iso} title={iso}>
      {readableStamp(value, precision)}
    </time>
  );
}
