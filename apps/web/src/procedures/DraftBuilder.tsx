'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { POPULATION_DRAFT_LIMITS, POPULATION_DRAFT_MESSAGES, bindingDigestEnvelope, evidenceBlockersFor, isExplicitPeriod, isScopeStatement, isInclusionRule, type InclusionPredicate } from '@intellifin/domain';
import type { PopulationSourceBinding, ProcedureVersionView, DraftPopulationEdit, UpdatePopulationDraftResult, TargetSystemRegistration, UpdateTargetDraftResult, UpdateComplianceDraftResult, UpdateEvidenceDraftResult } from '@intellifin/application';
import type { PopulationDraftFields, RenameActionResult, RenameDraftFields, TargetDraftFields, ComplianceDraftFields, EvidenceDraftFields } from '../../app/procedures/[id]/builder/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { COUNT_MECHANISM_WORDS, FILTER_COMPARISONS, filterComparisonId } from '../design/plain-words';
import { ReadinessPanel } from './ReadinessPanel';
import { BuilderSections } from './BuilderSections';
import { RenameDraftForm } from './RenameDraftForm';
import { TargetSelectionForm } from './TargetSelectionForm';
import { AuditInstructionsForm } from './AuditInstructionsForm';
import { ComplianceRuleForm } from './ComplianceRuleForm';
import { EvidenceRequirementsForm, ScheduleForm } from './EvidenceScheduleForm';
import { AgentSummary } from './AgentSummary';
import { ExecutablePlanPreview } from './ExecutablePlanPreview';
import { useSection, useSectionSubmissionStatus, useSubmissionGuard, BuilderSubmissionProvider } from './use-section';
import { SectionConflict } from './SectionConflict';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';
import { RetryPlanDerivation, type RetryPlanDerivationFields, type RetryPlanDerivationResult } from './RetryPlanDerivation';
import { submissionUnavailableReason } from '@intellifin/application';
import { VersionActions } from './VersionActions';

