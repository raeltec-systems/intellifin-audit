'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FIXED_ESCALATION_OPTIONS, type EscalationDetails, type EscalationKind, type EscalationOption, type RunWait } from '@intellifin/application';

import {
  answerEscalationAction,
  type AnswerEscalationActionResult,
} from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { ESCALATION_PANEL_COPY } from '../design/copy';
import { UntrustedText } from './UntrustedText';

const KIND_LABELS: Readonly<Record<EscalationKind, string>> = {
  'choose-candidate': 'Choose candidate',
  'unnamed-value': 'Unnamed value',
  'retry-or-skip': 'Retry or skip',
};

/** Keep the closed answer set's FR-27 order even if a legacy row was stored out of order. */
export function orderedEscalationOptions(wait: RunWait): readonly EscalationOption[] {
  if (wait.kind === 'choose-candidate') {
    const ambiguous = wait.options.find((option) => option.id === 'mark-ambiguous');
    return [
      ...wait.options.filter((option) => option.id !== 'mark-ambiguous'),
      ...(ambiguous === undefined ? [] : [ambiguous]),
    ];
  }
  const byId = new Map(wait.options.map((option) => [option.id, option]));
  return FIXED_ESCALATION_OPTIONS[wait.kind].flatMap((fixed) => {
    // Fixed answer labels come from the application vocabulary. A persisted row's label
    // is never allowed to replace the closed FR-27 copy.
    return byId.has(fixed.id) ? [fixed] : [];
  });
}

/** A fixed platform question used when the durable wait has no model question field. */
export function platformQuestion(kind: EscalationKind): string {
  return ESCALATION_PANEL_COPY.questions[kind];
}

