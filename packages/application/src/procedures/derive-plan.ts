import { canonicalJson, deriveExecutablePlan, equivalentExecutablePlan, ExecutablePlanSchema, type ExecutablePlan, type JsonValue } from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { ModelGatewayError, type ModelGateway, type PlanDerivationAttempt, type PlanDerivationJob } from './plan-ports.js';
import type { ProcedureRepository, ProceduresUnitOfWorkContext, ProcedureVersionRecord } from './ports.js';
import { planAuthoringDigest, planAuthoringInputs, queuePlanDerivation } from './plan-state.js';
import { PROCEDURE_REFUSALS } from './create-procedure.js';

export interface DerivePlanDependencies {
  readonly repository: Pick<ProcedureRepository, 'findVersion'>;
  readonly unitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext>;
  readonly clock: Clock;
  readonly ids: UuidV7Generator;
  readonly model: ModelGateway | null;
}
export interface PlanDelivery { readonly jobId?: string; readonly retriesRemaining?: number }
export type DerivePlanResult = { readonly ok: true; readonly outcome: PlanDerivationAttempt['outcome']; readonly retry?: true } | { readonly ok: false; readonly reason: string };
export const PLAN_INTERRUPTED = 'Plan derivation was interrupted or exhausted its retries. Retry derivation after the worker or model configuration is restored.';
const isSuccessful = (row: ProcedureVersionRecord, digest: string) => row.planInputDigest === digest && row.planStatus === 'succeeded' && row.compiledPlan !== null && row.planDerivable;
async function auditAttempt(context: ProceduresUnitOfWorkContext, row: ProcedureVersionRecord, attempt: PlanDerivationAttempt) {
  await context.auditEvents.append({ actor: { type: 'system', id: 'procedures-plan-worker' },
    eventType: attempt.outcome === 'started' ? 'lifecycle.procedure-plan-started' : 'lifecycle.procedure-plan-derived',
    source: 'worker', outcome: attempt.outcome === 'success' || attempt.outcome === 'started' ? 'success' : 'failure',
    sessionId: 'procedures-worker', correlationId: attempt.attemptId, aggregateId: row.procedureId,
    payload: { versionId: row.versionId, attemptId: attempt.attemptId, inputDigest: attempt.inputDigest,
      attemptedAt: attempt.attemptedAt, completedAt: attempt.completedAt ?? null, derivationOutcome: attempt.outcome,
      reason: attempt.reason, compilerVersion: row.planCompilerVersion, modelUsed: attempt.model !== null } });
}
/** Old producers may write authoring columns after migration without invalidating their digest. */
async function recoverLegacy(row: ProcedureVersionRecord, context: ProceduresUnitOfWorkContext): Promise<ProcedureVersionRecord> {
  if (row.state !== 'DRAFT' || row.planInputDigest === planAuthoringDigest(row)) return row;
  return queuePlanDerivation(row, context.derivationJobs);
}

