import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessError, logout, readSession } from './auth';
import type { Session } from './auth';
import { readEngagement, readEngagements, roleLabel, scopeFromLocation, showScope } from './engagements';
import type { Engagement, EngagementPage, Scope } from './engagements';
import { HealthPage } from './HealthPage';
import { ConversationWorkspace } from './ConversationWorkspace';
import { EvidenceWorkspace } from './EvidenceWorkspace';
import { MethodologyWorkspace } from './MethodologyWorkspace';
import { discardMethodologyAction } from './methodology';
import { discardAcquisitionDraft } from './evidence';
import { sameScope } from './engagements';
import { captureIncomingInvitation, hasIncomingInvitation, MembershipWorkspace } from './MembershipWorkspace';

type View =
  | { kind: 'loading'; signingOut?: boolean }
  | { kind: 'signed-out'; message?: string }
  | { kind: 'unavailable'; message: string; action: 'read' | 'logout' }
  | { kind: 'ready'; session: Session; page: EngagementPage; pageNumber: number; selected: Engagement | null; message?: string };

const signInFailed = new URLSearchParams(location.search).has('auth_error');

function OpenArrow() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 18 18 6M6 6h12v12" /></svg>;
}

function PairWorkspace() {
  const [methodologyOpen, setMethodologyOpen] = useState(location.pathname === '/methodology');
  const methodologyOpener = useRef<HTMLAnchorElement>(null);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [projectionUsable, setProjectionUsable] = useState(false);
  const [evidenceProjectionUsable, setEvidenceProjectionUsable] = useState(true);
  const evidenceProjectionStatus = useCallback((usable: boolean) => setEvidenceProjectionUsable(usable), []);
  const projectionStatus = useCallback((usable: boolean) => setProjectionUsable(usable), []);
  const currentView = useRef<View>({ kind: 'loading' });
  currentView.current = view;
  const focusSnapshot = useRef<{ element: HTMLElement; start: number | null; end: number | null } | null>(null);
  const request = useRef<AbortController | null>(null);
  // A user action outlives automatic reads and even an uncertain POST result.
  // Its independent controller is aborted only at unmount or its own deadline.
  const logoutIntent = useRef(false);
  const logoutRequest = useRef<AbortController | null>(null);
  const scope = useRef<Scope | null>(scopeFromLocation());
  const pageCursors = useRef<(Scope | null)[]>([null]);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  // One automatic recovery covers the entire session -> scope -> conversation
  // composition. A successful scope read alone does not replenish this budget.
  const sessionRecovery = useRef({ remaining: 1, blocked: false });
  const accessStable = useCallback(() => { sessionRecovery.current = { remaining: 1, blocked: false }; }, []);
  const recoverSession = useCallback(() => {
    if (sessionRecovery.current.remaining === 0) {
      sessionRecovery.current.blocked = true;
      return false;
    }
    sessionRecovery.current.remaining--;
    return true;
  }, []);

  const rememberFocus = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body || !active.getClientRects().length) return;
    restoreFocus.current = active.dataset.focus ?? null;
    focusSnapshot.current = { element: active, start: active instanceof HTMLTextAreaElement ? active.selectionStart : null,
      end: active instanceof HTMLTextAreaElement ? active.selectionEnd : null };
  }, []);

  useLayoutEffect(() => {
    if (view.kind === 'loading' || busy || view.kind === 'ready' && view.selected && (!projectionUsable || !evidenceProjectionUsable)) return;
    const saved = focusSnapshot.current;
    const target = pendingFocus.current;
    if (target !== 'workspace-heading' && saved?.element.isConnected && saved.element.getClientRects().length) {
      saved.element.focus({ preventScroll: true });
      if (saved.element instanceof HTMLTextAreaElement && saved.start !== null && saved.end !== null) {
        saved.element.setSelectionRange(saved.start, saved.end);
      }
    } else if (target || saved) {
      const control = target && target !== 'workspace-heading'
        ? document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(target)}"]`) : null;
      (control ?? heading.current)?.focus({ preventScroll: true });
    }
    focusSnapshot.current = null;
    pendingFocus.current = null;
    restoreFocus.current = null;
  }, [view, busy, projectionUsable, evidenceProjectionUsable]);

  const refresh = useCallback(async (focus = false, userInitiated = false) => {
    if (logoutIntent.current) return;
    if (userInitiated) accessStable();
    else if (sessionRecovery.current.blocked) return;
    rememberFocus();
    pendingFocus.current = focus ? 'workspace-heading' : restoreFocus.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setBusy(true);
    // Keep the same workspace mounted while a same-scope read is in flight.
    // Its hook withdraws server projections and stops delivery; draft and focus survive.
    const previous = currentView.current;
    const retain = previous.kind === 'ready' && (!scope.current && !previous.selected ||
      scope.current && previous.selected && sameScope(scope.current, previous.selected));
    if (!retain) setView({ kind: 'loading' });
    try {
      // Session and protected projections form one read dependency. The server
      // refuses a changed cookie rather than composing another actor's results.
      // Share the single recovery with later conversation reads. All protected
      // UI remains hidden until a coherent session/scope is verified.
      for (;;) {
        try {
          const session = await readSession(controller.signal);
          if (request.current !== controller) return;
          if (previous.kind === 'ready' && previous.session.identity.id !== session.identity.id) pageCursors.current = [null];
          let page = await readEngagements(session, controller.signal, pageCursors.current.at(-1));
          // Deleted assignments may leave a later page empty. Start again using a
          // fresh authorized read instead of displaying cached earlier results.
          if (page.engagements.length === 0 && pageCursors.current.length > 1) {
            pageCursors.current = [null];
            page = await readEngagements(session, controller.signal);
          }
          let selected: Engagement | null = null;
          let message: string | undefined;
          if (scope.current) {
            try { selected = await readEngagement(scope.current, controller.signal, session); }
            catch (error) {
              if (request.current !== controller) return;
              if (error instanceof AccessError && [403, 404].includes(error.status)) {
                discardAcquisitionDraft();
                scope.current = null;
                showScope(null);
                message = 'This engagement is no longer available to you. Choose from your current assignments.';
              } else { throw error; }
            }
          }
          if (request.current !== controller) return;
          if (!selected) accessStable();
          setView({ kind: 'ready', session, page, pageNumber: pageCursors.current.length, selected, message });
          return;
        } catch (error) {
          if (request.current !== controller) return;
          if (!(error instanceof AccessError && error.status === 412 && recoverSession())) throw error;
        }
      }
    } catch (error) {
      if (request.current !== controller) return;
      if (error instanceof AccessError && error.status === 401) {
        discardAcquisitionDraft();
        scope.current = null;
        showScope(null);
        setView({ kind: 'signed-out', message: signInFailed
          ? 'Sign-in could not be completed. Please try again.' : undefined });
      } else {
        setView({ kind: 'unavailable', action: 'read', message: 'We could not verify your access. Check your connection and try again.' });
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        setBusy(false);
      }
    }
  }, [rememberFocus, accessStable, recoverSession]);

  const accessFailure = useCallback((error?: AccessError) => {
    if (error?.status === 412 && !recoverSession()) {
      rememberFocus();
      request.current?.abort(); request.current = null;
      setBusy(false);
      setView({ kind: 'unavailable', action: 'read', message: 'We could not verify your access. Check your connection and try again.' });
      return;
    }
    void refresh();
  }, [recoverSession, rememberFocus, refresh]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onVisibility = () => {
      if (logoutIntent.current || sessionRecovery.current.blocked) return;
      if (document.visibilityState === 'hidden') {
        rememberFocus();
        request.current?.abort(); request.current = null;
        setBusy(true);
      } else { void refresh(); }
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    const interval = setInterval(onFocus, 30_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      request.current?.abort(); request.current = null;
      logoutRequest.current?.abort(); logoutRequest.current = null;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, rememberFocus]);

  async function signOut(session?: Session) {
    discardMethodologyAction();
    if (logoutRequest.current) return;
    logoutIntent.current = true;
    discardAcquisitionDraft();
    pendingFocus.current = 'workspace-heading';
    request.current?.abort(); request.current = null;
    const controller = new AbortController();
    logoutRequest.current = controller;
    scope.current = null; showScope(null);
    setBusy(true); setView({ kind: 'loading', signingOut: true });
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // Retry obtains current CSRF without rendering identity or client work.
      // This also handles another tab replacing the session after a failed POST.
      await logout(session ?? await readSession(controller.signal), controller.signal);
      if (logoutRequest.current !== controller) return;
      setView({ kind: 'signed-out', message: 'You have signed out of Zobba.' });
    } catch (error) {
      if (logoutRequest.current !== controller) return;
      if (error instanceof AccessError && error.status === 401) {
        setView({ kind: 'signed-out', message: 'You have signed out of Zobba.' });
      } else {
        setView({ kind: 'unavailable', action: 'logout', message: 'We could not confirm sign-out. Check your connection and try signing out again.' });
      }
    } finally {
      clearTimeout(timeout);
      if (logoutRequest.current === controller) {
        logoutRequest.current = null;
        setBusy(false);
      }
    }
  }

  function select(next: Scope | null) {
    if (logoutIntent.current) return;
    if (!next || !scope.current || !sameScope(scope.current, next)) discardAcquisitionDraft();
    scope.current = next;
    showScope(next);
    void refresh(true, true);
  }

  function changePage(next: Scope | null) {
    if (logoutIntent.current) return;
    if (next) pageCursors.current.push(next);
    else if (pageCursors.current.length > 1) pageCursors.current.pop();
    void refresh(true, true);
  }

  const selected = view.kind === 'ready' ? view.selected : null;
  return <div className={`app-shell${selected ? ' engagement-shell' : ''}`}>
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <img className="brand-lockup" src="/assets/zobba-lockup-color.svg" alt="Zobba" width="132" height="32" />
      <nav aria-label="Main"><a href="/" aria-current={methodologyOpen ? undefined : 'page'} onClick={(event) => { event.preventDefault(); setMethodologyOpen(false); select(null); }}><span aria-hidden="true">▦</span> Engagements</a><a href="/membership"><span aria-hidden="true">⚙</span> Membership</a><a ref={methodologyOpener} href="/methodology" aria-current={methodologyOpen ? 'page' : undefined} onClick={event => { event.preventDefault(); setMethodologyOpen(true); }}><span aria-hidden="true">≡</span> Methodology and skills</a></nav>
      <div className="sidebar-note"><span className="pair-label">Pair</span><p>Your engagement workspace</p><a href="/status">Connection status</a></div>
    </aside>
    <div className="workspace">
      <header className="workspace-header">
        <span>{selected ? 'Engagement' : 'Workspace'}</span>
        {view.kind === 'ready' ? <div className="identity" hidden={busy}><span>{view.session.identity.display_name}</span><button className="quiet-button" data-focus="sign-out" type="button" onClick={() => void signOut(view.session)}>Sign out</button></div> : <span className="pair-label">Pair</span>}
      </header>
      <main id="workspace" className={selected ? 'engagement-main' : undefined} tabIndex={-1}>
        {view.kind === 'loading' ? <div className="intro" role="status"><p className="eyebrow">Zobba · Pair</p><h1>{view.signingOut ? 'Signing you out…' : 'Checking your access…'}</h1></div> : null}
        {view.kind === 'signed-out' ? <section className="intro sign-in">
          <img src="/assets/zobba-symbol-color.svg" alt="" width="44" height="44" />
          <p className="eyebrow">Zobba · Pair</p>
          <h1 ref={heading} data-focus="workspace-heading" tabIndex={-1}>Your work starts here</h1>
          <p className="intro-copy">Sign in to open the engagements assigned to you.</p>
          {view.message ? <p className="notice" role="status">{view.message}</p> : null}
          <a className="primary-link" data-focus="sign-in" href="/api/auth/login">Sign in to Zobba <OpenArrow /></a>
          <p className="scope-note">Your organisation manages access to client work.</p>
        </section> : null}
        {view.kind === 'unavailable' ? <section className="intro">
          <p className="eyebrow">Zobba · Pair</p><h1 ref={heading} data-focus="workspace-heading" tabIndex={-1}>Connection interrupted</h1>
          <p className="intro-copy" role="alert">{view.message}</p>
          <button className="retry-button" data-focus="retry" type="button" aria-disabled={busy}
            onClick={() => void (view.action === 'logout' ? signOut() : refresh(true, true))}>
            {view.action === 'logout' ? 'Try signing out again' : 'Try again'}</button>
        </section> : null}
        {view.kind === 'ready' && busy ? <div className="intro" role="status">Checking current access…</div> : null}
        {view.kind === 'ready' ? <div className="protected-workspace" hidden={busy}>
          {view.message ? <p className="notice" role="status">{view.message}</p> : null}
          <MethodologyWorkspace active={methodologyOpen} key={`${view.session.identity.id}/${view.session.csrf_token}`} session={view.session} accessReady={!busy && methodologyOpen} onAccessFailure={accessFailure} onClose={() => { setMethodologyOpen(false); requestAnimationFrame(() => methodologyOpener.current?.focus()); }} />
          <div className="retained-workspace" hidden={methodologyOpen}>
          {view.selected ? <>
            <div className="engagement-heading-row">
            <button className="back-button" data-focus="all-engagements" type="button" onClick={() => select(null)}>← All engagements</button>
            <div className="intro"><p className="eyebrow">{view.selected.organisation_name} / {view.selected.client_name}</p>
              <h1 ref={heading} data-focus="workspace-heading" tabIndex={-1}>{view.selected.engagement_name}</h1>
            </div>
            <details className="scope-panel compact-scope">
              <summary>Current scope</summary>
              <div className="scope-popover">
              <h2 id="scope-title">Current scope</h2>
              <dl><div><dt>Organisation</dt><dd>{view.selected.organisation_name}</dd></div>
                <div><dt>Client</dt><dd>{view.selected.client_name}</dd></div>
                <div><dt>Engagement</dt><dd>{view.selected.engagement_name}</dd></div>
                <div><dt>Your role</dt><dd>{view.selected.roles.map(roleLabel).join(' · ')}</dd></div></dl>
              <p className="scope-note">Access is checked against your current assignment.</p>
              </div>
            </details>
            </div>
            <EvidenceWorkspace engagement={view.selected} session={view.session} accessReady={!busy} onAccessFailure={accessFailure} onProjectionUsable={evidenceProjectionStatus}>
            {(onOpenTask) => <ConversationWorkspace onOpenTask={onOpenTask} key={`${view.session.identity.id}/${view.selected!.organisation_id}/${view.selected!.client_id}/${view.selected!.engagement_id}`}
              engagement={view.selected!} session={view.session} accessReady={!busy}
              onAccessFailure={accessFailure} onAccessStable={accessStable} onProjectionUsable={projectionStatus} />}
            </EvidenceWorkspace>
          </> : <>
            <div className="intro"><p className="eyebrow">Zobba · Pair</p><h1 ref={heading} data-focus="workspace-heading" tabIndex={-1}>Your engagements</h1>
              <p className="intro-copy">Choose the client work you want to open.</p></div>
            {view.page.engagements.length > 0 ? <ul className="engagement-list" aria-label="Assigned engagements">
              {view.page.engagements.map((engagement) => <li key={`${engagement.organisation_id}/${engagement.client_id}/${engagement.engagement_id}`}>
                <button className="engagement-card" data-focus={`engagement-${engagement.organisation_id}/${engagement.client_id}/${engagement.engagement_id}`} type="button" onClick={() => select(engagement)}>
                  <span className="engagement-context">{engagement.organisation_name} <span aria-hidden="true">/</span> {engagement.client_name}</span>
                  <span className="engagement-title">{engagement.engagement_name}<OpenArrow /></span>
                  <span className="engagement-role">{engagement.roles.map(roleLabel).join(' · ')}</span>
                </button>
              </li>)}
            </ul> : <section className="empty-panel"><h2>No assigned engagements</h2><p>You are signed in, but you do not currently have access to any client work. Contact your organisation administrator if you need an assignment.</p></section>}
            {view.pageNumber > 1 || view.page.next_cursor ? <nav className="pagination" aria-label="Engagement pages">
              {view.pageNumber > 1 ? <button className="quiet-button" data-focus="previous-page" type="button" onClick={() => changePage(null)}>Previous page</button> : null}
              <span>Page {view.pageNumber}</span>
              {view.page.next_cursor ? <button className="quiet-button" data-focus="next-page" type="button" onClick={() => changePage(view.page.next_cursor)}>Next page</button> : null}
            </nav> : null}
          </>}
          </div>
          <div className="access-footer"><span>Showing your current access</span><a href="/membership">Membership administration</a><button type="button" className="text-button" onClick={() => setMethodologyOpen(true)}>Methodology settings</button><button type="button" className="quiet-button" data-focus="refresh-access" aria-disabled={busy} onClick={() => void refresh(false, true)}>Refresh access</button></div>
        </div> : null}
      </main>
    </div>
  </div>;
}

export function App() {
  const [incomingInvitation, setIncomingInvitation] = useState(hasIncomingInvitation);
  useEffect(() => {
    const receive = () => {
      if (!location.hash.startsWith('#invitation=') || location.pathname === '/membership' || incomingInvitation) return;
      captureIncomingInvitation(); setIncomingInvitation(true);
    };
    window.addEventListener('hashchange', receive);
    window.addEventListener('popstate', receive);
    return () => { window.removeEventListener('hashchange', receive); window.removeEventListener('popstate', receive); };
  }, [incomingInvitation]);
  if (location.pathname === '/status') return <HealthPage />;
  if (location.pathname === '/membership' || incomingInvitation) return <MembershipWorkspace invitation={incomingInvitation} />;
  return <PairWorkspace />;
}
