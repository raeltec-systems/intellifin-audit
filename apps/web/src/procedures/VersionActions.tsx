'use client';
import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VersionDecision } from '@intellifin/domain';
import { versionDecisionAction } from '../../app/procedures/version-actions';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { Banner } from '../design/Banner';
import { UnavailableActions } from '../design/UnavailableActions';
import { decisionConsequence, decisionTitle, type DecisionSubject } from './version-review-words';

/**
 * The version decision controls, and the confirmation each one opens.
 *
 * `subject` is what the dialog names. It is OPTIONAL because the Builder and the
 * Procedure page mount this for a Draft's Submit, where the page around the control
 * already names the Draft; on the version review surface the confirmation is the last
 * thing a manager reads before an approval activates a Procedure, so it names the
 * Control, the version number and what approval will actually do
 * (`version-review-words.ts`). Without it the wording is exactly what those two
 * surfaces have always shown.
 *
 * The native fieldset is deliberate. These buttons are server-rendered before React
 * attaches their click handlers. Without a native pre-hydration guard a fast manager can
 * click Approve, see nothing happen, and have no indication that the click was discarded.
 * This was reproduced by the deployed LoanCore acceptance after the submitted version
 * loaded successfully and before any approval POST reached the server. `aria-disabled`
 * cannot solve that interval because it too relies on an attached handler to refuse an
 * activation; `fieldset disabled` is enforced by the browser before JavaScript exists.
 */
export function VersionActions({ procedureId, versionId, rowVersion, actions, beforeConfirm, subject }: { readonly procedureId: string; readonly versionId: string; readonly rowVersion: string; readonly beforeConfirm?: () => string | null; readonly subject?: DecisionSubject; readonly actions: readonly { decision: VersionDecision; label: string; reason: string | null }[] }): React.JSX.Element {
  const id = useId(), router = useRouter();
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const [confirming, setConfirming] = useState<VersionDecision | null>(null);
  const [busy, setBusy] = useState(false), [reason, setReason] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [unknown, setUnknown] = useState(false);
  async function decide(value: string | null) {
    if (!clientReady || !confirming || busy || unknown) return;
    const unavailable = (confirming === 'submit' ? beforeConfirm?.() : null) ?? actions.find(action => action.decision === confirming)?.reason;
    if (unavailable) { setReason(unavailable); return; }
    setBusy(true); setReason(null); if (value !== null) setRationale(value);
    try {
      const result = await versionDecisionAction({ procedureId, versionId, expectedRowVersion: rowVersion, decision: confirming, rationale: value });
      if (result.ok) { setConfirming(null); router.push(confirming === 'edit' ? `/procedures/${procedureId}/builder?version=${versionId}` : `/procedures/${procedureId}/versions/${versionId}`); router.refresh(); }
      else { setReason(result.reason); if (result.unknownOutcome) { setUnknown(true); setConfirming(null); } }
    } catch { setUnknown(true); setConfirming(null); setReason('The decision may have been saved. Reload the page before trying again.'); }
    finally { setBusy(false); }
  }
  const pending = actions.find(action => action.decision === confirming);
  const named = subject ?? null;
  return <div className="ls-stack" data-version-actions-ready={clientReady}>
    {!clientReady && actions.length > 0 ? <p role="status">Preparing decision controls…</p> : null}
    <fieldset disabled={!clientReady} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="ls-visually-hidden">Version decisions</legend>
      <div className="ls-actions">{actions.map(action => <Button key={action.decision} variant={action.decision === 'submit' || action.decision === 'approve' ? 'primary' : 'secondary'} busy={busy} disabledReason={unknown ? 'Reload to inspect the saved decision.' : action.reason ?? undefined} disabledReasonId={unknown ? `${id}-unknown` : `${id}-${action.decision}`} onClick={() => { setReason(null); setConfirming(action.decision); }}>{action.label}</Button>)}</div>
    </fieldset>
    {unknown ? <div id={`${id}-unknown`}><p>Reload to inspect the saved decision.</p><Button onClick={() => window.location.reload()}>Reload version</Button>{rationale ? <p>Rationale entered: {rationale}</p> : null}</div> : null}
    <UnavailableActions actions={actions.flatMap(action => action.reason ? [{ id: `${id}-${action.decision}`, label: action.label, reason: action.reason }] : [])} />
    {!confirming && reason ? <Banner tone="danger" title={reason} /> : null}
    <ConfirmDialog open={confirming !== null} weight={confirming === 'reject' ? 'routine-with-rationale' : 'routine'} title={decisionTitle(confirming ?? 'submit', pending?.label ?? 'Decide', confirming === null ? null : named)} consequence={decisionConsequence(confirming ?? 'submit', confirming === null ? null : named)} confirmLabel={busy ? 'Saving…' : pending?.label ?? 'Confirm'} onConfirm={value => { void decide(value); }} onCancel={() => { if (!busy) setConfirming(null); }} initialRationale={rationale} refusal={reason} busy={busy} />
  </div>;
}
