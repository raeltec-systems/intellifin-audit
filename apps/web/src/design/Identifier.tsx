import { Fragment } from 'react';

/**
 * An identifier that wraps only at its hyphens.
 *
 * `.ls-mono` wraps anywhere (EXPERIENCE.md → Formats: "Long identifiers wrap"), which is
 * right for a 64-character digest and wrong for a UUID in a table column: the Runs table
 * gave its first column whatever width ten columns left over, and every Run id broke into
 * a ragged strip of four-character lines nobody could read or compare. The owner's
 * screenshot showed exactly that.
 *
 * A hyphen followed by a digit is NOT a line-break opportunity in any browser (UAX #14
 * keeps `-7000` together), so "wrap at the hyphens" needs the opportunities spelled out:
 * a `<wbr>` after each one. `<wbr>` has no text content, so copying the id, an accessible
 * name and a text locator all still see the whole value. `.ls-identifier` then turns
 * `overflow-wrap` back to `normal` so the segments are the only places it breaks.
 */
export function Identifier({ value }: { readonly value: string }): React.JSX.Element {
  const parts = value.split('-');
  return (
    <span className="ls-identifier">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <>
              -<wbr />
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
