'use client';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VersionDecision } from '@intellifin/domain';
import { versionDecisionAction } from '../../app/procedures/version-actions';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { Banner } from '../design/Banner';
import { UnavailableActions } from '../design/UnavailableActions';

export function VersionActions({ procedureId, versionId, rowVersion, actions, beforeConfirm }: { readonly procedureId: string; readonly versionId: string; readonly rowVersion: string; readonly beforeConfirm?: () => string | null; readonly actions: readonly { decision: VersionDecision; label: string; reason: string | null }[] }): React.JSX.Element {
  const id = useId(), router = useRouter();
  const [confirming, setConfirming] = useState<VersionDecision | null>(null);
  const [busy, setBusy] = useState(false), [reason, setReason] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [unknown, setUnknown] = useState(false);
  async function decide(value: string | null) {
    if (!confirming || busy || unknown) return;
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
  return <div className="ls-stack">
    <div className="ls-actions">{actions.map(action => <Button key={action.decision} variant={action.decision === 'submit' || action.decision === 'approve' ? 'primary' : 'secondary'} busy={busy} disabledReason={unknown ? 'Reload to inspect the saved decision.' : action.reason ?? undefined} disabledReasonId={unknown ? `${id}-unknown` : `${id}-${action.decision}`} onClick={() => { setReason(null); setConfirming(action.decision); }}>{action.label}</Button>)}</div>
    {unknown ? <div id={`${id}-unknown`}><p>Reload to inspect the saved decision.</p><Button onClick={() => window.location.reload()}>Reload version</Button>{rationale ? <p>Rationale entered: {rationale}</p> : null}</div> : null}
    <UnavailableActions actions={actions.flatMap(action => action.reason ? [{ id: `${id}-${action.decision}`, label: action.label, reason: action.reason }] : [])} />
    {!confirming && reason ? <Banner tone="danger" title={reason} /> : null}
    <ConfirmDialog open={confirming !== null} weight={confirming === 'reject' ? 'routine-with-rationale' : 'routine'} title={`${actions.find(a => a.decision === confirming)?.label ?? 'Decide'}?`} consequence={confirming === 'approve' ? 'This freezes the reviewed Procedure Version and records your approval.' : confirming === 'reject' ? 'This records your rationale and returns the Procedure Version to its author.' : 'This changes the Procedure Version state and records the decision against your name.'} confirmLabel={busy ? 'Saving…' : actions.find(a => a.decision === confirming)?.label ?? 'Confirm'} onConfirm={value => { void decide(value); }} onCancel={() => { if (!busy) setConfirming(null); }} initialRationale={rationale} refusal={reason} busy={busy} />
  </div>;
}
