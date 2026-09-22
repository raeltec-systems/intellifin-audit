'use client';

import { useId, useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { Timestamp } from '../design/Timestamp';
import { DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { BindingForm, countMechanismWords, sourceKindWords } from './BindingForm';
import { bindingStatusLabel, declaresNoCount } from './bindings';
import {
  ADD_SOURCE_SUMMARY,
  INVENTORY_SEARCH_BOUNDED,
  SOURCE_SEARCH_LABEL,
  inventoryFilterSentence,
} from './administration-words';
import type {
  BindingActionResult,
  BindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * The population sources inventory (FR-6, FR-41; UI cleanup 2026-09-22, UX-43).
 *
 * **The inventory is first.** The walkthrough met a form eight fields long before the
 * first row of the table it was adding to, so an operator who came to check what was set
 * up had to scroll past the thing they were not doing. Adding is a disclosure at the
 * foot.
 *
 * **The table is compact and scannable**: what each source is called, how its records
 * arrive, whether the count can be checked, whether it is still in use, and when it last
 * changed. The fingerprint and the full list of fields moved to the source's own page and
 * under Technical details — they are what an auditor compares, not what a reader scans,
 * and a 64-character value in every row is a column nobody can read across.
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states: a banner per control is several live regions racing,
 * and a live region whose text does not change is not re-announced.
 *
 * The count column says "Nothing confirms it" in words and carries the consequence
 * beneath it. An empty cell or a dash is something a reader takes for "fine", and this is
 * the one value that stops every procedure bound to the source from being submitted.
 */

export interface BindingsPanelProps {
  readonly bindings: readonly PopulationSourceBinding[];
  /** How many rows this read could return at most. */
  readonly limit: number;
  /** The EXACT number of sources, so a truncated page says what it is a page OF. */
  readonly total: number;
  readonly createBinding: (fields: BindingFormFields) => Promise<BindingActionResult>;
}

export function BindingsPanel({
  bindings,
  limit,
  total,
  createBinding,
}: BindingsPanelProps): React.JSX.Element {
  const searchId = useId();
  const [result, setResult] = useState<BindingActionResult | null>(null);
  /** Increments on every reported outcome, so an identical message re-announces. */
  const [announcement, setAnnouncement] = useState(0);
  const [search, setSearch] = useState('');

  function report(outcome: BindingActionResult): void {
    setResult(outcome);
    setAnnouncement((count) => count + 1);
  }

  const needle = search.trim().toLowerCase();
  const shown =
    needle === ''
      ? bindings
      : bindings.filter((binding) => binding.displayName.toLowerCase().includes(needle));

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      <section className="ls-stack">
        <h2>Population sources</h2>

        {/*
          A filter over the rows this page holds, not a search of the table. There is no
          `<form>`: nothing is submitted, so nothing can be put in a URL by a submission
          that beats hydration. The caption below says what was searched, because a
          filtered list that did not say so would read as the whole deployment.
        */}
        <div className="ls-admin-filter">
          <div className="ls-dialog__field">
            <label htmlFor={searchId}>{SOURCE_SEARCH_LABEL}</label>
            <input
              className="ls-input"
              id={searchId}
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <DataTable<PopulationSourceBinding>
          caption="Every source a procedure can use: how its records arrive, whether its record count can be checked, and when it last changed."
          first={{
            header: 'Source',
            label: (binding) => binding.displayName,
            href: (binding) => `/administration/sources/${binding.bindingId}`,
          }}
          rowKey={(binding) => binding.bindingId}
          rows={shown}
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
            { key: 'status', header: 'Status', render: (row) => bindingStatusLabel(row.status) },
            {
              key: 'changed',
              header: 'Last changed',
              render: (row) => <Timestamp value={row.updatedAt} precision="minute" />,
            },
          ]}
          empty={
            needle === ''
              ? {
                  headline: 'No population source is set up yet.',
                  sentence:
                    'A procedure tests a list of records, and this is where that list comes from. Until one source is here, no procedure can be pointed at anything to test.',
                }
              : {
                  headline: 'No source matches this search.',
                  sentence:
                    'Every source on this page is listed when the search is cleared. An empty result is about the search, not about what is set up.',
                }
          }
        />

        <p className="ls-caption">
          {inventoryFilterSentence(shown.length, total, 'sources')}
          {bindings.length >= limit ? ` ${INVENTORY_SEARCH_BOUNDED}` : ''}
        </p>
        <p className="ls-caption">Open a source by its name to change or retire it.</p>
      </section>

      <details className="ls-disclosure">
        <summary>{ADD_SOURCE_SUMMARY}</summary>
        <div className="ls-disclosure__body">
          <BindingForm
            binding={null}
            // Nothing to be stale against: this form creates.
            rowVersion=""
            // A new source is referenced by nothing by definition, so this is not merely
            // the current value — it is the only one.
            referencingProcedures={0}
            affectedProcedures={[]}
            onCreate={createBinding}
            onResult={report}
            onStart={() => setResult(null)}
          />
        </div>
      </details>
    </div>
  );
}
