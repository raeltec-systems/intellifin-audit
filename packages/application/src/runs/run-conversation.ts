import type { DeferredPauseAnchor } from '@intellifin/domain';
import { parseDeferredPauseAnchor } from './deferred-pause-run.js';

/**
 * The application contract for the bounded Run conversation surface.
 *
 * Conversation text is deliberately split from the metadata that indexes it.  The
 * repository below is a read application port: infrastructure owns encryption, key
 * access, retention and the transaction that writes metadata with an encrypted body.
 * This module does not call a model, a worker, a queue or a Run command.  In particular,
 * an interpreted safety phrase is still only an interpretation until an existing command
 * boundary authorizes and executes it.
 */

export const RUN_CONVERSATION_SCHEMA_VERSION = 1 as const;
export const RUN_CONVERSATION_PAGE_SIZE = 50 as const;
export const RUN_CONVERSATION_MAX_TEXT_CHARS = 4_000 as const;
export const RUN_CONVERSATION_MAX_TEXT_BYTES = 16_000 as const;

/** The finite set of message sources understood by the read projection. */
export const RUN_CONVERSATION_SOURCES = [
  'auditor',
  'platform',
  'agent',
  'worker',
  'system',
] as const;
export type RunConversationMessageSource = (typeof RUN_CONVERSATION_SOURCES)[number];

/**
 * Message kinds are presentation metadata, not executable instructions.  An auditor
 * annotation is separate from an agent explanation so a reader can distinguish a human
 * note from generated or platform supplied context without inspecting its body.
 */
export const RUN_CONVERSATION_MESSAGE_KINDS = [
  'auditor-message',
  'platform-event',
  'agent-explanation',
  'decision-request',
  'command-receipt',
  'finding',
  'evidence-reference',
  'security-notice',
  'annotation',
] as const;
export type RunConversationMessageKind = (typeof RUN_CONVERSATION_MESSAGE_KINDS)[number];

export const RUN_CONVERSATION_CONTENT_STATES = ['available', 'removed', 'unavailable'] as const;
export type RunConversationContentState = (typeof RUN_CONVERSATION_CONTENT_STATES)[number];

/** A link carries an identifier only; it does not disclose Evidence bytes or object keys. */
export interface RunConversationEvidenceLink {
  readonly evidenceId: string;
  readonly locator: string | null;
}

/**
 * The immutable, bounded row exposed to a reader.  `links` is a safe reference list;
 * an Evidence read still has to pass through the existing Evidence read grant boundary.
 */
export interface RunConversationMessage {
  readonly schemaVersion: typeof RUN_CONVERSATION_SCHEMA_VERSION;
  readonly messageId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly source: RunConversationMessageSource;
  readonly kind: RunConversationMessageKind;
  /** `null` is used for a governed tombstone or a temporary content outage. */
  readonly body: string | null;
  readonly contentState: RunConversationContentState;
  /** The source record selected by the message author, when there is one. */
  readonly sourceOrdinal: number | null;
  readonly createdAt: string;
  readonly contextRevision: string | null;
  readonly links: readonly RunConversationEvidenceLink[];
  /** Current persisted receipt, separate from the immutable message text. */
  readonly command?: {
    readonly commandId: string;
    readonly kind: 'pause-now' | 'pause-after-inspection' | 'resume' | 'stop';
    readonly targetLabel?: string;
    readonly resumeAnchor?: RunConversationResumeAnchor;
    readonly canConfirm?: boolean;
    readonly reason?: string;
    readonly state: 'received' | 'interpreted' | 'queued' | 'applied' | 'refused' | 'superseded';
    readonly at: string;
    readonly sourceEventId: string | null;
  };
}

export const RUN_CONVERSATION_READ_STATUSES = [
  'ready',
  'denied',
  'missing',
  'unavailable',
] as const;
export type RunConversationReadStatus = (typeof RUN_CONVERSATION_READ_STATUSES)[number];

export const RUN_CONVERSATION_READ_ERROR_CODES = [
  'not-authorized',
  'run-not-found',
  'content-unavailable',
] as const;
export type RunConversationReadErrorCode = (typeof RUN_CONVERSATION_READ_ERROR_CODES)[number];

