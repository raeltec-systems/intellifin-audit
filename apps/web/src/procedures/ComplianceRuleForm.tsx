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
  type RolePrivilegePolicy,
} from '@intellifin/domain';
import type { ProcedureVersionView, UpdateComplianceDraftResult } from '@intellifin/application';
import type { ComplianceDraftFields } from '../../app/procedures/[id]/builder/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { StatusBadge } from '../design/StatusBadge';
import {
  EXACT_VALUE_SENTENCE,
  SIMPLE_UNAVAILABLE,
  readSimpleCondition,
  statusSetProblem,
  valueLines,
  writeSimpleCondition,
  DISABLEMENT_WINDOW_PATTERN,
  DISABLEMENT_TIME_ATTRIBUTE,
  DISABLEMENT_WINDOW_CONDITION_ID,
  WINDOW_NEEDS_TERMINATION_INSTANT,
  disablementWindowCondition,
  isDisablementWindow,
  type SimpleCondition,
} from './simple-condition';
import { useSection, useSectionSubmissionStatus } from './use-section';
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
  const window = DISABLEMENT_WINDOW_PATTERN.exec(condition.text.trim());
  if (window) return { boundary: window[1] === '<=' ? 'inclusive' : 'exclusive', threshold: window[2]!, tolerance: '0' };
  const numeric = /^([A-Za-z_][A-Za-z0-9_-]*)\s*(>=|>|<=|<|=|!=)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(condition.text.trim());
  if (numeric && COMPLIANCE_OBSERVATION_FIELDS[draft.templateId][numeric[1]!] === 'decimal') return { boundary: numeric[2] === '>=' || numeric[2] === '<=' || numeric[2] === '=' ? 'inclusive' : 'exclusive', threshold: numeric[3]!, tolerance: '0' };
  return null;
}

/**
 * One value per line, with a local buffer so a blank line being typed is not eaten.
 *
 * Used by both the role-privilege policy and the status lists: they are the same control
 * over the same shape, and two copies would drift on the first edge somebody tried.
 */
function LineListField({ id, label, help, values, invalid, onChange }: {
  readonly id: string; readonly label: string; readonly help: string; readonly values: readonly string[];
  readonly invalid: boolean; readonly onChange: (values: string[]) => void;
}): React.JSX.Element {
  const roles = values;
  const saved = roles.join('\n');
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  // Re-sync only when the saved list moved underneath (a save normalized it, a refresh
  // replaced it) and the local text no longer spells the same entries.
  if (saved !== seen) { setSeen(saved); if (valueLines(text).join('\n') !== saved) setText(saved); }
  return <div className="ls-dialog__field">
    <label htmlFor={id}>{label}</label>
    <textarea className="ls-input" id={id} rows={4} value={text} aria-describedby={`${id}-help`} aria-invalid={invalid || undefined}
      onChange={(event) => { setText(event.target.value); onChange(valueLines(event.target.value)); }} />
    <p className="ls-caption" id={`${id}-help`}>{help}</p>
  </div>;
}

const EMPTY_POLICY: RolePrivilegePolicy = { kind: 'role-privilege', rolesField: 'roles', privileged: [], nonPrivileged: [] };

