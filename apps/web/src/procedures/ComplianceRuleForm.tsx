'use client';

import { useId, useRef, useState } from 'react';
import {
  COMPLIANCE_LIMITS,
  COMPLIANCE_MESSAGES,
  COMPLIANCE_OBSERVATION_FIELDS,
  compileComplianceDraft,
  complianceInputFromFields,
  initialDraftCompliance,
  isComplianceConfidence,
  type ComplianceComparison,
  type ComplianceConditionInput,
  type ComplianceDraftInput,
} from '@intellifin/domain';
import type { ProcedureVersionView, UpdateComplianceDraftResult } from '@intellifin/application';
import type { ComplianceDraftFields } from '../../app/procedures/[id]/builder/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { StatusBadge } from '../design/StatusBadge';
import { useSection } from './use-section';
import { SectionConflict } from './SectionConflict';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';

interface ComplianceRuleFormProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onSave: (fields: ComplianceDraftFields) => Promise<UpdateComplianceDraftResult>;
}

/** Derive comparison controls from the same compiler used to validate the save. */
function comparisonFor(draft: ProcedureVersionView, condition: ComplianceConditionInput): ComplianceComparison | null {
  if (condition.comparison !== null) return condition.comparison;
  const template = initialDraftCompliance(draft.templateId).complianceConditions.find((candidate) => candidate.conditionId === condition.conditionId && candidate.text === condition.text);
  if (template?.comparison) return template.comparison;
  const window = /^disabled_time\s*-\s*termination_time\s*(<=|<)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?)h$/.exec(condition.text.trim());
  if (window) return { boundary: window[1] === '<=' ? 'inclusive' : 'exclusive', threshold: window[2]!, tolerance: '0' };
  const numeric = /^([A-Za-z_][A-Za-z0-9_-]*)\s*(>=|>|<=|<|=|!=)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(condition.text.trim());
  if (numeric && COMPLIANCE_OBSERVATION_FIELDS[draft.templateId][numeric[1]!] === 'decimal') return { boundary: numeric[2] === '>=' || numeric[2] === '<=' || numeric[2] === '=' ? 'inclusive' : 'exclusive', threshold: numeric[3]!, tolerance: '0' };
  return null;
}

