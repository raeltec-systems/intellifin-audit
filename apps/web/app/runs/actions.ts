'use server';

import { redirect } from 'next/navigation';
import { cancelRun, initiateRun, rerunRun } from '@intellifin/application';
import { isExplicitPeriod } from '@intellifin/domain';
import { CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunCancellationRepository, PostgresRunsUnitOfWork, SystemClock } from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../src/server-session';

export type InitiateRunActionResult = { ok: true; runId: string } | { ok: false; reason: string; existingRunId?: string; unknownOutcome?: boolean };
const MALFORMED = 'That Run request was not valid. Check the Procedure and period.';
const UNKNOWN = 'The Run could not be confirmed. Retry this request to open the original Run or queue it safely.';

export async function initiateRunAction(request: unknown): Promise<InitiateRunActionResult> {
  try {
    const decision = await requireServerAction('run.initiate');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 3 || !Object.hasOwn(fields, 'procedureId') || !Object.hasOwn(fields, 'period') || !Object.hasOwn(fields, 'requestToken') ||
      typeof fields.requestToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.requestToken) ||
      typeof fields.procedureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.procedureId) ||
      !isExplicitPeriod(fields.period) || Object.keys(fields.period).length !== 2) return { ok: false, reason: MALFORMED };
    const runtime = await getRuntime();
    return await initiateRun({ roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() }, { session: decision.session, request: fields });
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Initiate Run failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: UNKNOWN, unknownOutcome: true };
  }
}

/** Server form transport keeps submission and successful navigation working before hydration. */
export async function initiateRunFormAction(_previous: InitiateRunActionResult | null, data: FormData): Promise<InitiateRunActionResult> {
  const decision = await requireServerAction('run.initiate').catch(() => null);
  if (decision === null) return { ok: false, reason: UNKNOWN, unknownOutcome: true };
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!(data instanceof FormData)) return { ok: false, reason: MALFORMED };
  // Retain unknown/duplicate fields so a forged form cannot smuggle authority through this adapter.
  const fields: Record<string, unknown> = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith('$ACTION_')) continue;
    if (!['procedureId', 'from', 'to', 'requestToken'].includes(key)) return { ok: false, reason: MALFORMED };
    fields[key] = Object.hasOwn(fields, key) ? null : value;
  }
  const { from, to, ...rest } = fields;
  const result = await initiateRunAction({ ...rest, period: { from, to } });
  if (result.ok) redirect(`/runs/${result.runId}`);
  return result;
}

export type CancelRunActionResult =
  | { ok: true; state: string; pending: boolean }
  | { ok: false; reason: string; unknownOutcome?: boolean };
const CANCEL_MALFORMED = 'That cancellation request was not valid. Open the Run again and retry.';
const CANCEL_UNKNOWN = 'The cancellation could not be confirmed. Reload the Run to see whether it was canceled.';
const RERUN_UNKNOWN = 'The rerun could not be confirmed. Reload the Run to see whether a new Run was queued.';

/**
 * Cancel one active Run.
 *
 * Authorization FIRST, before any input is read: a Server Action is its own POST endpoint
 * addressed by an id that appears in the client bundle, so reaching the Run page it was
 * written beside is not a precondition for invoking it. Only then are shape and bounds
 * checked, because the argument is untrusted whatever its TypeScript type says.
 */
export async function cancelRunAction(request: unknown): Promise<CancelRunActionResult> {
  try {
    const decision = await requireServerAction('run.cancel');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: CANCEL_MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || !Object.hasOwn(fields, 'runId') ||
      typeof fields.runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.runId)) return { ok: false, reason: CANCEL_MALFORMED };
    const runtime = await getRuntime();
    // EXPERIENCE.md makes cancel a ROUTINE confirmation, which restates the consequence and
    // has no rationale field, so no note is collected and the domain's own sentence is what
    // the marker records.
    const outcome = await cancelRun({ roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), repository: new PostgresRunCancellationRepository(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() }, { session: decision.session, request: { runId: fields.runId, reason: null } });
    return outcome.ok ? { ok: true, state: outcome.state, pending: outcome.pending } : { ok: false, reason: outcome.reason };
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Cancel Run failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    // A lost response is an UNKNOWN outcome, never a claim that nothing happened.
    return { ok: false, reason: CANCEL_UNKNOWN, unknownOutcome: true };
  }
}

/**
 * Start a new Run that records the terminal Run it follows.
 *
 * Gated by `run.initiate`, because a rerun starts a Run. There is deliberately no
 * `run.rerun` action: the gating table is transcribed from EXPERIENCE.md character for
 * character and a completeness test asserts all 24 actions against all 3 roles.
 */
export async function rerunAction(request: unknown): Promise<InitiateRunActionResult> {
  try {
    const decision = await requireServerAction('run.initiate');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || !Object.hasOwn(fields, 'predecessorRunId') || !Object.hasOwn(fields, 'requestToken') ||
      typeof fields.requestToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.requestToken) ||
      typeof fields.predecessorRunId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.predecessorRunId)) return { ok: false, reason: MALFORMED };
    const runtime = await getRuntime();
    return await rerunRun({ roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() }, { session: decision.session, request: { predecessorRunId: fields.predecessorRunId, requestToken: fields.requestToken, reason: null } });
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Rerun failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: RERUN_UNKNOWN, unknownOutcome: true };
  }
}
