'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { pauseRunAction, resumeRunAction } from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { ESCALATION_PANEL_COPY, PAUSE_COPY, RUN_LOST_RESPONSE } from '../design/copy';
import { UnavailableActions } from '../design/UnavailableActions';
import { useLiveGate } from './LiveGate';

/**
 * Pause and Resume, on Run Detail AND on Live View (Story 5.4).
 *
 * ONE implementation, because both surfaces carry the same control and two copies would
 * agree on every case anybody tried and diverge on the first one nobody did — here that
 * divergence would be one surface refusing a stale revision and the other not.
 *
 * **Pause is a ROUTINE confirmation; Resume is direct.** EXPERIENCE.md's confirmation
 * table lists pause and does NOT list resume: putting the Run back to work is the thing
 * the person paused it to be able to do, and it is undone by pausing again.
 *
 * **The success message never says the Run is paused.** The worker performs that
 * transition at its next Tool Action boundary, so what succeeded here is the REQUEST, and
 * saying otherwise would be the sign-out defect's shape — a control reporting an outcome
 * it did not produce.
 *
 * Like every mutating control in this product it needs a focus-trapping dialog, which
 * cannot exist without script, so it requires JavaScript deliberately and fails SAFE: a
 * click before hydration does nothing and the Run is visibly unchanged. `data-client-ready`
 * says when the handlers are attached, so a browser test proves hydration instead of
 * racing it.
 */

const ALREADY_REQUESTED = 'A pause is already requested. The Run holds at its next Tool Action.';

export interface RunPauseControlsProps {
  readonly runId: string;
  readonly procedureName: string;
  /** The Run is holding on a pause wait: Resume replaces Pause. */
  readonly paused: boolean;
  /** A pause is requested and no boundary has honoured it yet. */
  readonly pausePending: boolean;
  /** `AWAITING_AUDITOR`: Pause stays visible, disabled, with EXPERIENCE.md's own reason. */
  readonly awaitingAuditor: boolean;
  /** Whether a Pause control belongs on this surface at all (a Running Run has one). */
  readonly pausable: boolean;
  /**
   * The Run revision the server read, for the resume's compare-and-set.
   *
   * A resume with no revision is REFUSED rather than sent with a guessed one: the whole
   * point of the token is that it names the state the person was actually looking at.
   */
  readonly runRevision: number | null;
}

export function RunPauseControls({
  runId, procedureName, paused, pausePending, awaitingAuditor, pausable, runRevision,
}: RunPauseControlsProps): React.JSX.Element {
  const router = useRouter();
  // Live View withdraws its controls when the channel is lost or the Run has ended
  // (Story 5.7). Outside that surface the gate is open and this is `null`.
  const gate = useLiveGate();
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; title: string; body?: string } | null>(null);
  // A lost Server Action response is an UNKNOWN outcome: the transaction may have
  // committed. Further attempts are blocked and a reload is what inspects what was saved.
  const [unknown, setUnknown] = useState(false);

  const pause = async (): Promise<void> => {
    setBusy(true); setMessage(null); setAttempt(value => value + 1);
    try {
      const result = await pauseRunAction({ runId });
      if (!result.ok) {
        setMessage({ tone: 'danger', title: result.reason ?? PAUSE_COPY.unknown });
        if (result.unknownOutcome === true) setUnknown(true);
        return;
      }
      setMessage({ tone: 'success', title: PAUSE_COPY.requested, body: PAUSE_COPY.requestedBody });
      router.refresh();
    } catch {
      setUnknown(true);
      setMessage({ tone: 'danger', title: PAUSE_COPY.unknown });
    } finally { setBusy(false); setConfirming(false); }
  };

  const resume = async (): Promise<void> => {
    if (runRevision === null) { setMessage({ tone: 'danger', title: PAUSE_COPY.resumeUnknown }); return; }
    setBusy(true); setMessage(null); setAttempt(value => value + 1);
    try {
      const result = await resumeRunAction({ runId, expectedRunRevision: runRevision });
      if (!result.ok) {
        setMessage({ tone: 'danger', title: result.reason ?? PAUSE_COPY.resumeUnknown });
        if (result.unknownOutcome === true) setUnknown(true);
        return;
      }
      setMessage({ tone: 'success', title: PAUSE_COPY.resumed, body: PAUSE_COPY.resumedBody });
      router.refresh();
    } catch {
      setUnknown(true);
      setMessage({ tone: 'danger', title: PAUSE_COPY.resumeUnknown });
    } finally { setBusy(false); }
  };

  // Nothing to show at all: a Queued or terminal Run has no pause control and no pause.
  if (!paused && !pausable && !awaitingAuditor) return <></>;

  return <div id="run-pause" data-client-ready={clientReady} className="ls-stack">
    {message !== null && <div key={attempt}>
      <Banner tone={message.tone} title={message.title}>{message.body ? <p>{message.body}</p> : null}</Banner>
    </div>}
    {unknown && <p><a href={`/runs/${runId}`}>Reload this Run</a></p>}
    {awaitingAuditor ? <Button
      variant="secondary"
      disabledReason={ESCALATION_PANEL_COPY.pauseUnavailable}
      disabledReasonId="run-pause-unavailable"
    >Pause</Button> : null}
    {paused ? <Button variant="primary" busy={busy} onClick={() => { void resume(); }}
        {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason }
          : unknown ? { disabledReason: RUN_LOST_RESPONSE } : {})}>Resume</Button> : null}
    {pausable && !paused && !awaitingAuditor ? <Button variant="secondary" busy={busy} onClick={() => setConfirming(true)}
        {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason }
          : pausePending ? { disabledReason: ALREADY_REQUESTED }
          : unknown ? { disabledReason: RUN_LOST_RESPONSE } : {})}>Pause</Button> : null}
    <UnavailableActions actions={awaitingAuditor
      ? [{ id: 'run-pause-unavailable', label: 'Pause', reason: ESCALATION_PANEL_COPY.pauseUnavailable }]
      : []} headingLevel={3} />
    <ConfirmDialog open={confirming} weight="routine"
      title={PAUSE_COPY.confirmTitle}
      consequence={PAUSE_COPY.confirmConsequence.replace('{procedure}', procedureName)}
      confirmLabel={busy ? 'Saving…' : 'Pause Run'}
      cancelLabel="Go back"
      busy={busy}
      onCancel={() => { if (!busy) setConfirming(false); }}
      onConfirm={() => { void pause(); }} />
  </div>;
}
