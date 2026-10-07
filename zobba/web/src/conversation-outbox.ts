import { commandContent, identifier, parseCommand, sameTaskContext } from './conversation.ts';
import type { ConversationMessage, TaskCommand } from './conversation.ts';
import { parseScope, sameScope } from './engagements.ts';
import type { Scope } from './engagements.ts';

export type OutboxItem<C extends { key: string } = TaskCommand> = {
  actor_id: string; scope: Scope; key: string; command: C;
  status: 'uncertain' | 'sending' | 'conflict' | 'received'; error?: string;
};
/** An untargeted direction: its whole meaning is the request key and exact text. */
export type DirectionCommand = { key: string; content: string };
type Codec<C extends { key: string }> = { prefix: string; parse: (value: unknown) => C; control: (command: C) => boolean };
const commandCodec: Codec<TaskCommand> = { prefix: '', parse: parseCommand, control: command => isControl(command) };
const directionCodec: Codec<DirectionCommand> = {
  // A distinct binding prefix keeps directions out of the command channel's
  // reads while sharing its durable store, quota and serialized transactions.
  prefix: 'direction:',
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'content,key') throw unavailable();
    return { key: identifier(v.key), content: commandContent(v.content) };
  },
  control: () => false,
};
export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
export const OUTBOX_LIMIT = 8;
export const ORDINARY_OUTBOX_LIMIT = 6;
export const GLOBAL_OUTBOX_LIMIT = 64;
export const STORAGE_KEY_SCAN_LIMIT = 2048;
export const OUTBOX_DATABASE_NAME = 'zobba-conversation-recovery-v2';
export const OUTBOX_STORE_NAME = 'requests';
const channelName = 'zobba:conversation-recovery:changed';
const legacyPrefix = 'zobba:conversation-outbox:v1:';
const memoryQueues = new WeakMap<StorageLike, Promise<unknown>>();
const memoryListeners = new WeakMap<StorageLike, Set<{ binding: string; listener: () => void }>>();

