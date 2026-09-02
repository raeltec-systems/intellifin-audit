import { escapeHtml } from './http.js';

/**
 * The markup shell every synthetic web surface renders into.
 *
 * It is deliberately NOT the product's design system. LoanCore and ProdConsole are other
 * people's applications: a Run reads them through an accessibility tree, and a surface
 * that looked like IntelliFin Audit would make it easy to forget which side of the
 * boundary a screenshot came from. Plain semantic HTML, labelled fields, no script.
 */
export function layout(options: {
  readonly system: string;
  readonly title: string;
  readonly body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} — ${escapeHtml(options.system)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1b1b1b; }
  header { border-bottom: 2px solid #444; padding-bottom: .5rem; margin-bottom: 1.5rem; }
  .banner { background: #fff4d6; border: 1px solid #b58900; padding: .5rem .75rem; margin-bottom: 1rem; }
  dl.record { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1.25rem; }
  dt { font-weight: bold; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: .35rem .6rem; text-align: left; }
  .note { background: #f2f2f2; border-left: 4px solid #999; padding: .5rem .75rem; }
</style>
</head>
<body>
<header>
  <p class="banner">Synthetic system. Northstar Financial Group is a fictional organization and every value on this page is invented.</p>
  <h1>${escapeHtml(options.system)}</h1>
  <p>Signed in as the read-only audit account <strong>audit.readonly</strong>. This account cannot change anything; the system refuses every write.</p>
</header>
<main>
${options.body}
</main>
</body>
</html>
`;
}

/** A labelled field. The label is the accessible name a Procedure Version declares. */
export function field(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

export function tableRows(rows: readonly (readonly string[])[]): string {
  return rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('\n');
}

export function tableHead(headers: readonly string[]): string {
  return `<tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr>`;
}
