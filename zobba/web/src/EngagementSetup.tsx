import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { OutboxItem } from './conversation-outbox';
import type { Scope } from './engagements';
import { SETUP_LIMITS, draftProblem, establishedScope, isAccessLoss, newKey, readOpenSetups, readSetup, readSetupOrganisations, sendSetup, setupErrorText, setupOutbox } from './engagement-setup';
import type { SetupCommand, SetupLimits, SetupOrganisation, SetupView } from './engagement-setup';

interface Props {
  session: Session;
  accessReady: boolean;
  hasEngagements: boolean;
  onAccessFailure: (error?: AccessError) => void;
  onEstablished: (scope: Scope) => void;
}

/** The objective composer's draft key; each setup keeps its own draft by ID. */
const OBJECTIVE = 'objective';

function describe(command: SetupCommand): string {
  switch (command.op) {
    case 'open': return `Start: ${command.objective}`;
    case 'text': return `Answer: ${command.content}`;
    case 'choose_client': return `Client: ${command.client_name}`;
    case 'new_client': return command.accept ? 'Create the new client' : 'Do not create the new client';
    case 'change_client': return 'Change client';
    case 'change_period': return 'Change audit period';
    case 'cancel': return 'Cancel setup';
    case 'confirm': return 'Confirm and start';
  }
}

/** A read whose own deadline expired is a failure; a read the component abandoned is not. */
function deadline(request: AbortController, ms: number) {
  let expired = false;
  const timer = setTimeout(() => { expired = true; request.abort(); }, ms);
  return { clear: () => clearTimeout(timer), abandoned: () => request.signal.aborted && !expired };
}

