import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AccessError, readSession } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope, readEngagement, sameScope } from './engagements.ts';
import type { Engagement, Scope } from './engagements.ts';
import { identifier, parseCommand, postCommand, readConversation, readEvents, readHistory, readTask, readTasks } from './conversation.ts';
import type { ConversationMessage, ConversationSnapshot, Task, TaskCommand } from './conversation.ts';

import { LegacyRecoveryError, OutboxStore } from './conversation-outbox.ts';
import type { OutboxItem } from './conversation-outbox.ts';
export { OutboxStore, OUTBOX_LIMIT, ORDINARY_OUTBOX_LIMIT, GLOBAL_OUTBOX_LIMIT, STORAGE_KEY_SCAN_LIMIT } from './conversation-outbox.ts';
export type { OutboxItem } from './conversation-outbox.ts';
function isControl(command: TaskCommand): boolean { return command.kind === 'pause' || command.kind === 'stop'; }
export function sameMeaning(command: TaskCommand, message: ConversationMessage): boolean {
  return command.key === message.key && command.kind === message.kind &&
    (command.task_id ?? null) === message.target_task_id && (command.cycle_id ?? null) === message.target_cycle_id &&
    (command.content ?? null) === message.content;
}

export type ConversationState = {
  tasks: Task[]; messages: ConversationMessage[]; pending: OutboxItem[];
  connection: 'loading' | 'connected' | 'reconnecting' | 'resyncing' | 'unavailable';
  latestActivity: { cursor: string; task_id: string } | null;
  error: string | null; hasEarlier: boolean; hasMoreTasks: boolean; sending: boolean;
};
const READ_FAILURE_MESSAGE = 'Conversation unavailable. Your draft is retained; reconnect to verify current work.';
const emptyState = (): ConversationState => ({ tasks: [], messages: [], pending: [], connection: 'loading',
  latestActivity: null, error: null, hasEarlier: false, hasMoreTasks: false, sending: false });

