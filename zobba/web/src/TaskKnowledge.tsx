import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Task } from './conversation';
import { readTask } from './conversation';
import type { Scope } from './engagements';
import { discardKnowledgeOwner, knowledgeAudience, knowledgeCustodyFailure, omissionLabels, parseKnowledgePeriod, readKnowledge, readKnowledgeExact, readKnowledgeSourceStatus, recoverKnowledge, retainKnowledge, sourceScope } from './knowledge';
import type { Assertion, Dependency, KnowledgeAction, KnowledgeDraft, KnowledgePage, KnowledgeView, Layout, RecordReference } from './knowledge';
import type { MethodContext, SkillContext } from './knowledge-context';
import { KnowledgeSource } from './KnowledgeSource';
import { KnowledgeSupport } from './KnowledgeSupport';
import { useSkillInspection } from './useSkillInspection';
import { useKnowledgeCommands } from './useKnowledgeCommands';

interface Props { scope: Scope; task: Task; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; method: MethodContext | null; skills: SkillContext | null; onGuide: () => void; onApplyLayout: (layout: Layout) => void }
const certaintyLabels = { user_directed: 'Attributed human direction', source_states: 'The registered source states this text', asserted: 'Actor assertion; interpretation is not verified', learned: 'Learned harmless display preference', explicit_preference: 'Explicit harmless display preference' };
const newDraft = (mode: KnowledgeDraft['mode'], revision: string, view?: KnowledgeView): KnowledgeDraft => ({ mode, target: view ? { id: view.record.id, revision: view.record.revision } : null, text: mode === 'correct' ? view?.record.text ?? '' : '', reason: '', uncertainty: mode === 'correct' ? view?.record.uncertainty ?? '' : '', start: mode === 'correct' ? view?.record.period.start ?? '' : '', end: mode === 'correct' ? view?.record.period.end ?? '' : '', destination_engagement_id: '', destination_task_id: '', expected_revision: revision, dependencies: mode === 'correct' ? view?.record.dependencies ?? [] : [], predecessor_id: view?.record.source?.evidence_id ?? '', replacement_id: '', expected_source_revision: null });

function GuideSource({ dependency, session, accessReady, onAccessFailure, onSourceAccessFailure }: { dependency: Extract<Dependency, { kind: 'guide' }>; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onSourceAccessFailure: (error: AccessError) => void }) {
  const [open, setOpen] = useState(false), scope = sourceScope(dependency.scope);
  const owner = JSON.stringify([session.identity.id, session.csrf_token, dependency]);
  const read = useCallback(async (signal: AbortSignal) => { if (!scope) throw new Error('Source scope unavailable'); return readTask(scope, dependency.task_id, signal, session); }, [owner]);
  const denied = useCallback((reason?: AccessError) => { if (reason && [401, 412].includes(reason.status)) onAccessFailure(reason); else if (reason && [403, 404].includes(reason.status)) onSourceAccessFailure(reason); }, [onAccessFailure, onSourceAccessFailure]);
  const inspection = useSkillInspection(owner, accessReady && open, '', read, denied);
  return <section ref={inspection.panel} className="knowledge-source"><button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close source Task' : 'Inspect source Task'}</button>
    {open && !inspection.verified ? <p role="status">{inspection.error ? 'Current access to this source Task is unavailable.' : 'Checking source Task access…'}</p> : null}
    <div hidden={!open || !inspection.verified}>{inspection.value ? <><h5>{inspection.value.objective}</h5><p>Source Task {dependency.task_id} · original cycle {dependency.cycle_id} · Guide {dependency.command_id}.</p><p>Current Task state: {inspection.value.state}. The retained decision above refers to its original Guide, not this Task’s entire current brief.</p></> : null}</div>
    {open ? <button type="button" className="text-button" disabled={!accessReady || inspection.loading} onClick={() => void inspection.refresh()}>Recheck source Task access</button> : null}
  </section>;
}

