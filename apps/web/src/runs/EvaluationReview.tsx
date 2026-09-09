'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  EVALUATION_REVIEW_REFUSALS,
  EVALUATION_REVIEW_VALUES,
  type EvaluationReviewCommandStatus,
} from '@intellifin/application';
import type { EvaluationValue } from '@intellifin/domain';
import type { RunEvaluationRow, RunResultRow } from '@intellifin/infrastructure';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { UntrustedText } from './UntrustedText';
import { evaluationOriginWord, evaluationValueWord, utcStamp } from './labels';
import { StatusBadge } from '../design/StatusBadge';
import {
  confirmEvaluationAction,
  rejectEvaluationAction,
  type EvaluationReviewActionResult,
} from './evaluation-review-actions';

/** The only replacement values a reviewer may submit. Labels are platform vocabulary. */
const VALUE_LABELS: Readonly<Record<EvaluationValue, string>> = {
  COMPLIANT: 'Compliant',
  EXCEPTION: 'Exception',
  UNEVALUATED: 'Unevaluated',
};

type ReviewableResult = Pick<RunResultRow, 'outcome' | 'sealed' | 'version'>;
type MachineProposal = NonNullable<RunEvaluationRow['machineProposal']>;
type ReviewDecision = NonNullable<RunEvaluationRow['reviewDecision']>;

export interface EvaluationReviewProps {
  readonly runId: string;
  /** The Result columns are read from the server; the client never supplies them. */
  readonly result: ReviewableResult | null;
  /** A bounded, server-read set of evaluation rows with original proposals retained. */
  readonly evaluations: readonly RunEvaluationRow[];
  /** Separate from Result.version and used as the command's expected CAS revision. */
  readonly reviewRevision: number;
  /** Exact count from the published Result, or null when that document was unreadable. */
  readonly pendingCount: number | null;
  /** Durable command state for the exact target/revision read by the server. */
  readonly commandStatuses?: readonly EvaluationReviewCommandStatus[];
}

type PendingDecision = {
  readonly action: 'confirm' | 'reject';
  readonly row: RunEvaluationRow;
  readonly replacementValue: EvaluationValue | null;
};

type ReviewMessage = {
  readonly tone: 'success' | 'danger';
  readonly title: string;
  readonly body?: string;
  readonly reload?: boolean;
};

function reviewKey(row: Pick<RunEvaluationRow, 'observationId' | 'conditionId'>): string {
  return `${row.observationId}:${row.conditionId}`;
}

function commandStatusKey(command: Pick<EvaluationReviewCommandStatus, 'observationId' | 'conditionId'>): string {
  return `${command.observationId}:${command.conditionId}`;
}

function valueLabel(value: EvaluationValue): string {
  return VALUE_LABELS[value];
}

function fixedValue(value: unknown): value is EvaluationValue {
  return typeof value === 'string' && (EVALUATION_REVIEW_VALUES as readonly string[]).includes(value);
}

function proposalFor(row: RunEvaluationRow): MachineProposal | null {
  return row.machineProposal ?? null;
}

function decisionFor(row: RunEvaluationRow): ReviewDecision | null {
  return row.reviewDecision ?? null;
}

function eligibleForReview(row: RunEvaluationRow, result: ReviewableResult | null): boolean {
  return result?.outcome === 'PENDING_CONFIRMATION' && !result.sealed &&
    row.origin === 'AGENT_JUDGED' && row.confirmation === 'pending' &&
    row.reviewDecision === null && proposalFor(row) !== null;
}

function originBadge(row: RunEvaluationRow): React.JSX.Element {
  const state = evaluationOriginWord(row.origin, row.confirmation);
  return state === null
    ? <span>{row.origin}</span>
    : <StatusBadge family="evaluation-origin" state={state} />;
}

function valueBadge(value: EvaluationValue): React.JSX.Element {
  const state = evaluationValueWord(value);
  return state === null
    ? <span>{value}</span>
    : <StatusBadge family="evaluation-value" state={state} />;
}

