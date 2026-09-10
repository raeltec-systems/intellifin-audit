'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ANSWER_ESCALATION_REFUSALS, answerEscalation, cancelRun, FLAG_REQUEST_MALFORMED, flagRun, initiateRun, pauseRun, rerunRun, resumeRun, type AnswerEscalationResult } from '@intellifin/application';
import { isExplicitPeriod } from '@intellifin/domain';
import { CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunCancellationRepository, PostgresRunFlagRepository, PostgresRunsUnitOfWork, PostgresWaitRepository, SystemClock } from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { ESCALATION_PANEL_COPY } from '../../src/design/copy';
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

const PAUSE_MALFORMED = 'That pause request was not valid. Open the Run again and retry.';
const PAUSE_UNKNOWN = 'The pause could not be confirmed. Reload the Run to see whether it was paused.';
const RESUME_UNKNOWN = 'The resume could not be confirmed. Reload the Run to see whether it restarted.';
const RUN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PauseRunActionResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly unknownOutcome?: boolean;
}

/**
 * Ask for a Running Run to pause at its next Tool Action boundary (Story 5.4).
 *
 * A Server Action is its own POST endpoint addressed by an id in the client bundle, so it
 * authorizes for itself FIRST, before reading any input, and the argument is untrusted
 * whatever its TypeScript type says.
 *
 * It never reports "the Run is paused": the worker performs that transition. What succeeds
 * here is the REQUEST, which is what the surface then says.
 */
export async function pauseRunAction(request: unknown): Promise<PauseRunActionResult> {
  try {
    const decision = await requireServerAction('run.pause');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: PAUSE_MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || !Object.hasOwn(fields, 'runId') ||
      typeof fields.runId !== 'string' || !RUN_UUID.test(fields.runId)) return { ok: false, reason: PAUSE_MALFORMED };
    const runtime = await getRuntime();
    const outcome = await pauseRun(
      { roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), repository: new PostgresWaitRepository(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() },
      { session: decision.session, request: { runId: fields.runId } },
    );
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Pause Run failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: PAUSE_UNKNOWN, unknownOutcome: true };
  }
}

export interface FlagRunActionResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly unknownOutcome?: boolean;
}

const FLAG_UNKNOWN = 'The flag could not be confirmed. Reload the Run to see whether it was recorded.';

/**
 * Flag a Run to the Audit Managers (Story 5.5).
 *
 * A Server Action is its own POST endpoint addressed by an id in the client bundle, so it
 * authorizes for itself FIRST, before reading any input, and the argument is untrusted
 * whatever its TypeScript type says.
 *
 * It never says the Run changed: a flag has no execution effect, and the message the
 * surface then shows says so.
 */
export async function flagRunAction(request: unknown): Promise<FlagRunActionResult> {
  try {
    const decision = await requireServerAction('run.flag');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: FLAG_REQUEST_MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || !Object.hasOwn(fields, 'runId') || !Object.hasOwn(fields, 'note') ||
      typeof fields.runId !== 'string' || !RUN_UUID.test(fields.runId) ||
      (fields.note !== null && typeof fields.note !== 'string')) return { ok: false, reason: FLAG_REQUEST_MALFORMED };
    const runtime = await getRuntime();
    const outcome = await flagRun(
      { roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), repository: new PostgresRunFlagRepository(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() },
      { session: decision.session, request: { runId: fields.runId, note: fields.note } },
    );
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Flag Run failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: FLAG_UNKNOWN, unknownOutcome: true };
  }
}

/**
 * The same flag, submitted by a real `<form>`.
 *
 * `useActionState` needs a `(previous, formData)` action, and that shape is also what makes
 * the form work with no JavaScript at all: the browser POSTs to this endpoint and Next
 * re-renders the page with the returned state. Both paths reach `flagRunAction`, so there
 * is one authorization check, one validation and one command.
 */
export async function flagRunFormAction(_previous: FlagRunActionResult | null, form: FormData): Promise<FlagRunActionResult> {
  const runId = form.get('runId');
  const note = form.get('note');
  // `FormData.get` returns a `File` for a file input, and `null` for an absent field. Both
  // are refused here rather than coerced, so a hand-made multipart POST is refused by the
  // same sentence a malformed object argument gets.
  return flagRunAction({
    runId: typeof runId === 'string' ? runId : '',
    note: typeof note === 'string' && note.trim().length > 0 ? note : null,
  });
}

/**
 * Close the pause wait and put the Run back to `RUNNING` (Story 5.4).
 *
 * The revision the surface read is the compare-and-set value, so a Run that changed while
 * the page was open is refused rather than resumed against a state nobody saw.
 */
