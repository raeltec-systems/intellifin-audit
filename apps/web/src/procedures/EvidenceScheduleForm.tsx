'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  EVIDENCE_DRAFT_LIMITS,
  EVIDENCE_DRAFT_MESSAGES,
  FREQUENCIES,
  GROUNDING_EVIDENCE_TYPES,
  PERIOD_DERIVATION_RULES,
  hasAgentDrivenTarget,
  evidenceGroundingMessage,
  evidenceBlockersFor,
  type EvidenceRequirementInput,
  type Frequency,
  type GroundingEvidenceType,
} from '@intellifin/domain';
import type { ProcedureVersionView, UpdateEvidenceDraftResult } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { useSection } from './use-section';

/**
 * Evidence Requirements and the Schedule (FR-9, FR-10, scoped to this story).
 *
 * Two separate forms sharing one Draft and one row-version token — the same shape
 * `TargetSelectionForm`/`AuditInstructionsForm` use for the Target System section. Both
 * read `draft.evidenceBlockers`, the completeness diagnostic the repository derives from
 * the CURRENT Population Source binding and Schedule (`evidenceBlockersFor`); it is
 * never a save-time refusal, and the Population Source editor shows the identical
 * sentence so the pairing reads the same on both sections.
 */

const GROUNDING_LABEL: Readonly<Record<GroundingEvidenceType, string>> = {
  'structural-snapshot': 'Structural Snapshot',
  'source-file-excerpt': 'Source file excerpt',
};

const FREQUENCY_LABEL: Readonly<Record<Frequency, string>> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function inputsFrom(draft: ProcedureVersionView): readonly EvidenceRequirementInput[] {
  return draft.evidenceRequirements.map(({ attributeName, modelRead, groundedBy, screenshot, recordingSegment }) => ({
    attributeName,
    modelRead,
    groundedBy,
    screenshot,
    recordingSegment,
  }));
}

const PERIOD_LABEL: Readonly<Record<Frequency, string>> = {
  once: 'The explicit Period entered for this Procedure.',
  daily: 'Previous calendar day, in UTC.',
  weekly: 'Previous Monday through Sunday, in UTC.',
  monthly: 'Previous calendar month, in UTC.',
};
const UNKNOWN_OUTCOME = 'The save response was lost. The change may have been saved. Reload to review the saved version before trying again.';

export interface EvidenceRequirementsFormProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: { readonly section: 'evidence-requirements'; readonly requirements: readonly EvidenceRequirementInput[] } },
  ) => Promise<UpdateEvidenceDraftResult>;
}

