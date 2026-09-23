'use client';

import { useState } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { Digest } from '../design/Digest';
import { Timestamp } from '../design/Timestamp';
import { FINGERPRINT_EXPLANATION, FINGERPRINT_WORD } from '../design/plain-words';
import {
  BindingForm,
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
 * The panel above the form is what this source IS, in the lines a person can read
 * without scrolling into the controls: how its records arrive, whether its count can be
 * checked, whether it is still in use and when it last moved. The fingerprint, the full
 * field list and the hidden-field markers moved under Technical details
 * (UI cleanup 2026-09-22, UX-43): they are what an auditor compares, not what a reader
 * scans on the way to deciding whether to open the form.
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
  /** The Active Procedures {@link referencingProcedures} counts, by name (UX-46). */
  readonly affectedProcedures: readonly string[] | null;
  readonly changeBinding: (fields: ChangeBindingFormFields) => Promise<BindingActionResult>;
}

export function BindingEditor({
  binding,
  rowVersion,
  referencingProcedures,
  affectedProcedures,
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
          <dt>Last changed</dt>
          <dd>
            <Timestamp value={binding.updatedAt} precision="minute" />
          </dd>
        </div>
      </dl>

      <TechnicalDetails>
        <dl className="ls-definition">
          <div>
            <dt>{FINGERPRINT_WORD}</dt>
            <Digest as="dd" value={binding.digest} label="Source" />
          </div>
        </dl>
        <p className="ls-caption">{FINGERPRINT_EXPLANATION}</p>
        <div className="ls-dialog__field">
          <p>Fields this source provides</p>
          {binding.declaredSchema.length === 0 ? (
            <p className="ls-caption">No fields are declared.</p>
          ) : (
            <ol className="ls-plain-list">
              {binding.declaredSchema.map((field) => (
                <li className="ls-mono" key={field}>
                  {field}
                  {binding.sensitiveFields.includes(field) ? (
                    <>
                      {' '}
                      <span className="ls-masked-tag">hidden in lists</span>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {binding.sensitiveFields.length === 0 ? (
            <p className="ls-caption">No fields are hidden.</p>
          ) : null}
        </div>
        <div className="ls-dialog__field">
          <p>Where to find it</p>
          <p className="ls-caption">
            {binding.location === '' ? 'Supplied with each Run.' : <span className="ls-mono">{binding.location}</span>}
          </p>
        </div>
      </TechnicalDetails>

      <BindingForm
        binding={binding}
        rowVersion={rowVersion}
        referencingProcedures={referencingProcedures}
        affectedProcedures={affectedProcedures}
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