export function ComplianceRuleForm({ draft, rowVersion, onSave }: ComplianceRuleFormProps): React.JSX.Element {
  const id = useId();
  const section = useSection(complianceInputFromFields(draft), rowVersion);
  const input = section.value;
  const inputRef = { get current() { return section.current.current.value; } };
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState<ComplianceDraftInput | null>(null);
  const [result, setResult] = useState<UpdateComplianceDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  function change(next: ComplianceDraftInput): void {
    section.edit(next);
    setResult(null);
  }

  function changeCondition(conditionId: string, edit: Partial<ComplianceConditionInput>): void {
    change({ ...inputRef.current, conditions: inputRef.current.conditions.map((condition) =>
      condition.conditionId === conditionId ? { ...condition, ...edit } : condition) });
  }

  function touch(conditionId: string): void {
    setTouched((current) => new Set([...current, conditionId]));
  }

  const validation = compileComplianceDraft(draft.templateId, input, draft.complianceCompilerVersion);
  const confidenceError = isComplianceConfidence(input.confidenceThreshold) ? null : COMPLIANCE_MESSAGES.CONFIDENCE;
  const templateText = draft.sections.find((section) => section.heading === 'Compliance Rule conditions')?.content ?? null;
  const limitReached = input.conditions.length >= COMPLIANCE_LIMITS.conditions;

  async function save(): Promise<void> {
    if (saving.current || unknownOutcome || confirming === null || section.current.current.conflict) return;
    saving.current = true;
    setBusy(true);
    const edit = confirming;
    setConfirming(null);
    section.begin(edit);
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: section.current.current.token, edit });
      section.finish(outcome.ok ? outcome.rowVersion : undefined);
      setResult(outcome);
    } catch {
      section.finish();
      setUnknownOutcome(true); setResult(null);
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  return <div className="ls-stack">
    <SectionConflict conflict={section.conflict} name="Compliance Rule" reset={() => section.reset()} />
      <UnknownSaveOutcome visible={unknownOutcome} />
    {templateText === null ? null : <details>
      <summary>Template default Compliance Rule (read-only)</summary>
      <p className="ls-whitespace">{templateText}</p>
    </details>}
    <p id={`${id}-origin-help`}>Rule-Classified uses a compiled rule. Agent-Judged retains your text for later evaluation; pending does not mean the condition has been evaluated.</p>
    <details>
      <summary>Supported condition expressions</summary>
      <p>Use declared Observation fields with comparisons, <code>and</code>, <code>or</code>, <code>not</code>, and parentheses. For example: <code>amount &gt;= 100000</code> or <code>found = true</code>.</p>
      <p><code>account_status in [disabled] else [active]</code> names the Compliant values first and the Exception values second. An unnamed value is Unevaluated. Other prose stays Agent-Judged.</p>
    </details>
    {result === null ? null : <Banner key={announcement} tone={result.ok ? 'success' : 'danger'} title={result.ok
      ? result.changed ? 'Saved. The Compliance Rule is recorded in the audit chain.' : 'Saved. Nothing changed, so nothing was recorded.'
      : result.reason} />}
    <form method="post" className="ls-admin__form ls-stack" ref={formRef} onSubmit={(event) => {
      event.preventDefault();
      if (saving.current || unknownOutcome || section.current.current.conflict) return;
      setResult(null);
      setSubmitted(true);
      setThresholdTouched(true);
      setTouched(new Set(input.conditions.map((condition) => condition.conditionId)));
      if (!validation.ok) {
        // Focus the warning after React has made it visible, including errors not
        // associated with one row (for example an empty condition collection).
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-compliance-error]')?.focus());
        return;
      }
      setConfirming(inputRef.current);
    }}>
      {input.conditions.map((condition) => {
        const fieldId = `${id}-${condition.conditionId}`;
        const preview = compileComplianceDraft(draft.templateId, { conditions: [condition], confidenceThreshold: '0.80' }, draft.complianceCompilerVersion);
        const error = !preview.ok && (submitted || touched.has(condition.conditionId)) ? preview.reason : null;
        const compiled = preview.ok ? preview.value.complianceConditions[0] : undefined;
        const availableComparison = comparisonFor(draft, condition);
        const isWindow = condition.text.trim() === 'disabled_time - termination_time <= 24h';
        return <fieldset className="ls-stack" key={condition.conditionId} data-condition-id={condition.conditionId} onBlur={() => touch(condition.conditionId)}>
          <legend>Condition {condition.conditionId}</legend>
          <div aria-live="polite" aria-describedby={`${id}-origin-help`}>
            {compiled === undefined ? <p>Check this condition before saving.</p> : <StatusBadge family="evaluation-origin" state={compiled.status === 'RULE' ? 'Rule-Classified' : 'Agent-Judged (pending)'} />}
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={`${fieldId}-text`}>Condition text {condition.conditionId}</label>
            <textarea className="ls-input" id={`${fieldId}-text`} rows={6} value={condition.text} maxLength={COMPLIANCE_LIMITS.text}
              aria-describedby={`${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.INPUT) || undefined}
              onChange={(event) => {
                const next = { ...condition, text: event.target.value, comparison: null };
                changeCondition(condition.conditionId, { text: next.text, comparison: comparisonFor(draft, next) });
              }} />
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={`${fieldId}-applicability`}>Applicability {condition.conditionId}</label>
            <input className="ls-input" id={`${fieldId}-applicability`} value={condition.applicability} maxLength={COMPLIANCE_LIMITS.expression}
              aria-describedby={`${fieldId}-applicability-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.APPLICABILITY) || undefined}
              onChange={(event) => changeCondition(condition.conditionId, { applicability: event.target.value })} />
            <p className="ls-caption" id={`${fieldId}-applicability-help`}>Use a supported expression or <code>all records</code>. Empty applicability defaults to <code>found = true</code>.</p>
          </div>
          {availableComparison === null ? null : <div className="ls-stack">
            {condition.comparison === null ? null : <>
              <label htmlFor={`${fieldId}-boundary`}>Comparison boundary {condition.conditionId}</label>
              <select className="ls-input" id={`${fieldId}-boundary`} value={condition.comparison.boundary} onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, boundary: event.target.value as 'inclusive' | 'exclusive' } })}>
                <option value="inclusive">Inclusive — includes the boundary</option>
                <option value="exclusive">Exclusive — excludes the boundary</option>
              </select>
              <label htmlFor={`${fieldId}-threshold`}>Comparison threshold {condition.conditionId}</label>
              <input className="ls-input" id={`${fieldId}-threshold`} type="text" inputMode="decimal" value={condition.comparison.threshold}
                aria-describedby={`${fieldId}-comparison-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.NUMBER) || undefined}
                onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, threshold: event.target.value } })} />
              <label htmlFor={`${fieldId}-tolerance`}>Numeric tolerance {condition.conditionId}</label>
              <input className="ls-input" id={`${fieldId}-tolerance`} type="text" inputMode="decimal" value={condition.comparison.tolerance}
                aria-describedby={`${fieldId}-comparison-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.NUMBER) || undefined}
                onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, tolerance: event.target.value } })} />
              <p className="ls-caption" id={`${fieldId}-comparison-help`}>Enter exact decimals. Tolerance must be zero or positive. {isWindow ? 'The threshold and tolerance are in hours.' : draft.templateId === 'P-3' && compiled?.rule?.kind === 'approval' ? 'The threshold and tolerance are in USD; tolerance also allows that difference in the approver limit.' : 'The threshold and tolerance use the Observation field’s units.'} These settings change the comparison in this condition.</p>
            </>}
          </div>}
          {draft.templateId === 'P-1' && condition.conditionId === 'C1' ? <Button type="button" onClick={() => changeCondition(condition.conditionId, {
            text: 'disabled_time - termination_time <= 24h',
            comparison: { boundary: 'inclusive', threshold: '24', tolerance: '0' },
          })}>Use 24-hour disablement window</Button> : null}
          <div id={`${fieldId}-error`} aria-live="polite">{error === null ? null : <Banner tone="warning" title={error} />}</div>
          <Button type="button" onClick={() => change({ ...inputRef.current, conditions: inputRef.current.conditions.filter((current) => current.conditionId !== condition.conditionId) })}>Remove condition {condition.conditionId}</Button>
        </fieldset>;
      })}
      {limitReached ? <p id={`${id}-limit`}>A Compliance Rule supports at most {COMPLIANCE_LIMITS.conditions} conditions.</p> : null}
      <Button type="button" disabledReason={limitReached ? `A Compliance Rule supports at most ${COMPLIANCE_LIMITS.conditions} conditions.` : undefined} disabledReasonId={`${id}-limit`} onClick={() => {
        const conditionId = `C-${crypto.randomUUID()}`;
        change({ ...inputRef.current, conditions: [...inputRef.current.conditions, { conditionId, text: '', applicability: 'found = true', comparison: null }] });
        requestAnimationFrame(() => document.getElementById(`${id}-${conditionId}-text`)?.focus());
      }}>Add condition</Button>
      <div className="ls-dialog__field">
        <label htmlFor={`${id}-confidence`}>Agent-Judged confidence threshold</label>
        <input className="ls-input" id={`${id}-confidence`} type="text" inputMode="decimal" value={input.confidenceThreshold} maxLength={100}
          aria-describedby={`${id}-confidence-help ${id}-confidence-error`} aria-invalid={thresholdTouched && confidenceError !== null || undefined}
          onChange={(event) => change({ ...inputRef.current, confidenceThreshold: event.target.value })} onBlur={() => setThresholdTouched(true)} />
        <p className="ls-caption" id={`${id}-confidence-help`}>One threshold applies to all Agent-Judged conditions in this Procedure Version. Use an exact decimal from 0 to 1; the default is 0.80.</p>
        <div id={`${id}-confidence-error`} aria-live="polite">{thresholdTouched && confidenceError !== null ? <Banner tone="warning" title={confidenceError} /> : null}</div>
      </div>
      {submitted && !validation.ok ? <div tabIndex={-1} data-compliance-error><Banner tone="warning" title={`The Compliance Rule was not saved. ${validation.reason}`} /></div> : null}
      <Button type="submit" disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : undefined} variant="primary" busy={busy}>{busy ? 'Saving…' : 'Save Compliance Rule'}</Button>
    </form>
    <ConfirmDialog open={confirming !== null} weight="routine" title="Save the Compliance Rule?"
      consequence={`This sets ${confirming?.conditions.length ?? 0} conditions and one Agent-Judged confidence threshold for Draft version ${draft.versionNumber} of ${draft.controlName}. The change is recorded in the audit chain against your name.`}
      confirmLabel="Save Compliance Rule" onConfirm={() => { void save(); }} onCancel={() => setConfirming(null)} />
  </div>;
}
