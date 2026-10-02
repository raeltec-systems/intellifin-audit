import { AccessError, readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { verifyMembershipSession } from './membership.ts';
import type { Scope } from './engagements.ts';
import type { components } from './generated/api.ts';

type WireSave = components['schemas']['SaveMethodologyRequest'];
export type Definition = Omit<WireSave['definition'], 'default_context' | 'templates'> & { default_context: NonNullable<WireSave['definition']['default_context']>; templates: NonNullable<WireSave['definition']['templates']> };
export type SaveMethodology = Omit<WireSave, 'definition'> & { definition: Definition };
export type RecallMethodology = components['schemas']['RecallMethodologyRequest'];
type WireSnapshot = components['schemas']['MethodologySnapshot'];
export type MethodologySnapshot = Omit<WireSnapshot, 'versions'> & { versions: (Omit<WireSnapshot['versions'][number], 'command'> & { command: SaveMethodology })[] };
export type MethodologyReceipt = components['schemas']['MethodologyReceipt'];
export type TaskBasis = components['schemas']['TaskMethodologyResponse'];
export type Requirement = Definition['requirements'][number];
export type MethodologyVersion = MethodologySnapshot['versions'][number];
export type InheritanceMode = 'inherit' | 'value' | 'clear';
export type MethodologyAction =
  | { kind: 'save'; organisation_id: string; body: SaveMethodology }
  | { kind: 'recall'; organisation_id: string; body: RecallMethodology };

export function newMethodologyRequirement(identifier: string): Requirement {
  return { id: identifier, label: null, mandatory: true, criteria: null, populations: null, evidence_checks: null,
    ratings: null, review_rules: null, templates: null, suitable_skills: null };
}
export function inheritanceMode<T>(values: T[] | null | undefined): InheritanceMode {
  return values == null ? 'inherit' : values.length ? 'value' : 'clear';
}
export function inheritanceValue<T>(mode: InheritanceMode, values: T[] | null | undefined, blank: T): T[] | null {
  return mode === 'inherit' ? null : mode === 'clear' ? [] : values?.length ? values : [blank];
}
/** Assignment equality does not establish ancestry: independent packages may overlap. */
export function methodologyLineageHead(versions: readonly MethodologyVersion[], identifier: string): MethodologyVersion | null {
  let head = versions.find(version => version.id === identifier);
  const visited = new Set<string>();
  while (head && !visited.has(head.id)) {
    visited.add(head.id);
    const successors = versions.filter(version => version.command.supersedes === head!.id);
    if (successors.length === 0) return head;
    if (successors.length !== 1) return null;
    head = successors[0];
  }
  return null;
}
export function methodologyEditCommand(snapshot: MethodologySnapshot, identifier: string, undo: boolean, key: string): SaveMethodology {
  const selected = snapshot.versions.find(version => version.id === identifier);
  const head = methodologyLineageHead(snapshot.versions, identifier);
  if (!selected || !head || !undo && head.recalled) throw new Error('Current methodology lineage is unavailable');
  const source = undo ? selected : head;
  const command = structuredClone(source.command);
  command.key = key; command.expected_revision = snapshot.revision; command.supersedes = head.id;
  command.undo_of = undo ? selected.id : null; command.activation = { mode: 'new_tasks', available_at: 0 };
  command.source = { kind: command.definition.neutral_starter ? 'neutral_starter' : 'authored', reference: source.id,
    note: undo ? 'Undo by saving a successor in this methodology lineage.' : 'Edited from the current recorded version.' };
  return command;
}
export function methodologyReviewCommand(snapshot: MethodologySnapshot, draft: SaveMethodology, key: string): SaveMethodology {
  const command = structuredClone(draft);
  command.key = key; command.expected_revision = snapshot.revision;
  if (command.supersedes) {
    const head = methodologyLineageHead(snapshot.versions, command.supersedes);
    if (!head) throw new Error('Current methodology lineage is unavailable');
    command.supersedes = head.id;
  }
  return command;
}

function invalid(): never { throw new Error('Invalid methodology response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid();
  return value;
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) invalid();
  return value;
}
const edgeWhitespace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== 'string' || !value || [...value].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value) || edgeWhitespace.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) invalid();
  return value;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value == null ? null : parse(value); }
