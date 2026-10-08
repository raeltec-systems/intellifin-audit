// Story 22.2 AC4: organisation-level conversational engagement setup.
// Every response is strictly parsed. Resolution is deterministic on the server;
// nothing here infers a client or period.
import { readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { commandContent, cursor, identifier } from './conversation.ts';
import { OutboxStore } from './conversation-outbox.ts';
import type { Codec, StorageLike } from './conversation-outbox.ts';
import type { Scope } from './engagements.ts';
import type { components } from './generated/api.ts';

export type SetupView = components['schemas']['SetupResponse'];
export type SetupMessage = components['schemas']['SetupMessageResponse'];
export type SetupClient = components['schemas']['SetupClientResponse'];
export type SetupOrganisation = components['schemas']['SetupOrganisationResponse'];
export type SetupState = SetupView['state'];
export type SetupLimits = components['schemas']['SetupLimitsResponse'];
export interface OrganisationPage { organisations: SetupOrganisation[]; more: boolean; limits: SetupLimits }

/**
 * The setup protocol bounds this client validates against. The server states its
 * limits with every organisation page, and a disagreement is refused as an
 * invalid response, so the two cannot drift silently.
 */
export const SETUP_LIMITS: SetupLimits = {
  open_setups: 8, established_per_day: 20, setup_messages: 200, client_candidates: 20, objective_bytes: 4000, answer_bytes: 400,
};
const ORGANISATION_PAGE = 50;
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The complete meaning of one setup request: its key and exact content. */
export type SetupCommand =
  | { key: string; op: 'open'; objective: string }
  | { key: string; op: 'text'; setup_id: string; content: string }
  | { key: string; op: 'choose_client'; setup_id: string; client_id: string; client_name: string }
  | { key: string; op: 'new_client'; setup_id: string; accept: boolean }
  | { key: string; op: 'change_client'; setup_id: string }
  | { key: string; op: 'change_period'; setup_id: string }
  | { key: string; op: 'cancel'; setup_id: string }
  | { key: string; op: 'confirm'; setup_id: string };

function invalid(): never { throw new Error('Invalid engagement setup'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) invalid();
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(value)) invalid();
  return value;
}
function answer(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || utf8Bytes(value) > SETUP_LIMITS.answer_bytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function client(value: unknown): SetupClient {
  const v = record(value);
  return { client_id: identifier(v.client_id), client_name: label(v.client_name) };
}

export function parseSetupCommand(value: unknown): SetupCommand {
  const v = record(value);
  const key = identifier(v.key);
  switch (v.op) {
    case 'open': keys(v, ['key', 'op', 'objective']); return { key, op: 'open', objective: commandContent(v.objective) };
    case 'text': keys(v, ['key', 'op', 'setup_id', 'content']); return { key, op: 'text', setup_id: identifier(v.setup_id), content: answer(v.content) };
    case 'choose_client':
      // The client name is a retained label for recovery; only the ID is sent.
      keys(v, ['key', 'op', 'setup_id', 'client_id', 'client_name']);
      return { key, op: 'choose_client', setup_id: identifier(v.setup_id), client_id: identifier(v.client_id), client_name: label(v.client_name) };
    case 'change_client': keys(v, ['key', 'op', 'setup_id']); return { key, op: 'change_client', setup_id: identifier(v.setup_id) };
    case 'change_period': keys(v, ['key', 'op', 'setup_id']); return { key, op: 'change_period', setup_id: identifier(v.setup_id) };
    case 'new_client':
      keys(v, ['key', 'op', 'setup_id', 'accept']);
      if (typeof v.accept !== 'boolean') invalid();
      return { key, op: 'new_client', setup_id: identifier(v.setup_id), accept: v.accept };
    case 'cancel': keys(v, ['key', 'op', 'setup_id']); return { key, op: 'cancel', setup_id: identifier(v.setup_id) };
    case 'confirm': keys(v, ['key', 'op', 'setup_id']); return { key, op: 'confirm', setup_id: identifier(v.setup_id) };
    default: invalid();
  }
}

const setupCodec: Codec<SetupCommand> = {
  // A distinct binding keeps setup requests out of every engagement channel
  // while sharing the durable store, quota and serialized transactions.
  prefix: 'setup:',
  parse: parseSetupCommand,
  control: () => false,
};

/** Durable setup channel keyed by actor and organisation only. */
export function setupOutbox(actor: string, organisationId: string, memory?: () => StorageLike): OutboxStore<SetupCommand> {
  const scope: Scope = { organisation_id: identifier(organisationId), client_id: 'organisation', engagement_id: 'setup' };
  return new OutboxStore<SetupCommand>(actor, scope, memory, setupCodec);
}

function message(value: unknown): SetupMessage {
  const v = record(value);
  const author = oneOf(v.author, ['member', 'zobba'] as const);
  const kind = author === 'member'
    ? oneOf(v.kind, ['objective', 'text', 'choose_client', 'new_client', 'change_client', 'change_period', 'confirm', 'cancel'] as const)
    : oneOf(v.kind, ['question', 'refusal', 'summary', 'established', 'cancelled'] as const);
  if (typeof v.ordinal !== 'number' || !Number.isInteger(v.ordinal) || v.ordinal < 0 || v.ordinal > 199) invalid();
  const replyTo = v.reply_to;
  if (replyTo !== null && (typeof replyTo !== 'number' || !Number.isInteger(replyTo) || replyTo < 0 || replyTo >= v.ordinal)) invalid();
  if ((author === 'zobba') !== (replyTo !== null)) invalid();
  return {
    ordinal: v.ordinal, author, kind, content: commandContent(v.content), reply_to: replyTo as number | null,
    prompt: v.prompt === null ? null : oneOf(v.prompt, ['client', 'client_choice', 'new_client', 'period', 'confirm'] as const),
    candidates: list(v.candidates, SETUP_LIMITS.client_candidates).map(client),
    refusal: v.refusal === null ? null : identifier(v.refusal),
  };
}

export function parseSetup(value: unknown): SetupView {
  const v = record(value);
  const state = oneOf(v.state, ['objective', 'client', 'client_choice', 'new_client', 'period', 'confirm', 'established', 'cancelled'] as const);
  const established = v.established === null ? null : (() => {
    const e = record(v.established);
    const r = record(e.receipt);
    if (r.status !== 'received') invalid();
    return {
      organisation_id: identifier(e.organisation_id), client_id: identifier(e.client_id), engagement_id: identifier(e.engagement_id),
      engagement_name: label(e.engagement_name),
      receipt: { command_id: identifier(r.command_id), task_id: identifier(r.task_id), cycle_id: identifier(r.cycle_id), event_cursor: cursor(r.event_cursor), status: 'received' as const },
    };
  })();
  const setup: SetupView = {
    id: identifier(v.id), organisation_id: identifier(v.organisation_id), key: identifier(v.key), objective: commandContent(v.objective),
    state, candidates: list(v.candidates, SETUP_LIMITS.client_candidates).map(client), client: v.client === null ? null : client(v.client),
    new_client_name: v.new_client_name === null ? null : label(v.new_client_name),
    period_start: date(v.period_start), period_end: date(v.period_end), established,
    messages: list(v.messages, SETUP_LIMITS.setup_messages).map(message),
  };
  if ((state === 'established') !== (established !== null) || (setup.period_start === null) !== (setup.period_end === null) ||
    setup.period_start !== null && setup.period_end !== null && setup.period_start > setup.period_end ||
    established && established.organisation_id !== setup.organisation_id) invalid();
  return setup;
}

/** The new engagement scope once the setup is established. */
export function establishedScope(setup: SetupView): Scope | null {
  return setup.established ? { organisation_id: setup.established.organisation_id, client_id: setup.established.client_id, engagement_id: setup.established.engagement_id } : null;
}

function post(session: Session, body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, body: JSON.stringify(body) };
}
function base(organisationId: string): string { return `/organisations/${encodeURIComponent(identifier(organisationId))}/engagement-setups`; }

