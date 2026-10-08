import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { discardSkillActions, discardSkillPending, freezeSkillAction, readTaskSkills, recoverSkillAction, recoverSkillDraft, retainSkillAction, retainSkillDraft, selectSkill, skillAudience, skillFailure, skillRefused, skillCustodyFailure, skillProseError, readSkillImpacts } from './skills';
import type { SelectionAction, SelectSkill, SkillSelectionView, TaskSkills as Discovery, SkillSelectionImpactPage } from './skills';
import { SkillDetails, SkillEligibility } from './SkillDetails';
import { useSkillInspection } from './useSkillInspection';
import type { SkillContext } from './knowledge-context';

interface Props { scope: Scope; taskId: string; taskRevision: string; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onContext?: (context: SkillContext | null) => void }
const basisChanged = (draft: SelectSkill, value: Discovery) => draft.expected_catalog_revision !== value.catalog_revision || draft.expected_methodology_binding_id !== value.methodology_binding_id || draft.expected_execution_epoch !== value.execution_epoch || draft.expected_selection_revision !== value.selection_revision;
const freshBasis = (draft: SelectSkill, value: Discovery): SelectSkill => ({ ...draft, key: crypto.randomUUID(), expected_catalog_revision: value.catalog_revision, expected_methodology_binding_id: value.methodology_binding_id, expected_execution_epoch: value.execution_epoch, expected_selection_revision: value.selection_revision });

