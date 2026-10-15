import { AccessError, readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope, sameScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { verifyMembershipSession } from './membership.ts';

export type Layout = 'standard' | 'expanded';
export type KnowledgeScope = { kind: 'personal' | 'firm' | 'client' | 'engagement'; organisation_id: string; client_id: string | null; engagement_id: string | null; owner_id: string | null };
export type Period = { start: string | null; end: string | null };
export type RecordReference = { id: string; revision: string };
export type Dependency =
  | { kind: 'evidence'; evidence_id: string; storage_version: string; digest: string; scope: KnowledgeScope }
  | { kind: 'guide'; command_id: string; task_id: string; cycle_id: string; scope: KnowledgeScope }
  | { kind: 'knowledge'; id: string; revision: string; scope: KnowledgeScope }
  | { kind: 'methodology'; version_id: string }
  | { kind: 'skill'; selection_id: string; task_id: string };
export type KnowledgeRecord = {
  id: string; revision: string; actor_id: string; recorded_at: number; scope: KnowledgeScope;
  kind: 'decision' | 'observation' | 'assertion' | 'preference' | 'published_preference'; text: string;
  period: Period; certainty: 'user_directed' | 'source_states' | 'asserted' | 'learned' | 'explicit_preference'; uncertainty: string | null;
  dependencies: Dependency[]; supersedes: RecordReference | null;
  source: { evidence_id: string; storage_version: string; digest: string; byte_start: number; byte_end: number; original_size: number; partial: boolean; field_path: string | null } | null;
  direction: { command_id: string; task_id: string; cycle_id: string; standing: string } | null;
  preference: { name: string; value: Layout; inferred: boolean; rule: string | null; observation_ids: string[] } | null;
};
export type KnowledgeView = { record: KnowledgeRecord; status: 'current' | 'corrected' | 'excluded' | 'forgotten' | 'invalidated' | 'withdrawn'; status_reason: string | null; can_correct: boolean; can_exclude: boolean; can_forget: boolean; can_reuse: boolean; can_undo: boolean };
export const omissionLabels = {
  unsupported_format: 'Some originals have no supported text extraction.', unknown_period: 'Some source periods are unknown; period-limited knowledge is withheld when the Task period is unknown.',
  outside_period: 'Some knowledge is outside this Task’s business period.', invalidated_support: 'Corrected or invalidated support is excluded from future context.',
  capture_capacity: 'Some originals or decisions await capture. Exact original recovery remains available.', legacy_not_captured: 'Earlier sources may not have a derived record. Exact originals support capture recovery; Guides without an original recorded time cannot be reconstructed.',
  partial_source: 'Source excerpts cover only the recorded byte range.', bounded_page: 'This page covers at most 50 records. Continue or inspect an exact record.', unavailable_support: 'Some supporting context is currently unavailable.',
  scan_limit: 'The candidate scan stopped before all records were examined; later eligible records may remain. Exact lookup is still available for a known record. An empty result does not establish absence.',
} as const;
export type KnowledgePage = { task_id: string; revision: string; execution_epoch: string; methodology_binding_id: string; items: KnowledgeView[]; next_after: string | null; omissions: (keyof typeof omissionLabels)[] };
export type Assertion = { text: string; period: Period; uncertainty: string | null; dependencies: Dependency[] };
export type KnowledgeAction =
  | { kind: 'assert'; assertion: Assertion }
  | { kind: 'correct'; target: RecordReference; assertion: Assertion; reason: string }
  | { kind: 'exclude' | 'forget'; target: RecordReference; reason: string }
  | { kind: 'reuse'; target: RecordReference; destination_engagement_id: string; destination_task_id: string; reason: string }
  | { kind: 'correct_source'; predecessor_id: string; replacement_id: string; expected_source_revision: string; reason: string };
export type KnowledgeCommand = { key: string; expected_revision: string; action: KnowledgeAction };
export type KnowledgeReceipt = { event_id: string; revision: string; record: KnowledgeView | null; affected_ids: string[]; affected_destinations: string[] };
export type PreferenceAction = { kind: 'save'; value: Layout } | { kind: 'undo'; target: RecordReference } | { kind: 'publish'; target: RecordReference; client_id: string; engagement_id: string } | { kind: 'withdraw'; publication_id: string };
export type PreferenceCommand = { key: string; expected_revision: string; action: PreferenceAction };
export type PreferenceSnapshot = { organisation_id: string; owner_id: string; revision: string; current: KnowledgeView | null; publications: KnowledgeView[]; consumed_through: string };
export type ObserveLayout = { key: string; opening_id: string; value: Layout; expected_revision: string };
export type KnowledgeRequest =
  | { kind: 'knowledge'; scope: Scope; task_id: string; body: KnowledgeCommand }
  | { kind: 'preference'; organisation_id: string; body: PreferenceCommand }
  | { kind: 'observe'; organisation_id: string; body: ObserveLayout }
  | { kind: 'excerpt'; scope: Scope; body: { key: string; evidence_id: string; byte_start: number; byte_end: number } }
  | { kind: 'recover'; scope: Scope; evidence_id: string; body: { key: string } };
export type KnowledgeOutcome = { kind: 'undo' | 'withdraw'; event_id: string; revision: string; affected_destinations: string[] };
export function knowledgeRequestDeadline(request: KnowledgeRequest): number { return request.kind === 'excerpt' || request.kind === 'recover' ? 120000 : 12000; }
export type KnowledgeDraft = { mode: KnowledgeAction['kind']; target: RecordReference | null; text: string; reason: string; uncertainty: string; start: string; end: string; destination_engagement_id: string; destination_task_id: string; expected_revision: string; dependencies: Dependency[]; predecessor_id: string; replacement_id: string; expected_source_revision: string | null };
export type KnowledgeSourceStatus = { evidence_id: string; source_revision: string; replacement_id: string | null; capture_revision: string; omissions: (keyof typeof omissionLabels)[]; correction_actor_id: string | null; correction_recorded_at: number | null; correction_reason: string | null };

function invalid(): never { throw new Error('Invalid knowledge response'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(); return value; }
function revision(value: unknown): string { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) invalid(); return value; }
function integer(value: unknown, maximum = 253402300799): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) invalid(); return value; }
function text(value: unknown, maximum = 16384): string { if (typeof value !== 'string' || new TextEncoder().encode(value).length > maximum || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) invalid(); return value; }
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T { if (!allowed.includes(value as T)) invalid(); return value as T; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
function list<T>(value: unknown, parse: (value: unknown) => T, maximum = 32): T[] { if (!Array.isArray(value) || value.length > maximum) invalid(); return value.map(parse); }
function unique<T>(values: T[], key: (value: T) => string): T[] { if (new Set(values.map(key)).size !== values.length) invalid(); return values; }
function day(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid(); return value; }
export function parseKnowledgePeriod(value: unknown): Period { const v = object(value), start = nullable(v.start, day), end = nullable(v.end, day); if ((start === null) !== (end === null) || start && end && start > end) invalid(); return { start, end }; }
export function parseKnowledgeScope(value: unknown): KnowledgeScope {
  const v = object(value), result: KnowledgeScope = { kind: enumeration(v.kind, ['personal', 'firm', 'client', 'engagement']), organisation_id: id(v.organisation_id), client_id: nullable(v.client_id, id), engagement_id: nullable(v.engagement_id, id), owner_id: nullable(v.owner_id, id) };
  if (result.kind === 'personal' ? !result.owner_id || result.client_id || result.engagement_id : result.owner_id || (result.kind === 'firm' ? result.client_id || result.engagement_id : !result.client_id || (result.kind === 'client' ? result.engagement_id : !result.engagement_id))) invalid();
  return result;
}
export function knowledgeEngagementScope(scope: Scope): KnowledgeScope { return { kind: 'engagement', ...parseScope(scope), owner_id: null }; }
export function sourceScope(scope: KnowledgeScope): Scope | null { return scope.client_id && scope.engagement_id ? { organisation_id: scope.organisation_id, client_id: scope.client_id, engagement_id: scope.engagement_id } : null; }
function reference(value: unknown): RecordReference { const v = object(value); return { id: id(v.id), revision: revision(v.revision) }; }
function dependency(value: unknown): Dependency {
  const v = object(value), kind = enumeration(v.kind, ['evidence', 'guide', 'knowledge', 'methodology', 'skill']);
  if (kind === 'evidence') return { kind, evidence_id: id(v.evidence_id), storage_version: text(v.storage_version, 2048), digest: digest(v.digest), scope: parseKnowledgeScope(v.scope) };
  if (kind === 'guide') return { kind, command_id: id(v.command_id), task_id: id(v.task_id), cycle_id: id(v.cycle_id), scope: parseKnowledgeScope(v.scope) };
  if (kind === 'knowledge') return { kind, ...reference(v), scope: parseKnowledgeScope(v.scope) };
  if (kind === 'methodology') return { kind, version_id: id(v.version_id) };
  return { kind, selection_id: id(v.selection_id), task_id: id(v.task_id) };
}
export function parseKnowledgeView(value: unknown): KnowledgeView {
  const v = object(value), r = object(v.record);
  const record: KnowledgeRecord = { ...reference(r), actor_id: id(r.actor_id), recorded_at: integer(r.recorded_at), scope: parseKnowledgeScope(r.scope),
    kind: enumeration(r.kind, ['decision', 'observation', 'assertion', 'preference', 'published_preference']), text: text(r.text), period: parseKnowledgePeriod(r.period), certainty: enumeration(r.certainty, ['user_directed', 'source_states', 'asserted', 'learned', 'explicit_preference']), uncertainty: nullable(r.uncertainty, value => text(value, 8000)), dependencies: list(r.dependencies, dependency), supersedes: nullable(r.supersedes, reference),
    source: nullable(r.source, value => { const s = object(value), byte_start = integer(s.byte_start, 10485760), byte_end = integer(s.byte_end, 10485760), original_size = integer(s.original_size, 10485760); if (byte_start > byte_end || byte_end > original_size || byte_end - byte_start > 16384) invalid(); return { evidence_id: id(s.evidence_id), storage_version: text(s.storage_version, 2048), digest: digest(s.digest), byte_start, byte_end, original_size, partial: bool(s.partial), field_path: nullable(s.field_path, value => text(value, 200)) }; }),
    direction: nullable(r.direction, value => { const d = object(value); return { command_id: id(d.command_id), task_id: id(d.task_id), cycle_id: id(d.cycle_id), standing: text(d.standing, 2000) }; }),
    preference: nullable(r.preference, value => { const p = object(value); if (p.name !== 'task_inspection_layout') invalid(); return { name: p.name, value: enumeration(p.value, ['standard', 'expanded']), inferred: bool(p.inferred), rule: nullable(p.rule, value => text(value, 2000)), observation_ids: unique(list(p.observation_ids, id, 128), id => id) }; }),
  };
  if (record.kind === 'observation' && (!record.source || record.certainty !== 'source_states') || record.kind === 'decision' && (!record.direction || record.certainty !== 'user_directed') || ['preference', 'published_preference'].includes(record.kind) && !record.preference) invalid();
  if (record.source && !record.dependencies.some(d => d.kind === 'evidence' && d.evidence_id === record.source!.evidence_id && d.storage_version === record.source!.storage_version && d.digest === record.source!.digest)) invalid();
  return { record, status: enumeration(v.status, ['current', 'corrected', 'excluded', 'forgotten', 'invalidated', 'withdrawn']), status_reason: nullable(v.status_reason, value => text(value, 8000)), can_correct: bool(v.can_correct), can_exclude: bool(v.can_exclude), can_forget: bool(v.can_forget), can_reuse: bool(v.can_reuse), can_undo: bool(v.can_undo) };
}
export function parseKnowledgePage(value: unknown, task: string, after: string | null = null): KnowledgePage {
  const v = object(value); if (v.task_id !== task) throw new Error('Knowledge Task audience changed');
  const items = unique(list(v.items, parseKnowledgeView, 50), v => v.record.id), next_after = nullable(v.next_after, id);
  const omissions = unique(list(v.omissions, value => enumeration(value, Object.keys(omissionLabels) as (keyof typeof omissionLabels)[])), v => v);
  if (items.some((item, i) => { const previous = i ? items[i - 1]!.record.id : after; return previous !== null && item.record.id <= previous; }) || next_after !== null && (!items.length || items.length !== 50 && !omissions.includes('scan_limit') || items.at(-1)!.record.id !== next_after)) invalid();
  return { task_id: id(v.task_id), revision: revision(v.revision), execution_epoch: revision(v.execution_epoch), methodology_binding_id: id(v.methodology_binding_id), items, next_after, omissions };
}
export function parsePreference(value: unknown, organisation: string, actor: string): PreferenceSnapshot {
  const v = object(value); if (v.organisation_id !== organisation || v.owner_id !== actor) throw new Error('Preference owner changed');
  const current = nullable(v.current, parseKnowledgeView), publications = unique(list(v.publications, parseKnowledgeView, 128), v => v.record.id);
  if (current && (current.record.kind !== 'preference' || current.record.scope.kind !== 'personal' || current.record.scope.owner_id !== actor || current.record.scope.organisation_id !== organisation) || publications.some(p => p.record.kind !== 'published_preference' || p.record.actor_id !== actor || p.record.scope.organisation_id !== organisation)) invalid();
  return { organisation_id: id(v.organisation_id), owner_id: id(v.owner_id), revision: revision(v.revision), current, publications, consumed_through: revision(v.consumed_through) };
}
export function parseKnowledgeReceipt(value: unknown): KnowledgeReceipt { const v = object(value); return { event_id: id(v.event_id), revision: revision(v.revision), record: nullable(v.record, parseKnowledgeView), affected_ids: unique(list(v.affected_ids, id, 4096), id => id), affected_destinations: unique(list(v.affected_destinations, id, 4096), id => id) }; }
function route(scope: Scope, suffix: string, extra: Record<string, string> = {}): string { parseScope(scope); return `/engagements/${encodeURIComponent(scope.engagement_id)}/${suffix}?${new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...extra })}`; }
function preferencePath(organisation: string): string { return `/knowledge/organisations/${encodeURIComponent(id(organisation))}/preference`; }
export async function readKnowledge(scope: Scope, task: string, session: Session, signal: AbortSignal, after: string | null = null, query = '', inactive = false): Promise<KnowledgePage> {
  const value = await readSessionJson(route(scope, `tasks/${id(task)}/knowledge`, { ...(after ? { after: id(after) } : {}), ...(query ? { text: query } : {}), include_inactive: String(inactive) }), session, signal);
  const parsed = parseKnowledgePage(value, task, after);
  await verifyKnowledge(scope, task, session, signal, parsed, parsed.items, { after, text: query || null, include_inactive: inactive }, false);
  await verifyMembershipSession(session, signal); return parsed;
}
async function verifyKnowledge(scope: Scope, task: string, session: Session, signal: AbortSignal, basis: Pick<KnowledgePage, 'execution_epoch' | 'methodology_binding_id'>, items: KnowledgeView[], query: { after: string | null; text: string | null; include_inactive: boolean }, exact: boolean): Promise<void> {
  const result = object(await readJson(route(scope, `tasks/${id(task)}/knowledge/verify`), signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, body: JSON.stringify({ query, expected_execution_epoch: basis.execution_epoch, expected_methodology_binding_id: basis.methodology_binding_id, items: items.map(v => ({ id: v.record.id, revision: v.record.revision, status: v.status })), exact }) }));
  if (result.verified !== true) invalid();
}
export async function readKnowledgeExact(scope: Scope, task: string, target: RecordReference, session: Session, signal: AbortSignal, expectedBasis?: Pick<KnowledgePage, 'execution_epoch' | 'methodology_binding_id'>): Promise<KnowledgeView> {
  const basis = expectedBasis ?? await readKnowledge(scope, task, session, signal);
  const value = await readSessionJson(route(scope, `tasks/${id(task)}/knowledge/records/${id(target.id)}/revisions/${revision(target.revision)}`), session, signal);
  const parsed = parseKnowledgeView(value); if (parsed.record.id !== target.id || parsed.record.revision !== target.revision) invalid();
  await verifyKnowledge(scope, task, session, signal, basis, [parsed], { after: null, text: null, include_inactive: true }, true);
  await verifyMembershipSession(session, signal); return parsed;
}
async function verifySnapshot(path: string, body: Record<string, string>, session: Session, signal: AbortSignal): Promise<void> {
  const result = object(await readJson(path, signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, body: JSON.stringify(body) }));
  if (result.verified !== true) invalid();
}
export async function readPreference(organisation: string, session: Session, signal: AbortSignal): Promise<PreferenceSnapshot> {
  const value = parsePreference(await readSessionJson(preferencePath(organisation), session, signal), organisation, session.identity.id);
  await verifySnapshot(`${preferencePath(organisation)}/verify`, { expected_revision: value.revision }, session, signal);
  await verifyMembershipSession(session, signal); return value;
}
export async function readKnowledgeSourceStatus(scope: Scope, evidenceId: string, session: Session, signal: AbortSignal): Promise<KnowledgeSourceStatus> {
  const v = object(await readSessionJson(route(scope, `knowledge/evidence/${id(evidenceId)}`), session, signal)); if (v.evidence_id !== evidenceId) invalid();
  const value = { evidence_id: id(v.evidence_id), source_revision: revision(v.source_revision), replacement_id: nullable(v.replacement_id, id), capture_revision: revision(v.capture_revision), omissions: unique(list(v.omissions, value => enumeration(value, Object.keys(omissionLabels) as (keyof typeof omissionLabels)[])), v => v), correction_actor_id: nullable(v.correction_actor_id ?? null, id), correction_recorded_at: nullable(v.correction_recorded_at ?? null, integer), correction_reason: nullable(v.correction_reason ?? null, value => text(value, 8000)) };
  await verifySnapshot(route(scope, `knowledge/evidence/${id(evidenceId)}/verify`), { expected_source_revision: value.source_revision, expected_capture_revision: value.capture_revision }, session, signal);
  await verifyMembershipSession(session, signal); return value;
}
export async function submitKnowledge(request: KnowledgeRequest, session: Session, signal: AbortSignal): Promise<KnowledgeReceipt | PreferenceSnapshot> {
  await verifyMembershipSession(session, signal);
  const path = request.kind === 'knowledge' ? route(request.scope, `tasks/${id(request.task_id)}/knowledge/commands`) : request.kind === 'excerpt' ? route(request.scope, 'knowledge/excerpts') : request.kind === 'recover' ? route(request.scope, `knowledge/evidence/${id(request.evidence_id)}/recover`) : `${preferencePath(request.organisation_id)}${request.kind === 'observe' ? '/observations' : ''}`;
  const value = await readJson(path, signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, body: JSON.stringify(request.body) });
  await verifyMembershipSession(session, signal);
  return request.kind === 'observe' ? parsePreference(value, request.organisation_id, session.identity.id) : parseKnowledgeReceipt(value);
}
export function knowledgeAudience(session: Session, organisation: string, scope?: Scope, task?: string): string { return JSON.stringify([session.identity.id, session.csrf_token, organisation, scope?.client_id ?? null, scope?.engagement_id ?? null, task ?? null]); }
export function knowledgeFailure(error: unknown): string { return error instanceof AccessError && error.status === 409 ? 'This knowledge or its current basis changed. Inspect the latest basis before editing the retained draft.' : error instanceof AccessError && error.status === 400 ? 'Check the exact identifiers, dates, byte boundaries and required text.' : error instanceof AccessError && error.status === 429 ? 'Knowledge capacity is busy or full. Your existing draft and receipt recovery are retained.' : error instanceof AccessError && [401, 403, 404, 412].includes(error.status) ? 'Current access was refused. Private drafts have been cleared.' : 'Delivery is unconfirmed. Retry the exact request after current access returns.'; }
export function knowledgeRefused(error: unknown, recovering = false): boolean { return error instanceof AccessError && ([400, 401, 403, 404, 409, 412, 413].includes(error.status) || error.status === 429 && !recovering); }

