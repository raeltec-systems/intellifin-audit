import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';

import type {
  EvidenceReadDenialCode,
  EvidenceReadGrant,
  EvidenceReadGrantCapability,
  EvidenceReadGrantContext,
  EvidenceReadGrantRepository,
  EvidenceReadGrantRequest,
  EvidenceReadGrantStatus,
  EvidenceReadIntegrityMismatch,
  RegisteredArtifact,
  RegisteredEvidenceForRead,
} from '@intellifin/application';
import {
  EVIDENCE_READ_DENIAL_CODES,
  EVIDENCE_READ_GRANT_QUEUE,
  EVIDENCE_READ_GRANT_SCHEMA_VERSION,
  EVIDENCE_READ_GRANT_STATUSES,
  completeRun,
  recordSealedIntegrityFindings,
} from '@intellifin/application';
import {
  authorizeActionRole,
  isActiveRunState,
  isTerminalRunState,
  verifyStoredArtifact,
} from '@intellifin/domain';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock, type PostgresAuditDependencies } from '../db/audit-events.js';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { queueDatabase } from '../procedures/derivation-queue.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { auditRun, runEvidence } from '../db/schema.js';
import { evidencePackageContext, PostgresSealedPackageRepository } from './evidence-package-repository.js';
import { runResultContext } from './result-repository.js';
import { DrizzleRunRepository } from './run-repository.js';

/**
 * Raw SQL keeps this adapter compatible with the generation-38 expand migration while the
 * Drizzle schema catches up. The migration owns this exact table shape:
 * `evidence_read_grant(grant_id, run_id, evidence_id, locator, actor_id, session_id,
 * correlation_id, requested_at, expires_at, status, denial_code, signed_url,
 * signed_url_expires_at, capability_media_type, capability_digest, capability_size)`.
 * Signed URL text is capability state, never an audit payload or a response body.
 */

type RawRow = Record<string, unknown>;