/** One exact request. An identical retry returns the original setup or receipt. */
export async function sendSetup(organisationId: string, session: Session, command: SetupCommand, signal: AbortSignal): Promise<SetupView> {
  const c = parseSetupCommand(command);
  const root = base(organisationId);
  let path: string, body: unknown;
  switch (c.op) {
    case 'open': path = root; body = { key: c.key, objective: c.objective }; break;
    case 'confirm': path = `${root}/${encodeURIComponent(c.setup_id)}/confirm`; body = { key: c.key }; break;
    case 'text': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'text', content: c.content }; break;
    case 'choose_client': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'choose_client', client_id: c.client_id }; break;
    case 'new_client': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'new_client', accept: c.accept }; break;
    case 'change_client': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'change_client' }; break;
    case 'change_period': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'change_period' }; break;
    case 'cancel': path = `${root}/${encodeURIComponent(c.setup_id)}/messages`; body = { key: c.key, kind: 'cancel' }; break;
  }
  const setup = parseSetup(await readJson(path, signal, post(session, body)));
  if (setup.organisation_id !== organisationId || c.op !== 'open' && setup.id !== c.setup_id ||
    c.op === 'open' && (setup.key !== c.key || setup.objective !== c.objective)) invalid();
  return setup;
}

export function parseOrganisationPage(value: unknown): OrganisationPage {
  const v = record(value);
  keys(v, ['organisations', 'more', 'limits']);
  if (typeof v.more !== 'boolean') invalid();
  const limits = record(v.limits);
  keys(limits, Object.keys(SETUP_LIMITS));
  for (const [name, bound] of Object.entries(SETUP_LIMITS)) if (limits[name] !== bound) invalid();
  return {
    organisations: list(v.organisations, ORGANISATION_PAGE).map(item => {
      const o = record(item);
      keys(o, ['organisation_id', 'organisation_name']);
      return { organisation_id: identifier(o.organisation_id), organisation_name: label(o.organisation_name) };
    }),
    more: v.more,
    limits: SETUP_LIMITS,
  };
}

