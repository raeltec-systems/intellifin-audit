'use server';

import { proposeRunControlTransfer, confirmRunControlTransfer, recoverRunControlTransferReceipt, acquireRunControlLease, releaseRunControlLease, renewRunControlLease, type RunControlLeaseOutcome } from '@intellifin/application';
import {
  ConversationContentCipher, PostgresRunControlTransferRepository, CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, readRunControlLease, type RunControlLeaseRead,
} from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { currentCorrelationId, currentSession, requireServerAction } from '../../src/server-session';

export type RunControlReadActionResult = (Extract<RunControlLeaseRead, { status: 'ready' }> & { readonly actorId: string }) | Exclude<RunControlLeaseRead, { status: 'ready' }> | { readonly status: 'unavailable' };
export type RunControlActionResult = Extract<RunControlLeaseOutcome, { ok: true }> | { readonly ok: false; readonly reason: string; readonly unknownOutcome?: boolean };

export async function readRunControlAction(runId: unknown): Promise<RunControlReadActionResult> {
  try {
    const authorization = await requireServerAction('run.resume');
    if (!authorization.allowed) return { status: 'denied' };
    if (typeof runId !== 'string') return { status: 'missing' };
    const runtime = await getRuntime();
    const read = await readRunControlLease(runtime.db, {
      runId, actorId: authorization.session.userId, requiredForUnenrolledRun: runtime.conversationEnabled,
    });
    return read.status === 'ready' ? { ...read, actorId: authorization.session.userId, transferEligible: read.transferEligible && runtime.conversationEnabled } : read;
  } catch {
    return { status: 'unavailable' };
  }
}

/** Every surface sends the same bounded envelope; no caller supplies actor or policy. */
export async function changeRunControlAction(operation: unknown, request: unknown): Promise<RunControlActionResult> {
  try {
    const authorization = await requireServerAction('run.resume');
    if (!authorization.allowed) return { ok: false, reason: authorization.reason };
    if (operation !== 'acquire' && operation !== 'renew' && operation !== 'release')
      return { ok: false, reason: 'Choose acquire, renew or release control.' };
    const runtime = await getRuntime();
    const command = operation === 'acquire' ? acquireRunControlLease : operation === 'renew' ? renewRunControlLease : releaseRunControlLease;
    const outcome = await command({
      roles: new DrizzleRoleRepository(runtime.db),
      unitOfWork: new PostgresRunsUnitOfWork(runtime.db),
      repository: new PostgresRunControlLeaseRepository(runtime.db),
      ids: new CryptoUuidV7Generator(),
      allowEnrollment: runtime.conversationEnabled,
    }, { session: authorization.session, request });
    return outcome.ok ? outcome : { ok: false, reason: outcome.reason };
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Run controller request failed', error, {
        correlationId: await currentCorrelationId(), outcome: 'failure',
      });
    } catch { /* Boot errors are reported by instrumentation. */ }
    return { ok: false, reason: 'The control request could not be confirmed. Reload this Run to check its recorded controller.', unknownOutcome: true };
  }
}

export type RunControlTransferProposalResult = Awaited<ReturnType<typeof proposeRunControlTransfer>> | { readonly ok: false; readonly code: 'unavailable'; readonly reason: string; readonly unknownOutcome: true };
export type RunControlTransferConfirmationResult = Awaited<ReturnType<typeof confirmRunControlTransfer>> | { readonly ok: false; readonly code: 'unavailable'; readonly reason: string; readonly unknownOutcome: true };

async function transferDependencies() {
  const runtime = await getRuntime();
  return { roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), ids: new CryptoUuidV7Generator(),
    repository: new PostgresRunControlTransferRepository(runtime.db, runtime.config.RUN_CONVERSATION_MODE === 'synthetic'
      ? new ConversationContentCipher(runtime.config.RUN_CONVERSATION_CONTENT_KEY!) : null) };
}
export async function proposeRunControlTransferAction(request: unknown, expectedActorId: string): Promise<RunControlTransferProposalResult> {
  try {
    // The dedicated service checks and audits the actual transfer permission before
    // parsing input, then rechecks the grant under its Run/identity locks.
    const authorization = await currentSession();
    if (!authorization.authenticated) return { ok: false, code: 'unauthorized', reason: 'Sign in to continue.' };
    if (expectedActorId !== authorization.session.userId) return { ok: false, code: 'unauthorized', reason: 'The signed-in account changed. Start a new transfer review.' };
    return await proposeRunControlTransfer(await transferDependencies(), { session: authorization.session, request });
  } catch {
    // Errors may contain a request or governed reason. Never pass them to telemetry.
    return { ok: false, code: 'unavailable', reason: 'The transfer proposal could not be confirmed. Retry the same request.', unknownOutcome: true };
  }
}
export async function confirmRunControlTransferAction(request: unknown, expectedActorId: string): Promise<RunControlTransferConfirmationResult> {
  try {
    const authorization = await currentSession();
    if (!authorization.authenticated) return { ok: false, code: 'unauthorized', reason: 'Sign in to continue.' };
    if (expectedActorId !== authorization.session.userId) return { ok: false, code: 'unauthorized', reason: 'The signed-in account changed. Start a new transfer review.' };
    return await confirmRunControlTransfer(await transferDependencies(), { session: authorization.session, request });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'The transfer could not be confirmed. Retry the same confirmation to recover its receipt.', unknownOutcome: true };
  }
}

/** Historical proof only. This service cannot apply an unconfirmed transfer. */
export async function recoverRunControlTransferReceiptAction(request: unknown, expectedActorId: string): Promise<RunControlTransferConfirmationResult> {
  try {
    const authorization = await currentSession();
    if (!authorization.authenticated) return { ok: false, code: 'unauthorized', reason: 'Sign in to continue.' };
    if (expectedActorId !== authorization.session.userId) return { ok: false, code: 'unauthorized', reason: 'The signed-in account changed. Start a new transfer review.' };
    return await recoverRunControlTransferReceipt(await transferDependencies(), { session: authorization.session, request });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'The recorded transfer receipt could not be read. Retry receipt recovery.', unknownOutcome: true };
  }
}
