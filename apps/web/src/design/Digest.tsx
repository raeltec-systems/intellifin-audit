/**
 * A 64-character digest, shown in full and announced in a usable form.
 *
 * **Why not `aria-label`.** Both digests shipped as
 * `<span className="ls-digest" aria-label={spoken}>` — and ARIA prohibits a name on a
 * generic element, which `<span>` and `<dd>` both are. A prohibited name is not applied,
 * so the accessible name was the 64 hex characters themselves: exactly the thing the
 * label existed to avoid, read out once per table row. Worse, axe reports
 * `aria-prohibited-attr` as INCOMPLETE rather than as a violation, and the browser gate
 * asserts only `results.violations`, so the accessibility check could not see it.
 *
 * The fix uses no ARIA role at all. The visible value is hidden from assistive
 * technology and an equivalent, readable sentence sits beside it in the same cell. That
 * works in every screen reader, needs nothing from the host element, and cannot be
 * silently dropped by a role rule.
 *
 * The visible text stays the FULL value: it is what an auditor compares against a
 * Procedure Version, and truncating it would make the surface useless for its one job.
 */
import { spokenDigest } from './digest-text';

export interface DigestProps {
  readonly value: string;
  /** What the digest is OF — "Registration" or "Binding". Named, so a row says which. */
  readonly label: string;
  /** `dd` on a definition list, `span` in a table cell. */
  readonly as?: 'span' | 'dd';
}


export function Digest({ value, label, as = 'span' }: DigestProps): React.JSX.Element {
  const Element = as;
  return (
    <Element className="ls-digest-cell">
      {/*
        `aria-hidden` on visible text is safe only because the equivalent text is right
        here, in the same element, and carries the same information.
      */}
      <span className="ls-mono ls-digest" aria-hidden="true">
        {value}
      </span>
      <span className="ls-visually-hidden">{spokenDigest(value, label)}</span>
    </Element>
  );
}
