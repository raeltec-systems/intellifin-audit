import {
  reconcilePopulation,
  sha256HexOfBytes,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  PopulationAcquisitionError,
  type EvidenceStore,
  type PopulationAcquisitionPort,
  type PopulationCheckpoint,
  type PopulationExecutionContext,
  type PopulationExecutionRepository,
} from './execution-ports.js';
import { decodeAcquisitionEnvelope, encodeAcquisitionEnvelope } from './acquisition-envelope.js';
export interface PopulationDependencies {
  repository: PopulationExecutionRepository;
  acquisition: PopulationAcquisitionPort;
  store: EvidenceStore;
  clock: Clock;
  ids: UuidV7Generator;
}
export interface PopulationJob {
  schemaVersion: 1;
  runId: string;
  correlationId: string;
}
async function event(
  context: PopulationExecutionContext,
  diagnostic: string,
  state: RunRecord['state'],
  attempts: number,
  evidence?: PopulationCheckpoint,
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  const run = context.run!;
  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'population-worker' },
    eventType: 'lifecycle.population-acquisition',
    source: 'worker',
    outcome,
    aggregateId: run.runId,
    correlationId: run.correlationId,
    sessionId: run.sessionId,
    payload: {
      state,
      diagnostic,
      attempts,
      ...(evidence
        ? {
            evidenceId: evidence.evidenceId,
            rawDigest: evidence.rawDigest,
            envelopeDigest: evidence.envelopeDigest,
            size: evidence.size,
            stepId: evidence.stepId,
            attemptId: evidence.attemptId,
          }
        : {}),
    },
  });
  await context.notifyTimeline(stored.sequence);
}
/** Each I/O is bounded by the original attempt deadline, including after restart. */
export async function acquirePopulation(
  deps: PopulationDependencies,
  job: PopulationJob,
): Promise<{ retry: boolean }> {
  const claim = await deps.repository.transaction(
    job.runId,
    async (context) => {
      const run = context.run;
      if (
        !run ||
        run.correlationId !== job.correlationId ||
        job.schemaVersion !== 1
      )
        return null;
      const prior = context.checkpoint,
        now = deps.clock.now();
      if (
        !['QUEUED', 'RUNNING'].includes(run.state) ||
        prior?.status === 'TERMINAL'
      )
        return null;
      if (
        prior?.status === 'ACQUIRING' &&
        Date.parse(prior.leaseUntil) > now.getTime()
      )
        return null;
      const plan = await context.frozenPlan();
      if (prior?.status === 'POPULATION_READY') return { checkpoint: prior, plan, run, verificationOnly: true as const };
      const checkpoint: PopulationCheckpoint = {
        revision: (prior?.revision ?? 0) + 1,
        status: 'ACQUIRING',
        attempts: Math.min(4, (prior?.attempts ?? 0) + 1),
        startedAt: prior?.startedAt ?? now.toISOString(),
        attemptStartedAt: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 120000).toISOString(),
        evidenceId: prior?.evidenceId ?? deps.ids.next(),
        objectKey: prior?.objectKey ?? `population/${run.runId}/raw`,
        envelopeKey:
          prior?.envelopeKey ?? `population/${run.runId}/acquisition-v1`,
        rawDigest: prior?.rawDigest ?? null,
        envelopeDigest: prior?.envelopeDigest ?? null,
        stepId:
          plan?.sessionSteps.find((s) => s.action === 'acquire-population')
            ?.id ?? 'unsupported',
        attemptId: deps.ids.next(),
        size: prior?.size ?? null,
        diagnostic: null,
      };
      const failed =
        !plan ||
        plan.sessionSteps[0]?.action !== 'acquire-population' ||
        !plan.inputs.sourceSnapshot ||
        !['versioned-file', 'read-only-api'].includes(
          plan.inputs.sourceSnapshot.contract.kind,
        )
          ? 'unsupported-frozen-plan'
          : now.getTime() - Date.parse(checkpoint.startedAt) >=
              plan.limits.runTimeoutSeconds * 1000
            ? 'run-time-limit'
            : (prior?.attempts ?? 0) >= plan.limits.retriesPerStep + 1
              ? 'attempt-limit'
              : null;
      if (failed) {
        checkpoint.status = 'TERMINAL';
        checkpoint.diagnostic = failed;
        const state =
          failed === 'run-time-limit' ? 'INCONCLUSIVE' : 'RUN_FAILED';
        await context.save(checkpoint, state);
        await event(context, failed, state, checkpoint.attempts, checkpoint, 'failure');
        return null;
      }
      await context.save(checkpoint, 'RUNNING');
      await event(
        context,
        'population-attempt-started',
        'RUNNING',
        checkpoint.attempts,
        checkpoint,
      );
      return checkpoint.rawDigest !== null
        ? { checkpoint, plan: plan!, run, verificationOnly: true as const }
        : { checkpoint, plan: plan!, run, verificationOnly: false as const };
    },
  );
  if (!claim) return { retry: false };
  if (claim.verificationOnly) {
    const { checkpoint, run, plan } = claim;
    const runDeadline = Date.parse(checkpoint.startedAt) + (plan?.limits.runTimeoutSeconds ?? 3600) * 1000;
    const deadline = Math.min(checkpoint.status === 'ACQUIRING' ? Date.parse(checkpoint.leaseUntil) : deps.clock.now().getTime() + (plan?.limits.stepTimeoutSeconds ?? 120) * 1000, runDeadline);
    const remaining = () => { const ms = deadline - deps.clock.now().getTime(); if (ms <= 0) throw new PopulationAcquisitionError('transport'); return ms; };
    try {
      if (!plan) throw new PopulationAcquisitionError('contract');
      const envelope = await deps.store.read(checkpoint.envelopeKey, remaining());
      const raw = await deps.store.read(checkpoint.objectKey, remaining());
      remaining();
      if (!envelope || !raw || sha256HexOfBytes(envelope) !== checkpoint.envelopeDigest || sha256HexOfBytes(raw) !== checkpoint.rawDigest || raw.length !== checkpoint.size) throw new PopulationAcquisitionError('integrity');
      remaining();
      if (checkpoint.status === 'ACQUIRING') {
        await deps.repository.transaction(run.runId, async context => {
          if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'ACQUIRING' || context.run?.state !== 'RUNNING') return;
          remaining();
          await context.save({ ...checkpoint, status: 'POPULATION_READY', diagnostic: null }, 'RUNNING');
          await event(context, 'population-evidence-reverified', 'RUNNING', checkpoint.attempts, checkpoint);
          remaining();
        });
      }
      return { retry: false };
    } catch (error) {
      const expired = deps.clock.now().getTime() >= runDeadline;
      return deps.repository.transaction(run.runId, async context => {
        if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== checkpoint.status || context.run?.state !== 'RUNNING') return { retry: false };
        // A failed immediate redelivery check consumes one additional durable attempt.
        // RETRY resumes through the normal leased claim, retaining registered bytes.
        const attempts = checkpoint.status === 'POPULATION_READY' ? Math.min(4, checkpoint.attempts + 1) : checkpoint.attempts;
        const transport = !(error instanceof PopulationAcquisitionError) || error.code === 'transport';
        const terminal = expired || !transport || attempts >= (plan?.limits.retriesPerStep ?? 3) + 1;
        const state = expired ? 'INCONCLUSIVE' : terminal ? 'RUN_FAILED' : 'RUNNING';
        const diagnostic = expired ? 'run-time-limit' : terminal ? transport ? 'population-transport-failed' : 'population-integrity-failed' : 'population-verification-retry';
        const next = { ...checkpoint, attempts, revision: checkpoint.revision + 1, status: terminal ? 'TERMINAL' as const : 'RETRY' as const, diagnostic };
        await context.save(next, state);
        await event(context, diagnostic, state, attempts, next, 'failure');
        return { retry: !terminal };
      });
    }
  }
  const { checkpoint, plan, run } = claim;
  const runDeadline = Date.parse(checkpoint.startedAt) + plan.limits.runTimeoutSeconds * 1000;
  const remaining = () => {
    const ms = Math.min(Date.parse(checkpoint.leaseUntil), runDeadline) - deps.clock.now().getTime();
    if (ms <= 0) throw new PopulationAcquisitionError('transport');
    return ms;
  };
  try {
    let envelope = await deps.store.read(checkpoint.envelopeKey, remaining());
    if (envelope === null) {
      const acquired = await deps.acquisition.acquire(
        plan.inputs.sourceSnapshot!,
        run.period,
        remaining(),
      );
      envelope = encodeAcquisitionEnvelope(acquired);
      const digest = sha256HexOfBytes(envelope);
      if (
        checkpoint.envelopeDigest !== null &&
        checkpoint.envelopeDigest !== digest
      )
        throw new PopulationAcquisitionError('integrity');
      const reserved = await deps.repository.transaction(
        run.runId,
        async (context) => {
          if (
            context.checkpoint?.revision !== checkpoint.revision ||
            context.checkpoint.status !== 'ACQUIRING' ||
            context.run?.state !== 'RUNNING'
          )
            return false;
          checkpoint.envelopeDigest = digest;
          await context.save(checkpoint, 'RUNNING');
          await event(
            context,
            'population-evidence-reserved',
            'RUNNING',
            checkpoint.attempts,
            checkpoint,
          );
          return true;
        },
      );
      if (!reserved) return { retry: false };
      await deps.store.putIfAbsent(
        checkpoint.envelopeKey,
        envelope,
        remaining(),
      );
    }
    if (
      checkpoint.envelopeDigest === null ||
      sha256HexOfBytes(envelope) !== checkpoint.envelopeDigest
    )
      throw new PopulationAcquisitionError('integrity');
    const preserved = decodeAcquisitionEnvelope(envelope);
    const bytes = preserved.bytes;
    if (
      checkpoint.rawDigest !== null &&
      checkpoint.rawDigest !== sha256HexOfBytes(bytes)
    )
      throw new PopulationAcquisitionError('integrity');
    await deps.store.putIfAbsent(checkpoint.objectKey, bytes, remaining());
    const stored = await deps.store.read(checkpoint.objectKey, remaining());
    if (
      stored === null ||
      stored.length !== bytes.length ||
      sha256HexOfBytes(stored) !== sha256HexOfBytes(bytes)
    )
      throw new PopulationAcquisitionError('integrity');
    const result = reconcilePopulation({
      bytes,
      mediaType: preserved.mediaType,
      declaration: preserved.declaration,
      source: plan.inputs.sourceSnapshot!,
      period: run.period,
      rule: plan.inputs.inclusionRule,
      zeroRecordPass: plan.inputs.zeroRecordPass,
      initiatedAt: run.initiatedAt,
    });
    await deps.repository.transaction(run.runId, async (context) => {
      if (
        context.checkpoint?.revision !== checkpoint.revision ||
        context.checkpoint.status !== 'ACQUIRING' ||
        context.run?.state !== 'RUNNING'
      )
        return;
      remaining();
      const next = {
        ...checkpoint,
        rawDigest: result.rawDigest,
        size: bytes.length,
        status: result.ready
          ? ('POPULATION_READY' as const)
          : ('TERMINAL' as const),
        diagnostic: result.ready
          ? null
          : result.checks
              .filter((c) => !c.passed)
              .map((c) => c.name)
              .join(', '),
      };
      await context.save(
        next,
        result.ready ? 'RUNNING' : 'INCONCLUSIVE',
        result,
      );
      for (const check of result.checks)
        await event(
          context,
          `${check.name}:${check.passed ? 'passed' : 'failed'}`,
          result.ready ? 'RUNNING' : 'INCONCLUSIVE',
          checkpoint.attempts,
          next,
          check.passed ? 'success' : 'failure',
        );
      await event(
        context,
        result.ready ? 'population-ready' : next.diagnostic!,
        result.ready ? 'RUNNING' : 'INCONCLUSIVE',
        checkpoint.attempts,
        next,
        result.ready ? 'success' : 'failure',
      );
      remaining();
    });
    return { retry: false };
  } catch (error) {
    return deps.repository.transaction(run.runId, async (context) => {
      if (
        context.checkpoint?.revision !== checkpoint.revision ||
        context.checkpoint.status !== 'ACQUIRING' ||
        context.run?.state !== 'RUNNING'
      )
        return { retry: false };
      const code =
        error instanceof PopulationAcquisitionError ? error.code : 'transport';
      const terminal =
        code !== 'transport' ||
        checkpoint.attempts >= plan.limits.retriesPerStep + 1 ||
        deps.clock.now().getTime() - Date.parse(checkpoint.startedAt) >=
          plan.limits.runTimeoutSeconds * 1000;
      const diagnostic = terminal
        ? `population-${code}-failed`
        : 'population-retry-pending';
      const state =
        deps.clock.now().getTime() - Date.parse(checkpoint.startedAt) >=
        plan.limits.runTimeoutSeconds * 1000
          ? 'INCONCLUSIVE'
          : terminal
            ? 'RUN_FAILED'
            : 'RUNNING';
      await context.save(
        { ...checkpoint, status: terminal ? 'TERMINAL' : 'RETRY', diagnostic },
        state,
      );
      await event(context, diagnostic, state, checkpoint.attempts, checkpoint, 'failure');
      return { retry: !terminal };
    });
  }
}
