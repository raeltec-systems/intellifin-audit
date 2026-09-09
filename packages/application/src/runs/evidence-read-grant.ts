import {
  authorizeActionRole,
  parseSnapshotLocator,
  snapshotSubstrateForMediaType,
  type Role,
} from '@intellifin/domain';

import type { AuditEventWriter } from '../audit/ports.js';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';

/** The maximum lifetime of an Evidence read capability (AD-5). */
export const EVIDENCE_READ_GRANT_MAX_TTL_MS = 5 * 60 * 1000;

/** The largest snapshot the web inspector will ever buffer and parse. */
export const EVIDENCE_READ_MAX_BYTES = 4 * 1024 * 1024;

export const EVIDENCE_READ_GRANT_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_READ_GRANT_QUEUE = 'evidence-read-grants' as const;
/** Whole captured empty-result page; authorized by a persisted absence proof, not a row locator. */
export const ABSENCE_SNAPSHOT_LOCATOR = 'absence-result' as const;
/**
 * The whole registered screenshot of one Tool Action, as Live View and Replay show it
 * (Story 5.3, AD-17: "a live frame is a Replay asset the moment it is registered").
 *
 * A frame has no cell to address, so its locator is this sentinel and nothing else. The
 * worker issues a frame grant only for a REGISTERED `screenshot` artifact whose media type
 * is `image/png`, and a cell locator only for a `structural-snapshot`: the locator says
 * what KIND of read the capability is for, and a capability for the wrong kind is a
 * scope mismatch, never a best effort.
 */
export const FRAME_LOCATOR = 'frame' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The two values a Server Action accepts before identity is attached. */
export interface EvidenceReadGrantRequestFields {
  readonly runId: string;
  readonly evidenceId: string;
  readonly locator: string;
}