function DraftBuilderContent({ draft, sources, registrations, rowVersion, onSave, onSaveTargets, onSaveCompliance, onSaveEvidence, onRename, onRetryPlan }: {
  readonly draft: ProcedureVersionView;
  readonly sources: readonly PopulationSourceBinding[];
  readonly registrations: readonly TargetSystemRegistration[];
  readonly rowVersion: string;
  readonly onSave: (fields: PopulationDraftFields) => Promise<UpdatePopulationDraftResult>;
  readonly onSaveTargets: (fields: TargetDraftFields) => Promise<UpdateTargetDraftResult>;
  readonly onSaveCompliance: (fields: ComplianceDraftFields) => Promise<UpdateComplianceDraftResult>;
  readonly onSaveEvidence: (fields: EvidenceDraftFields) => Promise<UpdateEvidenceDraftResult>;
  readonly onRename: (fields: RenameDraftFields) => Promise<RenameActionResult>;
  readonly onRetryPlan: (fields: RetryPlanDerivationFields) => Promise<RetryPlanDerivationResult>;
}): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const periodSection = useSection({ from: draft.period?.from ?? '', to: draft.period?.to ?? '', scope: draft.scope }, token);
  const { from, to, scope } = periodSection.value;
  const setFrom = (value: string) => periodSection.edit({ ...periodSection.current.current.value, from: value });
  const setTo = (value: string) => periodSection.edit({ ...periodSection.current.current.value, to: value });
  const setScope = (value: string) => periodSection.edit({ ...periodSection.current.current.value, scope: value });
  const populationSection = useSection({ selection: draft.sourceSnapshot === null ? '' : 'retain', sourceSnapshot: draft.sourceSnapshot, predicates: draft.inclusionRule.all, zeroRecordPass: draft.zeroRecordPass, duplicates: draft.allowVersionedDuplicates }, token);
  const { selection, sourceSnapshot, predicates, zeroRecordPass, duplicates } = populationSection.value;
  const setSelection = (value: string) => populationSection.edit({ ...populationSection.current.current.value, selection: value });
  const setPredicates = (update: (value: readonly InclusionPredicate[]) => readonly InclusionPredicate[]) => populationSection.edit({ ...populationSection.current.current.value, predicates: update(populationSection.current.current.value.predicates) });
  const setZeroRecordPass = (value: boolean) => populationSection.edit({ ...populationSection.current.current.value, zeroRecordPass: value });
  const setDuplicates = (value: boolean) => populationSection.edit({ ...populationSection.current.current.value, duplicates: value });
  const [periodTouched, setPeriodTouched] = useState(false);
  const [ruleTouched, setRuleTouched] = useState(false);
  const [result, setResult] = useState<UpdatePopulationDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const saving = useRef(false);
  useSectionSubmissionStatus('Period and scope', periodSection, busy, unknownOutcome);
  useSectionSubmissionStatus('Population Source', populationSection, busy, unknownOutcome);
  const submissionGuard = useSubmissionGuard();
  const selected = sources.find((s) => s.bindingId === selection);
  const contract = selection === 'retain' ? sourceSnapshot?.contract : selected === undefined ? undefined : { declared_schema: selected.declaredSchema, declared_count_mechanism: selected.declaredCountMechanism, kind: selected.kind };
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
  // Owner decision (2026-09-08): an ordinary Draft section save is a DIRECT save with a
  // visible saved / unsaved / error state. No dialog and no autosave — the confirmation
  // is kept for the decisions this page cannot take back (submit, approve, reject,
  // activation, scope expansion, cancellation, rerun). See EXPERIENCE.md's confirmation
  // table and its dated revision note.
  function requestSave(section: 'period-scope' | 'population-source'): void {
    if (saving.current || unknownOutcome) return;
    if (section === 'period-scope' ? periodSection.current.current.conflict : populationSection.current.current.conflict) return;
    setResult(null);
    if (section === 'period-scope') {
      setPeriodTouched(true);
      if (periodError !== null) return;
      void save({ section, period: { from, to }, scope });
    } else {
      setRuleTouched(true);
      if (bindingError !== null) return;
      void save({ section, source: selection === 'retain' ? { mode: 'retain' } : { mode: 'bind', bindingId: selected!.bindingId, expectedDigest: selected!.digest }, inclusionRule: rule, zeroRecordPass, allowVersionedDuplicates: duplicates });
    }
  }
  async function save(edit: DraftPopulationEdit): Promise<void> {
    if (saving.current || unknownOutcome) return;
    saving.current = true;
    setBusy(true);
    if (edit.section === 'period-scope' ? periodSection.current.current.conflict : populationSection.current.current.conflict) { saving.current = false; setBusy(false); return; }
    if (edit.section === 'period-scope') periodSection.begin({ from, to, scope });
    else {
      const source = edit.source;
      const bound = source.mode === 'bind' ? sources.find((entry) => entry.bindingId === source.bindingId) : undefined;
      populationSection.begin({ selection: 'retain', sourceSnapshot: bound === undefined ? sourceSnapshot : { bindingId: bound.bindingId, displayName: bound.displayName, digest: bound.digest, contract: bindingDigestEnvelope(bound) }, predicates, zeroRecordPass, duplicates });
    }
    const sectionToken = edit.section === 'period-scope' ? periodSection.current.current.token : populationSection.current.current.token;
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: sectionToken, edit });
      if (edit.section === 'period-scope') periodSection.finish(outcome.ok ? outcome.rowVersion : undefined);
      else populationSection.finish(outcome.ok ? outcome.rowVersion : undefined);
      setResult(outcome);
      if (outcome.ok) setToken(outcome.rowVersion);
    } catch { if (edit.section === 'period-scope') periodSection.finish(); else populationSection.finish(); setUnknownOutcome(true); setResult(null); }
    finally { setAnnouncement((n) => n + 1); saving.current = false; setBusy(false); }
  }
  const periodEditor = <form method="post" className="ls-stack" onSubmit={(e) => { e.preventDefault(); requestSave('period-scope'); }} onBlur={() => setPeriodTouched(true)}>
    <SectionConflict dirty={periodSection.status().dirty} conflict={periodSection.conflict} name="Period and scope" reset={() => periodSection.reset()} />
    <p id={`${id}-utc`}>Both dates are included, and both are UTC. This is the period the records are tested over.</p>
    <div className="ls-dialog__field"><label htmlFor={`${id}-from`}>Period start</label><input className="ls-input" id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-dialog__field"><label htmlFor={`${id}-to`}>Period end</label><input className="ls-input" id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-dialog__field"><label htmlFor={`${id}-scope`}>Scope statement</label><textarea className="ls-input" id={`${id}-scope`} value={scope} maxLength={POPULATION_DRAFT_LIMITS.scope} onChange={(e) => setScope(e.target.value)} aria-describedby={`${id}-period-error`} /></div>
    <div id={`${id}-period-error`} aria-live="polite">{periodTouched && periodError !== null ? <Banner tone="warning" title={periodError} /> : null}</div>
    <Button type="submit" busy={busy} disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : undefined} variant="primary">Save Period and scope</Button>
  </form>;
  const populationEditor = <form method="post" className="ls-stack" onSubmit={(e) => { e.preventDefault(); requestSave('population-source'); }} onBlur={() => setRuleTouched(true)}>
    <SectionConflict dirty={populationSection.status().dirty} conflict={populationSection.conflict} name="Population Source" reset={() => populationSection.reset()} />
    <div className="ls-dialog__field"><label htmlFor={`${id}-source`}>Where the records come from</label>
      <select className="ls-input" id={`${id}-source`} value={selection} onChange={(e) => { setSelection(e.target.value); setRuleTouched(true); }} aria-describedby={`${id}-source-help ${id}-binding-error ${id}-count`}>
        <option value="">Choose a source</option>
        {sourceSnapshot === null ? null : <option value="retain">Keep the one already saved: {sourceSnapshot.displayName}</option>}
        {sources.map((s) => <option key={s.bindingId} value={s.bindingId}>{s.displayName}</option>)}
      </select>
      <p className="ls-caption" id={`${id}-source-help`}>The list of records this procedure tests. An administrator sets these up under Administration.</p>
    </div>
    {sources.length === 0 ? <p>No sources are available yet. Ask a PoC Administrator to add one under Administration.</p> : null}
    {contract === undefined ? null : <div className="ls-stack ls-source-facts">
      <p>This source provides: {contract.declared_schema.join(', ')}.</p>
      <p className="ls-caption">{COUNT_MECHANISM_WORDS[contract.declared_count_mechanism].label} — {COUNT_MECHANISM_WORDS[contract.declared_count_mechanism].detail}</p>
    </div>}
    {selection === 'retain' ? <p className="ls-caption">The saved source is kept exactly as it was, even if it is later retired.</p> : null}
    <div id={`${id}-count`} aria-live="polite">{missingCount ? <Banner tone="warning" title={POPULATION_DRAFT_MESSAGES.COUNT_MISSING} /> : null}</div>
    {evidenceBlockersFor(contract === undefined ? null : { contract }, draft.schedule).includes('upload-frequency-mismatch') ? <Banner tone="warning" title={MANUAL_UPLOAD_SENTENCE} /> : null}
    <fieldset className="ls-stack"><legend>Which records to test</legend>
      <p className="ls-caption">Every record is tested unless you add a filter. A record is tested only when it matches every filter you add. Changing the source keeps your filters so you can check them.</p>
      {predicates.length === 0 ? <p data-no-filters>No filters. Every record in the source is tested.</p> : null}
      {predicates.map((predicate, index) => <fieldset key={index} className="ls-stack ls-filter" data-filter={index}><legend>Filter {index + 1}</legend>
        <div className="ls-filter__row">
          <div className="ls-dialog__field">
            <label htmlFor={`${id}-column-${index}`}>Field {index + 1}</label>
            <select className="ls-input" id={`${id}-column-${index}`} value={predicate.column} onChange={(e) => changePredicate(index, { ...predicate, column: e.target.value })}>
              <option value="">Choose a field</option>
              {predicate.column !== '' && !contract?.declared_schema.includes(predicate.column) ? <option value={predicate.column}>{predicate.column} (this source does not provide it)</option> : null}
              {contract?.declared_schema.map((column) => <option key={column} value={column}>{column}</option>)}
            </select>
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={`${id}-kind-${index}`}>Test {index + 1}</label>
            <select className="ls-input" id={`${id}-kind-${index}`} value={filterComparisonId(predicate)} onChange={(e) => {
              const chosen = FILTER_COMPARISONS.find((option) => option.id === e.target.value);
              if (chosen === undefined) return;
              // The stored value survives a change of test, so switching "is at least"
              // to "is more than" does not silently empty the box somebody just typed in.
              const value = predicate.kind === 'within-period' ? '' : predicate.value;
              changePredicate(index,
                chosen.kind === 'within-period' ? { column: predicate.column, kind: 'within-period' }
                : chosen.kind === 'text' ? { column: predicate.column, kind: 'text', operator: 'eq', value }
                : { column: predicate.column, kind: 'decimal', operator: chosen.operator, value });
            }}>
              {FILTER_COMPARISONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          {predicate.kind === 'within-period' ? <p className="ls-caption">Uses the period you set above, both dates included.</p> : <div className="ls-dialog__field">
            <label htmlFor={`${id}-value-${index}`}>Value {index + 1}</label>
            <input className="ls-input" id={`${id}-value-${index}`} type="text" value={predicate.value} maxLength={predicate.kind === 'decimal' ? POPULATION_DRAFT_LIMITS.decimal : POPULATION_DRAFT_LIMITS.text} onChange={(e) => changePredicate(index, { ...predicate, value: e.target.value })} />
          </div>}
        </div>
        <Button type="button" onClick={() => setPredicates((current) => current.filter((_, i) => i !== index))}>Remove filter {index + 1}</Button>
      </fieldset>)}
      {predicates.length >= POPULATION_DRAFT_LIMITS.predicates ? <p id={`${id}-clause-limit`}>You can add up to {POPULATION_DRAFT_LIMITS.predicates} filters.</p> : null}
      <Button type="button" disabledReason={predicates.length >= POPULATION_DRAFT_LIMITS.predicates ? `You can add up to ${POPULATION_DRAFT_LIMITS.predicates} filters.` : undefined} disabledReasonId={`${id}-clause-limit`} onClick={() => setPredicates((current) => [...current, { column: '', kind: 'text', operator: 'eq', value: '' }])}>Add a filter</Button>
    </fieldset>
    <details className="ls-disclosure">
      <summary>More options</summary>
      <div className="ls-disclosure__body">
        <label><input type="checkbox" checked={zeroRecordPass} onChange={(e) => setZeroRecordPass(e.target.checked)} /> Let this procedure pass when no records match</label>
        <p className="ls-caption">Off by default. With it off, a run that finds nothing to test is reported as inconclusive rather than as a pass.</p>
        <label><input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} /> Allow the same record to appear more than once</label>
        <p className="ls-caption">Off by default. Turn it on only when the source legitimately lists one record several times.</p>
      </div>
    </details>
    <div id={`${id}-binding-error`} aria-live="polite">{(ruleTouched || contract?.kind === 'manual-upload') && bindingError !== null ? <Banner tone="warning" title={bindingError} /> : null}</div>
    <Button type="submit" busy={busy} disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : undefined} variant="primary">Save records to test</Button>
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
    <UnknownSaveOutcome visible={unknownOutcome} />
    {result === null ? null : <Banner key={announcement} tone={result.ok ? 'success' : 'danger'} title={result.ok ? result.changed ? 'Saved. The Draft change is recorded in the audit chain.' : 'Saved. Nothing changed, so nothing was recorded.' : result.reason} />}
    <BuilderSections draft={draft} sections={draft.sections} periodScope={periodEditor} populationSource={populationEditor} targetSystems={targetSystemsEditor} auditInstructions={auditInstructionsEditor} complianceRule={complianceRuleEditor} evidenceRequirements={evidenceRequirementsEditor} schedule={scheduleEditor} />
    <ReadinessPanel inputs={{ templateId: draft.templateId, targets: draft.targets, sourceSnapshot: draft.sourceSnapshot, complianceConditions: draft.complianceConditions, evidenceRequirements: draft.evidenceRequirements }} headingId={`${id}-readiness`} />
    {/*
      The plan and its preview are the platform proving what it will execute, which is
      the right thing to be able to read and the wrong thing to meet first: an auditor
      setting up a control does not start by reading a compiled step list. It folds away
      rather than moving off the page, because the person who wants it wants it here.
    */}
    <div className="ls-card">
      <details className="ls-disclosure" data-plan-detail>
        <summary>What the agent will do, step by step</summary>
        <div className="ls-disclosure__body">
          <AgentSummary draft={draft} headingId={`${id}-agent-summary`} readiness={false} />
          <ExecutablePlanPreview draft={draft} />
        </div>
      </details>
    </div>
    <VersionActions procedureId={draft.procedureId} versionId={draft.versionId} rowVersion={token} beforeConfirm={submissionGuard.check} actions={[{ decision: 'submit', label: 'Submit for approval', reason: submissionGuard.reason ?? submissionUnavailableReason(draft) }]} />
    {draft.state === 'DRAFT' && draft.planStatus === 'failed' ? <RetryPlanDerivation draft={draft} rowVersion={token} onRetry={async (fields) => { const outcome = await onRetryPlan(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} /> : null}
    <RenameDraftForm savedControlName={draft.controlName} procedureId={draft.procedureId} versionId={draft.versionId} rowVersion={token} onRename={async (fields) => { const outcome = await onRename(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} />
  </div>;
}

export function DraftBuilder(props: Parameters<typeof DraftBuilderContent>[0]): React.JSX.Element { return <BuilderSubmissionProvider><DraftBuilderContent {...props} /></BuilderSubmissionProvider>; }