function resultRefusal(result: EvaluationReviewActionResult): string {
  return result && typeof result === 'object' && 'reason' in result && typeof result.reason === 'string'
    ? result.reason
    : 'The evaluation decision could not be confirmed. Reload the Run before trying again.';
}

function commandRefusal(code: EvaluationReviewCommandStatus['refusalCode']): string {
  if (code !== null && code !== 'unknown' && Object.hasOwn(EVALUATION_REVIEW_REFUSALS, code)) {
    return EVALUATION_REVIEW_REFUSALS[code];
  }
  return 'The review worker refused this command. Reload the Run before trying again.';
}

/**
 * The review cards for Agent-Judged evaluations.
 *
 * Values and state words are closed platform vocabulary. The machine rationale is the
 * only free text here and always goes through `UntrustedText`; a proposal cannot become a
 * button label or an instruction merely because the model wrote it.
 */
export function EvaluationReview({
  runId,
  result,
  evaluations,
  reviewRevision,
  pendingCount,
  commandStatuses = [],
}: EvaluationReviewProps): React.JSX.Element | null {
  const router = useRouter();
  const headingId = useId();
  const unavailableId = useId();
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [replacementValues, setReplacementValues] = useState<Record<string, EvaluationValue | ''>>({});
  const [busy, setBusy] = useState(false);
  const [dialogRefusal, setDialogRefusal] = useState<string | null>(null);
  const [message, setMessage] = useState<ReviewMessage | null>(null);
  // Keep the row unavailable during the short interval between an accepted Server
  // Action and the refreshed server projection. A response that was actually refused
  // never enters this map, so it cannot mask another reviewer's pending command.
  const [localPendingCommands, setLocalPendingCommands] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocalPendingCommands((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, commandId] of Object.entries(current)) {
        const serverStatus = commandStatuses.find((status) => commandStatusKey(status) === key);
        if (serverStatus === undefined) continue;
        if (serverStatus.status === 'PENDING') {
          if (next[key] !== serverStatus.commandId) {
            next[key] = serverStatus.commandId;
            changed = true;
          }
        } else {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [commandStatuses]);

  // The server supplies a fresh aggregate count. Rows are intentionally bounded, so this
  // component never derives a global count from the visible sample.
  const pendingOutcome = result?.outcome === 'PENDING_CONFIRMATION';
  const rows = evaluations.filter((row) =>
    row.origin === 'AGENT_JUDGED' ||
    (row.machineProposal !== null && row.machineProposal !== undefined) ||
    row.reviewDecision !== null,
  );
  const openForReview = pendingOutcome && result?.sealed === false;

  if (!pendingOutcome && rows.length === 0) return null;

  function selectReplacement(row: RunEvaluationRow): EvaluationValue | null {
    const value = replacementValues[reviewKey(row)];
    return value !== undefined && value !== '' && fixedValue(value) ? value : null;
  }

  function begin(row: RunEvaluationRow, action: 'confirm' | 'reject'): void {
    const key = reviewKey(row);
    const commandPending = localPendingCommands[key] !== undefined ||
      commandStatuses.some((status) => commandStatusKey(status) === key && status.status === 'PENDING');
    if (!eligibleForReview(row, result) || commandPending || busy) return;
    setDialogRefusal(null);
    setMessage(null);
    setPending({ action, row, replacementValue: action === 'reject' ? selectReplacement(row) : null });
  }

  function cancel(): void {
    if (busy) return;
    setDialogRefusal(null);
    setPending(null);
  }

  async function decide(rationale: string | null): Promise<void> {
    if (pending === null || busy) return;
    const target = pending;
    if (target.action === 'reject' && target.replacementValue === null) {
      setDialogRefusal('Choose Compliant, Exception, or Unevaluated as the replacement.');
      return;
    }
    setBusy(true);
    setDialogRefusal(null);
    setMessage(null);
    const common = {
      runId,
      observationId: target.row.observationId,
      conditionId: target.row.conditionId,
      expectedReviewRevision: reviewRevision,
    };
    let response: EvaluationReviewActionResult;
    try {
      response = target.action === 'confirm'
        ? await confirmEvaluationAction(common)
        : await rejectEvaluationAction({
            ...common,
            replacementValue: target.replacementValue,
            rationale: rationale ?? '',
          });
    } catch {
      response = {
        ok: false,
        code: 'unknown-outcome',
        reason: 'The evaluation decision could not be confirmed. Reload the Run before trying again.',
        unknownOutcome: true,
      };
    }

    if (response.ok) {
      if ('commandId' in response && typeof response.commandId === 'string') {
        setLocalPendingCommands((current) => ({ ...current, [reviewKey(target.row)]: response.commandId }));
      }
      setPending(null);
      setDialogRefusal(null);
      setMessage({
        tone: 'success',
        title: 'Review submitted.',
        body: 'The worker will apply this decision and refresh the Result. Reload the Run to see the stored outcome.',
      });
      router.refresh();
    } else if (response.code === 'stale-revision' || response.code === 'unknown-outcome' ||
      ('unknownOutcome' in response && response.unknownOutcome === true)) {
      setPending(null);
      setDialogRefusal(null);
      setMessage({ tone: 'danger', title: resultRefusal(response), reload: true });
    } else {
      setDialogRefusal(resultRefusal(response));
    }
    setBusy(false);
  }

  return (
    <section className="ls-card ls-stack" aria-labelledby={headingId}>
      <h2 id={headingId}>Evaluation review</h2>
      {message !== null ? (
        <Banner tone={message.tone} title={message.title}>
          {message.body ? <p>{message.body}</p> : null}
          {message.reload ? <p><a href={`/runs/${runId}`}>Reload this Run</a></p> : null}
        </Banner>
      ) : null}
      {pendingOutcome ? (
        pendingCount === null ? (
          <p id={unavailableId}>Agent-Judged evaluations await confirmation; the count is unavailable because the published Result document could not be read.</p>
        ) : (
          <p id={unavailableId}>{pendingCount} Agent-Judged evaluations await confirmation</p>
        )
      ) : null}
      {openForReview ? (
        <p>Submission is unavailable while the Result is unsealed.</p>
      ) : result?.sealed ? (
        <p>The Result is sealed. Review history is read-only.</p>
      ) : null}
      {rows.length === 0 ? (
        <p>No Agent-Judged evaluation proposal is available in the bounded review read.</p>
      ) : (
        <ul className="ls-plain-list">
          {rows.map((row) => {
            const key = reviewKey(row);
            const proposal = proposalFor(row);
            const reviewDecision = decisionFor(row);
            const commandStatus = commandStatuses.find((status) => commandStatusKey(status) === key);
            const commandPending = localPendingCommands[key] !== undefined || commandStatus?.status === 'PENDING';
            const eligible = eligibleForReview(row, result);
            const selected = selectReplacement(row);
            const commandPendingReason = commandPending
              ? 'A review decision is already queued for this evaluation.'
              : undefined;
            return (
              <li className="ls-evaluation ls-stack" key={key}>
                <p className="ls-evaluation__condition">
                  <span className="ls-mono">{row.observationId}</span>{' / '}
                  <span className="ls-mono">{row.conditionId}</span>
                </p>
                <div className="ls-evaluation__badges">
                  {originBadge(row)}
                  {valueBadge(row.value)}
                </div>

                <section className="ls-stack" aria-label="Original Agent-Judged proposal">
                  <h3>Original Agent-Judged proposal</h3>
                  {proposal === null ? (
                    <p>The original Agent-Judged proposal is unavailable, so no review control is offered.</p>
                  ) : (
                    <>
                      <dl className="ls-definition">
                        <div>
                          <dt>Proposed value</dt>
                          <dd>{valueBadge(proposal.value)}</dd>
                        </div>
                        <div>
                          <dt>Confidence</dt>
                          <dd className="ls-mono">{proposal.confidence}</dd>
                        </div>
                      </dl>
                      <UntrustedText field="AGENT-GENERATED evaluation rationale">
                        {proposal.rationale}
                      </UntrustedText>
                    </>
                  )}
                </section>

                {reviewDecision !== null ? (
                  <section className="ls-stack" aria-label="Stored human review decision">
                    <h3>Stored human review decision</h3>
                    <dl className="ls-definition">
                      <div>
                        <dt>Decision</dt>
                        <dd>{reviewDecision.action === 'confirm' ? 'Confirmed' : 'Rejected'}</dd>
                      </div>
                      <div>
                        <dt>Effective value</dt>
                        <dd>{valueBadge(row.value)}</dd>
                      </div>
                      <div>
                        <dt>Reviewer</dt>
                        <dd className="ls-mono">{reviewDecision.actorId}</dd>
                      </div>
                      <div>
                        <dt>Decided at (UTC)</dt>
                        <dd className="ls-mono"><time dateTime={reviewDecision.decidedAt}>{utcStamp(reviewDecision.decidedAt)}</time></dd>
                      </div>
                    </dl>
                    {reviewDecision.rejectionRationale === null ? null : (
                      <p><strong>Rejection rationale:</strong> {reviewDecision.rejectionRationale}</p>
                    )}
                  </section>
                ) : null}

                {commandPending ? (
                  <p role="status">Review queued. The worker is processing this decision.</p>
                ) : commandStatus?.status === 'REFUSED' ? (
                  <p role="alert">The review worker refused this command: {commandRefusal(commandStatus.refusalCode)}</p>
                ) : commandStatus?.status === 'SUCCEEDED' && reviewDecision === null ? (
                  <p role="status">The review worker completed this command. Reload the Run to read the stored decision.</p>
                ) : null}

                {eligible && proposal !== null ? (
                  <div className="ls-stack">
                    <div className="ls-dialog__field">
                      <label htmlFor={`${key}-replacement`}>Replacement value for rejection</label>
                      <select
                        className="ls-select"
                        id={`${key}-replacement`}
                        value={replacementValues[key] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setReplacementValues((current) => ({
                            ...current,
                            [key]: value === '' ? '' : fixedValue(value) ? value : '',
                          }));
                        }}
                      >
                        <option value="">Choose a replacement value</option>
                        {EVALUATION_REVIEW_VALUES.map((value) => (
                          <option key={value} value={value}>{valueLabel(value)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="ls-dialog__actions">
                      <Button
                        variant="primary"
                        busy={busy}
                        disabledReason={commandPendingReason}
                        onClick={() => begin(row, 'confirm')}
                      >
                        Confirm evaluation
                      </Button>
                      <Button
                        variant="secondary"
                        busy={busy}
                        disabledReason={commandPendingReason ??
                          (selected === null ? 'Choose a replacement value before rejecting this evaluation.' : undefined)}
                        onClick={() => begin(row, 'reject')}
                      >
                        Reject evaluation
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        weight={pending?.action === 'reject' ? 'routine-with-rationale' : 'routine'}
        title={pending?.action === 'reject' ? 'Reject this evaluation?' : 'Confirm this evaluation?'}
        consequence={pending?.action === 'reject'
          ? `This replaces the Agent-Judged proposal with ${valueLabel(pending.replacementValue ?? 'UNEVALUATED')} and records your rationale.`
          : 'This records the Agent-Judged proposal as confirmed. The Result may seal when no other evaluations await confirmation.'}
        confirmLabel={pending?.action === 'reject' ? 'Reject evaluation' : 'Confirm evaluation'}
        refusal={dialogRefusal}
        busy={busy}
        onConfirm={decide}
        onCancel={cancel}
      />
    </section>
  );
}
