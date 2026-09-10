'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cancelRunAction } from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';

/**
 * Cancel, on Run Detail AND on Live View (Story 5.5).
 *
 * ONE implementation, extracted from `RunLifecycleActions` for the reason
 * `RunPauseControls` was: both surfaces carry the same control, and two copies would agree
 * on every case anybody tried and diverge on the first one nobody did — here that would be
 * one surface blocking a retry after a lost response and the other not.
 *
 * Rerun stays on Run Detail. A terminal Run's Live View shows REPLAY and has nothing to
 * rerun from, and EXPERIENCE.md's session-viewer row lists Pause/Resume, Cancel and Flag
 * and no fourth control.
 *
 * Cancel is a ROUTINE confirmation — EXPERIENCE.md's table lists it — so it restates the
 * consequence and collects no rationale. Like every mutating control here it needs a
 * focus-trapping dialog, which cannot exist without script, so it requires JavaScript
 * deliberately and fails SAFE: a click before hydration does nothing and the Run is
 * visibly unchanged. `data-client-ready` says when the handlers are attached, so a browser
 * test proves hydration instead of racing it.
 */

const LOST_RESPONSE = 'The last response was lost. Reload this Run before trying again.';
const ALREADY_REQUESTED = 'Cancellation is already requested. The Run stops at its next checkpoint.';

export interface RunCancelControlProps {
  readonly runId: string;
  readonly procedureName: string;
  /** Whether this Run is still active, decided by the domain on the server. */
  readonly active: boolean;
  /** Already asked for, so the worker still has to reach its next boundary. */
  readonly cancelPending: boolean;
}

export function RunCancelControl({ runId, procedureName, active, cancelPending }: RunCancelControlProps): React.JSX.Element {
  const router = useRouter();
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; title: string; body?: string } | null>(null);
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

  if (!active) return <></>;

  return <div id="run-cancel" data-client-ready={clientReady} className="ls-stack">
    {message !== null && <div key={attempt}>
      <Banner tone={message.tone} title={message.title}>{message.body ? <p>{message.body}</p> : null}</Banner>
    </div>}
    {unknown && <p><a href={`/runs/${runId}`}>Reload this Run</a></p>}
    <Button variant="secondary" busy={busy} onClick={() => setConfirming(true)}
      {...(cancelPending ? { disabledReason: ALREADY_REQUESTED } : unknown ? { disabledReason: LOST_RESPONSE } : {})}>Cancel Run</Button>
    <ConfirmDialog open={confirming} weight="routine"
      title="Cancel this Run?"
      consequence={`This stops the Run for ${procedureName}. Evidence already collected is preserved and no conclusion is issued. The cancellation is recorded against your name.`}
      confirmLabel={busy ? 'Saving…' : 'Cancel Run'}
      cancelLabel="Go back"
      busy={busy}
      onCancel={() => { if (!busy) setConfirming(false); }}
      onConfirm={() => { void cancel(); }} />
  </div>;
}
