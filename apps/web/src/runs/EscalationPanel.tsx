'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FIXED_ESCALATION_OPTIONS, type EscalationDetails, type EscalationKind, type EscalationOption, type EscalationWait } from '@intellifin/application';

import {
  answerEscalationAction,
  type AnswerEscalationActionResult,
} from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { useActionGate } from '../design/action-gate';
import { ESCALATION_PANEL_COPY, UNTRUSTED_CONTENT_SENTENCE } from '../design/copy';
import { ESCALATION_KIND_WORDS } from '../design/plain-words';
import { useEscalationOutcome } from './EscalationOutcome';
import { UntrustedPolicy, UntrustedText } from './UntrustedText';
import { Timestamp } from '../design/Timestamp';
// The clock's arithmetic, shared with the Paused banner so the two surfaces cannot
// disagree about how long a reader has left. The markup stays here because this panel
// also needs the raw number, for `escalationMilestone`.
import { countdownText, remainingMilliseconds } from './WaitCountdown';


/** Keep the closed answer set's FR-27 order even if a legacy row was stored out of order. */
/**
 * An `EscalationWait`, not a `RunWait`: a pause is a wait and is NOT an Escalation, so it
 * cannot reach this surface at all — the compiler refuses it rather than a runtime branch
 * having to remember. Story 5.4's Paused banner is the surface a pause does reach.
 */
