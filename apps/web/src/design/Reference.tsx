import { shortReference } from './references';

/**
 * A short reference beside the thing it identifies: `Run bf4ea3e7`.
 *
 * The full identifier rides in `title`, and the surface that shows this puts the whole
 * value under Technical details, so nothing is lost — only moved out of the way of the
 * name a person actually reads (UI cleanup 2026-09-21, UX-02).
 */
export function Reference({
  kind,
  value,
}: {
  /** What kind of thing this is: `Run`, `Exception`, `Workspace`. */
  readonly kind: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <span className="ls-reference" title={value}>
      {kind} <span className="ls-mono">{shortReference(value)}</span>
    </span>
  );
}
