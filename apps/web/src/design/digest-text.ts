/**
 * How a 64-character digest is announced to assistive technology.
 *
 * A plain `.ts` module, not part of `Digest.tsx`: the unit suite runs in the `node`
 * environment with no JSX transform, so a test that imported the component to reach
 * this function would fail to parse the file rather than exercise the rule.
 */
export function spokenDigest(value: string, label: string): string {
  const head = value.slice(0, 4).split('').join(' ');
  const tail = value.slice(-4).split('').join(' ');
  return `${label} digest starting ${head}, ending ${tail}. The full 64-character value is shown.`;
}
