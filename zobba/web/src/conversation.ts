import { readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope, sameScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import type { components } from './generated/api.ts';

export type Task = components['schemas']['TaskResponse'];
export type TaskCommand = components['schemas']['TaskCommandRequest'];
export type Receipt = components['schemas']['CommandReceiptResponse'];
export type TaskEvent = components['schemas']['TaskEventResponse'];
export type ConversationMessage = components['schemas']['ConversationMessageResponse'];
export type ConversationActivity = components['schemas']['ConversationActivityResponse'];
export type ConversationHistory = components['schemas']['ConversationHistoryResponse'];
export type ConversationSnapshot = components['schemas']['ConversationSnapshotResponse'];
export type ConversationEvents = components['schemas']['ConversationFeedResponse'];
const kinds = ['create', 'guide', 'pause', 'resume', 'stop', 'continue'];
const encoder = new TextEncoder();
const whiteSpace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
function invalid(): never { throw new Error('Invalid conversation response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid();
  return value;
}
export function cursor(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) invalid();
  return value;
}
export function compareCursors(left: string, right: string): number {
  cursor(left); cursor(right);
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}
export function commandContent(value: unknown): string {
  if (typeof value !== 'string' || whiteSpace.test(value) || encoder.encode(value).length > 4000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) invalid();
  return value;
}
export function parseCommand(value: unknown): TaskCommand {
  const v = record(value);
  const key = identifier(v.key);
  if (!kinds.includes(v.kind as string)) invalid();
  const kind = v.kind as TaskCommand['kind'];
  const task_id = v.task_id == null ? null : identifier(v.task_id);
  const cycle_id = v.cycle_id == null ? null : identifier(v.cycle_id);
  const content = v.content == null ? null : commandContent(v.content);
  if (kind === 'create' ? task_id !== null || cycle_id !== null || content === null
    : task_id === null || cycle_id === null || (kind === 'guide' ? content === null : content !== null)) invalid();
  if (v.context != null && kind !== 'create' && kind !== 'guide') invalid();
  // Omitted context retains the historic command shape; supplied context is part
  // of exact recovery meaning and must never be silently discarded.
  if (v.context == null) return { key, kind, task_id, cycle_id, content };
  return { key, kind, task_id, cycle_id, content, context: parseTaskContext(v.context) };
}
export function parseTaskContext(value: unknown): NonNullable<TaskCommand['context']> {
  const context = record(value);
  if (Object.keys(context).some(key => !['audit_area', 'period_start', 'period_end'].includes(key))) invalid();
  const audit_area = context.audit_area == null ? null : context.audit_area;
  if (audit_area !== null && (typeof audit_area !== 'string' || !audit_area || [...audit_area].length > 200 || /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(audit_area) || /[\u0000-\u001f\u007f-\u009f]/.test(audit_area))) invalid();
  const day = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid();
    return value;
  };
  const period_start = day(context.period_start), period_end = day(context.period_end);
  if ((period_start === null) !== (period_end === null) || period_start !== null && period_end !== null && period_start > period_end) invalid();
  return { audit_area: audit_area as string | null, period_start, period_end };
}
export function sameTaskContext(left: TaskCommand['context'], right: TaskCommand['context']): boolean {
  if (left == null || right == null) return left == null && right == null;
  return (left.audit_area ?? null) === (right.audit_area ?? null) && (left.period_start ?? null) === (right.period_start ?? null) && (left.period_end ?? null) === (right.period_end ?? null);
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
export function parseTask(value: unknown): Task {
  const v = record(value);
  if (!['ready', 'running', 'paused', 'stopped', 'waiting'].includes(v.state as string) ||
    !['none', 'pending', 'confirmed', 'reconciliation_required'].includes(v.cessation as string)) invalid();
  return { id: identifier(v.id), cycle_id: identifier(v.cycle_id), objective: commandContent(v.objective),
    working_brief: commandContent(v.working_brief), state: v.state as Task['state'], cessation: v.cessation as Task['cessation'],
    intent_revision: cursor(v.intent_revision), revision: cursor(v.revision), execution_epoch: cursor(v.execution_epoch),
    accountable_actor: identifier(v.accountable_actor), accountable_label: label(v.accountable_label) };
}
export function parseMessage(value: unknown, watermark: string): ConversationMessage {
  const v = record(value);
  if (!('target_task_id' in v) || !('target_cycle_id' in v) || !('content' in v)) invalid();
  const command = parseCommand({ key: v.key, kind: v.kind, task_id: v.target_task_id, cycle_id: v.target_cycle_id, content: v.content, context: v.context });
  if (typeof v.author_label !== 'string' || !v.author_label || [...v.author_label].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(v.author_label)) invalid();
  const received_cursor = cursor(v.received_cursor);
  const applied_cursor = v.applied_cursor === null ? null : cursor(v.applied_cursor);
  const task_id = identifier(v.task_id), cycle_id = identifier(v.cycle_id);
  if (received_cursor === '0' || compareCursors(received_cursor, watermark) > 0 ||
    applied_cursor !== null && (compareCursors(applied_cursor, received_cursor) <= 0 || compareCursors(applied_cursor, watermark) > 0) ||
    command.kind !== 'create' && task_id !== command.task_id ||
    !['create', 'continue'].includes(command.kind) && cycle_id !== command.cycle_id) invalid();
  return { command_id: identifier(v.command_id), key: command.key, author_id: identifier(v.author_id), author_label: v.author_label,
    kind: command.kind, task_id, cycle_id, target_task_id: command.task_id ?? null, target_cycle_id: command.cycle_id ?? null,
    content: command.content ?? null, ...(command.context != null ? { context: command.context } : {}), received_cursor, applied_cursor };
}
function envelope(value: unknown, scope: Scope): Record<string, unknown> {
  const v = record(value);
  if (!sameScope(parseScope(v.scope), scope)) invalid();
  return v;
}
function boundedArray(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 100) invalid(); return value; }
function unique(values: string[]): void { if (new Set(values).size !== values.length) invalid(); }
export function parseHistory(value: unknown, scope: Scope, through?: string, before?: string): ConversationHistory {
  const v = envelope(value, scope);
  if (v.audience !== 'engagement_members') invalid();
  const watermark = cursor(v.watermark);
  if (through !== undefined && watermark !== through) invalid();
  const messages = boundedArray(v.messages).map(message => parseMessage(message, watermark));
  unique(messages.map(message => message.command_id));
  unique(messages.map(message => `${message.author_id}/${message.key}`));
  messages.forEach((message, index) => {
    if (index && compareCursors(messages[index - 1]!.received_cursor, message.received_cursor) >= 0 ||
      before !== undefined && compareCursors(message.received_cursor, before) >= 0) invalid();
  });
  const before_cursor = v.before_cursor === null ? null : cursor(v.before_cursor);
  if (before_cursor !== null && (messages.length !== 100 || before_cursor !== messages[0]?.received_cursor)) invalid();
  return { scope: parseScope(v.scope), audience: 'engagement_members', watermark, messages, before_cursor };
}
export function parseTaskPage(value: unknown, after?: string): { tasks: Task[]; next_cursor: string | null } {
  const v = record(value);
  const tasks = boundedArray(v.tasks).map(parseTask);
  tasks.forEach((task, index) => {
    if (index && tasks[index - 1]!.id >= task.id || after !== undefined && task.id <= after) invalid();
  });
  const next_cursor = v.next_cursor === null ? null : identifier(v.next_cursor);
  if (next_cursor !== null && (tasks.length !== 100 || next_cursor !== tasks.at(-1)?.id)) invalid();
  return { tasks, next_cursor };
}
export function parseSnapshot(value: unknown, scope: Scope): ConversationSnapshot {
  const history = parseHistory(value, scope);
  const v = record(value);
  const page = parseTaskPage({ tasks: v.tasks, next_cursor: v.next_task_cursor });
  let latest_activity: ConversationActivity | null = null;
  if (v.latest_activity !== null) {
    const activity = record(v.latest_activity);
    latest_activity = { cursor: cursor(activity.cursor), task_id: identifier(activity.task_id) };
    if (latest_activity.cursor === '0' || compareCursors(latest_activity.cursor, history.watermark) > 0) invalid();
  }
  return { ...history, latest_activity, tasks: page.tasks, next_task_cursor: page.next_cursor };
}
export function parseEvents(value: unknown, scope: Scope, after: string): ConversationEvents {
  const v = envelope(value, scope);
  if (v.audience !== 'engagement_members') invalid();
  const watermark = cursor(v.watermark), next_cursor = cursor(v.next_cursor);
  if (typeof v.has_more !== 'boolean' || typeof v.resync_required !== 'boolean') invalid();
  const events = boundedArray(v.events).map(value => {
    const row = record(value);
    if (typeof row.kind !== 'string' || !/^[a-z_]{1,64}$/.test(row.kind)) invalid();
    return { cursor: cursor(row.cursor), task_id: identifier(row.task_id), cycle_id: identifier(row.cycle_id),
      command_id: row.command_id === null ? null : identifier(row.command_id), kind: row.kind };
  });
  events.forEach((event, index) => {
    if (BigInt(event.cursor) !== BigInt(index ? events[index - 1]!.cursor : after) + 1n || compareCursors(event.cursor, watermark) > 0) invalid();
  });
  if (v.resync_required) {
    if (events.length || v.has_more || next_cursor !== after) invalid();
  } else if (compareCursors(after, watermark) > 0 || next_cursor !== (events.at(-1)?.cursor ?? after) ||
    v.has_more && events.length !== 100 || !v.has_more && compareCursors(next_cursor, watermark) !== 0) invalid();
  return { scope: parseScope(v.scope), audience: 'engagement_members', watermark, events, next_cursor, has_more: v.has_more, resync_required: v.resync_required };
}
export function parseReceipt(value: unknown, command: TaskCommand): Receipt {
  const v = record(value);
  const receipt: Receipt = { command_id: identifier(v.command_id), task_id: identifier(v.task_id), cycle_id: identifier(v.cycle_id),
    event_cursor: cursor(v.event_cursor), status: 'received' };
  if (v.status !== 'received' || receipt.event_cursor === '0' || command.kind !== 'create' && command.task_id !== receipt.task_id ||
    !['create', 'continue'].includes(command.kind) && command.cycle_id !== receipt.cycle_id) invalid();
  return receipt;
}
function route(scope: Scope, suffix: string, extra: Record<string, string> = {}): string {
  parseScope(scope);
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${suffix}?${new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...extra })}`;
}
export async function readConversation(scope: Scope, signal: AbortSignal, session: Session | null): Promise<ConversationSnapshot> {
  return parseSnapshot(await readSessionJson(route(scope, 'conversation'), session, signal), scope);
}
export async function readHistory(scope: Scope, through: string, before: string, signal: AbortSignal, session: Session | null): Promise<ConversationHistory> {
  return parseHistory(await readSessionJson(route(scope, 'conversation/history', { through: cursor(through), before: cursor(before) }), session, signal), scope, through, before);
}
export async function readEvents(scope: Scope, after: string, signal: AbortSignal, session: Session | null): Promise<ConversationEvents> {
  return parseEvents(await readSessionJson(route(scope, 'conversation/events', { after: cursor(after) }), session, signal), scope, after);
}
export async function readTasks(scope: Scope, after: string, signal: AbortSignal, session: Session | null) {
  return parseTaskPage(await readSessionJson(route(scope, 'tasks', { after_task_id: identifier(after) }), session, signal), after);
}
export async function readTask(scope: Scope, id: string, signal: AbortSignal, session: Session | null): Promise<Task> {
  const task = parseTask(await readSessionJson(route(scope, `tasks/${identifier(id)}`), session, signal));
  if (task.id !== id) invalid();
  return task;
}
export async function postCommand(scope: Scope, session: Session, command: TaskCommand, signal: AbortSignal): Promise<Receipt> {
  const body = parseCommand(command);
  return parseReceipt(await readJson(route(scope, ['guide', 'pause', 'stop'].includes(body.kind) ? 'task-controls' : 'task-commands'), signal,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id }, body: JSON.stringify(body) }), body);
}
