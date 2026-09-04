'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  EVIDENCE_DRAFT_LIMITS,
  EVIDENCE_DRAFT_MESSAGES,
  FREQUENCIES,
  GROUNDING_EVIDENCE_TYPES,
  PERIOD_DERIVATION_RULES,
  hasAgentDrivenTarget,
  withPlatformCaptured,
  type EvidenceRequirementInput,
  type Frequency,
  type GroundingEvidenceType,
} from '@intellifin/domain';
import type { ProcedureVersionView, UpdateEvidenceDraftResult } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { MANUAL_UPLOAD_SENTENCE } from '../design/copy';

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

function sameRequirements(left: readonly EvidenceRequirementInput[], right: readonly EvidenceRequirementInput[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface EvidenceRequirementsFormProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: { readonly section: 'evidence-requirements'; readonly requirements: readonly EvidenceRequirementInput[] } },
  ) => Promise<UpdateEvidenceDraftResult>;
}

export function EvidenceRequirementsForm({ draft, rowVersion, onSave }: EvidenceRequirementsFormProps): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const initial = inputsFrom(draft);
  const [requirements, setRequirements] = useState<readonly EvidenceRequirementInput[]>(() => initial);
  const requirementsRef = useRef(requirements);
  const dirtyRef = useRef(false);
  useEffect(() => {
    const server = inputsFrom(draft);
    if (!dirtyRef.current || sameRequirements(requirementsRef.current, server)) {
      requirementsRef.current = server;
      dirtyRef.current = false;
      setRequirements(server);
    }
  }, [draft]);
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set());
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
  const platformCaptured = hasAgentDrivenTarget(draft.targets);

  function change(index: number, edit: Partial<EvidenceRequirementInput>): void {
    dirtyRef.current = true;
    const next = requirementsRef.current.map((requirement, i) => (i === index ? { ...requirement, ...edit } : requirement));
    requirementsRef.current = next;
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
    if (!requirement.modelRead && requirement.groundedBy.length === 0) return EVIDENCE_DRAFT_MESSAGES.GROUNDING;
    return null;
  }

  const limitReached = requirements.length >= EVIDENCE_DRAFT_LIMITS.requirements;

  async function save(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    try {
      const outcome = await onSave({
        procedureId: draft.procedureId,
        versionId: draft.versionId,
        expectedRowVersion: token,
        edit: { section: 'evidence-requirements', requirements: requirementsRef.current },
      });
      setResult(outcome);
      if (outcome.ok) setToken(outcome.rowVersion);
    } catch {
      setResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  const anyError = requirements.some((requirement) => errorFor(requirement) !== null);

  return (
    <div className="ls-stack">
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
          if (saving.current) return;
          setResult(null);
          setSubmitted(true);
          setTouched(new Set(requirements.map((_, index) => index)));
          if (anyError) return;
          setConfirming(true);
        }}
      >
        {requirements.length === 0 ? <p>No Evidence Requirement is defined yet.</p> : null}
        {requirements.map((requirement, index) => {
          const fieldId = `${id}-${index}`;
          const error = (submitted || touched.has(index)) ? errorFor(requirement) : null;
          const forced = platformCaptured;
          return (
            <fieldset className="ls-stack" key={index} onBlur={() => setTouched((current) => new Set([...current, index]))}>
              <legend>Evidence Requirement {index + 1}</legend>
              <div className="ls-dialog__field">
                <label htmlFor={`${fieldId}-name`}>Attribute name</label>
                <input
                  className="ls-input"
                  id={`${fieldId}-name`}
                  value={requirement.attributeName}
                  maxLength={EVIDENCE_DRAFT_LIMITS.attributeName}
                  aria-describedby={`${fieldId}-error`}
                  aria-invalid={error !== null || undefined}
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
              <fieldset>
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
                  dirtyRef.current = true;
                  const next = requirementsRef.current.filter((_, i) => i !== index);
                  requirementsRef.current = next;
                  setRequirements(next);
                  setResult(null);
                }}
              >
                Remove Evidence Requirement {index + 1}
              </Button>
            </fieldset>
          );
        })}
        {limitReached ? <p id={`${id}-limit`}>Evidence Requirements supports at most {EVIDENCE_DRAFT_LIMITS.requirements} attributes.</p> : null}
        <Button
          type="button"
          disabledReason={limitReached ? `Evidence Requirements supports at most ${EVIDENCE_DRAFT_LIMITS.requirements} attributes.` : undefined}
          disabledReasonId={`${id}-limit`}
          onClick={() => {
            dirtyRef.current = true;
            const next = [...requirementsRef.current, withPlatformCaptured({ attributeName: '', modelRead: false, groundedBy: [], screenshot: false, recordingSegment: false }, platformCaptured)];
            requirementsRef.current = next;
            setRequirements(next);
            requestAnimationFrame(() => document.getElementById(`${id}-${next.length - 1}-name`)?.focus());
          }}
        >
          Add Evidence Requirement
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
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
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const [frequency, setFrequency] = useState<Frequency | ''>(draft.schedule?.frequency ?? '');
  const [startTime, setStartTime] = useState(draft.schedule?.startTime ?? '');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateEvidenceDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const error = frequency === '' ? EVIDENCE_DRAFT_MESSAGES.FREQUENCY
    : !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(startTime) ? EVIDENCE_DRAFT_MESSAGES.START
    : null;

  async function save(): Promise<void> {
    if (saving.current || frequency === '') return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    try {
      const outcome = await onSave({
        procedureId: draft.procedureId,
        versionId: draft.versionId,
        expectedRowVersion: token,
        edit: { section: 'schedule', frequency, startTime },
      });
      setResult(outcome);
      if (outcome.ok) setToken(outcome.rowVersion);
    } catch {
      setResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="ls-stack">
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
      {draft.evidenceBlockers.includes('upload-frequency-mismatch') ? (
        <Banner tone="warning" title={MANUAL_UPLOAD_SENTENCE} />
      ) : null}
      <form
        method="post"
        className="ls-admin__form ls-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current) return;
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
            onChange={(event) => setFrequency(event.target.value as Frequency)}
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
            aria-invalid={(touched && error !== null) || undefined}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
        <p id={`${id}-derivation`} className="ls-caption">
          {frequency === ''
            ? 'The recorded period-derivation rule depends on the chosen frequency.'
            : `Recorded period-derivation rule: ${PERIOD_DERIVATION_RULES[frequency]}. This Procedure Version records the rule; it never runs it.`}
        </p>
        <div id={`${id}-error`} aria-live="polite">
          {touched && error !== null ? <Banner tone="warning" title={error} /> : null}
        </div>
        <Button type="submit" variant="primary" busy={busy}>
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
