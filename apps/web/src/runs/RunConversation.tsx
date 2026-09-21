'use client';

import { UntrustedText } from './UntrustedText';

import {
  RUN_CONVERSATION_MAX_TEXT_CHARS,
  interpretRunConversationMessage,
  runConversationAnswerConsequence,
  type RunConversationAppendReceipt,
  type RunConversationEvidenceLink,
  type RunConversationMessage,
  type RunConversationMessageKind,
  type RunConversationMessageRequest,
  type RunConversationInspectionRead,
  type RunConversationQuestionContext,
  type RunStrategyRead,
  type RunConversationMessageSource,
} from '@intellifin/application';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

import { utcStamp } from './labels';
import { useActionGate } from '../design/action-gate';
import { Button } from '../design/Button';
import './RunWorkspaceShell.css';

export { RUN_CONVERSATION_MAX_TEXT_CHARS } from '@intellifin/application';
export type {
  RunConversationAppendReceipt,
  RunConversationEvidenceLink,
  RunConversationMessage,
  RunConversationMessageKind,
  RunConversationMessageRequest,
  RunConversationMessageSource,
} from '@intellifin/application';

export interface RunConversationRecordLink {
  readonly href: string;
  readonly label: string;
}

export type RunConversationSendInput = RunConversationMessageRequest;
export type RunConversationAcceptedReceipt = Extract<RunConversationAppendReceipt, { readonly ok: true }>;
export type RunConversationRejectedReceipt = Extract<RunConversationAppendReceipt, { readonly ok: false }>;
export type RunConversationSendReceipt = RunConversationAppendReceipt;

export interface RunConversationProps {
  readonly runId: string;
  readonly messages: readonly RunConversationMessage[];
  readonly olderBefore?: number | null;
  readonly onReadOlder?: (beforeSequence: number) => unknown | Promise<unknown>;
  /** Alias for callers whose action is named after the visible control. */
  readonly onLoadOlder?: (beforeSequence: number) => unknown | Promise<unknown>;
  readonly loadingOlder?: boolean;
  readonly readError?: string | null;
  readonly onReviewCommand?: (command: NonNullable<RunConversationMessage['command']>) => void;
  readonly recordLinksFor?: (message: RunConversationMessage) => readonly RunConversationRecordLink[];
  readonly evidenceHrefFor?: (
    message: RunConversationMessage,
    link: RunConversationEvidenceLink,
  ) => string | null;
  readonly selectedSourceOrdinal?: number | null;
  readonly replyToWaitId?: string | null;
  readonly currentInspection?: RunConversationInspectionRead;
  readonly questionContext?: RunConversationQuestionContext | null;
  readonly strategyContext?: RunStrategyRead;
  readonly onSend?: (input: RunConversationSendInput) => unknown | Promise<unknown>;
  /** Alias for action wiring that uses submit terminology. */
  readonly onSubmit?: (input: RunConversationSendInput) => unknown | Promise<unknown>;
  readonly composerDisabled?: boolean;
  readonly composerDisabledReason?: string;
  readonly formAction?: string;
  readonly showComposer?: boolean;
  readonly idempotencyKeyFactory?: () => string;
}

export interface RunConversationComposerProps {
  readonly runId: string;
  readonly selectedSourceOrdinal?: number | null;
  readonly replyToWaitId?: string | null;
  readonly currentInspection?: RunConversationInspectionRead;
  readonly questionContext?: RunConversationQuestionContext | null;
  readonly strategyContext?: RunStrategyRead;
  readonly onSend?: (input: RunConversationSendInput) => unknown | Promise<unknown>;
  readonly onSubmit?: (input: RunConversationSendInput) => unknown | Promise<unknown>;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** Optional same-origin POST endpoint for a progressive native fallback. */
  readonly formAction?: string;
  readonly idempotencyKeyFactory?: () => string;
}

const SOURCE_LABELS: Readonly<Record<RunConversationMessageSource, string>> = {
  auditor: 'Auditor',
  platform: 'IntelliFin',
  agent: 'Agent',
  worker: 'Worker',
  system: 'System',
};

