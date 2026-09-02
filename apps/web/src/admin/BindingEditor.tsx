'use client';

import { useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
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
  ChangeBindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * One Population Source binding, and the form that changes it (FR-6, FR-41).
 *
 * The digest is shown in full above the form because it is the value under discussion: a
 * change to any of the five fields moves it, and a change to the name, the note or the
 * status does not. Showing it here makes that observable rather than asserted.
 *
 * The form is rendered with the row version the server produced for THIS page load, and
 * the Server Action sends it back as `expectedRowVersion`. A tab left open while somebody
 * else changed the binding is refused rather than allowed to blind-overwrite, so the
 * audit event never records a prior digest the administrator did not see — and a
 * retirement is never silently reverted.
 */

export interface BindingEditorProps {
  readonly binding: PopulationSourceBinding;
  /** Computed on the server by `bindingRowVersion`; see `BindingForm`. */
  readonly rowVersion: string;
  readonly referencingProcedures: number;
  readonly changeBinding: (fields: ChangeBindingFormFields) => Promise<BindingActionResult>;
}

export function BindingEditor({
  binding,
  rowVersion,
  referencingProcedures,
  changeBinding,
}: BindingEditorProps): React.JSX.Element {
  const [result, setResult] = useState<BindingActionResult | null>(null);
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
          <dd>
            {bindingKindLabel(binding.kind)}
            {binding.kind === 'manual-upload' ? (
              <p className="ls-caption">{MANUAL_UPLOAD_SENTENCE}</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Declared count</dt>
          <dd>
            {mechanismLabel(binding.declaredCountMechanism)}
            {declaresNoCount(binding.declaredCountMechanism) ? (
              <p className="ls-caption">{DECLARED_COUNT_MISSING_SENTENCE}</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{bindingStatusLabel(binding.status)}</dd>
        </div>
        <div>
          <dt>Binding digest</dt>
          <Digest as="dd" value={binding.digest} label="Binding" />
        </div>
        <div>
          <dt>Last changed (UTC)</dt>
          <dd>
            <time dateTime={binding.updatedAt}>
              {binding.updatedAt.replace('T', ' ').slice(0, 19)}
            </time>
          </dd>
        </div>
      </dl>

      <BindingForm
        binding={binding}
        rowVersion={rowVersion}
        referencingProcedures={referencingProcedures}
        onChange={changeBinding}
        onResult={(outcome) => {
          setResult(outcome);
          setAnnouncement((count) => count + 1);
        }}
        onStart={() => setResult(null)}
      />
    </div>
  );
}
