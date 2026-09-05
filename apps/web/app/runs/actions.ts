'use server';

import { redirect } from 'next/navigation';
import { initiateRun } from '@intellifin/application';
import { isExplicitPeriod } from '@intellifin/domain';
import { CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunsUnitOfWork, SystemClock } from '@intellifin/infrastructure';
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
