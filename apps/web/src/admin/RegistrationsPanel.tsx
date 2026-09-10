'use client';

import { useState } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { Digest } from '../design/Digest';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import {
  CREDENTIAL_REFERENCE_SENTENCE,
  RETIRE_SYSTEM_SENTENCE,
  RegistrationForm,
  changedStamp,
  targetKindWord,
} from './RegistrationForm';
import {
  NEVER_PROBED_SENTENCE,
  actionLabel,
  connectivityLabel,
  statusLabel,
} from './registrations';
import type {
  RegistrationActionResult,
  RegistrationFormFields,
} from '../../app/administration/registrations/actions';

/**
 * The target systems surface (FR-8, AD-2, AD-10).
 *
 * The table is written to be SCANNED: what each system is called, what kind of thing it
 * is, where the agent goes, what it may do there, which credential it uses, whether it is
 * still in use, when it last changed, and what a worker last saw. Everything a reader
 * would otherwise have to know the platform's vocabulary to decode is written in words.
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states: a banner per control is several live regions racing,
 * and a live region whose text does not change is not re-announced.
 *
 * The fingerprint column shows the whole 64-character value. It is the number a Procedure
 * Version freezes and the thing an auditor compares, so truncating it would make the
 * column decorative — the one place it must not be.
 *
 * The last-checked column reads a row the WORKER writes. This page makes no outbound call
 * of any kind, and "Never probed" says so rather than showing a dash somebody could read
 * as "fine".
 */

export interface RegistrationsPanelProps {
  readonly registrations: readonly TargetSystemRegistration[];
  readonly limit: number;
  readonly createRegistration: (
    fields: RegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
}

export function RegistrationsPanel({
  registrations,
  limit,
  createRegistration,
}: RegistrationsPanelProps): React.JSX.Element {
  const [result, setResult] = useState<RegistrationActionResult | null>(null);
  /** Increments on every reported outcome, so an identical message re-announces. */
  const [announcement, setAnnouncement] = useState(0);

  function report(outcome: RegistrationActionResult): void {
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

      <RegistrationForm
        registration={null}
        // Nothing to be stale against: this form creates.
        rowVersion=""
        // A new system is referenced by nothing by definition, so this is not merely the
        // current value — it is the only one.
        referencingProcedures={0}
        onCreate={createRegistration}
        onResult={report}
        onStart={() => setResult(null)}
      />

      <section className="ls-stack">
        <h2>Target systems</h2>
        {/*
          The fingerprint column is the one thing on this table nobody can read off the
          screen, so its explanation sits directly above the rows it describes — which is
          also the only place `FINGERPRINT_EXPLANATION`'s "the settings below" is true.
        */}
        {registrations.length === 0 ? null : (
          <details className="ls-disclosure">
            <summary>What the {FINGERPRINT_WORD.toLowerCase()} column is</summary>
            <div className="ls-disclosure__body">
              <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>
            </div>
          </details>
        )}
        <DataTable<TargetSystemRegistration>
          caption="Every system the agent may look in: what kind it is, where the agent may go, what it may do there, which stored credential it uses, and what a worker last saw."
          first={{
            header: 'System',
            label: (registration) => registration.displayName,
            href: (registration) =>
              `/administration/registrations/${registration.registrationId}`,
          }}
          rowKey={(registration) => registration.registrationId}
          rows={registrations}
          columns={[
            { key: 'kind', header: 'What it is', render: (row) => targetKindWord(row.kind) },
            {
              key: 'locator',
              header: 'Where the agent goes',
              render: (row) =>
                row.kind === 'desktop' ? (
                  <span className="ls-mono">{row.applicationIdentity}</span>
                ) : (
                  <ul className="ls-plain-list">
                    {row.allowedOrigins.map((origin) => (
                      <li className="ls-mono" key={origin}>
                        {origin}
                      </li>
                    ))}
                  </ul>
                ),
            },
            {
              key: 'actions',
              header: 'What the agent may do here',
              render: (row) => row.permittedActions.map(actionLabel).join(', '),
            },
            {
              /**
               * EXPERIENCE.md and epics.md UX-DR31 both name this column. It is the
               * one field on the row that says WHICH credential a Run will use, and
               * "the credential is read-only" is only meaningful if a reader can see
               * which one was proven. It is an opaque reference and holds no secret.
               */
              key: 'credential',
              header: 'Which stored credential',
              render: (row) => <span className="ls-mono">{row.credentialRef}</span>,
            },
            {
              /** Status and the moment it last moved are one fact a reader checks together. */
              key: 'status',
              header: 'Status',
              render: (row) => (
                <>
                  <span>{statusLabel(row.status)}</span>
                  <p className="ls-caption">
                    Last changed{' '}
                    <time dateTime={row.updatedAt}>{changedStamp(row.updatedAt)}</time>
                  </p>
                </>
              ),
            },
            {
              key: 'connectivity',
              header: 'Last checked',
              render: (row) =>
                row.connectivity.state === 'never-probed' ? (
                  <>
                    <span>Never probed</span>
                    <p className="ls-caption">{NEVER_PROBED_SENTENCE}</p>
                  </>
                ) : (
                  <>
                    <span>{connectivityLabel(row.connectivity.state)}</span>
                    <p className="ls-caption">
                      Seen{' '}
                      <time dateTime={row.connectivity.observedAt ?? undefined}>
                        {changedStamp(row.connectivity.observedAt ?? '')}
                      </time>
                    </p>
                  </>
                ),
            },
            {
              key: 'digest',
              header: FINGERPRINT_WORD,
              render: (row) => <Digest value={row.digest} label="System" />,
            },
          ]}
          empty={{
            headline: 'No target system is set up yet.',
            sentence:
              'A procedure sends the agent to look in a system, and this is where those systems are listed. Until one is here, no procedure has anywhere to look and none can run.',
          }}
        />
        {registrations.length >= limit ? (
          <p className="ls-caption">
            Showing the first {limit} systems by name. This deployment has more; searching
            and paging them is not part of this release.
          </p>
        ) : null}
        <p className="ls-caption">
          Open a system by its name to change or retire it. {RETIRE_SYSTEM_SENTENCE}{' '}
          {CREDENTIAL_REFERENCE_SENTENCE}
        </p>
      </section>
    </div>
  );
}
