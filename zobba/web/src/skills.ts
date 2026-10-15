import { AccessError, readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import type { Scope } from './engagements.ts';
import { verifyMembershipSession } from './membership.ts';
import { parseTaskBasis } from './methodology.ts';
import type { components } from './generated/api.ts';

export type SkillManifest = components['schemas']['SkillManifest'];
export type SkillVersion = components['schemas']['SkillVersion'];
export type SkillCatalog = components['schemas']['SkillCatalogSnapshot'];
export type SkillAssignmentPage = components['schemas']['SkillAssignmentPage'];
export type SkillStatusHistory = components['schemas']['SkillStatusHistory'];
export type SkillSelectionImpactPage = components['schemas']['SkillSelectionImpactPage'];
export type SkillStatusEvent = components['schemas']['SkillStatusEvent'];
export type SkillCatalogReceipt = components['schemas']['SkillCatalogReceipt'];
export type SkillInspection = components['schemas']['SkillInspection'];
export type SkillSelectionView = components['schemas']['SkillSelectionView'];
export type TaskSkills = components['schemas']['TaskSkillsResponse'];
export type InstallSkill = components['schemas']['InstallSkillRequest'];
export type ChangeSkillStatus = components['schemas']['ChangeSkillStatusRequest'];
export type SelectSkill = components['schemas']['SelectSkillRequest'];
export type CatalogAction = { kind: 'install'; organisation_id: string; body: InstallSkill } | { kind: 'status'; organisation_id: string; body: ChangeSkillStatus };
export type SelectionAction = { kind: 'select'; scope: Scope; task_id: string; body: SelectSkill };
export type SkillAction = CatalogAction | SelectionAction;
export type SkillStatusDraft = { version: SkillVersion; status: ChangeSkillStatus['status']; reason: string; expected_revision: string };
export type SkillDraft = { kind: 'install-draft'; organisation_id: string; body: InstallSkill } | { kind: 'status-draft'; organisation_id: string; body: SkillStatusDraft } | { kind: 'selection-draft'; scope: Scope; task_id: string; body: SelectSkill };
export type SkillFieldErrors = Record<string, string>;
// Catalog/discovery combines bounded 2 MiB manifests, immutable selection history
// and current per-need observations. Ordinary endpoints retain their 4 MiB limit.
export const SKILL_JSON_BYTES = 8 * 1024 * 1024;
export const skillTools = ['live_read_v1', 'test_read_v1', 'test_write_v1', 'test_send_v1', 'audit_read_v1', 'audit_write_v1', 'audit_send_v1', 'analysis_v1'] as const;
export const skillStatusLabels = { eligible: 'Technique may be selected', unavailable: 'Unavailable', forbidden: 'Forbidden by current authority', disabled: 'Disabled', recalled: 'Recalled', inapplicable: 'Not applicable to this methodology', methodology_blocked: 'Current methodology blocks new use', task_blocked: 'Task controls block new use' } as const;

function invalid(): never { throw new Error('Invalid skill response'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(); return value; }
function revision(value: unknown): string { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) invalid(); return value; }
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); return value; }
const edgeWhitespace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;
const surrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function text(value: unknown, maximum = 2000): string { if (typeof value !== 'string' || !value || [...value].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value) || edgeWhitespace.test(value) || surrogate.test(value)) invalid(); return value; }
function inspectionReason(value: unknown): string { const reason = text(value, 256); if (new TextEncoder().encode(reason).length > 256) invalid(); return reason; }
function content(value: unknown): string { if (typeof value !== 'string' || /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(value) || surrogate.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) || new TextEncoder().encode(value).length > 32768) invalid(); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function timestamp(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 253402300799) invalid(); return value; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value == null ? null : parse(value); }
function list<T>(value: unknown, parse: (value: unknown) => T, maximum = 32): T[] { if (!Array.isArray(value) || value.length > maximum) invalid(); return value.map(item => parse(item)); }
function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T { if (!allowed.includes(value as T)) invalid(); return value as T; }
function unique<T>(values: T[], key: (value: T) => string): T[] { if (new Set(values.map(key)).size !== values.length) invalid(); return values; }
function orderedIds(value: unknown, maximum: number): string[] { const values = list(value, id, maximum); if (values.some((entry, index) => index > 0 && values[index - 1]! >= entry)) invalid(); return values; }
function day(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid(); return value; }
function applicability(value: unknown): InstallSkill['applicability'] { const v = object(value), audit_area = nullable(v.audit_area, value => text(value, 200)), period_start = nullable(v.period_start, day), period_end = nullable(v.period_end, day); if ((period_start === null) !== (period_end === null) || period_start !== null && period_end !== null && period_start > period_end) invalid(); return { audit_area, period_start, period_end }; }
function assignment(value: unknown): InstallSkill['assignment'] { const v = object(value), kind = enumeration(v.kind, ['firm', 'client', 'engagement']), client_id = nullable(v.client_id, id), engagement_id = nullable(v.engagement_id, id); if (kind === 'firm' && (client_id !== null || engagement_id !== null) || kind === 'client' && (client_id === null || engagement_id !== null) || kind === 'engagement' && (client_id === null || engagement_id === null)) invalid(); return { kind, client_id, engagement_id }; }
export function parseSkillManifest(value: unknown): SkillManifest {
  const v = object(value), source = object(v.source);
  if (v.schema_version !== 1) invalid();
  const resources = unique(list(v.resources, value => { const r = object(value); return { id: id(r.id), kind: enumeration(r.kind, ['text', 'script']), content: content(r.content) }; }, 16), r => r.id);
  if (resources.reduce((size, r) => size + new TextEncoder().encode(r.content).length, 0) > 131072) invalid();
  const manifest: SkillManifest = { schema_version: 1, id: id(v.id), version: id(v.version), name: text(v.name, 200), description: text(v.description),
    source: { reference: text(source.reference), revision: text(source.revision), license: text(source.license) },
    inputs: unique(list(v.inputs, value => { const i = object(value); return { id: id(i.id), label: text(i.label, 200), required: bool(i.required) }; }), i => i.id),
    outputs: list(v.outputs, value => text(value)),
    needs: unique(list(v.needs, value => { const n = object(value); return { id: id(n.id), tool: enumeration(n.tool, skillTools), account_id: nullable(n.account_id, id), environment_id: nullable(n.environment_id, id), destination: nullable(n.destination, id), resource_id: nullable(n.resource_id, id), recipients: orderedIds(n.recipients, 16), attachment_classifications: orderedIds(n.attachment_classifications, 16), requires_attachments: bool(n.requires_attachments) }; }, 16), n => n.id),
    method_version_ids: orderedIds(v.method_version_ids, 32), resources };
  if (manifestBytes(manifest) > 200000) invalid();
  return manifest;
}
/** Exact size of the server's length-framed manifest encoding, before SHA-256. */
function manifestBytes(manifest: SkillManifest): number {
  const bytes = (value: string) => 4 + new TextEncoder().encode(value).length;
  const strings = (values: string[]) => 4 + values.reduce((sum, value) => sum + bytes(value), 0);
  return new TextEncoder().encode('zobba-skill-manifest\0').length + 2
    + [manifest.id, manifest.version, manifest.name, manifest.description, manifest.source.reference, manifest.source.revision, manifest.source.license].reduce((sum, value) => sum + bytes(value), 0)
    + 4 + manifest.inputs.reduce((sum, input) => sum + bytes(input.id) + bytes(input.label) + 1, 0)
    + strings(manifest.outputs) + 4 + manifest.needs.reduce((sum, need) => sum + bytes(need.id) + bytes(need.tool)
      + [need.account_id, need.environment_id, need.destination, need.resource_id].reduce<number>((total, value) => total + 1 + (value == null ? 0 : bytes(value)), 0)
      + strings(need.recipients) + strings(need.attachment_classifications) + 1, 0)
    + strings(manifest.method_version_ids) + 4 + manifest.resources.reduce((sum, resource) => sum + bytes(resource.id) + bytes(resource.kind) + bytes(resource.content), 0);
}
export function parseInstallSkill(value: unknown): InstallSkill { const v = object(value); return { key: id(v.key), expected_revision: revision(v.expected_revision), assignment: assignment(v.assignment), applicability: applicability(v.applicability), manifest: parseSkillManifest(v.manifest), enabled: bool(v.enabled) }; }
/** Canonicalize set order only when submitting; preserve every editable line and
 * exact source/resource byte in the live draft. Duplicate or blank IDs refuse. */
