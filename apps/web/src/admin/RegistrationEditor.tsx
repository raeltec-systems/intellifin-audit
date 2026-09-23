'use client';

import { useState } from 'react';

import type { RegistrationAuditActivity } from '@intellifin/infrastructure';
import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Reference } from '../design/Reference';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { Digest } from '../design/Digest';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import { RegistrationForm, targetKindWord } from './RegistrationForm';
import { connectivityLabel, statusLabel } from './registrations';
import { runLifecycleWord } from '../runs/labels';
import {
  AUDIT_ACTIVITY_LABEL,
  AUDIT_ACTIVITY_NONE,
  AUDIT_ACTIVITY_NONE_SENTENCE,
  AUTH_ENDPOINT_NONE_SET,
  CONNECTION_CHECK_LABEL,
  CONNECTION_CHECK_NOT_RUN,
  CONNECTION_CHECK_NOT_RUN_SENTENCE,
  auditActivitySentence,
} from './administration-words';
import type {
  ChangeRegistrationFormFields,
  RegistrationActionResult,
} from '../../app/administration/registrations/actions';

/**
 * One target system, and the form that changes it (FR-8, AD-2).
 *
 * The panel above the form is what this system IS, in the lines a person can read
 * without scrolling into the controls: what kind of thing it is, whether it is still in
 * use, and the two facts UX-44 keeps apart — the connection check this page never runs,
 * and the last audit activity a completed Run recorded. The fingerprint and the full
 * locator/action lists moved under Technical details (UI cleanup 2026-09-22, UX-43):
 * they are what an auditor compares, not what a reader scans first.
 *
 * The form is rendered with the row version the server produced for THIS page load, and
 * the Server Action sends it back as `expectedRowVersion`. A tab left open while somebody
 * else changed the system is refused rather than allowed to blind-overwrite, so the audit
 * event never records a prior value the administrator did not see.
 */

export interface RegistrationEditorProps {
  readonly registration: TargetSystemRegistration;
  /** Computed on the server by `registrationRowVersion`; see `RegistrationForm`. */
  readonly rowVersion: string;
  readonly referencingProcedures: number;
  /** The Active Procedures {@link referencingProcedures} counts, by name (UX-46). */
  readonly affectedProcedures: readonly string[] | null;
  /** Reference names this deployment has declared, for the credential field (UX-45). */
  readonly knownCredentialReferences: readonly string[] | null;
  /**
   * The most recent terminal Run that used this system (UX-44).
   *
   * `null` means no terminal Run has named it yet — a fact distinct from "this page has
   * never checked the connection", which the connectivity column already states.
   */
  readonly auditActivity: RegistrationAuditActivity | null;
  readonly changeRegistration: (
    fields: ChangeRegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
}

export function RegistrationEditor({
  registration,
  rowVersion,
  referencingProcedures,
  affectedProcedures,
  knownCredentialReferences,
  auditActivity,
  changeRegistration,
}: RegistrationEditorProps): React.JSX.Element {
  const [result, setResult] = useState<RegistrationActionResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      <dl className="ls-definition">
        <div>
          <dt>What it is</dt>
          <dd>{targetKindWord(registration.kind)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(registration.status)}</dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>
            <Timestamp value={registration.updatedAt} precision="minute" />
          </dd>
        </div>

        {/*
          The two facts UX-44 requires. The walkthrough met one sentence claiming "no
          worker has observed this system yet" on a system a completed Run had just used
          — a statement about the environment that the environment contradicted. These
          are two separate reads and two separate rows, so neither can stand in for the
          other.
        */}
        <div>
          <dt>{CONNECTION_CHECK_LABEL}</dt>
          <dd>
            {registration.connectivity.state === 'never-probed' ? (
              <>
                <span>{CONNECTION_CHECK_NOT_RUN}</span>
                <p className="ls-caption">{CONNECTION_CHECK_NOT_RUN_SENTENCE}</p>
              </>
            ) : (
              <>
                <span>{connectivityLabel(registration.connectivity.state)}</span>
                <p className="ls-caption">
                  Seen{' '}
                  {registration.connectivity.observedAt === null ? null : (
                    <Timestamp value={registration.connectivity.observedAt} precision="minute" />
                  )}
                </p>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{AUDIT_ACTIVITY_LABEL}</dt>
          <dd>
            {auditActivity === null ? (
              <>
                <span>{AUDIT_ACTIVITY_NONE}</span>
                <p className="ls-caption">{AUDIT_ACTIVITY_NONE_SENTENCE}</p>
              </>
            ) : (
              <>
                <span>
                  {auditActivitySentence(
                    auditActivity.procedureName,
                    runLifecycleWord(auditActivity.state) ?? auditActivity.state,
                  )}
                </span>
                <p className="ls-caption">
                  <Reference kind="Run" value={auditActivity.runId} />
                  {' · initiated '}
                  <Timestamp value={auditActivity.initiatedAt} precision="minute" />
                  {auditActivity.endedAt === null ? null : (
                    <>
                      {', ended '}
                      <Timestamp value={auditActivity.endedAt} precision="minute" />
                    </>
                  )}
                </p>
              </>
            )}
          </dd>
        </div>

        {registration.kind === 'web' ? (
          <div>
            <dt>Authentication endpoint</dt>
            <dd>
              {registration.authenticationDestination === undefined ||
              registration.authenticationDestination === '' ? (
                <span>{AUTH_ENDPOINT_NONE_SET}</span>
              ) : (
                <span className="ls-mono">{registration.authenticationDestination}</span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      <TechnicalDetails>
        <dl className="ls-definition">
          <div>
            <dt>{FINGERPRINT_WORD}</dt>
            <Digest as="dd" value={registration.digest} label="System" />
          </div>
        </dl>
        <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>
        <div className="ls-dialog__field">
          <p>Where the agent may go</p>
          {registration.kind === 'desktop' ? (
            <p className="ls-mono">{registration.applicationIdentity}</p>
          ) : (
            <ol className="ls-plain-list">
              {registration.allowedOrigins.map((origin) => (
                <li className="ls-mono" key={origin}>
                  {origin}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="ls-dialog__field">
          <p>Which stored credential</p>
          <p className="ls-mono">{registration.credentialRef}</p>
        </div>
      </TechnicalDetails>

      <RegistrationForm
        registration={registration}
        rowVersion={rowVersion}
        referencingProcedures={referencingProcedures}
        affectedProcedures={affectedProcedures}
        knownCredentialReferences={knownCredentialReferences}
        onChange={changeRegistration}
        onResult={(outcome) => {
          setResult(outcome);
          setAnnouncement((count) => count + 1);
        }}
        onStart={() => setResult(null)}
      />
    </div>
  );
}
