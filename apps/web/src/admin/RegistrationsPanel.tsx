'use client';

import { useId, useState } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { Timestamp } from '../design/Timestamp';
import {
  CREDENTIAL_REFERENCE_SENTENCE,
  RETIRE_SYSTEM_SENTENCE,
  RegistrationForm,
  targetKindWord,
} from './RegistrationForm';
import { actionLabel, connectivityLabel, statusLabel } from './registrations';
import {
  ADD_SYSTEM_SUMMARY,
  CONNECTION_CHECK_NOT_RUN,
  CONNECTION_CHECK_NOT_RUN_SENTENCE,
  INVENTORY_SEARCH_BOUNDED,
  SYSTEM_SEARCH_LABEL,
  inventoryFilterSentence,
} from './administration-words';
import type {
  RegistrationActionResult,
  RegistrationFormFields,
} from '../../app/administration/registrations/actions';

/**
 * The systems inventory (FR-8, AD-2, AD-10; UI cleanup 2026-09-22, UX-43).
 *
 * **The inventory is first.** Adding is a disclosure at the foot, beside the two
 * sentences explaining a stored credential reference and retirement.
 *
 * **The table is compact and scannable**: what each system is called, what kind of thing
 * it is, whether it is still in use, when it last changed and whether a connection check
 * has run. The fingerprint, the full locator list, the permitted actions and the
 * credential reference moved to the system's own page and under Technical details — they
 * are what an auditor compares, not what a reader scans across a row.
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states.
 *
 * The connectivity column reads a row the WORKER writes. This page makes no outbound
 * call of any kind. It states only that the check has not run — never that "no worker
 * has observed this system", which a system a completed Run used contradicts; the last
 * audit activity that fact needs is a per-system read, on the system's own page (UX-44).
 */

export interface RegistrationsPanelProps {
  readonly registrations: readonly TargetSystemRegistration[];
  readonly limit: number;
  /** The EXACT number of systems, so a filtered inventory says what it is a page OF. */
  readonly total: number;
  readonly knownCredentialReferences: readonly string[] | null;
  readonly createRegistration: (
    fields: RegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
}

export function RegistrationsPanel({
  registrations,
  limit,
  total,
  knownCredentialReferences,
  createRegistration,
}: RegistrationsPanelProps): React.JSX.Element {
  const searchId = useId();
  const [result, setResult] = useState<RegistrationActionResult | null>(null);
  /** Increments on every reported outcome, so an identical message re-announces. */
  const [announcement, setAnnouncement] = useState(0);
  const [search, setSearch] = useState('');

  function report(outcome: RegistrationActionResult): void {
    setResult(outcome);
    setAnnouncement((count) => count + 1);
  }

  const needle = search.trim().toLowerCase();
  const shown =
    needle === ''
      ? registrations
      : registrations.filter((row) => row.displayName.toLowerCase().includes(needle));

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
        <h2>Systems</h2>

        {/*
          A filter over the rows this page holds, not a search of the table — the
          `BindingsPanel` shape. There is no `<form>`, so nothing can be put in a URL by
          a submission that beats hydration.
        */}
        <div className="ls-admin-filter">
          <div className="ls-dialog__field">
            <label htmlFor={searchId}>{SYSTEM_SEARCH_LABEL}</label>
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

        <DataTable<TargetSystemRegistration>
          caption="Every system the agent may look in: what kind it is, whether it is still in use, when it last changed and whether a connection check has run."
          first={{
            header: 'System',
            label: (registration) => registration.displayName,
            href: (registration) =>
              `/administration/registrations/${registration.registrationId}`,
          }}
          rowKey={(registration) => registration.registrationId}
          rows={shown}
          columns={[
            { key: 'kind', header: 'What it is', render: (row) => targetKindWord(row.kind) },
            {
              key: 'actions',
              header: 'What the agent may do here',
              render: (row) => row.permittedActions.map(actionLabel).join(', '),
            },
            { key: 'status', header: 'Status', render: (row) => statusLabel(row.status) },
            {
              key: 'changed',
              header: 'Last changed',
              render: (row) => <Timestamp value={row.updatedAt} precision="minute" />,
            },
            {
              key: 'connectivity',
              header: 'Connection check',
              render: (row) =>
                row.connectivity.state === 'never-probed' ? (
                  <>
                    <span>{CONNECTION_CHECK_NOT_RUN}</span>
                    <p className="ls-caption">{CONNECTION_CHECK_NOT_RUN_SENTENCE}</p>
                  </>
                ) : (
                  <>
                    <span>{connectivityLabel(row.connectivity.state)}</span>
                    {row.connectivity.observedAt === null ? null : (
                      <p className="ls-caption">
                        Seen <Timestamp value={row.connectivity.observedAt} precision="minute" />
                      </p>
                    )}
                  </>
                ),
            },
          ]}
          empty={
            needle === ''
              ? {
                  headline: 'No target system is set up yet.',
                  sentence:
                    'A procedure sends the agent to look in a system, and this is where those systems are listed. Until one is here, no procedure has anywhere to look and none can run.',
                }
              : {
                  headline: 'No system matches this search.',
                  sentence:
                    'Every system on this page is listed when the search is cleared. An empty result is about the search, not about what is set up.',
                }
          }
        />

        <p className="ls-caption">
          {inventoryFilterSentence(shown.length, total, 'systems')}
          {registrations.length >= limit ? ` ${INVENTORY_SEARCH_BOUNDED}` : ''}
        </p>
        <p className="ls-caption">
          Open a system by its name to change or retire it. {RETIRE_SYSTEM_SENTENCE}{' '}
          {CREDENTIAL_REFERENCE_SENTENCE}
        </p>
      </section>

      <details className="ls-disclosure">
        <summary>{ADD_SYSTEM_SUMMARY}</summary>
        <div className="ls-disclosure__body">
          <RegistrationForm
            registration={null}
            // Nothing to be stale against: this form creates.
            rowVersion=""
            // A new system is referenced by nothing by definition, so this is not merely
            // the current value — it is the only one.
            referencingProcedures={0}
            affectedProcedures={[]}
            knownCredentialReferences={knownCredentialReferences}
            onCreate={createRegistration}
            onResult={report}
            onStart={() => setResult(null)}
          />
        </div>
      </details>
    </div>
  );
}