/** The fixed page shape keeps older pages bounded by a sequence cursor. */
export interface RunConversationReadRequest {
  readonly runId: string;
  readonly actorId: string;
  /** Return rows with a sequence strictly lower than this value. */
  readonly beforeSequence?: number | null;
}

export interface RunConversationReadReady {
  readonly status: 'ready';
  readonly runId: string;
  readonly messages: readonly RunConversationMessage[];
  /** The next cursor, or `null` when this page contains the oldest row. */
  readonly olderBefore: number | null;
  readonly enabled: true;
  readonly readAt: string;
}

export interface RunConversationReadError {
  readonly status: 'denied' | 'missing' | 'unavailable';
  readonly runId: string;
  readonly messages: readonly [];
  readonly olderBefore: null;
  readonly enabled: false;
  readonly readAt: string | null;
  readonly code: RunConversationReadErrorCode;
}

export type RunConversationRead = RunConversationReadReady | RunConversationReadError;

/** Infrastructure supplies the read projection and applies actor/run authorization. */
export interface RunConversationRepository {
  read(input: RunConversationReadRequest): Promise<RunConversationRead>;
}

/** The untrusted message envelope accepted from a browser or other caller. */
export interface RunConversationMessageRequest {
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly text: string;
  readonly selectedSourceOrdinal: number | null;
  readonly replyToWaitId: string | null;
  /** Server-read execution context captured when composition begins; never a selected-row guess. */
  readonly currentInspection?: DeferredPauseAnchor | null;
}

export type RunConversationInspectionRead =
  | { readonly status: 'ready'; readonly anchor: DeferredPauseAnchor; readonly subjectLabel: string;
      readonly targetName: string; readonly sourceOrdinal: number | null; readonly multipleTargets: boolean }
  | { readonly status: 'unavailable'; readonly reason: string };

/** Immutable pause and control context displayed before a conversational Resume. */
export interface RunConversationResumeAnchor {
  readonly waitId: string;
  readonly pausedAt: string;
  readonly deadline: string;
  readonly controlEpoch: number;
}

export function parseRunConversationResumeAnchor(value: unknown): RunConversationResumeAnchor | null {
  if (!plainObject(value) || Object.keys(value).length !== 4 ||
    typeof value.waitId !== 'string' || !UUID.test(value.waitId) || value.waitId !== value.waitId.toLowerCase() ||
    typeof value.pausedAt !== 'string' || typeof value.deadline !== 'string' ||
    !Number.isFinite(Date.parse(value.pausedAt)) || !Number.isFinite(Date.parse(value.deadline)) ||
    new Date(value.pausedAt).toISOString() !== value.pausedAt || new Date(value.deadline).toISOString() !== value.deadline ||
    Date.parse(value.deadline) <= Date.parse(value.pausedAt) ||
    !Number.isInteger(value.controlEpoch) || typeof value.controlEpoch !== 'number' ||
    value.controlEpoch < 1 || value.controlEpoch > 2147483647) return null;
  return { waitId: value.waitId, pausedAt: value.pausedAt, deadline: value.deadline, controlEpoch: value.controlEpoch };
}

export const RUN_CONVERSATION_MESSAGE_REFUSAL_CODES = [
  'malformed',
  'unknown-fields',
  'invalid-run-id',
  'invalid-idempotency-key',
  'text-empty',
  'text-too-long',
  'text-too-large',
  'invalid-unicode',
  'secret-like-content',
  'selected-source-ordinal-invalid',
  'reply-to-wait-invalid',
] as const;
export type RunConversationMessageRefusalCode =
  (typeof RUN_CONVERSATION_MESSAGE_REFUSAL_CODES)[number];

export interface RunConversationMessageParseFailure {
  readonly ok: false;
  readonly code: RunConversationMessageRefusalCode;
  readonly reason: string;
}

export interface RunConversationMessageParseSuccess {
  readonly ok: true;
  readonly value: RunConversationMessageRequest;
}

export type RunConversationMessageParseResult =
  | RunConversationMessageParseSuccess
  | RunConversationMessageParseFailure;

export const RUN_CONVERSATION_APPEND_ERROR_CODES = [
  'malformed',
  'denied',
  'run-not-found',
  'conflict',
  'unavailable',
] as const;
export type RunConversationAppendErrorCode = (typeof RUN_CONVERSATION_APPEND_ERROR_CODES)[number];

