'use client';

import { useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { Digest } from '../design/Digest';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import {
  BindingForm,
  changedStamp,
  countMechanismWords,
  sourceKindWords,
} from './BindingForm';
import { bindingStatusLabel, declaresNoCount } from './bindings';
import type {
  BindingActionResult,
  ChangeBindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * One population source, and the form that changes it (FR-6, FR-41).
 *
 * The panel above the form is what this source IS, in five lines a person can read
 * without scrolling into the controls: how its records arrive, whether its count can be
 * checked, whether it is still in use, its fingerprint and when it last moved. The
 * fingerprint is there because it is the value under discussion — changing how the
 * records arrive, where they are, the fields, the count check or the hidden fields moves
 * it, and changing the name, the note or the status does not. Showing it here makes that
 * observable rather than asserted.
 *
 * The form is rendered with the row version the server produced for THIS page load, and
 * the Server Action sends it back as `expectedRowVersion`. A tab left open while somebody
 * else changed the source is refused rather than allowed to blind-overwrite, so the audit
 * event never records a prior fingerprint the administrator did not see — and a
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
          <dt>How the records arrive</dt>
          <dd>
            {sourceKindWords(binding.kind).label}
            {binding.kind === 'manual-upload' ? (
              <p className="ls-caption">{MANUAL_UPLOAD_SENTENCE}</p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Record count confirmed by</dt>
          <dd>
            {countMechanismWords(binding.declaredCountMechanism).label}
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
          <dt>{FINGERPRINT_WORD}</dt>
          <Digest as="dd" value={binding.digest} label="Source" />
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>
            <time dateTime={binding.updatedAt}>{changedStamp(binding.updatedAt)}</time>
          </dd>
        </div>
      </dl>

      <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>

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
