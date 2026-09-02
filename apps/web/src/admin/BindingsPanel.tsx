'use client';

import { useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { Digest } from '../design/Digest';
import { BindingForm } from './BindingForm';
import {
  bindingKindLabel,
  bindingStatusLabel,
  declaresNoCount,
  mechanismLabel,
} from './bindings';
import type {
  BindingActionResult,
  BindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * The Population Source bindings surface (FR-6, FR-41).
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states: a banner per control is several live regions racing,
 * and a live region whose text does not change is not re-announced.
 *
 * The digest column shows the whole 64-character value. It is the number a Procedure
 * Version freezes and the thing an auditor compares, so truncating it would make the
 * column decorative — the one place it must not be.
 *
 * The declared-count column says "None declared" in words and carries the consequence
 * beneath it. An empty cell or a dash is something a reader takes for "fine", and this is
 * the one value that stops every Procedure bound to the source from being submitted.
 */

export interface BindingsPanelProps {
  readonly bindings: readonly PopulationSourceBinding[];
  readonly limit: number;
  readonly createBinding: (fields: BindingFormFields) => Promise<BindingActionResult>;
}

export function BindingsPanel({
  bindings,
  limit,
  createBinding,
}: BindingsPanelProps): React.JSX.Element {
  const [result, setResult] = useState<BindingActionResult | null>(null);
  /** Increments on every reported outcome, so an identical message re-announces. */
  const [announcement, setAnnouncement] = useState(0);

  function report(outcome: BindingActionResult): void {
    setResult(outcome);
    setAnnouncement((count) => count + 1);
  }

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      <BindingForm
        binding={null}
        // Nothing to be stale against: this form creates.
        rowVersion=""
        // 0 until Epic 2 exists. A new binding is referenced by nothing by definition, so
        // this is not merely the current value — it is the only one.
        referencingProcedures={0}
        onCreate={createBinding}
        onResult={report}
        onStart={() => setResult(null)}
      />

      <section className="ls-stack">
        <h2>Registered Population Sources</h2>
        <DataTable<PopulationSourceBinding>
          caption="Every Population Source a Procedure can bind to, where it is found, the schema and expected count it declares, the fields masked in list views, and the binding digest a Procedure Version freezes."
          first={{
            header: 'Population Source',
            label: (binding) => binding.displayName,
            href: (binding) => `/administration/sources/${binding.bindingId}`,
          }}
          rowKey={(binding) => binding.bindingId}
          rows={bindings}
          columns={[
            {
              key: 'kind',
              header: 'Kind',
              render: (row) =>
                row.kind === 'manual-upload' ? (
                  <>
                    <span>{bindingKindLabel(row.kind)}</span>
                    <p className="ls-caption">{MANUAL_UPLOAD_SENTENCE}</p>
                  </>
                ) : (
                  bindingKindLabel(row.kind)
                ),
            },
            {
              key: 'location',
              header: 'Location',
              render: (row) =>
                row.location === '' ? (
                  // A manual upload names nowhere on purpose. Said in words rather than
                  // left blank, so an empty cell is never read as a missing value.
                  <span>Supplied with each Run</span>
                ) : (
                  <span className="ls-mono">{row.location}</span>
                ),
            },
            {
              key: 'schema',
              header: 'Declared schema',
              render: (row) => (
                <ol className="ls-plain-list">
                  {row.declaredSchema.map((field) => (
                    <li className="ls-mono" key={field}>
                      {field}
                    </li>
                  ))}
                </ol>
              ),
            },
            {
              key: 'mechanism',
              header: 'Declared count',
              render: (row) =>
                declaresNoCount(row.declaredCountMechanism) ? (
                  <>
                    <span>{mechanismLabel(row.declaredCountMechanism)}</span>
                    <p className="ls-caption">{DECLARED_COUNT_MISSING_SENTENCE}</p>
                  </>
                ) : (
                  mechanismLabel(row.declaredCountMechanism)
                ),
            },
            {
              key: 'sensitive',
              header: 'Masked fields',
              render: (row) =>
                row.sensitiveFields.length === 0 ? (
                  <span>None designated</span>
                ) : (
                  <ul className="ls-plain-list">
                    {row.sensitiveFields.map((field) => (
                      <li className="ls-mono" key={field}>
                        {field}
                      </li>
                    ))}
                  </ul>
                ),
            },
            { key: 'status', header: 'Status', render: (row) => bindingStatusLabel(row.status) },
            {
              key: 'digest',
              header: 'Binding digest',
              render: (row) => <Digest value={row.digest} label="Binding" />,
            },
          ]}
          empty={{
            headline: 'No Population Source is registered.',
            sentence:
              'Every source a Procedure can bind to would be listed here with its declared schema, its expected-count mechanism and its binding digest. An empty list does not mean no population needs testing; it means no Procedure can be bound to one at all.',
          }}
        />
        {bindings.length >= limit ? (
          <p className="ls-caption">
            Showing the first {limit} bindings by name. This deployment has more; searching
            and paging them is not part of this release.
          </p>
        ) : null}
        <p className="ls-caption">
          Bindings are never deleted. Retiring one keeps its digest resolvable, so a Run
          that froze it can still be read back. Open a source by its name to change or
          retire it.
        </p>
      </section>
    </div>
  );
}
