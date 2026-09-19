import { describe, expect, it } from 'vitest';

import {
  RUN_CONVERSATION_MAX_TEXT_CHARS,
  RUN_CONVERSATION_PAGE_SIZE,
  detectRunConversationSecretPattern,
  interpretRunConversationMessage,
  parseRunConversationMessageRequest,
  type RunConversationMessageRequest,
  type RunConversationAppendReceipt,
  type RunConversationRead,
} from './run-conversation.js';

const RUN = '01920000-0000-7000-8000-000000000001';
const OTHER_RUN = '01920000-0000-7000-8000-000000000002';
const IDEMPOTENCY = '01920000-0000-7000-8000-000000000003';
const WAIT = '01920000-0000-7000-8000-000000000004';
const INSPECTION = {
  workItemId: '01920000-0000-7000-8000-000000000005',
  subjectKey: 'EMP-0042',
  registrationId: '01920000-0000-7000-8000-000000000006',
  runRevision: 7,
  planDigest: 'ab'.repeat(32),
};

const baseEnvelope = {
  runId: RUN.toUpperCase(),
  idempotencyKey: IDEMPOTENCY.toUpperCase(),
  text: 'What changed in the latest source?',
};

function parseSuccess(overrides: Record<string, unknown> = {}): RunConversationMessageRequest {
  const result = parseRunConversationMessageRequest({ ...baseEnvelope, ...overrides });
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  return result.value;
}

