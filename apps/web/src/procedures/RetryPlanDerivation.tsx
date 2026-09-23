'use client';

import { useRef, useState } from 'react';
import type { ProcedureVersionView } from '@intellifin/application';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';
import { completenessReason } from '@intellifin/domain';
import { planAuthoringInputs } from '@intellifin/application';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { draftGapWords } from './readiness-words';
import { PLAN_ATTEMPT_WORDS, PLAN_DRAFT_INCOMPLETE, PLAN_NOT_PREPARED_TITLE, PLAN_PLATFORM_FAILED, PLAN_RECOVERY_LABEL, PLAN_RETRY_ALREADY_QUEUED, PLAN_RETRY_CONFIRM, PLAN_RETRY_LABEL, PLAN_RETRY_QUEUED, planRetryConsequence } from './plan-words';

export interface RetryPlanDerivationFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
}
export type RetryPlanDerivationResult = { readonly ok: true; readonly rowVersion: string } | { readonly ok: false; readonly reason: string };

/** A queued acknowledgement blocks only the server generation it was requested from. */
export function createRetryAcknowledgement(initialKey: string) {
  let key = initialKey;
  let generation = 0;
  let acknowledged: number | null = null;
  return {
    observe(nextKey: string) { if (nextKey !== key) { key = nextKey; generation += 1; } },
    get generation() { return generation; },
    acknowledge(requestGeneration: number) { acknowledged = requestGeneration; },
    get blocked() { return acknowledged === generation; },
  };
}

/**
 * A separate authoring action: the saved executable plan preview stays read-only.
 *
 * Its authorization and revision guard are unchanged (UX-16): the retry still sends the
 * row version the auditor confirmed, and the server re-checks both.
 */
export function RetryPlanDerivation({ draft, rowVersion, onRetry }: {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onRetry: (fields: RetryPlanDerivationFields) => Promise<RetryPlanDerivationResult>;
}): React.JSX.Element | null {
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [result, setResult] = useState<RetryPlanDerivationResult | null>(null);
  const saving = useRef(false);
  const generationKey = JSON.stringify([draft.versionId, draft.state, draft.planStatus, draft.planInputDigest,
    draft.planAttempts.map((attempt) => [attempt.attemptId, attempt.outcome])]);
  const acknowledgement = useRef<ReturnType<typeof createRetryAcknowledgement> | null>(null);
  acknowledgement.current ??= createRetryAcknowledgement(generationKey);
  const gate = acknowledgement.current;
  // Observe pending generations even while this component has no visible controls.
  gate.observe(generationKey);
  const visibleResult = result?.ok && !gate.blocked ? null : result;
  if (draft.state !== 'DRAFT' || draft.planStatus !== 'failed') return null;
  async function retry(): Promise<void> {
    if (saving.current || unknownOutcome || gate.blocked || confirmationToken === null) return;
    const expectedRowVersion = confirmationToken;
    const requestGeneration = gate.generation;
    saving.current = true; setBusy(true); setConfirmationToken(null);
    try {
      const outcome = await onRetry({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion });
      if (outcome.ok) gate.acknowledge(requestGeneration);
      setResult(outcome);
    }
    catch { setUnknownOutcome(true); setResult(null); }
    finally { saving.current = false; setBusy(false); }
  }
  // UX-16: say WHICH of two things happened. A plan the compiler refused because the
  // Draft is incomplete is fixed in the Draft (and re-prepared automatically on the next
  // save); a plan the platform could not prepare is tried again here. The attempt history
  // is the platform's record, kept under Technical details rather than read first.
  const gap = draftGapWords(completenessReason(planAuthoringInputs(draft)));
  return <section className="ls-card ls-stack" aria-label={PLAN_RECOVERY_LABEL} data-plan-recovery={gap === null ? 'platform' : 'draft'}>
    <h2 className="ls-card__title">{PLAN_NOT_PREPARED_TITLE}</h2>
    {gap === null
      ? <p>{PLAN_PLATFORM_FAILED}</p>
      : <p>{PLAN_DRAFT_INCOMPLETE} {gap}</p>}
    <UnknownSaveOutcome visible={unknownOutcome} />
    {visibleResult === null ? null : <Banner tone={visibleResult.ok ? 'success' : 'danger'} title={visibleResult.ok ? PLAN_RETRY_QUEUED : visibleResult.reason} />}
    <Button type="button" variant="primary" busy={busy} disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : gate.blocked ? PLAN_RETRY_ALREADY_QUEUED : undefined} onClick={() => { setResult(null); setConfirmationToken(rowVersion); }}>{PLAN_RETRY_LABEL}</Button>
    <TechnicalDetails items={[
      { label: 'Reason recorded', value: draft.planFailureReason ?? 'No reason was recorded.' },
    ]}>
      {draft.planAttempts.length === 0 ? <p className="ls-caption">No preparation attempt is recorded.</p> : <ol className="ls-stack" data-plan-attempts>
        {draft.planAttempts.map((attempt) => <li key={attempt.attemptId}>
          <Timestamp value={attempt.attemptedAt} /> — {PLAN_ATTEMPT_WORDS[attempt.outcome]}{attempt.reason === null ? '' : `: ${attempt.reason}`}
        </li>)}
      </ol>}
    </TechnicalDetails>
    <ConfirmDialog open={confirmationToken !== null} weight="routine" title={`${PLAN_RETRY_LABEL}?`} consequence={planRetryConsequence(draft.versionNumber, draft.controlName)} confirmLabel={PLAN_RETRY_CONFIRM} onConfirm={() => { void retry(); }} onCancel={() => setConfirmationToken(null)} />
  </section>;
}