export async function resumeRunAction(request: unknown): Promise<PauseRunActionResult> {
  try {
    const decision = await requireServerAction('run.resume');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return { ok: false, reason: PAUSE_MALFORMED };
    const fields = request as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || !Object.hasOwn(fields, 'runId') || !Object.hasOwn(fields, 'expectedRunRevision') ||
      typeof fields.runId !== 'string' || !RUN_UUID.test(fields.runId) ||
      typeof fields.expectedRunRevision !== 'number' || !Number.isSafeInteger(fields.expectedRunRevision) ||
      fields.expectedRunRevision < 0) return { ok: false, reason: PAUSE_MALFORMED };
    const runtime = await getRuntime();
    const outcome = await resumeRun(
      { roles: new DrizzleRoleRepository(runtime.db), unitOfWork: new PostgresRunsUnitOfWork(runtime.db), repository: new PostgresWaitRepository(runtime.db), ids: new CryptoUuidV7Generator(), clock: new SystemClock() },
      { session: decision.session, request: { runId: fields.runId, expectedRunRevision: fields.expectedRunRevision } },
    );
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Resume Run failed', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: RESUME_UNKNOWN, unknownOutcome: true };
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

export type AnswerEscalationActionResult =
  | Extract<AnswerEscalationResult, { readonly ok: true }>
  | { readonly ok: false; readonly reason: string; readonly code?: string; readonly timedOutAt?: string; readonly unknownOutcome?: boolean };

const ANSWER_ESCALATION_UNKNOWN = ESCALATION_PANEL_COPY.unknown;
const ANSWER_ESCALATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANSWER_ESCALATION_OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;
const ANSWER_ESCALATION_MALFORMED = ANSWER_ESCALATION_REFUSALS.malformed;

function validAnswerEscalationRequest(value: unknown): value is {
  readonly runId: string;
  readonly waitId: string;
  readonly expectedRunRevision: number;
  readonly answerOptionId: string;
  readonly note?: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.some((key) => !['runId', 'waitId', 'expectedRunRevision', 'answerOptionId', 'note'].includes(key))) return false;
  if (keys.length < 4 || keys.length > 5 ||
      typeof fields.runId !== 'string' || !ANSWER_ESCALATION_UUID.test(fields.runId) ||
      typeof fields.waitId !== 'string' || !ANSWER_ESCALATION_UUID.test(fields.waitId) ||
      typeof fields.expectedRunRevision !== 'number' || !Number.isSafeInteger(fields.expectedRunRevision) || fields.expectedRunRevision < 0 ||
      typeof fields.answerOptionId !== 'string' || !ANSWER_ESCALATION_OPTION_ID.test(fields.answerOptionId)) return false;
  return !Object.hasOwn(fields, 'note') || fields.note === null ||
    (typeof fields.note === 'string' && fields.note.trim().length > 0 && fields.note.length <= 500);
}

/**
 * Answer one open Escalation. This is a separate Server Action endpoint, so it authorizes
 * before reading the request and then delegates all locking, revision checks, and audit
 * writes to the application command. No question, Evidence value, or note is sent to an
 * agent; the note is a command-side audit field only.
 */
export async function answerEscalationAction(request: unknown): Promise<AnswerEscalationActionResult> {
  try {
    const decision = await requireServerAction('escalation.answer');
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (!validAnswerEscalationRequest(request)) return { ok: false, reason: ANSWER_ESCALATION_MALFORMED, code: 'malformed' };
    const runtime = await getRuntime();
    const result = await answerEscalation(
      {
        repository: new PostgresWaitRepository(runtime.db),
        roles: new DrizzleRoleRepository(runtime.db),
        unitOfWork: new PostgresRunsUnitOfWork(runtime.db),
        ids: new CryptoUuidV7Generator(),
        clock: new SystemClock(),
      },
      { session: decision.session, request },
    );
    if (result.ok) {
      // Every tab is its own route; invalidate each concrete route after the transaction
      // commits so a refresh cannot retain an open panel on a sibling tab.
      for (const suffix of ['', '/evidence', '/exceptions', '/review', '/timeline']) {
        revalidatePath(`/runs/${request.runId}${suffix}`);
      }
      revalidatePath('/notifications');
    }
    return result;
  } catch (error) {
    try {
      const runtime = await getRuntime();
      runtime.telemetry.captureError('Captured failure', error, { correlationId: await currentCorrelationId(), outcome: 'failure' });
    } catch { /* Runtime boot failures are reported by instrumentation. */ }
    return { ok: false, reason: ANSWER_ESCALATION_UNKNOWN, unknownOutcome: true };
  }
}
