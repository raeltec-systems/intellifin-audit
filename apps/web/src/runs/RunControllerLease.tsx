'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { proposeRunControlTransferAction, confirmRunControlTransferAction, recoverRunControlTransferReceiptAction, type RunControlTransferProposalResult, changeRunControlAction, type RunControlReadActionResult } from '../../app/runs/control-actions';
import { UntrustedText } from './UntrustedText';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { pendingControlTransfer, retainControlTransfer, clearControlTransfer, type PendingControlTransfer } from './control-transfer-storage';
import { Button } from '../design/Button';
import { useLiveGate } from './LiveGate';
import { clearControlRenewal, pendingControlRenewal, retainControlRenewal, type PendingControlRenewal } from './control-renewal-storage';

/** Checking withdraws submission without discarding an unconfirmed decision. */
export type RunControlView = RunControlReadActionResult | { readonly status: 'checking'; readonly epoch: number | null } | null;
const ignoreRead = (_value: RunControlView): void => {};
const ReadPublication = createContext<{ readonly read: RunControlView; readonly publish: (value: RunControlView) => void } | null>(null);
export const RunControlReadProvider = ReadPublication.Provider;
export const useSharedRunControl = () => useContext(ReadPublication);
// A remount must not overlap a still-pending request in the same browser document.
const activeControlMutations = new Map<string, 'renew' | 'acquire' | 'release' | 'transfer'>();
const CONTROL_SETTLED = 'intellifin-control-settled';
const REQUEST_DEADLINE_MS = 15_000;
type Props = { readonly runId: string; readonly refreshKey: string; readonly onRead?: (value: RunControlView) => void };

