import type { ReactNode } from 'react';

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
    readonly href: (row: Row) => string;
    readonly label: (row: Row) => string;
    /** Identifiers are monospace. */
    readonly mono?: boolean;
  };
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
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
 * The wrapper scrolls horizontally below 1240px so a wide table narrows instead of
 * clipping.
 */
export function DataTable<Row>({
  caption,
  first,
  columns,
  rows,
  rowKey,
}: DataTableProps<Row>): React.JSX.Element {
  return (
    <div className="ls-table-scroll">
      <table className="ls-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{first.header}</th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'ls-numeric' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              <th scope="row">
                <a className={first.mono ? 'ls-mono' : undefined} href={first.href(row)}>
                  {first.label(row)}
                </a>
              </th>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'ls-numeric' : undefined}>
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