describe('the bounded Run conversation request parser', () => {
  it('normalizes UUID identifiers and supplies explicit nulls for optional scope', () => {
    expect(parseSuccess()).toEqual({
      runId: RUN,
      idempotencyKey: IDEMPOTENCY,
      text: baseEnvelope.text,
      selectedSourceOrdinal: null,
      replyToWaitId: null,
    });
  });

  it('accepts a positive safe source ordinal and a UUID wait reply', () => {
    expect(
      parseSuccess({ selectedSourceOrdinal: Number.MAX_SAFE_INTEGER, replyToWaitId: WAIT.toUpperCase() }),
    ).toMatchObject({
      selectedSourceOrdinal: Number.MAX_SAFE_INTEGER,
      replyToWaitId: WAIT,
    });
  });

  it('accepts the normalized client DTO again with explicit absent context', () => {
    const normalized = parseSuccess();
    expect(parseRunConversationMessageRequest(normalized)).toEqual({ ok: true, value: normalized });
    expect(parseSuccess({ selectedSourceOrdinal: null, replyToWaitId: null })).toEqual(normalized);
  });

  it('preserves the captured inspection without accepting client authority or attempt identity', () => {
    const parsed = parseSuccess({ currentInspection: INSPECTION });
    expect(parsed.currentInspection).toEqual(INSPECTION);
    expect(parseRunConversationMessageRequest(parsed)).toEqual({ ok: true, value: parsed });
    for (const currentInspection of [
      { ...INSPECTION, expectedControlEpoch: 1 },
      { ...INSPECTION, attemptId: WAIT },
      { ...INSPECTION, selectedSourceOrdinal: 42 },
      { ...INSPECTION, runRevision: -1 },
      { ...INSPECTION, planDigest: 'AB'.repeat(32) },
      { ...INSPECTION, subjectKey: '😀'.repeat(129) },
    ]) {
      expect(parseRunConversationMessageRequest({ ...baseEnvelope, currentInspection })).toMatchObject({ ok: false });
    }
    expect(parseRunConversationMessageRequest({ ...baseEnvelope, currentInspection: INSPECTION, expectedControlEpoch: 1 }))
      .toMatchObject({ ok: false, code: 'unknown-fields' });
  });

  it('rejects missing and unknown envelope fields before interpretation', () => {
    expect(parseRunConversationMessageRequest({ runId: RUN, idempotencyKey: IDEMPOTENCY })).toMatchObject({
      ok: false,
      code: 'malformed',
    });
    expect(
      parseRunConversationMessageRequest({ ...baseEnvelope, unexpected: 'ignore me' }),
    ).toMatchObject({ ok: false, code: 'unknown-fields' });
  });

  it('rejects malformed UUIDs, including the optional wait scope', () => {
    expect(parseRunConversationMessageRequest({ ...baseEnvelope, runId: OTHER_RUN.slice(0, -1) })).toMatchObject({
      ok: false,
      code: 'invalid-run-id',
    });
    expect(
      parseRunConversationMessageRequest({ ...baseEnvelope, idempotencyKey: 'not-a-uuid' }),
    ).toMatchObject({ ok: false, code: 'invalid-idempotency-key' });
    expect(
      parseRunConversationMessageRequest({ ...baseEnvelope, replyToWaitId: 'not-a-uuid' }),
    ).toMatchObject({ ok: false, code: 'reply-to-wait-invalid' });
  });

  it('requires text and counts Unicode scalar values rather than UTF-16 code units', () => {
    expect(parseRunConversationMessageRequest({ ...baseEnvelope, text: ' \n\t ' })).toMatchObject({
      ok: false,
      code: 'text-empty',
    });

    // Four thousand astral characters are 4,000 Unicode characters and 16,000 UTF-8
    // bytes, so the two independent limits meet at this boundary.
    const atLimit = '😀'.repeat(RUN_CONVERSATION_MAX_TEXT_CHARS);
    expect(parseRunConversationMessageRequest({ ...baseEnvelope, text: atLimit })).toMatchObject({ ok: true });
    expect(
      parseRunConversationMessageRequest({ ...baseEnvelope, text: `${atLimit}a` }),
    ).toMatchObject({ ok: false, code: 'text-too-long' });

    // A lone surrogate is not valid Unicode and must not be passed to a content store.
    expect(parseRunConversationMessageRequest({ ...baseEnvelope, text: '\ud800' })).toMatchObject({
      ok: false,
      code: 'invalid-unicode',
    });
  });

  it('requires a positive safe integer source ordinal', () => {
    for (const selectedSourceOrdinal of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      expect(
        parseRunConversationMessageRequest({ ...baseEnvelope, selectedSourceOrdinal }),
      ).toMatchObject({ ok: false, code: 'selected-source-ordinal-invalid' });
    }
  });

  it('rejects obvious password, OTP and token-shaped text without claiming containment', () => {
    expect(detectRunConversationSecretPattern('password: hunter2')).toBe('password');
    expect(detectRunConversationSecretPattern('verification code 123456')).toBe('otp');
    expect(detectRunConversationSecretPattern('Authorization token: abcdefghijk')).toBe('token');
    expect(detectRunConversationSecretPattern('Please explain the password policy.')).toBeNull();

    for (const text of ['password: hunter2', 'OTP=123456', 'bearer: abcdefghijk']) {
      expect(parseRunConversationMessageRequest({ ...baseEnvelope, text })).toMatchObject({
        ok: false,
        code: 'secret-like-content',
      });
    }
  });
});