function list<T>(value: unknown, parse: (value: unknown) => T, maximum = 100): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value.map(item => parse(item));
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 253402300799) invalid();
  return value;
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function applicability(value: unknown): SaveMethodology['applicability'] {
  const v = object(value);
  const audit_area = nullable(v.audit_area, value => text(value, 200));
  const period_start = nullable(v.period_start, day), period_end = nullable(v.period_end, day);
  if ((period_start === null) !== (period_end === null) || period_start !== null && period_end !== null && period_start > period_end) invalid();
  return { audit_area, period_start, period_end };
}
function assignment(value: unknown): SaveMethodology['assignment'] {
  const v = object(value), client_id = nullable(v.client_id, id), engagement_id = nullable(v.engagement_id, id);
  if (v.kind !== 'firm' && v.kind !== 'client' && v.kind !== 'engagement' ||
    v.kind === 'firm' && (client_id !== null || engagement_id !== null) || v.kind === 'client' && (client_id === null || engagement_id !== null) ||
    v.kind === 'engagement' && (client_id === null || engagement_id === null)) invalid();
  return { kind: v.kind, client_id, engagement_id };
}
function versionReference(value: unknown): NonNullable<Requirement['templates']>[number] {
  const v = object(value); return { id: id(v.id), version: id(v.version) };
}
function templateContent(value: unknown, maximum = 2000): string {
  if (typeof value !== 'string' || /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(value) || [...value].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) invalid();
  return value;
}
function template(value: unknown): Definition['templates'][number] {
  const v = object(value);
  return { id: id(v.id), version: id(v.version), name: text(v.name, 200), sections: list(v.sections, value => {
    const section = object(value); return { id: id(section.id), title: text(section.title, 200), content: templateContent(section.content), required: bool(section.required) };
  }, 32) };
}
export function parseDefinition(value: unknown, resolved = false): Definition {
  const v = object(value);
  const requirements = list(v.requirements, value => {
    const r = object(value);
    return { id: id(r.id), label: nullable(r.label, value => text(value, 200)), mandatory: bool(r.mandatory),
      criteria: nullable(r.criteria, value => list(value, text, resolved ? 4096 : 32)), populations: nullable(r.populations, value => list(value, text, resolved ? 4096 : 32)),
      evidence_checks: nullable(r.evidence_checks, value => list(value, text, resolved ? 4096 : 32)), ratings: nullable(r.ratings, value => list(value, text, resolved ? 4096 : 32)),
      review_rules: nullable(r.review_rules, value => list(value, text, resolved ? 4096 : 32)), templates: nullable(r.templates, value => list(value, versionReference, resolved ? 4096 : 32)),
      suitable_skills: nullable(r.suitable_skills, value => list(value, versionReference, resolved ? 4096 : 32)) };
  });
  if (new Set(requirements.map(r => r.id)).size !== requirements.length) invalid();
  return { name: text(v.name, 200), neutral_starter: bool(v.neutral_starter), default_context: applicability(v.default_context), templates: list(v.templates, template, 32), requirements };
}
function source(value: unknown): SaveMethodology['source'] {
  const v = object(value);
  if (!['authored', 'imported_proposal', 'neutral_starter'].includes(v.kind as string)) invalid();
  return { kind: v.kind as SaveMethodology['source']['kind'], reference: nullable(v.reference, text), note: nullable(v.note, text) };
}
function activation(value: unknown): SaveMethodology['activation'] {
  const v = object(value); if (v.mode !== 'new_tasks' && v.mode !== 'active_tasks') invalid();
  return { mode: v.mode, available_at: timestamp(v.available_at) };
}
export function parseSaveMethodology(value: unknown): SaveMethodology {
  const v = object(value);
  return { key: id(v.key), expected_revision: revision(v.expected_revision), supersedes: nullable(v.supersedes, id), undo_of: nullable(v.undo_of, id),
    assignment: assignment(v.assignment), applicability: applicability(v.applicability), activation: activation(v.activation),
    definition: parseDefinition(v.definition), source: source(v.source) };
}
/** Freeze the complete meaning before the first POST. No dates or keys are regenerated for retry. */
export function freezeMethodologyAction(action: MethodologyAction): MethodologyAction {
  const copy: MethodologyAction = JSON.parse(JSON.stringify(action));
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(copy); return copy;
}
export function methodologyAudience(session: Session, organisation: string): string {
  return JSON.stringify([session.identity.id, session.csrf_token, id(organisation)]);
}
function impact(value: unknown): MethodologyReceipt['impact'] {
  const v = object(value);
  if (v.activation_mode !== 'new_tasks' && v.activation_mode !== 'active_tasks') invalid();
  return { id: id(v.id), version_id: id(v.version_id), activation_mode: v.activation_mode,
    affected_tasks: revision(v.affected_tasks), pending_tasks: revision(v.pending_tasks), retained_tasks: revision(v.retained_tasks),
    potentially_material: bool(v.potentially_material), diff: list(v.diff, value => text(value, 2010)) };
}
export function parseMethodologySnapshot(value: unknown, organisation: string): MethodologySnapshot {
  const v = object(value);
  if (v.organisation_id !== organisation) throw new Error('Methodology audience changed unexpectedly');
  const versions = list(v.versions, value => {
    const row = object(value); return { id: id(row.id), actor_id: id(row.actor_id), saved_at: timestamp(row.saved_at), revision: revision(row.revision),
      command: parseSaveMethodology(row.command), recalled: bool(row.recalled) };
  }, 128);
  if (new Set(versions.map(v => v.id)).size !== versions.length) invalid();
  const engagements = list(v.engagements, value => {
    const row = object(value); return { client_id: id(row.client_id), engagement_id: id(row.engagement_id), client_name: text(row.client_name, 200), engagement_name: text(row.engagement_name, 200) };
  }, 512);
  return { organisation_id: id(v.organisation_id), revision: revision(v.revision), versions, impacts: list(v.impacts, impact, 256), engagements };
}
export function parseMethodologyReceipt(value: unknown, session: Session, action: MethodologyAction): MethodologyReceipt {
  const v = object(value);
  if (v.organisation_id !== action.organisation_id || v.actor_id !== session.identity.id || v.kind !== action.kind ||
    action.kind === 'recall' && v.version_id !== action.body.version_id) throw new Error('Methodology receipt audience changed unexpectedly');
  const parsedImpact = impact(v.impact);
  if (parsedImpact.version_id !== v.version_id) invalid();
  return { event_id: id(v.event_id), organisation_id: id(v.organisation_id), actor_id: id(v.actor_id), version_id: id(v.version_id),
    revision: revision(v.revision), kind: action.kind, impact: parsedImpact };
}
function resolution(value: unknown): TaskBasis['current']['resolution'] {
  const v = object(value);
  if (!['resolved', 'neutral', 'incomplete', 'ambiguous', 'recalled'].includes(v.status as string)) invalid();
  const requirements = list(v.requirements, value => {
    const row = object(value);
    const definition = parseDefinition({ name: 'Resolved requirements', neutral_starter: false, default_context: { audit_area: null, period_start: null, period_end: null }, templates: [], requirements: [row.requirement] }, true);
    return { requirement: definition.requirements[0]!, source_version_ids: list(row.source_version_ids, id, 128), field_sources: list(row.field_sources, value => { const field = object(value); return { field: text(field.field, 128), version_ids: list(field.version_ids, id, 128) }; }) };
  }, 12800);
  return { status: v.status as TaskBasis['current']['resolution']['status'], context: applicability(v.context), version_ids: list(v.version_ids, id, 128), neutral_source_version_ids: list(v.neutral_source_version_ids, id, 129),
    requirements, templates: list(v.templates, value => { const t = object(value); return { template: template(t.template), source_version_id: id(t.source_version_id) }; }, 4096), issues: list(v.issues, text, 32768), reason: text(v.reason) };
}
function binding(value: unknown): TaskBasis['current'] {
  const v = object(value);
  if (!('context_command_id' in v)) invalid();
  return { id: id(v.id), actor_id: id(v.actor_id), bound_at: timestamp(v.bound_at), execution_epoch: revision(v.execution_epoch), candidate_version_ids: list(v.candidate_version_ids, id, 128), context_command_id: nullable(v.context_command_id, id), resolution: resolution(v.resolution) };
}
export function parseTaskBasis(value: unknown, task: string): TaskBasis {
  const v = object(value);
  if (v.task_id !== task) throw new Error('Methodology Task audience changed unexpectedly');
  const pending = nullable(v.pending, value => {
    const row = object(value); return { id: id(row.id), actor_id: id(row.actor_id), requested_at: timestamp(row.requested_at), resolution: resolution(row.resolution), reason: templateContent(row.reason, 4096) };
  });
  return { task_id: id(v.task_id), current: binding(v.current), pending, history: list(v.history, binding, 4096), notices: list(v.notices, value => { const notice = object(value); return { id: id(notice.id), version_id: id(notice.version_id), actor_id: id(notice.actor_id), requested_at: timestamp(notice.requested_at), impact: impact(notice.impact) }; }, 256), recalled: bool(v.recalled) };
}
export function methodologyIssueLabel(issue: string, requirementLabels: ReadonlyMap<string, string>): string {
  const [kind, subject, version] = issue.split(':');
  const requirement = subject ? requirementLabels.get(subject) ?? subject : null;
  switch (kind) {
    case 'missing_criteria': return requirement ? `Define evaluation criteria for ${requirement}.` : 'Evaluation criteria have not been defined.';
    case 'missing_review_rules': return requirement ? `Define review and issuance rules for ${requirement}.` : 'Review and issuance rules have not been defined.';
    case 'invalid_context': return 'Correct this Task’s audit area and complete business period.';
    case 'conflicting_default_context': return 'Applicable methodology defaults disagree. Specify this Task’s audit context.';
    case 'unresolved_applicability': return 'Confirm this Task’s audit area and business period to check an assignment.';
    case 'overlapping_assignments': return 'Overlapping assignments need an explicit applicability decision.';
    case 'missing_template': return `Template ${subject} (${version}) is unavailable. Provide its exact saved content.`;
    case 'conflicting_template': return `Template ${subject} (${version}) has conflicting saved content. Resolve the template version before use.`;
    default: return 'This part of the methodology needs clarification. Inspect the recorded limitation code for details.';
  }
}
export async function readMethodology(organisation: string, session: Session, signal: AbortSignal): Promise<MethodologySnapshot> {
  const response = await readSessionJson(`/methodology/organisations/${encodeURIComponent(id(organisation))}`, session, signal);
  await verifyMembershipSession(session, signal);
  return parseMethodologySnapshot(response, organisation);
}
export async function applyMethodology(action: MethodologyAction, session: Session, signal: AbortSignal): Promise<MethodologyReceipt> {
  await verifyMembershipSession(session, signal);
  const response = await readJson(`/methodology/organisations/${encodeURIComponent(id(action.organisation_id))}/${action.kind}`, signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id,
      'X-Expected-Session': session.csrf_token }, body: JSON.stringify(action.body),
  });
  await verifyMembershipSession(session, signal);
  return parseMethodologyReceipt(response, session, action);
}
export async function readTaskBasis(scope: Scope, task: string, session: Session, signal: AbortSignal): Promise<TaskBasis> {
  const query = new URLSearchParams({ organisation_id: id(scope.organisation_id), client_id: id(scope.client_id) });
  const response = await readSessionJson(`/engagements/${encodeURIComponent(id(scope.engagement_id))}/tasks/${encodeURIComponent(id(task))}/methodology?${query}`, session, signal);
  await verifyMembershipSession(session, signal);
  return parseTaskBasis(response, task);
}
export function methodologyRefused(error: unknown, recovering = false): boolean {
  return error instanceof AccessError && ([400, 409, 413].includes(error.status) || error.status === 429 && !recovering);
}
export function methodologyFailure(error: unknown, recovering = false): string {
  return error instanceof AccessError && error.status === 409 ? 'The settings changed or this assignment conflicts. Refresh and review before saving again.'
    : error instanceof AccessError && error.status === 400 ? 'The methodology could not be saved. Check the requirements, dates and inherited mandatory rules.'
    : error instanceof AccessError && error.status === 429 ? recovering
      ? 'The service is busy or its capacity limit has been reached. The original delivery remains unconfirmed; retry its exact receipt check when available.'
      : 'The request was refused because the service is busy or its capacity limit has been reached. Your edit is retained; wait, reduce it, or contact your administrator.'
    : error instanceof AccessError && [401, 403, 404, 412].includes(error.status) ? 'Current methodology access could not be verified. Private drafts have been cleared.'
    : 'Delivery could not be confirmed. Check current access, then retry the exact request.';
}

// Uncertain delivery survives a temporary App access outage without persisting
// configuration or session material to browser storage. A new audience discards it.
let retainedAction: { actor: string; session: string; action: MethodologyAction } | null = null;
export function retainMethodologyAction(action: MethodologyAction, session: Session): void {
  retainedAction = { actor: session.identity.id, session: session.csrf_token, action: freezeMethodologyAction(action) };
}
export function recoverMethodologyAction(session: Session): MethodologyAction | null {
  if (!retainedAction) return null;
  if (retainedAction.actor !== session.identity.id || retainedAction.session !== session.csrf_token) { retainedAction = null; return null; }
  return retainedAction.action;
}
export function discardMethodologyAction(): void { retainedAction = null; }
