import { AccessError, parseSession, readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import type { components } from './generated/api.ts';

export type MemberRole = components['schemas']['MembershipRole'];
export type Assignment = components['schemas']['MembershipAssignment'];
export type AssignmentChange = components['schemas']['MembershipAssignmentChange'];
export type AdminOrganisation = components['schemas']['MembershipOrganisation'];
export type OrganisationPage = components['schemas']['MembershipOrganisations'];
export type Member = components['schemas']['MembershipMember'];
export type Invitation = components['schemas']['MembershipInvitation'];
export type AssignableEngagement = components['schemas']['MembershipAssignmentOption'];
export type MembershipSnapshot = components['schemas']['MembershipSnapshot'];
export type MembershipReceipt = components['schemas']['MembershipReceipt'];
export type MembershipCursors = { members_after?: string; invitations_after?: string; engagements_after?: string };
export type SaveMember = components['schemas']['SaveMemberRequest'];
export type IssueInvitation = components['schemas']['InviteMemberRequest'];
export type RevokeInvitation = components['schemas']['RevokeInvitationRequest'];
export type AcceptInvitation = components['schemas']['AcceptInvitationRequest'];
export type InvitationPreview = components['schemas']['InvitationPreviewResponse'];
export type MemberAssignmentPage = components['schemas']['MembershipMemberAssignments'];
export type MembershipAction =
  | { kind: 'save'; organisation_id: string; body: SaveMember }
  | { kind: 'issue'; organisation_id: string; body: IssueInvitation }
  | { kind: 'revoke'; organisation_id: string; body: RevokeInvitation }
  | { kind: 'accept'; organisation_id: string; body: AcceptInvitation };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid membership response');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid membership identifier');
  return value;
}
function label(value: unknown, maximum = 200): string {
  if (typeof value !== 'string' || !value || [...value].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error('Invalid membership label');
  return value;
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) throw new Error('Invalid membership version');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 253402300799) throw new Error('Invalid membership expiry');
  return value;
}
function roles(value: unknown): MemberRole[] {
  if (!Array.isArray(value) || value.length > 3 || value.some(role => !['auditor', 'audit_manager', 'admin'].includes(role)) || new Set(value).size !== value.length) throw new Error('Invalid membership roles');
  return value as MemberRole[];
}
export function assignmentKey(value: Assignment): string { return `${value.client_id}.${value.engagement_id}`; }
function assignments(value: unknown): Assignment[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid membership assignments');
  const result = value.map(item => { const itemRecord = object(item); return { client_id: id(itemRecord.client_id), engagement_id: id(itemRecord.engagement_id) }; });
  if (new Set(result.map(assignmentKey)).size !== result.length) throw new Error('Duplicate membership assignment');
  return result;
}
function cursor(value: unknown, compound = false): string | null {
  if (value === null) return null;
  if (compound) {
    if (typeof value !== 'string' || value.split('.').length !== 2) throw new Error('Invalid membership cursor');
    value.split('.').forEach(id); return value;
  }
  return id(value);
}
function page<T>(value: unknown, parse: (value: unknown) => T, key: (value: T) => string): T[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid membership list');
  const result = value.map(parse);
  if (new Set(result.map(key)).size !== result.length) throw new Error('Duplicate membership record');
  return result;
}
function pageCursor<T>(next: unknown, records: T[], key: (value: T) => string, compound = false): string | null {
  const result = cursor(next, compound);
  if (result !== null && (records.length !== 50 || key(records.at(-1)!) !== result)) throw new Error('Invalid membership cursor');
  return result;
}
function organisation(value: unknown): AdminOrganisation {
  const record = object(value);
  return { organisation_id: id(record.organisation_id), organisation_name: label(record.organisation_name), version: version(record.version) };
}
export function parseOrganisationPage(value: unknown): OrganisationPage {
  const record = object(value);
  const organisations = page(record.organisations, organisation, item => item.organisation_id);
  return { organisations, next_cursor: pageCursor(record.next_cursor, organisations, item => item.organisation_id) };
}
function member(value: unknown): Member {
  const record = object(value);
  if (typeof record.active !== 'boolean') throw new Error('Invalid membership state');
  const permittedRoles = roles(record.roles);
  if (record.active && !permittedRoles.length) throw new Error('Invalid membership roles');
  const assigned = assignments(record.assignments);
  if (!Number.isSafeInteger(record.assignments_count) || (record.assignments_count as number) < 0 ||
    typeof record.assignments_complete !== 'boolean' || assigned.length !== Math.min(record.assignments_count as number, 100) ||
    record.assignments_complete !== ((record.assignments_count as number) <= 100)) throw new Error('Invalid membership assignment count');
  return { actor_id: id(record.actor_id), display_name: label(record.display_name), roles: permittedRoles, active: record.active,
    expires_at: record.expires_at === null ? null : timestamp(record.expires_at), assignments: assigned,
    assignments_count: record.assignments_count as number, assignments_complete: record.assignments_complete };
}
export function effectiveMembershipStatus(member: Pick<Member, 'active' | 'expires_at'>, now = Math.floor(Date.now() / 1000)): 'Active' | 'Inactive' | 'Expired' {
  return !member.active ? 'Inactive' : member.expires_at !== null && member.expires_at <= now ? 'Expired' : 'Active';
}
export function membershipExpiryInput(expiresAt: number | null): string {
  return expiresAt === null ? '' : new Date(expiresAt * 1000).toISOString().slice(0, 19);
}
export function parseMembershipExpiry(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const result = Date.parse(`${value}Z`) / 1000;
  if (!Number.isSafeInteger(result) || result < 1 || result > 253402300799 || membershipExpiryInput(result).slice(0, value.length) !== value) return null;
  return result;
}
function invitation(value: unknown): Invitation {
  const record = object(value);
  if (!['pending', 'accepted', 'revoked', 'expired'].includes(record.status as string)) throw new Error('Invalid invitation state');
  const permittedRoles = roles(record.roles);
  if (!permittedRoles.length) throw new Error('Invalid invitation roles');
  return { id: id(record.id), recipient_email: label(record.recipient_email, 254), roles: permittedRoles, assignments: assignments(record.assignments),
    inviter_actor_id: id(record.inviter_actor_id), expires_at: timestamp(record.expires_at), status: record.status as Invitation['status'] };
}
function engagement(value: unknown): AssignableEngagement {
  const record = object(value);
  return { client_id: id(record.client_id), client_name: label(record.client_name), engagement_id: id(record.engagement_id), engagement_name: label(record.engagement_name) };
}
export function parseMembershipSnapshot(value: unknown, organisationId: string): MembershipSnapshot {
  const record = object(value), org = organisation(value);
  if (org.organisation_id !== organisationId) throw new Error('Membership organisation changed unexpectedly');
  const members = page(record.members, member, item => item.actor_id);
  const invitations = page(record.invitations, invitation, item => item.id);
  const engagements = page(record.engagements, engagement, assignmentKey);
  return { ...org, members, invitations, engagements,
    members_next_cursor: pageCursor(record.members_next_cursor, members, item => item.actor_id),
    invitations_next_cursor: pageCursor(record.invitations_next_cursor, invitations, item => item.id),
    engagements_next_cursor: pageCursor(record.engagements_next_cursor, engagements, assignmentKey, true) };
}
export function parseMembershipReceipt(value: unknown, session: Session, action: MembershipAction): MembershipReceipt {
  const record = object(value);
  const receipt: MembershipReceipt = { event_id: id(record.event_id), organisation_id: id(record.organisation_id), actor_id: id(record.actor_id),
    subject_actor_id: record.subject_actor_id === null ? null : id(record.subject_actor_id),
    invitation_id: record.invitation_id === null ? null : id(record.invitation_id), version: version(record.version), kind: label(record.kind, 40) as MembershipReceipt['kind'] };
  const expectedKind = { save: 'save_member', issue: 'invite', revoke: 'revoke_invitation', accept: 'accept' }[action.kind];
  if (receipt.actor_id !== session.identity.id || receipt.kind !== expectedKind || receipt.organisation_id !== action.organisation_id ||
    action.kind === 'save' && (receipt.subject_actor_id !== action.body.actor_id || receipt.invitation_id !== null) ||
    action.kind === 'revoke' && (receipt.invitation_id !== action.body.invitation_id || receipt.subject_actor_id !== null) ||
    action.kind === 'issue' && (receipt.invitation_id === null || receipt.subject_actor_id !== null) ||
    action.kind === 'accept' && (receipt.subject_actor_id !== session.identity.id || receipt.invitation_id === null)) {
    throw new Error('Membership receipt audience changed unexpectedly');
  }
  return receipt;
}
export function parseInvitationPreview(value: unknown): InvitationPreview {
  const record = object(value), assigned = record.assignments;
  if (!Array.isArray(assigned) || assigned.length > 100) throw new Error('Invalid invitation assignments');
  const parsed = assigned.map(engagement);
  if (new Set(parsed.map(assignmentKey)).size !== parsed.length) throw new Error('Duplicate invitation assignment');
  const permittedRoles = roles(record.roles);
  if (!permittedRoles.length) throw new Error('Invalid invitation roles');
  return { organisation_id: id(record.organisation_id), organisation_name: label(record.organisation_name), recipient_email: label(record.recipient_email, 254),
    roles: permittedRoles, assignments: parsed, expires_at: timestamp(record.expires_at) };
}
export async function verifyMembershipSession(session: Session, signal: AbortSignal): Promise<void> {
  const current = parseSession(await readSessionJson('/auth/session', session, signal));
  if (current.identity.id !== session.identity.id || current.csrf_token !== session.csrf_token) throw new AccessError(412);
}
export async function readAdminOrganisations(session: Session, signal: AbortSignal, after: string | null = null): Promise<OrganisationPage> {
  return parseOrganisationPage(await readSessionJson(`/membership/organisations${after ? `?after=${encodeURIComponent(id(after))}` : ''}`, session, signal));
}
export async function readMembership(organisationId: string, session: Session, signal: AbortSignal, cursors: MembershipCursors = {}): Promise<MembershipSnapshot> {
  const query = new URLSearchParams(Object.entries(cursors).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return parseMembershipSnapshot(await readSessionJson(`/membership/organisations/${encodeURIComponent(id(organisationId))}${query ? `?${query}` : ''}`, session, signal), organisationId);
}
export function parseMemberAssignmentPage(value: unknown, organisationId: string, actorId: string): MemberAssignmentPage {
  const record = object(value);
  if (record.organisation_id !== organisationId || record.actor_id !== actorId) throw new Error('Membership assignment audience changed unexpectedly');
  if (!Number.isSafeInteger(record.total) || (record.total as number) < 0) throw new Error('Invalid membership assignment count');
  const assigned = page(record.assignments, item => {
    const entry = object(item);
    return { ...engagement(item), expires_at: entry.expires_at === null ? null : timestamp(entry.expires_at) };
  }, assignmentKey);
  if (assigned.length > (record.total as number)) throw new Error('Invalid membership assignment count');
  return { organisation_id: id(record.organisation_id), actor_id: id(record.actor_id), version: version(record.version), total: record.total as number,
    assignments: assigned, next_cursor: pageCursor(record.next_cursor, assigned, assignmentKey, true) };
}
export async function readMemberAssignments(organisationId: string, actorId: string, session: Session, signal: AbortSignal, after: string | null): Promise<MemberAssignmentPage> {
  const path = `/membership/organisations/${encodeURIComponent(id(organisationId))}/members/${encodeURIComponent(id(actorId))}/assignments${after ? `?after=${encodeURIComponent(cursor(after, true)!)}` : ''}`;
  const response = await readSessionJson(path, session, signal);
  await verifyMembershipSession(session, signal);
  return parseMemberAssignmentPage(response, organisationId, actorId);
}
export async function applyMembership(action: MembershipAction, session: Session, signal: AbortSignal): Promise<MembershipReceipt> {
  // An exact retry keeps its original body, key and actor, then verifies today's
  // cookie before reaching the server's own current-authority/idempotency check.
  await verifyMembershipSession(session, signal);
  const suffix = action.kind === 'save' ? 'members' : action.kind === 'issue' ? 'invitations' : 'invitations/revoke';
  const path = action.kind === 'accept' ? '/membership/invitations/accept' : `/membership/organisations/${encodeURIComponent(action.organisation_id)}/${suffix}`;
  const response = await readJson(path, signal, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id }, body: JSON.stringify(action.body) });
  await verifyMembershipSession(session, signal);
  return parseMembershipReceipt(response, session, action);
}
export async function previewInvitation(secret: string, session: Session, signal: AbortSignal): Promise<InvitationPreview> {
  await verifyMembershipSession(session, signal);
  const response = await readJson('/membership/invitations/preview', signal, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id }, body: JSON.stringify({ secret }) });
  await verifyMembershipSession(session, signal);
  return parseInvitationPreview(response);
}
export function newInvitationSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function takeInvitationFragment(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): string | null {
  if (!location.hash.startsWith('#invitation=')) return null;
  const secret = new URLSearchParams(location.hash.slice(1)).get('invitation');
  // Scrub even malformed secrets. Never persist capability material in storage.
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return secret && /^[A-Za-z0-9_-]{43}$/.test(secret) ? secret : null;
}
export function invitationLink(secret: string, origin: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid invitation secret');
  return `${origin}/invitation#invitation=${secret}`;
}