describe('the bounded conversation read contract', () => {
  it('keeps the page fixed at fifty rows and exposes only immutable safe metadata', () => {
    const read = {
      status: 'ready',
      runId: RUN,
      messages: [
        {
          schemaVersion: 1,
          messageId: IDEMPOTENCY,
          runId: RUN,
          sequence: 7,
          actorId: 'auditor-1',
          actorName: 'Auditor',
          source: 'auditor',
          kind: 'annotation',
          body: 'Reviewed the source.',
          contentState: 'available',
          sourceOrdinal: null,
          createdAt: '2026-09-19T00:00:00.000Z',
          contextRevision: 'run-revision-7',
          links: [{ evidenceId: WAIT, locator: null }],
        },
      ],
      olderBefore: 7,
      enabled: true,
      readAt: '2026-09-19T00:00:01.000Z',
    } satisfies RunConversationRead;

    expect(RUN_CONVERSATION_PAGE_SIZE).toBe(50);
    expect(read.messages[0]).toMatchObject({ sequence: 7, actorName: 'Auditor', source: 'auditor' });
    expect(read.messages[0]?.links).toEqual([{ evidenceId: WAIT, locator: null }]);
  });

  it('represents authorization, missing runs and content outages without pretending a page exists', () => {
    const statuses: readonly RunConversationRead[] = [
      {
        status: 'denied',
        runId: RUN,
        messages: [],
        olderBefore: null,
        enabled: false,
        readAt: null,
        code: 'not-authorized',
      },
      {
        status: 'missing',
        runId: RUN,
        messages: [],
        olderBefore: null,
        enabled: false,
        readAt: null,
        code: 'run-not-found',
      },
      {
        status: 'unavailable',
        runId: RUN,
        messages: [],
        olderBefore: null,
        enabled: false,
        readAt: null,
        code: 'content-unavailable',
      },
    ];
    expect(statuses.map(({ status }) => status)).toEqual(['denied', 'missing', 'unavailable']);
    expect(statuses.every(({ messages, enabled, olderBefore }) => messages.length === 0 && !enabled && olderBefore === null)).toBe(true);
  });

  it('keeps removed or unavailable governed bodies as tombstones while retaining safe links', () => {
    const tombstones = [
      {
        schemaVersion: 1,
        messageId: IDEMPOTENCY,
        runId: RUN,
        sequence: 8,
        actorId: null,
        actorName: 'Platform',
        source: 'platform',
        kind: 'security-notice',
        body: null,
        contentState: 'removed',
        sourceOrdinal: 4,
        createdAt: '2026-09-19T00:00:00.000Z',
        contextRevision: null,
        links: [{ evidenceId: WAIT, locator: 'absence-result' }],
      },
      {
        schemaVersion: 1,
        messageId: WAIT,
        runId: RUN,
        sequence: 9,
        actorId: null,
        actorName: 'Platform',
        source: 'platform',
        kind: 'security-notice',
        body: null,
        contentState: 'unavailable',
        sourceOrdinal: null,
        createdAt: '2026-09-19T00:00:01.000Z',
        contextRevision: null,
        links: [],
      },
    ] satisfies RunConversationRead['messages'];

    expect(tombstones).toMatchObject([
      { body: null, contentState: 'removed', sourceOrdinal: 4 },
      { body: null, contentState: 'unavailable', sourceOrdinal: null },
    ]);
  });

  it('makes idempotent replay explicit in the append receipt', () => {
    const replay: RunConversationAppendReceipt = {
      ok: true,
      messageId: IDEMPOTENCY,
      sequence: 10,
      replayed: true,
    };
    const denied: RunConversationAppendReceipt = {
      ok: false,
      code: 'denied',
      reason: 'The actor cannot write this Run conversation.',
    };
    expect(replay.replayed).toBe(true);
    expect(denied).toMatchObject({ ok: false, code: 'denied' });
  });
});