function KnowledgeCard({ view, session, accessReady, onAccessFailure, onSourceAccessFailure, edit, onGuide, taskScope, onApplyLayout }: { view: KnowledgeView; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onSourceAccessFailure: (error: AccessError) => void; edit?: (mode: KnowledgeDraft['mode'], view: KnowledgeView) => void; onGuide?: () => void; taskScope?: Scope; onApplyLayout?: (layout: Layout) => void }) {
  const r = view.record;
  return <article className="knowledge-record" aria-label={`Knowledge ${r.id}`}>
    <div className="knowledge-record-heading"><h5>{r.kind.replaceAll('_', ' ')}</h5><span className="status-label">{view.status}</span></div>
    <p className="scope-note">{certaintyLabels[r.certainty]}</p><p className="retained-text">{r.text}</p>
    {view.status_reason ? <p>{view.status_reason}</p> : null}
    {r.uncertainty ? <p>Uncertainty: {r.uncertainty}</p> : null}
    <p className="scope-note">{r.scope.kind === 'personal' ? 'Owner-private' : r.scope.kind} scope · by {r.actor_id} · {r.period.start ? `${r.period.start} to ${r.period.end}` : 'Business period unknown'}</p>
    {r.direction ? <p className="notice">Original direction for Task {r.direction.task_id}, cycle {r.direction.cycle_id}: {r.direction.standing}. Retrieval here does not turn it into current direction for this Task.</p> : null}
    {r.preference ? <p>Optional presentation setting: {r.preference.name} = {r.preference.value}. This changes no method, evidence status or authority.</p> : null}
    {r.kind === 'published_preference' && r.preference && view.status === 'current' && onApplyLayout ? <button type="button" className="text-button apply-released-layout" onClick={() => onApplyLayout(r.preference!.value)}>Apply released layout to this opening</button> : null}
    <details><summary>Inspect knowledge basis</summary><dl>
      <div><dt>Exact record</dt><dd>{r.id} · revision {r.revision}</dd></div><div><dt>Author and time</dt><dd>{r.actor_id} · {new Date(r.recorded_at * 1000).toLocaleString()}</dd></div>
      <div><dt>Original scope</dt><dd>{r.scope.organisation_id} / {r.scope.client_id ?? 'No client'} / {r.scope.engagement_id ?? 'No engagement'}{r.scope.owner_id ? ` · owner ${r.scope.owner_id}` : ''}</dd></div>
      {r.source ? <><div><dt>Registered original</dt><dd>{r.source.evidence_id}</dd></div><div><dt>Exact storage version</dt><dd>{r.source.storage_version}</dd></div><div><dt>Original SHA-256</dt><dd>{r.source.digest}</dd></div><div><dt>Source location and coverage</dt><dd>{r.source.field_path ? `Asserted field ${r.source.field_path}` : `Original bytes [${r.source.byte_start}, ${r.source.byte_end}) of ${r.source.original_size}`}{r.source.partial ? ' · Partial source coverage' : ''}</dd></div></> : null}
      {r.supersedes ? <div><dt>Corrects original record</dt><dd>{r.supersedes.id} · revision {r.supersedes.revision}; original history retained</dd></div> : null}
    </dl>
      {r.dependencies.length ? <ul aria-label="Exact knowledge dependencies">{r.dependencies.map((dependency, index) => <li key={index}>{dependency.kind === 'evidence' ? <>Evidence {dependency.evidence_id} · version {dependency.storage_version} · SHA-256 {dependency.digest}{sourceScope(dependency.scope) ? <KnowledgeSource scope={sourceScope(dependency.scope)!} evidenceId={dependency.evidence_id} version={dependency.storage_version} sha256={dependency.digest} session={session} accessReady={accessReady} onAccessFailure={onAccessFailure} onSourceAccessFailure={onSourceAccessFailure} /> : null}</> : dependency.kind === 'guide' ? <>Guide {dependency.command_id} · Task {dependency.task_id} · cycle {dependency.cycle_id}<GuideSource dependency={dependency} session={session} accessReady={accessReady} onAccessFailure={onAccessFailure} onSourceAccessFailure={onSourceAccessFailure} /></> : dependency.kind === 'knowledge' ? <>Knowledge {dependency.id} · exact revision {dependency.revision}</> : dependency.kind === 'methodology' ? <>Saved methodology source {dependency.version_id}; inspect the methodology owner below</> : <>Skill selection {dependency.selection_id} · Task {dependency.task_id}; inspect current technique eligibility below</>}</li>)}</ul> : <p>No disclosed source dependencies. A released presentation value does not disclose its owner’s private events.</p>}
    </details>
    {edit ? <div className="knowledge-actions">
      {view.can_correct ? <button type="button" className="text-button" onClick={() => edit('correct', view)}>Correct assertion</button> : null}
      {view.can_exclude ? <button type="button" className="text-button" onClick={() => edit('exclude', view)}>Exclude from future context</button> : null}
      {view.can_forget ? <button type="button" className="text-button" onClick={() => edit('forget', view)}>Forget working context</button> : null}
      {view.can_reuse ? <button type="button" className="text-button" onClick={() => edit('reuse', view)}>Reuse in named Task</button> : null}
      {r.source && r.scope.engagement_id === taskScope?.engagement_id && r.scope.client_id === taskScope?.client_id ? <button type="button" className="text-button" onClick={() => edit('correct_source', view)}>Declare original source correction</button> : null}
      {r.direction && onGuide ? <button type="button" className="text-button" onClick={onGuide}>Change live direction with Guide</button> : null}
    </div> : null}
  </article>;
}