/** Format a remaining duration without claiming that a completed wake has run. */
export function countdownText(remainingMilliseconds: number): string {
  if (!Number.isFinite(remainingMilliseconds)) return 'Unknown';
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function remainingMilliseconds(deadline: string, at: string): number {
  const end = Date.parse(deadline);
  const start = Date.parse(at);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return Number.NaN;
  return end - start;
}

export interface EscalationPanelProps {
  readonly runId: string;
  readonly wait: RunWait;
  /** Metadata read under the same Run transaction as the wait and revision. */
  readonly details: EscalationDetails | null;
  /** The revision read in the same transaction as `wait`; never supplied by the client. */
  readonly runRevision: number;
  /** The snapshot instant used to make the first server/client countdown match. */
  readonly readAt: string;
}

type PanelMessage = {
  readonly tone: 'success' | 'danger';
  readonly title: string;
  readonly body?: string;
};

/**
 * The one-open-Escalation surface shared by every Run Detail tab.
 *
 * Metadata comes from the addressed wait's immutable raise event and matching agent work;
 * missing fields remain visibly unavailable. Candidate labels and model rationale are
 * untrusted source text. Fixed answer labels come from the closed application vocabulary.
 * The only mutation is the server action, behind the routine confirmation dialog.
 */
export function EscalationPanel({ runId, wait, details, runRevision, readAt }: EscalationPanelProps): React.JSX.Element {
  const router = useRouter();
  const headingId = useId();
  const questionId = useId();
  const evidenceId = useId();
  const noteId = useId();
  const countdownId = useId();
  const [remaining, setRemaining] = useState(() => remainingMilliseconds(wait.deadline, readAt));
  const [note, setNote] = useState('');
  const [pendingOption, setPendingOption] = useState<EscalationOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);

  useEffect(() => {
    const update = (): void => setRemaining(remainingMilliseconds(wait.deadline, new Date().toISOString()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [wait.deadline]);

  async function confirmAnswer(): Promise<void> {
    if (pendingOption === null || busy || unknown) return;
    const option = pendingOption;
    setBusy(true);
    setMessage(null);
    try {
      const result: AnswerEscalationActionResult = await answerEscalationAction({
        runId,
        waitId: wait.waitId,
        expectedRunRevision: runRevision,
        answerOptionId: option.id,
        note: note.trim() === '' ? null : note.trim(),
      });
      if (!result || typeof result !== 'object' || result.ok !== true) {
        const refusal = result && typeof result === 'object' && 'reason' in result && typeof result.reason === 'string'
          ? result.reason
          : ESCALATION_PANEL_COPY.unknown;
        setMessage({ tone: 'danger', title: refusal });
        if (result && typeof result === 'object' && 'unknownOutcome' in result && result.unknownOutcome === true) {
          setUnknown(true);
        }
        return;
      }
      setMessage({
        tone: 'success',
        title: option.id === 'abort' ? 'Run canceled.' : 'Escalation answered.',
        body: option.id === 'abort'
          ? 'The Run is canceled with the Escalation answer recorded in its Timeline.'
          : 'The Run resumes with the Escalation answer recorded in its Timeline.',
      });
      router.refresh();
    } catch {
      setUnknown(true);
      setMessage({
        tone: 'danger',
        title: ESCALATION_PANEL_COPY.unknown,
      });
    } finally {
      setBusy(false);
      setPendingOption(null);
    }
  }

  const question = platformQuestion(wait.kind);
  const kindLabel = KIND_LABELS[wait.kind];
  const countdown = countdownText(remaining);
  const countdownExpired = Number.isFinite(remaining) && remaining <= 0;
  const options = orderedEscalationOptions(wait);
  const candidateOptions = wait.kind === 'choose-candidate'
    ? options.filter((option) => option.id !== 'mark-ambiguous')
    : [];

  return (
    <>
      <a className="ls-skip-link" href="#open-escalation">Skip to open Escalation</a>
      <section id="open-escalation" className="ls-card ls-stack" aria-labelledby={headingId}>
        <h2 id={headingId}>Open Escalation</h2>
        {message !== null ? <Banner tone={message.tone} title={message.title}>{message.body ? <p>{message.body}</p> : null}</Banner> : null}
        {unknown ? <p><a href={`/runs/${runId}`}>Reload this Run</a></p> : null}

        <dl className="ls-definition">
          <dt>Kind</dt>
          <dd>{kindLabel}</dd>
          <dt>Step</dt>
          <dd>{details?.stepId === null || details?.stepId === undefined
            ? ESCALATION_PANEL_COPY.noStep
            : <span className="ls-mono">{details.stepId}</span>}</dd>
          <dt>Deadline</dt>
          <dd><time dateTime={wait.deadline}>{wait.deadline}</time></dd>
        </dl>

        <section aria-labelledby={questionId} className="ls-stack">
          <h3 id={questionId}>Question</h3>
          {details?.agentQuestion === null || details?.agentQuestion === undefined ? (
            <p>{ESCALATION_PANEL_COPY.noAgentQuestion}</p>
          ) : (
            <UntrustedText field="AGENT-GENERATED question">{details.agentQuestion}</UntrustedText>
          )}
          <p><strong>Platform question</strong></p>
          <p>{question}</p>
        </section>

        <section aria-labelledby={evidenceId} className="ls-stack">
          <h3 id={evidenceId}>Supporting Evidence</h3>
          {details?.supportingEvidenceIds === null || details?.supportingEvidenceIds === undefined || details.supportingEvidenceIds.length === 0 ? (
            <p>{ESCALATION_PANEL_COPY.noSupportingEvidence}</p>
          ) : (
            <ul>
              {details.supportingEvidenceIds.map((supportingEvidenceId) => (
                <li key={supportingEvidenceId}>
                  <a className="ls-mono" href={`/runs/${runId}/evidence#evidence-${encodeURIComponent(supportingEvidenceId)}`}>
                    {supportingEvidenceId}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ls-stack" aria-labelledby={countdownId}>
          <h3 id={countdownId}>Time remaining</h3>
          <p role="timer" aria-live="polite" aria-atomic="true">
            <time dateTime={wait.deadline}>{countdown}</time>
            {countdownExpired ? ' — deadline reached; reload this Run for the recorded outcome.' : null}
          </p>
        </section>

        <fieldset className="ls-stack" disabled={unknown}>
          <legend>Answer</legend>
          <p>Choose one answer. The platform expresses no recommendation.</p>
          <div className="ls-stack">
            {options.map((option, index) => (
              <div key={`${option.id}-${index}`} className="ls-stack">
                {wait.kind === 'choose-candidate' && option.id !== 'mark-ambiguous' ? (
                  <UntrustedText field={`AGENT-GENERATED candidate ${candidateOptions.indexOf(option) + 1}`}>
                    {option.label}
                  </UntrustedText>
                ) : null}
                <Button
                  variant="secondary"
                  busy={busy}
                  onClick={() => setPendingOption(option)}
                >
                  {wait.kind === 'choose-candidate'
                    ? option.id === 'mark-ambiguous'
                      ? 'Mark record ambiguous'
                      : `Select candidate ${candidateOptions.indexOf(option) + 1}`
                    : option.label}
                </Button>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="ls-stack">
          <label htmlFor={noteId}>{ESCALATION_PANEL_COPY.answerNoteLabel}</label>
          <textarea
            className="ls-textarea"
            id={noteId}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy || unknown}
          />
        </div>
      </section>

      <ConfirmDialog
        open={pendingOption !== null}
        weight="routine"
        title={pendingOption?.id === 'abort' ? 'Abort this Run?' : 'Record this Escalation answer?'}
        consequence={pendingOption?.id === 'abort'
          ? 'This closes the Escalation and cancels the Run with the reason Escalation answer: abort. Evidence already collected is preserved.'
          : 'This closes the Escalation with the selected answer and resumes the Run. The answer is recorded in the Timeline.'}
        confirmLabel={busy ? 'Saving…' : pendingOption?.id === 'abort' ? 'Abort Run' : 'Record answer'}
        cancelLabel="Go back"
        busy={busy}
        onCancel={() => { if (!busy) setPendingOption(null); }}
        onConfirm={() => { void confirmAnswer(); }}
      />
    </>
  );
}