describe('finite conversation intent interpretation', () => {
  it('recognizes only the exact unqualified pause shortcut', () => {
    const pause = interpretRunConversationMessage(parseSuccess({ text: ' PAUSE NOW ' }));
    expect(pause).toMatchObject({
      intent: { kind: 'pause-now' },
      disposition: 'safety-shortcut',
      requiresConfirmation: false,
      execution: 'not-executed',
    });

    for (const text of [
      'pause now please',
      'please pause now',
      'do not pause now',
      '"pause now"',
      'if needed, pause now',
      'pause now and flag this',
    ]) {
      const interpretation = interpretRunConversationMessage(parseSuccess({ text }));
      expect(interpretation.intent.kind).not.toBe('pause-now');
      expect(interpretation.disposition).not.toBe('safety-shortcut');
      expect(interpretation.execution).toBe('not-executed');
    }
  });

  it('keeps the Run-wide pause shortcut when historical source context is selected', () => {
    const interpretation = interpretRunConversationMessage(
      parseSuccess({ text: 'pause now', selectedSourceOrdinal: 12 }),
    );
    expect(interpretation).toMatchObject({
      intent: { kind: 'pause-now' },
      disposition: 'safety-shortcut',
      requiresConfirmation: false,
      execution: 'not-executed',
    });
  });

  it('requires an explicit deferred phrase and inspection context before proposing a deferred pause', () => {
    const deferred = interpretRunConversationMessage(
      parseSuccess({ text: 'pause after this employee', selectedSourceOrdinal: 12 }),
    );
    expect(deferred).toMatchObject({
      intent: { kind: 'deferred-pause-proposal', selectedSourceOrdinal: 12 },
      disposition: 'proposal',
      requiresConfirmation: true,
      execution: 'not-executed',
    });

    const missingTarget = interpretRunConversationMessage(parseSuccess({ text: 'pause after this record' }));
    expect(missingTarget).toMatchObject({
      intent: { kind: 'clarification', reason: 'record-target-required' },
      disposition: 'clarification',
      execution: 'not-executed',
    });
  });

  it('proposes a named current inspection while leaving an existing question unanswered', () => {
    for (const text of ['pause after this employee', 'pause after this record', 'pause after this inspection']) {
      const interpretation = interpretRunConversationMessage(parseSuccess({
        text, currentInspection: INSPECTION, replyToWaitId: WAIT,
      }));
      expect(interpretation).toMatchObject({
        intent: { kind: 'deferred-pause-proposal', selectedSourceOrdinal: null },
        disposition: 'proposal', requiresConfirmation: true, execution: 'not-executed',
      });
    }
  });

  it('does not turn quoted, negated or combined deferred instructions into a pause proposal', () => {
    for (const text of ['"pause after this inspection"', 'do not pause after this inspection',
      'pause after this inspection and skip the next record', 'if needed, pause after this record']) {
      const interpretation = interpretRunConversationMessage(parseSuccess({ text, currentInspection: INSPECTION }));
      expect(interpretation.intent.kind).not.toBe('deferred-pause-proposal');
      expect(interpretation.execution).toBe('not-executed');
    }
  });

  it('does not apply a safety shortcut when a wait reply context is attached', () => {
    const interpretation = interpretRunConversationMessage(parseSuccess({ text: 'pause now', replyToWaitId: WAIT }));
    expect(interpretation.intent.kind).toBe('clarification');
    expect(interpretation.disposition).toBe('clarification');
  });

  it('supports every finite P2 intent while keeping commands as proposals', () => {
    const cases: readonly [string, RunConversationMessageRequest, string][] = [
      ['question', parseSuccess({ text: 'What happened?' }), 'question'],
      ['annotation', parseSuccess({ text: 'note: reviewed' }), 'annotation'],
      ['pause-now', parseSuccess({ text: 'pause now' }), 'pause-now'],
      ['resume', parseSuccess({ text: 'resume' }), 'resume'],
      ['stop-confirmation', parseSuccess({ text: 'stop the run' }), 'stop-confirmation'],
      [
        'deferred-pause-proposal',
        parseSuccess({ text: 'pause after this inspection', selectedSourceOrdinal: 2 }),
        'deferred-pause-proposal',
      ],
      [
        'answer-request-proposal',
        parseSuccess({ text: 'answer: choose candidate B', replyToWaitId: WAIT }),
        'answer-request-proposal',
      ],
      ['strategy-proposal', parseSuccess({ text: 'strategy: retry once' }), 'strategy-proposal'],
      ['flag-proposal', parseSuccess({ text: 'flag: source is stale' }), 'flag-proposal'],
      ['amendment', parseSuccess({ text: 'change scope: add target' }), 'amendment'],
      ['refusal', parseSuccess({ text: 'no' }), 'refusal'],
      ['clarification', parseSuccess({ text: 'maybe later' }), 'clarification'],
    ];

    for (const [, input, expectedKind] of cases) {
      const interpretation = interpretRunConversationMessage(input);
      expect(interpretation.intent.kind, expectedKind).toBe(expectedKind);
      expect(interpretation.execution).toBe('not-executed');
    }
  });

  it('keeps an answer proposal tied to the supplied wait and requires confirmation', () => {
    const interpretation = interpretRunConversationMessage(
      parseSuccess({ text: 'answer: candidate B', replyToWaitId: WAIT }),
    );
    expect(interpretation).toMatchObject({
      intent: { kind: 'answer-request-proposal', waitId: WAIT, answer: 'candidate B' },
      disposition: 'proposal',
      requiresConfirmation: true,
      execution: 'not-executed',
    });
  });
});
