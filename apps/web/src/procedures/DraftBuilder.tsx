'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { draftContext, POPULATION_DRAFT_LIMITS, POPULATION_DRAFT_MESSAGES, bindingDigestEnvelope, evidenceBlockersFor, isExplicitPeriod, isScopeStatement, isInclusionRule, type InclusionPredicate } from '@intellifin/domain';
import type { PopulationSourceBinding, ProcedureVersionView, DraftPopulationEdit, UpdatePopulationDraftResult, TargetSystemRegistration, UpdateTargetDraftResult, UpdateComplianceDraftResult, UpdateEvidenceDraftResult, UpdateContextDraftResult } from '@intellifin/application';
import type { ReviewSectionFields, ContextDraftFields, PopulationDraftFields, RenameActionResult, RenameDraftFields, TargetDraftFields, ComplianceDraftFields, EvidenceDraftFields } from '../../app/procedures/[id]/builder/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { MANUAL_UPLOAD_SENTENCE } from '../design/copy';
import { COUNT_MECHANISM_WORDS, FILTER_COMPARISONS, filterComparisonId } from '../design/plain-words';
import { ReadinessPanel } from './ReadinessPanel';
import { TemplateContextForm } from './TemplateContextForm';
import { WritingAssistantProvider, PreparationAssistant, type WritingAssistantActions, type PreparationStep } from './WritingAssistant';
import { streamAuthoringSuggestion } from './authoring-chat-transport';
import { GuidedPreparation } from './GuidedPreparation';
import { GuidedQuestions } from './GuidedQuestions';
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

