import { authorizeAction, isTerminalRunState, type Role, type RunRecord } from '@intellifin/domain';
import type { AuditEventWriter, AuditUnitOfWork } from '../audit/ports.js';
import type { UuidV7Generator } from '../audit/clock.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { PermissionGrantReader, RoleRepository, SessionSnapshot } from '../identity/ports.js';
import { detectRunConversationSecretPattern } from './run-conversation.js';
import { RUN_CONTROL_LEASE_DURATION_MS, type RunControlLeaseState } from './run-control-lease.js';

export const RUN_CONTROL_TRANSFER_EVENT = 'lifecycle.run-control-lease-transferred' as const;
export interface RunControlTransferRequest { readonly runId: string; readonly expectedEpoch: number; readonly requestKey: string; readonly reason: string }
export interface RunControlTransferRecord { readonly commandId: string; readonly runId: string; readonly actorId: string;
  readonly requestKey: string; readonly expectedEpoch: number; readonly priorHolderId: string;
  readonly fingerprint: string; readonly createdAt: string }
export interface RunControlTransferProposal { readonly commandId: string; readonly runId: string; readonly actorName: string;
  readonly priorHolderName: string; readonly expectedEpoch: number; readonly reason: string; readonly createdAt: string }
export interface RunControlTransferReceipt { readonly commandId: string; readonly runId: string; readonly eventId: string;
  readonly epoch: number; readonly holderId: string; readonly updatedAt: string; readonly expiresAt: string }