function rows(value: unknown): readonly RawRow[] {
  if (Array.isArray(value)) return value as RawRow[];
  if (value !== null && typeof value === 'object' && 'rows' in value) {
    const nested = (value as { readonly rows?: unknown }).rows;
    return Array.isArray(nested) ? nested as RawRow[] : [];
  }
  return [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function instant(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function size(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function denialCode(value: unknown): EvidenceReadDenialCode | null {
  return typeof value === 'string' && (EVIDENCE_READ_DENIAL_CODES as readonly string[]).includes(value)
    ? value as EvidenceReadDenialCode
    : null;
}

function grantStatus(value: unknown): EvidenceReadGrantStatus | null {
  return typeof value === 'string' && (EVIDENCE_READ_GRANT_STATUSES as readonly string[]).includes(value)
    ? value as EvidenceReadGrantStatus
    : null;
}

function safeCapabilityUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '' || parsed.hostname === '') return null;
    return value;
  } catch {
    return null;
  }
}

function grantFromRow(row: RawRow): EvidenceReadGrant | null {
  const grantId = text(row.grant_id)?.toLowerCase() ?? null;
  const runId = text(row.run_id)?.toLowerCase() ?? null;
  const evidenceId = text(row.evidence_id)?.toLowerCase() ?? null;
  const locator = text(row.locator);
  const actorId = text(row.actor_id);
  const sessionId = text(row.session_id);
  const correlationId = text(row.correlation_id);
  const requestedAt = instant(row.requested_at);
  const expiresAt = instant(row.expires_at);
  const status = grantStatus(row.status);
  if (grantId === null || runId === null || evidenceId === null || locator === null || actorId === null || sessionId === null || correlationId === null || requestedAt === null || expiresAt === null ||
      !isUuidText(grantId) || !isUuidText(runId) || !isUuidText(evidenceId) ||
      status === null) return null;

  const signedUrl = safeCapabilityUrl(row.signed_url);
  const signedUrlExpiresAt = instant(row.signed_url_expires_at);
  const mediaType = text(row.capability_media_type);
  const digest = text(row.capability_digest);
  const capabilitySize = size(row.capability_size);
  const hasAnyCapability = row.signed_url !== null && row.signed_url !== undefined;
  const hasCompleteCapability = signedUrl !== null && signedUrlExpiresAt !== null && mediaType !== null && digest !== null && /^[0-9a-f]{64}$/.test(digest) && capabilitySize !== null;
  if (status === 'issued' && !hasCompleteCapability) return null;
  if (status !== 'issued' && hasAnyCapability) return null;
  const capability: EvidenceReadGrantCapability | null = status === 'issued'
    ? {
        grantId,
        runId,
        evidenceId,
        actorId,
        locator,
        signedUrl: signedUrl!,
        signedUrlExpiresAt: signedUrlExpiresAt!,
        mediaType: mediaType!,
        digest: digest!,
        size: capabilitySize!,
      }
    : null;
  return {
    grantId,
    runId,
    evidenceId,
    locator,
    actorId,
    sessionId,
    correlationId,
    requestedAt,
    expiresAt,
    status,
    denialCode: denialCode(row.denial_code),
    capability,
  };
}

function evidenceFromRow(row: RawRow): RegisteredEvidenceForRead | null {
  const runId = text(row.run_id)?.toLowerCase() ?? null;
  const evidenceId = text(row.evidence_id)?.toLowerCase() ?? null;
  const kind = text(row.kind);
  const state = text(row.state);
  const objectKey = text(row.object_key);
  if (runId === null || evidenceId === null || kind === null || state === null || objectKey === null || !isUuidText(runId) || !isUuidText(evidenceId)) return null;
  return {
    runId,
    evidenceId,
    kind,
    state,
    objectKey,
    mediaType: text(row.media_type),
    digest: text(row.digest),
    size: size(row.size),
  };
}

async function readGrant(connection: Database | Transaction, grantId: string, lock: boolean): Promise<EvidenceReadGrant | null> {
  const result = await connection.execute(sql`
    SELECT grant_id::text AS grant_id, run_id::text AS run_id, evidence_id::text AS evidence_id,
           locator, actor_id, session_id, correlation_id, requested_at, expires_at, status,
           denial_code, signed_url, signed_url_expires_at, capability_media_type,
           capability_digest, capability_size
    FROM evidence_read_grant
    WHERE grant_id = ${grantId}
    ${lock ? sql`FOR UPDATE` : sql``}
  `);
  const row = rows(result)[0];
  return row === undefined ? null : grantFromRow(row);
}

async function readRegisteredEvidence(connection: Database | Transaction, runId: string, evidenceId: string): Promise<RegisteredEvidenceForRead | null> {
  const result = await connection.execute(sql`
    SELECT run_id::text AS run_id, evidence_id::text AS evidence_id, kind, state, object_key,
           media_type, digest, size
    FROM run_evidence
    WHERE run_id = ${runId} AND evidence_id = ${evidenceId}
    LIMIT 1
  `);
  const row = rows(result)[0];
  return row === undefined ? null : evidenceFromRow(row);
}

/**
 * Accept a mismatch only when it still describes the exact registered artifact. The web
 * reader has already checked the capability, but this second validation is the boundary
 * that keeps a stale or forged callback from writing an integrity conclusion.
 */
function verifiedReadMismatch(
  input: EvidenceReadIntegrityMismatch,
  artifact: Pick<RegisteredArtifact, 'evidenceId' | 'objectKey' | 'digest' | 'size'>,
): import('@intellifin/domain').EvidenceVerification | null {
  if (!isUuidText(input.runId) || !isUuidText(input.evidenceId) ||
      artifact.evidenceId !== input.evidenceId || artifact.digest !== input.expectedDigest ||
      artifact.size !== input.expectedSize || !/^[0-9a-f]{64}$/.test(input.expectedDigest) ||
      !Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0) return null;
  if (input.finding === 'object-missing') {
    if (input.observedDigest !== null || input.observedSize !== null) return null;
    const verification = verifyStoredArtifact({
      evidenceId: artifact.evidenceId,
      objectKey: artifact.objectKey,
      expectedDigest: artifact.digest,
      expectedSize: artifact.size,
      stored: null,
    });
    return verification.finding === 'object-missing' ? verification : null;
  }
  const observedDigest = input.observedDigest;
  const observedSize = input.observedSize;
  if (typeof observedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(observedDigest) ||
      typeof observedSize !== 'number' || !Number.isSafeInteger(observedSize) || observedSize < 0) return null;
  const verification = verifyStoredArtifact({
    evidenceId: artifact.evidenceId,
    objectKey: artifact.objectKey,
    expectedDigest: artifact.digest,
    expectedSize: artifact.size,
    stored: { digest: observedDigest, size: observedSize },
  });
  return verification.finding === input.finding ? verification : null;
}

export interface PostgresEvidenceReadGrantDependencies extends PostgresAuditDependencies {}

/**
 * PostgreSQL grant repository. The web can use this class for metadata and capability reads;
 * it cannot reach the worker's S3 store because this file never imports that subpath.
 */
export class PostgresEvidenceReadGrantRepository implements EvidenceReadGrantRepository {
  private readonly clock;
  private readonly ids;

  constructor(private readonly db: Database, dependencies: PostgresEvidenceReadGrantDependencies = {}) {
    this.clock = dependencies.clock ?? new SystemClock();
    this.ids = dependencies.ids ?? new CryptoUuidV7Generator();
  }

  async request(input: EvidenceReadGrantRequest): Promise<void> {
    if (!isUuidText(input.grantId) || !isUuidText(input.runId) || !isUuidText(input.evidenceId) || input.locator.length === 0 || input.actorId.length === 0 || input.sessionId.length === 0 || input.correlationId.length === 0) {
      throw new Error('Invalid Evidence read grant request');
    }
    await this.db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO evidence_read_grant (
          grant_id, run_id, evidence_id, locator, actor_id, session_id, correlation_id,
          requested_at, expires_at, status, denial_code, signed_url, signed_url_expires_at,
          capability_media_type, capability_digest, capability_size
        ) VALUES (
          ${input.grantId}, ${input.runId}, ${input.evidenceId}, ${input.locator}, ${input.actorId},
          ${input.sessionId}, ${input.correlationId}, ${input.requestedAt}::timestamptz,
          ${input.expiresAt}::timestamptz, 'pending', NULL, NULL, NULL, NULL, NULL, NULL
        ) RETURNING grant_id::text AS grant_id
      `);
      if (rows(inserted).length !== 1) throw new Error('Evidence read grant was not created');
      const queue = new PgBoss({ db: queueDatabase(tx), migrate: false, createSchema: false, schedule: false, supervise: false });
      const jobId = await queue.send(EVIDENCE_READ_GRANT_QUEUE, {
        schemaVersion: EVIDENCE_READ_GRANT_SCHEMA_VERSION,
        grantId: input.grantId,
      }, { db: queueDatabase(tx), retryLimit: 3, retryDelay: 5, expireInSeconds: 180 });
      if (jobId === null) throw new Error('Evidence read grant was not enqueued');
    });
  }

  async transaction<TResult>(grantId: string, work: (context: EvidenceReadGrantContext) => Promise<TResult>): Promise<TResult> {
    if (!isUuidText(grantId)) throw new Error('Invalid Evidence read grant id');
    return this.db.transaction(async (tx) => {
      const grant = await readGrant(tx, grantId.toLowerCase(), true);
      const context: EvidenceReadGrantContext = {
        grant,
        authorizationRoles: new DrizzleRoleRepository(tx),
        auditEvents: createAuditEventWriter(tx, this.clock, this.ids),
        readRegisteredEvidence: async () => grant === null ? null : readRegisteredEvidence(tx, grant.runId, grant.evidenceId),
        issue: async (capability) => {
          if (grant === null) return false;
          const result = await tx.execute(sql`
            UPDATE evidence_read_grant
            SET status = 'issued', signed_url = ${capability.signedUrl},
                signed_url_expires_at = ${capability.signedUrlExpiresAt}::timestamptz,
                capability_media_type = ${capability.mediaType}, capability_digest = ${capability.digest},
                capability_size = ${capability.size}
            WHERE grant_id = ${grant.grantId} AND actor_id = ${grant.actorId}
              AND status = 'pending' AND expires_at > clock_timestamp()
            RETURNING grant_id
          `);
          return rows(result).length === 1;
        },
        deny: async (code) => {
          if (grant === null) return { changed: false, code };
          // The deadline decision and its code must come from the same database clock. A
          // worker that reaches this branch exactly as the request expires is an expired
          // request, never a row with `status=expired, denial_code=unauthorized` that the
          // completion check would reject.
          const result = await tx.execute(sql`
            UPDATE evidence_read_grant AS g
            SET status = CASE WHEN deadline.expired THEN 'expired' ELSE 'denied' END,
                denial_code = CASE WHEN deadline.expired THEN 'expired' ELSE ${code} END
            FROM (
              SELECT expires_at <= clock_timestamp() AS expired
              FROM evidence_read_grant
              WHERE grant_id = ${grant.grantId} AND status = 'pending'
            ) AS deadline
            WHERE g.grant_id = ${grant.grantId} AND g.status = 'pending'
            RETURNING g.grant_id, g.status, g.denial_code
          `);
          const row = rows(result)[0];
          const committed = row === undefined ? null : denialCode(row.denial_code);
          return row === undefined
            ? { changed: false, code }
            : { changed: true, code: committed ?? code };
        },
      };
      return work(context);
    });
  }

  async readForActor(input: { readonly grantId: string; readonly actorId: string; readonly now: string }): Promise<EvidenceReadGrantCapability | null> {
    if (!isUuidText(input.grantId) || input.actorId.length === 0) return null;
    const now = Date.parse(input.now);
    if (!Number.isFinite(now)) return null;
    return this.db.transaction(async (tx) => {
      const grant = await readGrant(tx, input.grantId.toLowerCase(), true);
      if (grant === null || grant.actorId !== input.actorId || grant.status !== 'issued' || grant.capability === null) return null;
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      const authorized = authorizeActionRole(role, 'run.initiate');
      if (!authorized.allowed) {
        // A capability issued before revocation is invalidated in the same transaction as
        // the ID-only denial event. Clearing its fields also makes a stale row unusable if
        // a caller later guesses the grant id.
        const revoked = await tx.execute(sql`
          UPDATE evidence_read_grant
          SET status = 'denied', denial_code = 'unauthorized', signed_url = NULL,
              signed_url_expires_at = NULL, capability_media_type = NULL,
              capability_digest = NULL, capability_size = NULL
          WHERE grant_id = ${grant.grantId} AND actor_id = ${input.actorId} AND status = 'issued'
          RETURNING grant_id
        `);
        if (rows(revoked).length === 1) {
          await createAuditEventWriter(tx, this.clock, this.ids).append({
            actor: { type: 'human', id: grant.actorId },
            eventType: 'evidence-access.denied',
            source: 'web',
            outcome: 'denied',
            sessionId: grant.sessionId,
            correlationId: grant.correlationId,
            aggregateId: grant.runId,
            payload: { grantId: grant.grantId, runId: grant.runId, evidenceId: grant.evidenceId, code: 'unauthorized' },
          });
        }
        return null;
      }
      if (now >= Date.parse(grant.expiresAt) || now >= Date.parse(grant.capability.signedUrlExpiresAt)) {
        const expired = await tx.execute(sql`
          UPDATE evidence_read_grant
          SET status = 'expired', denial_code = 'expired', signed_url = NULL,
              signed_url_expires_at = NULL, capability_media_type = NULL,
              capability_digest = NULL, capability_size = NULL
          WHERE grant_id = ${grant.grantId} AND actor_id = ${input.actorId} AND status = 'issued'
          RETURNING grant_id
        `);
        if (rows(expired).length === 1) {
          await createAuditEventWriter(tx, this.clock, this.ids).append({
            actor: { type: 'human', id: grant.actorId },
            eventType: 'evidence-access.denied',
            source: 'web',
            outcome: 'denied',
            sessionId: grant.sessionId,
            correlationId: grant.correlationId,
            aggregateId: grant.runId,
            payload: { grantId: grant.grantId, runId: grant.runId, evidenceId: grant.evidenceId, code: 'expired' },
          });
        }
        return null;
      }
      return grant.capability;
    });
  }

  async recordAccess(input: { readonly grantId: string; readonly actorId: string; readonly correlationId: string; readonly at: string }): Promise<boolean> {
    if (!isUuidText(input.grantId) || input.actorId.length === 0 || input.correlationId.length === 0) return false;
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) return false;
    return this.db.transaction(async (tx) => {
      const grant = await readGrant(tx, input.grantId.toLowerCase(), true);
      if (grant === null || grant.actorId !== input.actorId || grant.status !== 'issued' || grant.capability === null) return false;

      // The capability may have been read before a role revocation. Re-check the
      // authorization while the grant row remains locked so a verified body cannot
      // turn into a successful access audit after the actor loses Run-detail access.
      const role = await new DrizzleRoleRepository(tx).findRole(input.actorId);
      if (!authorizeActionRole(role, 'run.initiate').allowed) {
        const revoked = await tx.execute(sql`
          UPDATE evidence_read_grant
          SET status = 'denied', denial_code = 'unauthorized', signed_url = NULL,
              signed_url_expires_at = NULL, capability_media_type = NULL,
              capability_digest = NULL, capability_size = NULL
          WHERE grant_id = ${grant.grantId} AND actor_id = ${input.actorId} AND status = 'issued'
          RETURNING grant_id
        `);
        if (rows(revoked).length === 1) {
          await createAuditEventWriter(tx, this.clock, this.ids).append({
            actor: { type: 'human', id: grant.actorId },
            eventType: 'evidence-access.denied',
            source: 'web',
            outcome: 'denied',
            sessionId: grant.sessionId,
            correlationId: grant.correlationId,
            aggregateId: grant.runId,
            payload: { grantId: grant.grantId, runId: grant.runId, evidenceId: grant.evidenceId, code: 'unauthorized' },
          });
        }
        return false;
      }
      if (at >= Date.parse(grant.expiresAt) || at >= Date.parse(grant.capability.signedUrlExpiresAt)) return false;
      await createAuditEventWriter(tx, this.clock, this.ids).append({
        actor: { type: 'human', id: grant.actorId },
        eventType: 'evidence-access.read',
        source: 'web',
        outcome: 'success',
        sessionId: grant.sessionId,
        correlationId: input.correlationId,
        aggregateId: grant.runId,
        payload: { grantId: grant.grantId, runId: grant.runId, evidenceId: grant.evidenceId },
      });
      return true;
    });
  }

  /**
   * Record a mismatch found by the server-side inspector through the same outcome rules as
   * the worker verifier. The callback carries no object key or bytes, so this method resolves
   * the registered row while holding the Run lock and refuses a stale, forged or ambiguous
   * report before it can reach either the Audit Trail or a Run state transition.
   *
   * A terminal Run uses the shared sealed-package finding writer, which changes no Run,
   * seal, Evidence row or bytes. An active Run follows the existing completion path and is
   * terminally `RUN_FAILED`; the Result and package seal commit with that state. No
   * `run_evidence_integrity` row is written for the active case, matching the package
   * contract's distinction between a during-Run failure and an after-Run finding.
   */
  async reportIntegrityMismatch(input: EvidenceReadIntegrityMismatch): Promise<void> {
    if (!isUuidText(input.runId) || !isUuidText(input.evidenceId)) return;

    const recordTerminalMismatch = async (): Promise<void> => {
      const sealed = new PostgresSealedPackageRepository(this.db);
      await sealed.transaction(input.runId, async (context) => {
        const run = context.run;
        if (run === null || !isTerminalRunState(run.state)) return;
        if (await context.readSeal() === null) return;
        const artifacts = await context.readRegisteredArtifacts();
        const matching = artifacts.filter((artifact) => artifact.evidenceId === input.evidenceId);
        // A population reservation names two objects with one Evidence id. The inspector
        // only opens structural snapshots, but refusing an ambiguous id keeps this helper
        // from guessing which object a future caller meant.
        if (matching.length !== 1) return;
        const verification = verifiedReadMismatch(input, matching[0]!);
        if (verification === null) return;
        await recordSealedIntegrityFindings(context, [verification], {
          clock: this.clock,
          ids: this.ids,
          source: 'web',
          actorId: 'evidence-inspector',
        });
      });
    };

    // Select the path from a cheap read, then re-check it under the Run lock in either
    // transaction. A terminal Run cannot move back to active. If the initial read sees an
    // active Run but the lock observes its terminal transition, retry through the sealed
    // package transaction after releasing the first lock; otherwise the verified mismatch
    // would be silently lost at exactly the active-to-terminal boundary.
    const current = await this.db
      .select({ state: auditRun.state })
      .from(auditRun)
      .where(eq(auditRun.runId, input.runId))
      .limit(1);
    const state = current[0]?.state;
    if (state === undefined) return;

    if (isTerminalRunState(state)) {
      await recordTerminalMismatch();
      return;
    }

    if (!isActiveRunState(state)) return;
    let terminalAfterLock = false;
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: auditRun.runId })
        .from(auditRun)
        .where(eq(auditRun.runId, input.runId))
        .for('update');
      const run = await new DrizzleRunRepository(tx).findRun(input.runId);
      if (run === null) return;
      if (isTerminalRunState(run.state)) {
        terminalAfterLock = true;
        return;
      }
      if (!isActiveRunState(run.state)) return;

      const evidenceRows = await tx
        .select({
          evidenceId: runEvidence.evidenceId,
          objectKey: runEvidence.objectKey,
          digest: runEvidence.digest,
          size: runEvidence.size,
          state: runEvidence.state,
        })
        .from(runEvidence)
        .where(
          and(
            eq(runEvidence.runId, input.runId),
            eq(runEvidence.evidenceId, input.evidenceId),
            eq(runEvidence.state, 'REGISTERED'),
          ),
        )
        .limit(2);
      const row = evidenceRows.length === 1 ? evidenceRows[0]! : null;
      if (row === null || row.digest === null || row.size === null) return;
      const verification = verifiedReadMismatch(input, {
        evidenceId: row.evidenceId,
        objectKey: row.objectKey,
        digest: row.digest,
        size: row.size,
      });
      if (verification === null) return;

      const resultContext = runResultContext(tx, input.runId);
      const context = {
        ...evidencePackageContext(tx, input.runId),
        ...resultContext,
        auditEvents: createAuditEventWriter(tx, this.clock, this.ids),
        async notifyTimeline(sequence: number): Promise<void> {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId: input.runId, sequence })})`,
          );
        },
      };
      let plan = null;
      try {
        plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
      } catch {
        // CompleteRun is intentionally able to publish a RUN_FAILED result without a
        // readable frozen plan. The failure itself remains truthful and the Result carries
        // a null scope rather than a guessed plan sentence.
        plan = null;
      }
      await context.saveRunState('RUN_FAILED');
      const stored = await context.auditEvents.append({
        actor: { type: 'system', id: 'evidence-inspector' },
        eventType: 'failure.evidence-integrity',
        source: 'web',
        outcome: 'failure',
        aggregateId: run.runId,
        correlationId: run.correlationId,
        sessionId: run.sessionId,
        payload: {
          evidenceId: verification.evidenceId,
          objectKey: verification.objectKey,
          finding: verification.finding,
          registeredDigest: verification.expectedDigest,
          observedDigest: verification.observedDigest,
          registeredSize: verification.expectedSize,
          observedSize: verification.observedSize,
          stateChanged: true,
        },
      });
      await context.notifyTimeline(stored.sequence);
      await completeRun(context, {
        run,
        state: 'RUN_FAILED',
        at: this.clock.now().toISOString(),
        plan,
      });
    });
    if (terminalAfterLock) await recordTerminalMismatch();
  }
}
