import type { paths } from './generated/api.ts';
import { readJson } from './auth.ts';

export type Engagement = paths['/engagements']['get']['responses'][200]['content']['application/json']['engagements'][number];
export type Scope = Pick<Engagement, 'organisation_id' | 'client_id' | 'engagement_id'>;
export type EngagementPage = paths['/engagements']['get']['responses'][200]['content']['application/json'];
// Rust's Unicode White_Space edges differ from JavaScript trim (notably FEFF).
const edgeWhitespace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;

function parseScope(value: unknown): Scope {
  if (!value || typeof value !== 'object') throw new Error('Invalid engagement scope');
  const record = value as Record<string, unknown>;
  for (const key of ['organisation_id', 'client_id', 'engagement_id']) {
    if (typeof record[key] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record[key])) throw new Error('Invalid engagement scope');
  }
  return value as Scope;
}

export function parseEngagement(value: unknown): Engagement {
  if (!value || typeof value !== 'object') throw new Error('Invalid engagement response');
  const record = value as Record<string, unknown>;
  parseScope(value);
  for (const key of ['organisation_name', 'client_name', 'engagement_name']) {
    const label = record[key];
    if (typeof label !== 'string' || !label || edgeWhitespace.test(label) || [...label].length > 200 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(label)) throw new Error('Invalid engagement label');
  }
  if (!Array.isArray(record.roles) || !record.roles.some((role) => role === 'auditor' || role === 'audit_manager') ||
    record.roles.some((role) => !['auditor', 'audit_manager', 'admin'].includes(role as string))) {
    throw new Error('Invalid engagement roles');
  }
  return value as Engagement;
}

export function parseEngagementPage(value: unknown): EngagementPage {
  if (!value || typeof value !== 'object' || !('engagements' in value) || !Array.isArray(value.engagements) ||
    value.engagements.length > 50 || !('next_cursor' in value)) {
    throw new Error('Invalid engagement list');
  }
  const engagements = value.engagements.map(parseEngagement);
  const next_cursor = value.next_cursor === null ? null : parseScope(value.next_cursor);
  if (next_cursor && (engagements.length !== 50 || !sameScope(next_cursor, engagements.at(-1)!))) {
    throw new Error('Invalid engagement cursor');
  }
  const keys = engagements.map(({ organisation_id, client_id, engagement_id }) =>
    `${organisation_id}/${client_id}/${engagement_id}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate engagement scope');
  return { engagements, next_cursor };
}

export async function readEngagements(signal: AbortSignal, after: Scope | null = null): Promise<EngagementPage> {
  const query = after ? `?${new URLSearchParams({ after_organisation_id: after.organisation_id,
    after_client_id: after.client_id, after_engagement_id: after.engagement_id })}` : '';
  return parseEngagementPage(await readJson(`/engagements${query}`, signal));
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.organisation_id === right.organisation_id && left.client_id === right.client_id &&
    left.engagement_id === right.engagement_id;
}

export async function readEngagement(scope: Scope, signal: AbortSignal): Promise<Engagement> {
  const query = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id });
  const engagement = parseEngagement(await readJson(`/engagements/${encodeURIComponent(scope.engagement_id)}?${query}`, signal));
  if (engagement.organisation_id !== scope.organisation_id || engagement.client_id !== scope.client_id ||
    engagement.engagement_id !== scope.engagement_id) throw new Error('Engagement scope changed unexpectedly');
  return engagement;
}

export function scopeFromLocation(): Scope | null {
  const query = new URLSearchParams(location.search);
  const organisation_id = query.get('organisation_id');
  const client_id = query.get('client_id');
  const engagement_id = query.get('engagement_id');
  if (![organisation_id, client_id, engagement_id].every((id) => id && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return null;
  return { organisation_id: organisation_id!, client_id: client_id!, engagement_id: engagement_id! };
}

export function showScope(scope: Scope | null): void {
  const query = scope ? `?${new URLSearchParams({ organisation_id: scope.organisation_id,
    client_id: scope.client_id, engagement_id: scope.engagement_id })}` : '';
  history.replaceState(null, '', `/${query}`);
}

export function roleLabel(role: string): string {
  return role === 'audit_manager' ? 'Audit manager' : role === 'auditor' ? 'Auditor' : 'Admin';
}
