'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { flagRunFormAction, type FlagRunActionResult } from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { FLAG_COPY } from '../design/copy';
import { useLiveGate } from './LiveGate';
import { utcStamp } from './labels';

/**
 * Flag a Run to the Audit Managers, from Live View (Story 5.5, FR-27, FR-28, UX-DR24).
 *
 * **No confirmation dialog, and that is the contract rather than an omission.**
 * EXPERIENCE.md's confirmation table enumerates the actions that get one — submit,
 * approve, rerun, export, pause, cancel, answer or abort an Escalation, a scope-expanding
 * Target Systems save — and flagging is not among them.
 *
 * Which makes this the one control on these surfaces that can honour the standing rule
 * that JavaScript may enhance a control and may never be the only path. The form's action
 * is the Server Action itself, so a browser with no script POSTs to it and gets the page
 * back with the flag recorded; `useActionState` renders the same result either way. Pause
 * and Cancel are exempt from that rule only because the dialog they must have cannot exist
 * without script — this control needs none, so it does not get the exemption.
 *
 * **It never says the Run changed.** A flag has no execution effect; the message says the
 * Audit Managers were told and that the Run carries on exactly as it was.
 */

export interface RunFlagView {
  readonly flagId: string;
  /** Already resolved to a person's name on the server; the id only when there is no row. */
  readonly flaggedBy: string;
  readonly flaggedAt: string;
  readonly note: string | null;
}

export interface RunFlagControlProps {
  readonly runId: string;
  /** Whether this Run's state allows a flag at all, decided by the domain on the server. */
  readonly flaggable: boolean;
  /** The flags already raised on this Run, newest first. */
  readonly flags: readonly RunFlagView[];
}

export function RunFlagControl({ runId, flaggable, flags }: RunFlagControlProps): React.JSX.Element {
  const router = useRouter();
  // Live View withdraws its controls when the channel is lost or the Run has ended
  // (Story 5.7). Outside that surface the gate is open and this is `null`.
  const gate = useLiveGate();
  const [state, formAction, pending] = useActionState<FlagRunActionResult | null, FormData>(flagRunFormAction, null);
  // The flag list is a SERVER read, so a successful flag has to make the page re-read for
  // the new entry to appear. Without script the POST already re-rendered it.
  useEffect(() => { if (state?.ok === true) router.refresh(); }, [state, router]);

  return <section id="run-flag" className="ls-card ls-stack" aria-labelledby="run-flag-heading">
    <h2 id="run-flag-heading">{FLAG_COPY.heading}</h2>
    <p>{FLAG_COPY.explanation}</p>
    {state === null ? null : state.ok
      ? <Banner tone="success" title={FLAG_COPY.raised}><p>{FLAG_COPY.raisedBody}</p></Banner>
      : <Banner tone="danger" title={state.reason ?? FLAG_COPY.unknown} />}
    {state?.unknownOutcome === true && <p><a href={`/runs/${runId}/live`}>Reload this Run</a></p>}
    {flaggable ? (
      <form method="POST" action={formAction} className="ls-stack">
        <input type="hidden" name="runId" value={runId} />
        <div className="ls-stack">
          <label htmlFor="run-flag-note">{FLAG_COPY.noteLabel}</label>
          <textarea
            className="ls-textarea"
            id="run-flag-note"
            name="note"
            rows={3}
            maxLength={500}
            aria-describedby="run-flag-note-help"
          />
          <p id="run-flag-note-help" className="ls-caption">{FLAG_COPY.noteHelp}</p>
        </div>
        <Button type="submit" variant="secondary" busy={pending}
          {...(gate.disabledReason !== null ? { disabledReason: gate.disabledReason } : {})}>{FLAG_COPY.submit}</Button>
      </form>
    ) : null}
    <h3>Flags on this Run</h3>
    {flags.length === 0 ? <p>{FLAG_COPY.none}</p> : (
      <ul className="ls-stack">
        {flags.map((item) => (
          <li key={item.flagId}>
            <p>{FLAG_COPY.by.replace('{actor}', item.flaggedBy).replace('{time}', utcStamp(item.flaggedAt))}</p>
            {item.note === null ? null : <p className="ls-quote">{item.note}</p>}
          </li>
        ))}
      </ul>
    )}
  </section>;
}
