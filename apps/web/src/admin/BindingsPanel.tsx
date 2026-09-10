'use client';

import { useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { Digest } from '../design/Digest';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import {
  BindingForm,
  RETIRE_SOURCE_SENTENCE,
  changedStamp,
  countMechanismWords,
  sourceKindWords,
} from './BindingForm';
import { bindingStatusLabel, declaresNoCount } from './bindings';
import type {
  BindingActionResult,
  BindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * The population sources surface (FR-6, FR-41).
 *
 * The table is written to be SCANNED: what each source is called, how its records arrive,
 * where they are, which fields it provides, whether the count can be checked, whether it
 * is still in use and when it last changed. Everything a reader would otherwise have to
 * know the platform's vocabulary to decode is written in words.
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states: a banner per control is several live regions racing,
 * and a live region whose text does not change is not re-announced.
 *
 * The fingerprint column shows the whole 64-character value. It is the number a Procedure
 * Version freezes and the thing an auditor compares, so truncating it would make the
 * column decorative — the one place it must not be.
 *
 * The count column says "Nothing confirms it" in words and carries the consequence
 * beneath it. An empty cell or a dash is something a reader takes for "fine", and this is
 * the one value that stops every procedure bound to the source from being submitted.
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
        // A new source is referenced by nothing by definition, so this is not merely the
        // current value — it is the only one.
        referencingProcedures={0}
        onCreate={createBinding}
        onResult={report}
        onStart={() => setResult(null)}
      />

      <section className="ls-stack">
        <h2>Population sources</h2>
        {/*
          The fingerprint column is the one thing on this table nobody can read off the
          screen, so its explanation sits directly above the rows it describes — which is
          also the only place `FINGERPRINT_EXPLANATION`'s "the settings below" is true.
        */}
        {bindings.length === 0 ? null : (
          <details className="ls-disclosure">
            <summary>What the {FINGERPRINT_WORD.toLowerCase()} column is</summary>
            <div className="ls-disclosure__body">
              <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>
            </div>
          </details>
        )}
        <DataTable<PopulationSourceBinding>
          caption="Every source a procedure can use: how its records arrive, where they are, which fields it provides, whether its record count can be checked, and when it last changed."
          first={{
            header: 'Source',
            label: (binding) => binding.displayName,
            href: (binding) => `/administration/sources/${binding.bindingId}`,
          }}
          rowKey={(binding) => binding.bindingId}
          rows={bindings}
          columns={[
            {
              key: 'kind',
              header: 'How records arrive',
              render: (row) =>
                row.kind === 'manual-upload' ? (
                  <>
                    <span>{sourceKindWords(row.kind).label}</span>
                    <p className="ls-caption">{MANUAL_UPLOAD_SENTENCE}</p>
                  </>
                ) : (
                  sourceKindWords(row.kind).label
                ),
            },
            {
              key: 'location',
              header: 'Where to find it',
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
              /**
               * The fields and the hidden ones are ONE cell, because they are one list:
               * a hidden field is one of the declared fields, and showing them as two
               * columns invited a reader to look for a field in the second that could
               * only ever be in the first. The order is the file's own order, so it is an
               * `<ol>`.
               */
              key: 'schema',
              header: 'Fields provided',
              render: (row) => (
                <>
                  <ol className="ls-plain-list">
                    {row.declaredSchema.map((field) => (
                      <li className="ls-mono" key={field}>
                        {field}
                        {row.sensitiveFields.includes(field) ? (
                          <>
                            {' '}
                            <span className="ls-masked-tag">hidden in lists</span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {row.sensitiveFields.length === 0 ? (
                    <p className="ls-caption">No fields are hidden.</p>
                  ) : null}
                </>
              ),
            },
            {
              key: 'mechanism',
              header: 'Record count confirmed by',
              render: (row) =>
                declaresNoCount(row.declaredCountMechanism) ? (
                  <>
                    <span>{countMechanismWords(row.declaredCountMechanism).label}</span>
                    <p className="ls-caption">{DECLARED_COUNT_MISSING_SENTENCE}</p>
                  </>
                ) : (
                  countMechanismWords(row.declaredCountMechanism).label
                ),
            },
            {
              /** Status and the moment it last moved are one fact a reader checks together. */
              key: 'status',
              header: 'Status',
              render: (row) => (
                <>
                  <span>{bindingStatusLabel(row.status)}</span>
                  <p className="ls-caption">
                    Last changed{' '}
                    <time dateTime={row.updatedAt}>{changedStamp(row.updatedAt)}</time>
                  </p>
                </>
              ),
            },
            {
              key: 'digest',
              header: FINGERPRINT_WORD,
              render: (row) => <Digest value={row.digest} label="Source" />,
            },
          ]}
          empty={{
            headline: 'No population source is set up yet.',
            sentence:
              'A procedure tests a list of records, and this is where that list comes from. Until one source is here, no procedure can be pointed at anything to test.',
          }}
        />
        {bindings.length >= limit ? (
          <p className="ls-caption">
            Showing the first {limit} sources by name. This deployment has more; searching
            and paging them is not part of this release.
          </p>
        ) : null}
        <p className="ls-caption">
          Open a source by its name to change or retire it. {RETIRE_SOURCE_SENTENCE}
        </p>
      </section>
    </div>
  );
}
