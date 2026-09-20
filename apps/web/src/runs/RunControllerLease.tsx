'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { changeRunControlAction, type RunControlReadActionResult } from '../../app/runs/control-actions';
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
const activeControlMutations = new Map<string, 'renew' | 'acquire' | 'release'>();
const CONTROL_SETTLED = 'intellifin-control-settled';
const REQUEST_DEADLINE_MS = 15_000;
type Props = { readonly runId: string; readonly refreshKey: string; readonly onRead?: (value: RunControlView) => void };

export function RunControllerLease(props: Props): React.JSX.Element {
  return <ControllerLease key={props.runId} {...props} />;
}
function ControllerLease({ runId, refreshKey, onRead = ignoreRead }: Props): React.JSX.Element {
  const gate = useLiveGate();
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
      if (!available()) { invalidate(); return; }
      // No read can republish authority until every mutation has a definite outcome.
      if (inFlight || activeControlMutations.has(runId)) return;
      if (uncertainChange || pending !== null || storageFailed) { invalidate(); return; }
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
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || pending !== null) { invalidate(); return; }
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
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || storageFailed) return;
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
      if (!available() || inFlight || activeControlMutations.has(runId) || uncertainChange || pending !== null || presentation?.status !== 'ready' || !confirmed) return;
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
    actions.current = { refresh: () => { void refresh(); },
      observe: () => { if (!available()) invalidate(); else void refresh(); },
      renew: () => { void renew(); }, change: operation => { void change(operation); } };
    const settled = (event: Event) => {
      const detail = (event as CustomEvent<{ runId: string; definite: boolean }>).detail;
      if (closed || inFlight || detail.runId !== runId) return;
      setBusy(false); setHung(false);
      try { pending = pendingControlRenewal(sessionStorage, runId); }
      catch { storageFailed = true; invalidate(); return; }
      if (pending) unknownRenewal();
      else if (!detail.definite) { uncertainChange = true; invalidate(); setUnknown(true); }
      else { setUnknown(false); setRetryable(false); void refresh(); }
    };
    window.addEventListener(CONTROL_SETTLED, settled);
    const visibility = () => { invalidate(); if (available()) void refresh(); };
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
  return <section aria-label="Run controller" className="ls-stack run-controller" data-control-ready={read?.status === 'ready'}>
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
      </>}
    {reason !== null && <p role="status">{reason}</p>}
    {readReason !== null && <p role="status">{readReason}</p>}
    {retryable && <Button variant="secondary" busy={busy} onClick={() => actions.current.renew()}
      {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>Retry renewal</Button>}
    {(hung || (unknown && !retryable)) && <a href={`/runs/${runId}/workspace`}>Reload this Run</a>}
  </section>;
}