export function RunControllerLease(props: Props): React.JSX.Element {
  return <ControllerLease key={props.runId} {...props} />;
}
function ControllerLease({ runId, refreshKey, onRead = ignoreRead }: Props): React.JSX.Element {
  const gate = useLiveGate();
  const region = useRef<HTMLElement | null>(null);
  const [transferAttempt, setTransferAttempt] = useState(0);
  const shared = useSharedRunControl();
  const latest = useRef({ onRead, shared, disabledReason: gate.disabledReason });
  latest.current = { onRead, shared, disabledReason: gate.disabledReason };
  const [read, setRead] = useState<RunControlView>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [readReason, setReadReason] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [hung, setHung] = useState(false);
  const [transferDraft, setTransferDraft] = useState(false);
  const [transferProposal, setTransferProposal] = useState<Extract<RunControlTransferProposalResult, { ok: true }>['proposal'] | null>(null);
  const [transferRecovery, setTransferRecovery] = useState(false);
  const [transferRefusal, setTransferRefusal] = useState<string | null>(null);
  const transferActions = useRef({ propose: (_reason: string) => {}, confirm: () => {}, retry: () => {}, cancel: () => {} });
  const actions = useRef({ refresh: () => {}, observe: () => {}, renew: () => {}, change: (_operation: 'acquire' | 'release') => {} });

  useEffect(() => {
    let closed = false;
    let generation = 0;
    let inFlight = false;
    let uncertainChange = false;
    let storageFailed = false;
    let presentation: RunControlView = null;
    let confirmed: Extract<RunControlReadActionResult, { status: 'ready' }> | null = null;
    let deadline = 0;
    let expiryTimer: number | undefined;
    const timers = new Set<number>();
    const reads = new Set<AbortController>();
    let pending: PendingControlRenewal | null = null;
    let transfer: PendingControlTransfer | null = null;
    let transferUncertain = false;
    let transferDismissed = false;
    let actorId: string | null = null;
    const available = () => !closed && document.visibilityState === 'visible' && latest.current.disabledReason === null;
    function publish(value: RunControlView): void {
      if (closed) return;
      presentation = value; setRead(value); latest.current.onRead(value); latest.current.shared?.publish(value);
    }
    function invalidate(): void {
      generation += 1; window.clearTimeout(expiryTimer); deadline = 0; confirmed = null;
      for (const controller of reads) controller.abort();
      reads.clear();
      publish({ status: 'unavailable' });
    }
    function checking(cancelReads = false): void {
      generation += 1;
      if (cancelReads) {
        for (const controller of reads) controller.abort();
        reads.clear();
      }
      publish({ status: 'checking', epoch: confirmed?.epoch ?? null });
    }
    function bounded(work: () => void): number {
      const timer = window.setTimeout(() => { timers.delete(timer); if (!closed) work(); }, REQUEST_DEADLINE_MS);
      timers.add(timer); return timer;
    }
    function clearTimer(timer: number): void { window.clearTimeout(timer); timers.delete(timer); }
    function unknownRenewal(): void {
      invalidate(); setUnknown(true); setRetryable(true);
      setReason('Control renewal could not be confirmed. Retry the same renewal to recover its receipt.');
    }
    try {
      pending = pendingControlRenewal(sessionStorage, runId);
      if (pending) unknownRenewal();
      if (activeControlMutations.has(runId)) {
        invalidate(); setBusy(true); setHung(true); setUnknown(true);
        setReason('A control request is still pending. Reload this Run to recover its recorded outcome.');
      }
    } catch {
      storageFailed = true; invalidate();
      setReason('Pending control recovery is unavailable. Restore browser session storage before renewing.');
    }
    async function refresh(): Promise<void> {
      if (closed || document.visibilityState !== 'visible') { invalidate(); return; }
      // An authenticated identity read is needed even when a terminal gate is closed.
      // No read can republish authority until every mutation has a definite outcome.
      if (inFlight || activeControlMutations.has(runId)) return;
      if (actorId !== null && (uncertainChange || pending !== null || transfer !== null || storageFailed)) { invalidate(); return; }
      checking();
      const requestGeneration = generation;
      const started = performance.now();
      const controller = new AbortController();
      reads.add(controller);
      const timer = bounded(() => {
        controller.abort();
        if (generation !== requestGeneration) return;
        invalidate(); setReadReason('Current control could not be read in time. Refresh control or reload this Run.');
      });
      // Server Actions share Next's queue with mutations. An independent, cancellable
      // read cannot delay renewal or safety commands while its response is stalled.
      const next: RunControlReadActionResult = await fetch(`/api/runs/${encodeURIComponent(runId)}/control`, {
        cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', signal: controller.signal,
      }).then(async response => {
        if (response.status === 401 || response.status === 403) return { status: 'denied' as const };
        if (response.status === 404) return { status: 'missing' as const };
        if (!response.ok) return { status: 'unavailable' as const };
        return await response.json() as RunControlReadActionResult;
      }).catch(() => ({ status: 'unavailable' as const }));
      reads.delete(controller);
      clearTimer(timer);
      if (closed || requestGeneration !== generation) return;
      if (next.status === 'ready') {
        actorId = next.actorId;
        try { transfer = pendingControlTransfer(sessionStorage, runId, actorId); }
        catch { storageFailed = true; invalidate(); setReadReason('Transfer recovery storage is unavailable.'); return; }
        if (transfer) { transferUncertain = true; setTransferRecovery(true); setTransferRefusal('A retained transfer request needs recovery before current control can be checked.'); }
      }
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || pending !== null || transfer !== null) { invalidate(); return; }
      window.clearTimeout(expiryTimer); deadline = 0;
      if (next.status !== 'ready') { invalidate(); publish(next); return; }
      if (next.expiresAt !== null) {
        // Count the entire round trip against the server's remaining duration.
        deadline = started + Date.parse(next.expiresAt) - Date.parse(next.serverTime);
        if (!Number.isFinite(deadline) || deadline <= performance.now()) { invalidate(); return; }
        expiryTimer = window.setTimeout(() => {
          invalidate(); setReadReason('The last confirmed control lease expired. Refresh current control.');
        }, deadline - performance.now());
      }
      confirmed = next; setReadReason(null); publish(next);
    }
    async function renew(): Promise<void> {
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || transfer !== null || storageFailed) return;
      if (pending === null) {
        if (!confirmed?.active || !confirmed.heldByYou || performance.now() >= deadline) { await refresh(); return; }
        const request = { runId, expectedEpoch: confirmed.epoch, requestKey: crypto.randomUUID() };
        try { retainControlRenewal(sessionStorage, request); pending = request; }
        catch { storageFailed = true; invalidate(); setReason('The renewal request could not be retained for recovery. Restore browser session storage.'); return; }
      }
      const request = pending;
      inFlight = true; activeControlMutations.set(runId, 'renew'); setBusy(true); setHung(false); checking(true);
      const timer = bounded(() => {
        unknownRenewal(); setHung(true);
        setReason('Control renewal is still pending. Reload this Run to recover the same request; no overlapping renewal will be sent.');
      });
      let definite = false;
      try {
        const result = await changeRunControlAction('renew', request);
        definite = result.ok || !result.unknownOutcome;
        if (definite) {
          clearControlRenewal(sessionStorage, request);
          pending = null;
        }
        if (closed) return;
        if (!definite) { unknownRenewal(); return; }
        setUnknown(false); setRetryable(false); setReason(result.ok ? null : result.reason);
      } catch {
        if (!closed) unknownRenewal();
      } finally {
        clearTimer(timer); activeControlMutations.delete(runId);
        window.dispatchEvent(new CustomEvent(CONTROL_SETTLED, { detail: { runId, definite } }));
        inFlight = false;
        if (!closed) {
          setBusy(false); setHung(false);
          // Definite receipt success is still only historical; authority needs this read.
          if (definite && pending === null) await refresh();
        }
      }
    }
    async function change(operation: 'acquire' | 'release'): Promise<void> {
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || pending !== null || transfer !== null || presentation?.status !== 'ready' || !confirmed) return;
      const request = { runId, expectedEpoch: confirmed.epoch };
      inFlight = true; activeControlMutations.set(runId, operation); setBusy(true); setReason(null); invalidate();
      const timer = bounded(() => {
        invalidate(); setUnknown(true); setHung(true);
        setReason('The control request is still pending. Reload this Run to check the recorded controller.');
      });
      let definite = false;
      try {
        const result = await changeRunControlAction(operation, request);
        definite = result.ok || !result.unknownOutcome;
        if (closed) return;
        uncertainChange = !result.ok && result.unknownOutcome === true;
        setUnknown(uncertainChange);
        setReason(result.ok ? null : result.reason);
      } catch {
        if (!closed) {
          uncertainChange = true; invalidate(); setUnknown(true);
          setReason('The control request could not be confirmed. Reload this Run.');
        }
      } finally {
        clearTimer(timer); activeControlMutations.delete(runId);
        window.dispatchEvent(new CustomEvent(CONTROL_SETTLED, { detail: { runId, definite } }));
        inFlight = false;
        if (!closed) { setBusy(false); setHung(false); if (!uncertainChange) await refresh(); }
      }
    }
    function transferUnknown(): void {
      transferUncertain = true; invalidate(); setTransferRecovery(true);
      setTransferRefusal('The transfer outcome is unknown. Retry the same request to recover its recorded outcome.');
    }
    async function runTransfer(mode: 'propose' | 'confirm' | 'recover', draft?: string): Promise<void> {
      setTransferAttempt(attempt => attempt + 1);
      if ((mode !== 'recover' && !available()) || closed || document.visibilityState !== 'visible' || inFlight || activeControlMutations.has(runId) || pending !== null || uncertainChange || storageFailed) {
        setTransferRefusal(latest.current.disabledReason ?? 'Current control is being checked. Refresh control before reviewing a transfer.'); return;
      }
      if (!transfer) {
        if (mode !== 'propose' || actorId === null || presentation?.status !== 'ready' || !confirmed?.active || !confirmed.transferEligible || confirmed.heldByYou || confirmed.holderName === null || performance.now() >= deadline) { setTransferRefusal('Current control changed or expired. Refresh control before reviewing a transfer.'); return; }
        const reason = draft?.trim() ?? '';
        if (!reason || [...reason].length > 1000 || new TextEncoder().encode(reason).length > 4000) {
          setTransferRefusal('Give a reason of at most 1,000 characters.'); return;
        }
        const request = { actorId, runId, expectedEpoch: confirmed.epoch, requestKey: crypto.randomUUID(), reason };
        try { retainControlTransfer(sessionStorage, request); transfer = request; }
        catch { setTransferRefusal('The transfer request could not be retained for recovery. Restore browser session storage.'); return; }
      }
      if (mode === 'confirm') {
        if (!transfer.commandId) return;
        try { const retained = { ...transfer, confirmRequested: true as const }; retainControlTransfer(sessionStorage, retained); transfer = retained; }
        catch { setTransferRefusal('The confirmation could not be retained for recovery. Restore browser session storage.'); return; }
      }
      if (mode === 'recover' && !transfer.commandId) { setTransferRefusal('Reconnect to recover and review this proposal.'); return; }
      const request = transfer;
      transferDismissed = false;
      inFlight = true; activeControlMutations.set(runId, 'transfer'); setBusy(true); setHung(false);
      setTransferDraft(false); setTransferRefusal(null); invalidate();
      const timer = bounded(() => { transferUnknown(); setHung(true); });
      let definite = false;
      try {
        const result = mode === 'propose'
          ? await proposeRunControlTransferAction({ runId: request.runId, expectedEpoch: request.expectedEpoch, requestKey: request.requestKey, reason: request.reason }, request.actorId)
          : mode === 'recover' ? await recoverRunControlTransferReceiptAction({ runId: request.runId, commandId: request.commandId }, request.actorId)
          : await confirmRunControlTransferAction({ runId: request.runId, commandId: request.commandId }, request.actorId);
        definite = result.ok || !('unknownOutcome' in result && result.unknownOutcome);
        if (!definite) { if (!closed) transferUnknown(); return; }
        if (result.ok && 'proposal' in result) {
          // Save the server command identity before confirmation can become available.
          const retained = { ...request, commandId: result.proposal.commandId };
          retainControlTransfer(sessionStorage, retained); transfer = retained;
          if (!closed) {
            transferUncertain = transferDismissed; setTransferRecovery(transferDismissed);
            setTransferRefusal(transferDismissed ? 'Transfer proposal recorded. Recover it to review before confirming.' : null);
            if (!transferDismissed) setTransferProposal(result.proposal);
          }
        } else {
          clearControlTransfer(sessionStorage, request); transfer = null;
          if (!closed) {
            transferUncertain = false; setTransferRecovery(false); setTransferProposal(null);
            setTransferRefusal(result.ok ? 'Control transfer recorded. Checking the current controller…' : result.reason);
          }
        }
      } catch { definite = false; if (!closed) transferUnknown(); }
      finally {
        clearTimer(timer); activeControlMutations.delete(runId);
        window.dispatchEvent(new CustomEvent(CONTROL_SETTLED, { detail: { runId, definite } }));
        inFlight = false;
        if (!closed) { setBusy(false); setHung(false); if (definite && transfer === null) await refresh(); }
      }
    }
    transferActions.current = {
      propose: reason => { void runTransfer('propose', reason); },
      confirm: () => { void runTransfer('confirm'); },
      // A retained command goes straight to exact confirmation recovery; a proposal
      // with a lost response is recovered and reviewed before first confirmation.
      retry: () => { void runTransfer(transfer?.confirmRequested && transferUncertain ? (available() ? 'confirm' : 'recover') : 'propose'); },
      cancel: () => {
        if (transferUncertain || inFlight) {
          transferDismissed = true;
          setTransferDraft(false); setTransferProposal(null); setTransferRecovery(true);
          queueMicrotask(() => region.current?.focus()); return;
        }
        if (transfer) {
          try { clearControlTransfer(sessionStorage, transfer); transfer = null; }
          catch { transferUnknown(); return; }
        }
        setTransferDraft(false); setTransferProposal(null); setTransferRefusal(null); void refresh(); queueMicrotask(() => region.current?.focus());
      },
    };
    actions.current = { refresh: () => { void refresh(); },
      observe: () => { void refresh(); },
      renew: () => { void renew(); }, change: operation => { void change(operation); } };
    const settled = (event: Event) => {
      const detail = (event as CustomEvent<{ runId: string; definite: boolean }>).detail;
      if (closed || inFlight || detail.runId !== runId) return;
      setBusy(false); setHung(false);
      try {
        pending = pendingControlRenewal(sessionStorage, runId);
        transfer = actorId === null ? null : pendingControlTransfer(sessionStorage, runId, actorId);
      }
      catch { storageFailed = true; invalidate(); return; }
      if (transfer) { transferUnknown(); }
      else if (pending) unknownRenewal();
      else if (!detail.definite) { uncertainChange = true; invalidate(); setUnknown(true); }
      else { transferUncertain = false; setTransferRecovery(false); setTransferProposal(null); setTransferRefusal(null); setUnknown(false); setRetryable(false); void refresh(); }
    };
    window.addEventListener(CONTROL_SETTLED, settled);
    const visibility = () => { invalidate(); void refresh(); };
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => { void renew(); }, 30_000);
    return () => {
      closed = true; generation += 1; window.clearInterval(timer); window.clearTimeout(expiryTimer);
      for (const pendingTimer of timers) window.clearTimeout(pendingTimer);
      for (const controller of reads) controller.abort();
      reads.clear();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener(CONTROL_SETTLED, settled);
      latest.current.onRead(null); latest.current.shared?.publish(null);
    };
  }, [runId]);
  // Exactly one initial read; incidental projection renders do not restart the cadence.
  useEffect(() => { actions.current.observe(); }, [refreshKey, gate.disabledReason]);

  if (read?.status === 'ready' && !read.required) return <></>;
  return <section ref={region} tabIndex={-1} aria-label="Run controller" className="ls-stack run-controller" data-control-ready={read?.status === 'ready'}>
    {read === null || read.status === 'checking' ? <><p>Checking current Run control…</p>{!busy && <Button variant="secondary" onClick={() => actions.current.refresh()}>Refresh control</Button>}</> : read.status !== 'ready'
      ? <><p>Run control is unavailable. Refresh before confirming steering or Resume.</p>
        {!unknown && <Button variant="secondary" onClick={() => actions.current.refresh()}>Refresh control</Button>}</>
      : !read.active ? <p>This Run has finished. Execution control is unavailable.</p>
      : <>
        <p>{read.heldByYou ? 'You control this Run.' : read.holderName === null ? 'No auditor currently holds control.' : `Current controller: ${read.holderName}.`}</p>
        {read.heldByYou ? <>
          <details><summary>Lease details</summary><p className="ls-caption">Your lease renews while this view is connected and visible.</p></details>
          <Button variant="secondary" busy={busy} onClick={() => actions.current.change('release')}
            {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>Release control</Button>
        </> : <Button variant="secondary" busy={busy} onClick={() => actions.current.change('acquire')}
          {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason }
            : read.holderName !== null ? { disabledReason: 'The current controller must release control or let the lease expire.' } : {})}>Acquire control</Button>}
        {read.transferEligible && !read.heldByYou && read.holderName !== null && <Button variant="secondary" busy={busy}
          onClick={() => { setTransferRefusal(null); setTransferDraft(true); }}
          {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>Transfer control to me</Button>}
      </>}
    <ConfirmDialog open={transferDraft} weight="routine-with-rationale" title="Request Run control transfer?"
      consequence={`Provide a reason to review transferring control from ${read?.status === 'ready' ? read.holderName : 'the current controller'} to ${read?.status === 'ready' ? read.actorName : 'you'}. No control changes until you confirm the review.`}
      confirmLabel="Review transfer" busy={busy} refusal={transferRefusal} refusalRevision={transferAttempt}
      onConfirm={value => transferActions.current.propose(value ?? '')} onCancel={() => transferActions.current.cancel()} />
    <ConfirmDialog open={transferProposal !== null} weight="routine" title="Transfer Run control?"
      consequence={transferProposal ? `${transferProposal.actorName} will take control from ${transferProposal.priorHolderName}. The controller epoch advances from ${transferProposal.expectedEpoch} to ${transferProposal.expectedEpoch + 1}; outstanding discretionary directions tied to the old epoch can no longer be confirmed. Accepted Pause and Stop requests remain in effect. Open questions, answers, approvals, reviews and Results are unchanged.` : ''}
      confirmLabel={transferRecovery ? 'Retry same confirmation' : 'Confirm transfer'} busy={busy && !hung} refusal={transferRefusal}
      keepOpenOnGateClose={transferRecovery} disabledReason={gate.disabledReason}
      onConfirm={() => transferActions.current.confirm()} onCancel={() => transferActions.current.cancel()}>
      {transferProposal && <div className="run-control-transfer-source" role="region" aria-label="Transfer reason source" tabIndex={0}><UntrustedText field={`transfer reason supplied by ${transferProposal.actorName}`}>{transferProposal.reason}</UntrustedText></div>}
    </ConfirmDialog>
    {transferRecovery && transferProposal === null && <Button variant="secondary" busy={busy} onClick={() => transferActions.current.retry()}
      >Recover transfer request</Button>}
    {transferRefusal !== null && transferProposal === null && !transferDraft && <p role="status">{transferRefusal}</p>}
    {reason !== null && <p role="status">{reason}</p>}
    {readReason !== null && <p role="status">{readReason}</p>}
    {retryable && <Button variant="secondary" busy={busy} onClick={() => actions.current.renew()}
      {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>Retry renewal</Button>}
    {(hung || (unknown && !retryable)) && <a href={`/runs/${runId}/workspace`}>Reload this Run</a>}
  </section>;
}