/** One C-ordered page of organisations after the cursor. */
export async function readSetupOrganisations(session: Session, signal: AbortSignal, after?: string): Promise<OrganisationPage> {
  const query = after === undefined ? '' : `?after=${encodeURIComponent(identifier(after))}`;
  return parseOrganisationPage(await readSessionJson(`/engagement-setups/organisations${query}`, session, signal));
}

export async function readOpenSetups(organisationId: string, session: Session, signal: AbortSignal): Promise<SetupView[]> {
  const v = record(await readSessionJson(base(organisationId), session, signal));
  keys(v, ['setups']);
  const setups = list(v.setups, SETUP_LIMITS.open_setups).map(parseSetup);
  if (setups.some(setup => setup.organisation_id !== organisationId)) invalid();
  return setups;
}

/** One setup, after the server answers any committed but unanswered message. */
export async function readSetup(organisationId: string, setupId: string, session: Session, signal: AbortSignal): Promise<SetupView> {
  const setup = parseSetup(await readSessionJson(`${base(organisationId)}/${encodeURIComponent(identifier(setupId))}`, session, signal));
  if (setup.organisation_id !== organisationId || setup.id !== setupId) invalid();
  return setup;
}

/** The byte-length reason a draft cannot be sent, before it is reserved. */
export function draftProblem(text: string, kind: 'objective' | 'answer', limits: SetupLimits = SETUP_LIMITS): string | null {
  if (!text.trim()) return null;
  const max = kind === 'objective' ? limits.objective_bytes : limits.answer_bytes;
  const bytes = utf8Bytes(text);
  return bytes > max ? `${kind === 'objective' ? 'The objective' : 'This answer'} is ${bytes} bytes; the limit is ${max} bytes (UTF-8). Shorten it before sending.` : null;
}

/** How a refused setup request is explained. Numbers come from the server's limits. */
export function setupErrorText(code: string | undefined, status: number, limits: SetupLimits = SETUP_LIMITS): string {
  switch (code) {
    case 'engagement_setup_open_limit': return `You already have ${limits.open_setups} engagement setups open here. Finish or cancel one first.`;
    case 'engagement_setup_daily_limit': return `You have set up ${limits.established_per_day} engagements here today (UTC). Nothing was created. Try again tomorrow.`;
    case 'engagement_setup_message_limit': return `This setup has reached its ${limits.setup_messages}-message limit. Cancel it and start again.`;
    case 'engagement_setup_confirm_failed': return 'The engagement could not be created. Nothing was created; confirm again to retry.';
    case 'engagement_setup_request_rejected': return 'A security check refused this request. Nothing was changed. Reload the page and try again.';
    case 'engagement_setup_not_found': return 'This setup is no longer available. Nothing was changed.';
    case 'access_denied': return 'You no longer have an auditor or audit manager role in this organisation. Nothing was created.';
    case 'engagement_setup_conflict': return 'This request no longer matches the setup. Nothing was created; review the setup and try again.';
    default: return status === 409 ? 'This request no longer matches the setup. Nothing was created; review the setup and try again.'
      : status === 403 ? 'You no longer have an auditor or audit manager role in this organisation. Nothing was created.'
        : 'The request was not confirmed. Sending it again is safe and creates no duplicates.';
  }
}

/** Only a real loss of audit authority ends the setup workspace. */
export function isAccessLoss(status: number, code: string | undefined): boolean {
  return status === 401 || status === 412 || status === 403 && code !== 'engagement_setup_request_rejected';
}

export function newKey(): string { return `setup-${crypto.randomUUID()}`; }