const KIND_LABELS: Readonly<Record<RunConversationMessageKind, string>> = {
  'auditor-message': 'Message',
  'platform-event': 'Platform event',
  'agent-explanation': 'Agent explanation',
  'decision-request': 'Decision request',
  'command-receipt': 'Command receipt',
  finding: 'Finding',
  'evidence-reference': 'Evidence reference',
  'security-notice': 'Security notice',
  annotation: 'Annotation',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function truncateConversationText(value: string): string {
  return Array.from(value).slice(0, RUN_CONVERSATION_MAX_TEXT_CHARS).join('');
}

export function sourceLabel(source: RunConversationMessageSource): string {
  return SOURCE_LABELS[source] ?? 'Conversation source';
}

export function kindLabel(kind: RunConversationMessageKind): string {
  return KIND_LABELS[kind] ?? 'Conversation message';
}

export function messageActorLabel(message: RunConversationMessage): string {
  const actorName = message.actorName.trim();
  return actorName !== '' && !UUID_PATTERN.test(actorName)
    ? actorName
    : sourceLabel(message.source);
}

export function conversationBody(message: RunConversationMessage): string {
  if (message.contentState === 'removed') return 'Message content was removed.';
  if (message.contentState === 'unavailable') return 'Message content is temporarily unavailable.';
  if (message.body === null || message.body === '') return 'No message text recorded.';
  return message.body;
}

/** Evidence links always return to the Run's protected reader or technical route. */
export function defaultEvidenceHref(
  runId: string,
  link: RunConversationEvidenceLink,
): string {
  const base = `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(link.evidenceId)}`;
  return link.locator === null
    ? `/runs/${encodeURIComponent(runId)}/evidence/technical#evidence-${encodeURIComponent(link.evidenceId)}`
    : `${base}?locator=${encodeURIComponent(link.locator)}`;
}

export function durableReceiptAccepted(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const receipt = value as { readonly ok?: unknown; readonly messageId?: unknown; readonly sequence?: unknown };
  return (
    receipt.ok === true &&
    typeof receipt.messageId === 'string' &&
    UUID_PATTERN.test(receipt.messageId) &&
    typeof receipt.sequence === 'number' &&
    Number.isSafeInteger(receipt.sequence) &&
    receipt.sequence > 0
  );
}

export function intakeDeliveryUnknown(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'deliveryStatus' in value && value.deliveryStatus === 'unknown';
}

function receiptFailureReason(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const reason = (value as { readonly reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.trim() !== '') return reason;
  }
  return 'The message was not accepted. Your draft is still here.';
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // This branch is for older embedded browsers. The durable boundary still validates UUID shape.
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${random}${Date.now().toString(16).slice(-4)}`;
}

function actorTechnicalValue(value: string | null): string {
  return value === null || value.trim() === '' ? 'Not recorded' : value;
}

function recordLinks(
  message: RunConversationMessage,
  runId: string,
  resolver: RunConversationProps['recordLinksFor'],
): readonly RunConversationRecordLink[] {
  const resolved = resolver === undefined ? [] : resolver(message).filter(
    (link) => link.href.trim() !== '' && link.label.trim() !== '',
  );
  if (resolved.length > 0 || message.sourceOrdinal === null || !Number.isSafeInteger(message.sourceOrdinal) || message.sourceOrdinal <= 0) {
    return resolved;
  }
  return [{
    href: `/runs/${encodeURIComponent(runId)}/evidence?selected=${encodeURIComponent(String(message.sourceOrdinal))}`,
    label: 'Source record',
  }];
}

function ConversationMessage({
  message,
  runId,
  recordLinksFor,
  evidenceHrefFor,
  onReviewCommand,
}: {
  readonly message: RunConversationMessage;
  readonly runId: string;
  readonly recordLinksFor?: RunConversationProps['recordLinksFor'];
  readonly evidenceHrefFor?: RunConversationProps['evidenceHrefFor'];
  readonly onReviewCommand?: RunConversationProps['onReviewCommand'];
}): React.JSX.Element {
  const gate = useActionGate();
  const links = recordLinks(message, runId, recordLinksFor);
  const evidenceLinks = message.links;
  return (
    <li className="run-conversation__message-item">
      <article className="run-conversation__message" data-message-sequence={message.sequence}>
        <header className="run-conversation__message-header">
          <div className="run-conversation__message-heading">
            <span className="run-conversation__source">{sourceLabel(message.source)}</span>
            <span className="run-conversation__kind">{kindLabel(message.kind)}</span>
          </div>
          <time dateTime={message.createdAt} className="run-conversation__time">
            {utcStamp(message.createdAt)}
          </time>
        </header>
        <p className="run-conversation__actor">{messageActorLabel(message)}</p>
        {message.command?.kind === 'answer' && message.contentState === 'available' ? <>
          <p className="run-conversation__body">{runConversationAnswerConsequence(message.command.answerOptionId ?? '')} No answer is applied until you confirm.</p>
          {message.command.answerQuestion ? <AnswerQuestionSource question={message.command.answerQuestion} optionId={message.command.answerOptionId} label="Recorded question and choice" />
            : <details className="run-conversation__question-source"><summary>Recorded answer proposal — source content</summary><div className="run-conversation__source-scroll" role="region" aria-label="Recorded answer proposal source" tabIndex={0}><UntrustedText field="recorded question and choice">{conversationBody(message)}</UntrustedText></div></details>}
        </> : message.command?.kind === 'strategy' ? <UntrustedText field="recorded strategy context">{conversationBody(message)}</UntrustedText> : <p className="run-conversation__body">{conversationBody(message)}</p>}
        {message.command && <p className="run-conversation__command-status">
          <strong>{message.command.kind === 'strategy' ? 'Full name strategy' : message.command.kind === 'answer' ? 'Answer' : message.command.kind === 'stop' ? 'Stop' : message.command.kind === 'resume' ? 'Resume' : 'Pause'} request: {message.command.state === 'queued' ? (message.command.kind === 'pause-after-inspection' ? 'waiting for the named inspection to settle' : 'awaiting worker boundary') : message.command.state === 'interpreted' && message.command.kind !== 'pause-now' ? (message.command.reason ? 'no longer available for confirmation' : 'awaiting your confirmation') : message.command.state}.</strong>{' '}
          Recorded at <time dateTime={message.command.at}>{utcStamp(message.command.at)}</time>.
        </p>}

        {message.command?.kind === 'strategy' && message.command.state === 'applied' && message.command.strategyActionId && <p>Recorded search action: <a href={`/runs/${runId}/evidence/technical`}>{message.command.strategyActionId}</a>. Review its evidence and the remaining Run checks.</p>}
        {message.command?.reason && <p>{message.command.reason}</p>}
        {message.command && message.command.kind !== 'pause-now' && message.command.state === 'interpreted' &&
          message.command.canConfirm && message.contentState === 'available' && onReviewCommand &&
          <Button variant="secondary" onClick={() => {
            if (gate.disabledReason === null && message.command) onReviewCommand(message.command);
          }} {...(gate.disabledReason === null ? {} : { disabledReason: gate.disabledReason })}>{message.command.kind === 'strategy' ? 'Review Full name search' : message.command.kind === 'answer' ? 'Review answer' : message.command.kind === 'stop' ? 'Review Stop' : message.command.kind === 'resume' ? 'Review Resume' : 'Review pause after inspection'}</Button>}

        {links.length > 0 || evidenceLinks.length > 0 ? (
          <div className="run-conversation__links" role="group" aria-label="Related records and evidence">
            {links.map((link) => (
              <a className="run-conversation__link" href={link.href} key={`${link.href}:${link.label}`}>
                {link.label}
              </a>
            ))}
            {evidenceLinks.map((link) => {
              const href = evidenceHrefFor?.(message, link) ?? defaultEvidenceHref(runId, link);
              if (href === null) return null;
              return (
                <a
                  className="run-conversation__link"
                  href={href}
                  key={`evidence:${link.evidenceId}:${link.locator ?? 'technical'}`}
                  aria-label="Open recorded evidence; opening evidence does not confirm a review."
                >
                  Recorded evidence
                </a>
              );
            })}
          </div>
        ) : null}

        <details className="run-conversation__technical">
          <summary>Technical details</summary>
          <dl>
            <div><dt>Message ID</dt><dd>{message.messageId}</dd></div>
            <div><dt>Sequence</dt><dd>{message.sequence}</dd></div>
            <div><dt>Actor ID</dt><dd>{actorTechnicalValue(message.actorId)}</dd></div>
            <div><dt>Source record ordinal</dt><dd>{message.sourceOrdinal ?? 'Not recorded'}</dd></div>
            <div><dt>Context revision</dt><dd>{message.contextRevision ?? 'Not recorded'}</dd></div>
            <div><dt>Content state</dt><dd>{message.contentState}</dd></div>
            {message.command && <><div><dt>Command ID</dt><dd>{message.command.commandId}</dd></div>
              <div><dt>Domain event</dt><dd>{message.command.sourceEventId ?? 'No domain effect recorded'}</dd></div></>}
          </dl>
        </details>
      </article>
    </li>
  );
}

export function AnswerQuestionSource({ question, optionId, label, expanded = false }: {
  readonly question: RunConversationQuestionContext; readonly optionId?: string; readonly label: string; readonly expanded?: boolean;
}): React.JSX.Element {
  const option = question.options.find(value => value.id === optionId);
  return <details className="run-conversation__question-source" open={expanded}>
    <summary>{label} <span>View source text</span></summary>
    <div className="run-conversation__source-scroll" role="region" aria-label={label} tabIndex={0}>
      <UntrustedText field="question subject and agent question">{`${question.subject}\n${question.question}`}</UntrustedText>
      {option && <UntrustedText field="chosen option label">{`${option.label} (${option.id})`}</UntrustedText>}
    </div>
  </details>;
}

function ConversationComposer({
  runId,
  selectedSourceOrdinal = null,
  replyToWaitId = null,
  currentInspection,
  questionContext,
  strategyContext,
  onSend,
  onSubmit,
  disabled = false,
  disabledReason,
  formAction,
  idempotencyKeyFactory = createIdempotencyKey,
}: RunConversationComposerProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [draftStrategy, setDraftStrategy] = useState<RunStrategyRead | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<RunConversationQuestionContext | null>(null);
  const [draftSource, setDraftSource] = useState<number | null>(null);
  const [draftWaitId, setDraftWaitId] = useState<string | null>(null);
  const [unknownIntake, setUnknownIntake] = useState(false);
  const [draftInspection, setDraftInspection] = useState<RunConversationInspectionRead | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => { setInteractive(true); }, []);
  const pendingRequestRef = useRef<RunConversationSendInput | null>(null);
  // Exact Stop always addresses the Run, even while the workspace displays a wait.
  const effectiveReplyToWaitId = /^(stop|stop now|stop the run)$/i.test(draft.trim()) ? null : draftWaitId;
  const send = onSend ?? onSubmit;
  const gate = useActionGate();
  const blockedControl = gate.disabledReason !== null && interpretRunConversationMessage({
    runId, idempotencyKey: '', text: draft, selectedSourceOrdinal: draftSource, replyToWaitId: effectiveReplyToWaitId,
    questionAnchor: effectiveReplyToWaitId === null ? null : draftQuestion?.anchor ?? null,
  }).intent.kind === 'pause-now';

  const onDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextDraft = truncateConversationText(event.currentTarget.value);
    if (unknownIntake) return;
    if (nextDraft === '') { setDraftStrategy(null); setDraftInspection(null); setDraftQuestion(null); setDraftSource(null); setDraftWaitId(null); }
    else if (draft === '') {
      setDraftStrategy(strategyContext ?? { available: false, reason: 'No strategy was eligible when this draft began.' });
      setDraftInspection(currentInspection ?? { status: 'unavailable', reason: 'No inspection context was available when this draft began.' });
      setDraftQuestion(questionContext ?? null); setDraftSource(selectedSourceOrdinal); setDraftWaitId(questionContext?.anchor.waitId ?? replyToWaitId);
    }
    setDraft(nextDraft);
    const pending = pendingRequestRef.current;
    if (pending !== null && pending.text !== nextDraft) pendingRequestRef.current = null;
    setSubmitError(null);
    setSubmitStatus(null);
  }, [draft, currentInspection, strategyContext, questionContext, selectedSourceOrdinal, replyToWaitId, unknownIntake]);

  const onFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (sending || disabled || blockedControl || send === undefined || draft.trim() === '') return;
      setSending(true);
      setSubmitError(null);
      setSubmitStatus(null);
      const pending = pendingRequestRef.current;
      const input: RunConversationSendInput =
        pending !== null &&
        pending.runId === runId &&
        pending.text === draft
          ? pending
          : {
              runId,
              idempotencyKey: idempotencyKeyFactory(),
              text: draft,
              selectedSourceOrdinal: draftSource,
              replyToWaitId: effectiveReplyToWaitId,
              questionAnchor: effectiveReplyToWaitId === null ? null : draftQuestion?.anchor ?? null,
              currentInspection: draftInspection?.status === 'ready' ? draftInspection.anchor : null,
              ...(draftStrategy?.available ? { strategyAnchor: draftStrategy.anchor } : {}),
            };
      pendingRequestRef.current = input;
      try {
        const receipt = await send(input);
        if (durableReceiptAccepted(receipt)) {
          pendingRequestRef.current = null;
          setDraft(''); setDraftStrategy(null); setDraftQuestion(null); setDraftSource(null); setDraftWaitId(null); setUnknownIntake(false);
          setDraftInspection(null);
          setSubmitStatus('Message accepted.');
        } else {
          setUnknownIntake(intakeDeliveryUnknown(receipt));
          setSubmitError(receiptFailureReason(receipt));
        }
      } catch {
        setUnknownIntake(true);
        setSubmitError('Delivery is unknown. Retry the unchanged message to recover its recorded receipt.');
      } finally {
        setSending(false);
      }
    },
    [blockedControl, disabled, draft, draftStrategy, draftInspection, draftSource, draftQuestion, idempotencyKeyFactory, effectiveReplyToWaitId, runId, selectedSourceOrdinal, send, sending],
  );

  const visibleStrategy = draftStrategy ?? strategyContext;
  const visibleInspection = draftInspection ?? currentInspection;
  const visibleQuestion = draftQuestion ?? (draft === '' ? questionContext : null);
  const remaining = RUN_CONVERSATION_MAX_TEXT_CHARS - unicodeLength(draft);
  const disabledMessage = disabledReason ?? (disabled || send === undefined ? 'Messaging is unavailable for this Run.' : 'Connecting conversation…');
  const unavailable = !interactive || disabled || send === undefined;

  return (
    <form className="run-conversation__composer-form" method="post" action={formAction} onSubmit={onFormSubmit}>
      <label className="run-conversation__composer-label" htmlFor="run-conversation-message">
        Message the Run
      </label>
      {visibleInspection?.status === 'ready' && !visibleQuestion && <details className="run-conversation__question-source">
        <summary>{draftInspection === null ? 'Current inspection' : 'Inspection at draft start'}: {visibleInspection.subjectLabel.length + visibleInspection.targetName.length <= 120 ? `${visibleInspection.subjectLabel} · ${visibleInspection.targetName}.` : 'View source context'}</summary>
        <div className="run-conversation__source-scroll" role="region" aria-label="Inspection source context" tabIndex={0}>
          <UntrustedText field="inspection subject and target">{`${visibleInspection.subjectLabel} · ${visibleInspection.targetName}`}</UntrustedText>
        </div>
      </details>}
      {visibleQuestion && <AnswerQuestionSource
        question={visibleQuestion} label={draft === '' ? 'Current question:' : 'Question at draft start:'} />}
      {draftQuestion && draftQuestion.anchor.questionDigest !== questionContext?.anchor.questionDigest &&
        <p className="run-conversation__composer-help">This question changed. This draft cannot answer the new question.</p>}
      {visibleStrategy && <div className="run-conversation__composer-help">{visibleStrategy.available
        ? <>Frozen strategy available: Full name search. Send <code>strategy: p1.full-name</code> to review it for this inspection. Its prerequisite evidence and inspection are fixed when this draft starts.<UntrustedText field="Strategy inspection">{visibleStrategy.targetLabel}</UntrustedText></>
        : visibleStrategy.reason}</div>}
      {unknownIntake && <p role="status">Delivery is unknown. Retry this exact message before editing it or starting another draft.</p>}
      <textarea
        id="run-conversation-message"
        className="run-conversation__composer-input"
        name="text"
        value={draft}
        onChange={onDraftChange}
        rows={3}
        data-max-unicode-length={RUN_CONVERSATION_MAX_TEXT_CHARS}
        placeholder="Add a note or ask about this Run"
        aria-describedby="run-conversation-message-help"
        disabled={unavailable || sending}
        readOnly={unknownIntake}
      />
      <div className="run-conversation__composer-footer">
        <span id="run-conversation-message-help" className="run-conversation__composer-help">
          {remaining.toLocaleString('en-US')} characters remaining
        </span>
        <button
          type="submit"
          className="run-conversation__send"
          disabled={unavailable || blockedControl || sending || draft.trim() === ''}
        >
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </div>
      {unavailable && <p className="run-conversation__composer-note">{disabledMessage}</p>}
      {blockedControl && <p className="run-conversation__composer-note" role="status">{gate.disabledReason}</p>}
      {submitError !== null ? <p className="run-conversation__composer-error" role="alert">{submitError}</p> : null}
      {submitStatus !== null ? <p className="run-conversation__composer-status" role="status">{submitStatus}</p> : null}
    </form>
  );
}

/** Exported so the shell can pin the composer independently from the conversation scroll. */
export function RunConversationComposer(props: RunConversationComposerProps): React.JSX.Element {
  return <ConversationComposer {...props} />;
}

/**
 * A bounded, inert conversation renderer. New messages follow only while the reader is already
 * at the bottom; loading older history restores the previous visual anchor instead of jumping.
 */
export function RunConversation({
  runId,
  messages,
  olderBefore = null,
  onReadOlder,
  onLoadOlder,
  loadingOlder = false,
  readError = null,
  recordLinksFor,
  evidenceHrefFor,
  onReviewCommand,
  selectedSourceOrdinal = null,
  replyToWaitId = null,
  currentInspection,
  questionContext,
  strategyContext,
  onSend,
  onSubmit,
  composerDisabled = false,
  composerDisabledReason,
  formAction,
  showComposer = true,
  idempotencyKeyFactory,
}: RunConversationProps): React.JSX.Element {
  const threadRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const initialRenderRef = useRef(true);
  const previousMessagesRef = useRef({ count: messages.length, latestSequence: messages.at(-1)?.sequence ?? null });
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);
  const [newActivity, setNewActivity] = useState(false);
  const [loadingOlderInternal, setLoadingOlderInternal] = useState(false);
  const [readActionError, setReadActionError] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => { setInteractive(true); }, []);
  const readOlder = onReadOlder ?? onLoadOlder;
  const isLoadingOlder = loadingOlder || loadingOlderInternal;

  useEffect(() => {
    const thread = threadRef.current;
    if (thread === null) return;
    const previous = previousMessagesRef.current;
    const preserve = preserveScrollRef.current;
    const latestSequence = messages.at(-1)?.sequence ?? null;
    const hasNewerMessage =
      messages.length > previous.count &&
      (previous.latestSequence === null ||
        (latestSequence !== null && latestSequence > previous.latestSequence));

    // A parent may clear the visible page while an older bounded page is being authorized.
    // Keep the anchor and previous-page snapshot through that transient empty render.
    if (preserve !== null && messages.length === 0 && previous.count > 0 && isLoadingOlder) {
      return;
    }
    if (preserve !== null) {
      thread.scrollTop = preserve.top + (thread.scrollHeight - preserve.height);
      preserveScrollRef.current = null;
    } else if (initialRenderRef.current || (followRef.current && hasNewerMessage)) {
      thread.scrollTop = thread.scrollHeight;
      setNewActivity(false);
    } else if (hasNewerMessage) {
      setNewActivity(true);
    }

    previousMessagesRef.current = {
      count: messages.length,
      latestSequence: messages.at(-1)?.sequence ?? null,
    };
    initialRenderRef.current = false;
  }, [isLoadingOlder, messages.length, messages.at(-1)?.sequence]);

  const onThreadScroll = useCallback(() => {
    const thread = threadRef.current;
    if (thread === null) return;
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 48;
    followRef.current = atBottom;
    if (atBottom) setNewActivity(false);
  }, []);

  const showLatest = useCallback(() => {
    const thread = threadRef.current;
    if (thread === null) return;
    followRef.current = true;
    thread.scrollTop = thread.scrollHeight;
    setNewActivity(false);
  }, []);

  const readOlderMessages = useCallback(async () => {
    if (olderBefore === null || olderBefore === undefined || readOlder === undefined || isLoadingOlder) return;
    const thread = threadRef.current;
    if (thread !== null) preserveScrollRef.current = { height: thread.scrollHeight, top: thread.scrollTop };
    setReadActionError(null);
    setLoadingOlderInternal(true);
    try {
      await readOlder(olderBefore);
    } catch {
      preserveScrollRef.current = null;
      setReadActionError('Older conversation messages could not be loaded.');
    } finally {
      setLoadingOlderInternal(false);
    }
  }, [isLoadingOlder, olderBefore, readOlder]);

  const olderControl = olderBefore !== null && olderBefore !== undefined ? (
    <div className="run-conversation__older">
      <button
        type="button"
        className="run-conversation__older-button"
        onClick={readOlderMessages}
        disabled={!interactive || isLoadingOlder || readOlder === undefined}
      >
        {isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}
      </button>
    </div>
  ) : null;

  return (
    <section className="run-conversation" aria-label="Run conversation">
      <div
        ref={threadRef}
        className="run-conversation__thread"
        onScroll={onThreadScroll}
        role="region"
        tabIndex={0}
        aria-label="Conversation history"
      >
        {olderControl}
        {readError !== null || readActionError !== null ? (
          <p className="run-conversation__read-error" role="alert">{readError ?? readActionError}</p>
        ) : null}
        {messages.length === 0 ? (
          <p className="run-conversation__empty">No conversation messages have been recorded.</p>
        ) : (
          <ol className="run-conversation__message-list">
            {messages.map((message) => (
              <ConversationMessage
                key={message.messageId}
                message={message}
                onReviewCommand={onReviewCommand}
                runId={runId}
                recordLinksFor={recordLinksFor}
                evidenceHrefFor={evidenceHrefFor}
              />
            ))}
          </ol>
        )}
        {newActivity ? (
          <div className="run-conversation__activity-wrap">
            <span className="ls-visually-hidden" role="status">New conversation activity is available.</span>
            <button type="button" className="run-conversation__activity" onClick={showLatest}>
              New activity
            </button>
          </div>
        ) : null}
      </div>
      {showComposer ? (
        <div className="run-conversation__composer">
          <ConversationComposer
            runId={runId}
            selectedSourceOrdinal={selectedSourceOrdinal}
            replyToWaitId={replyToWaitId} currentInspection={currentInspection} questionContext={questionContext} strategyContext={strategyContext}
            onSend={onSend}
            onSubmit={onSubmit}
            disabled={composerDisabled}
            disabledReason={composerDisabledReason}
            formAction={formAction}
            idempotencyKeyFactory={idempotencyKeyFactory}
          />
        </div>
      ) : null}
    </section>
  );
}