export function TaskSkills({ scope, taskId, taskRevision, session, accessReady, onAccessFailure, onContext }: Props) {
  const owner = skillAudience(session, scope.organisation_id, scope, taskId);
  const [draft, updateDraft] = useState<SelectSkill | null>(() => { const saved = recoverSkillDraft(owner, session); return saved?.kind === 'selection-draft' ? saved.body : null; });
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonId = useId();
  function setDraft(value: SelectSkill | null) { if (!retainSkillDraft(owner, session, value ? { kind: 'selection-draft', scope, task_id: taskId, body: value } : null)) { setError(skillCustodyFailure); return false; } updateDraft(value); return true; }

  const [pending, setPending] = useState<SelectionAction | null>(() => { const value = recoverSkillAction(owner, session); return value?.kind === 'select' ? value : null; });
  const [receipt, setReceipt] = useState<SkillSelectionView | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const action = useRef<AbortController | null>(null);
  const latest = useRef({ owner, accessReady }); latest.current = { owner, accessReady };
  const mounted = useRef(true);
  const withdrawPrivate = useCallback((reason?: AccessError) => { discardSkillActions(owner); updateDraft(null); setPending(null); setReceipt(null); onAccessFailure(reason); }, [owner, onAccessFailure]);
  const read = useCallback((signal: AbortSignal) => readTaskSkills(scope, taskId, session, signal), [scope.organisation_id, scope.client_id, scope.engagement_id, taskId, session.identity.id, session.csrf_token]);
  const inspection = useSkillInspection(owner, accessReady, taskRevision, read, withdrawPrivate);
  const value = inspection.value, visible = inspection.verified;
  useEffect(() => { onContext?.(visible && value ? { task_id: taskId, methodology_binding_id: value.methodology_binding_id, execution_epoch: value.execution_epoch, observed_at: value.observed_at,
    selections: value.selections.map(({ selection, current }) => ({ id: selection.id, version_id: selection.version_id, digest: selection.digest, status: current.status })) } : null); }, [visible, value, taskId, onContext]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; action.current?.abort(); }; }, []);
  async function apply(command: SelectionAction) {
    if (!visible || action.current) return;
    if (!retainSkillAction(owner, session, command)) { setError(skillCustodyFailure); return; }
    const expectedOwner = owner, recovering = pending !== null, controller = new AbortController(); action.current = controller;
    inspection.cancel(); setPending(command); setWorking(true); setError(''); setReceipt(null);
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const confirmed = await selectSkill(command, session, controller.signal);
      if (!mounted.current || latest.current.owner !== expectedOwner) return;
      discardSkillActions(owner); setPending(null); updateDraft(null); setReceipt(confirmed);
    } catch (reason) {
      if (!mounted.current || latest.current.owner !== expectedOwner) return;
      if (skillRefused(reason, recovering)) { discardSkillPending(owner); setPending(null); }
      setError(skillFailure(reason, recovering));
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) withdrawPrivate(reason);
    } finally { clearTimeout(deadline); if (action.current === controller) { action.current = null; if (mounted.current) { setWorking(false); void inspection.refresh(); } } }
  }
  const chosen = draft && value?.candidates.find(candidate => candidate.version.id === draft.version_id);
  return <section ref={inspection.panel} className="brief-section task-skills" aria-label="Task skills"><h3>Task skills</h3>
    {!visible ? <p role="status">{inspection.error || 'Checking applicable techniques and current authority…'}</p> : null}
    <button type="button" className="text-button" disabled={!accessReady || inspection.loading || working} onClick={() => void inspection.refresh()}>Refresh task skills</button>
    <div hidden={!visible}>
      <p>Choose an optional technique for this exact Task methodology. Required methodology remains in force. Selecting a skill does not start work or change Pause or Stop.</p>
      {error ? <p className="notice" role="alert">{error}</p> : null}
      {receipt ? <section className="notice" role="status"><strong>Technique selection recorded; no execution performed.</strong><p>{receipt.selection.skill_id}@{receipt.selection.skill_version} · selected by {receipt.selection.selector_id} · selection {receipt.selection.id}.</p><p>{receipt.current.status === 'eligible' ? 'Current eligibility is shown separately below.' : `Current new use is blocked: ${receipt.current.reason}`}</p></section> : null}
      {pending ? <section className="notice" aria-label="Unconfirmed skill selection"><h4>{working ? 'Recording technique choice…' : 'Selection delivery unconfirmed'}</h4><p>The exact command and basis are retained. Retry returns the original selection alongside its current eligibility.</p><button type="button" disabled={working} onClick={() => void apply(pending)}>Retry exact skill selection</button></section> : null}
      {draft && value ? <form className="methodology-editor" aria-label="Select skill technique" onSubmit={event => { event.preventDefault(); const problem = skillProseError(draft.reason); setReasonError(problem); if (!problem) void apply(freezeSkillAction({ kind: 'select', scope, task_id: taskId, body: draft })); }}><fieldset disabled={working || !!pending}><legend>Choose {chosen?.version.command.manifest.name ?? draft.version_id}</legend>
        {basisChanged(draft, value) ? <section className="notice"><p>The current method, catalog or selection revision changed. Inspect current eligibility before refreshing this retained choice.</p><button type="button" className="quiet-button" onClick={() => setDraft(freshBasis(draft, value))}>Use latest selection basis</button></section> : null}
        {chosen ? <SkillEligibility inspection={chosen.inspection} /> : <p>This exact installed version is no longer available in the current scoped catalog.</p>}
        <label>Selection reason<input required aria-invalid={!!reasonError} aria-describedby={reasonId} value={draft.reason} onChange={event => { setDraft({ ...draft, reason: event.target.value }); if (reasonError) setReasonError(skillProseError(event.target.value)); }} /></label><p id={reasonId} className={reasonError ? 'notice' : 'scope-note'}>{reasonError ?? 'Use up to 2000 Unicode characters, on one line without surrounding whitespace.'}</p><div className="methodology-actions"><button type="submit" disabled={!chosen || chosen.inspection.status !== 'eligible' || basisChanged(draft, value)}>Record skill selection</button><button type="button" className="quiet-button" onClick={() => { setDraft(null); setReasonError(null); setError(''); }}>Cancel skill selection</button></div>
      </fieldset></form> : null}
      <section aria-label="Applicable skill catalog"><h4>Installed techniques in this scope</h4>{value?.candidates.length === 0 ? <p>No installed techniques are available in this scope. This does not change the Task’s methodology requirements.</p> : null}
        {value?.candidates.map(candidate => <article className="skill-candidate" key={candidate.version.id} aria-label={`Skill ${candidate.version.command.manifest.name} ${candidate.version.command.manifest.version}`}><h5>{candidate.version.command.manifest.name} · {candidate.version.command.manifest.version}</h5><SkillDetails version={candidate.version} /><SkillEligibility inspection={candidate.inspection} /><button type="button" className="quiet-button" disabled={working || !!pending || candidate.inspection.status !== 'eligible'} onClick={() => { const retained = setDraft(freshBasis({ key: '', version_id: candidate.version.id, reason: '', expected_catalog_revision: '', expected_methodology_binding_id: '', expected_execution_epoch: '', expected_selection_revision: '' }, value)); if (retained) { setReceipt(null); setReasonError(null); setError(''); } }}>Choose this technique</button></article>)}
      </section>
      <section aria-label="Selected skill history"><h4>Selected skill history</h4>{value?.selections.length === 0 ? <p>No technique selected for this Task.</p> : null}
        {value?.selections.map(view => <details className="skill-selection" key={view.selection.id}><summary>{view.selection.skill_id}@{view.selection.skill_version} · selected, not executed</summary><p className="retained-text">{view.selection.reason}</p><dl><div><dt>Selected by</dt><dd>{view.selection.selector_id} · {new Date(view.selection.selected_at * 1000).toLocaleString()}</dd></div><div><dt>Accepted authority actor at selection</dt><dd>{view.selection.authority_actor_id ?? 'Not required for this pure technique'}</dd></div><div><dt>Original catalog revision</dt><dd>{view.selection.catalog_revision}</dd></div><div><dt>Original Task epoch</dt><dd>{view.selection.execution_epoch}</dd></div><div><dt>Manifest digest</dt><dd className="skill-digest">{view.selection.digest}</dd></div></dl><SkillEligibility inspection={view.current} />
          <details><summary>Exact methodology at selection</summary><p>Binding {view.selection.methodology.id} · effective from epoch {view.selection.methodology.execution_epoch} · {view.selection.methodology.resolution.reason}</p>{view.selection.methodology.resolution.requirements.map(({ requirement, field_sources, source_version_ids }) => <section key={requirement.id}><h5>{requirement.label ?? requirement.id} · {requirement.mandatory ? 'Mandatory' : 'Optional'}</h5><p>Source versions {source_version_ids.join(', ')}</p>{requirement.suitable_skills?.length ? <p>Suitability advice: {requirement.suitable_skills.map(skill => `${skill.id}@${skill.version}`).join(', ')}. This advice does not require invocation.</p> : null}<dl>{field_sources.map(field => <div key={field.field}><dt>{field.field.replaceAll('_', ' ')}</dt><dd>{field.version_ids.join(', ')}</dd></div>)}</dl></section>)}<details><summary>Exact retained requirement and template content</summary><pre tabIndex={0} className="skill-resource">{JSON.stringify(view.selection.methodology.resolution, null, 2)}</pre></details></details>
        </details>)}
      </section>
    </div>
  </section>;
}