export function ComplianceRuleForm({ draft, rowVersion, onSave }: ComplianceRuleFormProps): React.JSX.Element {
  const id = useId();
  const section = useSection(complianceInputFromFields(draft), rowVersion);
  const input = section.value;
  const inputRef = { get current() { return section.current.current.value; } };
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  // Which editor each condition is showing. Switching is a VIEW change and never writes:
  // simple and advanced operate on the one authored string, so there is nothing to
  // convert between them. A condition with no simple form is not in this map at all and
  // renders advanced with the sentence saying why.
  const [modes, setModes] = useState<Readonly<Record<string, 'simple' | 'advanced'>>>({});
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<UpdateComplianceDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  useSectionSubmissionStatus('Compliance Rule', section, busy, unknownOutcome);
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

  function removePolicy(conditionId: string): void {
    change({ ...inputRef.current, conditions: inputRef.current.conditions.map((condition) => {
      if (condition.conditionId !== conditionId) return condition;
      const { policy: _policy, ...rest } = condition;
      return rest;
    }) });
  }

  function touch(conditionId: string): void {
    setTouched((current) => new Set([...current, conditionId]));
  }

  const validation = compileComplianceDraft(draft.templateId, input, draft.complianceCompilerVersion);
  const confidenceError = isComplianceConfidence(input.confidenceThreshold) ? null : COMPLIANCE_MESSAGES.CONFIDENCE;
  const templateText = draft.sections.find((section) => section.heading === 'Compliance Rule conditions')?.content ?? null;
  const limitReached = input.conditions.length >= COMPLIANCE_LIMITS.conditions;

  // Owner decision (2026-09-08): an ordinary Draft section save is a direct save with a
  // visible saved / unsaved / error state, not a confirmation.
  async function save(edit: ComplianceDraftInput): Promise<void> {
    if (saving.current || unknownOutcome || section.current.current.conflict) return;
    saving.current = true;
    setBusy(true);
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
    <SectionConflict dirty={section.status().dirty} conflict={section.conflict} name="Compliance Rule" reset={() => section.reset()} />
      <UnknownSaveOutcome visible={unknownOutcome} />
    {templateText === null ? null : <details>
      <summary>What the Template suggested (read-only)</summary>
      <p className="ls-whitespace">{templateText}</p>
    </details>}
    <p className="ls-caption">A record is a finding when it breaks one of the rules below. Write each rule the way you would explain it to a colleague.</p>
    <p className="ls-caption" id={`${id}-origin-help`}>Each rule is marked <strong>Rule-Classified</strong> when the platform can check it on its own, or <strong>Agent-Judged</strong> when the agent has to read and decide. Agent-Judged rules are shown as pending until a person confirms them.</p>
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
      void save(inputRef.current);
    }}>
      {input.conditions.map((condition) => {
        const fieldId = `${id}-${condition.conditionId}`;
        const preview = compileComplianceDraft(draft.templateId, { conditions: [condition], confidenceThreshold: '0.80' }, draft.complianceCompilerVersion);
        const error = !preview.ok && (submitted || touched.has(condition.conditionId)) ? preview.reason : null;
        const compiled = preview.ok ? preview.value.complianceConditions[0] : undefined;
        const availableComparison = comparisonFor(draft, condition);
        const isWindow = DISABLEMENT_WINDOW_PATTERN.test(condition.text.trim());
        const simple = readSimpleCondition(condition.text, draft.templateId, condition.conditionId);
        // `Object.hasOwn`, not a plain index: the key is a condition id, which for an
        // added condition comes from the person editing the Draft.
        const mode = simple === null
          ? 'advanced'
          : Object.hasOwn(modes, condition.conditionId) ? modes[condition.conditionId]! : 'simple';
        const setMode = (next: 'simple' | 'advanced') =>
          setModes((current) => ({ ...current, [condition.conditionId]: next }));
        /** Write simple controls back into the ONE authored string, or say why not. */
        const writeSimple = (next: SimpleCondition): void => {
          const text = writeSimpleCondition(next, draft.templateId, condition.conditionId);
          if (text === null) return;
          changeCondition(condition.conditionId, { text, comparison: comparisonFor(draft, { ...condition, text, comparison: null }) });
        };
        const simpleProblem = simple?.kind === 'status-set' ? statusSetProblem(simple, draft.templateId, condition.conditionId) : null;
        // Named live, while the policy is being typed. `compileComplianceDraft` refuses
        // the same states with one sentence covering every way a policy can be wrong,
        // which is a refusal rather than something a person can act on.
        const bothLists = condition.policy?.privileged.filter((role) => condition.policy?.nonPrivileged.includes(role)) ?? [];
        const policyProblem = condition.policy === undefined ? null
          : bothLists.length > 0 ? `A role cannot be both privileged and non-privileged. Remove ${bothLists.join(', ')} from one of the two lists.`
          : condition.policy.privileged.length + condition.policy.nonPrivileged.length === 0
            ? 'Name at least one role in one of the two lists, or remove the policy. An empty policy classifies nothing and stops the Run on every role it meets.'
            : null;
        return <fieldset className="ls-stack" key={condition.conditionId} data-condition-id={condition.conditionId} onBlur={() => touch(condition.conditionId)}>
          <legend>Rule {condition.conditionId}</legend>
          <div aria-live="polite" aria-describedby={`${id}-origin-help`}>
            {compiled === undefined ? <p>Check this condition before saving.</p> : <StatusBadge family="evaluation-origin" state={compiled.status === 'RULE' ? 'Rule-Classified' : 'Agent-Judged (pending)'} />}
          </div>
          {simple === null
            ? <p className="ls-caption" data-simple-unavailable={condition.conditionId}>{SIMPLE_UNAVAILABLE}</p>
            : <fieldset className="ls-stack" data-condition-mode={condition.conditionId}>
                <legend>How you write rule {condition.conditionId}</legend>
                {(['simple', 'advanced'] as const).map((option) => <label key={option} htmlFor={`${fieldId}-mode-${option}`}>
                  <input type="radio" id={`${fieldId}-mode-${option}`} name={`${fieldId}-mode`} value={option}
                    checked={mode === option} onChange={() => setMode(option)} />
                  {option === 'simple' ? ' Pick the values from a list' : ' Write it out myself'}
                </label>)}
                <p className="ls-caption">Both change the same rule. Switching between them on its own changes nothing.</p>
              </fieldset>}

          {mode === 'simple' && simple?.kind === 'status-set' ? <fieldset className="ls-stack" data-simple-for={condition.conditionId}>
            <legend>Account status values {condition.conditionId}</legend>
            <p className="ls-caption" id={`${fieldId}-exact-help`}>{EXACT_VALUE_SENTENCE}</p>
            <label htmlFor={`${fieldId}-proven-absence`}>
              <input type="checkbox" id={`${fieldId}-proven-absence`} checked={simple.provenAbsence}
                onChange={(event) => writeSimple({ ...simple, provenAbsence: event.target.checked })} />
              {' '}No account at all counts as Compliant (a proven absence)
            </label>
            <LineListField id={`${fieldId}-compliant`} label={`Values that count as Compliant ${condition.conditionId}`}
              help="One value per line, exactly as the Target System displays it. For a terminated employee this is usually the disabled status."
              values={simple.compliant} invalid={simpleProblem !== null}
              onChange={(compliant) => writeSimple({ ...simple, compliant })} />
            <LineListField id={`${fieldId}-exception`} label={`Values that count as an Exception ${condition.conditionId}`}
              help="One value per line. An account still in one of these states after termination is the finding."
              values={simple.exception} invalid={simpleProblem !== null}
              onChange={(exception) => writeSimple({ ...simple, exception })} />
            <div aria-live="polite">{simpleProblem === null ? null : <Banner tone="warning" title={`Not saved yet: ${simpleProblem}`} />}</div>
            <p className="ls-caption">Rule as it will be saved: <code data-simple-text={condition.conditionId}>{condition.text}</code></p>
          </fieldset> : null}

          {mode === 'simple' && simple?.kind === 'disablement-window' ? <fieldset className="ls-stack" data-simple-for={condition.conditionId}>
            <legend>Disablement window {condition.conditionId}</legend>
            <p className="ls-caption">The account must be disabled within the window below, measured from the termination time. Set the hours and the boundary under &ldquo;Comparison&rdquo;.</p>
            <p className="ls-caption">{WINDOW_NEEDS_TERMINATION_INSTANT}</p>
            <p className="ls-caption">The disablement time also has to be captured: declare <code>{DISABLEMENT_TIME_ATTRIBUTE}</code> in Evidence Requirements, or every record is Unevaluated. Readiness before execution lists it until you do.</p>
          </fieldset> : null}

          <div className="ls-dialog__field" hidden={mode === 'simple'}>
            <label htmlFor={`${fieldId}-text`}>Rule text {condition.conditionId}</label>
            <textarea className="ls-input" id={`${fieldId}-text`} rows={6} value={condition.text} maxLength={COMPLIANCE_LIMITS.text}
              aria-describedby={`${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.INPUT) || undefined}
              onChange={(event) => {
                // Typing here PINS this condition to advanced. Without it, the moment the
                // text became a shape the simple editor can show, the default would flip
                // to simple and the textarea would vanish under the person's cursor.
                setMode('advanced');
                const next = { ...condition, text: event.target.value, comparison: null };
                changeCondition(condition.conditionId, { text: next.text, comparison: comparisonFor(draft, next) });
              }} />
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={`${fieldId}-applicability`}>Applies to {condition.conditionId}</label>
            <input className="ls-input" id={`${fieldId}-applicability`} value={condition.applicability} maxLength={COMPLIANCE_LIMITS.expression}
              aria-describedby={`${fieldId}-applicability-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.APPLICABILITY) || undefined}
              onChange={(event) => changeCondition(condition.conditionId, { applicability: event.target.value })} />
            <p className="ls-caption" id={`${fieldId}-applicability-help`}>Which records this rule is checked against. Type <code>all records</code> to check every record. Leave this as it is unless you need to narrow it.</p>
          </div>
          {availableComparison === null ? null : <div className="ls-stack">
            {condition.comparison === null ? null : <>
              <label htmlFor={`${fieldId}-boundary`}>A record exactly at the limit {condition.conditionId}</label>
              <select className="ls-input" id={`${fieldId}-boundary`} value={condition.comparison.boundary} onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, boundary: event.target.value as 'inclusive' | 'exclusive' } })}>
                <option value="inclusive">Counts as inside the limit</option>
                <option value="exclusive">Counts as outside the limit</option>
              </select>
              <label htmlFor={`${fieldId}-threshold`}>Limit {condition.conditionId}</label>
              <input className="ls-input" id={`${fieldId}-threshold`} type="text" inputMode="decimal" value={condition.comparison.threshold}
                aria-describedby={`${fieldId}-comparison-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.NUMBER) || undefined}
                onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, threshold: event.target.value } })} />
              <label htmlFor={`${fieldId}-tolerance`}>Allowed difference {condition.conditionId}</label>
              <input className="ls-input" id={`${fieldId}-tolerance`} type="text" inputMode="decimal" value={condition.comparison.tolerance}
                aria-describedby={`${fieldId}-comparison-help ${fieldId}-error`} aria-invalid={error?.includes(COMPLIANCE_MESSAGES.NUMBER) || undefined}
                onChange={(event) => changeCondition(condition.conditionId, { comparison: { ...condition.comparison!, tolerance: event.target.value } })} />
              <p className="ls-caption" id={`${fieldId}-comparison-help`}>Type exact numbers. The allowed difference is a margin around the limit: a value inside it still counts as meeting this test, whichever side of the limit it falls. Use 0 for an exact limit. {isWindow ? 'The threshold and tolerance are in hours.' : draft.templateId === 'P-3' && compiled?.rule?.kind === 'approval' ? 'The threshold and tolerance are in USD; tolerance also allows that difference in the approver limit.' : 'The threshold and tolerance use the Observation field’s units.'} Changing these changes what this rule counts as a finding.</p>
            </>}
          </div>}
          {condition.policy !== undefined || (compiled?.status === 'AGENT_JUDGED' && COMPLIANCE_OBSERVATION_FIELDS[draft.templateId]['roles'] === 'roles') ? <fieldset className="ls-stack" data-policy-for={condition.conditionId}>
            <legend>Which roles count as privileged {condition.conditionId}</legend>
            <div className="ls-caption" id={`${fieldId}-policy-help`}>
              <p>An explicit list of role names, frozen with this version and applied exactly. The agent never decides from a role&rsquo;s name what it can do.</p>
              <ul>
                <li>A listed privileged role is an <strong>Exception</strong>, even when the account is disabled.</li>
                <li>An account holding only known non-privileged roles can be <strong>Compliant</strong>.</li>
                <li>A role in <strong>neither</strong> list stops the Run and asks a person, rather than being guessed.</li>
              </ul>
              <p>Names are compared exactly, capital letters included. Type each one as the Target System displays it.</p>
            </div>
            {condition.policy === undefined
              ? <Button type="button" aria-describedby={`${fieldId}-policy-help`} onClick={() => changeCondition(condition.conditionId, { policy: EMPTY_POLICY })}>Add the list of privileged roles {condition.conditionId}</Button>
              : <>
                <LineListField id={`${fieldId}-privileged`} label={`Privileged roles ${condition.conditionId}`} help="One role name per line, exactly as the Target System displays it." values={condition.policy.privileged}
                  invalid={policyProblem !== null} onChange={(privileged) => changeCondition(condition.conditionId, { policy: { ...condition.policy!, privileged } })} />
                <LineListField id={`${fieldId}-non-privileged`} label={`Known non-privileged roles ${condition.conditionId}`} help="One role name per line. A role in neither list is escalated, never guessed." values={condition.policy.nonPrivileged}
                  invalid={policyProblem !== null} onChange={(nonPrivileged) => changeCondition(condition.conditionId, { policy: { ...condition.policy!, nonPrivileged } })} />
                <p className="ls-caption" data-policy-counts={condition.conditionId}>
                  {condition.policy.privileged.length} privileged, {condition.policy.nonPrivileged.length} known non-privileged.
                </p>
                {/*
                  The compiler refuses an overlapping or empty policy with one sentence
                  covering every way a policy can be wrong. Saying WHICH role, while it is
                  being typed, is the difference between a refusal and something to do.
                */}
                <div aria-live="polite">{policyProblem === null ? null : <Banner tone="warning" title={policyProblem} />}</div>
                <Button type="button" onClick={() => removePolicy(condition.conditionId)}>Remove the list of privileged roles {condition.conditionId}</Button>
              </>}
          </fieldset> : null}
          <div id={`${fieldId}-error`} aria-live="polite">{error === null ? null : <Banner tone="warning" title={error} />}</div>
          <Button type="button" onClick={() => change({ ...inputRef.current, conditions: inputRef.current.conditions.filter((current) => current.conditionId !== condition.conditionId) })}>Remove rule {condition.conditionId}</Button>
        </fieldset>;
      })}
      {draft.templateId !== 'P-1' ? null : (() => {
        // P-1's optional timing variant. It ADDS a condition beside the account-status
        // one rather than replacing it: an Active account has no disablement instant at
        // all, so the status condition is what makes that an Exception, and swapping one
        // for the other would silently drop the finding the Template exists to make.
        const window = input.conditions.find((candidate) => isDisablementWindow(candidate));
        return <fieldset className="ls-stack" data-timing-choice>
          <legend>Timing</legend>
          <p className="ls-caption">The rules above ask whether the account is still open. This optional one asks whether it was closed in time. It is added beside them, not instead of them.</p>
          {window === undefined
            ? <Button type="button" data-add-window
                disabledReason={limitReached ? `A Compliance Rule supports at most ${COMPLIANCE_LIMITS.conditions} conditions.` : undefined}
                disabledReasonId={`${id}-limit`}
                onClick={() => {
                  const current = inputRef.current;
                  // `C3` is the contract's own id for this condition; a Draft that has
                  // already used it gets a fresh one rather than a silent collision.
                  const taken = current.conditions.some((candidate) => candidate.conditionId === DISABLEMENT_WINDOW_CONDITION_ID);
                  const conditionId = taken ? `C-${crypto.randomUUID()}` : DISABLEMENT_WINDOW_CONDITION_ID;
                  change({ ...current, conditions: [...current.conditions, disablementWindowCondition(draft.templateId, current.confidenceThreshold, conditionId)] });
                  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-condition-id="${conditionId}"]`)?.scrollIntoView({ block: 'center' }));
                }}>Add the 24-hour disablement window</Button>
            : <>
                <p className="ls-caption" data-window-condition={window.conditionId}>Rule {window.conditionId} requires the account to be closed inside the window set by its own Limit field.</p>
                <Button type="button" data-remove-window onClick={() => change({ ...inputRef.current, conditions: inputRef.current.conditions.filter((candidate) => !isDisablementWindow(candidate)) })}>Remove the 24-hour disablement window</Button>
              </>}
        </fieldset>;
      })()}
      {limitReached ? <p id={`${id}-limit`}>You can add up to {COMPLIANCE_LIMITS.conditions} rules.</p> : null}
      <Button type="button" disabledReason={limitReached ? `A Compliance Rule supports at most ${COMPLIANCE_LIMITS.conditions} conditions.` : undefined} disabledReasonId={`${id}-limit`} onClick={() => {
        const conditionId = `C-${crypto.randomUUID()}`;
        change({ ...inputRef.current, conditions: [...inputRef.current.conditions, { conditionId, text: '', applicability: 'found = true', comparison: null }] });
        requestAnimationFrame(() => document.getElementById(`${id}-${conditionId}-text`)?.focus());
      }}>Add a rule</Button>
      <details className="ls-disclosure">
        <summary>More options</summary>
        <div className="ls-disclosure__body">
          <div className="ls-dialog__field">
            <label htmlFor={`${id}-confidence`}>How certain the agent must be</label>
            <input className="ls-input" id={`${id}-confidence`} type="text" inputMode="decimal" value={input.confidenceThreshold} maxLength={100}
              aria-describedby={`${id}-confidence-help ${id}-confidence-error`} aria-invalid={thresholdTouched && confidenceError !== null || undefined}
              onChange={(event) => change({ ...inputRef.current, confidenceThreshold: event.target.value })} onBlur={() => setThresholdTouched(true)} />
            <p className="ls-caption" id={`${id}-confidence-help`}>A number from 0 to 1, used for every rule the agent judges. Below it, the agent asks a person instead of deciding. The default is 0.80.</p>
            <div id={`${id}-confidence-error`} aria-live="polite">{thresholdTouched && confidenceError !== null ? <Banner tone="warning" title={confidenceError} /> : null}</div>
          </div>
          <div>
            <p className="ls-caption">If you write a rule out yourself, you can use the fields this source and these systems provide, with <code>and</code>, <code>or</code>, <code>not</code> and brackets. For example <code>amount &gt;= 100000</code>, or <code>found = true</code>.</p>
            <p className="ls-caption"><code>account_status in [disabled] else [active]</code> names the acceptable values first and the finding values second. A value in neither list is left for a person to decide.</p>
          </div>
        </div>
      </details>
      {submitted && !validation.ok ? <div tabIndex={-1} data-compliance-error><Banner tone="warning" title={`The Compliance Rule was not saved. ${validation.reason}`} /></div> : null}
      <Button type="submit" disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : undefined} variant="primary" busy={busy}>{busy ? 'Saving…' : 'Save Compliance Rule'}</Button>
    </form>
  </div>;
}
