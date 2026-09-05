import { canonicalJson, type JsonValue } from '../canonical-json.js';
import type { DraftSchedule } from './evidence-draft.js';
import { z } from 'zod';

export const PlatformPublicationSchema = z.strictObject({
  model: z.strictObject({ provider: z.enum(['anthropic', 'openai']), modelId: z.string().min(1).max(200).refine(value => value.trim().length > 0), promptVersion: z.literal('1') }).nullable(),
  interpreterContract: z.literal('executable-plan-v1'), changeKind: z.literal('model'),
});
export const PlatformPublicationInputSchema = PlatformPublicationSchema.extend({ revision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/) });

export interface ConfigurationTuple {
  readonly model: { readonly provider: string; readonly modelId: string; readonly promptVersion: string } | null;
  readonly toolConfiguration: JsonValue;
  readonly registrationDigests: readonly { readonly kind: 'target' | 'source'; readonly id: string; readonly digest: string }[];
}
export function configurationTuplesEqual(left: ConfigurationTuple, right: ConfigurationTuple): boolean {
  const normalized = (tuple: ConfigurationTuple): JsonValue => ({ ...tuple, registrationDigests: [...tuple.registrationDigests].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)) }) as unknown as JsonValue;
  return canonicalJson(normalized(left)) === canonicalJson(normalized(right));
}
export function regressionRequirement(next: ConfigurationTuple, previous: ConfigurationTuple | null): { requiresRegression: boolean; reason: 'first-version' | 'unchanged-configuration' | 'changed-configuration' } {
  if (previous === null) return { requiresRegression: false, reason: 'first-version' };
  return configurationTuplesEqual(next, previous) ? { requiresRegression: false, reason: 'unchanged-configuration' } : { requiresRegression: true, reason: 'changed-configuration' };
}
/** Calendar period start, strictly after activation; launch time does not own periods. */
export function handoverAt(activatedAt: string, schedule: DraftSchedule): string | null {
  const date = new Date(activatedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid activation time.');
  if (schedule.frequency === 'once') return null;
  date.setUTCHours(0, 0, 0, 0);
  if (schedule.frequency === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  else if (schedule.frequency === 'weekly') date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  else { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1); }
  return date.toISOString();
}

export interface VersionLifecycle {
  readonly requiresRegression: boolean;
  readonly reason: 'first-version' | 'unchanged-configuration' | 'changed-configuration';
  readonly priorActiveVersionId: string | null;
  readonly activatedAt: string | null;
  readonly handoverAt: string | null;
}
export interface PlatformDraftOrigin {
  readonly changeId: string;
  readonly originatingVersionId: string;
  readonly kind: 'registration' | 'source' | 'model' | 'prompt' | 'tool';
  readonly description: string;
}

const lifecycleSchema = z.strictObject({ requiresRegression: z.boolean(), reason: z.enum(['first-version', 'unchanged-configuration', 'changed-configuration']), priorActiveVersionId: z.uuid().nullable(), activatedAt: z.iso.datetime().nullable(), handoverAt: z.iso.datetime().nullable() });
const originSchema = z.strictObject({ changeId: z.string().min(1).max(200), originatingVersionId: z.uuid(), kind: z.enum(['registration', 'source', 'model', 'prompt', 'tool']), description: z.string().min(1).max(1000) });
/** Validate durable lifecycle metadata before it can grant any relaxed Draft reads. */
export function validVersionLifecycleMetadata(row: { versionId: string; state: string; lifecycle?: unknown; platformOrigin?: unknown; configurationRevision?: unknown; authorship?: { createdBy: { type: string; id: string } } | null }): boolean {
  if (row.configurationRevision != null && !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).safeParse(row.configurationRevision).success) return false;
  if (row.platformOrigin != null) {
    const origin = originSchema.safeParse(row.platformOrigin);
    if (!origin.success || origin.data.originatingVersionId === row.versionId || row.authorship?.createdBy.type !== 'platform' || row.authorship.createdBy.id !== 'configuration-change') return false;
  } else if (row.authorship?.createdBy.type === 'platform') return false;
  // Pre-generation-14 approvals intentionally have no lifecycle metadata.
  if (row.lifecycle == null) return true;
  const parsed = lifecycleSchema.safeParse(row.lifecycle);
  if (!parsed.success || !['APPROVED', 'ACTIVE', 'RETIRED'].includes(row.state)) return false;
  const value = parsed.data;
  if (value.priorActiveVersionId === row.versionId || (value.reason === 'first-version') !== (value.priorActiveVersionId === null) || value.requiresRegression !== (value.reason === 'changed-configuration')) return false;
  if (row.state === 'APPROVED') return value.requiresRegression && value.activatedAt === null && value.handoverAt === null;
  return value.activatedAt !== null && (value.handoverAt === null || Date.parse(value.handoverAt) > Date.parse(value.activatedAt));
}
