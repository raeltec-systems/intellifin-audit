import {
  populationSessionStep,
  reconcilePopulation,
  sha256HexOfBytes,
  type ExecutablePlan,
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
import { freezeArtifact, reserveArtifact } from './evidence-package.js';
import { NO_CREDENTIALS } from './credential-guard.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';
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
/**
 * Stop a Run at its own time limit WITHOUT discarding what it already froze.
 *
 * The owner's decision of 2026-09-06, which this file previously recorded as an accepted
 * risk rather than a defect. A Run that has already acquired, stored and verified its
 * population and then crosses the Run time limit still ends `INCONCLUSIVE` — the limit is
 * real and `runTimeoutSeconds` is a frozen compiler-1 value that nothing here may weaken —
 * but the population Evidence stays REGISTERED and the sealed Result names it. Inconclusive
 * with Evidence and Inconclusive with nothing are different findings to an auditor, and
 * only one of them is true here.
 *
 * Three properties, and all three are the point:
 *
 * - **Nothing new starts.** No store read, no acquisition, no re-verification. A timeout
 *   must not begin work; it ends a Run.
 * - **Nothing already frozen is lost.** The checkpoint's digests, size, capture provenance
 *   and Evidence id are carried through verbatim, so `population_evidence` stays
 *   `REGISTERED` and the seal finds it. Nothing here abandons a reservation either —
 *   `SealPackage` is the one thing that does.
 * - **No attempt is spent.** The old path came out of a thrown `remaining()` and was
 *   handled as a verification FAILURE, which incremented the durable attempt counter for
 *   work nobody did. A limit is not an attempt.
 */
async function stopAtRunLimit(
  deps: PopulationDependencies,
  input: {
    readonly run: RunRecord;
    readonly plan: ExecutablePlan | null;
    readonly checkpoint: PopulationCheckpoint;
  },
): Promise<{ retry: boolean }> {
  const { run, plan, checkpoint } = input;
  return deps.repository.transaction(run.runId, async (context) => {
    // The same guard every other write in this file takes: a claim whose checkpoint moved
    // under it commits nothing. Re-read here rather than trusted from the claim, because
    // the recovery sweep and a redelivery can both be in flight.
    if (
      context.checkpoint?.revision !== checkpoint.revision ||
      context.checkpoint.status !== checkpoint.status ||
      context.run?.state !== 'RUNNING'
    )
      return { retry: false };
    const next: PopulationCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      status: 'TERMINAL',
      diagnostic: 'run-time-limit',
    };
    await context.save(next, 'INCONCLUSIVE');
    await event(context, 'run-time-limit', 'INCONCLUSIVE', next.attempts, next, 'failure');
    await completeRun(context, {
      run,
      state: 'INCONCLUSIVE',
      at: deps.clock.now().toISOString(),
      plan: plan ?? null,
    });
    return { retry: false };
  });
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
      // A person asked for this Run to stop (Story 3.10). This claim transaction is the
      // boundary: it has the Run state it just read under the row lock, no lease is live
      // and no unit has started, so the transition happens HERE and the recovery sweep
      // never resumes it. It is checked before the POPULATION_READY early return too, so a
      // Run whose population is already frozen stops here rather than in the next stage.
      if (run.cancellation !== null) {
        if (prior)
          await context.save(
            { ...prior, revision: prior.revision + 1, status: 'TERMINAL', diagnostic: 'canceled' },
            'CANCELED',
          );
        await performCancellation(context, {
          run,
          request: run.cancellation,
          at: now.toISOString(),
          plan: plan ?? null,
          source: 'worker',
        });
        return null;
      }
      if (prior?.status === 'POPULATION_READY') return { checkpoint: prior, plan, run, verificationOnly: true as const };
      // The reservation is NAMED, not minted (Story 3.5): the Evidence id, both object
      // keys and the `required` verdict are derived from `(runId, kind, scope)` and the
      // frozen Template, so a retried production after a crash reuses this reservation
      // rather than minting a second object beside the first. A row an earlier build
      // wrote still wins, because its object is really there under the id it recorded.
      const reserved = reserveArtifact({
        runId: run.runId,
        kind: 'population',
        scope: '',
        templateId: plan?.inputs.templateId ?? null,
      });
      const checkpoint: PopulationCheckpoint = {
        revision: (prior?.revision ?? 0) + 1,
        status: 'ACQUIRING',
        attempts: Math.min(4, (prior?.attempts ?? 0) + 1),
        startedAt: prior?.startedAt ?? now.toISOString(),
        attemptStartedAt: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 120000).toISOString(),
        evidenceId: prior?.evidenceId ?? reserved.evidenceId,
        objectKey: prior?.objectKey ?? reserved.objectKeys[0]!,
        envelopeKey: prior?.envelopeKey ?? reserved.objectKeys[1]!,
        evidenceRequired: reserved.required,
        // A reservation has captured nothing. The provenance is stamped at the
        // registration that verifies the raw bytes, and a resumed attempt inherits what
        // the attempt that really captured them recorded.
        capturedAt: prior?.capturedAt ?? null,
        captureMethod: prior?.captureMethod ?? null,
        captureTimeSource: prior?.captureTimeSource ?? null,
        rawDigest: prior?.rawDigest ?? null,
        envelopeDigest: prior?.envelopeDigest ?? null,
        stepId: (plan === null ? null : populationSessionStep(plan))?.stepId ?? 'unsupported',
        attemptId: deps.ids.next(),
        size: prior?.size ?? null,
        diagnostic: null,
      };
      const failed =
        !plan ||
        // Where the compiler PUTS the population step, which is first in an adapter-only
        // plan and second in an agent plan — `create-workspace` is emitted before it
        // whenever a selected Target is agent-driven. This read `sessionSteps[0]`
        // literally, so every agent Run was refused `unsupported-frozen-plan` before
        // anything could sign in. Story 4.2 is what takes over from that refusal.
        populationSessionStep(plan) === null ||
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
        await completeRun(context, { run, state, at: now.toISOString(), plan: plan ?? null });
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
    const overRunLimit = () => deps.clock.now().getTime() >= runDeadline;
    const deadline = Math.min(checkpoint.status === 'ACQUIRING' ? Date.parse(checkpoint.leaseUntil) : deps.clock.now().getTime() + (plan?.limits.stepTimeoutSeconds ?? 120) * 1000, runDeadline);
    const remaining = () => { const ms = deadline - deps.clock.now().getTime(); if (ms <= 0) throw new PopulationAcquisitionError('transport'); return ms; };
    // The Run's own time limit, BEFORE any I/O. A redelivered job past the limit does no
    // new work — it does not read the store, it does not spend an attempt — and it does
    // not throw away what is already frozen. See `stopAtRunLimit`.
    if (overRunLimit()) return stopAtRunLimit(deps, { run, plan, checkpoint });
    try {
      if (!plan) throw new PopulationAcquisitionError('contract');
      const envelope = await deps.store.read(checkpoint.envelopeKey, remaining());
      const raw = await deps.store.read(checkpoint.objectKey, remaining());
      remaining();
      if (!envelope || !raw || sha256HexOfBytes(envelope) !== checkpoint.envelopeDigest || sha256HexOfBytes(raw) !== checkpoint.rawDigest || raw.length !== checkpoint.size) throw new PopulationAcquisitionError('integrity');
      if (checkpoint.status === 'ACQUIRING') {
        await deps.repository.transaction(run.runId, async context => {
          if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'ACQUIRING' || context.run?.state !== 'RUNNING') return;
          remaining();
          await context.save({ ...checkpoint, status: 'POPULATION_READY', diagnostic: null }, 'RUNNING');
          await event(context, 'population-evidence-reverified', 'RUNNING', checkpoint.attempts, checkpoint);
          remaining();
        });
      }
      // The verification SUCCEEDED and only then did the limit pass. It used to be a
      // `remaining()` here, which threw the success away as a transport failure and spent
      // a durable attempt on it; the Run stops at its limit instead, with the Evidence it
      // verified a moment ago left registered.
      if (overRunLimit()) return stopAtRunLimit(deps, { run, plan, checkpoint });
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
        await completeRun(context, { run, state, at: deps.clock.now().toISOString(), plan: plan ?? null });
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
      const committed = await deps.repository.transaction(
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
      if (!committed) return { retry: false };
      // Reserve, upload, VERIFY — the envelope goes through the same owned mechanism as
      // the raw bytes. It used to be uploaded and then compared against the copy still in
      // memory, which proves the process has not corrupted itself and nothing about what
      // the store holds.
      await freezeArtifact(
        deps.store,
        { objectKey: checkpoint.envelopeKey, registeredDigest: digest, registeredSize: null },
        envelope,
        remaining,
        // This stage presents no credential, and it cannot: population acquisition runs
        // BEFORE the sign-in and before any adapter extraction, so at the moment these
        // bytes are frozen the Run has resolved nothing to scan for. Holding the plan's
        // credentials here to scan for them anyway would mean resolving a secret in a stage
        // that must never have one, which is the opposite of just in time.
        NO_CREDENTIALS,
      );
    }
    if (
      checkpoint.envelopeDigest === null ||
      sha256HexOfBytes(envelope) !== checkpoint.envelopeDigest
    )
      throw new PopulationAcquisitionError('integrity');
    const preserved = decodeAcquisitionEnvelope(envelope);
    const bytes = preserved.bytes;
    // Availability, size and SHA-256, against the bytes just sent AND against any digest a
    // previous attempt already registered — one implementation, both producers.
    await freezeArtifact(
      deps.store,
      {
        objectKey: checkpoint.objectKey,
        registeredDigest: checkpoint.rawDigest,
        registeredSize: checkpoint.size,
      },
      bytes,
      remaining,
      NO_CREDENTIALS,
    );
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
      const registeredAt = deps.clock.now().toISOString();
      const next = {
        ...checkpoint,
        rawDigest: result.rawDigest,
        size: bytes.length,
        // FR-31's capture provenance, MEASURED here: this transaction is where the
        // population artifact becomes `REGISTERED`, so this is the instant it was captured
        // and `registration` says that is what it is.
        //
        // Unconditional, and it has to be reasoned about rather than coalesced. This
        // transaction is reached ONLY when the claim found no raw digest — an
        // already-registered artifact is routed to the verification-only path above — and
        // these three fields are written in this one object beside `rawDigest`, so a
        // checkpoint that reaches here has captured nothing yet. A `?? checkpoint.capturedAt`
        // fallback would read as the guard that stops a redelivery moving the instant and
        // would be a branch nothing can reach, which is a branch nothing would notice being
        // inverted. The guard that IS reachable is `registerEvidence`, for the adapter
        // artifacts a retry really can re-register; here the property is that a redelivery
        // never comes back through this transaction at all.
        capturedAt: registeredAt,
        captureMethod: 'adapter' as const,
        captureTimeSource: 'registration' as const,
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
      await completeRun(context, {
        run,
        state: result.ready ? 'RUNNING' : 'INCONCLUSIVE',
        at: deps.clock.now().toISOString(),
        plan,
      });
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
      await completeRun(context, { run, state, at: deps.clock.now().toISOString(), plan });
      return { retry: !terminal };
    });
  }
}