/**
 * The idempotent write receipt.  Infrastructure may replay a prior receipt for the same
 * actor/run/idempotency key, but the application never treats that replay as execution.
 */
export type RunConversationAppendReceipt =
  | {
      readonly ok: true;
      readonly messageId: string;
      readonly sequence: number;
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly code: RunConversationAppendErrorCode;
    };

export type RunConversationCommandReceipt =
  | { readonly ok: true; readonly commandId: string; readonly state: 'queued' | 'applied' | 'superseded'; readonly replayed: boolean }
  | { readonly ok: false; readonly code: RunConversationAppendErrorCode; readonly reason: string };

/** Secret-like classes rejected before a caller can ask the content repository to store. */
export const RUN_CONVERSATION_SECRET_PATTERNS = ['password', 'otp', 'token'] as const;
export type RunConversationSecretPattern = (typeof RUN_CONVERSATION_SECRET_PATTERNS)[number];

/**
 * Detects a small set of obvious credential-shaped strings.  This is a pre-persistence
 * refusal, not a containment proof: it is intentionally conservative and incomplete.
 * The detector returns only a class, never the matched value, and does not hash it.
 */
export function detectRunConversationSecretPattern(text: string): RunConversationSecretPattern | null {
  if (/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i.test(text)) return 'password';

  // OTPs are commonly pasted as `OTP 123456` or `verification code: 123456`.
  if (
    /\b(?:otp|one[- ]time\s+(?:password|passcode|code)|verification\s+code)\s*[:=]?\s*\d{4,8}\b/i.test(
      text,
    )
  ) return 'otp';

  // Require a label/value separator for generic tokens to avoid rejecting ordinary prose
  // such as "request a token".  Known provider prefixes are obvious token-shaped values.
  if (
    /\b(?:bearer|token|api[- ]?key|access[- ]?token)\s*[:=]\s*\S+/i.test(text) ||
    /\b(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}\b/.test(text) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(text)
  ) return 'token';

  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

/** UTF-8 size without relying on Node's Buffer at the application boundary. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function failure(code: RunConversationMessageRefusalCode, reason: string): RunConversationMessageParseFailure {
  return { ok: false, code, reason };
}

/**
 * Parse the hostile message envelope before identity, persistence or interpretation.
 * Required keys and optional keys are exact; unknown keys are never silently ignored.
 */
export function parseRunConversationMessageRequest(value: unknown): RunConversationMessageParseResult {
  if (!plainObject(value)) return failure('malformed', 'The conversation message must be an object.');

  const expectedKeys = ['runId', 'idempotencyKey', 'text', 'selectedSourceOrdinal', 'replyToWaitId', 'currentInspection'] as const;
  const requiredKeys = ['runId', 'idempotencyKey', 'text'] as const;
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.includes(key as (typeof expectedKeys)[number]))) {
    return failure('unknown-fields', 'The conversation message contains an unknown field.');
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    return failure('malformed', 'The conversation message is missing a required field.');
  }

  if (typeof value.runId !== 'string' || !UUID.test(value.runId)) {
    return failure('invalid-run-id', 'The run identifier is not a UUID.');
  }
  if (typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey)) {
    return failure('invalid-idempotency-key', 'The idempotency key is not a UUID.');
  }
  if (typeof value.text !== 'string' || value.text.trim().length === 0) {
    return failure('text-empty', 'The conversation message must contain text.');
  }
  if (hasLoneSurrogate(value.text)) {
    return failure('invalid-unicode', 'The conversation message contains invalid Unicode.');
  }
  if (unicodeCharacterCount(value.text) > RUN_CONVERSATION_MAX_TEXT_CHARS) {
    return failure('text-too-long', 'The conversation message exceeds the character limit.');
  }
  if (utf8ByteLength(value.text) > RUN_CONVERSATION_MAX_TEXT_BYTES) {
    return failure('text-too-large', 'The conversation message exceeds the UTF-8 byte limit.');
  }

  const secretPattern = detectRunConversationSecretPattern(value.text);
  if (secretPattern !== null) {
    return failure('secret-like-content', `The message resembles an unshareable ${secretPattern}.`);
  }

  let selectedSourceOrdinal: number | null = null;
  if (Object.hasOwn(value, 'selectedSourceOrdinal') && value.selectedSourceOrdinal !== null) {
    if (
      typeof value.selectedSourceOrdinal !== 'number' ||
      !Number.isSafeInteger(value.selectedSourceOrdinal) ||
      value.selectedSourceOrdinal <= 0
    ) {
      return failure(
        'selected-source-ordinal-invalid',
        'The selected source ordinal must be a positive safe integer.',
      );
    }
    selectedSourceOrdinal = value.selectedSourceOrdinal;
  }

  let replyToWaitId: string | null = null;
  if (Object.hasOwn(value, 'replyToWaitId') && value.replyToWaitId !== null) {
    if (typeof value.replyToWaitId !== 'string' || !UUID.test(value.replyToWaitId)) {
      return failure('reply-to-wait-invalid', 'The reply wait identifier is not a UUID.');
    }
    replyToWaitId = value.replyToWaitId.toLowerCase();
  }

  const currentInspection = value.currentInspection === undefined || value.currentInspection === null
    ? null : parseDeferredPauseAnchor(value.currentInspection);
  if (value.currentInspection !== undefined && value.currentInspection !== null && currentInspection === null)
    return failure('malformed', 'The current inspection context is invalid.');

  return {
    ok: true,
    value: {
      runId: value.runId.toLowerCase(),
      idempotencyKey: value.idempotencyKey.toLowerCase(),
      text: value.text,
      selectedSourceOrdinal,
      replyToWaitId,
      ...(Object.hasOwn(value, 'currentInspection') ? { currentInspection } : {}),
    },
  };
}