function DraftBuilderContent({ draft, sources, registrations, rowVersion, onSave, onSaveContext, onReview, onWriting, onSaveTargets, onSaveCompliance, onSaveEvidence, onRename, onRetryPlan }: {
  readonly draft: ProcedureVersionView;
  readonly sources: readonly PopulationSourceBinding[];
  readonly registrations: readonly TargetSystemRegistration[];
  readonly rowVersion: string;
  readonly onWriting: WritingAssistantActions;
  readonly onReview: (fields: ReviewSectionFields) => Promise<{ ok: true; rowVersion: string } | { ok: false; reason: string }>;
  readonly onSaveContext: (fields: ContextDraftFields) => Promise<UpdateContextDraftResult>;
  readonly onSave: (fields: PopulationDraftFields) => Promise<UpdatePopulationDraftResult>;
  readonly onSaveTargets: (fields: TargetDraftFields) => Promise<UpdateTargetDraftResult>;
  readonly onSaveCompliance: (fields: ComplianceDraftFields) => Promise<UpdateComplianceDraftResult>;
  readonly onSaveEvidence: (fields: EvidenceDraftFields) => Promise<UpdateEvidenceDraftResult>;
  readonly onRename: (fields: RenameDraftFields) => Promise<RenameActionResult>;
  readonly onRetryPlan: (fields: RetryPlanDerivationFields) => Promise<RetryPlanDerivationResult>;
}): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  const [activeStep, setActiveStep] = useState<PreparationStep>('context');
  const [scopeQuestion, setScopeQuestion] = useState('intent');
  const [evidenceQuestion, setEvidenceQuestion] = useState('source');
  const [guidedNotice, setGuidedNotice] = useState<{ question: string; title: string } | null>(null);
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
  async function save(edit: Exclude<DraftPopulationEdit, { section: 'scope-note' }>): Promise<void> {
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
      if (outcome.ok) {
        setToken(outcome.rowVersion);
        if (edit.section === 'population-source') setEvidenceQuestion(current => current === 'source' ? 'systems' : current);
        else setScopeQuestion(current => current === 'period' ? 'confirm' : current);
      }
    } catch { if (edit.section === 'period-scope') periodSection.finish(); else populationSection.finish(); setUnknownOutcome(true); setResult(null); }
    finally { setAnnouncement((n) => n + 1); saving.current = false; setBusy(false); }
  }
  const periodEditor = <form method="post" className="ls-stack" onSubmit={(e) => { e.preventDefault(); requestSave('period-scope'); }} onBlur={() => setPeriodTouched(true)}>
    <SectionConflict dirty={periodSection.status().dirty} conflict={periodSection.conflict} name="Period and scope" reset={() => periodSection.reset()} />
    <p id={`${id}-utc`}>Both dates are included, and both are UTC. A Run you start by hand tests these dates. Frequency settings describe the approved intent; automatic scheduled execution is not available yet.</p>
    <div className="ls-dialog__field"><label htmlFor={`${id}-from`}>Period start</label><input className="ls-input" id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-dialog__field"><label htmlFor={`${id}-to`}>Period end</label><input className="ls-input" id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={`${id}-utc ${id}-period-error`} /></div>
    <div className="ls-guide-facts"><p><strong>Scope to save with these dates</strong></p><p>{scope || 'Write the scope below, or return to Describe the scope for assistance.'}</p></div>
    <details className="ls-disclosure" data-guided-manual="scope">
      <summary>Write or edit the scope myself</summary>
      <div className="ls-disclosure__body"><div className="ls-dialog__field"><label htmlFor={`${id}-scope`}>Scope statement</label><textarea className="ls-input" id={`${id}-scope`} value={scope} maxLength={POPULATION_DRAFT_LIMITS.scope} onChange={(e) => setScope(e.target.value)} aria-describedby={`${id}-period-error`} /></div>
      <Button type="button" onClick={() => setScopeQuestion('intent')}>Get help describing the scope</Button></div>
    </details>
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
    if (outcome.ok) {
      setToken(outcome.rowVersion);
      if (fields.edit.section === 'target-systems') {
        setGuidedNotice({ question: 'capture', title: 'Target systems saved. Next, choose the proof to retain.' });
        setEvidenceQuestion(current => current === 'systems' ? 'capture' : current);
      }
    }
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
    if (outcome.ok) {
      setToken(outcome.rowVersion);
      if (fields.edit.section === 'evidence-requirements') {
        setGuidedNotice({ question: 'confirm', title: 'Evidence choices saved. Check them below before reviewing this section.' });
        setEvidenceQuestion(current => current === 'capture' ? 'confirm' : current);
      }
    }
    return outcome;
  };
  const evidenceRequirementsEditor = <EvidenceRequirementsForm draft={draft} rowVersion={token} onSave={saveEvidence} />;
  const scheduleEditor = <ScheduleForm draft={draft} rowVersion={token} onSave={saveEvidence} />;
  return <WritingAssistantProvider draft={draft} rowVersion={token} onRowVersion={setToken} actions={{ ...onWriting, generate: streamAuthoringSuggestion }}
    onAccepted={section => { if (section.kind === 'scope') setScopeQuestion(current => current === 'intent' ? 'period' : current); }}><div className="ls-stack">
    <UnknownSaveOutcome visible={unknownOutcome} />
    {activeStep === 'evidence' && guidedNotice?.question === evidenceQuestion ? <Banner tone="success" title={guidedNotice.title} /> : null}
    {result === null ? null : <Banner key={announcement} tone={result.ok ? 'success' : 'danger'} title={result.ok ? result.changed ? 'Saved. The Draft change is recorded in the audit chain.' : 'Saved. Nothing changed, so nothing was recorded.' : result.reason} />}
    <GuidedPreparation onStepChange={setActiveStep} assistant={step => step === 'scope' ? null : <PreparationAssistant step={step} />} draft={draft} rowVersion={token} onRowVersion={setToken} onReview={onReview} editors={{
      context: <><TemplateContextForm draft={draft} rowVersion={token} onSave={async fields => { const outcome = await onSaveContext(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} /><RenameDraftForm savedControlName={draft.controlName} procedureId={draft.procedureId} versionId={draft.versionId} rowVersion={token} onRename={async fields => { const outcome = await onRename(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} /></>,
      scope: <GuidedQuestions label="Scope questions" selected={scopeQuestion} onSelect={setScopeQuestion} questions={[
        { id: 'intent', label: 'Describe the scope', question: 'Let’s agree what this test should cover.', content: <>
          {activeStep === 'scope' && scopeQuestion === 'intent' ? <PreparationAssistant step="scope" /> : null}
          {draft.scope ? <div className="ls-guide-facts"><p><strong>Saved scope</strong></p><p>{draft.scope}</p></div> : null}
          <Button type="button" onClick={() => setScopeQuestion('period')}>{draft.scope ? 'Keep this scope and choose dates' : 'Enter dates and write the scope myself'}</Button>
        </> },
        { id: 'period', label: 'Choose dates', question: 'What period should the test cover?', content: periodEditor },
        { id: 'confirm', label: 'Check scope', question: 'Does this saved scope match your assignment?', content: <div className="ls-guide-facts">
          <p>{draft.scope || 'No scope statement has been saved.'}</p><p>{draft.period ? `${draft.period.from} to ${draft.period.to}, inclusive (UTC).` : 'No dates have been saved.'}</p>
          <p>Confirm your review below when the scope and dates are right.</p>
        </div> },
      ]} />,
      evidence: <GuidedQuestions label="Evidence questions" selected={evidenceQuestion} onSelect={setEvidenceQuestion} questions={[
        { id: 'source', label: 'Choose records', question: 'Where is the list of records we should test?', content: <>
          <p>Choose a source already set up for this institution. It supplies the population; we’ll choose the systems and proof next.</p>{populationEditor}
          {draft.sourceSnapshot ? <Button type="button" onClick={() => setEvidenceQuestion('systems')}>Keep this source and choose systems</Button> : null}
        </> },
        { id: 'systems', label: 'Choose systems', question: 'Which registered systems should I inspect?', content: <>
          {targetSystemsEditor}{draft.targets.length > 0 ? <Button type="button" onClick={() => setEvidenceQuestion('capture')}>Keep these systems and choose evidence</Button> : null}
        </> },
        { id: 'capture', label: 'Choose proof', question: 'Which values and supporting proof should we retain?', content: <>
          <p>Use the values exposed by the selected systems. Reports, files, logs and settings are useful evidence only when a registered source or system makes them available.</p>{evidenceRequirementsEditor}
        </> },
        { id: 'confirm', label: 'Check choices', question: 'Are these the right evidence sources for the test?', content: <div className="ls-guide-facts">
          <dl><div><dt>Records</dt><dd>{draft.sourceSnapshot?.displayName || 'Not selected'}</dd></div>
            <div><dt>Systems</dt><dd>{draft.targets.map(target => target.displayName).join(', ') || 'Not selected'}</dd></div>
            <div><dt>Values to retain</dt><dd>{draft.evidenceRequirements.map(requirement => requirement.attributeName).join(', ') || 'Not selected'}</dd></div></dl>
          <p>Confirm your review below, then we’ll prepare the test steps together.</p>
        </div> },
      ]} />,
      instructions: auditInstructionsEditor,
      assessment: complianceRuleEditor,
      frequency: <>{scheduleEditor}<p className="ls-caption">Frequency is saved with the procedure. Automatic scheduled execution is separate work. Unresolved observations remain unresolved; only approved, active versions can run.</p></>,
    }} review={<>
      <dl className="ls-stack" aria-label="Saved procedure context">
        {Object.entries({ Risk: draftContext(draft.sections).risk, Control: draftContext(draft.sections).control, Objective: draftContext(draft.sections).objective, 'Criterion reference': draftContext(draft.sections).criterionReference, 'Scope note': draft.scope }).map(([label, content]) => <div key={label}><dt>{label}</dt><dd className="ls-whitespace">{content || 'Not supplied'}</dd></div>)}
      </dl>
    <ReadinessPanel inputs={{ templateId: draft.templateId, targets: draft.targets, sourceSnapshot: draft.sourceSnapshot, complianceConditions: draft.complianceConditions, evidenceRequirements: draft.evidenceRequirements }} headingId={`${id}-readiness`} />
    {/* Review comes after preparation. Show the compiler's actual work before the
        auditor submits; an assistant's proposed prose is not a second plan. */}
    <div className="ls-card">
      <details className="ls-disclosure" data-plan-detail open>
        <summary>Show the full plan this will run</summary>
        <div className="ls-disclosure__body">
          <AgentSummary draft={draft} headingId={`${id}-agent-summary`} readiness={false} />
          <ExecutablePlanPreview draft={draft} />
        </div>
      </details>
    </div>
    <VersionActions procedureId={draft.procedureId} versionId={draft.versionId} rowVersion={token} beforeConfirm={submissionGuard.check} actions={[{ decision: 'submit', label: 'Submit for approval', reason: submissionGuard.reason ?? submissionUnavailableReason(draft) }]} />
    {draft.state === 'DRAFT' && draft.planStatus === 'failed' ? <RetryPlanDerivation draft={draft} rowVersion={token} onRetry={async (fields) => { const outcome = await onRetryPlan(fields); if (outcome.ok) setToken(outcome.rowVersion); return outcome; }} /> : null}

    </>} />
  </div></WritingAssistantProvider>;
}

export function DraftBuilder(props: Parameters<typeof DraftBuilderContent>[0]): React.JSX.Element { return <BuilderSubmissionProvider><DraftBuilderContent {...props} /></BuilderSubmissionProvider>; }
