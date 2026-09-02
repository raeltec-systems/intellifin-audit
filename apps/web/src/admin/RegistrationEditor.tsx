'use client';

import { useState } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { RegistrationForm } from './RegistrationForm';
import { NEVER_PROBED_SENTENCE, connectivityLabel, kindLabel } from './registrations';
import type {
  ChangeRegistrationFormFields,
  RegistrationActionResult,
} from '../../app/administration/registrations/actions';

/**
 * One registration, and the form that changes it (FR-8, AD-2).
 *
 * The digest is shown in full above the form because it is the value under discussion:
 * a change to any of the six fields moves it, and a change to the name or the note does
 * not. Showing it here makes that observable rather than asserted.
 *
 * The form is rendered with the digest the server produced for THIS page load, and the
 * Server Action sends it back as `expectedDigest`. A tab left open while somebody else
 * changed the system is refused rather than allowed to blind-overwrite, so the audit
 * event never records a prior value the administrator did not see.
 */

export interface RegistrationEditorProps {
  readonly registration: TargetSystemRegistration;
  readonly referencingProcedures: number;
  readonly changeRegistration: (
    fields: ChangeRegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
}

export function RegistrationEditor({
  registration,
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
          <dt>Kind</dt>
          <dd>{kindLabel(registration.kind)}</dd>
        </div>
        <div>
          <dt>Registration digest</dt>
          <dd className="ls-mono ls-digest">{registration.digest}</dd>
        </div>
        <div>
          <dt>Connectivity</dt>
          <dd>
            {connectivityLabel(registration.connectivity.state)}
            {registration.connectivity.state === 'never-probed' ? (
              <p className="ls-caption">{NEVER_PROBED_SENTENCE}</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Last changed (UTC)</dt>
          <dd>
            <time dateTime={registration.updatedAt}>
              {registration.updatedAt.replace('T', ' ').slice(0, 19)}
            </time>
          </dd>
        </div>
      </dl>

      <RegistrationForm
        registration={registration}
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
