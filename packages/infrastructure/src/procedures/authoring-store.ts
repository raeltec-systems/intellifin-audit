import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AUTHORING_IDENTITY, isAuthoringProposal, type AuthoringRequestRecord, type ProcedureAuthoringStore } from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import { procedureAuthoringRequest } from '../db/schema.js';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const section = z.union([z.strictObject({ kind: z.literal('objective') }), z.strictObject({ kind: z.literal('scope') }), z.strictObject({ kind: z.literal('instructions'), registrationId: z.uuid() })]);
const recordSchema = z.strictObject({ requestId: z.uuid(), procedureId: z.uuid(), versionId: z.uuid(), actorId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), section,
  requestDigest: hash, authoringRevision: z.number().int().nonnegative(), contextDigest: hash, sectionBasis: hash, decisionDigest: hash,
  currentText: z.string().max(10000), proposedText: z.string().max(10000).nullable(), clarifications: z.array(z.string().max(1000)).max(4),
  explanation: z.string().min(1).max(2000).optional(),
  revision: z.strictObject({ requestId: z.uuid(), draft: z.string().max(10000), feedback: z.string().min(1).max(2000) }).optional(),
  state: z.enum(['pending', 'ready', 'failed', 'accepted', 'rejected']),
  identity: z.strictObject({ provider: z.literal(AUTHORING_IDENTITY.provider), modelId: z.literal(AUTHORING_IDENTITY.modelId), promptVersion: z.enum(['guided-prose-v1', AUTHORING_IDENTITY.promptVersion]) }),
  usage: z.strictObject({ inputTokens: z.number().int().min(0).max(10000000).nullable(), outputTokens: z.number().int().min(0).max(10000000).nullable() }).nullable(),
  message: z.string().max(1000).nullable(), acceptedDigest: hash.nullable(),
});
export function parseAuthoringRecord(value: unknown): AuthoringRequestRecord {
  const parsed = recordSchema.parse(value);
  if ((parsed.state === 'ready' || parsed.state === 'accepted') && !isAuthoringProposal({ proposedText: parsed.proposedText, clarifications: parsed.clarifications }, parsed.section.kind === 'objective' ? 4000 : 10000)) throw new Error('Invalid saved writing response');
  if (parsed.state === 'accepted' && (parsed.acceptedDigest === null || parsed.proposedText === null)) throw new Error('Invalid saved writing acceptance');
  return parsed;
}
export class DrizzleProcedureAuthoringStore implements ProcedureAuthoringStore {
  constructor(private readonly tx: Transaction) {}
  async find(requestId: string): Promise<AuthoringRequestRecord | null> {
    const [row] = await this.tx.select().from(procedureAuthoringRequest).where(eq(procedureAuthoringRequest.requestId, requestId)).for('update');
    if (!row) return null;
    const record = parseAuthoringRecord(row.record);
    if (record.requestId !== row.requestId || record.actorId !== row.actorId || record.versionId !== row.versionId || Date.parse(record.createdAt) !== Date.parse(row.createdAt)) throw new Error('Inconsistent writing receipt');
    return record;
  }
  async countSince(actorId: string, since: string): Promise<number> {
    const [row] = await this.tx.select({ count: sql<number>`count(*)::int` }).from(procedureAuthoringRequest).where(and(eq(procedureAuthoringRequest.actorId, actorId), gte(procedureAuthoringRequest.createdAt, since)));
    return row?.count ?? 0;
  }
  async insert(record: AuthoringRequestRecord): Promise<void> {
    parseAuthoringRecord(record);
    await this.tx.insert(procedureAuthoringRequest).values({ requestId: record.requestId, versionId: record.versionId, actorId: record.actorId, createdAt: record.createdAt, record });
  }
  async update(record: AuthoringRequestRecord): Promise<void> {
    parseAuthoringRecord(record);
    const rows = await this.tx.update(procedureAuthoringRequest).set({ record }).where(and(eq(procedureAuthoringRequest.requestId, record.requestId), eq(procedureAuthoringRequest.versionId, record.versionId), eq(procedureAuthoringRequest.actorId, record.actorId))).returning({ id: procedureAuthoringRequest.requestId });
    if (rows.length !== 1) throw new Error('Writing receipt was not updated');
  }
}
