import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import { readEngagements } from './engagements';
import type { Engagement, Scope } from './engagements';
import { discardKnowledgeOwner, knowledgeAudience, knowledgeCustodyFailure, readPreference, recoverKnowledgeOutcome, retainKnowledge } from './knowledge';
import type { KnowledgeOutcome, Layout, PreferenceAction } from './knowledge';
import { useSkillInspection } from './useSkillInspection';
import { useKnowledgeCommands } from './useKnowledgeCommands';

export function useInspectionPreference(organisation: string, session: Session, accessReady: boolean, onAccessFailure: (error?: AccessError) => void) {
  const owner = knowledgeAudience(session, organisation);
  const readSequence = useRef(0);
  const [outcomeState, setOutcome] = useState<{ owner: string; value: KnowledgeOutcome | null; requiredRead: number }>(() => ({ owner, value: recoverKnowledgeOutcome(owner, session), requiredRead: 1 }));
  if (outcomeState.owner !== owner) setOutcome({ owner, value: recoverKnowledgeOutcome(owner, session), requiredRead: readSequence.current + 1 });
  const read = useCallback(async (signal: AbortSignal) => ({ ...await readPreference(organisation, session, signal), read_sequence: ++readSequence.current }), [owner]);
  const denied = useCallback((reason?: AccessError) => { discardKnowledgeOwner(owner); setOutcome({ owner, value: null, requiredRead: readSequence.current + 1 }); onAccessFailure(reason); }, [owner, onAccessFailure]);
  const inspection = useSkillInspection(owner, accessReady, '', read, denied);
  // A receipt may arrive after the previously verified private projection lost
  // authority. Keep the outcome in custody, but require this owner's next read
  // before disclosing its destination identifiers, including after remount.
  const outcome = outcomeState.owner === owner && inspection.verified && inspection.value!.read_sequence >= outcomeState.requiredRead ? outcomeState.value : null;
  const mutation = useKnowledgeCommands(owner, null, session, inspection.verified, denied, (receipt, request) => {
    if (request.kind !== 'preference' || !['undo', 'withdraw'].includes(request.body.action.kind) || !('event_id' in receipt)) return;
    const value: KnowledgeOutcome = { kind: request.body.action.kind as 'undo' | 'withdraw', event_id: receipt.event_id, revision: receipt.revision, affected_destinations: receipt.affected_destinations };
    if (!retainKnowledge(owner, session, null, { outcome: value })) { mutation.setError(knowledgeCustodyFailure); return; }
    setOutcome({ owner, value, requiredRead: readSequence.current + 1 });
  }, inspection.refresh);
  const observe = (opening: string, value: Layout) => inspection.value ? mutation.apply({ kind: 'observe', organisation_id: organisation, body: { key: crypto.randomUUID(), opening_id: opening, value, expected_revision: inspection.value.revision } }) : Promise.resolve();
  const apply = (action: PreferenceAction) => {
    if (!inspection.value) return Promise.resolve();
    return mutation.apply({ kind: 'preference', organisation_id: organisation, body: { key: crypto.randomUUID(), expected_revision: inspection.value.revision, action } });
  };
  const dismissOutcome = () => { if (inspection.verified && retainKnowledge(owner, session, null, { outcome: null })) setOutcome({ owner, value: null, requiredRead: readSequence.current + 1 }); };
  return { inspection, mutation, observe, apply, outcome, dismissOutcome };
}
export function InspectionPreference({ state, organisation, session, scope, onUndo }: {
  state: ReturnType<typeof useInspectionPreference>; organisation: string; session: Session; scope: Scope; onUndo: () => void;
}) {
  const { inspection, mutation } = state;
  const [destinations, setDestinations] = useState<Engagement[]>([]);
  const [cursor, setCursor] = useState<Scope | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [destination, setDestination] = useState('');
  const [destinationError, setDestinationError] = useState('');
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const destinationRequest = useRef<AbortController | null>(null);
  const value = inspection.value, current = value?.current, preference = current?.record.preference;
  const owner = knowledgeAudience(session, organisation);
  const latest = useRef({ owner, ready: inspection.verified }); latest.current = { owner, ready: inspection.verified };
  useEffect(() => {
    if (!inspection.verified) { const cancelled = destinationRequest.current; destinationRequest.current = null; cancelled?.abort(); setDestinations([]); setLoaded(false); setDestination(''); setLoadingDestinations(false); }
  }, [inspection.verified]);
  useEffect(() => () => { const cancelled = destinationRequest.current; destinationRequest.current = null; cancelled?.abort(); }, []);
  async function loadDestinations(after: Scope | null = null) {
    if (!inspection.verified) return;
    const controller = new AbortController(); destinationRequest.current?.abort(); destinationRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Retire the old choices before I/O. A late response must not clear a
    // selection the user made against a stale, still-enabled destination list.
    setLoadingDestinations(true); setLoaded(false); setDestinations([]); setCursor(null); setDestination(''); setDestinationError('');
    try {
      const page = await readEngagements(session, controller.signal, after);
      if (latest.current.owner !== owner || !latest.current.ready || destinationRequest.current !== controller) return;
      setDestinations(page.engagements.filter(e => e.organisation_id === organisation)); setCursor(page.next_cursor); setLoaded(true);
    } catch { if (latest.current.owner === owner && destinationRequest.current === controller) { setDestinations([]); setDestinationError('Assigned destinations are unavailable. Refresh before releasing a value.'); } }
    finally { clearTimeout(timeout); if (destinationRequest.current === controller) setLoadingDestinations(false); }
  }
  return <section ref={inspection.panel} className="inspection-preference" aria-label="Your inspection preference">
    {!inspection.verified ? <p className="scope-note" role="status">{inspection.error ? 'Your display preference is currently unavailable.' : 'Checking your display preference…'}</p> : null}
    <div hidden={!inspection.verified}>
      {state.outcome ? <section className="notice" aria-label="Preference change outcome"><p>{state.outcome.kind === 'undo' ? 'Remembered preference undone.' : 'Released value withdrawn.'} Event {state.outcome.event_id} · revision {state.outcome.revision}.</p>{state.outcome.affected_destinations.length ? <><p>Affected destination engagements:</p><ul>{state.outcome.affected_destinations.map(destination => <li key={destination}>{destination}</li>)}</ul></> : <p>No released destination engagements were affected.</p>}<button type="button" className="text-button" onClick={state.dismissOutcome}>Dismiss preference outcome</button></section> : null}
      <details><summary>{preference ? preference.inferred ? 'Learned from your display choices' : 'Your saved display choice' : 'Your inspection display preference'}</summary>
        <p>Only the standard or expanded Task layout is remembered. This setting is private to you unless you explicitly release its exact value.</p>
        {current && preference ? <><p><strong>{preference.value === 'expanded' ? 'Expanded inspection' : 'Standard inspection'}</strong> · {current.status}. Applied to later openings when the viewport supports it. Your explicit choice in an opening takes precedence.</p>
          <details><summary>Inspect preference basis</summary><dl><div><dt>Owner</dt><dd>{current.record.scope.owner_id}</dd></div><div><dt>Record and revision</dt><dd>{current.record.id} · {current.record.revision}</dd></div><div><dt>Learning rule</dt><dd>{preference.rule ?? 'Explicit owner choice'}</dd></div><div><dt>Choice events</dt><dd>{preference.observation_ids.join(', ') || 'No inferred events'}</dd></div><div><dt>Consumed event horizon</dt><dd>{value?.consumed_through}</dd></div></dl></details>
          {current.can_undo ? <button type="button" className="quiet-button" disabled={mutation.working || !!mutation.pending} onClick={() => { onUndo(); void state.apply({ kind: 'undo', target: { id: current.record.id, revision: current.record.revision } }); }}>Undo remembered preference</button> : null}
          <p className="scope-note">Undo withdraws active releases and consumes the learned observations. Original audit events remain.</p>
          <details><summary>Release this exact layout value</summary><p>Choose an assigned engagement. Only {preference.value} layout, revision {current.record.revision}, is released as an optional setting; your private events and source text stay private.</p>
            <button type="button" className="text-button" disabled={loadingDestinations || mutation.working} onClick={() => void loadDestinations()}>Load assigned destinations</button>
            {loadingDestinations ? <p role="status">Checking assigned destination access…</p> : null}
            {loaded ? <><label>Preference destination<select value={destination} disabled={loadingDestinations} onChange={event => setDestination(event.target.value)}><option value="">Choose an engagement</option>{destinations.map(e => <option key={e.engagement_id} value={e.engagement_id}>{e.client_name} / {e.engagement_name}{e.engagement_id === scope.engagement_id ? ' (current)' : ''}</option>)}</select></label>{cursor ? <button type="button" className="text-button" disabled={loadingDestinations} onClick={() => void loadDestinations(cursor)}>More assigned destinations</button> : null}
              <button type="button" disabled={!destination || loadingDestinations || mutation.working || !!mutation.pending} onClick={() => { const selected = destinations.find(e => e.engagement_id === destination); if (selected) void state.apply({ kind: 'publish', target: { id: current.record.id, revision: current.record.revision }, client_id: selected.client_id, engagement_id: selected.engagement_id }); }}>Release exact layout value</button></> : null}
            {destinationError ? <p role="alert">{destinationError}</p> : null}
          </details>
        </> : <p>No remembered layout. Two matching explicit Expand or Reduce choices on distinct inspection openings can teach this harmless default.</p>}
        <div className="knowledge-actions"><button type="button" className="text-button" disabled={mutation.working || !!mutation.pending} onClick={() => void state.apply({ kind: 'save', value: 'standard' })}>Remember standard layout</button><button type="button" className="text-button" disabled={mutation.working || !!mutation.pending} onClick={() => void state.apply({ kind: 'save', value: 'expanded' })}>Remember expanded layout</button></div>
        {value?.publications.length ? <details><summary>Your released values</summary><ul>{value.publications.map(publication => <li key={publication.record.id}>{publication.record.preference?.value} · {publication.record.scope.client_id} / {publication.record.scope.engagement_id} · {publication.status}{publication.status === 'current' ? <button type="button" className="text-button" disabled={mutation.working || !!mutation.pending} onClick={() => void state.apply({ kind: 'withdraw', publication_id: publication.record.id })}>Withdraw released value</button> : null}</li>)}</ul></details> : null}
        <button type="button" className="text-button" disabled={inspection.loading} onClick={() => void inspection.refresh()}>Refresh display preference</button>
      </details>
      {mutation.pending ? <div role="status"><p>Display choice delivery is unconfirmed. The same opening and choice are retained.</p><button type="button" disabled={mutation.working} onClick={() => void mutation.apply(mutation.pending!)}>Retry exact display choice</button></div> : null}
      {mutation.error ? <p role="alert">{mutation.error}</p> : null}
    </div>
  </section>;
}
