'use client';

import { useCallback, useEffect, useState } from 'react';
import { changeRunControlAction, readRunControlAction, type RunControlReadActionResult } from '../../app/runs/control-actions';
import { Button } from '../design/Button';
import { useLiveGate } from './LiveGate';

/** Owns no execution state. Each command and renewal reauthorizes on the server. */
export function RunControllerLease({ runId, refreshKey, onRead }: {
  readonly runId: string;
  readonly refreshKey: string;
  readonly onRead: (value: RunControlReadActionResult | null) => void;
}): React.JSX.Element {
  const gate = useLiveGate();
  const [read, setRead] = useState<RunControlReadActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const refresh = useCallback(async () => {
    const next = await readRunControlAction(runId).catch(() => ({ status: 'unavailable' as const }));
    setRead(next); onRead(next);
  }, [runId, onRead]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || busy || unknown) return;
      if (read?.status === 'ready' && read.heldByYou && gate.disabledReason === null) {
        void changeRunControlAction('renew', { runId, expectedEpoch: read.epoch }).then(result => {
          if (!result.ok) {
            setReason(result.reason);
            if (result.unknownOutcome) setUnknown(true);
          }
          return refresh();
        }).catch(() => {
          setUnknown(true); setReason('Control renewal could not be confirmed. Reload this Run.');
          onRead({ status: 'unavailable' });
        });
      } else void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [runId, read, refresh, busy, unknown, gate.disabledReason, onRead]);

  async function change(operation: 'acquire' | 'release'): Promise<void> {
    if (read?.status !== 'ready' || busy || unknown || gate.disabledReason !== null) return;
    setBusy(true); setReason(null);
    try {
      const result = await changeRunControlAction(operation, { runId, expectedEpoch: read.epoch });
      if (!result.ok) { setReason(result.reason); if (result.unknownOutcome) setUnknown(true); }
      await refresh();
    } catch {
      setUnknown(true); setReason('The control request could not be confirmed. Reload this Run.');
      onRead({ status: 'unavailable' });
    } finally { setBusy(false); }
  }

  if (read?.status === 'ready' && !read.required) return <></>;
  return <section aria-label="Run controller" className="ls-stack" data-control-ready={read?.status === 'ready'}>
    {read === null ? <p>Checking Run control…</p> : read.status !== 'ready'
      ? <p>Run control is unavailable. Reload this Run before resuming.</p>
      : <>
        <p>{read.heldByYou ? 'You control this Run.' : read.holderName === null ? 'No auditor currently holds control.' : `Current controller: ${read.holderName}.`}</p>
        {read.heldByYou ? <>
          <p className="ls-text-caption">Your lease renews while this view is connected and visible.</p>
          <Button variant="secondary" busy={busy} onClick={() => { void change('release'); }}
            {...(unknown ? { disabledReason: 'Reload to check the recorded controller.' } : gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>Release control</Button>
        </> : <Button variant="secondary" busy={busy} onClick={() => { void change('acquire'); }}
          {...(unknown ? { disabledReason: 'Reload to check the recorded controller.' }
            : gate.disabledReason !== null ? { disabledReason: gate.disabledReason }
            : read.holderName !== null ? { disabledReason: 'The current controller must release control or let the lease expire.' }
            : !read.active ? { disabledReason: 'This Run has finished.' } : {})}>Acquire control</Button>}
      </>}
    {reason !== null && <p role="status">{reason}</p>}
    {unknown && <a href={`/runs/${runId}`}>Reload this Run</a>}
  </section>;
}