export function orderedEscalationOptions(wait: EscalationWait): readonly EscalationOption[] {
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


/**
 * The rungs a screen reader hears, and the only ones (Story 5.6, UX-DR27, UX-DR37).
 *
 * EXPERIENCE.md announces "new Escalations, and countdown milestones (10 minutes, 1
 * minute)". A clock inside a live region announces itself every second, which is the
 * opposite of a milestone — so this is what the polite region reads and the visible
 * countdown is a `role="timer"` with no live region at all.
 *
 * It is a LADDER and never goes back up: `open` → `ten-minutes` → `one-minute` →
 * `expired`. Each rung is therefore announced exactly once, and an expired wait does not
 * fall back to "an Escalation is open" and say it again. An unreadable deadline is `open`,
 * which is what is actually known: the visible countdown says `Unknown` beside it.
 */
export type EscalationMilestone = 'open' | 'ten-minutes' | 'one-minute' | 'expired';

export function escalationMilestone(remaining: number): EscalationMilestone {
  if (!Number.isFinite(remaining)) return 'open';
  if (remaining <= 0) return 'expired';
  if (remaining <= 60_000) return 'one-minute';
  if (remaining <= 600_000) return 'ten-minutes';
  return 'open';
}

export interface EscalationWorkspacePresentation {
  readonly stepLabel: string | null;
}

export interface EscalationPanelProps {
  readonly runId: string;
  readonly wait: EscalationWait;
  /** Metadata read under the same Run transaction as the wait and revision. */
  readonly details: EscalationDetails | null;
  /** The revision read in the same transaction as `wait`; never supplied by the client. */
  readonly runRevision: number;
  /** The snapshot instant used to make the first server/client countdown match. */
  readonly readAt: string;
  /**
   * Workspace-only presentation facts. The ordinary Run Detail surface intentionally
   * omits this prop and keeps its existing technical metadata presentation.
   *
   * The label is resolved from the frozen plan by the server. Evidence identifiers still
   * come from the addressed wait's immutable metadata and are shown only inside the
   * collapsed technical section in the compact workspace variant.
   */
  readonly workspacePresentation?: EscalationWorkspacePresentation;
}

/** Keep the workspace decision card bounded even if a legacy wait names many captures. */
const WORKSPACE_SUPPORTING_EVIDENCE_LIMIT = 8;

type PanelMessage = {
  readonly tone: 'success' | 'danger';
  readonly title: string;
  readonly body?: string;
};

/**
 * The workspace card has one shared policy sentence so a compact decision does not repeat
 * the same warning in every source block. Each block still names its untrusted field and
 * keeps the source value in an inert, escaped preformatted element.
 */
function WorkspaceUntrustedText({ field, children }: {
  readonly field: string;
  readonly children: string;
}): React.JSX.Element {
  const compactField = field.startsWith('AGENT-GENERATED candidate ')
    ? `Candidate ${field.slice('AGENT-GENERATED candidate '.length)}`
    : field === 'AGENT-GENERATED question' ? 'Question' : field;
  return (
    <div className="ls-untrusted" role="region" aria-label={`${field} source content`} tabIndex={0}>
      <p className="ls-untrusted__label">
        <span aria-hidden="true">{compactField} · untrusted</span>
        <span className="ls-visually-hidden">{field} · untrusted.</span>
      </p>
      <pre className="ls-untrusted__body" aria-describedby="open-escalation-source-policy">{children}</pre>
    </div>
  );
}

/**
 * The one-open-Escalation surface shared by every Run Detail tab.
 *
 * Metadata comes from the addressed wait's immutable raise event and matching agent work;
 * missing fields remain visibly unavailable. Candidate labels and model rationale are
 * untrusted source text. Fixed answer labels come from the closed application vocabulary.
 * The only mutation is the server action, behind the routine confirmation dialog.
 */
export function EscalationPanel({ runId, wait, details, runRevision, readAt, workspacePresentation }: EscalationPanelProps): React.JSX.Element {
  const router = useRouter();
  // Where an answer that committed is confirmed: the host outlives this panel, which the
  // refresh below removes. Without a host (an SSR test) the panel keeps it itself.
  const reportOutcome = useEscalationOutcome();
  const headingId = useId();
  const questionId = useId();
  const evidenceId = useId();
  const noteId = useId();
  const countdownId = useId();
  const [remaining, setRemaining] = useState(() => remainingMilliseconds(wait.deadline, readAt));
  // The live region has to EXIST before it has text, or a screen reader treats the text as
  // ordinary content that arrived with the panel and says nothing. So it renders empty and
  // is filled one tick later — which is also the moment the panel really did appear.
  const [announcing, setAnnouncing] = useState(false);
  const [note, setNote] = useState('');
  const [pendingOption, setPendingOption] = useState<EscalationOption | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The surface's gate (PR 29 review). Story 5.6 mounted this panel INSIDE Live View's
   * `LiveGate`, and Story 5.7 withdraws every control there when the stream is lost for
   * sixty seconds or the Run ends — but this panel read no gate, so its answer buttons
   * stayed live and an answer could commit from a page that no longer knew the Run's
   * state. On Run Detail there is no provider and the gate is open, so that surface is
   * unchanged.
   */
  const gate = useActionGate();
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);

  useEffect(() => { setAnnouncing(true); }, []);

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
      const answered: PanelMessage = {
        tone: 'success',
        title: option.id === 'abort' ? 'Run canceled.' : 'Escalation answered.',
        body: option.id === 'abort'
          ? 'The Run is canceled with the Escalation answer recorded in its Timeline.'
          : 'The Run resumes with the Escalation answer recorded in its Timeline.',
      };
      if (reportOutcome === null) setMessage(answered);
      else reportOutcome({ waitId: wait.waitId, ...answered });
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
  const kindLabel = ESCALATION_KIND_WORDS[wait.kind];
  const countdown = countdownText(remaining);
  const milestone = escalationMilestone(remaining);
  // Derived, never set from an effect: `remaining` moves every second and `milestone` only
  // at a rung, so the region's text is stable in between and React writes it once. Two
  // effects racing to fill one region would re-announce whichever won.
  const announcement = announcing ? ESCALATION_PANEL_COPY.milestones[milestone] : '';
  const countdownExpired = milestone === 'expired';
  const options = orderedEscalationOptions(wait);
  const candidateOptions = wait.kind === 'choose-candidate'
    ? options.filter((option) => option.id !== 'mark-ambiguous')
    : [];
  const workspace = workspacePresentation !== undefined;
  const workspaceEvidence = (details?.supportingEvidenceIds ?? []).slice(0, WORKSPACE_SUPPORTING_EVIDENCE_LIMIT);
  const workspaceStepLabel = workspacePresentation?.stepLabel?.trim() || ESCALATION_PANEL_COPY.noStep;

  const questionSection = (
    <section aria-labelledby={questionId} className="ls-stack escalation-panel__question">
      <h3 id={questionId}>Question</h3>
      {details?.agentQuestion === null || details?.agentQuestion === undefined ? (
        <p>{ESCALATION_PANEL_COPY.noAgentQuestion}</p>
      ) : (
        <UntrustedText field="AGENT-GENERATED question" policy={false}>{details.agentQuestion}</UntrustedText>
      )}
      <p><strong>Platform question</strong></p>
      <p>{question}</p>
    </section>
  );

  const evidenceSection = (
    <section aria-labelledby={evidenceId} className="ls-stack">
      <h3 id={evidenceId}>Supporting Evidence</h3>
      {details?.supportingEvidenceIds === null || details?.supportingEvidenceIds === undefined || details.supportingEvidenceIds.length === 0 ? (
        <p>{ESCALATION_PANEL_COPY.noSupportingEvidence}</p>
      ) : (
        <ul>
          {details.supportingEvidenceIds.map((supportingEvidenceId) => (
            <li key={supportingEvidenceId}>
              <a className="ls-mono" href={`/runs/${runId}/evidence/technical#evidence-${encodeURIComponent(supportingEvidenceId)}`}>
                {supportingEvidenceId}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const answerSection = (
    <fieldset className="ls-stack escalation-panel__answers" disabled={unknown}>
      <legend>Answer{workspace && <span className="ls-caption"> · No recommendation</span>}</legend>
      {!workspace && <p>Choose one answer. The platform expresses no recommendation.</p>}
      <div className="ls-stack escalation-panel__answer-options">
        {options.map((option, index) => (
          <div key={`${option.id}-${index}`} className="ls-stack escalation-panel__answer-option">
            {wait.kind === 'choose-candidate' && option.id !== 'mark-ambiguous' ? (
              workspace ? (
                <WorkspaceUntrustedText field={`AGENT-GENERATED candidate ${candidateOptions.indexOf(option) + 1}`}>
                  {option.label}
                </WorkspaceUntrustedText>
              ) : (
                <UntrustedText field={`AGENT-GENERATED candidate ${candidateOptions.indexOf(option) + 1}`} policy={false}>
                  {option.label}
                </UntrustedText>
              )
            ) : null}
            <Button
              variant="secondary"
              busy={busy}
              onClick={() => setPendingOption(option)}
              {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}
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
  );

  const noteSection = (
    <div className="ls-stack">
      <label htmlFor={noteId}>{ESCALATION_PANEL_COPY.answerNoteLabel}</label>
      <textarea
        className="ls-textarea"
        id={noteId}
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        // `readOnly` and `aria-disabled`, never `disabled`: a disabled field cannot be
        // focused, so the reason beside it is unreachable by keyboard -- the
        // tooltip-only explanation DESIGN.md forbids, and this contract's own rule for
        // every other control on the surface.
        readOnly={busy || unknown || gate.disabledReason !== null}
        aria-disabled={busy || unknown || gate.disabledReason !== null ? true : undefined}
        aria-describedby={gate.disabledReason !== null ? `${noteId}-withdrawn` : undefined}
      />
      {gate.disabledReason !== null
        ? <p id={`${noteId}-withdrawn`} className="ls-caption">{gate.disabledReason}</p>
        : null}
    </div>
  );

  const timeSection = (
    <section className="ls-stack escalation-panel__time" aria-labelledby={countdownId}>
      <h3 id={countdownId}>Time remaining</h3>
      {/* `role="timer"` and NO live region. Its implicit `aria-live` is `off`, which is
          what a clock should be: the milestones are announced beside it instead. */}
      <p role="timer">
        <time dateTime={wait.deadline}>{countdown}</time>
        {countdownExpired ? ' — deadline reached; reload this Run for the recorded outcome.' : null}
      </p>
    </section>
  );

  const technicalSection = workspace ? (
    <details className="escalation-panel__technical">
      <summary>Technical details</summary>
      <dl className="ls-definition">
        <dt>Kind</dt>
        <dd>{kindLabel}</dd>
        <dt>Step</dt>
        <dd>{workspaceStepLabel}</dd>
        {details?.stepId === null || details?.stepId === undefined ? null : (
          <>
            <dt>Step ID</dt>
            <dd><span className="ls-mono">{details.stepId}</span></dd>
          </>
        )}
        <dt>Supporting captures</dt>
        <dd>
          {workspaceEvidence.length === 0 ? ESCALATION_PANEL_COPY.noSupportingEvidence : (
            <ul>
              {workspaceEvidence.map((supportingEvidenceId, index) => (
                <li key={supportingEvidenceId}>
                  <span>Supporting capture {index + 1}</span>{' '}
                  <a className="ls-mono" href={`/runs/${runId}/evidence/technical#evidence-${encodeURIComponent(supportingEvidenceId)}`}>
                    {supportingEvidenceId}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {details?.supportingEvidenceIds !== undefined && details?.supportingEvidenceIds !== null && details.supportingEvidenceIds.length > workspaceEvidence.length
            ? <p className="ls-caption">Showing {workspaceEvidence.length} of {details.supportingEvidenceIds.length} supporting captures.</p>
            : null}
        </dd>
      </dl>
    </details>
  ) : (
    <dl className="ls-definition">
      <dt>Kind</dt>
      <dd>{kindLabel}</dd>
      <dt>Step</dt>
      <dd>{details?.stepId === null || details?.stepId === undefined
        ? ESCALATION_PANEL_COPY.noStep
        : <span className="ls-mono">{details.stepId}</span>}</dd>
      <dt>Deadline</dt>
      <dd><Timestamp value={wait.deadline} /></dd>
    </dl>
  );

  const workspaceContextSection = workspace ? (
    <details className="escalation-panel__workspace-context">
      <summary>Decision context</summary>
      <dl className="ls-definition">
        <dt>Step</dt>
        <dd>{workspaceStepLabel}</dd>
        <dt>Supporting captures</dt>
        <dd>
          {workspaceEvidence.length === 0 ? ESCALATION_PANEL_COPY.noSupportingEvidence : (
            <ul>
              {workspaceEvidence.map((supportingEvidenceId, index) => (
                <li key={supportingEvidenceId}>
                  <a href={`/runs/${runId}/evidence/technical#evidence-${encodeURIComponent(supportingEvidenceId)}`}>
                    Supporting capture {index + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </details>
  ) : null;

  const workspaceQuestionSection = workspace ? (
    <section aria-labelledby={questionId} className="ls-stack escalation-panel__question">
      <h3 id={questionId}>Question</h3>
      {details?.agentQuestion === null || details?.agentQuestion === undefined ? (
        <p>{ESCALATION_PANEL_COPY.noAgentQuestion}</p>
      ) : (
        <WorkspaceUntrustedText field="AGENT-GENERATED question">{details.agentQuestion}</WorkspaceUntrustedText>
      )}
      <details className="escalation-panel__platform-question">
        <summary>Platform question</summary>
        <p>{question}</p>
      </details>
      {workspaceContextSection}
    </section>
  ) : null;

  const workspaceNoteSection = workspace ? (
    <details className="escalation-panel__note">
      <summary>Add an optional note</summary>
      {noteSection}
    </details>
  ) : noteSection;

  return (
    <>
      <a className="ls-skip-link" href="#open-escalation">{ESCALATION_PANEL_COPY.skipLink}</a>
      {/* `tabIndex={-1}`, as the shell's own skip-link target has: without it the skip link
          scrolls the page and leaves focus on the link, so the next Tab walks the page
          again instead of reaching the answers (legacy Story 5.6, Story 10.6). */}
      <section id="open-escalation" tabIndex={-1} className={`ls-card ls-stack${workspace ? ' escalation-panel--workspace' : ''}`} aria-labelledby={headingId}>
        <h2 id={headingId}>Open Escalation</h2>
        {/* The panel's appearance and its two countdown milestones, in the ONE polite
            region this surface has (EXPERIENCE.md → Accessibility). It is always in the
            document while the panel is, and only its text changes. */}
        <p className="ls-visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
        {message !== null ? <Banner tone={message.tone} title={message.title}>{message.body ? <p>{message.body}</p> : null}</Banner> : null}
        {unknown ? <p><a href={`/runs/${runId}`}>Reload this Run</a></p> : null}
        {workspace ? <p id="open-escalation-source-policy" className="escalation-panel__source-policy">{UNTRUSTED_CONTENT_SENTENCE}</p> : null}

        {/* The policy sentence once, for the question and every candidate below it, rather
            than under each (UX-27). Stated whenever the panel is, because an Escalation
            panel exists to put agent-generated text in front of a person. The workspace
            variant states it above, under the id its compact blocks point at. */}
        {workspace ? null : <UntrustedPolicy />}
        {workspace ? null : technicalSection}
        {workspace ? workspaceQuestionSection : null}
        {workspace ? answerSection : null}
        {workspace ? workspaceNoteSection : null}
        {workspace ? timeSection : null}
        {workspace ? technicalSection : null}
        {workspace ? null : questionSection}
        {workspace ? null : evidenceSection}
        {workspace ? null : timeSection}
        {workspace ? null : answerSection}
        {workspace ? null : noteSection}
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