export type RunControlTransferFailure = { readonly ok: false; readonly code: 'malformed' | 'unauthorized' | 'unknown' | 'terminal' | 'conflict' | 'unavailable'; readonly reason: string };
export type RunControlTransferProposalOutcome = { readonly ok: true; readonly proposal: RunControlTransferProposal; readonly replayed: boolean } | RunControlTransferFailure;
export type RunControlTransferOutcome = { readonly ok: true; readonly receipt: RunControlTransferReceipt; readonly replayed: boolean } | RunControlTransferFailure;
export interface RunControlTransferContext {
  readonly run: RunRecord | null; readonly roles: RoleRepository; readonly permissions: PermissionGrantReader;
  /** Fresh database time sampled after Run AND actor identity locks. */
  readonly now: Date; readonly auditEvents: AuditEventWriter;
  fingerprint(request: RunControlTransferRequest): string | null;
  readLease(): Promise<RunControlLeaseState | null>;
  readProposal(commandId: string): Promise<RunControlTransferRecord | null>;
  readProposalByKey(requestKey: string): Promise<RunControlTransferRecord | null>;
  readReason(commandId: string): Promise<string | null>;
  insertProposal(record: RunControlTransferRecord, reason: string): Promise<void>;
  readReceipt(commandId: string): Promise<RunControlTransferReceipt | null>;
  saveTransfer(record: RunControlTransferRecord, lease: RunControlLeaseState): Promise<void>;
  insertReceipt(commandId: string, eventId: string): Promise<void>;
  actorName(userId: string): Promise<string>;
  notifyTimeline(sequence: number): Promise<void>;
}
export interface RunControlTransferRepository {
  /** Lock Run, then stable actor identity; no caller-controlled holder or authorization. */
  transaction<T>(runId: string, actorId: string, work: (context: RunControlTransferContext) => Promise<T>): Promise<T>;
}
export interface RunControlTransferDependencies { readonly repository: RunControlTransferRepository; readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork; readonly ids: UuidV7Generator }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function parseRunControlTransferRequest(value: unknown): RunControlTransferRequest | null {
  if (!object(value) || Object.keys(value).length !== 4 || typeof value.runId !== 'string' || !UUID.test(value.runId) ||
    typeof value.requestKey !== 'string' || !UUID.test(value.requestKey) || typeof value.expectedEpoch !== 'number' ||
    !Number.isInteger(value.expectedEpoch) || value.expectedEpoch < 1 || value.expectedEpoch >= 2147483647 ||
    typeof value.reason !== 'string' || value.reason.length > 2000 || !value.reason.isWellFormed()) return null;
  const reason = value.reason.trim();
  if (!reason || Array.from(reason).length > 1000 || Array.from(reason).reduce((bytes, char) => { const point = char.codePointAt(0)!; return bytes + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4); }, 0) > 4000 || detectRunConversationSecretPattern(reason)) return null;
  return { runId: value.runId.toLowerCase(), requestKey: value.requestKey.toLowerCase(), expectedEpoch: value.expectedEpoch, reason };
}
function confirmRequest(value: unknown): { runId: string; commandId: string } | null {
  return object(value) && Object.keys(value).length === 2 && typeof value.runId === 'string' && UUID.test(value.runId) &&
    typeof value.commandId === 'string' && UUID.test(value.commandId) ? { runId: value.runId.toLowerCase(), commandId: value.commandId.toLowerCase() } : null;
}
function refuse(code: RunControlTransferFailure['code'], reason: string): RunControlTransferFailure { return { ok: false, code, reason }; }
class Revoked extends Error { constructor(readonly role: Role | null, reason: string) { super(reason); } }
async function authorizeLocked(context: RunControlTransferContext, actorId: string) {
  const role = await context.roles.findRole(actorId);
  const grant = await context.permissions.readGrant(actorId, 'run.control-transfer');
  const decision = authorizeAction(role, 'run.control-transfer', { explicitPermissions: grant.granted ? ['run.control-transfer'] : [] });
  if (!decision.allowed) throw new Revoked(role, decision.reason);
}
function validLease(context: RunControlTransferContext, lease: RunControlLeaseState | null, epoch: number, actorId: string) {
  return lease !== null && lease.epoch === epoch && lease.holderId !== null && lease.holderId !== actorId &&
    lease.expiresAt !== null && Date.parse(lease.expiresAt) > context.now.getTime();
}
async function present(context: RunControlTransferContext, record: RunControlTransferRecord): Promise<RunControlTransferProposal | null> {
  const reason = await context.readReason(record.commandId);
  if (reason === null) return null;
  return { commandId: record.commandId, runId: record.runId, actorName: await context.actorName(record.actorId),
    priorHolderName: await context.actorName(record.priorHolderId), expectedEpoch: record.expectedEpoch, reason, createdAt: record.createdAt };
}
export async function proposeRunControlTransfer(dependencies: RunControlTransferDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown }): Promise<RunControlTransferProposalOutcome> {
  const auth = { session: input.session, correlationId: dependencies.ids.next(), action: 'run.control-transfer' as const };
  const permission = await authorizeCommandRole(dependencies, auth);
  if (!permission.allowed) return refuse('unauthorized', permission.reason);
  const request = parseRunControlTransferRequest(input.request);
  if (request === null) return refuse('malformed', 'Enter a reason of up to 1,000 characters and review the current controller.');
  try {
    return await dependencies.repository.transaction(request.runId, input.session.userId, async context => {
      await authorizeLocked(context, input.session.userId);
      if (!context.run) return refuse('unknown', 'That Run no longer exists.');
      const fingerprint = context.fingerprint(request);
      if (fingerprint === null) return refuse('unavailable', 'Governed transfer reason storage is unavailable.');
      const previous = await context.readProposalByKey(request.requestKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return refuse('conflict', 'This request key already names a different transfer review.');
        const proposal = await present(context, previous);
        return proposal ? { ok: true, proposal, replayed: true } : refuse('unavailable', 'The recorded transfer reason is removed or unavailable.');
      }
      if (isTerminalRunState(context.run.state)) return refuse('terminal', 'This Run has finished.');
      const lease = await context.readLease();
      if (!validLease(context, lease, request.expectedEpoch, input.session.userId))
        return refuse('conflict', 'The controller changed or is no longer held by another auditor. Read the current controller before proceeding.');
      const record: RunControlTransferRecord = { commandId: dependencies.ids.next(), runId: request.runId, actorId: input.session.userId,
        requestKey: request.requestKey, expectedEpoch: request.expectedEpoch, priorHolderId: lease!.holderId!, fingerprint, createdAt: context.now.toISOString() };
      await context.insertProposal(record, request.reason);
      const proposal = await present(context, record);
      if (!proposal) throw new Error('Governed transfer reason could not be verified');
      return { ok: true, proposal, replayed: false };
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, auth, error.role, error.message); return refuse('unauthorized', error.message); }
    throw error;
  }
}
export async function confirmRunControlTransfer(dependencies: RunControlTransferDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown }): Promise<RunControlTransferOutcome> {
  return readOrConfirmRunControlTransfer(dependencies, input, false);
}
/** Recovers historical proof without ever applying an unconfirmed proposal. */
export async function recoverRunControlTransferReceipt(dependencies: RunControlTransferDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown }): Promise<RunControlTransferOutcome> {
  return readOrConfirmRunControlTransfer(dependencies, input, true);
}
async function readOrConfirmRunControlTransfer(dependencies: RunControlTransferDependencies,
  input: { readonly session: SessionSnapshot; readonly request: unknown }, receiptOnly: boolean): Promise<RunControlTransferOutcome> {
  const auth = { session: input.session, correlationId: dependencies.ids.next(), action: 'run.control-transfer' as const };
  const permission = await authorizeCommandRole(dependencies, auth);
  if (!permission.allowed) return refuse('unauthorized', permission.reason);
  const request = confirmRequest(input.request);
  if (!request) return refuse('malformed', 'Review the transfer before confirming it.');
  try {
    return await dependencies.repository.transaction(request.runId, input.session.userId, async context => {
      await authorizeLocked(context, input.session.userId);
      const proposal = await context.readProposal(request.commandId);
      if (!context.run || !proposal || proposal.actorId !== input.session.userId) return refuse('unknown', 'That transfer review is unavailable.');
      const receipt = await context.readReceipt(proposal.commandId);
      if (receipt) return { ok: true, receipt, replayed: true };
      if (receiptOnly) return refuse('conflict', 'This transfer has no committed receipt. Review the current controller before confirming a transfer.');
      if (isTerminalRunState(context.run.state)) return refuse('terminal', 'This Run has finished.');
      if (await context.readReason(proposal.commandId) === null) return refuse('unavailable', 'The recorded transfer reason is removed or unavailable.');
      const prior = await context.readLease();
      if (!validLease(context, prior, proposal.expectedEpoch, input.session.userId) || prior!.holderId !== proposal.priorHolderId)
        return refuse('conflict', 'The controller changed or the reviewed lease expired. Start a new transfer review.');
      const now = context.now.toISOString();
      const next: RunControlLeaseState = { runId: request.runId, epoch: proposal.expectedEpoch + 1, holderId: input.session.userId,
        updatedAt: now, expiresAt: new Date(context.now.getTime() + RUN_CONTROL_LEASE_DURATION_MS).toISOString() };
      await context.saveTransfer(proposal, next);
      const event = await context.auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: RUN_CONTROL_TRANSFER_EVENT,
        source: 'web', outcome: 'success', aggregateId: request.runId, correlationId: auth.correlationId, sessionId: input.session.sessionId,
        payload: { operation: 'transfer', commandId: proposal.commandId, requestKey: proposal.requestKey, expectedEpoch: proposal.expectedEpoch,
          priorEpoch: proposal.expectedEpoch, priorHolderId: proposal.priorHolderId, epoch: next.epoch, holderId: next.holderId,
          reasonRef: proposal.commandId, updatedAt: now, expiresAt: next.expiresAt } });
      await context.insertReceipt(proposal.commandId, event.eventId);
      await context.notifyTimeline(event.sequence);
      return { ok: true, replayed: false, receipt: { commandId: proposal.commandId, runId: request.runId, eventId: event.eventId,
        epoch: next.epoch, holderId: input.session.userId, updatedAt: now, expiresAt: next.expiresAt! } };
    });
  } catch (error) {
    if (error instanceof Revoked) { await recordAuthorizationDenial(dependencies, auth, error.role, error.message); return refuse('unauthorized', error.message); }
    throw error;
  }
}
