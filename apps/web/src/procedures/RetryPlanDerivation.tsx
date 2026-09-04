'use client';

import { useRef, useState } from 'react';
import type { ProcedureVersionView } from '@intellifin/application';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';

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

/** A separate authoring action: the saved executable plan preview stays read-only. */
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
  return <section className="ls-card ls-stack" aria-label="Plan derivation recovery">
    <h2 className="ls-card__title">Retry plan derivation</h2>
    <p>After the failure is resolved, request another worker attempt using this Draft’s saved sections.</p>
    <UnknownSaveOutcome visible={unknownOutcome} />
    {visibleResult === null ? null : <Banner tone={visibleResult.ok ? 'success' : 'danger'} title={visibleResult.ok ? 'A new derivation attempt is queued.' : visibleResult.reason} />}
    <Button type="button" variant="primary" busy={busy} disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : gate.blocked ? 'A new derivation attempt is already queued.' : undefined} onClick={() => { setResult(null); setConfirmationToken(rowVersion); }}>Retry plan derivation</Button>
    <ConfirmDialog open={confirmationToken !== null} weight="routine" title="Retry plan derivation?" consequence={`This queues a new attempt for Draft version ${draft.versionNumber} of ${draft.controlName}. It does not execute the plan or change the authored sections.`} confirmLabel="Queue derivation attempt" onConfirm={() => { void retry(); }} onCancel={() => setConfirmationToken(null)} />
  </section>;
}
