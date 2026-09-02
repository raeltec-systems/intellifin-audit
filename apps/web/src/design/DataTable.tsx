import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from './EmptyState';

export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  /** Right-aligned and monospace. DESIGN.md → Typography: monospace is a data type. */
  readonly numeric?: boolean;
  readonly render: (row: Row) => ReactNode;
}

interface DataTableProps<Row> {
  /** What the table lists and why. Read by assistive technology before the rows. */
  readonly caption: string;
  /**
   * The first column. It is separate from the rest because its cell is the row header
   * AND the row's only link — the two rules that make a row navigable without a
   * row-level click handler.
   */
  readonly first: {
    readonly header: string;
    /**
     * Where the row goes. OPTIONAL, and omitting it renders the label as plain text in
     * the same `<th scope="row">`.
     *
     * EXPERIENCE.md's rule is "every row's first cell is a link; no row-level click
     * handlers" — one rule with one purpose: a row must never be a click target a
     * keyboard cannot reach. A table whose rows have no detail surface satisfies that
     * rule by having no target at all, and inventing an `href` to a page that does not
     * exist would satisfy the letter of it while sending people to a 404. The property
     * that actually matters is still structural: there is no `onRowClick` prop here, so
     * a row cannot become one.
     */
    readonly href?: (row: Row) => string;
    readonly label: (row: Row) => string;
    /** Identifiers are monospace. */
    readonly mono?: boolean;
  };
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /**
   * What to say when there is nothing to list. Required, because "no rows" is a
   * statement about the environment and a header over an empty body is not one.
   */
  readonly empty: { readonly headline: string; readonly sentence: string };
}

/**
 * The data table.
 *
 * Four rules, all structural rather than optional: a `<caption>`, `<th scope="col">`
 * on every header, `<th scope="row">` on the first cell of every row, and that first
 * cell holding the row's link. There is no `onRowClick` prop, so a row cannot become a
 * click target that a keyboard never reaches — EXPERIENCE.md: "Every row's first cell
 * is a link; no row-level click handlers."
 *
 * Two things carry the responsive behaviour. The wrapper scrolls horizontally between
 * 1024px and 1239px; below 900px `globals.css` restyles the rows as label/value stacks,
 * which needs both the `data-label` on every cell (it becomes the label) and the
 * explicit ARIA roles here (`display: block` otherwise strips the table semantics that
 * `<th scope>` depends on).
 */
export function DataTable<Row>({
  caption,
  first,
  columns,
  rows,
  rowKey,
  empty,
}: DataTableProps<Row>): React.JSX.Element {
  if (rows.length === 0) {
    return <EmptyState headline={empty.headline} sentence={empty.sentence} />;
  }

  return (
    <div className="ls-table-scroll">
      <table className="ls-table" role="table">
        <caption>{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {first.header}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                role="columnheader"
                className={column.numeric ? 'ls-numeric' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row">
              <th scope="row" role="rowheader" data-label={first.header}>
                {first.href ? (
                  <Link className={first.mono ? 'ls-mono' : undefined} href={first.href(row)}>
                    {first.label(row)}
                  </Link>
                ) : (
                  <span className={first.mono ? 'ls-mono' : undefined}>{first.label(row)}</span>
                )}
              </th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  data-label={column.header}
                  className={column.numeric ? 'ls-numeric' : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