/** Alias kept short for callers at a request boundary. */
export const parseRunConversationRequest = parseRunConversationMessageRequest;
export const parseRunConversationMessage = parseRunConversationMessageRequest;

export const RUN_CONVERSATION_INTENT_KINDS = [
  'question',
  'annotation',
  'pause-now',
  'resume',
  'stop-confirmation',
  'deferred-pause-proposal',
  'answer-request-proposal',
  'strategy-proposal',
  'flag-proposal',
  'amendment',
  'refusal',
  'clarification',
] as const;
export type RunConversationIntentKind = (typeof RUN_CONVERSATION_INTENT_KINDS)[number];

export const RUN_CONVERSATION_INTERPRETATION_DISPOSITIONS = [
  'read-only',
  'annotation',
  'safety-shortcut',
  'proposal',
  'refused',
  'clarification',
] as const;
export type RunConversationInterpretationDisposition =
  (typeof RUN_CONVERSATION_INTERPRETATION_DISPOSITIONS)[number];

export type RunConversationIntent =
  | {
      readonly kind: 'question';
      readonly selectedSourceOrdinal: number | null;
    }
  | {
      readonly kind: 'annotation';
      readonly text: string;
    }
  | { readonly kind: 'pause-now' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'stop-confirmation' }
  | {
      readonly kind: 'deferred-pause-proposal';
      readonly selectedSourceOrdinal: number | null;
    }
  | {
      readonly kind: 'answer-request-proposal';
      readonly waitId: string;
      readonly answer: string;
    }
  | {
      readonly kind: 'strategy-proposal';
      readonly strategy: string;
    }
  | {
      readonly kind: 'flag-proposal';
      readonly note: string | null;
    }
  | {
      readonly kind: 'amendment';
      readonly reason: 'scope-change' | 'policy-change' | 'target-write';
    }
  | {
      readonly kind: 'refusal';
      readonly reason: 'user-declined' | 'unsupported-command' | 'unsafe-content';
    }
  | {
      readonly kind: 'clarification';
      readonly reason:
        | 'ambiguous'
        | 'unsupported-command'
        | 'missing-wait-context'
        | 'record-target-required';
    };

/**
 * No branch of this result is executable.  `proposal` and `safety-shortcut` describe
 * what a later, authorized command might consider; they do not call or enqueue it.
 */
export interface RunConversationInterpretation {
  readonly schemaVersion: typeof RUN_CONVERSATION_SCHEMA_VERSION;
  readonly intent: RunConversationIntent;
  readonly disposition: RunConversationInterpretationDisposition;
  readonly requiresConfirmation: boolean;
  readonly execution: 'not-executed';
}

function interpretation(
  intent: RunConversationIntent,
  disposition: RunConversationInterpretationDisposition,
  requiresConfirmation: boolean,
): RunConversationInterpretation {
  return {
    schemaVersion: RUN_CONVERSATION_SCHEMA_VERSION,
    intent,
    disposition,
    requiresConfirmation,
    execution: 'not-executed',
  };
}