/** Audit impact stays inside the selected, freshly authorized engagement. Admin
 * configuration screens never fetch this route or compose its Task references. */
export function AffectedSkillSelections({ scope, session, accessReady, onAccessFailure, onOpenTask }: { scope: Scope; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onOpenTask: (id: string, source?: HTMLElement) => void }) {
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [after, setAfter] = useState<SkillSelectionImpactPage['next_after']>(null);
  const owner = skillAudience(session, scope.organisation_id, scope);
  const read = useCallback((signal: AbortSignal) => readSkillImpacts(scope, version, after, session, signal), [scope.organisation_id, scope.client_id, scope.engagement_id, version, after, session.identity.id, session.csrf_token]);
  const inspection = useSkillInspection<SkillSelectionImpactPage>(`${owner}/impacts/${version ?? ''}/${after?.task_id ?? ''}/${after?.revision ?? ''}`, accessReady, '', read, onAccessFailure);
  return <section ref={inspection.panel} className="brief-section skill-impacts" aria-label="Affected skill selections"><h3>Affected skill selections</h3><p>Disabled and recalled techniques selected in this engagement. Each record retains its exact original Task and methodology references.</p>
    <form onSubmit={event => { event.preventDefault(); setAfter(null); if ((filter || null) === version && after === null) void inspection.refresh(); else setVersion(filter || null); }}><label>Installed skill version filter<input pattern="(?:[A-Za-z0-9_]|-)+" maxLength={128} value={filter} disabled={!accessReady} onChange={event => setFilter(event.target.value)} placeholder="Optional exact catalog version ID" /></label><button type="submit" className="quiet-button" disabled={!accessReady || inspection.loading}>Inspect affected skill selections</button></form>
    {!inspection.verified ? <p role="status">{inspection.error || 'Checking affected selections in this engagement…'}</p> : null}
    <div hidden={!inspection.verified}>
      {inspection.value?.selections.length === 0 ? <p>No matching affected selections in this engagement.</p> : null}
      <ul>{inspection.value?.selections.map(item => <li key={item.selection_id}><strong>{item.skill_id}@{item.skill_version} · {item.status}</strong><p>Task {item.task_id} · selection {item.selection_id} · selected by {item.selector_id} on {new Date(item.selected_at * 1000).toLocaleString()}</p><p>Original method binding {item.methodology_binding_id} · Task epoch {item.execution_epoch} · catalog revision {item.catalog_revision} · current status revision {item.status_revision}</p><details><summary>Exact affected selection reference</summary><p>Installed version {item.version_id} · selection revision {item.selection_revision}</p><p className="skill-digest">Manifest SHA-256 {item.digest}</p></details><button type="button" className="text-button" onClick={event => onOpenTask(item.task_id, event.currentTarget)}>Open affected Task {item.task_id}</button></li>)}</ul>
      {after ? <button type="button" className="text-button" disabled={inspection.loading} onClick={() => setAfter(null)}>First affected selections</button> : null}
      {inspection.value?.next_after ? <button type="button" className="text-button" disabled={inspection.loading} onClick={() => setAfter(inspection.value!.next_after)}>More affected selections</button> : null}
    </div>
  </section>;
}
