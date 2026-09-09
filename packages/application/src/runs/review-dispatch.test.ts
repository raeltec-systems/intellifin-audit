import { describe, expect, it } from 'vitest';

import {
  dispatchEvaluationReview,
  EVALUATION_REVIEW_DISPATCH_REFUSALS,
  executeEvaluationReviewCommand,
  parseEvaluationReviewJob,
  type EvaluationReviewCommand,
  type EvaluationReviewCommandContext,
} from './review-dispatch.js';

const RUN_ID = '01a06fd8-0000-7000-8000-0000000000a1';
const OBSERVATION_ID = '01a06fd8-0000-7000-8000-0000000000a2';
const COMMAND_ID = '01a06fd8-0000-7000-8000-0000000000a3';
const CORRELATION_ID = '01a06fd8-0000-7000-8000-0000000000a4';
const DECISION_ID = '01a06fd8-0000-7000-8000-0000000000a5';
const SESSION = { userId: 'auditor-1', sessionId: 'session-1' } as const;

function dependencies(overrides: Partial<{
  role: 'auditor' | null;
  enqueue: (command: EvaluationReviewCommand) => Promise<
    { commandId: string; status: 'accepted' } |
    { commandId: string; status: 'conflict'; reason: string }
  >;
}> = {}) {
  const commands: EvaluationReviewCommand[] = [];
  let next = 0;
  return {
    commands,
    dispatcher: {
      enqueue: overrides.enqueue ?? (async (command: EvaluationReviewCommand) => {
        commands.push(command);
        return { commandId: command.commandId, status: 'accepted' as const };
      }),
    },
    roles: { findRole: async () => overrides.role === undefined ? 'auditor' : overrides.role },
    unitOfWork: { execute: async <T>(work: (context: { auditEvents: { append: () => Promise<never> } }) => Promise<T>) => work({ auditEvents: { append: async () => undefined as never } }) },
    ids: { next: () => [CORRELATION_ID, COMMAND_ID][next++] ?? '01a06fd8-0000-7000-8000-0000000000a5' },
    clock: { now: () => new Date('2026-09-07T09:00:00.000Z') },
  };
}

describe('durable evaluation-review dispatch', () => {
  it('authorizes, bounds and persists the review request while returning accepted/pending', async () => {
    const deps = dependencies();
    const result = await dispatchEvaluationReview(deps, {
      session: SESSION,
      request: { runId: RUN_ID, observationId: OBSERVATION_ID, conditionId: 'C2', expectedReviewRevision: 4 },
    }, 'confirm');

    expect(result).toEqual({
      ok: true,
      status: 'accepted',
      pending: true,
      commandId: COMMAND_ID,
      action: 'confirm',
      runId: RUN_ID,
      expectedReviewRevision: 4,
    });
    expect(deps.commands).toHaveLength(1);
    expect(deps.commands[0]).toMatchObject({
      schemaVersion: 1,
      commandId: COMMAND_ID,
      actorId: SESSION.userId,
      sessionId: SESSION.sessionId,
      correlationId: CORRELATION_ID,
      replacementValue: null,
      rationale: null,
    });
  });

  it('does not enqueue malformed input after authorization', async () => {
    const deps = dependencies();
    const result = await dispatchEvaluationReview(deps, {
      session: SESSION,
      request: { runId: RUN_ID, observationId: OBSERVATION_ID, conditionId: 'C2', expectedReviewRevision: 0, extra: true },
    }, 'confirm');
    expect(result).toMatchObject({ ok: false, code: 'malformed' });
    expect(deps.commands).toHaveLength(0);
  });

  it('does not report another actor’s pending command as this request being accepted', async () => {
    const deps = dependencies({ enqueue: async () => ({
      commandId: COMMAND_ID,
      status: 'conflict',
      reason: 'secret actor rationale must not escape',
    }) });
    const result = await dispatchEvaluationReview(deps, {
      session: SESSION,
      request: { runId: RUN_ID, observationId: OBSERVATION_ID, conditionId: 'C2', expectedReviewRevision: 4 },
    }, 'confirm');
    expect(result).toEqual({
      ok: false,
      code: 'already-pending',
      reason: EVALUATION_REVIEW_DISPATCH_REFUSALS.conflict,
    });
  });

  it('does not inspect or enqueue a command for a revoked reviewer', async () => {
    const deps = dependencies({ role: null });
    const result = await dispatchEvaluationReview(deps, {
      session: SESSION,
      request: new Proxy({}, { ownKeys: () => { throw new Error('request inspected'); } }),
    }, 'confirm');
    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(deps.commands).toHaveLength(0);
  });

  it('accepts only the closed queue envelope and rejects authored payload fields', () => {
    expect(parseEvaluationReviewJob({
      schemaVersion: 1,
      kind: 'evaluation-review',
      commandId: COMMAND_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
    })).toMatchObject({ kind: 'evaluation-review', commandId: COMMAND_ID });
    expect(parseEvaluationReviewJob({
      schemaVersion: 1,
      kind: 'evaluation-review',
      commandId: COMMAND_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      rationale: 'secret',
    })).toBeNull();
  });

  it('rechecks the reviewer in the worker transaction and completes a refused command', async () => {
    const command: EvaluationReviewCommand = {
      schemaVersion: 1,
      commandId: COMMAND_ID,
      runId: RUN_ID,
      observationId: OBSERVATION_ID,
      conditionId: 'C2',
      expectedReviewRevision: 4,
      action: 'confirm',
      replacementValue: null,
      rationale: null,
      actorId: SESSION.userId,
      sessionId: SESSION.sessionId,
      correlationId: CORRELATION_ID,
      requestedAt: '2026-09-07T09:00:00.000Z',
    };
    const completions: unknown[] = [];
    let receivedCommandId: string | null = null;
    const context = {
      run: null,
      authorizationRoles: { findRole: async () => null },
      auditEvents: { append: async () => ({ sequence: 1 }) },
      completeCommand: async (completion: unknown) => { completions.push(completion); },
    } as unknown as EvaluationReviewCommandContext;
    const repository = {
      transactionCommand: async <T>(
        commandId: string,
        work: (value: EvaluationReviewCommand, valueContext: EvaluationReviewCommandContext) => Promise<T>,
      ) => {
        receivedCommandId = commandId;
        return work(command, context);
      },
    } as never;

    const result = await executeEvaluationReviewCommand({
      repository,
      ids: { next: () => DECISION_ID },
      clock: { now: () => new Date('2026-09-07T09:00:00.000Z') },
    }, COMMAND_ID);

    expect(receivedCommandId).toBe(COMMAND_ID);
    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(completions).toEqual([{ status: 'REFUSED', refusalCode: 'unauthorized' }]);
  });
});
