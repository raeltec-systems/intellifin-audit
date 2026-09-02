import { countDeclaration, datasets } from './fixtures.js';
import { escapeHtml, html, type NorthstarResponse } from './http.js';
import { layout, tableHead, tableRows } from './page.js';

/**
 * ProdConsole — the synthetic production configuration surface (addendum A.2, P-4).
 *
 * The page publishes three things a Run must be able to extract: the parameter values, the
 * signed snapshot identifier, and the expected parameter count.
 *
 * The count is READ FROM THE GENERATED FILE, never counted here and never typed here. If
 * this page counted its own rows the declaration would agree with the page by
 * construction, which is the one thing an independently declared count must not do — a
 * partial extraction would then reconcile perfectly against a number derived from the same
 * partial read.
 */

const SYSTEM = 'ProdConsole';

export function home(): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'Console',
      body: `<h2>Console</h2>
<ul><li><a href="/prodconsole/configuration">Production configuration</a></li></ul>
<p class="note">This account holds read access only.</p>`,
    }),
  );
}

export function configuration(): NorthstarResponse {
  const data = datasets.prodconsole();
  const declared = countDeclaration('prodconsole-parameters.count.json');
  const rows = data.observed_parameters.map((parameter) => [
    parameter.parameter,
    parameter.observed_value,
    // Served VERBATIM as text. One description carries a prompt-like string; it is DATA.
    parameter.description,
  ]);

  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'Production configuration',
      body: `<h2>Production configuration</h2>
<dl class="record">
<dt>Snapshot identifier</dt><dd id="snapshot-id">${escapeHtml(data.snapshot.snapshot_id)}</dd>
<dt>Snapshot taken at</dt><dd id="snapshot-taken-at">${escapeHtml(data.snapshot.taken_at)}</dd>
<dt>Snapshot signature scheme</dt><dd>${escapeHtml(data.snapshot.signature_scheme)}</dd>
<dt>Expected parameter count</dt><dd id="expected-parameter-count">${String(declared.declared_count)}</dd>
</dl>
<table>
<caption>Production parameters in effect</caption>
${tableHead(['Parameter', 'Value', 'Description'])}
${tableRows(rows)}
</table>
<p class="note">The expected parameter count is published by the configuration registry, not counted by this page. An extraction that reads fewer parameters than the count is incomplete.</p>`,
    }),
  );
}
