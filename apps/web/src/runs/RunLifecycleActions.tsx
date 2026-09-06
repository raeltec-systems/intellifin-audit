'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cancelRunAction, rerunAction } from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { RUN_UNCHANGED_SENTENCE } from '../design/copy';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';

interface RunLifecycleActionsProps {
  readonly runId: string;
  /** Whether this Run is still active, decided by the domain on the server. */
  readonly active: boolean;
  /** Already asked for, so the worker still has to reach its next boundary. */
  readonly cancelPending: boolean;
  /** A fresh idempotency token, minted per page render exactly as initiation's is. */
  readonly requestToken: string;
  readonly procedureName: string;
}

/**
 * Cancel and Rerun on the Run Detail surface (Story 3.10).
 *
 * EXPERIENCE.md's Run Detail states put Cancel on Queued, Running, Paused and Awaiting
 * Auditor, and a Canceled, Inconclusive or Run Failed Run offers a new Run instead — so
 * exactly one of the two controls is on the surface at a time, decided by the Run state
 * the server read.
 *
 * Both are ROUTINE confirmations: EXPERIENCE.md's confirmation table lists rerun and
 * cancel under the weight that restates the consequence, so neither collects a rationale.
 *
 * One Banner for the surface, cleared on the next attempt and keyed by a counter: a stale
 * success sitting through the next attempt describes something that is no longer in front
 * of the person, and a live region whose text does not change is not re-announced, so two
 * identical failures would be silent after the first.
 */
export function RunLifecycleActions({ runId, active, cancelPending, requestToken, procedureName }: RunLifecycleActionsProps): React.JSX.Element {
  const router = useRouter();
  // Both controls open a focus-trapping confirmation dialog, which EXPERIENCE.md requires
  // of every mutating action and which cannot exist without script — so, like the
  // administration mutations, they require JavaScript deliberately and fail SAFE: a click
  // before hydration does nothing and the Run is visibly unchanged. The marker says when
  // the handlers are attached, so a browser test proves hydration instead of racing it.
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; title: string; body?: string; runId?: string } | null>(null);
  // A lost Server Action response is an UNKNOWN outcome: the transaction may have
  // committed. Further attempts are blocked and a reload is what inspects what was saved.
  const [unknown, setUnknown] = useState(false);

  const cancel = async (): Promise<void> => {
    setBusy(true); setMessage(null); setAttempt(value => value + 1);
    try {
      const result = await cancelRunAction({ runId });
      if (!result.ok) {
        setMessage({ tone: 'danger', title: result.reason });
        if (result.unknownOutcome === true) setUnknown(true);
        return;
      }
      setMessage(result.pending
        ? { tone: 'success', title: 'Cancellation requested.', body: 'The Run stops at its next checkpoint, before any further Target System work. Evidence already collected is preserved.' }
        : { tone: 'success', title: 'Run canceled.', body: 'The Run will not execute. Evidence already collected is preserved.' });
      router.refresh();
    } catch {
      setUnknown(true);
      setMessage({ tone: 'danger', title: 'The cancellation could not be confirmed. Reload the Run to see whether it was canceled.' });
    } finally { setBusy(false); setConfirming(false); }
  };

  const rerun = async (): Promise<void> => {
    setBusy(true); setMessage(null); setAttempt(value => value + 1);
    try {
      const result = await rerunAction({ predecessorRunId: runId, requestToken });
      if (!result.ok) {
        setMessage({ tone: 'danger', title: result.reason, ...(result.existingRunId ? { runId: result.existingRunId } : {}) });
        if (result.unknownOutcome === true) setUnknown(true);
        return;
      }
      setMessage({ tone: 'success', title: 'A new Run is queued.', body: RUN_UNCHANGED_SENTENCE, runId: result.runId });
    } catch {
      setUnknown(true);
      setMessage({ tone: 'danger', title: 'The rerun could not be confirmed. Reload the Run to see whether a new Run was queued.' });
    } finally { setBusy(false); setConfirming(false); }
  };

  return <section id="run-lifecycle" data-client-ready={clientReady} className="ls-card ls-stack" aria-labelledby="run-lifecycle-heading">
    <h2 id="run-lifecycle-heading">Run actions</h2>
    {message !== null && <div key={attempt} className="ls-stack">
      <Banner tone={message.tone} title={message.title}>{message.body ? <p>{message.body}</p> : null}</Banner>
      {message.runId && <a href={`/runs/${message.runId}`}>Open the linked Run</a>}
    </div>}
    {unknown && <p><a href={`/runs/${runId}`}>Reload this Run</a></p>}
    {active
      ? <Button variant="secondary" busy={busy} onClick={() => setConfirming(true)}
          {...(cancelPending ? { disabledReason: 'Cancellation is already requested. The Run stops at its next checkpoint.' } : unknown ? { disabledReason: 'The last response was lost. Reload this Run before trying again.' } : {})}>Cancel Run</Button>
      : <Button variant="secondary" busy={busy} onClick={() => setConfirming(true)}
          {...(unknown ? { disabledReason: 'The last response was lost. Reload this Run before trying again.' } : {})}>Rerun</Button>}
    <ConfirmDialog open={confirming} weight="routine"
      title={active ? 'Cancel this Run?' : 'Start a new Run?'}
      consequence={active
        ? `This stops the Run for ${procedureName}. Evidence already collected is preserved and no conclusion is issued. The cancellation is recorded against your name.`
        : `This queues a new Run for ${procedureName}, recording this Run as its predecessor. ${RUN_UNCHANGED_SENTENCE}`}
      confirmLabel={busy ? 'Saving…' : active ? 'Cancel Run' : 'Start the new Run'}
      cancelLabel="Go back"
      busy={busy}
      onCancel={() => { if (!busy) setConfirming(false); }}
      onConfirm={() => { void (active ? cancel() : rerun()); }} />
  </section>;
}
