import { sql } from 'drizzle-orm';
import { authorizeAction, isRole } from '@intellifin/domain';
import type { WorkspacePreviewIdentity, WorkspacePreviewMetadata, WorkspacePreviewMetadataStore, WorkspacePreviewViewer, WorkspaceRef } from '@intellifin/application';
import type { Database } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';

/** Initial deployment routes to one configured worker; a foreign runtime never falls back. */
export class PostgresWorkspacePreviewStore implements WorkspacePreviewMetadataStore {
  constructor(private readonly db: Database) {}
  async claim(ref: WorkspaceRef, runtimeId: string): Promise<number | null> {
    if (!isUuidText(ref.runId) || !isUuidText(runtimeId) || ref.mode !== 'local') return null;
    const rows = await this.db.execute<{ workspace_revision: number }>(sql`
      INSERT INTO run_workspace_preview(run_id,workspace_revision,runtime_id,privacy_epoch,mode,sequence,expires_at)
      SELECT w.run_id,w.revision,${runtimeId}::uuid,0,'unavailable',0,clock_timestamp()+interval '4 seconds'
      FROM run_workspace w JOIN audit_run r ON r.run_id=w.run_id
      WHERE w.run_id=${ref.runId}::uuid AND w.workspace_id=${ref.workspaceId} AND w.mode='local' AND w.status='OPEN'
        AND r.state IN ('RUNNING','PAUSED','AWAITING_AUDITOR')
      ON CONFLICT(run_id) DO UPDATE SET workspace_revision=excluded.workspace_revision,runtime_id=excluded.runtime_id,
        privacy_epoch=excluded.privacy_epoch,mode=excluded.mode,sequence=excluded.sequence,captured_at=NULL,capture_completed_at=NULL,expires_at=excluded.expires_at
      WHERE run_workspace_preview.workspace_revision<>excluded.workspace_revision
      RETURNING workspace_revision`);
    return rows[0]?.workspace_revision ?? null;
  }
  async publish(value: WorkspacePreviewMetadata): Promise<boolean> {
    const rows = await this.db.execute(sql`
      UPDATE run_workspace_preview p SET privacy_epoch=${value.privacyEpoch},mode=${value.mode},sequence=${value.sequence},
        captured_at=${value.capturedAt === null ? null : new Date(value.capturedAt).toISOString()}::timestamptz,
        capture_completed_at=${value.captureCompletedAt === null ? null : new Date(value.captureCompletedAt).toISOString()}::timestamptz,
        expires_at=clock_timestamp()+interval '4 seconds'
      FROM run_workspace w,audit_run r WHERE p.run_id=${value.runId}::uuid AND p.runtime_id=${value.runtimeId}::uuid
        AND p.workspace_revision=${value.workspaceRevision} AND p.expires_at>clock_timestamp()
        AND (p.privacy_epoch<${value.privacyEpoch} OR (p.privacy_epoch=${value.privacyEpoch} AND p.mode=${value.mode} AND p.sequence<=${value.sequence}))
        AND w.run_id=p.run_id AND w.revision=p.workspace_revision AND w.status='OPEN' AND r.run_id=p.run_id
        AND r.state IN ('RUNNING','PAUSED','AWAITING_AUDITOR') RETURNING p.run_id`);
    return rows.length === 1;
  }
  async current(value: WorkspacePreviewIdentity): Promise<boolean> {
    const rows = await this.db.execute(sql`SELECT p.run_id FROM run_workspace_preview p
      JOIN run_workspace w ON w.run_id=p.run_id JOIN audit_run r ON r.run_id=p.run_id
      WHERE p.run_id=${value.runId}::uuid AND p.runtime_id=${value.runtimeId}::uuid AND p.workspace_revision=${value.workspaceRevision}
        AND p.privacy_epoch=${value.privacyEpoch} AND p.expires_at>clock_timestamp()
        AND w.revision=p.workspace_revision AND w.status='OPEN' AND r.state IN ('RUNNING','PAUSED','AWAITING_AUDITOR')`);
    return rows.length === 1;
  }
  async authorized(runId: string, viewer: WorkspacePreviewViewer): Promise<WorkspacePreviewMetadata | null> {
    if (!isUuidText(runId) || viewer.actorId.length > 128 || viewer.sessionId.length > 256) return null;
    const rows = await this.db.execute<WorkspacePreviewMetadata & { role: string; [key: string]: unknown }>(sql`
      SELECT p.run_id AS "runId",p.workspace_revision AS "workspaceRevision",p.runtime_id AS "runtimeId",p.privacy_epoch AS "privacyEpoch",
        p.mode,p.sequence,extract(epoch FROM p.captured_at)*1000 AS "capturedAt",
        extract(epoch FROM p.capture_completed_at)*1000 AS "captureCompletedAt",extract(epoch FROM p.expires_at)*1000 AS "expiresAt",u.role
      FROM run_workspace_preview p JOIN run_workspace w ON w.run_id=p.run_id JOIN audit_run r ON r.run_id=p.run_id
      JOIN auth_session s ON s.id=${viewer.sessionId} AND s.user_id=${viewer.actorId} AND s.expires_at>clock_timestamp()
      JOIN user_role u ON u.user_id=s.user_id
      WHERE p.run_id=${runId}::uuid AND p.expires_at>clock_timestamp() AND w.revision=p.workspace_revision AND w.status='OPEN'
        AND r.state IN ('RUNNING','PAUSED','AWAITING_AUDITOR')`);
    const row = rows[0];
    if (!row || !authorizeAction(isRole(row.role) ? row.role : null, 'run.initiate').allowed) return null;
    return { runId: row.runId, workspaceRevision: row.workspaceRevision, runtimeId: row.runtimeId, privacyEpoch: row.privacyEpoch,
      mode: row.mode, sequence: row.sequence, capturedAt: row.capturedAt === null ? null : Number(row.capturedAt),
      captureCompletedAt: row.captureCompletedAt === null ? null : Number(row.captureCompletedAt), expiresAt: Number(row.expiresAt) };
  }
}
