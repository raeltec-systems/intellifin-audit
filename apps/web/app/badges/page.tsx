import type { Metadata } from 'next';

import { Banner } from '../../src/design/Banner';
import { DataTable } from '../../src/design/DataTable';
import { StatusBadge } from '../../src/design/StatusBadge';
import { Tabs } from '../../src/design/Tabs';
import { STATUS_FAMILIES, STATUS_VOCABULARY, type StatusState } from '../../src/design/status';
import { ConfirmDialogDemo } from './ConfirmDialogDemo';

export const metadata: Metadata = { title: 'Status vocabulary · IntelliFin Audit' };

/**
 * The badge gallery, and the reference rendering of the rest of the design system.
 *
 * Not linked from the nav: it is not a product surface. It exists so the axe gate has
 * one page that renders every badge in the vocabulary and one live instance of each
 * component — a focus trap cannot be tested against a dialog nothing opens, and a table
 * cannot be scanned before a surface has rows.
 *
 * It is protected like every other route: default-deny covers it without anybody
 * remembering to.
 *
 * Everything below the vocabulary is illustrative and belongs to no Run.
 */

interface ExampleRow {
  readonly run: string;
  readonly procedure: string;
  readonly lifecycle: StatusState<'run-lifecycle'>;
  readonly outcome: StatusState<'result-outcome'>;
  readonly gate: StatusState<'evidence-quality-gate'>;
  readonly exceptions: number;
}

const EXAMPLE_ROWS: readonly ExampleRow[] = [
  {
    run: 'RUN-0000',
    procedure: 'Example procedure',
    lifecycle: 'Completed',
    outcome: 'Pass',
    gate: 'Passed',
    exceptions: 0,
  },
  {
    run: 'RUN-0001',
    procedure: 'Example procedure',
    lifecycle: 'Awaiting Auditor',
    outcome: 'Pending Confirmation',
    gate: 'Not evaluated',
    exceptions: 2,
  },
];

export default function BadgeGalleryPage(): React.JSX.Element {
  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Status vocabulary</h1>
        <p>
          Every state in the nine rows of the status table, each with its own word and
          icon. Colour is never the only carrier of meaning.
        </p>
      </header>

      {STATUS_FAMILIES.map((family) => (
        <section key={family} aria-labelledby={`family-${family}`} className="ls-stack">
          <h2 id={`family-${family}`}>{STATUS_VOCABULARY[family].label}</h2>
          <div className="ls-badge-gallery">
            {Object.keys(STATUS_VOCABULARY[family].states).map((state) => (
              // The one place the table is walked by string key rather than by a
              // literal. `StatusState<F>` over the union of families narrows to
              // `never`, so the cast is what "iterate every row" costs; the runtime
              // lookup still throws on a state the family does not hold.
              <StatusBadge
                key={state}
                family={family}
                state={state as StatusState<typeof family>}
                size="md"
              />
            ))}
          </div>
        </section>
      ))}

      <section aria-labelledby="components-heading" className="ls-stack">
        <h2 id="components-heading">Component reference</h2>
        <Banner tone="info" title="Reference renderings.">
          The Run identifiers, Procedures and counts below are illustrative. They belong
          to no Run, and no control was tested to produce them.
        </Banner>

        <Tabs
          label="Component reference sections"
          current="#components-heading"
          tabs={[
            { href: '#components-heading', label: 'Components' },
            { href: '#table-heading', label: 'Data table' },
            { href: '#actions-heading', label: 'Actions' },
          ]}
        />

        <h3 id="table-heading">Data table</h3>
        <DataTable
          caption="Illustrative Runs. Every row's first cell is its only link; rows carry no click handler."
          first={{
            header: 'Run',
            href: (row) => `/runs/${row.run}`,
            label: (row) => row.run,
            mono: true,
          }}
          columns={[
            { key: 'procedure', header: 'Procedure', render: (row) => row.procedure },
            {
              key: 'lifecycle',
              header: 'Lifecycle',
              render: (row) => <StatusBadge family="run-lifecycle" state={row.lifecycle} />,
            },
            {
              key: 'outcome',
              header: 'Result outcome',
              render: (row) => <StatusBadge family="result-outcome" state={row.outcome} />,
            },
            {
              key: 'gate',
              header: 'Gate',
              render: (row) => (
                <StatusBadge family="evidence-quality-gate" state={row.gate} />
              ),
            },
            {
              key: 'exceptions',
              header: 'Exceptions',
              numeric: true,
              render: (row) => row.exceptions.toLocaleString('en-US'),
            },
          ]}
          rows={EXAMPLE_ROWS}
          rowKey={(row) => row.run}
        />

        <h3 id="actions-heading">Confirmation weights and unavailable actions</h3>
        <ConfirmDialogDemo />
      </section>
    </div>
  );
}
