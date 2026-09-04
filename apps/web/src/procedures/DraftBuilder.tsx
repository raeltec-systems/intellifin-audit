'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { POPULATION_DRAFT_LIMITS, POPULATION_DRAFT_MESSAGES, isExplicitPeriod, isScopeStatement, isInclusionRule, type InclusionPredicate } from '@intellifin/domain';
import type { PopulationSourceBinding, ProcedureVersionView, DraftPopulationEdit, UpdatePopulationDraftResult, TargetSystemRegistration, UpdateTargetDraftResult, UpdateComplianceDraftResult, UpdateEvidenceDraftResult } from '@intellifin/application';
import type { PopulationDraftFields, RenameActionResult, RenameDraftFields, TargetDraftFields, ComplianceDraftFields, EvidenceDraftFields } from '../../app/procedures/[id]/builder/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { BuilderSections } from './BuilderSections';
import { RenameDraftForm } from './RenameDraftForm';
import { TargetSelectionForm } from './TargetSelectionForm';
import { AuditInstructionsForm } from './AuditInstructionsForm';
import { ComplianceRuleForm } from './ComplianceRuleForm';
import { EvidenceRequirementsForm, ScheduleForm } from './EvidenceScheduleForm';

export function DraftBuilder({ draft, sources, registrations, rowVersion, onSave, onSaveTargets, onSaveCompliance, onSaveEvidence, onRename }: {
  readonly draft: ProcedureVersionView;
  readonly sources: readonly PopulationSourceBinding[];
  readonly registrations: readonly TargetSystemRegistration[];
  readonly rowVersion: string;
  readonly onSave: (fields: PopulationDraftFields) => Promise<UpdatePopulationDraftResult>;
  readonly onSaveTargets: (fields: TargetDraftFields) => Promise<UpdateTargetDraftResult>;
  readonly onSaveCompliance: (fields: ComplianceDraftFields) => Promise<UpdateComplianceDraftResult>;
  readonly onSaveEvidence: (fields: EvidenceDraftFields) => Promise<UpdateEvidenceDraftResult>;
  readonly onRename: (fields: RenameDraftFields) => Promise<RenameActionResult>;
}): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const [from, setFrom] = useState(draft.period?.from ?? '');
  const [to, setTo] = useState(draft.period?.to ?? '');
  const [scope, setScope] = useState(draft.scope);
  const [selection, setSelection] = useState(draft.sourceSnapshot === null ? '' : 'retain');
  const [predicates, setPredicates] = useState<readonly InclusionPredicate[]>(draft.inclusionRule.all);
  const [zeroRecordPass, setZeroRecordPass] = useState(draft.zeroRecordPass);
  const [duplicates, setDuplicates] = useState(draft.allowVersionedDuplicates);
  const [periodTouched, setPeriodTouched] = useState(false);
  const [ruleTouched, setRuleTouched] = useState(false);
  const [confirming, setConfirming] = useState<DraftPopulationEdit | null>(null);
  const [result, setResult] = useState<UpdatePopulationDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const selected = sources.find((s) => s.bindingId === selection);
  const contract = selection === 'retain' ? draft.sourceSnapshot?.contract : selected === undefined ? undefined : { declared_schema: selected.declaredSchema, declared_count_mechanism: selected.declaredCountMechanism, kind: selected.kind };
  const rule = { schemaVersion: 1 as const, all: predicates };
  const periodError = !isExplicitPeriod({ from, to }) ? POPULATION_DRAFT_MESSAGES.PERIOD : !isScopeStatement(scope) ? POPULATION_DRAFT_MESSAGES.SCOPE : null;
  // The upload/frequency pairing is no longer checked here (Story 2.5): the Schedule is a
  // real, auditor-set field now, and the pairing is a completeness blocker
  // (`draft.evidenceBlockers`) surfaced inline on both sections, never a save-time refusal.
  const bindingError = contract === undefined ? POPULATION_DRAFT_MESSAGES.SOURCE : !isInclusionRule(rule, contract.declared_schema) ? POPULATION_DRAFT_MESSAGES.RULE : null;
  const missingCount = contract?.declared_count_mechanism === 'none';
  function changePredicate(index: number, predicate: InclusionPredicate): void {
    setPredicates((current) => current.map((p, i) => i === index ? predicate : p));
  }
  function requestSave(section: 'period-scope' | 'population-source'): void {
    if (saving.current) return;
    setResult(null);
    if (section === 'period-scope') {
      setPeriodTouched(true);
      if (periodError !== null) return;
      setConfirming({ section, period: { from, to }, scope });
    } else {
      setRuleTouched(true);
      if (bindingError !== null) return;
      setConfirming({ section, source: selection === 'retain' ? { mode: 'retain' } : { mode: 'bind', bindingId: selected!.bindingId, expectedDigest: selected!.digest }, inclusionRule: rule, zeroRecordPass, allowVersionedDuplicates: duplicates });
    }
  }
  async function save(): Promise<void> {
    if (saving.current || confirming === null) return;
    saving.current = true;
    setBusy(true);
    const edit = confirming;
    setConfirming(null);
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: token, edit });
      setResult(outcome);
      if (outcome.ok) setToken(outcome.rowVersion);
    } catch { setResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' }); }
    finally { setAnnouncement((n) => n + 1); saving.current = false; setBusy(false); }
  }
  const periodEditor = <form method="post" className="ls-stack" onSubmit={(e) => { e.preventDefault(); requestSave('period-scope'); }} onBlur={() => setPeriodTouched(true)}>
    <p id={`${id}-utc`}>Start and end dates are inclusive in UTC. This explicit Period does not derive a scheduled Run period.</p>
    <div className="ls-dialog__field"><label htmlFor={`${id}-from`}>Period start</label><input className="ls-input" id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-dialog__field"><label htmlFor={`${id}-to`}>Period end</label><input className="ls-input" id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-dialog__field"><label htmlFor={`${id}-scope`}>Scope statement</label><textarea className="ls-input" id={`${id}-scope`} value={scope} maxLength={POPULATION_DRAFT_LIMITS.scope} onChange={(e) => setScope(e.target.value)} aria-describedby={`${id}-period-error`} /></div>
    <div id={`${id}-period-error`} aria-live="polite">{periodTouched && periodError !== null ? <Banner tone="warning" title={periodError} /> : null}</div>
    <Button type="submit" busy={busy} variant="primary">Save Period and scope</Button>
  </form>;
  const populationEditor = <form method="post" className="ls-stack" onSubmit={(e) => { e.preventDefault(); requestSave('population-source'); }} onBlur={() => setRuleTouched(true)}>
    <div className="ls-dialog__field"><label htmlFor={`${id}-source`}>Population Source</label>
      <select className="ls-input" id={`${id}-source`} value={selection} onChange={(e) => { setSelection(e.target.value); setRuleTouched(true); }} aria-describedby={`${id}-binding-error ${id}-count`}>
        <option value="">Choose an active Population Source</option>
        {draft.sourceSnapshot === null ? null : <option value="retain">Retain saved snapshot: {draft.sourceSnapshot.displayName}</option>}
        {sources.map((s) => <option key={s.bindingId} value={s.bindingId}>{s.displayName}</option>)}
      </select>
    </div>
    {sources.length === 0 ? <p>No active Population Sources are available. Ask a PoC Administrator to register one.</p> : null}
    {contract === undefined ? null : <p>Declared columns: {contract.declared_schema.join(', ')}. Count declaration: {contract.declared_count_mechanism}.</p>}
    {selection === 'retain' ? <p>The saved source contract is retained, including after its registration is retired.</p> : null}
    <div id={`${id}-count`} aria-live="polite">{missingCount ? <Banner tone="warning" title={POPULATION_DRAFT_MESSAGES.COUNT_MISSING} /> : null}</div>
    {draft.evidenceBlockers.includes('upload-frequency-mismatch') ? <Banner tone="warning" title={MANUAL_UPLOAD_SENTENCE} /> : null}
    <fieldset className="ls-stack"><legend>Inclusion rule</legend>
      <p>Include records that match all clauses. An empty rule includes all records. Changing a source keeps every clause for you to check.</p>
      {predicates.map((predicate, index) => <fieldset key={index} className="ls-stack"><legend>Clause {index + 1}</legend>
        <label htmlFor={`${id}-column-${index}`}>Declared column {index + 1}</label>
        <select className="ls-input" id={`${id}-column-${index}`} value={predicate.column} onChange={(e) => changePredicate(index, { ...predicate, column: e.target.value })}>
          <option value="">Choose a declared column</option>
          {predicate.column !== '' && !contract?.declared_schema.includes(predicate.column) ? <option value={predicate.column}>{predicate.column} (not declared by the selected source)</option> : null}
          {contract?.declared_schema.map((column) => <option key={column} value={column}>{column}</option>)}
        </select>
        <label htmlFor={`${id}-kind-${index}`}>Comparison type {index + 1}</label>
        <select className="ls-input" id={`${id}-kind-${index}`} value={predicate.kind} onChange={(e) => changePredicate(index, e.target.value === 'within-period' ? { column: predicate.column, kind: 'within-period' } : { column: predicate.column, kind: e.target.value as 'text' | 'decimal', operator: 'eq', value: '' })}>
          <option value="text">Text equality</option><option value="decimal">Decimal comparison</option><option value="within-period">Within explicit Period</option>
        </select>
        {predicate.kind === 'decimal' ? <><label htmlFor={`${id}-operator-${index}`}>Decimal operator {index + 1}</label><select className="ls-input" id={`${id}-operator-${index}`} value={predicate.operator} onChange={(e) => changePredicate(index, { ...predicate, operator: e.target.value as typeof predicate.operator })}>
          <option value="eq">Equal to</option><option value="neq">Not equal to</option><option value="gt">Greater than (exclusive)</option><option value="gte">Greater than or equal to (inclusive)</option><option value="lt">Less than (exclusive)</option><option value="lte">Less than or equal to (inclusive)</option>
        </select></> : null}
        {predicate.kind === 'within-period' ? <p>Uses the saved Period, including both UTC boundary dates.</p> : <><label htmlFor={`${id}-value-${index}`}>Comparison value {index + 1}</label><input className="ls-input" id={`${id}-value-${index}`} type="text" value={predicate.value} maxLength={predicate.kind === 'decimal' ? POPULATION_DRAFT_LIMITS.decimal : POPULATION_DRAFT_LIMITS.text} onChange={(e) => changePredicate(index, { ...predicate, value: e.target.value })} /></>}
        <Button type="button" onClick={() => setPredicates((current) => current.filter((_, i) => i !== index))}>Remove clause {index + 1}</Button>
      </fieldset>)}
      {predicates.length >= POPULATION_DRAFT_LIMITS.predicates ? <p id={`${id}-clause-limit`}>An inclusion rule supports at most 32 clauses.</p> : null}
      <Button type="button" disabledReason={predicates.length >= POPULATION_DRAFT_LIMITS.predicates ? 'An inclusion rule supports at most 32 clauses.' : undefined} disabledReasonId={`${id}-clause-limit`} onClick={() => setPredicates((current) => [...current, { column: '', kind: 'text', operator: 'eq', value: '' }])}>Add clause</Button>
    </fieldset>
    <label><input type="checkbox" checked={zeroRecordPass} onChange={(e) => setZeroRecordPass(e.target.checked)} /> Permit a zero-record Pass</label>
    <label><input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} /> Permit versioned duplicate primary keys</label>
    <div id={`${id}-binding-error`} aria-live="polite">{(ruleTouched || contract?.kind === 'manual-upload') && bindingError !== null ? <Banner tone="warning" title={bindingError} /> : null}</div>
    <Button type="submit" busy={busy} variant="primary">Save Population Source binding</Button>
  </form>;
  // Every target editor shares the Draft's row-version token: a save through one moves the
  // token every other editor guards against, exactly as the population and rename saves do.
  const saveTargets = async (fields: TargetDraftFields): Promise<UpdateTargetDraftResult> => {
    const outcome = await onSaveTargets(fields);
    if (outcome.ok) setToken(outcome.rowVersion);
    return outcome;
  };
  const targetSystemsEditor = <TargetSelectionForm draft={draft} registrations={registrations} rowVersion={token} onSave={saveTargets} />;
  const auditInstructionsEditor = <AuditInstructionsForm draft={draft} registrations={registrations} rowVersion={token} onSave={saveTargets} />;
  const complianceRuleEditor = <ComplianceRuleForm draft={draft} rowVersion={token} onSave={async (fields) => {
    const outcome = await onSaveCompliance(fields);
    if (outcome.ok) setToken(outcome.rowVersion);
    return outcome;
  }} />;
  const saveEvidence = async (fields: EvidenceDraftFields): Promise<UpdateEvidenceDraftResult> => {
    const outcome = await onSaveEvidence(fields);
    if (outcome.ok) setToken(outcome.rowVersion);
    return outcome;
  };
  const evidenceRequirementsEditor = <EvidenceRequirementsForm draft={draft} rowVersion={token} onSave={saveEvidence} />;
  const scheduleEditor = <ScheduleForm draft={draft} rowVersion={token} onSave={saveEvidence} />;
  return <div className="ls-stack">
    {result === null ? null : <Banner key={announcement} tone={result.ok ? 'success' : 'danger'} title={result.ok ? result.changed ? 'Saved. The Draft change is recorded in the audit chain.' : 'Saved. Nothing changed, so nothing was recorded.' : result.reason} />}
    <BuilderSections sections={draft.sections} periodScope={periodEditor} populationSource={populationEditor} targetSystems={targetSystemsEditor} auditInstructions={auditInstructionsEditor} complianceRule={complianceRuleEditor} evidenceRequirements={evidenceRequirementsEditor} schedule={scheduleEditor} />
    <RenameDraftForm procedureId={draft.procedureId} versionId={draft.versionId} rowVersion={token} onRename={async (fields) => { const outcome = await onRename(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} />
    <ConfirmDialog open={confirming !== null} weight="routine" title={confirming?.section === 'period-scope' ? 'Save Period and scope?' : 'Save Population Source binding?'} consequence={`This changes Draft version ${draft.versionNumber} of ${draft.controlName}. The change is recorded in the audit chain against your name.`} confirmLabel="Save Draft changes" onConfirm={() => { void save(); }} onCancel={() => setConfirming(null)} />
  </div>;
}
