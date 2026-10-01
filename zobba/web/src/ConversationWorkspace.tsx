import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AccessError, Session } from './auth';
import type { Engagement } from './engagements';
import type { ConversationMessage, Task, TaskCommand } from './conversation';
import { useConversation } from './conversation-state';

interface WorkspaceProps {
  engagement: Engagement;
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
  onAccessStable: () => void;
  onProjectionUsable: (usable: boolean) => void;
  onOpenTask?: () => void;
}

type Target = { kind: 'create' } | { kind: 'guide'; task_id: string; cycle_id: string; objective: string };
type Control = 'pause' | 'resume' | 'stop' | 'continue';

export function taskStateLabel(task: Task): string {
  if (task.cessation === 'reconciliation_required') return 'Activity unresolved';
  if (task.state === 'paused') return task.cessation === 'confirmed' ? 'Paused' : 'Pausing';
  if (task.state === 'stopped') return task.cessation === 'confirmed' ? 'Stopped' : 'Stopping';
  if (task.state === 'running') return 'Foundation activity';
  if (task.state === 'ready') return 'Ready for foundation activity';
  return 'Waiting';
}

function stateExplanation(task: Task): string {
  if (task.cessation === 'reconciliation_required') return 'Activity may have been attempted. Its outcome is unconfirmed and needs reconciliation. It will not be replayed automatically.';
  if (task.state === 'paused') return task.cessation === 'confirmed'
    ? 'This Task and its activity are paused. The objective and working brief are retained. Resume keeps this work cycle.'
    : 'Pause was received. Waiting for this Task’s activity to be confirmed quiet. Other Tasks continue.';
  if (task.state === 'stopped') return task.cessation === 'confirmed'
    ? 'This work cycle is stopped. The objective and working brief are retained. Continue starts a new work cycle.'
    : 'Stop was received. Waiting for this Task’s activity to cease or its outcome to be reconciled. Other Tasks continue.';
  if (task.state === 'waiting') return 'The bounded foundation activity has ended. The audit objective is not complete.';
  return 'Only bounded foundation activity is available. No model, audit evaluation or computer work is running.';
}

function messageTitle(message: ConversationMessage): string {
  return { create: 'New Task', guide: 'Guidance', pause: 'Pause requested', resume: 'Resume requested', stop: 'Stop requested', continue: 'New work cycle requested' }[message.kind];
}

function targetKey(target: Target): string {
  return target.kind === 'create' ? 'create' : `${target.task_id}:${target.cycle_id}`;
}
function cycleLabel(id: string): string { return id.slice(0, 8); }