function ExactKnowledge({ scope, task, session, accessReady, onAccessFailure, onSourceAccessFailure, basis }: Pick<Props, 'scope' | 'task' | 'session' | 'accessReady' | 'onAccessFailure'> & { basis: Pick<KnowledgePage, 'execution_epoch' | 'methodology_binding_id'>; onSourceAccessFailure: (error: AccessError) => void }) {
  const [recordId, setRecordId] = useState(''), [revision, setRevision] = useState(''), [target, setTarget] = useState<RecordReference | null>(null);
  const owner = `${knowledgeAudience(session, scope.organisation_id, scope, task.id)}/exact/${target?.id ?? ''}/${target?.revision ?? ''}`;
  const read = useCallback(async (signal: AbortSignal) => { if (!target) throw new Error('Choose an exact record'); return readKnowledgeExact(scope, task.id, target, session, signal, basis); }, [owner, basis.execution_epoch, basis.methodology_binding_id]);
  const denied = useCallback((reason?: AccessError) => { if (reason && [401, 412].includes(reason.status)) onAccessFailure(reason); else if (reason && [403, 404].includes(reason.status)) onSourceAccessFailure(reason); }, [onAccessFailure, onSourceAccessFailure]);
  const inspection = useSkillInspection(owner, accessReady && !!target, task.revision, read, denied);
  return <section ref={inspection.panel} className="knowledge-exact"><details><summary>Inspect an exact record beyond this page</summary><form onSubmit={event => { event.preventDefault(); if (target?.id === recordId && target.revision === revision) void inspection.refresh(); else setTarget({ id: recordId, revision }); }}>
    <label>Exact knowledge record ID<input required pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={recordId} onChange={event => setRecordId(event.target.value)} /></label><label>Exact knowledge revision<input required pattern="0|[1-9][0-9]{0,18}" value={revision} onChange={event => setRevision(event.target.value)} /></label><button type="submit" className="quiet-button" disabled={!accessReady || inspection.loading}>Inspect exact knowledge</button></form>
    {target && !inspection.verified ? <p role="status">{inspection.error ? 'This exact record is currently unavailable or inaccessible. That does not establish its absence.' : 'Checking exact record access…'}</p> : null}
    <div hidden={!inspection.verified}>{inspection.value ? <KnowledgeCard view={inspection.value} session={session} accessReady={inspection.verified} onAccessFailure={onAccessFailure} onSourceAccessFailure={onSourceAccessFailure} /> : null}</div>
  </details></section>;
}

