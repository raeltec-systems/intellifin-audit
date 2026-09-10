'use client';

import { useState } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Digest } from '../design/Digest';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import {
  RegistrationForm,
  changedStamp,
  targetKindWord,
} from './RegistrationForm';
import { NEVER_PROBED_SENTENCE, connectivityLabel, statusLabel } from './registrations';
import type {
  ChangeRegistrationFormFields,
  RegistrationActionResult,
} from '../../app/administration/registrations/actions';

/**
 * One target system, and the form that changes it (FR-8, AD-2).
 *
 * The panel above the form is what this system IS, in five lines a person can read
 * without scrolling into the controls: what kind of thing it is, where the agent signs
 * in, whether it is still in use, its fingerprint and when it last moved. The fingerprint
 * is there because it is the value under discussion — changing where the agent may go,
 * what it may do, which credential it uses, the field labels or the confirming field
 * moves it, and changing the name or the note does not. Showing it here makes that
 * observable rather than asserted.
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
  readonly changeRegistration: (
    fields: ChangeRegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
}

export function RegistrationEditor({
  registration,
  rowVersion,
  referencingProcedures,
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
        {registration.kind === 'web' ? (
          <div>
            <dt>Sign-in form address</dt>
            <dd>
              {registration.authenticationDestination === undefined ||
              registration.authenticationDestination === '' ? (
                // Said in words rather than left blank: the agent refuses to enter a
                // credential without this, and an empty cell reads as "fine".
                <span>None set, so the agent never signs in here</span>
              ) : (
                <span className="ls-mono">{registration.authenticationDestination}</span>
              )}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(registration.status)}</dd>
        </div>
        <div>
          <dt>{FINGERPRINT_WORD}</dt>
          <Digest as="dd" value={registration.digest} label="System" />
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>
            {connectivityLabel(registration.connectivity.state)}
            {registration.connectivity.state === 'never-probed' ? (
              <p className="ls-caption">{NEVER_PROBED_SENTENCE}</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>
            <time dateTime={registration.updatedAt}>
              {changedStamp(registration.updatedAt)}
            </time>
          </dd>
        </div>
      </dl>

      <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>

      <RegistrationForm
        registration={registration}
        rowVersion={rowVersion}
        referencingProcedures={referencingProcedures}
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