/// Organisation-level conversation that establishes an engagement from a first
/// objective. Zobba asks only for the client and the audit period, then shows one
/// confirmation. Nothing is created until that confirmation succeeds.
export function EngagementSetup({ session, accessReady, hasEngagements, onAccessFailure, onEstablished }: Props) {
  const actor = session.identity.id;
  const [expanded, setExpanded] = useState(!hasEngagements);
  const [organisations, setOrganisations] = useState<SetupOrganisation[] | null>(null);
  const [moreOrganisations, setMoreOrganisations] = useState(false);
  const [limits, setLimits] = useState<SetupLimits>(SETUP_LIMITS);
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [setups, setSetups] = useState<SetupView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [retained, setRetained] = useState<OutboxItem<SetupCommand>[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  // Each read and each organisation choice has its own generation; a late
  // response from an earlier one never applies.
  const organisationReads = useRef(0);
  const setupReads = useRef(0);
  const selected = useRef<string | null>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const active = setups.find(setup => setup.id === activeId) ?? null;
  const draftKey = active?.id ?? OBJECTIVE;
  const draft = drafts[draftKey] ?? '';
  const setDraft = (key: string, value: string) => setDrafts(current => ({ ...current, [key]: value }));
  selected.current = organisationId;

  useEffect(() => { if (!hasEngagements) setExpanded(true); }, [hasEngagements]);

  useEffect(() => {
    if (!accessReady || !expanded) return;
    const request = new AbortController();
    const current = ++organisationReads.current;
    const timer = deadline(request, 8000);
    readSetupOrganisations(session, request.signal).then(page => {
      if (current !== organisationReads.current) return;
      setOrganisations(page.organisations);
      setMoreOrganisations(page.more);
      setLimits(page.limits);
      setOrganisationId(id => id && page.organisations.some(o => o.organisation_id === id) ? id : page.organisations[0]?.organisation_id ?? null);
      setReadError('');
    }, reason => {
      if (current !== organisationReads.current || timer.abandoned()) return;
      if (reason instanceof AccessError && isAccessLoss(reason.status, reason.code)) { onAccessFailure(reason); return; }
      setReadError('Your organisations could not be loaded. Try again shortly.');
    }).finally(timer.clear);
    return () => { request.abort(); timer.clear(); };
  }, [accessReady, expanded, session, onAccessFailure]);

  async function loadMoreOrganisations() {
    const last = organisations?.at(-1)?.organisation_id;
    if (!last || busy) return;
    const current = ++organisationReads.current;
    const request = new AbortController();
    const timer = deadline(request, 8000);
    try {
      const page = await readSetupOrganisations(session, request.signal, last);
      if (current !== organisationReads.current) return;
      setOrganisations(found => [...(found ?? []), ...page.organisations.filter(o => !found?.some(f => f.organisation_id === o.organisation_id))]);
      setMoreOrganisations(page.more);
    } catch (reason) {
      if (current !== organisationReads.current || timer.abandoned()) return;
      if (reason instanceof AccessError && isAccessLoss(reason.status, reason.code)) { onAccessFailure(reason); return; }
      setReadError('More organisations could not be loaded. Try again shortly.');
    } finally { timer.clear(); }
  }

  useEffect(() => {
    if (!accessReady || !expanded || !organisationId) return;
    const request = new AbortController();
    const current = ++setupReads.current;
    const timer = deadline(request, 8000);
    const org = organisationId;
    const store = setupOutbox(actor, org);
    setSetups([]); setRetained([]);
    Promise.all([readOpenSetups(org, session, request.signal), store.read().catch(() => [])]).then(([open, kept]) => {
      if (current !== setupReads.current || selected.current !== org) return;
      setSetups(open);
      setRetained(kept);
      setActiveId(id => id && open.some(setup => setup.id === id) ? id : open.at(-1)?.id ?? null);
      setReadError('');
    }, reason => {
      if (current !== setupReads.current || selected.current !== org || timer.abandoned()) return;
      if (reason instanceof AccessError && isAccessLoss(reason.status, reason.code)) { onAccessFailure(reason); return; }
      setReadError('Open setups could not be loaded. Try again shortly.');
    }).finally(() => { timer.clear(); store.close(); });
    return () => { request.abort(); timer.clear(); };
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

  /** Re-read one setup so a refusal it retained (for example a refused confirmation) is shown. */
  async function refresh(org: string, setupId: string) {
    const request = new AbortController();
    const timer = deadline(request, 8000);
    try {
      const view = await readSetup(org, setupId, session, request.signal);
      if (selected.current === org) apply(view);
    } catch (reason) {
      if (reason instanceof AccessError && reason.status === 404) setSetups(current => current.filter(setup => setup.id !== setupId));
    } finally { timer.clear(); }
  }

  async function send(command: SetupCommand, draftOf?: string) {
    if (!organisationId || busy || !accessReady) return;
    const org = organisationId;
    setBusy(true); setError('');
    const store = setupOutbox(actor, org);
    const request = new AbortController();
    const timer = deadline(request, 10000);
    try {
      // Persist the exact request before it is transmitted.
      try { await store.reserve(command); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Reliable recovery storage is unavailable. Nothing was sent.'); return; }
      setRetained(await store.read().catch(() => []));
      try {
        const view = await sendSetup(org, session, command, request.signal);
        await store.remove(command.key).catch(() => {});
        if (draftOf) setDraft(draftOf, '');
        if (selected.current !== org) return;
        setRetained(await store.read().catch(() => []));
        apply(view);
      } catch (reason) {
        const status = reason instanceof AccessError ? reason.status : 0;
        const code = reason instanceof AccessError ? reason.code : undefined;
        if ([400, 403, 404, 409].includes(status)) {
          // A definite refusal: nothing was created by this request. The draft stays.
          await store.save(command, 'conflict').catch(() => {});
          setError(setupErrorText(code, status, limits));
          if (command.op !== 'open' && (status === 409 || status === 404)) await refresh(org, command.setup_id);
        } else {
          // Unknown delivery: the exact request is retained with Send again.
          if (draftOf) setDraft(draftOf, '');
          setError(setupErrorText(undefined, status, limits));
        }
        if (selected.current === org) setRetained(await store.read().catch(() => []));
        if (reason instanceof AccessError && isAccessLoss(status, code)) onAccessFailure(reason);
      }
    } finally {
      timer.clear(); store.close();
      setBusy(false);
    }
  }

  async function discard(item: OutboxItem<SetupCommand>) {
    if (!organisationId) return;
    const store = setupOutbox(actor, organisationId);
    try { await store.remove(item.key); setRetained(await store.read()); } catch { setError('The retained request could not be removed.'); }
    finally { store.close(); }
  }

  /** Validate the draft's UTF-8 length before anything is reserved. */
  function submitText(kind: 'objective' | 'answer', build: (text: string) => SetupCommand) {
    if (!draft.trim()) return;
    const problem = draftProblem(draft, kind, limits);
    if (problem) { setError(problem); return; }
    void send(build(draft), draftKey);
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
  const draftTooLong = draftProblem(draft, active ? 'answer' : 'objective', limits);
  return <section className="engagement-setup" aria-labelledby="setup-title">
    <div className="setup-header">
      <h2 id="setup-title">{hasEngagements ? 'Start new engagement' : 'Start your first engagement'}</h2>
      {organisations.length > 1 || moreOrganisations ? <label className="setup-organisation">Organisation
        <select value={organisationId ?? ''} disabled={busy} onChange={event => { setOrganisationId(event.currentTarget.value); setActiveId(null); setChoice(''); setError(''); }}>
          {organisations.map(o => <option key={o.organisation_id} value={o.organisation_id}>{o.organisation_name}</option>)}
        </select></label> : organisation ? <p className="setup-organisation-name">{organisation.organisation_name}</p> : null}
      {moreOrganisations ? <p className="composer-help">More organisations exist. <button type="button" className="text-button" disabled={busy} onClick={() => void loadMoreOrganisations()}>Show more organisations</button></p> : null}
    </div>
    <p className="setup-intro">Tell Zobba what you want to work on. Zobba asks only for the client and the audit period, then shows one confirmation. Nothing is created until you confirm, and you will be the only person assigned.</p>
    {readError ? <p className="composer-error" role="alert">{readError}</p> : null}
    {setups.length > 1 ? <nav className="setup-open-list" aria-label="Open setups">
      {setups.map(setup => <button key={setup.id} type="button" className="text-button" aria-current={setup.id === activeId ? 'true' : undefined} disabled={busy} onClick={() => { setActiveId(setup.id); setChoice(''); }}>{setup.objective}</button>)}
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
    {!active ? <form className="setup-composer" onSubmit={event => { event.preventDefault(); submitText('objective', objective => ({ key: newKey(), op: 'open', objective })); }}>
      <label htmlFor="setup-objective">First objective</label>
      <textarea id="setup-objective" ref={element => { input.current = element; }} rows={3} value={draft} disabled={busy || !organisation}
        placeholder="What would you like to work on?" onChange={event => setDraft(OBJECTIVE, event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="composer-bottom"><p className="composer-help">Enter to send · Shift+Enter for a new line</p>
        <button type="submit" disabled={busy || !accessReady || !draft.trim() || !organisation || !!draftTooLong}>Start</button></div>
    </form> : null}
    {active && (active.state === 'client' || active.state === 'period' || active.state === 'client_choice') ? <form className="setup-composer" onSubmit={event => {
      event.preventDefault(); submitText('answer', content => ({ key: newKey(), op: 'text', setup_id: active.id, content }));
    }}>
      <label htmlFor="setup-answer">{active.state === 'period' ? 'Audit period' : active.state === 'client_choice' ? 'Or type another client name' : 'Client name'}</label>
      <input id="setup-answer" ref={element => { input.current = element; }} type="text" value={draft} disabled={busy} autoComplete="off"
        placeholder={active.state === 'period' ? '2026-01-01 to 2026-12-31' : 'Exact client name'}
        aria-describedby="setup-answer-help" onChange={event => setDraft(active.id, event.currentTarget.value)} />
      <p id="setup-answer-help" className="composer-help">{active.state === 'period' ? 'Two ISO dates, start first: YYYY-MM-DD to YYYY-MM-DD.' : 'Matched exactly, ignoring letter case. A new client is created only if you confirm it.'}</p>
      <div className="composer-bottom">{active.state === 'period' ? <button type="button" className="text-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'change_client', setup_id: active.id })}>Change client</button> : <span />}
        <button type="submit" disabled={busy || !accessReady || !draft.trim() || !!draftTooLong}>Send</button></div>
    </form> : null}
    {active?.state === 'client_choice' ? <form className="setup-composer" onSubmit={event => {
      event.preventDefault();
      const candidate = active.candidates.find(c => c.client_id === choice);
      if (candidate) void send({ key: newKey(), op: 'choose_client', setup_id: active.id, client_id: candidate.client_id, client_name: candidate.client_name });
    }}>
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
      <div className="setup-actions">
        <button ref={confirmButton} type="button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'confirm', setup_id: active.id })}>Confirm and start</button>
        <button type="button" className="quiet-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'change_client', setup_id: active.id })}>Change client</button>
        <button type="button" className="quiet-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'change_period', setup_id: active.id })}>Change period</button>
      </div>
    </div> : null}
    {active ? <div className="setup-footer">
      <button type="button" className="text-button" disabled={busy || !accessReady} onClick={() => void send({ key: newKey(), op: 'cancel', setup_id: active.id })}>Cancel setup</button>
      {setups.length < limits.open_setups ? <button type="button" className="text-button" disabled={busy} onClick={() => setActiveId(null)}>Start another</button> : null}
    </div> : null}
    {busy ? <p className="composer-help" role="status">Sending…</p> : null}
    {error ? <p className="composer-error" role="alert">{error}</p> : null}
    {hasEngagements ? <button type="button" className="text-button" disabled={busy} onClick={() => setExpanded(false)}>Close</button> : null}
  </section>;
}
