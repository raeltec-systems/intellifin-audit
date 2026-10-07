import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { OutboxItem } from './conversation-outbox';
import type { Scope } from './engagements';
import { establishedScope, newKey, readOpenSetups, readSetupOrganisations, sendSetup, setupErrorText, setupOutbox } from './engagement-setup';
import type { SetupCommand, SetupOrganisation, SetupView } from './engagement-setup';

interface Props {
  session: Session;
  accessReady: boolean;
  hasEngagements: boolean;
  onAccessFailure: (error?: AccessError) => void;
  onEstablished: (scope: Scope) => void;
}

const accessStatus = (reason: unknown) => reason instanceof AccessError && [401, 412].includes(reason.status);

function describe(command: SetupCommand): string {
  switch (command.op) {
    case 'open': return `Start: ${command.objective}`;
    case 'text': return `Answer: ${command.content}`;
    case 'choose_client': return 'Client choice';
    case 'new_client': return command.accept ? 'Create the new client' : 'Do not create the new client';
    case 'cancel': return 'Cancel setup';
    case 'confirm': return 'Confirm and start';
  }
}

/// Organisation-level conversation that establishes an engagement from a first
/// objective. Zobba asks only for the client and the audit period, then shows one
/// confirmation. Nothing is created until that confirmation succeeds.
export function EngagementSetup({ session, accessReady, hasEngagements, onAccessFailure, onEstablished }: Props) {
  const actor = session.identity.id;
  const [expanded, setExpanded] = useState(!hasEngagements);
  const [organisations, setOrganisations] = useState<SetupOrganisation[] | null>(null);
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [setups, setSetups] = useState<SetupView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [retained, setRetained] = useState<OutboxItem<SetupCommand>[]>([]);
  const [draft, setDraft] = useState('');
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const generation = useRef(0);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const active = setups.find(setup => setup.id === activeId) ?? null;

  useEffect(() => { if (!hasEngagements) setExpanded(true); }, [hasEngagements]);

  useEffect(() => {
    if (!accessReady || !expanded) return;
    const request = new AbortController();
    const current = ++generation.current;
    const deadline = setTimeout(() => request.abort(), 8000);
    readSetupOrganisations(session, request.signal).then(found => {
      if (current !== generation.current) return;
      setOrganisations(found);
      setOrganisationId(id => id && found.some(o => o.organisation_id === id) ? id : found[0]?.organisation_id ?? null);
      setReadError('');
    }, reason => {
      if (current !== generation.current) return;
      if (accessStatus(reason)) { onAccessFailure(reason as AccessError); return; }
      setReadError('Your organisations could not be loaded. Try again shortly.');
    }).finally(() => clearTimeout(deadline));
    return () => { request.abort(); clearTimeout(deadline); };
  }, [accessReady, expanded, session, onAccessFailure]);

  useEffect(() => {
    if (!accessReady || !expanded || !organisationId) return;
    const request = new AbortController();
    const current = generation.current;
    const deadline = setTimeout(() => request.abort(), 8000);
    const store = setupOutbox(actor, organisationId);
    Promise.all([readOpenSetups(organisationId, session, request.signal), store.read().catch(() => [])]).then(([open, kept]) => {
      if (current !== generation.current) return;
      setSetups(open);
      setRetained(kept);
      setActiveId(id => id && open.some(setup => setup.id === id) ? id : open.at(-1)?.id ?? null);
    }, reason => {
      if (current !== generation.current) return;
      if (accessStatus(reason)) { onAccessFailure(reason as AccessError); return; }
      setReadError('Open setups could not be loaded. Try again shortly.');
    }).finally(() => { clearTimeout(deadline); store.close(); });
    return () => { request.abort(); clearTimeout(deadline); };
  }, [accessReady, expanded, organisationId, actor, session, onAccessFailure]);

  // Move focus to the control for the next answer once Zobba has replied.
  const stateKey = active ? `${active.id}/${active.state}/${active.messages.length}` : 'none';
  useEffect(() => {
    if (!expanded || busy) return;
    if (active?.state === 'confirm') confirmButton.current?.focus({ preventScroll: true });
    else if (active && ['client', 'period'].includes(active.state)) input.current?.focus({ preventScroll: true });
  }, [stateKey, expanded]);

  const apply = useCallback((view: SetupView) => {
    setSetups(current => {
      const others = current.filter(setup => setup.id !== view.id);
      return ['established', 'cancelled'].includes(view.state) ? others : [...others, view];
    });
    setActiveId(view.state === 'cancelled' ? null : view.id);
    setChoice('');
    const scope = establishedScope(view);
    if (scope) onEstablished(scope);
  }, [onEstablished]);

  async function send(command: SetupCommand, clearDraft = false) {
    if (!organisationId || busy || !accessReady) return;
    const org = organisationId;
    const current = generation.current;
    setBusy(true); setError('');
    const store = setupOutbox(actor, org);
    const request = new AbortController();
    const deadline = setTimeout(() => request.abort(), 10000);
    try {
      // Persist the exact request before it is transmitted.
      try { await store.reserve(command); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Reliable recovery storage is unavailable. Nothing was sent.'); return; }
      if (clearDraft) setDraft('');
      setRetained(await store.read().catch(() => []));
      try {
        const view = await sendSetup(org, session, command, request.signal);
        await store.remove(command.key).catch(() => {});
        if (current !== generation.current) return;
        setRetained(await store.read().catch(() => []));
        apply(view);
      } catch (reason) {
        if (current !== generation.current) return;
        const status = reason instanceof AccessError ? reason.status : 0;
        if ([400, 403, 409].includes(status)) {
          // A definite refusal: nothing was created by this request.
          await store.save(command, 'conflict').catch(() => {});
          setError(status === 403 ? 'You no longer have audit access in this organisation. Nothing was created.'
            : setupErrorText((reason as AccessError).code, status));
        } else {
          setError(setupErrorText(undefined, status));
        }
        setRetained(await store.read().catch(() => []));
        if (accessStatus(reason) || status === 403) onAccessFailure(reason as AccessError);
      }
    } finally {
      clearTimeout(deadline); store.close();
      if (current === generation.current) setBusy(false);
    }
  }

  async function discard(item: OutboxItem<SetupCommand>) {
    if (!organisationId) return;
    const store = setupOutbox(actor, organisationId);
    try { await store.remove(item.key); setRetained(await store.read()); } catch { setError('The retained request could not be removed.'); }
    finally { store.close(); }
  }

  if (!expanded) {
    return <div className="setup-entry">
      <button type="button" className="quiet-button" data-focus="start-engagement" onClick={() => setExpanded(true)}>Start new engagement</button>
    </div>;
  }
  if (organisations === null) return readError ? <p className="composer-error" role="alert">{readError}</p> : null;
  if (organisations.length === 0) {
    return hasEngagements ? <section className="empty-panel" aria-label="Start new engagement"><h2>Start new engagement</h2>
      <p>You need a current auditor or audit manager role in an organisation to set up an engagement.</p></section>
      : <section className="empty-panel"><h2>No assigned engagements</h2><p>You are signed in, but you do not currently have access to any client work. Contact your organisation administrator if you need an assignment.</p></section>;
  }
  const organisation = organisations.find(o => o.organisation_id === organisationId) ?? null;
  const unanswered = retained.length > 0;
  return <section className="engagement-setup" aria-labelledby="setup-title">
    <div className="setup-header">
      <h2 id="setup-title">{hasEngagements ? 'Start new engagement' : 'Start your first engagement'}</h2>
      {organisations.length > 1 ? <label className="setup-organisation">Organisation
        <select value={organisationId ?? ''} disabled={busy} onChange={event => { setOrganisationId(event.currentTarget.value); setActiveId(null); setError(''); }}>
          {organisations.map(o => <option key={o.organisation_id} value={o.organisation_id}>{o.organisation_name}</option>)}
        </select></label> : organisation ? <p className="setup-organisation-name">{organisation.organisation_name}</p> : null}
    </div>
    <p className="setup-intro">Tell Zobba what you want to work on. Zobba asks only for the client and the audit period, then shows one confirmation. Nothing is created until you confirm, and you will be the only person assigned.</p>
    {readError ? <p className="composer-error" role="alert">{readError}</p> : null}
    {setups.length > 1 ? <nav className="setup-open-list" aria-label="Open setups">
      {setups.map(setup => <button key={setup.id} type="button" className="text-button" aria-current={setup.id === activeId ? 'true' : undefined} onClick={() => setActiveId(setup.id)}>{setup.objective}</button>)}
    </nav> : null}
    {active ? <ol className="setup-messages" aria-label="Setup conversation" aria-live="polite">
      {active.messages.map(message => <li key={message.ordinal} className={`setup-message ${message.author}${message.kind === 'refusal' ? ' refusal' : ''}`}>
        <span className="setup-author">{message.author === 'zobba' ? 'Zobba' : 'You'}</span>
        <p className="retained-text">{message.content}</p>
      </li>)}
    </ol> : null}
    {unanswered ? <div className="setup-retained" role="status">
      <p>{retained.some(item => item.status === 'uncertain') ? 'Some requests were saved but not confirmed. Sending again is safe.' : 'A request was refused.'}</p>
      <ul>{retained.map(item => <li key={item.key}>
        <span>{describe(item.command)}{item.status === 'conflict' ? ' · refused' : ' · not confirmed'}</span>
        {item.status === 'uncertain' ? <button type="button" className="quiet-button" disabled={busy || !accessReady} onClick={() => void send(item.command)}>Send again</button> : null}
        <button type="button" className="text-button" disabled={busy} onClick={() => void discard(item)}>Discard</button>
      </li>)}</ul>
    </div> : null}
    {!active ? <form className="setup-composer" onSubmit={event => { event.preventDefault(); const objective = draft.trim() ? draft : ''; if (objective) void send({ key: newKey(), op: 'open', objective }, true); }}>
      <label htmlFor="setup-objective">First objective</label>
      <textarea id="setup-objective" ref={element => { input.current = element; }} rows={3} value={draft} disabled={busy || !organisation}
        placeholder="What would you like to work on?" onChange={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="composer-bottom"><p className="composer-help">Enter to send · Shift+Enter for a new line</p>
        <button type="submit" disabled={busy || !accessReady || !draft.trim() || !organisation}>Start</button></div>
    </form> : null}
    {active && (active.state === 'client' || active.state === 'period') ? <form className="setup-composer" onSubmit={event => {
      event.preventDefault(); if (draft.trim()) void send({ key: newKey(), op: 'text', setup_id: active.id, content: draft }, true);
    }}>
      <label htmlFor="setup-answer">{active.state === 'client' ? 'Client name' : 'Audit period'}</label>
      <input id="setup-answer" ref={element => { input.current = element; }} type="text" value={draft} disabled={busy} autoComplete="off"
        placeholder={active.state === 'client' ? 'Exact client name' : '2026-01-01 to 2026-12-31'}
        aria-describedby="setup-answer-help" onChange={event => setDraft(event.currentTarget.value)} />
      <p id="setup-answer-help" className="composer-help">{active.state === 'client' ? 'Matched exactly, ignoring letter case. A new client is created only if you confirm it.' : 'Two ISO dates, start first: YYYY-MM-DD to YYYY-MM-DD.'}</p>
      <div className="composer-bottom"><span />
        <button type="submit" disabled={busy || !accessReady || !draft.trim()}>Send</button></div>
    </form> : null}
    {active?.state === 'client_choice' ? <form className="setup-composer" onSubmit={event => { event.preventDefault(); if (choice) void send({ key: newKey(), op: 'choose_client', setup_id: active.id, client_id: choice }); }}>
      <fieldset disabled={busy}>
        <legend>Which client is it?</legend>
        {active.candidates.map(candidate => <label key={candidate.client_id} className="setup-candidate">
          <input type="radio" name="setup-client" value={candidate.client_id} checked={choice === candidate.client_id} onChange={() => setChoice(candidate.client_id)} /> {candidate.client_name}
        </label>)}
      </fieldset>
      <div className="composer-bottom"><span /><button type="submit" disabled={busy || !accessReady || !choice}>Use this client</button></div>
    </form> : null}
    {active?.state === 'new_client' && active.new_client_name ? <div className="setup-actions" role="group" aria-label={`Create client ${active.new_client_name}?`}>
      <button type="button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'new_client', setup_id: active.id, accept: true })}>Create client {active.new_client_name}</button>
      <button type="button" className="quiet-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'new_client', setup_id: active.id, accept: false })}>No, name another client</button>
    </div> : null}
    {active?.state === 'confirm' ? <div className="setup-summary" role="group" aria-label="Confirm engagement setup">
      <dl>
        <div><dt>Objective</dt><dd className="retained-text">{active.objective}</dd></div>
        <div><dt>Client</dt><dd>{active.client?.client_name ?? `${active.new_client_name} (new client)`}</dd></div>
        <div><dt>Audit period</dt><dd>{active.period_start} to {active.period_end}</dd></div>
        <div><dt>Assigned</dt><dd>Only you</dd></div>
      </dl>
      <button ref={confirmButton} type="button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'confirm', setup_id: active.id })}>Confirm and start</button>
    </div> : null}
    {active ? <div className="setup-footer">
      <button type="button" className="text-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'cancel', setup_id: active.id })}>Cancel setup</button>
      {setups.length < 8 ? <button type="button" className="text-button" disabled={busy} onClick={() => { setActiveId(null); setDraft(''); }}>Start another</button> : null}
    </div> : null}
    {busy ? <p className="composer-help" role="status">Sending…</p> : null}
    {error ? <p className="composer-error" role="alert">{error}</p> : null}
    {hasEngagements ? <button type="button" className="text-button" onClick={() => setExpanded(false)}>Close</button> : null}
  </section>;
}
