import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { inspectEvidence, listEvidence } from './evidence';
import { knowledgeEngagementScope, readKnowledgeExact } from './knowledge';
import type { Dependency, KnowledgePage } from './knowledge';
import { useSkillInspection } from './useSkillInspection';

export function dependencyLabel(dependency: Dependency): string {
  if (dependency.kind === 'evidence') return `Original ${dependency.evidence_id} · version ${dependency.storage_version} · SHA-256 ${dependency.digest}`;
  if (dependency.kind === 'knowledge') return `Knowledge ${dependency.id} · revision ${dependency.revision}`;
  if (dependency.kind === 'guide') return `Guide ${dependency.command_id} · Task ${dependency.task_id} · cycle ${dependency.cycle_id}`;
  if (dependency.kind === 'methodology') return `Methodology version ${dependency.version_id}`;
  return `Skill selection ${dependency.selection_id} · Task ${dependency.task_id}`;
}

/** An assertion cites immutable identities read under current authority. Adding
 * support makes a claimed relationship; it does not verify an interpretation. */
export function KnowledgeSupport({ owner, scope, taskId, session, ready, page, dependencies, onAdd, onRemove, onAccessFailure }: {
  owner: string; scope: Scope; taskId: string; session: Session; ready: boolean; page: KnowledgePage;
  dependencies: Dependency[]; onAdd: (dependency: Dependency) => void; onRemove: (index: number) => void;
  onAccessFailure: (reason?: AccessError) => void;
}) {
  const [kind, setKind] = useState<'evidence' | 'knowledge'>('evidence');
  const [original, setOriginal] = useState(''), [record, setRecord] = useState(''), [revision, setRevision] = useState('');
  const [listOpen, setListOpen] = useState(false), [after, setAfter] = useState<string | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const latest = useRef({ owner, ready, onAdd }); latest.current = { owner, ready, onAdd };
  const read = useCallback((signal: AbortSignal) => listEvidence(scope, session, signal, after ?? undefined), [owner, after]);
  const originals = useSkillInspection(`${owner}/support-originals/${after ?? ''}`, ready && listOpen, '', read, onAccessFailure);
  useEffect(() => () => { const previous = operation.current; operation.current = null; previous?.abort(); }, [owner, ready]);
  async function add() {
    if (!ready || operation.current || dependencies.length >= 32) return;
    const controller = new AbortController(); operation.current = controller; setWorking(true); setError('');
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      let dependency: Dependency;
      if (kind === 'evidence') {
        const value = await inspectEvidence(scope, session, original, controller.signal);
        dependency = { kind, evidence_id: value.reservation.id, storage_version: value.version, digest: value.reservation.request.identity.sha256,
          scope: knowledgeEngagementScope(scope) };
      } else {
        const value = await readKnowledgeExact(scope, taskId, { id: record, revision }, session, controller.signal, page);
        if (value.status !== 'current' || value.record.scope.kind === 'personal' || value.record.preference) throw new Error('Choose current non-personal working knowledge.');
        dependency = { kind, id: value.record.id, revision: value.record.revision, scope: value.record.scope };
      }
      if (operation.current !== controller || latest.current.owner !== owner || !latest.current.ready) return;
      latest.current.onAdd(dependency);
    } catch (reason) {
      if (operation.current !== controller || latest.current.owner !== owner || !latest.current.ready) return;
      setError('This exact support is currently unavailable. Check its identifier, revision and current access.');
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    } finally { clearTimeout(deadline); if (operation.current === controller) { operation.current = null; setWorking(false); } }
  }
  return <section aria-label="Assertion support"><h5>Claimed source support</h5>
    <p>Add, remove or replace the exact sources supporting this assertion. A citation records your claimed relationship; it does not verify the interpretation. At most 32 references.</p>
    {dependencies.length ? <ul aria-label="Draft source references">{dependencies.map((dependency, index) => <li key={`${index}/${dependencyLabel(dependency)}`}><span>{dependencyLabel(dependency)}</span> <button type="button" className="text-button" disabled={!ready || working} onClick={() => onRemove(index)}>Remove source reference {index + 1}</button></li>)}</ul> : <p>No claimed source references.</p>}
    <label>Support type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="evidence">Registered original</option><option value="knowledge">Exact working knowledge</option></select></label>
    {kind === 'evidence' ? <>
      <button type="button" className="text-button" disabled={!ready || originals.loading} onClick={() => { if (listOpen) void originals.refresh(); else setListOpen(true); }}>Load current registered originals</button>
      {listOpen && !originals.verified ? <p role="status">{originals.error ? 'The original list is currently unavailable.' : 'Checking current original access…'}</p> : null}
      <section ref={originals.panel} hidden={!originals.verified}>
        <label>Current registered originals<select value={originals.value?.items.some(item => item.reservation.id === original) ? original : ''} onChange={event => setOriginal(event.target.value)}><option value="">Choose an original</option>{originals.value?.items.map(item => <option key={item.reservation.id} value={item.reservation.id}>{item.reservation.request.filename} · {item.reservation.id}</option>)}</select></label>
        {after ? <button type="button" className="text-button" onClick={() => setAfter(null)}>First originals page</button> : null}{originals.value?.next_cursor ? <button type="button" className="text-button" onClick={() => setAfter(originals.value!.next_cursor)}>More registered originals</button> : null}
      </section>
      <label>Registered original support ID<input pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={original} onChange={event => setOriginal(event.target.value)} /></label>
    </> : <>
      <label>Current working knowledge support<select value={page.items.some(item => item.record.id === record && item.record.revision === revision) ? record : ''} onChange={event => { const item = page.items.find(item => item.record.id === event.target.value); setRecord(item?.record.id ?? ''); setRevision(item?.record.revision ?? ''); }}><option value="">Choose current knowledge</option>{page.items.filter(item => item.status === 'current' && !item.record.preference && item.record.scope.kind !== 'personal').map(item => <option key={item.record.id} value={item.record.id}>{item.record.kind} · {item.record.id} · revision {item.record.revision}</option>)}</select></label>
      <label>Exact knowledge support ID<input pattern="[A-Za-z0-9_-]{1,128}" maxLength={128} value={record} onChange={event => setRecord(event.target.value)} /></label>
      <label>Exact knowledge support revision<input pattern="0|[1-9][0-9]{0,18}" value={revision} onChange={event => setRevision(event.target.value)} /></label>
    </>}
    <button type="button" className="quiet-button" disabled={!ready || working || dependencies.length >= 32 || (kind === 'evidence' ? !/^[A-Za-z0-9_-]{1,128}$/.test(original) : !/^[A-Za-z0-9_-]{1,128}$/.test(record) || !/^(0|[1-9][0-9]{0,18})$/.test(revision))} onClick={() => void add()}>Verify and add source reference</button>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