export function prepareSkillInstall(draft: InstallSkill): InstallSkill {
  const command = structuredClone(draft);
  command.manifest.method_version_ids.sort();
  for (const need of command.manifest.needs) { need.recipients.sort(); need.attachment_classifications.sort(); }
  return parseInstallSkill(command);
}
/** Describe authoring failures without trimming, canonicalizing or truncating the
 * editable draft. Field paths are stable associations for the corresponding UI. */
export function skillProseError(value: string, maximum = 2000, required = true): string | null {
  if (!value && !required) return null;
  if (!value) return 'Enter a value.';
  if (surrogate.test(value)) return 'Use complete Unicode characters; an unpaired surrogate is invalid.';
  if ([...value].length > maximum) return `Use at most ${maximum} Unicode characters; this value has ${[...value].length}.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return 'Use single-line text without control characters.';
  if (edgeWhitespace.test(value)) return 'Remove surrounding whitespace; the entered text is preserved until you edit it.';
  return null;
}
export function validateSkillInstall(draft: InstallSkill): SkillFieldErrors {
  const errors: SkillFieldErrors = {}, m = draft.manifest, bytes = (value: string) => new TextEncoder().encode(value).length;
  const put = (field: string, message: string | null) => { if (message) errors[field] = message; };
  const identifier = (field: string, value: string) => put(field, /^[A-Za-z0-9_-]{1,128}$/.test(value) ? null : 'Use 1–128 ASCII letters, digits, underscores or hyphens.');
  const prose = (field: string, value: string, maximum = 2000, required = true) => put(field, skillProseError(value, maximum, required));
  const ids = (field: string, values: string[], maximum: number) => {
    put(field, values.length > maximum ? `Use at most ${maximum} identifiers, one per line.` : values.some(value => !/^[A-Za-z0-9_-]{1,128}$/.test(value)) ? 'Each line must contain one 1–128 character ASCII identifier; blank lines are invalid.' : new Set(values).size !== values.length ? 'Remove duplicate identifiers; each identifier must be unique.' : null);
  };
  const repeated = (field: string, values: { id: string }[], maximum: number) => {
    if (values.length > maximum) put(field, `Use at most ${maximum} items.`);
    const counts = new Map<string, number>(); for (const value of values) counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
    values.forEach((value, index) => { identifier(`${field}.${index}.id`, value.id); if (counts.get(value.id)! > 1) put(`${field}.${index}.id`, 'Remove this duplicate identifier or give it a unique identifier.'); });
  };
  identifier('manifest.id', m.id); identifier('manifest.version', m.version); prose('manifest.name', m.name, 200); prose('manifest.description', m.description);
  for (const field of ['reference', 'revision', 'license'] as const) prose(`manifest.source.${field}`, m.source[field]);
  if (draft.assignment.kind !== 'firm') identifier('assignment.client_id', draft.assignment.client_id ?? '');
  if (draft.assignment.kind === 'engagement') identifier('assignment.engagement_id', draft.assignment.engagement_id ?? '');
  prose('applicability.audit_area', draft.applicability.audit_area ?? '', 200, false);
  const { period_start: start, period_end: end } = draft.applicability;
  for (const [field, value] of [['period_start', start], ['period_end', end]] as const) {
    if (value) { try { day(value); } catch { put(`applicability.${field}`, 'Enter a valid calendar date.'); } }
    if (!!start !== !!end) put(`applicability.${field}`, 'Enter both period start and period end, or leave both blank.');
    if (start && end && start > end) put(`applicability.${field}`, 'Period start must be on or before period end.');
  }
  ids('manifest.method_version_ids', m.method_version_ids, 32);
  repeated('manifest.inputs', m.inputs, 32); m.inputs.forEach((input, index) => prose(`manifest.inputs.${index}.label`, input.label, 200));
  put('manifest.outputs', m.outputs.length > 32 ? 'Use at most 32 output descriptions, one per line.' : null);
  m.outputs.forEach((output, index) => { const error = skillProseError(output); if (error) put('manifest.outputs', `Output ${index + 1}: ${error}`); });
  repeated('manifest.needs', m.needs, 16);
  m.needs.forEach((need, index) => {
    const path = `manifest.needs.${index}`;
    for (const field of ['account_id', 'environment_id', 'destination', 'resource_id'] as const) if (need[field] !== null) identifier(`${path}.${field}`, need[field]!);
    ids(`${path}.recipients`, need.recipients, 16); ids(`${path}.attachment_classifications`, need.attachment_classifications, 16);
  });
  repeated('manifest.resources', m.resources, 16);
  const total = m.resources.reduce((sum, resource) => sum + bytes(resource.content), 0);
  m.resources.forEach((resource, index) => {
    const path = `manifest.resources.${index}.content`, size = bytes(resource.content);
    if (total > 131072) put(path, `Resources total ${total} UTF-8 bytes; reduce the total to at most 131072 bytes (128 KiB).`);
    if (size > 32768) put(path, `This resource is ${size} UTF-8 bytes; use at most 32768 bytes (32 KiB).`);
    else if (surrogate.test(resource.content) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(resource.content)) put(path, 'Use complete Unicode characters without control characters other than tab or line breaks.');
    else if (!resource.content || /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(resource.content)) put(path, 'Enter resource content containing more than whitespace.');
  });
  if (manifestBytes(m) > 200000) put('manifest', 'The encoded manifest exceeds 200000 bytes. Reduce descriptions, outputs or resource content.');
  return errors;
}
function statusEvent(value: unknown): SkillStatusEvent { const v = object(value); return { event_id: id(v.event_id), actor_id: id(v.actor_id), recorded_at: timestamp(v.recorded_at), revision: revision(v.revision), status: enumeration(v.status, ['enabled', 'disabled', 'recalled']), reason: nullable(v.reason, value => text(value)) }; }
function version(value: unknown): SkillVersion {
  const v = object(value), command = parseInstallSkill(v.command), resource_digests = unique(list(v.resource_digests, value => { const r = object(value); return { id: id(r.id), digest: digest(r.digest) }; }, 16), r => r.id);
  if (resource_digests.length !== command.manifest.resources.length || resource_digests.some(r => !command.manifest.resources.some(resource => resource.id === r.id))) invalid();
  const result: SkillVersion = { id: id(v.id), actor_id: id(v.actor_id), installed_at: timestamp(v.installed_at), revision: revision(v.revision), command, digest: digest(v.digest), resource_digests, status: enumeration(v.status, ['enabled', 'disabled', 'recalled']), status_revision: revision(v.status_revision), status_event: statusEvent(v.status_event) };
  if (result.status !== result.status_event.status || result.status_revision !== result.status_event.revision || BigInt(result.status_revision) < BigInt(result.revision)) invalid();
  return result;
}
export function parseSkillCatalog(value: unknown, organisation: string): SkillCatalog { const v = object(value); if (v.organisation_id !== organisation) throw new Error('Skill catalog audience changed'); return { organisation_id: id(v.organisation_id), revision: revision(v.revision), versions: unique(list(v.versions, version, 128), v => v.id) }; }
export function parseSkillAssignments(value: unknown, kind: 'client' | 'engagement', client: string | null, after: string | null): SkillAssignmentPage {
  const v = object(value), clients = unique(list(v.clients, value => { const c = object(value); return { client_id: id(c.client_id), client_name: text(c.client_name, 200) }; }, 50), c => c.client_id), engagements = unique(list(v.engagements, value => { const e = object(value); return { client_id: id(e.client_id), engagement_id: id(e.engagement_id), client_name: text(e.client_name, 200), engagement_name: text(e.engagement_name, 200) }; }, 50), e => e.engagement_id), next_after = nullable(v.next_after, id);
  if (kind === 'client' && engagements.length || kind === 'engagement' && (clients.length || engagements.some(e => e.client_id !== client))) invalid();
  const ids = kind === 'client' ? clients.map(c => c.client_id) : engagements.map(e => e.engagement_id);
  if (ids.some((value, index) => (index > 0 ? ids[index - 1]! : after) !== null && value <= (index > 0 ? ids[index - 1]! : after!)) || next_after !== null && (ids.length !== 50 || next_after !== ids.at(-1))) invalid();
  return { clients, engagements, next_after };
}
export function parseSkillStatusHistory(value: unknown, version: string, before: string | null): SkillStatusHistory {
  const v = object(value); if (v.version_id !== version) throw new Error('Skill history audience changed');
  const events = unique(list(v.events, statusEvent, 50), event => event.event_id), next_before_revision = nullable(v.next_before_revision, revision);
  if (events.some((event, index) => { const limit = index > 0 ? events[index - 1]!.revision : before; return limit !== null && BigInt(event.revision) >= BigInt(limit); }) || next_before_revision !== null && (events.length !== 50 || next_before_revision !== events.at(-1)!.revision)) invalid();
  return { version_id: id(v.version_id), events, next_before_revision };
}
function capabilityBound(value: unknown): NonNullable<SkillInspection['needs'][number]['blocking_bound']> {
  const v = object(value), kind = enumeration(v.kind, ['organisation', 'engagement', 'member', 'account', 'task', 'delegation']), delegation_depth = v.delegation_depth === null ? null : v.delegation_depth;
  if (delegation_depth !== null && (typeof delegation_depth !== 'number' || !Number.isInteger(delegation_depth) || delegation_depth < 0 || delegation_depth > 7) || (kind === 'delegation') !== (delegation_depth !== null)) invalid();
  return { accepted: bool(v.accepted), kind, delegation_depth: delegation_depth as number | null };
}
export function parseSkillInspection(value: unknown): SkillInspection { const v = object(value); const inspection: SkillInspection = { version_id: id(v.version_id), skill_id: id(v.skill_id), skill_version: id(v.skill_version), digest: digest(v.digest), catalog_revision: revision(v.catalog_revision), methodology_binding_id: id(v.methodology_binding_id), execution_epoch: revision(v.execution_epoch), authority_actor_id: nullable(v.authority_actor_id, id), status: enumeration(v.status, ['eligible', 'unavailable', 'forbidden', 'disabled', 'recalled', 'inapplicable', 'methodology_blocked', 'task_blocked']), reason: inspectionReason(v.reason), needs: unique(list(v.needs, value => { const n = object(value); return { id: id(n.id), tool: enumeration(n.tool, skillTools), status: enumeration(n.status, ['unavailable', 'forbidden', 'compatible_needs_exact_details']), reason: inspectionReason(n.reason), refresh_at: nullable(n.refresh_at, timestamp), blocking_bound: nullable(n.blocking_bound, capabilityBound) }; }, 16), n => n.id), observed_at: timestamp(v.observed_at), dependency_fingerprint: digest(v.dependency_fingerprint) }; if (inspection.status === 'eligible' && inspection.needs.some(need => need.status !== 'compatible_needs_exact_details')) invalid(); return inspection; }
export function parseSkillSelection(value: unknown, task: string): SkillSelectionView {
  const v = object(value), s = object(v.selection), current = parseSkillInspection(v.current);
  if (s.task_id !== task) throw new Error('Skill selection Task audience changed');
  const methodology = parseTaskBasis({ task_id: task, current: s.methodology, pending: null, history: [], notices: [], recalled: false }, task).current;
  const selection: SkillSelectionView['selection'] = { id: id(s.id), task_id: id(s.task_id), selector_id: id(s.selector_id), authority_actor_id: nullable(s.authority_actor_id, id), selected_at: timestamp(s.selected_at), revision: revision(s.revision), execution_epoch: revision(s.execution_epoch), version_id: id(s.version_id), skill_id: id(s.skill_id), skill_version: id(s.skill_version), digest: digest(s.digest), reason: text(s.reason), methodology, catalog_revision: revision(s.catalog_revision), dependency_fingerprint: digest(s.dependency_fingerprint) };
  if (selection.version_id !== current.version_id || selection.skill_id !== current.skill_id || selection.skill_version !== current.skill_version || selection.digest !== current.digest) invalid();
  return { selection, current };
}
export function parseTaskSkills(value: unknown, task: string): TaskSkills {
  const v = object(value); if (v.task_id !== task) throw new Error('Skill discovery Task audience changed');
  const result: TaskSkills = { task_id: id(v.task_id), catalog_revision: revision(v.catalog_revision), selection_revision: revision(v.selection_revision), methodology_binding_id: id(v.methodology_binding_id), execution_epoch: revision(v.execution_epoch), observed_at: timestamp(v.observed_at),
    candidates: unique(list(v.candidates, value => { const c = object(value), installed = version(c.version), inspection = parseSkillInspection(c.inspection); if (installed.id !== inspection.version_id || installed.digest !== inspection.digest || installed.command.manifest.id !== inspection.skill_id || installed.command.manifest.version !== inspection.skill_version || inspection.needs.length !== installed.command.manifest.needs.length || inspection.needs.some(need => !installed.command.manifest.needs.some(declared => declared.id === need.id && declared.tool === need.tool)) || inspection.status === 'eligible' && installed.status !== 'enabled') invalid(); return { version: installed, inspection }; }, 128), c => c.version.id),
    selections: unique(list(v.selections, value => parseSkillSelection(value, task), 128), s => s.selection.id) };
  for (const inspected of [...result.candidates.map(c => c.inspection), ...result.selections.map(s => s.current)]) if (inspected.catalog_revision !== result.catalog_revision || inspected.methodology_binding_id !== result.methodology_binding_id || inspected.execution_epoch !== result.execution_epoch) invalid();
  return result;
}
export function parseCatalogReceipt(value: unknown, action: CatalogAction, session: Session): SkillCatalogReceipt { const v = object(value); if (v.organisation_id !== action.organisation_id || v.actor_id !== session.identity.id || v.revision !== (BigInt(action.body.expected_revision) + 1n).toString() || action.kind === 'install' && v.status !== (action.body.enabled ? 'enabled' : 'disabled') || action.kind === 'status' && (v.version_id !== action.body.version_id || v.status !== action.body.status)) throw new Error('Skill receipt audience changed'); return { event_id: id(v.event_id), organisation_id: id(v.organisation_id), actor_id: id(v.actor_id), version_id: id(v.version_id), revision: revision(v.revision), status: enumeration(v.status, ['enabled', 'disabled', 'recalled']), affected_selections: revision(v.affected_selections) }; }
export function freezeSkillAction<T extends SkillAction>(action: T): T { const copy = structuredClone(action); const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(copy); return copy; }
export function skillAudience(session: Session, organisation: string, scope?: Scope, task?: string): string { return JSON.stringify([session.identity.id, session.csrf_token, id(organisation), scope?.client_id ?? null, scope?.engagement_id ?? null, task ?? null]); }
function taskPath(scope: Scope, task: string, suffix = ''): string { const query = new URLSearchParams({ organisation_id: id(scope.organisation_id), client_id: id(scope.client_id) }); return `/engagements/${encodeURIComponent(id(scope.engagement_id))}/tasks/${encodeURIComponent(id(task))}/skills${suffix}?${query}`; }
export async function readSkillCatalog(organisation: string, session: Session, signal: AbortSignal): Promise<SkillCatalog> { const value = await readSessionJson(`/skills/organisations/${encodeURIComponent(id(organisation))}`, session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return parseSkillCatalog(value, organisation); }
export async function readSkillAssignments(organisation: string, kind: 'client' | 'engagement', client: string | null, after: string | null, session: Session, signal: AbortSignal): Promise<SkillAssignmentPage> {
  const query = new URLSearchParams({ kind }); if (client) query.set('client_id', id(client)); if (after) query.set('after', id(after));
  const value = await readSessionJson(`/skills/organisations/${encodeURIComponent(id(organisation))}/assignments?${query}`, session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return parseSkillAssignments(value, kind, client, after);
}
export async function readSkillStatusHistory(organisation: string, version: string, before: string | null, session: Session, signal: AbortSignal): Promise<SkillStatusHistory> {
  const query = new URLSearchParams(); if (before) query.set('before_revision', revision(before));
  const value = await readSessionJson(`/skills/organisations/${encodeURIComponent(id(organisation))}/versions/${encodeURIComponent(id(version))}/history${before ? `?${query}` : ''}`, session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return parseSkillStatusHistory(value, version, before);
}
export function parseSkillImpacts(value: unknown, scope: Scope, version: string | null, after: SkillSelectionImpactPage['next_after']): SkillSelectionImpactPage {
  const v = object(value); if (v.organisation_id !== scope.organisation_id || v.client_id !== scope.client_id || v.engagement_id !== scope.engagement_id || v.version_id !== version) throw new Error('Skill impact audience changed');
  const selections = unique(list(v.selections, value => { const s = object(value); return { task_id: id(s.task_id), selection_id: id(s.selection_id), selector_id: id(s.selector_id), selected_at: timestamp(s.selected_at), selection_revision: revision(s.selection_revision), version_id: id(s.version_id), skill_id: id(s.skill_id), skill_version: id(s.skill_version), digest: digest(s.digest), methodology_binding_id: id(s.methodology_binding_id), execution_epoch: revision(s.execution_epoch), catalog_revision: revision(s.catalog_revision), status: enumeration(s.status, ['enabled', 'disabled', 'recalled']), status_revision: revision(s.status_revision) }; }, 50), selection => selection.selection_id);
  const next_after = nullable(v.next_after, value => { const cursor = object(value); return { task_id: id(cursor.task_id), revision: revision(cursor.revision) }; });
  for (let index = 0; index < selections.length; index++) { const selection = selections[index]!, previous = index > 0 ? { task_id: selections[index - 1]!.task_id, revision: selections[index - 1]!.selection_revision } : after;
    if (version ? selection.version_id !== version : selection.status === 'enabled') invalid();
    if (previous && (selection.task_id < previous.task_id || selection.task_id === previous.task_id && BigInt(selection.selection_revision) <= BigInt(previous.revision))) invalid();
  }
  const last = selections.at(-1); if (next_after && (selections.length !== 50 || next_after.task_id !== last?.task_id || next_after.revision !== last.selection_revision)) invalid();
  return { organisation_id: id(v.organisation_id), client_id: id(v.client_id), engagement_id: id(v.engagement_id), version_id: version, selections, next_after };
}
export async function readSkillImpacts(scope: Scope, version: string | null, after: SkillSelectionImpactPage['next_after'], session: Session, signal: AbortSignal): Promise<SkillSelectionImpactPage> {
  const query = new URLSearchParams({ organisation_id: id(scope.organisation_id), client_id: id(scope.client_id) }); if (version) query.set('version_id', id(version)); if (after) { query.set('after_task_id', id(after.task_id)); query.set('after_revision', revision(after.revision)); }
  const value = await readSessionJson(`/engagements/${encodeURIComponent(id(scope.engagement_id))}/skills/impacts?${query}`, session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return parseSkillImpacts(value, scope, version, after);
}
export async function readTaskSkills(scope: Scope, task: string, session: Session, signal: AbortSignal): Promise<TaskSkills> { const value = await readSessionJson(taskPath(scope, task), session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return parseTaskSkills(value, task); }
export async function readSelectionEligibility(scope: Scope, task: string, selection: string, session: Session, signal: AbortSignal): Promise<SkillSelectionView> { const value = await readSessionJson(taskPath(scope, task, `/selections/${encodeURIComponent(id(selection))}`), session, signal, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); const result = parseSkillSelection(value, task); if (result.selection.id !== selection) invalid(); return result; }
async function post(action: SkillAction, session: Session, signal: AbortSignal): Promise<unknown> { await verifyMembershipSession(session, signal); const path = action.kind === 'select' ? taskPath(action.scope, action.task_id, '/select') : `/skills/organisations/${encodeURIComponent(id(action.organisation_id))}/${action.kind}`; const value = await readJson(path, signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, body: JSON.stringify(action.body) }, SKILL_JSON_BYTES); await verifyMembershipSession(session, signal); return value; }
export async function applySkillCatalog(action: CatalogAction, session: Session, signal: AbortSignal): Promise<SkillCatalogReceipt> { return parseCatalogReceipt(await post(action, session, signal), action, session); }
export async function selectSkill(action: SelectionAction, session: Session, signal: AbortSignal): Promise<SkillSelectionView> { const value = parseSkillSelection(await post(action, session, signal), action.task_id); if (value.selection.revision !== (BigInt(action.body.expected_selection_revision) + 1n).toString() || value.selection.selector_id !== session.identity.id || value.selection.version_id !== action.body.version_id || value.selection.reason !== action.body.reason || value.selection.methodology.id !== action.body.expected_methodology_binding_id || value.selection.execution_epoch !== action.body.expected_execution_epoch || value.selection.catalog_revision !== action.body.expected_catalog_revision) throw new Error('Skill selection receipt audience changed'); return value; }
export function skillRefused(error: unknown, recovering = false): boolean { return error instanceof AccessError && ([400, 409, 413].includes(error.status) || error.status === 429 && !recovering); }
export function skillFailure(error: unknown, recovering = false): string { return error instanceof AccessError && error.status === 409 ? 'The catalog, methodology or selection basis changed, or this technique is currently blocked. Refresh and review the retained draft before trying again.' : error instanceof AccessError && error.status === 400 ? 'Check the skill identifiers, dates and bounded resources. Metadata and reasons require single-line text without surrounding whitespace; resource content may contain line breaks.' : error instanceof AccessError && error.status === 429 && !recovering ? 'The request was refused because the service is busy or its capacity limit has been reached. Your draft is retained.' : error instanceof AccessError && [401, 403, 404, 412].includes(error.status) ? 'Current access could not be verified. Private skill drafts have been cleared.' : 'Delivery is unconfirmed. Check current access, then retry the exact request to recover its receipt.'; }
// Memory only: unsent drafts and uncertain commands survive a workspace remount.
// The bounded store has at most 16 exact audiences and 8 MiB of serialized private
// content. Never use browser persistence for these drafts or retry commands.
const retained = new Map<string, { actor: string; session: string; action: SkillAction | null; draft: SkillDraft | null }>();
export const SKILL_CUSTODY_BYTES = 8 * 1024 * 1024;
function storeSkillCustody(owner: string, session: Session, patch: { action?: SkillAction | null; draft?: SkillDraft | null }): boolean {
  withdrawReplacedSkillSession(session);
  const entry = { actor: session.identity.id, session: session.csrf_token, action: null, draft: null, ...retained.get(owner), ...patch };
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  if (!entry.action && !entry.draft) { retained.delete(owner); return true; }
  if (size(entry) > SKILL_CUSTODY_BYTES) return false;
  const next = new Map(retained); next.delete(owner); next.set(owner, entry);
  if (next.size > 16 || [...next.values()].reduce((total, value) => total + size(value), 0) > SKILL_CUSTODY_BYTES) return false;
  retained.clear(); for (const [key, value] of next) retained.set(key, value);
  return true;
}
export function withdrawReplacedSkillSession(session: Session): void { for (const [key, value] of retained) if (value.actor !== session.identity.id || value.session !== session.csrf_token) retained.delete(key); }
export const skillCustodyFailure = 'Skill draft recovery is full (16 audiences or 8 MiB). This change was not accepted or sent. Finish or cancel an existing skill draft, or recover a pending receipt, before trying again.';
export function retainSkillAction(owner: string, session: Session, action: SkillAction): boolean { return storeSkillCustody(owner, session, { action: freezeSkillAction(action) }); }
export function recoverSkillAction(owner: string, session: Session): SkillAction | null { withdrawReplacedSkillSession(session); return retained.get(owner)?.action ?? null; }
export function retainSkillDraft(owner: string, session: Session, draft: SkillDraft | null): boolean { return storeSkillCustody(owner, session, { draft: draft && structuredClone(draft) }); }
export function recoverSkillDraft(owner: string, session: Session): SkillDraft | null { withdrawReplacedSkillSession(session); const draft = retained.get(owner)?.draft; return draft ? structuredClone(draft) : null; }
export function recoverSkillOrganisation(session: Session): string | null { withdrawReplacedSkillSession(session); for (const value of [...retained.values()].reverse()) { const entry = value.draft ?? value.action; if (entry && 'organisation_id' in entry) return entry.organisation_id; } return null; }
export function discardSkillPending(owner: string): void { const value = retained.get(owner); if (value) { value.action = null; if (!value.draft) retained.delete(owner); } }
export function discardSkillActions(owner?: string): void { if (owner) retained.delete(owner); else retained.clear(); }
function entryScope(value: { action: SkillAction | null; draft: SkillDraft | null }): Scope | null { const entry = value.draft ?? value.action; return entry && 'scope' in entry ? entry.scope : null; }
/** A definite scope refusal withdraws all private skill custody for that scope. */
export function discardSkillScopeActions(scope: Scope): void {
  for (const [key, value] of retained) { const owned = entryScope(value); if (owned?.organisation_id === scope.organisation_id && owned.client_id === scope.client_id && owned.engagement_id === scope.engagement_id) retained.delete(key); }
}
/** Definite Admin denial clears only that organisation's configuration custody. */
export function discardSkillCatalogActions(organisation: string): void {
  for (const [key, value] of retained) { const entry = value.draft ?? value.action; if (entry && 'organisation_id' in entry && entry.organisation_id === organisation) retained.delete(key); }
}