/** Persist the audited start before compiler/model work; no transaction is held during I/O. */
export async function derivePlan(dependencies: DerivePlanDependencies, job: PlanDerivationJob, delivery: PlanDelivery = {}): Promise<DerivePlanResult> {
  if (job.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(job.inputDigest)) return { ok: false, reason: 'Invalid plan derivation job.' };
  const attemptId = dependencies.ids.next();
  const started = await dependencies.unitOfWork.execute(async (context) => {
    const row = await context.procedures.findVersionForUpdate(job.versionId);
    if (row === null) return { refused: PROCEDURE_REFUSALS.UNKNOWN_VERSION } as const;
    if (row.state !== 'DRAFT') return { refused: PROCEDURE_REFUSALS.NOT_A_DRAFT } as const;
    const stale = planAuthoringDigest(row) !== job.inputDigest;
    const attempt: PlanDerivationAttempt = { attemptId, inputDigest: job.inputDigest, attemptedAt: dependencies.clock.now().toISOString(),
      outcome: stale ? 'stale' : 'started', reason: stale ? 'The authored inputs changed before this derivation started.' : null,
      model: null, ...(delivery.jobId === undefined ? {} : { jobId: delivery.jobId }) };
    // A retried delivery reconciles an interrupted prior execution of the same queue job.
    const prior = row.planAttempts.map((entry) => entry.outcome === 'started' && delivery.jobId !== undefined && entry.jobId === delivery.jobId
      ? { ...entry, outcome: 'failure' as const, completedAt: dependencies.clock.now().toISOString(), reason: PLAN_INTERRUPTED } : entry);
    for (let index = 0; index < prior.length; index++) if (prior[index] !== row.planAttempts[index]) await auditAttempt(context, row, prior[index]!);
    const withAttempt = { ...row, planAttempts: [...prior, attempt] };
    const after = stale ? await recoverLegacy(withAttempt, context) : { ...withAttempt, planInputDigest: job.inputDigest,
      ...(isSuccessful(row, job.inputDigest) ? {} : { compiledPlan: null, planDerivable: false, planStatus: 'pending' as const, planFailureReason: null }) };
    await context.procedures.updateVersion(after);
    await auditAttempt(context, row, attempt);
    return { row, stale } as const;
  });
  if ('refused' in started) return { ok: false, reason: started.refused! };
  if (started.stale) return { ok: true, outcome: 'stale' };
  const before = started.row;
  let plan: ExecutablePlan | null = null;
  let reason: string | null = null;
  let retryable = false;
  let modelUsed: PlanDerivationAttempt['model'] = null;
  try {
    const result = deriveExecutablePlan(planAuthoringInputs(before), before.planCompilerVersion);
    if (!result.ok) reason = result.reason;
    else {
      plan = result.plan;
      if (before.derivationModel !== null) {
        if (dependencies.model === null || canonicalJson(dependencies.model.identity as unknown as JsonValue) !== canonicalJson(before.derivationModel as unknown as JsonValue)) reason = 'The frozen derivation model configuration is unavailable.';
        else {
          modelUsed = dependencies.model.identity;
          const candidate = await dependencies.model.derive(planAuthoringInputs(before), before.planCompilerVersion);
          const validated = ExecutablePlanSchema.safeParse(candidate);
          if (!validated.success) reason = 'The model response does not satisfy the executable plan contract.';
          else if (!equivalentExecutablePlan(validated.data, plan)) reason = 'The model response changes the authored executable plan semantics.';
        }
      }
    }
  } catch (error) {
    reason = error instanceof ModelGatewayError ? error.message : 'Plan derivation failed; the compiler or configured model could not complete the attempt.';
    retryable = error instanceof ModelGatewayError && error.retryable;
  }
  if (reason !== null) plan = null;
  return dependencies.unitOfWork.execute(async (context) => {
    const current = await context.procedures.findVersionForUpdate(job.versionId);
    if (current === null) return { ok: false, reason: PROCEDURE_REFUSALS.UNKNOWN_VERSION };
    const original = current.planAttempts.find((attempt) => attempt.attemptId === attemptId);
    if (original === undefined || original.outcome !== 'started') return { ok: true, outcome: 'stale' };
    const stale = current.state !== 'DRAFT' || planAuthoringDigest(current) !== job.inputDigest;
    const successful = isSuccessful(current, job.inputDigest);
    const outcome = stale ? 'stale' : plan === null ? 'failure' : 'success';
    const failureReason = current.state !== 'DRAFT' ? 'The version left Draft before this derivation completed.' : stale ? 'The authored inputs changed before this derivation completed.' : reason;
    const retry = !stale && !successful && plan === null && retryable && (delivery.retriesRemaining ?? 0) > 0;
    const attempt: PlanDerivationAttempt = { ...original, completedAt: dependencies.clock.now().toISOString(), published: !stale && !successful && plan !== null, outcome, reason: failureReason, model: modelUsed };
    let after: ProcedureVersionRecord = { ...current, planAttempts: current.planAttempts.map((entry) => entry.attemptId === attemptId ? attempt : attempt.published === true && entry.published === true ? { ...entry, published: false } : entry),
      ...(stale || successful ? {} : { compiledPlan: plan, planInputDigest: job.inputDigest, planDerivable: plan !== null,
        planStatus: plan !== null ? 'succeeded' as const : retry ? 'pending' as const : 'failed' as const, planFailureReason: retry ? null : failureReason }) };
    after = await recoverLegacy(after, context);
    await context.procedures.updateVersion(after);
    await auditAttempt(context, current, attempt);
    return { ok: true, outcome, ...(retry ? { retry: true as const } : {}) };
  });
}

/** Called only after queue metadata proves no live delivery remains for this digest. */
export async function reconcilePlanDerivation(dependencies: Pick<DerivePlanDependencies, 'unitOfWork' | 'clock' | 'ids'>, job: PlanDerivationJob): Promise<void> {
  await dependencies.unitOfWork.execute(async (context) => {
    const row = await context.procedures.findVersionForUpdate(job.versionId);
    if (row === null) return;
    if (await context.derivationJobs.hasLiveDelivery?.(job)) return;
    const now = dependencies.clock.now().toISOString();
    const attempts = row.planAttempts.map((entry) => entry.inputDigest === job.inputDigest && entry.outcome === 'started'
      ? { ...entry, outcome: 'failure' as const, completedAt: now, reason: PLAN_INTERRUPTED } : entry);
    const unfinished = attempts.filter((entry, index) => entry !== row.planAttempts[index]);
    const legacyDrift = row.state === 'DRAFT' && row.planInputDigest !== planAuthoringDigest(row);
    const failPreview = row.state === 'DRAFT' && planAuthoringDigest(row) === job.inputDigest && row.planInputDigest === job.inputDigest && row.planStatus === 'pending' && !isSuccessful(row, job.inputDigest);
    if (unfinished.length === 0 && !failPreview && (row.state !== 'DRAFT' || row.planInputDigest === planAuthoringDigest(row))) return;
    let after: ProcedureVersionRecord = { ...row, planAttempts: attempts, ...(failPreview ? { compiledPlan: null, planDerivable: false, planStatus: 'failed' as const, planFailureReason: PLAN_INTERRUPTED } : {}) };
    after = await recoverLegacy(after, context);
    await context.procedures.updateVersion(after);
    if (legacyDrift) await context.auditEvents.append({ actor: { type: 'system', id: 'procedures-plan-worker' }, eventType: 'lifecycle.procedure-plan-recovered', source: 'worker', outcome: 'success', sessionId: 'procedures-worker', correlationId: dependencies.ids.next(), aggregateId: row.procedureId, payload: { versionId: row.versionId, priorInputDigest: row.planInputDigest, inputDigest: after.planInputDigest } });
    for (const attempt of unfinished) await auditAttempt(context, row, attempt);
    if (failPreview) await context.auditEvents.append({ actor: { type: 'system', id: 'procedures-plan-worker' }, eventType: 'lifecycle.procedure-plan-reconciled', source: 'worker', outcome: 'failure', sessionId: 'procedures-worker', correlationId: dependencies.ids.next(), aggregateId: row.procedureId, payload: { versionId: row.versionId, inputDigest: job.inputDigest, reason: PLAN_INTERRUPTED } });
  });
}