function normalizedIntentText(text: string): string {
  return text.trim().toLowerCase();
}

function questionLike(text: string): boolean {
  return (
    text.endsWith('?') ||
    /^(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/i.test(text)
  );
}

/**
 * Classify one already parsed message into the finite P2 vocabulary.  Matching for
 * safety controls is whole-message matching: a word appearing inside a negation,
 * quotation, condition or longer sentence can never become an automatic action.
 */
export function interpretRunConversationMessage(
  input: RunConversationMessageRequest,
): RunConversationInterpretation {
  const text = input.text.trim();
  const normalized = normalizedIntentText(input.text);

  // A selected historical record is context for the conversation, not a target that
  // silently changes the meaning of the Run-wide safety shortcut (AW-104).
  if (normalized === 'pause now' && input.replyToWaitId === null) {
    return interpretation({ kind: 'pause-now' }, 'safety-shortcut', false);
  }

  // The exact phrase creates only a proposal. An execution anchor is required at the
  // authoritative admission boundary; a historical selected row cannot supply it.
  if (
    /^pause after this (?:employee|record|inspection)$/.test(normalized) &&
    (input.currentInspection != null || input.selectedSourceOrdinal !== null)
  ) {
    return interpretation(
      { kind: 'deferred-pause-proposal', selectedSourceOrdinal: input.selectedSourceOrdinal },
      'proposal',
      true,
    );
  }

  if (/^pause after this (?:employee|record|inspection)$/.test(normalized)) {
    return interpretation({ kind: 'clarification', reason: 'record-target-required' }, 'clarification', false);
  }

  if (normalized === 'resume' && input.selectedSourceOrdinal === null && input.replyToWaitId === null) {
    return interpretation({ kind: 'resume' }, 'proposal', true);
  }
  if (
    (normalized === 'stop' || normalized === 'stop now' || normalized === 'stop the run')
  ) {
    return interpretation({ kind: 'stop-confirmation' }, 'proposal', true);
  }

  const annotation = /^(?:note|annotate):\s*(.+)$/is.exec(text);
  if (annotation?.[1]?.trim()) {
    return interpretation({ kind: 'annotation', text: annotation[1].trim() }, 'annotation', false);
  }

  const strategy = /^strategy:\s*(.+)$/is.exec(text);
  if (strategy?.[1]?.trim()) {
    return interpretation({ kind: 'strategy-proposal', strategy: strategy[1].trim() }, 'proposal', true);
  }

  const answer = /^answer:\s*(.+)$/is.exec(text);
  if (answer?.[1]?.trim()) {
    if (input.replyToWaitId === null) {
      return interpretation(
        { kind: 'clarification', reason: 'missing-wait-context' },
        'clarification',
        false,
      );
    }
    return interpretation(
      {
        kind: 'answer-request-proposal',
        waitId: input.replyToWaitId,
        answer: answer[1].trim(),
      },
      'proposal',
      true,
    );
  }

  const flag = /^flag(?:\s*:\s*(.+))?$/is.exec(text);
  if (flag) {
    return interpretation(
      { kind: 'flag-proposal', note: flag[1]?.trim() || null },
      'proposal',
      true,
    );
  }

  if (/^(?:amend|change\s+scope|change\s+policy):/i.test(text)) {
    const reason: RunConversationIntent & { readonly kind: 'amendment' } = {
      kind: 'amendment',
      reason: /^change\s+policy:/i.test(text) ? 'policy-change' : 'scope-change',
    };
    return interpretation(reason, 'refused', false);
  }

  if (normalized === 'no' || normalized === 'refuse' || normalized === 'decline' || normalized === 'cancel') {
    return interpretation({ kind: 'refusal', reason: 'user-declined' }, 'refused', false);
  }

  if (questionLike(text)) {
    return interpretation(
      { kind: 'question', selectedSourceOrdinal: input.selectedSourceOrdinal },
      'read-only',
      false,
    );
  }

  // In particular, "do not pause now", "if needed pause now", and "'pause now'"
  // arrive here.  They may be clarified by a human, but can never select the shortcut.
  return interpretation({ kind: 'clarification', reason: 'ambiguous' }, 'clarification', false);
}
