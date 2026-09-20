'use server';

import { acquireRunControlLease, releaseRunControlLease, renewRunControlLease, type RunControlLeaseOutcome } from '@intellifin/application';
import {
  CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, readRunControlLease, type RunControlLeaseRead,
} from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../src/server-session';

export type RunControlReadActionResult = RunControlLeaseRead | { readonly status: 'unavailable' };
export type RunControlActionResult = Extract<RunControlLeaseOutcome, { ok: true }> | { readonly ok: false; readonly reason: string; readonly unknownOutcome?: boolean };

export async function readRunControlAction(runId: unknown): Promise<RunControlReadActionResult> {
  try {
    const authorization = await requireServerAction('run.resume');
    if (!authorization.allowed) return { status: 'denied' };
    if (typeof runId !== 'string') return { status: 'missing' };
    const runtime = await getRuntime();
    return await readRunControlLease(runtime.db, {
      runId, actorId: authorization.session.userId, requiredForUnenrolledRun: runtime.conversationEnabled,
    });
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