export function TaskKnowledge({ scope, task, session, accessReady, onAccessFailure, method, skills, onGuide, onApplyLayout }: Props) {
  const owner = knowledgeAudience(session, scope.organisation_id, scope, task.id);
  const [draft, updateDraft] = useState<KnowledgeDraft | null>(() => recoverKnowledge(owner, session).draft);
  // Custody and this ref advance together before rendering. An asynchronous
  // source read must merge its one field with the latest edits, and cannot act
  // on a cancelled/reopened draft even when its source ID is the same.
  const draftLifetime = useRef({ owner, activation: 0, value: draft });
  const [sourceLookup, setSourceLookup] = useState(draft?.mode === 'correct_source' ? draft.predecessor_id : '');
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const fragment = useRef({ owner, generation: sourceGeneration }); fragment.current = { owner, generation: sourceGeneration };
  const [query, setQuery] = useState(''), [submittedQuery, setSubmittedQuery] = useState(''), [inactive, setInactive] = useState(false), [after, setAfter] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const denied = useCallback((reason?: AccessError) => { discardKnowledgeOwner(owner); draftLifetime.current = { owner, activation: draftLifetime.current.activation + 1, value: null }; updateDraft(null); setNotice(''); onAccessFailure(reason); }, [owner, onAccessFailure]);
  const read = useCallback(async (signal: AbortSignal) => ({ ...await readKnowledge(scope, task.id, session, signal, after, submittedQuery, inactive), checked_at: Date.now() }), [owner, after, submittedQuery, inactive]);
  const inspection = useSkillInspection(`${owner}/${after ?? ''}/${submittedQuery}/${inactive}/${sourceGeneration}`, accessReady, task.revision, read, denied);
  const page = inspection.value;
  const matchesTask = page?.task_id === task.id && page.execution_epoch === task.execution_epoch;
  const matchesMethod = method?.task_id === task.id && method.binding_id === page?.methodology_binding_id;
  const visible = inspection.verified && matchesTask && matchesMethod;
  const matchesSkills = visible && skills?.task_id === task.id && skills.methodology_binding_id === page?.methodology_binding_id && skills.execution_epoch === page?.execution_epoch;
  const mutation = useKnowledgeCommands(owner, scope, session, visible, denied, receipt => {
    setDraft(null);
    setNotice('event_id' in receipt ? `Recorded change ${receipt.event_id}. Original history is retained; current eligibility is checked again.` : 'Recorded.');
  }, inspection.refresh);
  function setDraft(value: KnowledgeDraft | null) {
    if (draftLifetime.current.owner !== owner) return false;
    if (!retainKnowledge(owner, session, scope, { draft: value })) { mutation.setError(knowledgeCustodyFailure); return false; }
    const current = draftLifetime.current;
    draftLifetime.current = { owner, activation: current.activation + (Boolean(current.value) !== Boolean(value) ? 1 : 0), value };
    updateDraft(value); return true;
  }
  function patchDraft(patch: Partial<KnowledgeDraft>) { const current = draftLifetime.current; if (current.owner === owner && current.value) setDraft({ ...current.value, ...patch }); }
  const sourceDenied = useCallback((reason?: AccessError) => {
    if (!reason) return;
    if (fragment.current.owner !== owner || fragment.current.generation !== sourceGeneration) return;
    if ([401, 412].includes(reason.status)) { denied(reason); return; }
    if (![403, 404].includes(reason.status)) return;
    // A supporting origin can disappear while this destination stays valid.
    // Withdraw the whole old projection, exact inspector and dependent editor;
    // uncertain requests remain bound to this owner for later receipt recovery.
    fragment.current = { owner, generation: sourceGeneration + 1 };
    setDraft(null); setNotice(''); setSourceGeneration(sourceGeneration + 1);
  }, [owner, sourceGeneration, denied]);
  function addDependency(dependency: Dependency) {
    const current = draftLifetime.current;
    if (current.owner !== owner || !current.value || current.value.dependencies.length >= 32 || current.value.dependencies.some(value => JSON.stringify(value) === JSON.stringify(dependency))) return;
    patchDraft({ dependencies: [...current.value.dependencies, dependency] });
  }
  function removeDependency(index: number) { const current = draftLifetime.current; if (current.owner === owner && current.value) patchDraft({ dependencies: current.value.dependencies.filter((_, position) => position !== index) }); }
  const sourceActivation = draftLifetime.current.activation, sourcePredecessor = draft?.predecessor_id ?? '';
  const sourceRead = useCallback((signal: AbortSignal) => readKnowledgeSourceStatus(scope, draft?.predecessor_id ?? '', session, signal), [owner, draft?.predecessor_id]);
  const correctionDenied = useCallback((reason?: AccessError) => { if (reason && [401, 412].includes(reason.status)) denied(reason); }, [denied]);
  const sourceInspection = useSkillInspection(`${owner}/correction/${sourceActivation}/${sourcePredecessor}`, visible && draft?.mode === 'correct_source' && sourceLookup === sourcePredecessor && /^[A-Za-z0-9_-]{1,128}$/.test(sourcePredecessor), '', sourceRead, correctionDenied);
  useEffect(() => {
    const current = draftLifetime.current, value = sourceInspection.value;
    if (sourceInspection.verified && value?.evidence_id === sourcePredecessor && current.owner === owner && current.activation === sourceActivation && current.value?.mode === 'correct_source' && current.value.predecessor_id === sourcePredecessor && current.value.expected_source_revision === null) {
      setDraft({ ...current.value, expected_source_revision: value.source_revision });
    }
  }, [owner, sourceActivation, sourcePredecessor, sourceInspection.verified, sourceInspection.value]);
  function edit(mode: KnowledgeDraft['mode'], view?: KnowledgeView) { if (!page || mutation.pending || draft) return; if (setDraft(newDraft(mode, page.revision, view))) setSourceLookup(view?.record.source?.evidence_id ?? ''); setNotice(''); }
  function submitDraft() {
    if (!draft || !page || draft.expected_revision !== page.revision) return;
    let period;
    try { period = parseKnowledgePeriod({ start: draft.start || null, end: draft.end || null }); } catch { mutation.setError('Enter both valid business period dates in order, or leave both unknown.'); return; }
    const assertion: Assertion = { text: draft.text, period, uncertainty: draft.uncertainty || null, dependencies: draft.dependencies };
    let action: KnowledgeAction;
    if (draft.mode === 'assert') action = { kind: 'assert', assertion };
    else if (draft.mode === 'correct' && draft.target) action = { kind: 'correct', target: draft.target, assertion, reason: draft.reason };
    else if ((draft.mode === 'exclude' || draft.mode === 'forget') && draft.target) action = { kind: draft.mode, target: draft.target, reason: draft.reason };
    else if (draft.mode === 'reuse' && draft.target) action = { kind: 'reuse', target: draft.target, destination_engagement_id: draft.destination_engagement_id, destination_task_id: draft.destination_task_id, reason: draft.reason };
    else if (draft.mode === 'correct_source' && sourceInspection.verified && draft.expected_source_revision !== null && draft.expected_source_revision === sourceInspection.value?.source_revision) action = { kind: 'correct_source', predecessor_id: draft.predecessor_id, replacement_id: draft.replacement_id, expected_source_revision: draft.expected_source_revision, reason: draft.reason };
    else return;
    void mutation.apply({ kind: 'knowledge', scope, task_id: task.id, body: { key: crypto.randomUUID(), expected_revision: draft.expected_revision, action } });
  }
  return <section ref={inspection.panel} className="brief-section task-knowledge" aria-label="Scoped working knowledge"><h4>Scoped working knowledge</h4>
    <p>Inspectable preparation for this Task. These independent current observations do not claim a model or skill consumed this context.</p>
    {!visible ? <p role="status">{inspection.error ? 'Current working knowledge is unavailable. Refresh to check its basis.' : inspection.verified && !matchesTask ? 'The Task changed while context was read. Refresh knowledge to inspect its current epoch.' : inspection.verified && !matchesMethod ? 'Waiting for a matching current methodology basis. Knowledge is withheld while its basis differs.' : 'Checking current knowledge and source access…'}</p> : null}
    <button type="button" className="text-button" disabled={!accessReady || inspection.loading || mutation.working} onClick={() => void inspection.refresh()}>Refresh working knowledge</button>
    <div hidden={!visible}>
      {page ? <details className="knowledge-manifest"><summary>Current context manifest</summary><dl><div><dt>Task consumer</dt><dd>{task.accountable_actor} · Task {task.id} · execution epoch {page.execution_epoch}</dd></div><div><dt>Human viewer</dt><dd>{session.identity.id} · separately authorized</dd></div><div><dt>Methodology binding</dt><dd>{page.methodology_binding_id} · {method?.status}</dd></div><div><dt>Exact method content sources</dt><dd>{method?.source_version_ids.join(', ') || 'No configured source'}</dd></div><div><dt>Knowledge revision observed</dt><dd>{page.revision}</dd></div><div><dt>Technique observation</dt><dd>{matchesSkills ? new Date(skills!.observed_at * 1000).toLocaleString() : 'Unavailable or basis changed; inspect the separate skills panel'}</dd></div></dl>
        <p>Browser completed the methodology read at {method ? new Date(method.checked_at).toLocaleTimeString() : 'unavailable'} and knowledge verification at {new Date(page.checked_at).toLocaleTimeString()}. These are separate observations, not a shared execution snapshot.</p>
        {matchesSkills ? <ul>{skills!.selections.map(selection => <li key={selection.id}>Selection {selection.id} · installed version {selection.version_id} · {selection.status}<br />SHA-256 {selection.digest}</li>)}</ul> : null}
        {matchesSkills && !skills!.selections.length ? <p>No recorded technique selections at this observation.</p> : null}<p>Each source is checked independently. A saved receipt or this manifest is not a grant for later use.</p>
      </details> : null}
      <form className="knowledge-search" onSubmit={event => { event.preventDefault(); setAfter(null); if (submittedQuery === query && after === null) void inspection.refresh(); else setSubmittedQuery(query); }}><label>Find working knowledge<input maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label><button type="submit" className="quiet-button" disabled={inspection.loading}>Search knowledge</button><label><input type="checkbox" checked={inactive} onChange={event => { setAfter(null); setInactive(event.target.checked); }} />Inspect retained inactive history</label></form>
      {page?.omissions.length ? <aside className="notice" aria-label="Knowledge coverage limitations"><h5>Coverage and omissions</h5><ul>{page.omissions.map(reason => <li key={reason}>{omissionLabels[reason]}</li>)}</ul></aside> : null}
      {!page?.items.length ? <p>No eligible knowledge on this page. This does not establish that no relevant facts or sources exist.</p> : null}
      {page?.items.map(view => <KnowledgeCard key={`${view.record.id}/${view.record.revision}`} view={view} session={session} accessReady={visible} onAccessFailure={onAccessFailure} onSourceAccessFailure={sourceDenied} edit={draft || mutation.pending ? undefined : edit} onGuide={onGuide} taskScope={scope} onApplyLayout={onApplyLayout} />)}
      <div className="knowledge-actions">{after ? <button type="button" className="text-button" onClick={() => setAfter(null)}>First knowledge page</button> : null}{page?.next_after ? <button type="button" className="text-button" onClick={() => setAfter(page.next_after)}>More knowledge</button> : null}<button type="button" className="quiet-button" disabled={!!draft || !!mutation.pending || mutation.working} onClick={() => edit('assert')}>Record an assertion</button><button type="button" className="quiet-button" disabled={!!draft || !!mutation.pending || mutation.working} onClick={() => edit('correct_source')}>Declare an original source correction</button></div>
      {page ? <ExactKnowledge scope={scope} task={task} session={session} accessReady={visible} onAccessFailure={onAccessFailure} onSourceAccessFailure={sourceDenied} basis={page} /> : null}
      {draft ? <form className="knowledge-editor" aria-label="Working knowledge change" onSubmit={event => { event.preventDefault(); submitDraft(); }}><fieldset disabled={mutation.working || !!mutation.pending}><legend>{draft.mode === 'assert' ? 'Record an attributed assertion' : draft.mode === 'correct' ? 'Correct this assertion' : draft.mode === 'reuse' ? 'Reuse exact knowledge in a named Task' : draft.mode === 'forget' ? 'Forget future working context' : draft.mode === 'correct_source' ? 'Declare a correction to an original source' : 'Exclude future working context'}</legend>
        {draft.target ? <p>Exact source record {draft.target.id} · revision {draft.target.revision}</p> : null}
        {draft.mode === 'assert' || draft.mode === 'correct' ? <><label>Assertion text<textarea required rows={4} value={draft.text} onChange={event => patchDraft({ text: event.target.value })} /></label><p>Verbatim author assertion. Linking a source does not verify your interpretation.</p><label>Known uncertainty<input value={draft.uncertainty} onChange={event => patchDraft({ uncertainty: event.target.value })} /></label><label>Knowledge period start<input type="date" value={draft.start} onChange={event => patchDraft({ start: event.target.value })} /></label><label>Knowledge period end<input type="date" value={draft.end} onChange={event => patchDraft({ end: event.target.value })} /></label><p>Blank dates mean unknown applicability.</p>{page ? <KnowledgeSupport key={`${owner}/${sourceActivation}`} owner={`${owner}/draft/${sourceActivation}`} scope={scope} taskId={task.id} session={session} ready={visible && !mutation.working && !mutation.pending} page={page} dependencies={draft.dependencies} onAdd={addDependency} onRemove={removeDependency} onAccessFailure={correctionDenied} /> : null}</> : null}
        {draft.mode === 'reuse' ? <><p>Source client {scope.client_id}. Reuse requires this exact source revision, the named destination Task, and current access for both you and its accountable human. It grants no new access.</p><label>Destination engagement ID<input required pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={draft.destination_engagement_id} onChange={event => patchDraft({ destination_engagement_id: event.target.value })} /></label><label>Destination Task ID<input required pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={draft.destination_task_id} onChange={event => patchDraft({ destination_task_id: event.target.value })} /></label></> : null}
        {draft.mode === 'correct_source' ? <><label>Registered original to correct<input required pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={draft.predecessor_id} onChange={event => { patchDraft({ predecessor_id: event.target.value, expected_source_revision: null }); setSourceLookup(''); }} onBlur={event => setSourceLookup(event.target.value)} /></label><p>Original {draft.predecessor_id || 'not yet selected'}. A replacement must already be registered in this exact engagement. Both originals remain immutable; dependent context is invalidated.</p><label>Replacement registered original ID<input required pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={draft.replacement_id} onChange={event => patchDraft({ replacement_id: event.target.value })} /></label>{sourceInspection.verified ? <p>Source correction revision {sourceInspection.value?.source_revision}{sourceInspection.value?.replacement_id ? ` · current replacement ${sourceInspection.value.replacement_id}` : ' · no declared replacement'}.</p> : <p role="status">{sourceInspection.error ? 'Source status unavailable. Recheck before declaring a correction.' : !sourcePredecessor ? 'Choose a registered original to check its correction status.' : 'Checking current source correction status…'}</p>}<button type="button" className="text-button" onClick={() => { if (sourceLookup !== sourcePredecessor) setSourceLookup(sourcePredecessor); else void sourceInspection.refresh(); }}>Refresh source correction status</button>{sourceInspection.verified && draft.expected_source_revision !== null && draft.expected_source_revision !== sourceInspection.value?.source_revision ? <button type="button" className="text-button" onClick={() => patchDraft({ expected_source_revision: sourceInspection.value!.source_revision })}>Use latest source correction revision</button> : null}</> : null}
        {draft.mode !== 'assert' ? <label>Knowledge change reason<textarea required rows={2} value={draft.reason} onChange={event => patchDraft({ reason: event.target.value })} /></label> : null}
        {draft.mode === 'forget' || draft.mode === 'exclude' ? <p>The record is removed from future context. Original source, accepted direction and audit events are retained. Change live direction using Guide.</p> : null}
        {draft.expected_revision !== page?.revision ? <p className="notice">The current knowledge revision changed. Inspect it, then <button type="button" className="text-button" onClick={() => { if (page) patchDraft({ expected_revision: page.revision }); }}>Use latest knowledge revision</button></p> : null}
        <div className="knowledge-actions"><button type="submit" disabled={draft.expected_revision !== page?.revision || draft.mode === 'correct_source' && (!sourceInspection.verified || draft.expected_source_revision !== sourceInspection.value?.source_revision)}>Record knowledge change</button><button type="button" className="quiet-button" onClick={() => { setDraft(null); mutation.setError(''); }}>Cancel knowledge change</button></div>
      </fieldset></form> : null}
      {mutation.pending ? <aside className="notice"><p>Knowledge delivery is unconfirmed. Its exact request and original expected basis remain in memory.</p><button type="button" disabled={mutation.working} onClick={() => void mutation.apply(mutation.pending!)}>Retry exact knowledge request</button></aside> : null}
      {mutation.error ? <p role="alert">{mutation.error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    </div>
  </section>;
}
