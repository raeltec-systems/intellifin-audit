import { and, eq, sql } from 'drizzle-orm';
import { canonicalJson } from '@intellifin/domain';
import { parseRunControlTransferRequest, type RunControlTransferContext, type RunControlTransferRecord,
  type RunControlTransferRepository, type RunControlTransferReceipt } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, authUser, runControlLease, runControlTransfer, runControlTransferContent, runControlTransferReceipt } from '../db/schema.js';
import { DrizzlePermissionGrantReader, DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleRunRepository } from './run-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator } from '../db/audit-events.js';
import { readLockedRunControlLease, runControlServerTime } from './run-control-lease-repository.js';
import type { ConversationContentCipher } from './conversation-content.js';

export class PostgresRunControlTransferRepository implements RunControlTransferRepository {
  constructor(private readonly db: Database | Transaction, private readonly cipher: ConversationContentCipher | null) {}
  async transaction<T>(runId: string, actorId: string, work: (context: RunControlTransferContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout='250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      await tx.select({ id: auditRun.runId }).from(auditRun).where(eq(auditRun.runId,runId)).for('update');
      await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id,actorId)).for('update');
      const now = new Date(await runControlServerTime(tx));
      const cipher = this.cipher;
      const proposal = async (commandId: string) => {
        const [row] = await tx.select().from(runControlTransfer).where(and(eq(runControlTransfer.runId,runId),eq(runControlTransfer.commandId,commandId)));
        return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
      };
      const fingerprint = (request: { runId: string; expectedEpoch: number; requestKey: string; reason: string }) =>
        cipher?.fingerprint(canonicalJson({ purpose: 'manager-control-transfer-v1', actorId, ...request })) ?? null;
      return work({
        run: await new DrizzleRunRepository(tx).findRun(runId), now,
        roles: new DrizzleRoleRepository(tx), permissions: new DrizzlePermissionGrantReader(tx),
        auditEvents: createAuditEventWriter(tx, { now: () => now }, new CryptoUuidV7Generator()), fingerprint,
        readLease: () => readLockedRunControlLease(tx,runId), readProposal: proposal,
        async readProposalByKey(requestKey) {
          const [row] = await tx.select().from(runControlTransfer).where(and(eq(runControlTransfer.runId,runId),eq(runControlTransfer.actorId,actorId),eq(runControlTransfer.requestKey,requestKey)));
          return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
        },
        async insertProposal(record, reason) {
          if (!cipher || record.runId !== runId || record.actorId !== actorId) throw new Error('Transfer proposal context unavailable');
          await tx.insert(runControlTransfer).values({ ...record, createdAt: new Date(record.createdAt) });
          await tx.insert(runControlTransferContent).values({ commandId: record.commandId,
            ciphertext: cipher.seal(runId,record.commandId,JSON.stringify({ purpose: 'manager-control-transfer-v1', reason })) });
        },
        async readReason(commandId) {
          if (!cipher) return null;
          const record = await proposal(commandId);
          if (!record || record.actorId !== actorId) return null;
          const [content] = await tx.select().from(runControlTransferContent).where(eq(runControlTransferContent.commandId,commandId)).for('update');
          if (!content?.ciphertext || content.removedAt !== null) return null;
          try {
            const body: unknown = JSON.parse(cipher.open(runId,commandId,content.ciphertext));
            if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 2 ||
              !('purpose' in body) || body.purpose !== 'manager-control-transfer-v1' || !('reason' in body)) return null;
            const request = parseRunControlTransferRequest({ runId, expectedEpoch: record.expectedEpoch, requestKey: record.requestKey, reason: body.reason });
            return request && fingerprint(request) === record.fingerprint ? request.reason : null;
          } catch { return null; }
        },
        async readReceipt(commandId): Promise<RunControlTransferReceipt | null> {
          const rows = await tx.execute<{ valid: boolean; event_id: string; epoch: number; holder_id: string; updated_at: string; expires_at: string }>(sql`
            SELECT control_transfer_receipt_valid(c,e) valid,e.event_id::text,(e.payload->>'epoch')::integer epoch,
              e.payload->>'holderId' holder_id,e.payload->>'updatedAt' updated_at,e.payload->>'expiresAt' expires_at
            FROM run_control_transfer_receipt receipt JOIN run_control_transfer c USING(command_id)
            JOIN audit_events e ON e.event_id=receipt.event_id WHERE c.run_id=${runId}::uuid AND c.command_id=${commandId}::uuid AND c.actor_id=${actorId}`);
          const row = rows[0];
          if (!row) return null;
          if (!row.valid) throw new Error('Retained transfer receipt is invalid');
          return { commandId,runId,eventId: row.event_id,epoch: row.epoch,holderId: row.holder_id,updatedAt: row.updated_at,expiresAt: row.expires_at };
        },
        async saveTransfer(record: RunControlTransferRecord, lease) {
          if (record.runId !== runId || lease.runId !== runId || record.actorId !== actorId || lease.holderId !== actorId) throw new Error('Transfer identity mismatch');
          await tx.update(runControlLease).set({ epoch: lease.epoch, holderId: actorId, expiresAt: new Date(lease.expiresAt!),
            updatedAt: new Date(lease.updatedAt), transferCommandId: record.commandId, renewalRequestKey: null }).where(eq(runControlLease.runId,runId));
        },
        async insertReceipt(commandId,eventId) { await tx.insert(runControlTransferReceipt).values({ commandId,eventId }); },
        async actorName(userId) { const [row] = await tx.select({ name: authUser.name }).from(authUser).where(eq(authUser.id,userId)); return row?.name || 'Unavailable identity'; },
        async notifyTimeline(sequence) { await tx.execute(sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId,sequence })})`); },
      });
    });
  }
}