/** The identity and scope written to a pending grant. No object key or bytes cross here. */
export interface EvidenceReadGrantRequest {
  readonly grantId: string;
  readonly runId: string;
  readonly evidenceId: string;
  readonly locator: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export const EVIDENCE_READ_GRANT_STATUSES = ['pending', 'issued', 'denied', 'expired'] as const;
export type EvidenceReadGrantStatus = (typeof EVIDENCE_READ_GRANT_STATUSES)[number];

/** Why the worker refused to turn a pending request into an object-store capability. */
export const EVIDENCE_READ_DENIAL_CODES = [
  'expired',
  'unauthorized',
  'scope-mismatch',
  'evidence-not-registered',
  'unsupported-media-type',
  'invalid-evidence-metadata',
  'storage-unavailable',
] as const;
export type EvidenceReadDenialCode = (typeof EVIDENCE_READ_DENIAL_CODES)[number];

/** A signed GET capability. This type is worker/web-server only and is never a response DTO. */
export interface EvidenceReadGrantCapability {
  readonly grantId: string;
  readonly runId: string;
  readonly evidenceId: string;
  readonly actorId: string;
  readonly locator: string;
  readonly signedUrl: string;
  readonly signedUrlExpiresAt: string;
  readonly mediaType: string;
  readonly digest: string;
  readonly size: number;
}

/** Digests and sizes a server-side consumer may hand to the existing integrity path. */
export interface EvidenceReadIntegrityMismatch {
  readonly runId: string;
  readonly evidenceId: string;
  readonly finding: 'object-missing' | 'size-mismatch' | 'digest-mismatch';
  readonly expectedDigest: string;
  readonly observedDigest: string | null;
  readonly expectedSize: number;
  readonly observedSize: number | null;
}

/**
 * Application boundary for recording a verified read that disagreed with registered
 * Evidence. Infrastructure owns the transaction and chooses the existing sealed-package
 * or active-Run outcome; the web reader supplies only bounded identifiers and digests.
 */
export interface EvidenceReadIntegrityReporter {
  report(input: EvidenceReadIntegrityMismatch): Promise<void>;
}

/** The bounded metadata the worker obtains from the registered Evidence row. */
export interface RegisteredEvidenceForRead {
  readonly runId: string;
  readonly evidenceId: string;
  /** `run_evidence.kind`: the locator's read kind must match it (`FRAME_LOCATOR` needs `screenshot`). */
  readonly kind: string;
  readonly state: string;
  readonly objectKey: string;
  readonly mediaType: string | null;
  readonly digest: string | null;
  readonly size: number | null;
}

/** The durable grant row, with a capability only after the worker has issued one. */
export interface EvidenceReadGrant {
  readonly grantId: string;
  readonly runId: string;
  readonly evidenceId: string;
  readonly locator: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: EvidenceReadGrantStatus;
  readonly denialCode: EvidenceReadDenialCode | null;
  readonly capability: EvidenceReadGrantCapability | null;
}

/** The only S3 capability the application worker asks infrastructure to mint. */
export interface EvidenceReadGrantSigner {
  signGet(input: {
    readonly bucketKey: string;
    readonly expiresAt: string;
  }): Promise<{ readonly signedUrl: string; readonly signedUrlExpiresAt: string }>;
}

/** Context held under the grant row lock while a worker decides and issues a capability. */
export interface EvidenceReadGrantContext {
  readonly grant: EvidenceReadGrant | null;
  readonly authorizationRoles: RoleRepository;
  readonly auditEvents: AuditEventWriter;
  readRegisteredEvidence(): Promise<RegisteredEvidenceForRead | null>;
  /** Conditional update: only a still-pending, unexpired grant may be issued. */
  issue(capability: EvidenceReadGrantCapability): Promise<boolean>;
  /** Conditional update: only a still-pending grant may be denied. Returns the committed code. */
  deny(code: EvidenceReadDenialCode): Promise<{ readonly changed: boolean; readonly code: EvidenceReadDenialCode }>;
}

/** Read/write persistence owned by infrastructure; no S3 or framework type enters here. */
export interface EvidenceReadGrantRepository {
  /** Insert identity/scope metadata and enqueue the worker job in one transaction. */
  request(input: EvidenceReadGrantRequest): Promise<void>;
  transaction<TResult>(
    grantId: string,
    work: (context: EvidenceReadGrantContext) => Promise<TResult>,
  ): Promise<TResult>;
  /** Return a capability only for the same actor and before the grant deadline. */
  readForActor(input: {
    readonly grantId: string;
    readonly actorId: string;
    readonly now: string;
  }): Promise<EvidenceReadGrantCapability | null>;
  /** Record a successful, verified read and its ID-only audit event. */
  recordAccess(input: {
    readonly grantId: string;
    readonly actorId: string;
    readonly correlationId: string;
    readonly at: string;
  }): Promise<boolean>;
}

export interface EvidenceReadGrantJob {
  readonly schemaVersion: typeof EVIDENCE_READ_GRANT_SCHEMA_VERSION;
  readonly grantId: string;
}

/** Parse the only queue envelope the grant worker is allowed to consume. */
export function parseEvidenceReadGrantJob(value: unknown): EvidenceReadGrantJob | null {
  if (!plainObject(value) || !exactKeys(value, ['schemaVersion', 'grantId']) ||
      value.schemaVersion !== EVIDENCE_READ_GRANT_SCHEMA_VERSION ||
      typeof value.grantId !== 'string' || !UUID.test(value.grantId)) return null;
  return { schemaVersion: EVIDENCE_READ_GRANT_SCHEMA_VERSION, grantId: value.grantId.toLowerCase() };
}

export type EvidenceReadGrantRequestResult =
  | { readonly ok: true; readonly grantId: string; readonly expiresAt: string }
  | { readonly ok: false; readonly code: 'malformed'; readonly reason: string };

export type EvidenceReadGrantWorkerResult =
  | { readonly status: 'issued'; readonly grantId: string }
  | { readonly status: 'denied'; readonly grantId: string; readonly code: EvidenceReadDenialCode }
  | { readonly status: 'missing' }
  | { readonly status: 'already-handled'; readonly grantId: string };

const MALFORMED = 'That stored snapshot request was not valid.';

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** The one media type a frame may have; the capture path already refuses any other. */
export const FRAME_MEDIA_TYPE = 'image/png' as const;

function contentTypeBase(value: string | null): string {
  return value === null ? '' : value.split(';', 1)[0]!.trim().toLowerCase();
}

function nonEmptyText(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0;
}

/** Parse the hostile Server Action payload without looking at fields not in the contract. */
export function parseEvidenceReadGrantRequest(value: unknown):
  | EvidenceReadGrantRequestFields
  | { readonly error: 'malformed' } {
  if (!plainObject(value) || !exactKeys(value, ['runId', 'evidenceId', 'locator'])) return { error: 'malformed' };
  if (
    typeof value.runId !== 'string' || !UUID.test(value.runId) ||
    typeof value.evidenceId !== 'string' || !UUID.test(value.evidenceId) ||
    !nonEmptyText(value.locator, 1024) || (value.locator !== ABSENCE_SNAPSHOT_LOCATOR && value.locator !== FRAME_LOCATOR && parseSnapshotLocator(value.locator) === null)
  ) return { error: 'malformed' };
  return {
    runId: value.runId.toLowerCase(),
    evidenceId: value.evidenceId.toLowerCase(),
    locator: value.locator,
  };
}

function canonicalInstant(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Evidence read grant clock failure');
  return value.toISOString();
}

function validGeneratedId(value: string): boolean {
  return typeof value === 'string' && UUID.test(value) && value.toLowerCase()[14] === '7';
}

/** Create one short-lived, actor-bound request after the web boundary has authorized it. */
export async function requestEvidenceReadGrant(
  dependencies: Pick<EvidenceReadGrantDependencies, 'repository' | 'ids' | 'clock'>,
  input: { readonly session: SessionSnapshot; readonly correlationId: string; readonly request: unknown },
): Promise<EvidenceReadGrantRequestResult> {
  const fields = parseEvidenceReadGrantRequest(input.request);
  if ('error' in fields) return { ok: false, code: 'malformed', reason: MALFORMED };
  if (!nonEmptyText(input.session.userId, 255) || !nonEmptyText(input.session.sessionId, 255) ||
      !nonEmptyText(input.correlationId, 255)) return { ok: false, code: 'malformed', reason: MALFORMED };

  const requestedAt = canonicalInstant(dependencies.clock.now());
  const expiresAt = new Date(Date.parse(requestedAt) + EVIDENCE_READ_GRANT_MAX_TTL_MS).toISOString();
  const grantId = dependencies.ids.next().toLowerCase();
  if (!validGeneratedId(grantId)) throw new Error('Evidence read grant id generator returned an invalid id');
  await dependencies.repository.request({
    grantId,
    runId: fields.runId,
    evidenceId: fields.evidenceId,
    locator: fields.locator,
    actorId: input.session.userId,
    sessionId: input.session.sessionId,
    correlationId: input.correlationId,
    requestedAt,
    expiresAt,
  });
  return { ok: true, grantId, expiresAt };
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function validCapabilityUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s#]/.test(value)) return false;
  const authorityStart = value.indexOf('://');
  if (authorityStart !== 4 && authorityStart !== 5) return false;
  const protocol = value.slice(0, authorityStart);
  if (protocol !== 'http' && protocol !== 'https') return false;
  const remainder = value.slice(authorityStart + 3);
  const authorityEnd = remainder.search(/[/?]/);
  const authority = remainder.slice(0, authorityEnd < 0 ? remainder.length : authorityEnd);
  return authority.length > 0 && !authority.includes('@');
}

function roleAllowsEvidenceRead(role: Role | null): boolean {
  // `run.initiate` is the existing Run-detail read action. A later role-table expansion can
  // split Evidence reads into their own action without changing this worker port.
  return authorizeActionRole(role, 'run.initiate').allowed;
}

function grantEvent(
  grant: EvidenceReadGrant,
  outcome: 'success' | 'denied',
  eventType: 'evidence-access.grant-issued' | 'evidence-access.denied',
  payload: { readonly code?: EvidenceReadDenialCode },
): Parameters<AuditEventWriter['append']>[0] {
  return {
    actor: { type: 'human', id: grant.actorId },
    eventType,
    source: 'worker',
    outcome,
    sessionId: grant.sessionId,
    correlationId: grant.correlationId,
    aggregateId: grant.runId,
    payload: {
      grantId: grant.grantId,
      runId: grant.runId,
      evidenceId: grant.evidenceId,
      ...(payload.code === undefined ? {} : { code: payload.code }),
    },
  };
}

async function denyGrant(
  context: EvidenceReadGrantContext,
  code: EvidenceReadDenialCode,
): Promise<EvidenceReadGrantWorkerResult> {
  const grant = context.grant;
  if (grant === null) return { status: 'missing' };
  const decision = await context.deny(code);
  if (!decision.changed) return { status: 'already-handled', grantId: grant.grantId };
  await context.auditEvents.append(grantEvent(grant, 'denied', 'evidence-access.denied', { code: decision.code }));
  return { status: 'denied', grantId: grant.grantId, code: decision.code };
}

/**
 * Worker-side grant issuance. The repository transaction locks the grant, re-reads the
 * registered Evidence binding and role, and appends the audit event with the state update.
 * The signer sees only an internal object key and returns a capability that never enters an
 * audit payload or a queue job.
 */
export async function issueEvidenceReadGrant(
  dependencies: EvidenceReadGrantWorkerDependencies,
  job: unknown,
): Promise<EvidenceReadGrantWorkerResult> {
  const parsed = parseEvidenceReadGrantJob(job);
  if (parsed === null) return { status: 'missing' };
  return dependencies.repository.transaction(parsed.grantId, async (context) => {
    const grant = context.grant;
    if (grant === null) return { status: 'missing' };
    if (grant.status !== 'pending') return { status: 'already-handled', grantId: grant.grantId };
    const now = canonicalInstant(dependencies.clock.now());
    if (!validInstant(grant.expiresAt) || Date.parse(now) >= Date.parse(grant.expiresAt)) {
      return denyGrant(context, 'expired');
    }
    const role = await context.authorizationRoles.findRole(grant.actorId);
    if (!roleAllowsEvidenceRead(role)) return denyGrant(context, 'unauthorized');
    if (dependencies.signer === null) return denyGrant(context, 'storage-unavailable');

    const evidence = await context.readRegisteredEvidence();
    if (evidence === null || evidence.runId !== grant.runId || evidence.evidenceId !== grant.evidenceId) {
      return denyGrant(context, 'scope-mismatch');
    }
    if (evidence.state !== 'REGISTERED') return denyGrant(context, 'evidence-not-registered');
    // The locator names the KIND of read. A frame is the whole screenshot of one action; a
    // cell or the absence view is a Structural Snapshot. The wrong kind for the locator is a
    // scope mismatch, so a caller cannot obtain a screenshot through a cell locator or a
    // snapshot through the frame sentinel and then read it as something it is not.
    if (grant.locator === FRAME_LOCATOR) {
      if (evidence.kind !== 'screenshot') return denyGrant(context, 'scope-mismatch');
      if (contentTypeBase(evidence.mediaType) !== FRAME_MEDIA_TYPE) return denyGrant(context, 'unsupported-media-type');
    } else {
      if (evidence.kind !== 'structural-snapshot') return denyGrant(context, 'scope-mismatch');
      if (snapshotSubstrateForMediaType(evidence.mediaType) === null) return denyGrant(context, 'unsupported-media-type');
    }
    const objectKey = evidence.objectKey;
    const mediaType = evidence.mediaType;
    const digest = evidence.digest;
    const size = evidence.size;
    if (!nonEmptyText(objectKey, 1024) || !validDigest(digest) ||
        typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > EVIDENCE_READ_MAX_BYTES ||
        !nonEmptyText(mediaType, 512)) return denyGrant(context, 'invalid-evidence-metadata');
    if (grant.locator !== ABSENCE_SNAPSHOT_LOCATOR && grant.locator !== FRAME_LOCATOR && parseSnapshotLocator(grant.locator) === null) return denyGrant(context, 'scope-mismatch');

    const signed = await dependencies.signer.signGet({ bucketKey: objectKey, expiresAt: grant.expiresAt });
    if (!validCapabilityUrl(signed.signedUrl) || !validInstant(signed.signedUrlExpiresAt) ||
        Date.parse(signed.signedUrlExpiresAt) > Date.parse(grant.expiresAt) ||
        Date.parse(signed.signedUrlExpiresAt) <= Date.parse(now)) {
      throw new Error('Evidence read signer returned an invalid capability');
    }
    const capability: EvidenceReadGrantCapability = {
      grantId: grant.grantId,
      runId: grant.runId,
      evidenceId: grant.evidenceId,
      actorId: grant.actorId,
      locator: grant.locator,
      signedUrl: signed.signedUrl,
      signedUrlExpiresAt: signed.signedUrlExpiresAt,
      mediaType,
      digest,
      size,
    };
    if (!await context.issue(capability)) return { status: 'already-handled', grantId: grant.grantId };
    await context.auditEvents.append(grantEvent(grant, 'success', 'evidence-access.grant-issued', {}));
    return { status: 'issued', grantId: grant.grantId };
  });
}

export interface EvidenceReadGrantDependencies {
  readonly repository: EvidenceReadGrantRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export interface EvidenceReadGrantWorkerDependencies {
  readonly repository: EvidenceReadGrantRepository;
  /** `null` keeps the queue consuming pending requests when object storage is unconfigured. */
  readonly signer: EvidenceReadGrantSigner | null;
  readonly clock: Clock;
}