export function ConversationWorkspace({ engagement, session, accessReady, onAccessFailure, onAccessStable, onProjectionUsable, onOpenTask }: WorkspaceProps) {
  const conversation = useConversation({ engagement, session, accessReady, onAccessFailure });
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<Target>({ kind: 'create' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Task | null>(null);
  const [pinned, setPinned] = useState(false);
  const [following, setFollowing] = useState(true);
  const [view, setView] = useState<'conversation' | 'workspace'>('conversation');
  const [expanded, setExpanded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const historyPane = useRef<HTMLDivElement>(null);
  const inspectionHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openGeneration = useRef(0);
  const draftGeneration = useRef(0);
  const submittingDraft = useRef(false);
  const focusInspection = useRef(false);
  const pendingScroll = useRef<string | null>(null);
  const projectionReady = accessReady && !['loading', 'reconnecting', 'unavailable'].includes(conversation.connection);
  const retainingProjection = !accessReady || conversation.connection === 'loading';
  const selected = retainingProjection || projectionReady ? conversation.tasks.find((task) => task.id === selectedId) ?? inspected : null;
  const scopeLabel = `${engagement.organisation_name} / ${engagement.client_name} / ${engagement.engagement_name}`;
  const targetTask = target.kind === 'guide' ? conversation.tasks.find((task) => task.id === target.task_id) ?? (inspected?.id === target.task_id ? inspected : null) : null;
  const targetIsCurrent = target.kind === 'create' || !targetTask || targetTask.cycle_id === target.cycle_id;
  const staleTargetError = !targetIsCurrent ? 'This target belongs to an earlier work cycle. Choose the current Task and cycle before sending.' : null;
  const controlsReady = projectionReady;

  useLayoutEffect(() => { onProjectionUsable(accessReady && conversation.connection !== 'loading'); }, [accessReady, conversation.connection, onProjectionUsable]);
  useLayoutEffect(() => {
    if (accessReady && conversation.connection === 'connected') onAccessStable();
  }, [accessReady, conversation.connection, onAccessStable]);

  useLayoutEffect(() => {
    if (focusInspection.current && accessReady && selectedId) {
      inspectionHeading.current?.focus();
      focusInspection.current = false;
    }
  }, [accessReady, selectedId]);

  useEffect(() => {
    const activity = conversation.latestActivity;
    // Follow advances only from a newer durable receipt, never from the order of
    // a history page. It changes inspected work without changing keyboard focus
    // or the independently chosen composer target.
    if (projectionReady && following && selectedId && activity && activity.task_id !== selectedId) {
      setInspected(null); setSelectedId(activity.task_id);
    }
  }, [projectionReady, conversation.latestActivity, following, selectedId]);

  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    if (!pending || !accessReady) return;
    const received = conversation.messages.some(message => message.author_id === session.identity.id && message.key === pending);
    if (received || conversation.pending.some(item => item.key === pending)) {
      historyPane.current?.scrollTo({ top: historyPane.current.scrollHeight, behavior: 'instant' });
      // One persisted submission earns one scroll. Later receipts, storage events
      // or a deliberately opened history page must not keep moving the viewport.
      pendingScroll.current = null;
    }
  }, [accessReady, conversation.messages, conversation.pending, session.identity.id]);

  // Opening is independent of the bounded current Task page. Fenced callbacks
  // cannot restore an earlier selection or protected content after withdrawal.
  useEffect(() => {
    if (!accessReady) { openGeneration.current += 1; return; }
    if (!projectionReady) { if (conversation.connection !== 'loading') setInspected(null); openGeneration.current += 1; return; }
    if (!selectedId) return;
    const current = conversation.tasks.find((task) => task.id === selectedId);
    if (current) { setInspected(current); return; }
    const generation = ++openGeneration.current;
    const request = new AbortController();
    void conversation.openTask(selectedId, request.signal).then((task) => {
      if (!request.signal.aborted && generation === openGeneration.current && task) setInspected(task);
    });
    return () => { request.abort(); };
  }, [accessReady, projectionReady, conversation.connection, selectedId, conversation.tasks, conversation.openTask]);

  const owner = (task: Task) => task.accountable_label;

  function openTask(id: string, source?: HTMLElement) {
    onOpenTask?.();
    openGeneration.current += 1;
    opener.current = source ?? document.activeElement as HTMLElement;
    focusInspection.current = true;
    setSelectedId(id); setPinned(false); setFollowing(false); setView('workspace'); setExpanded(false);
    const known = conversation.tasks.find((task) => task.id === id);
    setInspected(known ?? null);
    if (selectedId === id) requestAnimationFrame(() => inspectionHeading.current?.focus());
  }

  function closeInspection() {
    openGeneration.current += 1;
    setSelectedId(null); setInspected(null); setPinned(false); setFollowing(true); setExpanded(false); setView('conversation');
    requestAnimationFrame(() => {
      if (opener.current?.isConnected && opener.current.getClientRects().length) opener.current.focus();
      else textarea.current?.focus();
    });
  }

  async function send() {
    if (!accessReady || conversation.sending || submittingDraft.current || !draft.trim()) return;
    if (!targetIsCurrent) { setLocalError('This target belongs to an earlier work cycle. Choose the current Task and cycle before sending.'); return; }
    const content = draft;
    const generation = draftGeneration.current;
    const command: Omit<TaskCommand, 'key'> = target.kind === 'create'
      ? { kind: 'create', task_id: null, cycle_id: null, content }
      : { kind: 'guide', task_id: target.task_id, cycle_id: target.cycle_id, content };
    setLocalError(null); submittingDraft.current = true;
    try {
      if (await conversation.submit(command, key => { pendingScroll.current = key; }) && draftGeneration.current === generation) setDraft('');
      // Sending never retargets the next draft, even when its acknowledgement
      // creates a new card or returns after the user chooses another target.
    } finally { submittingDraft.current = false; }
  }

  function composeKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); void send();
    }
  }

  const statusText = {
    loading: 'Loading conversation…', connected: 'Conversation up to date', reconnecting: 'Reconnecting · current updates unavailable',
    resyncing: 'Resynchronising conversation…', unavailable: 'Conversation unavailable',
  }[conversation.connection];

  return <section className={`conversation-workspace${selectedId ? ' has-inspection' : ''}${expanded ? ' inspection-expanded' : ''}`}
    aria-label="Engagement conversation" onKeyDown={(event) => {
      if (event.key === 'Escape' && selectedId) { event.preventDefault(); closeInspection(); }
    }}>
    {!accessReady || conversation.connection === 'loading' ? <div className="access-cover" role="status">{!accessReady ? 'Checking current access…' : 'Loading conversation…'}</div> : null}
    <div className="conversation-content" hidden={!accessReady || conversation.connection === 'loading'}>
      <div className="conversation-topline"><div><span className="pair-presence" aria-hidden="true"><img src="/assets/zobba-symbol-color.svg" alt="" width="18" height="18" /></span><h2>Engagement conversation</h2></div>
        <span className="delivery-status" role="status" aria-live="polite">{statusText}</span></div>
      <p className="foundation-notice">Foundation workspace · Tasks and guidance are saved. Model, audit and computer work are not available yet.</p>
      <nav className="conversation-view-tabs" aria-label="Engagement views">
        <button type="button" className="quiet-button" aria-current={view === 'conversation' ? 'page' : undefined} onClick={() => setView('conversation')}>Conversation</button>
        <button type="button" className="quiet-button" aria-current={view === 'workspace' ? 'page' : undefined} onClick={() => setView('workspace')}>Workspace{selectedId ? ' · 1' : ''}</button>
      </nav>
      <div className={`conversation-columns showing-${view}`}>
        <div className="conversation-pane" id="conversation-pane">
          <div ref={historyPane} className="conversation-history" role="region" aria-label="Conversation history" tabIndex={0}>
            <div className="history-navigation">
              {conversation.hasEarlier ? <button type="button" className="text-button" onClick={() => { pendingScroll.current = null; void conversation.loadEarlier(); }}>Earlier messages</button> : null}
              <button type="button" className="text-button" onClick={() => { pendingScroll.current = null; conversation.resync(); }}>Latest messages</button>
            </div>
            {conversation.messages.length === 0 && conversation.connection === 'connected' ? <div className="conversation-empty"><img src="/assets/zobba-symbol-color.svg" alt="" width="32" height="32" /><h3>What would you like to work on?</h3><p>Start a Task with an objective. Add guidance to a named Task whenever you need to.</p><p className="audience-label">Shared with current assigned engagement members.</p></div> : null}
            <ol className="message-list">
              {conversation.messages.map((message) => {
                const task = conversation.tasks.find((item) => item.id === message.task_id);
                return <li key={message.command_id} className="conversation-entry" data-command-id={message.command_id}>
                  <article className="conversation-message" aria-label={`${messageTitle(message)} from ${message.author_label}`}>
                    <div className="message-attribution"><strong>{message.author_label}</strong><span>{messageTitle(message)}</span></div>
                    {message.content ? <p className="message-content">{message.content}</p> : null}
                    <p className="message-target">{message.kind === 'create' ? 'Created Task' : 'For Task'} <span>{task?.objective ?? message.task_id}</span></p>
                    <p className="message-receipt">Received{message.applied_cursor !== null ? message.kind === 'create' || message.kind === 'guide' ? ' · Applied to the plain working brief' : ' · Control applied; cessation is shown on the Task' : message.kind === 'guide' ? ' · Not yet applied to the working brief' : ''}</p>
                    <details className="message-binding"><summary>Attribution and receipt</summary><dl>
                      <div><dt>Audience</dt><dd>Current assigned engagement members</dd></div><div><dt>Scope</dt><dd>{scopeLabel}</dd></div>
                      <div><dt>Author</dt><dd>{message.author_label} · {message.author_id}</dd></div>
                      <div><dt>Task</dt><dd>{message.task_id}</dd></div><div><dt>Work cycle</dt><dd>{message.cycle_id}</dd></div>
                      <div><dt>Command</dt><dd>{message.command_id}</dd></div><div><dt>Receipt</dt><dd>{message.received_cursor}</dd></div>
                    </dl></details>
                  </article>
                  {message.kind === 'create' ? <article className="task-card" aria-label={`Task: ${message.content}`}>
                    <img src="/assets/zobba-symbol-color.svg" alt="" width="20" height="20" />
                    <div className="task-card-body"><h3>{message.content}</h3><p>{message.author_label} · {engagement.client_name} · {engagement.engagement_name}</p>
                      <span className="status-label">{task ? taskStateLabel(task) : 'Open for current state'}</span></div>
                    <button type="button" className="text-button" aria-label={`Open ${message.content}`} onClick={(event) => void openTask(message.task_id, event.currentTarget)}>Open</button>
                  </article> : null}
                </li>;
              })}
            </ol>
            {conversation.pending.length > 0 ? <section className="pending-messages" aria-label="Unconfirmed requests"><h3>Requests to check</h3>
              {conversation.pending.map((item) => <article className="pending-message" key={item.key}>
                <p><strong>{item.command.kind === 'create' ? 'New Task' : item.command.kind === 'guide' ? 'Guidance' : `${item.command.kind.charAt(0).toUpperCase()}${item.command.kind.slice(1)} request`}</strong> · {item.status === 'sending' ? 'Sending' : item.status === 'conflict' ? 'Request refused' : item.status === 'received' ? 'Received · recovery cleanup pending' : 'Delivery unconfirmed'}</p>
                {item.command.content ? <p className="message-content">{item.command.content}</p> : null}
                {item.command.task_id ? <p className="pending-target">Task {item.command.task_id} · cycle {item.command.cycle_id}</p> : null}
                <p>{item.error ?? 'The original request is retained. Check its receipt using the same request key and meaning.'}</p>
                {item.status !== 'conflict' ? <button type="button" className="quiet-button" disabled={item.status === 'sending'} onClick={() => void conversation.retry(item.key)}>{item.status === 'received' ? 'Finish recovery cleanup' : 'Check original request'}</button>
                  : <button type="button" className="quiet-button" onClick={() => conversation.acknowledgeRefusal(item.key)}>Dismiss refusal</button>}
              </article>)}
            </section> : null}
          </div>
          <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <label htmlFor="composer-target">Send to</label>
            <select id="composer-target" data-focus="composer-target" value={targetKey(target)} onChange={(event) => {
              draftGeneration.current += 1;
              if (event.currentTarget.value === 'create') setTarget({ kind: 'create' });
              else {
                const task = conversation.tasks.find((item) => `${item.id}:${item.cycle_id}` === event.currentTarget.value);
                if (task) setTarget({ kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, objective: task.objective });
              }
              setLocalError(null);
            }}>
              <option value="create">New Task</option>
              {target.kind === 'guide' && !conversation.tasks.some((task) => `${task.id}:${task.cycle_id}` === targetKey(target)) ? <option value={targetKey(target)}>Guide: {target.objective} · retained cycle</option> : null}
              {conversation.tasks.map((task) => <option key={`${task.id}:${task.cycle_id}`} value={`${task.id}:${task.cycle_id}`}>Guide: {task.objective} · current cycle {cycleLabel(task.cycle_id)}</option>)}
            </select>
            <label className="composer-input-label" htmlFor="conversation-draft">{target.kind === 'create' ? 'Task objective' : 'Guidance'}</label>
            <textarea ref={textarea} id="conversation-draft" data-focus="conversation-draft" rows={3} value={draft} onChange={(event) => { draftGeneration.current += 1; setDraft(event.currentTarget.value); }} onKeyDown={composeKey}
              placeholder={target.kind === 'create' ? 'What would you like to work on?' : 'Add guidance to this Task…'} aria-describedby="composer-audience composer-delivery" />
            <div className="composer-bottom"><p id="composer-audience">{engagement.client_name} · Current assigned members</p><button type="submit" disabled={!accessReady || conversation.sending || !draft.trim() || !targetIsCurrent}>Send <span aria-hidden="true">↑</span></button></div>
            {target.kind === 'guide' ? <p className="composer-cycle">Guide {target.objective} · cycle <abbr title={target.cycle_id}>{cycleLabel(target.cycle_id)}</abbr></p> : null}
            <p id="composer-delivery" className="composer-help">{draft ? 'Not sent · ' : ''}Enter to send · Shift+Enter for a new line</p>
            {staleTargetError || localError || conversation.error ? <p className="composer-error" role="alert">{staleTargetError ?? localError ?? conversation.error}</p> : null}
          </form>
        </div>
        <aside className="inspection-pane" aria-label="Workspace">
          {selectedId ? <>
            <header className="inspection-header"><div><p className="eyebrow">From Task</p><h2 ref={inspectionHeading} tabIndex={-1}>{selected?.objective ?? 'Loading Task…'}</h2></div>
              <div className="inspection-actions"><button type="button" className="text-button" aria-pressed={pinned} onClick={() => { setPinned(!pinned); setFollowing(false); }}>{pinned ? 'Pinned' : 'Pin'}</button>
                <button type="button" className="text-button expand-inspection" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Reduce' : 'Expand'}</button>
                <button type="button" className="text-button" aria-label="Close inspection" onClick={closeInspection}>Close</button></div></header>
            <div className="inspection-follow"><span>{following ? 'Following Zobba · latest Task receipt' : pinned ? 'Pinned · inspection retained' : 'Inspecting · your selection is retained'}</span>
              {!following ? <button type="button" className="text-button" onClick={() => { setFollowing(true); setPinned(false); }}>Follow Zobba</button> : null}</div>
            {selected ? <><div className="task-detail" role="region" aria-label="Task details" tabIndex={0}>
              <p className="task-detail-scope">{scopeLabel}</p><p className="task-owner">Accountable human · {owner(selected)}</p>
              <div className="task-state"><span className="status-label">{taskStateLabel(selected)}</span><p>{stateExplanation(selected)}</p></div>
              <section className="brief-section"><h3>Original objective</h3><p className="retained-text">{selected.objective}</p></section>
              <section className="brief-section"><h3>Working brief</h3><p className="brief-caption">Plain retained direction. Applied means added here; it does not mean model understanding.</p><p className="retained-text">{selected.working_brief}</p></section>
              <details className="message-binding"><summary>Task and current cycle</summary><dl><div><dt>Task</dt><dd>{selected.id}</dd></div><div><dt>Work cycle</dt><dd>{selected.cycle_id}</dd></div><div><dt>Revision</dt><dd>{selected.revision}</dd></div></dl></details>
            </div>
              <div className="task-controls" aria-label={`Controls for ${selected.objective}`}><p>Controls apply only to this Task and cycle.</p>
                <div>{(['pause', 'stop', 'resume', 'continue'] as Control[]).filter((kind) => kind === 'pause' ? !['paused', 'stopped'].includes(selected.state) : kind === 'stop' ? selected.state !== 'stopped' : kind === 'resume' ? selected.state === 'paused' && selected.cessation === 'confirmed' : selected.state === 'stopped' && selected.cessation === 'confirmed').map((kind) => <button key={kind} type="button" className="quiet-button" disabled={!controlsReady}
                  aria-label={`${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${selected.objective} · current cycle ${cycleLabel(selected.cycle_id)}`} onClick={() => void conversation.control(selected, kind)}>{kind === 'continue' ? 'Continue in new cycle' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} task`}</button>)}</div>
                <button type="button" className="text-button" onClick={() => { draftGeneration.current += 1; setTarget({ kind: 'guide', task_id: selected.id, cycle_id: selected.cycle_id, objective: selected.objective }); setView('conversation'); requestAnimationFrame(() => textarea.current?.focus()); }}>Guide this Task</button>
              </div>
            </> : <p className="empty-work-note" role="status">Current Task details are unavailable. Reconnect to inspect them.</p>}
          </> : <div className="companion-panel"><h2>Active work</h2><p className="shelf-description">Open a Task to inspect its objective, working brief and controls.</p>
            {conversation.tasks.length ? <ul className="active-task-list">{conversation.tasks.map((task) => <li key={task.id}><button type="button" className="task-list-open" onClick={(event) => void openTask(task.id, event.currentTarget)}><span>{task.objective}</span><small>{taskStateLabel(task)} · {owner(task)}</small><span className="open-label">Open</span></button></li>)}</ul> : <p className="empty-work-note">{conversation.connection === 'connected' ? 'No Tasks yet.' : 'Tasks are unavailable until the conversation loads.'}</p>}
            {conversation.hasMoreTasks ? <button type="button" className="text-button" onClick={() => void conversation.loadTaskPage()}>More Tasks</button> : null}
          </div>}
          <section className="work-product-shelf" aria-labelledby="work-products-title"><h2 id="work-products-title">Work products</h2><p>No work products yet.</p><p className="shelf-description">This foundation retains Tasks and guidance. Audit outputs and computer work will appear here when those capabilities are available.</p></section>
        </aside>
      </div>
    </div>
  </section>;
}
