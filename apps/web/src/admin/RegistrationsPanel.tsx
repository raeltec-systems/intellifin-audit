'use client';

import { useState } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { RegistrationForm } from './RegistrationForm';
import {
  NEVER_PROBED_SENTENCE,
  actionLabel,
  connectivityLabel,
  kindLabel,
  spokenDigest,
  statusLabel,
} from './registrations';
import type {
  RegistrationActionResult,
  RegistrationFormFields,
} from '../../app/administration/registrations/actions';

/**
 * The Target System registrations surface (FR-8, AD-2, AD-10).
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter, for
 * the reasons `UsersPanel` states: a banner per control is several live regions racing,
 * and a live region whose text does not change is not re-announced.
 *
 * The digest column shows the whole 64-character value. It is the number a Procedure
 * Version freezes and the thing an auditor compares, so truncating it would make the
 * column decorative — the one place it must not be.
 *
 * The connectivity column reads a row the WORKER writes. This page makes no outbound
 * call of any kind, and "Never probed" says so rather than showing a dash somebody could
 * read as "fine".
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
        // 0 until Epic 2 exists. A new registration is referenced by nothing by
        // definition, so this is not merely the current value — it is the only one.
        referencingProcedures={0}
        onCreate={createRegistration}
        onResult={report}
        onStart={() => setResult(null)}
      />

      <section className="ls-stack">
        <h2>Registered Target Systems</h2>
        <DataTable<TargetSystemRegistration>
          caption="Every Target System the agent may reach, the read actions it is permitted, its registration digest, and what a worker last observed about it."
          first={{
            header: 'System',
            label: (registration) => registration.displayName,
            href: (registration) =>
              `/administration/registrations/${registration.registrationId}`,
          }}
          rowKey={(registration) => registration.registrationId}
          rows={registrations}
          columns={[
            { key: 'kind', header: 'Kind', render: (row) => kindLabel(row.kind) },
            {
              key: 'locator',
              header: 'Origin or application',
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
              /**
               * EXPERIENCE.md and epics.md UX-DR31 both name this column. It is the
               * one field on the row that says WHICH credential a Run will use, and
               * "the credential is read-only" is only meaningful if a reader can see
               * which one was proven. It is an opaque reference and holds no secret.
               */
              key: 'credential',
              header: 'Credential reference',
              render: (row) => <span className="ls-mono">{row.credentialRef}</span>,
            },
            {
              key: 'actions',
              header: 'Permitted read actions',
              render: (row) => row.permittedActions.map(actionLabel).join(', '),
            },
            { key: 'status', header: 'Status', render: (row) => statusLabel(row.status) },
            {
              key: 'digest',
              header: 'Registration digest',
              render: (row) => (
                <span className="ls-mono ls-digest" aria-label={spokenDigest(row.digest)}>
                  {row.digest}
                </span>
              ),
            },
            {
              key: 'connectivity',
              header: 'Connectivity',
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
                      Observed{' '}
                      <time dateTime={row.connectivity.observedAt ?? undefined}>
                        {(row.connectivity.observedAt ?? '').replace('T', ' ').slice(0, 19)} UTC
                      </time>
                    </p>
                  </>
                ),
            },
          ]}
          empty={{
            headline: 'No Target System is registered.',
            sentence:
              'Every system the agent may read would be listed here with the actions it is permitted and its registration digest. An empty list does not mean the agent is restricted to nothing safely; it means no Procedure can run at all.',
          }}
        />
        {registrations.length >= limit ? (
          <p className="ls-caption">
            Showing the first {limit} registrations by name. This deployment has more;
            searching and paging them is not part of this release.
          </p>
        ) : null}
        <p className="ls-caption">
          Registrations are never deleted. Retiring one keeps its digest resolvable, so a
          Run that froze it can still be read back. Open a system by its name to change or
          retire it.
        </p>
      </section>
    </div>
  );
}
