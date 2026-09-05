'use client';

import Link from 'next/link';
import { Component, useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { initiateRunFormAction } from '../../app/runs/actions';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';

interface RunFormProps { readonly procedureId: string; readonly requestToken: string; readonly initialPeriod?: { readonly from: string; readonly to: string } | undefined }
export function InitiateRunForm(props: RunFormProps): React.JSX.Element {
  // A Server Action may render a fresh server seed while this request is unresolved.
  // Keep the mounted form's identity until a full navigation starts another request.
  const [requestToken] = useState(props.requestToken);
  const [submittedPeriod, setSubmittedPeriod] = useState(props.initialPeriod ?? { from: '', to: '' });
  const query = new URLSearchParams({ requestToken, ...submittedPeriod });
  return <RunSubmissionBoundary retryUrl={`/procedures/${props.procedureId}?${query.toString()}#initiate-run`}><RunForm {...props} requestToken={requestToken} onSubmitPeriod={setSubmittedPeriod} /></RunSubmissionBoundary>;
}

/** A dropped Server Action response is unknown even when the database committed. */
class RunSubmissionBoundary extends Component<{ retryUrl: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override render(): ReactNode {
    if (this.state.failed) return <Banner tone="danger" title="The Run could not be confirmed.">
      <p>Reload to retry this exact request. If the Run was saved, it will open even if execution has ended.</p>
      <a href={this.props.retryUrl} onClick={event => {
        event.preventDefault();
        const retryUrl = new URL(this.props.retryUrl, window.location.href).href;
        if (retryUrl === window.location.href) window.location.reload();
        else window.location.assign(retryUrl);
      }}>Reload Procedure</a>
    </Banner>;
    return this.props.children;
  }
}

function RunForm({ procedureId, requestToken, initialPeriod, onSubmitPeriod }: RunFormProps & { onSubmitPeriod: (period: { from: string; to: string }) => void }): React.JSX.Element {
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const [result, action, pending] = useActionState(initiateRunFormAction, null);
  const [confirming, setConfirming] = useState(false);
  const [period, setPeriod] = useState(initialPeriod ?? { from: '', to: '' });
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const id = useId();
  const uncertain = initialPeriod !== undefined || (result !== null && !result.ok && result.unknownOutcome === true);
  return <section id="initiate-run" data-client-ready={clientReady} className="ls-card ls-stack" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Initiate Run</h2>
    <p>The period selects the Active version that owns its start date. Both dates are included.</p>
    {result !== null && !result.ok && <div className="ls-stack">
      <Banner tone="danger" title={result.reason} />
      {result.existingRunId && <Link href={`/runs/${result.existingRunId}`}>Open existing Run</Link>}
    </div>}
    <form ref={form} method="POST" action={action} className="ls-admin__form" onSubmit={event => {
      if (pending) { event.preventDefault(); return; }
      if (confirmed.current) { confirmed.current = false; return; }
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const requestedPeriod = { from: String(data.get('from')), to: String(data.get('to')) };
      setPeriod(requestedPeriod);
      onSubmitPeriod(requestedPeriod);
      setConfirming(true);
    }}>
      <input type="hidden" name="procedureId" value={procedureId} />
      <input type="hidden" name="requestToken" value={requestToken} />
      <div className="ls-admin__fields">
        <div className="ls-dialog__field"><label htmlFor={`${id}-from`}>Period from</label><input className="ls-input" id={`${id}-from`} name="from" type="date" required readOnly={uncertain || pending} defaultValue={period.from} /></div>
        <div className="ls-dialog__field"><label htmlFor={`${id}-to`}>Period to</label><input className="ls-input" id={`${id}-to`} name="to" type="date" required readOnly={uncertain || pending} defaultValue={period.to} /></div>
      </div>
      <Button type="submit" variant="primary" busy={pending}>{pending ? 'Queuing…' : uncertain ? 'Retry same period' : 'Initiate Run'}</Button>
    </form>
    <ConfirmDialog open={confirming} weight="routine" title="Initiate this Run?" consequence={`Queue a Run for ${period.from} to ${period.to}. The saved Active version for this period is selected and initiation is recorded against your name.`} confirmLabel="Initiate Run" onCancel={() => setConfirming(false)} onConfirm={() => {
      setConfirming(false); confirmed.current = true; form.current?.requestSubmit();
    }} />
  </section>;
}