type RecordValue<C extends { key: string } = TaskCommand> = OutboxItem<C> & { id: string; binding: string; ordinary: 0 | 1; version: 1 };
function isControl(command: TaskCommand): boolean { return command.kind === 'pause' || command.kind === 'stop'; }
export function sameMeaning(command: TaskCommand, message: ConversationMessage): boolean {
  return command.key === message.key && command.kind === message.kind &&
    (command.task_id ?? null) === message.target_task_id && (command.cycle_id ?? null) === message.target_cycle_id &&
    (command.content ?? null) === message.content && sameTaskContext(command.context, message.context);
}
function unchanged(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export class LegacyRecoveryError extends Error {
  constructor() { super('Saved requests from an earlier preview need recovery before you can send new ones.'); }
}
function unavailable(): Error { return new Error('Reliable recovery storage is unavailable. Nothing was sent.'); }

/** One durable authority. IndexedDB serializes quota checks and writes across tabs. */
export class OutboxStore<C extends { key: string } = TaskCommand> {
  private readonly codec: Codec<C>;
  private readonly actor: string;
  private readonly scope: Scope;
  private readonly binding: string;
  private readonly memory?: () => StorageLike;
  private opening: Promise<IDBDatabase> | null = null;
  private connection: IDBDatabase | null = null;
  private connectionGeneration = 0;
  constructor(actor: string, scope: Scope, memory?: () => StorageLike, codec?: Codec<C>) {
    this.codec = codec ?? commandCodec as unknown as Codec<C>;
    this.actor = identifier(actor); this.scope = parseScope(scope);
    this.binding = `${this.codec.prefix}${this.actor}/${this.scope.organisation_id}/${this.scope.client_id}/${this.scope.engagement_id}/`;
    this.memory = memory;
  }
  ownsStorageKey(key: string | null): boolean { return key === null || key.startsWith(legacyPrefix + this.binding); }
  private record(command: C, status: 'uncertain' | 'conflict'): RecordValue<C> {
    return { id: this.binding + command.key, binding: this.binding, ordinary: this.codec.control(command) ? 0 : 1,
      version: 1, actor_id: this.actor, scope: { ...this.scope }, key: command.key, command, status };
  }
  private parse(value: unknown): OutboxItem<C> {
    if (!value || typeof value !== 'object') throw unavailable();
    const row = value as RecordValue<C>;
    const command = this.codec.parse(row.command);
    if (row.version !== 1 || row.actor_id !== this.actor || !sameScope(parseScope(row.scope), this.scope) ||
      row.key !== command.key || !['uncertain', 'conflict'].includes(row.status) ||
      row.binding !== this.binding || row.id !== this.binding + command.key || row.ordinary !== (this.codec.control(command) ? 0 : 1)) throw unavailable();
    return { actor_id: this.actor, scope: { ...this.scope }, key: command.key, command, status: row.status,
      ...(row.status === 'conflict' ? { error: 'This exact request was refused. Its target or meaning conflicts with the server.' } : {}) };
  }
  close(): void {
    this.connectionGeneration++; this.opening = null;
    this.connection?.close(); this.connection = null;
  }
  private async database(): Promise<IDBDatabase> {
    if (this.opening) return this.opening;
    const generation = this.connectionGeneration;
    this.opening = new Promise((resolve, reject) => {
      try {
        // This preview format was never shipped. Preserve uncertain old bytes;
        // never silently import, resend, or discard them under a new authority.
        const storage = window.localStorage;
        if (storage.length > STORAGE_KEY_SCAN_LIMIT) throw unavailable();
        for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(legacyPrefix + this.binding)) {
          throw new LegacyRecoveryError();
        }
        const request = indexedDB.open(OUTBOX_DATABASE_NAME, 1);
        let settled = false;
        const deadline = setTimeout(() => { settled = true; reject(unavailable()); }, 8000);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction?.abort(); return; }
          const store = request.result.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
          store.createIndex('binding', 'binding');
          store.createIndex('bindingOrdinary', ['binding', 'ordinary']);
        };
        request.onblocked = () => { settled = true; clearTimeout(deadline); reject(unavailable()); };
        request.onerror = () => { settled = true; clearTimeout(deadline); reject(unavailable()); };
        request.onsuccess = () => {
          clearTimeout(deadline);
          const db = request.result;
          if (settled || generation !== this.connectionGeneration) { db.close(); reject(unavailable()); return; }
          this.connection = db;
          db.onversionchange = () => { db.close(); if (this.connection === db) { this.connection = null; this.opening = null; } };
          db.onclose = () => { if (this.connection === db) { this.connection = null; this.opening = null; } };
          resolve(db);
        };
      } catch (error) { reject(error); }
    });
    try { return await this.opening; }
    catch (error) { if (generation === this.connectionGeneration) this.opening = null; throw error; }
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await this.database();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(OUTBOX_STORE_NAME, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); } catch { reject(unavailable()); return; }
      let result: T, finished = false, failure: unknown;
      const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(error); } };
      const deadline = setTimeout(() => fail(unavailable()), 8000);
      tx.oncomplete = () => { clearTimeout(deadline); if (finished) resolve(result); else reject(unavailable()); };
      tx.onabort = () => { clearTimeout(deadline); reject(failure ?? unavailable()); };
      tx.onerror = () => { failure ??= unavailable(); };
      try { action(tx.objectStore(OUTBOX_STORE_NAME), value => { result = value; finished = true; }, fail); }
      catch (error) { fail(error); }
    });
  }
  private signal(): void {
    if (this.memory) {
      for (const entry of memoryListeners.get(this.memory()) ?? []) if (entry.binding === this.binding) { try { entry.listener(); } catch { /* Notifications cannot undo a committed transaction. */ } }
      return;
    }
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(channelName); channel.postMessage(this.binding); }
    catch { /* A committed recovery record remains the handoff if a signal fails. */ }
    finally { try { channel?.close(); } catch { /* Best effort only. */ } }
  }
  subscribe(listener: () => void): () => void {
    if (this.memory) {
      const storage = this.memory(), entry = { binding: this.binding, listener };
      let listeners = memoryListeners.get(storage);
      if (!listeners) { listeners = new Set(); memoryListeners.set(storage, listeners); }
      listeners.add(entry); return () => { listeners!.delete(entry); };
    }
    if (typeof BroadcastChannel === 'undefined') return () => {};
    try {
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = event => { if (typeof event.data === 'string' && event.data === this.binding) { try { listener(); } catch { /* A later explicit read remains available. */ } } };
      return () => { try { channel.close(); } catch { /* Best effort only. */ } };
    } catch { return () => {}; }
  }
  private async memoryRun<T>(action: (storage: StorageLike) => T): Promise<T> {
    const storage = this.memory!();
    const operation = (memoryQueues.get(storage) ?? Promise.resolve()).catch(() => {}).then(() => action(storage));
    memoryQueues.set(storage, operation); return operation;
  }
  private memoryRows(storage: StorageLike): OutboxItem<C>[] {
    if (storage.length > STORAGE_KEY_SCAN_LIMIT) throw unavailable();
    const result: OutboxItem<C>[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i); if (!key?.startsWith(legacyPrefix + this.binding)) continue;
      if (result.length >= OUTBOX_LIMIT) throw unavailable();
      const raw = storage.getItem(key); if (!raw || raw.length > 32_000) throw unavailable();
      const row = JSON.parse(raw) as OutboxItem<C>;
      result.push(this.parse({ ...row, id: this.binding + row.key, binding: this.binding, ordinary: this.codec.control(this.codec.parse(row.command)) ? 0 : 1 }));
    }
    return result;
  }
  async read(): Promise<OutboxItem<C>[]> {
    if (this.memory) return this.memoryRun(storage => this.memoryRows(storage));
    return this.transaction('readonly', (store, finish, fail) => {
      const request = store.index('binding').getAll(this.binding, OUTBOX_LIMIT + 1);
      request.onsuccess = () => { try {
        if (request.result.length > OUTBOX_LIMIT) throw unavailable();
        finish(request.result.map(row => this.parse(row)));
      } catch (error) { fail(error); } };
    });
  }
  async reserve(input: C): Promise<OutboxItem<C>> {
    const command = this.codec.parse(input), record = this.record(command, 'uncertain');
    const isControl = this.codec.control;
    let result: OutboxItem<C>;
    if (this.memory) result = await this.memoryRun(storage => {
      const own = this.memoryRows(storage), existing = own.find(item => item.key === command.key);
      if (existing) { if (!unchanged(existing.command, command)) throw new Error('A pending key cannot change meaning.'); return existing; }
      let total = 0;
      for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(legacyPrefix)) total++;
      if (own.length >= OUTBOX_LIMIT || !isControl(command) && own.filter(item => !isControl(item.command)).length >= ORDINARY_OUTBOX_LIMIT ||
        total >= (isControl(command) ? GLOBAL_OUTBOX_LIMIT : GLOBAL_OUTBOX_LIMIT - 4)) throw new Error('The recovery outbox is full. Resolve retained requests first.');
      const serialized = JSON.stringify(record); storage.setItem(legacyPrefix + record.id, serialized);
      if (storage.getItem(legacyPrefix + record.id) !== serialized) throw unavailable();
      return this.parse(record);
    });
    else result = await this.transaction('readwrite', (store, finish, fail) => {
      // Every decision and the write share this serialized durable transaction.
      const existing = store.get(record.id);
      const total = store.count();
      const own = store.index('binding').count(this.binding);
      const ownOrdinary = store.index('bindingOrdinary').count([this.binding, 1]);
      let remaining = 4;
      const checked = () => {
        if (--remaining) return;
        try {
          if (existing.result !== undefined) {
            const prior = this.parse(existing.result);
            if (!unchanged(prior.command, command)) throw new Error('A pending key cannot change meaning.');
            finish(prior); return;
          }
          const overLimit = total.result >= GLOBAL_OUTBOX_LIMIT || own.result >= OUTBOX_LIMIT ||
            !isControl(command) && (total.result >= GLOBAL_OUTBOX_LIMIT - 4 || ownOrdinary.result >= ORDINARY_OUTBOX_LIMIT);
          if (overLimit) throw new Error('The recovery outbox is full. Resolve retained requests first.');
          store.add(record); finish(this.parse(record));
        } catch (error) { fail(error); }
      };
      for (const request of [existing, total, own, ownOrdinary]) request.onsuccess = checked;
    });
    this.signal(); return result;
  }
  async save(input: C, status: 'uncertain' | 'conflict' = 'uncertain'): Promise<OutboxItem<C>> {
    const command = this.codec.parse(input), record = this.record(command, status);
    const update = (prior: OutboxItem<C> | undefined) => {
      if (!prior || !unchanged(prior.command, command)) throw new Error('The retained request no longer exists or changed meaning.');
      return this.parse(record);
    };
    let result: OutboxItem<C>;
    if (this.memory) result = await this.memoryRun(storage => {
      const value = update(this.memoryRows(storage).find(item => item.key === command.key));
      storage.setItem(legacyPrefix + record.id, JSON.stringify(record)); return value;
    });
    else result = await this.transaction('readwrite', (store, finish, fail) => {
      const request = store.get(record.id);
      request.onsuccess = () => { try { const value = update(request.result === undefined ? undefined : this.parse(request.result)); store.put(record); finish(value); } catch (error) { fail(error); } };
    });
    this.signal(); return result;
  }
  async remove(key: string): Promise<void> {
    const id = this.binding + identifier(key);
    if (this.memory) await this.memoryRun(storage => { storage.removeItem(legacyPrefix + id); });
    else await this.transaction<void>('readwrite', (store, finish) => { store.delete(id); finish(); });
    this.signal();
  }
  async reconcile(messages: ConversationMessage[]): Promise<OutboxItem<C>[]> {
    // Only Task commands echo as conversation messages; a direction never does.
    const matches = (item: OutboxItem<C>) => this.codec === commandCodec as unknown as Codec<C> &&
      messages.some(message => message.author_id === this.actor && sameMeaning(item.command as unknown as TaskCommand, message));
    let changed = false, result: OutboxItem<C>[];
    if (this.memory) result = await this.memoryRun(storage => {
      const items = this.memoryRows(storage);
      for (const item of items) if (matches(item)) { storage.removeItem(legacyPrefix + this.binding + item.key); changed = true; }
      return items.filter(item => !matches(item));
    });
    else result = await this.transaction('readwrite', (store, finish, fail) => {
      const request = store.index('binding').getAll(this.binding, OUTBOX_LIMIT + 1);
      request.onsuccess = () => { try {
        if (request.result.length > OUTBOX_LIMIT) throw unavailable();
        const items = request.result.map(row => this.parse(row));
        for (const item of items) if (matches(item)) { store.delete(this.binding + item.key); changed = true; }
        finish(items.filter(item => !matches(item)));
      } catch (error) { fail(error); } };
    });
    if (changed) this.signal(); return result;
  }
}

/** The durable direction channel: persisted before transmission, shared quota. */
export function directionOutbox(actor: string, scope: Scope, memory?: () => StorageLike): OutboxStore<DirectionCommand> {
  return new OutboxStore<DirectionCommand>(actor, scope, memory, directionCodec);
}