export function EvidenceRequirementsForm({ draft, rowVersion, onSave }: EvidenceRequirementsFormProps): React.JSX.Element {
  const id = useId();
  const platformCaptured = hasAgentDrivenTarget(draft.targets);
  const normalize = (requirements: readonly EvidenceRequirementInput[]): readonly EvidenceRequirementInput[] => requirements.map((requirement) => ({
    ...requirement,
    groundedBy: platformCaptured && !requirement.groundedBy.includes('structural-snapshot')
      ? [...requirement.groundedBy, 'structural-snapshot'] : requirement.groundedBy,
    screenshot: platformCaptured || requirement.screenshot,
  }));
  const section = useSection(inputsFrom(draft), rowVersion, normalize);
  const requirements = section.value;
  const requirementsRef = { get current() { return section.current.current.value; } };
  const setRequirements = (value: readonly EvidenceRequirementInput[]) => section.edit(value);
  const nextId = useRef(0);
  const rowIds = useRef<string[]>([]);
  if (rowIds.current.length > requirements.length) rowIds.current.length = requirements.length;
  while (rowIds.current.length < requirements.length) rowIds.current.push(`${id}-row-${nextId.current++}`);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { setTouched(new Set()); }, [section.baseline]);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateEvidenceDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  // Platform-captured is recorded from the CURRENT Target System selection, never a
  // choice offered here. The command recomputes it authoritatively at save time; this
  // preview disables the fields it would force so nobody is asked a question with no
  // effect on the outcome.

  function change(index: number, edit: Partial<EvidenceRequirementInput>): void {
    const next = requirementsRef.current.map((requirement, i) => (i === index ? { ...requirement, ...edit } : requirement));
    setRequirements(next);
    setResult(null);
  }

  function toggleGrounding(index: number, kind: GroundingEvidenceType, checked: boolean): void {
    const current = requirementsRef.current[index];
    if (current === undefined) return;
    const groundedBy = checked
      ? [...current.groundedBy, kind]
      : current.groundedBy.filter((entry) => entry !== kind);
    change(index, { groundedBy });
  }

  function errorFor(requirement: EvidenceRequirementInput): string | null {
    if (requirement.attributeName.trim() === '') return EVIDENCE_DRAFT_MESSAGES.ATTRIBUTE;
    if (requirements.filter((other) => other.attributeName.trim().toLowerCase() === requirement.attributeName.trim().toLowerCase()).length > 1) return `Attribute "${requirement.attributeName}": ${EVIDENCE_DRAFT_MESSAGES.DUPLICATE}`;
    if (!platformCaptured && !requirement.modelRead && requirement.groundedBy.length === 0) return evidenceGroundingMessage(requirement.attributeName);
    return null;
  }

  const limitReached = requirements.length >= EVIDENCE_DRAFT_LIMITS.requirements;

  async function save(): Promise<void> {
    if (saving.current || section.conflict || unknownOutcome) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    const normalized = normalize(requirementsRef.current);
    section.begin(normalized);
    try {
      const outcome = await onSave({
        procedureId: draft.procedureId,
        versionId: draft.versionId,
        expectedRowVersion: section.current.current.token,
        edit: { section: 'evidence-requirements', requirements: normalized },
      });
      const unchanged = section.finish(outcome.ok ? outcome.rowVersion : undefined);
      setResult(outcome.ok && !unchanged ? null : outcome);
    } catch {
      section.finish();
      setUnknownOutcome(true);
      setResult(null);
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  const anyError = requirements.some((requirement) => errorFor(requirement) !== null);

  return (
    <div className="ls-stack">
      {section.conflict ? <><Banner tone="warning" title="Evidence Requirements changed in another session. Review the saved values before replacing them." /><Button type="button" onClick={() => { section.reset(); setResult(null); }}>Use saved Evidence Requirements</Button></> : null}
      {unknownOutcome ? <><Banner tone="warning" title={UNKNOWN_OUTCOME} /><Button type="button" onClick={() => window.location.reload()}>Reload saved version</Button></> : null}
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={
            result.ok
              ? result.changed
                ? 'Saved. Evidence Requirements are recorded in the audit chain.'
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}
      <p id={`${id}-grounding-help`}>
        Every attribute value must be grounded in a Structural Snapshot or a source file excerpt, or declared
        model-read. A screenshot or a recording segment alone never grounds an attribute value.
      </p>
      {platformCaptured ? (
        <p className="ls-caption">
          At least one selected Target System is agent-driven, so Structural Snapshot and screenshot are
          platform-captured for every attribute here and cannot be unset.
        </p>
      ) : null}
      <form
        method="post"
        className="ls-admin__form ls-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current || section.conflict || unknownOutcome) return;
          setResult(null);
          setSubmitted(true);
          setTouched(new Set(rowIds.current));
          if (anyError) return;
          setConfirming(true);
        }}
      >
        {requirements.length === 0 ? <p>No Evidence Requirement is defined yet.</p> : null}
        {requirements.map((requirement, index) => {
          const fieldId = rowIds.current[index]!;
          const error = (submitted || touched.has(fieldId)) ? errorFor(requirement) : null;
          const nameError = requirement.attributeName.trim() === '' || requirements.filter((other) => other.attributeName.trim().toLowerCase() === requirement.attributeName.trim().toLowerCase()).length > 1;
          const forced = platformCaptured;
          return (
            <fieldset className="ls-stack" key={fieldId} onBlur={() => setTouched((current) => new Set([...current, fieldId]))}>
              <legend>Evidence Requirement {index + 1}</legend>
              <div className="ls-dialog__field">
                <label htmlFor={`${fieldId}-name`}>Attribute name</label>
                <input
                  className="ls-input"
                  id={`${fieldId}-name`}
                  value={requirement.attributeName}
                  maxLength={EVIDENCE_DRAFT_LIMITS.attributeName}
                  aria-describedby={`${fieldId}-error`}
                  aria-invalid={(error !== null && nameError) || undefined}
                  onChange={(event) => change(index, { attributeName: event.target.value })}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={requirement.modelRead}
                  onChange={(event) => change(index, { modelRead: event.target.checked })}
                />{' '}
                Declare model-read (exempt from deterministic grounding)
              </label>
              <fieldset aria-invalid={(error !== null && !nameError) || undefined} aria-describedby={`${fieldId}-error`}>
                <legend>Grounded by</legend>
                {GROUNDING_EVIDENCE_TYPES.map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={requirement.groundedBy.includes(kind) || (forced && kind === 'structural-snapshot')}
                      disabled={forced && kind === 'structural-snapshot'}
                      onChange={(event) => toggleGrounding(index, kind, event.target.checked)}
                    />{' '}
                    {GROUNDING_LABEL[kind]}
                  </label>
                ))}
              </fieldset>
              <label>
                <input
                  type="checkbox"
                  checked={requirement.screenshot || forced}
                  disabled={forced}
                  onChange={(event) => change(index, { screenshot: event.target.checked })}
                />{' '}
                Screenshot {forced ? '(platform-captured)' : ''}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={requirement.recordingSegment}
                  onChange={(event) => change(index, { recordingSegment: event.target.checked })}
                />{' '}
                Recording segment
              </label>
              <div id={`${fieldId}-error`} aria-live="polite">
                {error === null ? null : <Banner tone="warning" title={error} />}
              </div>
              <Button
                type="button"
                onClick={() => {

                  const next = requirementsRef.current.filter((_, i) => i !== index);
                  rowIds.current.splice(index, 1);
                  setRequirements(next);
                  setResult(null);
                  const focusId = rowIds.current[index] ?? rowIds.current[index - 1];
                  requestAnimationFrame(() => {
                    if (focusId === undefined) document.getElementById(`${id}-add`)?.querySelector('button')?.focus();
                    else document.getElementById(`${focusId}-name`)?.focus();
                  });
                }}
              >
                Remove Evidence Requirement {index + 1}
              </Button>
            </fieldset>
          );
        })}
        {limitReached ? <p id={`${id}-limit`}>Evidence Requirements supports at most {EVIDENCE_DRAFT_LIMITS.requirements} attributes.</p> : null}
        <div id={`${id}-add`}><Button
          type="button"
          disabledReason={limitReached ? `Evidence Requirements supports at most ${EVIDENCE_DRAFT_LIMITS.requirements} attributes.` : undefined}
          disabledReasonId={`${id}-limit`}
          onClick={() => {

            const next: readonly EvidenceRequirementInput[] = [...requirementsRef.current, {
              attributeName: '', modelRead: false, groundedBy: platformCaptured ? ['structural-snapshot'] : [],
              screenshot: platformCaptured, recordingSegment: false,
            }];

            const rowId = `${id}-row-${nextId.current++}`;
            rowIds.current.push(rowId);
            setRequirements(next);
            setResult(null);
            requestAnimationFrame(() => document.getElementById(`${rowId}-name`)?.focus());
          }}
        >
          Add Evidence Requirement
        </Button></div>
        {(section.conflict || unknownOutcome) ? <p id={`${id}-save-blocker`}>Review the saved version before saving Evidence Requirements again.</p> : null}
        <Button type="submit" variant="primary" busy={busy} disabledReason={section.conflict || unknownOutcome ? 'Review the saved version before saving Evidence Requirements again.' : undefined} disabledReasonId={`${id}-save-blocker`}>
          {busy ? 'Saving…' : 'Save Evidence Requirements'}
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Save Evidence Requirements?"
        consequence={`This sets ${requirements.length} Evidence Requirement${requirements.length === 1 ? '' : 's'} for Draft version ${draft.versionNumber} of ${draft.controlName}. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Evidence Requirements"
        onConfirm={() => {
          void save();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

export interface ScheduleFormProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: { readonly section: 'schedule'; readonly frequency: Frequency; readonly startTime: string } },
  ) => Promise<UpdateEvidenceDraftResult>;
}

export function ScheduleForm({ draft, rowVersion, onSave }: ScheduleFormProps): React.JSX.Element {
  const id = useId();
  const section = useSection<{ frequency: Frequency | ''; startTime: string }>({ frequency: draft.schedule?.frequency ?? '', startTime: draft.schedule?.startTime ?? '' }, rowVersion);
  const { frequency, startTime } = section.value;
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateEvidenceDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const frequencyError = frequency === '' ? EVIDENCE_DRAFT_MESSAGES.FREQUENCY : null;
  const startError = !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(startTime) ? EVIDENCE_DRAFT_MESSAGES.START : null;
  const error = frequencyError ?? startError;

  async function save(): Promise<void> {
    if (saving.current || frequency === '' || section.conflict || unknownOutcome) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    section.begin({ frequency, startTime });
    try {
      const outcome = await onSave({
        procedureId: draft.procedureId,
        versionId: draft.versionId,
        expectedRowVersion: section.current.current.token,
        edit: { section: 'schedule', frequency, startTime },
      });
      const unchanged = section.finish(outcome.ok ? outcome.rowVersion : undefined);
      setResult(outcome.ok && !unchanged ? null : outcome);
    } catch {
      section.finish();
      setUnknownOutcome(true);
      setResult(null);
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="ls-stack">
      {section.conflict ? <><Banner tone="warning" title="The Schedule changed in another session. Review the saved values before replacing them." /><Button type="button" onClick={() => { section.reset(); setResult(null); }}>Use saved Schedule</Button></> : null}
      {unknownOutcome ? <><Banner tone="warning" title={UNKNOWN_OUTCOME} /><Button type="button" onClick={() => window.location.reload()}>Reload saved version</Button></> : null}
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={
            result.ok
              ? result.changed
                ? 'Saved. The Schedule is recorded in the audit chain.'
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}
      {evidenceBlockersFor(draft.sourceSnapshot, frequency === '' ? null : {
        frequency, startTime, periodDerivationRule: PERIOD_DERIVATION_RULES[frequency],
      }).includes('upload-frequency-mismatch') ? (
        <Banner tone="warning" title={MANUAL_UPLOAD_SENTENCE} />
      ) : null}
      <form
        method="post"
        className="ls-admin__form ls-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current || section.conflict || unknownOutcome) return;
          setResult(null);
          setTouched(true);
          if (error !== null) return;
          setConfirming(true);
        }}
        onBlur={() => setTouched(true)}
      >
        <div className="ls-dialog__field">
          <label htmlFor={`${id}-frequency`}>Frequency</label>
          <select
            className="ls-input"
            id={`${id}-frequency`}
            value={frequency}
            aria-describedby={`${id}-derivation ${id}-error`}
            aria-invalid={(touched && frequencyError !== null) || undefined}
            onChange={(event) => { section.edit({ ...section.value, frequency: event.target.value as Frequency | '' }); setResult(null); }}
          >
            <option value="">Choose a frequency</option>
            {FREQUENCIES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {FREQUENCY_LABEL[candidate]}
              </option>
            ))}
          </select>
        </div>
        <div className="ls-dialog__field">
          <label htmlFor={`${id}-start`}>Fixed UTC start time</label>
          <input
            className="ls-input"
            id={`${id}-start`}
            type="time"
            value={startTime}
            aria-describedby={`${id}-error`}
            aria-invalid={(touched && startError !== null) || undefined}
            onChange={(event) => { section.edit({ ...section.value, startTime: event.target.value }); setResult(null); }}
          />
        </div>
        <p id={`${id}-derivation`} className="ls-caption">
          {frequency === ''
            ? 'Choose a frequency to see the Period each Run will cover.'
            : `Period covered: ${PERIOD_LABEL[frequency]}`}
        </p>
        <div id={`${id}-error`} aria-live="polite">
          {touched && error !== null ? <Banner tone="warning" title={error} /> : null}
        </div>
        {(section.conflict || unknownOutcome) ? <p id={`${id}-save-blocker`}>Review the saved version before saving the Schedule again.</p> : null}
        <Button type="submit" variant="primary" busy={busy} disabledReason={section.conflict || unknownOutcome ? 'Review the saved version before saving the Schedule again.' : undefined} disabledReasonId={`${id}-save-blocker`}>
          {busy ? 'Saving…' : 'Save Schedule'}
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Save the Schedule?"
        consequence={`This sets the Schedule for Draft version ${draft.versionNumber} of ${draft.controlName}. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Schedule"
        onConfirm={() => {
          void save();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