// Private drafts and uncertain commands survive App remount only in memory.
// Admission checks the prospective total without evicting existing recovery.
type Custody = { actor: string; session: string; scope: Scope | null; draft: KnowledgeDraft | null; pending: KnowledgeRequest | null; outcome: KnowledgeOutcome | null };
const custody = new Map<string, Custody>();
export const KNOWLEDGE_CUSTODY_BYTES = 2 * 1024 * 1024;
export const knowledgeCustodyFailure = 'Knowledge draft recovery is full (16 audiences or 2 MiB). Finish or cancel an existing draft, or recover its receipt. This change was not sent.';
export function withdrawReplacedKnowledgeSession(session: Session): void { for (const [key, value] of custody) if (value.actor !== session.identity.id || value.session !== session.csrf_token) custody.delete(key); }
export function retainKnowledge(owner: string, session: Session, scope: Scope | null, patch: { draft?: KnowledgeDraft | null; pending?: KnowledgeRequest | null; outcome?: KnowledgeOutcome | null }): boolean {
  withdrawReplacedKnowledgeSession(session);
  const entry: Custody = structuredClone({ actor: session.identity.id, session: session.csrf_token, scope, draft: null, pending: null, outcome: null, ...custody.get(owner), ...patch });
  if (!entry.draft && !entry.pending && !entry.outcome) { custody.delete(owner); return true; }
  const next = new Map(custody); next.set(owner, entry);
  if (next.size > 16 || [...next.values()].reduce((total, item) => total + new TextEncoder().encode(JSON.stringify(item)).length, 0) > KNOWLEDGE_CUSTODY_BYTES) return false;
  custody.set(owner, entry); return true;
}
export function recoverKnowledge(owner: string, session: Session): { draft: KnowledgeDraft | null; pending: KnowledgeRequest | null } { withdrawReplacedKnowledgeSession(session); const entry = custody.get(owner); return entry ? structuredClone({ draft: entry.draft, pending: entry.pending }) : { draft: null, pending: null }; }
export function discardKnowledgeOwner(owner: string): void { custody.delete(owner); }
export function discardKnowledgeCustody(scope?: Scope): void { if (!scope) custody.clear(); else for (const [key, value] of custody) if (value.scope && sameScope(value.scope, scope)) custody.delete(key); }

/** Ordinary navigation abandons unsent edits, never an admitted/uncertain request. */
export function discardUnsubmittedKnowledgeDrafts(scope: Scope): void {
  for (const [key, value] of custody) if (value.scope && sameScope(value.scope, scope) && !value.pending) {
    if (value.outcome) custody.set(key, { ...value, draft: null }); else custody.delete(key);
  }
}
export function recoverKnowledgeOutcome(owner: string, session: Session): KnowledgeOutcome | null {
  withdrawReplacedKnowledgeSession(session); return structuredClone(custody.get(owner)?.outcome ?? null);
}