type Dependencies = {
  store?: OutboxStore; initialSession?: Session; session?: typeof readSession; engagement?: typeof readEngagement;
  snapshot?: typeof readConversation; events?: typeof readEvents; history?: typeof readHistory;
  tasks?: typeof readTasks; task?: typeof readTask; post?: typeof postCommand; uuid?: () => string;
};
/** One lifetime is bound to one verified actor and composite scope. Every completion is fenced. */
export class ConversationController {
  private state = emptyState();
  private readonly operationNotices = new Map<string, string>();
  private readUnavailable = false;
  private inspectionRevision = 0;
  private projectionRevision = 0;
  private storageRefresh: object | null = null;
  private outboxRevision = 0;
  private stopObserving: (() => void) | null = null;
  private readonly deliveries = new Map<string, { command: TaskCommand; received: boolean }>();
  private readonly knownReceipts = new Map<string, TaskCommand>();
  private readonly listeners = new Set<() => void>();
  private readonly actor: string;
  private readonly scope: Scope;
  private readonly store: OutboxStore;
  private readonly dependencies: Required<Omit<Dependencies, 'store' | 'initialSession'>>;
  private readonly accessFailure: (error?: AccessError) => void;
  private verifiedSession: Session | null;
  private generation = 0;
  private active = false;
  private requests = new Set<AbortController>();
  private mutations = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private revision = 0;
  private watermark: string | null = null;
  private historyWatermark: string | null = null;
  private before: string | null = null;
  private nextTask: string | null = null;
  private historical = false;
  private taskPaged = false;
  private taskAfter: string | null = null;
  constructor(actor: string, scope: Scope, accessFailure: (error?: AccessError) => void, dependencies: Dependencies = {}) {
    this.actor = identifier(actor); this.scope = { ...parseScope(scope) }; this.accessFailure = accessFailure;
    this.verifiedSession = dependencies.initialSession ?? null;
    this.store = dependencies.store ?? new OutboxStore(actor, scope);
    this.dependencies = { session: dependencies.session ?? readSession, engagement: dependencies.engagement ?? readEngagement,
      snapshot: dependencies.snapshot ?? readConversation, events: dependencies.events ?? readEvents,
      history: dependencies.history ?? readHistory, tasks: dependencies.tasks ?? readTasks, task: dependencies.task ?? readTask,
      post: dependencies.post ?? postCommand, uuid: dependencies.uuid ?? (() => crypto.randomUUID()) };
  }
  getSnapshot = (): ConversationState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(next: Partial<ConversationState>): void {
    this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener());
  }
  private noticeError(): string | null {
    return this.readUnavailable ? READ_FAILURE_MESSAGE : [...this.operationNotices.values()].at(-1) ?? null;
  }
  private notice(key: string, message: string | null): void {
    this.operationNotices.delete(key);
    if (message !== null) this.operationNotices.set(key, message);
    this.update({ error: this.noticeError() });
  }
  private clearOperationNotices(key: string): void {
    for (const kind of ['command', 'storage-retry', 'storage-dismissal', 'storage-cleanup']) this.operationNotices.delete(`${kind}:${key}`);
  }
  private rememberReceipt(command: TaskCommand): void {
    this.knownReceipts.set(command.key, command); this.clearOperationNotices(command.key);
    this.update({ pending: this.state.pending.map(item => item.key === command.key ? { ...item, status: 'received' } : item), error: this.noticeError() });
  }
  private connectedStatus(): Pick<ConversationState, 'connection' | 'error'> {
    this.readUnavailable = false;
    return { connection: 'connected', error: this.noticeError() };
  }
  private current(generation: number): boolean { return this.active && this.generation === generation; }
  setSession(session: Session): void {
    if (session.identity.id !== this.actor) { this.setAccess(false); return; }
    this.verifiedSession = session;
  }
  dispose(): void {
    this.setAccess(false);
    this.store.close();
  }
  setAccess(ready: boolean, preserveHidden = false): void {
    this.generation++; this.active = ready; this.revision++; this.inspectionRevision++;
    this.storageRefresh = null; this.outboxRevision++; this.deliveries.clear();
    this.stopObserving?.(); this.stopObserving = null;
    this.requests.forEach(controller => controller.abort()); this.requests.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.polling = false; this.mutations.clear();
    this.watermark = null;
    if (!preserveHidden) {
      this.historyWatermark = null; this.before = null; this.nextTask = null;
      this.historical = false; this.taskPaged = false; this.taskAfter = null;
      this.state = emptyState(); this.operationNotices.clear(); this.readUnavailable = false;
      this.knownReceipts.clear();
    } else this.state = { ...this.state, connection: 'loading', sending: false };
    this.listeners.forEach(listener => listener());
    if (!ready) return;
    this.stopObserving = this.store.subscribe(this.observeOutbox);
    void this.reconcile([]);
    void this.poll();
  }
  private async request<T>(operation: (signal: AbortSignal) => Promise<T>, lifetime?: AbortSignal): Promise<T> {
    const controller = new AbortController(); this.requests.add(controller);
    const abort = () => controller.abort();
    lifetime?.addEventListener('abort', abort, { once: true });
    if (lifetime?.aborted) controller.abort();
    const timeout = setTimeout(abort, 8000);
    try {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      return await operation(controller.signal);
    } finally { clearTimeout(timeout); lifetime?.removeEventListener('abort', abort); this.requests.delete(controller); }
  }
  private failed(error: unknown, generation: number): void {
    if (!this.current(generation)) return;
    if (error instanceof AccessError && [401, 403, 404, 412].includes(error.status)) {
      this.setAccess(false); this.accessFailure(error); return;
    }
    // Server projections are withdrawn when their current audience cannot be verified.
    this.watermark = null; this.historical = false; this.taskPaged = false; this.taskAfter = null;
    this.readUnavailable = true;
    this.update({ tasks: [], messages: [], latestActivity: null, connection: 'reconnecting', hasEarlier: false, hasMoreTasks: false,
      error: this.noticeError() });
  }
  private async reconcile(messages: ConversationMessage[]): Promise<void> {
    if (!this.active) return;
    const generation = this.generation, revision = ++this.outboxRevision;
    // Capture exact receipt evidence before asynchronous persistence work, so a
    // late POST error cannot downgrade a receipt already disclosed by this read.
    for (const delivery of this.deliveries.values()) {
      if (messages.some(message => message.author_id === this.actor && sameMeaning(delivery.command, message))) {
        delivery.received = true; this.rememberReceipt(delivery.command);
      }
    }
    for (const item of this.state.pending) {
      if (messages.some(message => message.author_id === this.actor && sameMeaning(item.command, message))) this.rememberReceipt(item.command);
    }
    try {
      const rows = await this.store.reconcile(messages);
      if (!this.current(generation) || revision !== this.outboxRevision) return;
      const pending = rows.map(item => this.knownReceipts.has(item.key) ? { ...item, status: 'received' as const } :
        this.mutations.has(item.key) ? { ...item, status: 'sending' as const } : item);
      for (const key of this.knownReceipts.keys()) if (!rows.some(item => item.key === key)) this.knownReceipts.delete(key);
      for (const item of this.state.pending) {
        if (!pending.some(next => next.key === item.key) && !this.mutations.has(item.key)) this.clearOperationNotices(item.key);
      }
      this.operationNotices.delete('storage-read'); this.operationNotices.delete('storage-update');
      this.update({ pending, error: this.noticeError(), sending: pending.some(item => item.status === 'sending' && !isControl(item.command)) });
    } catch (error) {
      if (this.current(generation) && revision === this.outboxRevision) this.notice('storage-update', error instanceof LegacyRecoveryError ? error.message : 'Recovery storage could not be updated. Retained requests remain safe to retry with their original key.');
    }
  }
  observeOutbox = (): void => {
    if (!this.active || this.storageRefresh) return;
    const generation = this.generation, refresh = {};
    this.storageRefresh = refresh;
    queueMicrotask(() => {
      if (this.storageRefresh !== refresh) return;
      this.storageRefresh = null;
      if (this.current(generation)) void this.reconcile(this.state.messages);
    });
  };
  private acceptSnapshot(snapshot: ConversationSnapshot, page: Awaited<ReturnType<typeof readTasks>> | null = null): void {
    this.watermark = snapshot.watermark; this.projectionRevision++;
    const patch: Partial<ConversationState> = { ...this.connectedStatus(), latestActivity: snapshot.latest_activity };
    if (!this.historical) {
      this.historyWatermark = snapshot.watermark; this.before = snapshot.before_cursor;
      patch.messages = snapshot.messages; patch.hasEarlier = this.before !== null;
    }
    if (page) {
      this.nextTask = page.next_cursor; patch.tasks = page.tasks; patch.hasMoreTasks = page.next_cursor !== null;
    } else if (!this.taskPaged) {
      this.nextTask = snapshot.next_task_cursor; patch.tasks = snapshot.tasks; patch.hasMoreTasks = this.nextTask !== null;
    }
    this.update(patch); void this.reconcile(snapshot.messages);
  }
  private schedule(): void {
    if (!this.active || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, 2000);
  }
  private async poll(): Promise<void> {
    if (!this.active || this.polling) return;
    this.polling = true;
    const generation = this.generation, revision = this.revision;
    try {
      let changed = this.watermark === null;
      if (this.watermark !== null) {
        const events = await this.request(signal => this.dependencies.events(this.scope, this.watermark!, signal, this.verifiedSession));
        if (!this.current(generation) || revision !== this.revision) return;
        changed = events.resync_required || events.events.length > 0;
        if (events.resync_required || events.has_more) this.update({ connection: 'resyncing' });
      }
      if (changed) {
        const after = this.taskAfter;
        const snapshot = await this.request(signal => this.dependencies.snapshot(this.scope, signal, this.verifiedSession));
        if (!this.current(generation) || revision !== this.revision) return;
        // A later page has no watermark of its own. Start its read only after
        // the snapshot completes, so it cannot precede the cursor we will install.
        const page = this.taskPaged && after !== null
          ? await this.request(signal => this.dependencies.tasks(this.scope, after, signal, this.verifiedSession)) : null;
        if (!this.current(generation) || revision !== this.revision) return;
        this.acceptSnapshot(snapshot, page);
      } else this.update(this.connectedStatus());
    } catch (error) { if (this.current(generation) && revision === this.revision) { this.watermark = null; this.failed(error, generation); } }
    finally { if (this.current(generation)) { this.polling = false; this.schedule(); } }
  }
  resync = (): void => { this.refreshProjection(true); };
  private refreshProjection(resetTaskPage: boolean): void {
    if (!this.active) return;
    this.revision++; this.watermark = null; this.historical = false;
    if (resetTaskPage) { this.taskPaged = false; this.taskAfter = null; }
    this.update({ connection: 'resyncing' });
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    // At most one poll runs. An obsolete poll schedules the new snapshot when it settles.
    void this.poll();
  }
  loadEarlier = async (): Promise<void> => {
    if (!this.active || this.before === null || this.historyWatermark === null) return;
    const generation = this.generation, revision = ++this.revision;
    const before = this.before, through = this.historyWatermark;
    try {
      const page = await this.request(signal => this.dependencies.history(this.scope, through, before, signal, this.verifiedSession));
      if (!this.current(generation) || revision !== this.revision) return;
      this.historical = true; this.before = page.before_cursor;
      this.update({ messages: page.messages, hasEarlier: this.before !== null }); void this.reconcile(page.messages);
    } catch (error) { if (revision === this.revision) this.failed(error, generation); }
  };
  loadTaskPage = async (): Promise<void> => {
    if (!this.active || this.nextTask === null) return;
    const generation = this.generation, revision = ++this.revision, after = this.nextTask;
    try {
      const page = await this.request(signal => this.dependencies.tasks(this.scope, after, signal, this.verifiedSession));
      if (!this.current(generation) || revision !== this.revision) return;
      this.taskPaged = true; this.taskAfter = after; this.nextTask = page.next_cursor; this.projectionRevision++;
      this.update({ tasks: page.tasks, hasMoreTasks: this.nextTask !== null });
    } catch (error) { if (revision === this.revision) this.failed(error, generation); }
  };
  openTask = async (id: string, lifetime?: AbortSignal): Promise<Task | null> => {
    if (!this.active || lifetime?.aborted) return null;
    const generation = this.generation, revision = this.revision, projection = this.projectionRevision;
    const inspection = ++this.inspectionRevision;
    const current = () => this.current(generation) && revision === this.revision && projection === this.projectionRevision &&
      inspection === this.inspectionRevision && !lifetime?.aborted;
    try {
      const task = await this.request(signal => this.dependencies.task(this.scope, id, signal, this.verifiedSession), lifetime);
      return current() ? task : null;
    } catch (error) { if (current()) this.failed(error, generation); return null; }
  };
  submit = async (input: Omit<TaskCommand, 'key'>, onPersisted?: (key: string) => void): Promise<boolean> => {
    if (!this.active) return false;
    const generation = this.generation;
    let item: OutboxItem;
    try { item = await this.store.reserve(parseCommand({ ...input, key: this.dependencies.uuid() })); }
    catch (error) {
      if (this.current(generation)) this.notice('submission', error instanceof LegacyRecoveryError ? error.message : 'Not sent. Check the content and recovery storage; the exact request must be saved before sending.');
      return false;
    }
    // Successful persistence is the handoff even if access changed while the
    // storage lock was pending. Never transmit under that obsolete generation.
    onPersisted?.(item.key);
    if (this.active) void this.reconcile(this.state.messages);
    if (!this.current(generation)) return true;
    this.notice('submission', null);
    await this.deliver(item, false);
    return true;
  };
  control = async (task: Task, kind: 'pause' | 'resume' | 'stop' | 'continue'): Promise<boolean> => {
    return this.submit({ kind, task_id: task.id, cycle_id: task.cycle_id, content: null });
  };
  retry = async (key: string): Promise<boolean> => {
    if (!this.active) return false;
    const generation = this.generation;
    try {
      const item = (await this.store.read()).find(item => item.key === key);
      if (!this.current(generation)) return false;
      this.notice(`storage-retry:${key}`, null);
      if (!item) return false;
      if (this.knownReceipts.has(key)) return this.cleanupReceipt(item, generation);
      return await this.deliver(item, true);
    } catch {
      if (this.current(generation)) this.notice(`storage-retry:${key}`, 'Not sent. The saved recovery request could not be verified.');
      return false;
    }
  };
  private async cleanupReceipt(item: OutboxItem, generation: number): Promise<boolean> {
    if (!this.current(generation) || JSON.stringify(this.knownReceipts.get(item.key)) !== JSON.stringify(item.command)) return false;
    try {
      await this.store.remove(item.key);
      if (!this.current(generation)) return false;
      this.knownReceipts.delete(item.key); this.clearOperationNotices(item.key);
      await this.reconcile([]);
      return true;
    } catch {
      if (this.current(generation)) this.notice(`storage-cleanup:${item.key}`, 'Request received. Recovery cleanup is pending.');
      return false;
    }
  }
  acknowledgeRefusal = async (key: string): Promise<void> => {
    if (!this.active) return;
    const generation = this.generation;
    try {
      const item = (await this.store.read()).find(item => item.key === key);
      if (!this.current(generation)) return;
      if (!item) { this.notice(`storage-dismissal:${key}`, null); await this.reconcile([]); return; }
      if (item.status !== 'conflict' || this.mutations.has(key)) return;
      await this.store.remove(key);
      if (!this.current(generation)) return;
      this.clearOperationNotices(key); await this.reconcile([]);
    } catch {
      if (this.current(generation)) this.notice(`storage-dismissal:${key}`, 'The refused request could not be dismissed from recovery storage.');
    }
  };
  private async deliver(item: OutboxItem, retry: boolean): Promise<boolean> {
    if (!this.active || this.mutations.has(item.key) || item.actor_id !== this.actor || !sameScope(item.scope, this.scope)) return false;
    const generation = this.generation;
    const delivery = { command: item.command, received: false };
    this.deliveries.set(item.key, delivery);
    this.notice(`command:${item.key}`, null);
    this.mutations.add(item.key); this.update({ sending: [...this.mutations].some(key => this.state.pending.some(pending => pending.key === key && !isControl(pending.command))) });
    void this.reconcile([]);
    try {
      // Reserved controls freshly authorize session, actor, CSRF and membership
      // before idempotency lookup on the server. No ordinary read can hold that lane.
      const session = (!retry || ['guide', 'pause', 'stop'].includes(item.command.kind)) && this.verifiedSession ? this.verifiedSession : await this.request(async signal => {
        const session = await this.dependencies.session(signal);
        if (session.identity.id !== this.actor) throw new AccessError(412);
        await this.dependencies.engagement(this.scope, signal, session);
        return session;
      });
      if (!this.current(generation)) return false;
      if (session.identity.id !== this.actor) { this.setAccess(false); this.accessFailure(new AccessError(412)); return false; }
      // Re-read exact persisted meaning immediately before transmission; never take retry content from the editor.
      const stored = (await this.store.read()).find(pending => pending.key === item.key);
      if (!this.current(generation)) return false;
      if (delivery.received) return true;
      if (!stored || JSON.stringify(stored.command) !== JSON.stringify(item.command)) throw new Error('Pending request changed');
      if (this.knownReceipts.has(item.key)) return await this.cleanupReceipt(stored, generation);
      await this.store.save(stored.command);
      if (!this.current(generation)) return false;
      if (delivery.received) return true;
      await this.request(signal => this.dependencies.post(this.scope, session, stored.command, signal));
      if (!this.current(generation)) return false;
      delivery.received = true;
      this.rememberReceipt(stored.command);
      await this.cleanupReceipt(stored, generation);
      if (this.current(generation)) this.refreshProjection(false);
      return true;
    } catch (error) {
      if (!this.current(generation)) return false;
      if (error instanceof AccessError && [401, 403, 404, 412].includes(error.status)) { this.setAccess(false); this.accessFailure(error); return false; }
      if (delivery.received) return true;
      if (error instanceof AccessError && error.status === 409) {
        try { await this.store.save(item.command, 'conflict'); } catch { /* Original uncertain bytes remain available. */ }
        if (!this.current(generation)) return false;
        if (delivery.received) return true;
        this.notice(`command:${item.key}`, 'Request refused: its exact target or meaning conflicts with current work. Check the task before creating a new request.');
      } else this.notice(`command:${item.key}`, 'Receipt unconfirmed. The exact request is saved; retry it to recover the original receipt.');
      return false;
    } finally {
      if (this.current(generation)) {
        this.mutations.delete(item.key); this.deliveries.delete(item.key); await this.reconcile([]);
      }
    }
  }
}

export function useConversation(options: { engagement: Engagement; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void }) {
  const { engagement, session, accessReady } = options;
  const failure = useRef(options.onAccessFailure); failure.current = options.onAccessFailure;
  const controller = useMemo(() => new ConversationController(session.identity.id, engagement, error => failure.current(error), { initialSession: session }),
    [session.identity.id, engagement.organisation_id, engagement.client_id, engagement.engagement_id]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { controller.setSession(session); }, [controller, session]);
  useEffect(() => { controller.setAccess(accessReady, true); return () => controller.setAccess(false, true); }, [controller, accessReady]);
  useEffect(() => () => controller.dispose(), [controller]);
  // Workspace keeps these nodes hidden while accessReady is false, preserving focus
  // and draft selection. Failed reads clear state; actor/scope changes create a new controller.
  return { ...state, submit: controller.submit, control: controller.control, retry: controller.retry, acknowledgeRefusal: controller.acknowledgeRefusal, openTask: controller.openTask,
    loadEarlier: controller.loadEarlier, loadTaskPage: controller.loadTaskPage, resync: controller.resync };
}
