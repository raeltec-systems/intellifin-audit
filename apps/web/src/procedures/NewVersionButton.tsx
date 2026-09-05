'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { newVersionAction } from '../../app/procedures/version-actions';

export function NewVersionButton(props: { procedureId: string; versionId: string; expectedRowVersion: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState('');
  const router = useRouter();
  return <div><button className="ls-button ls-button--secondary ls-button--md" disabled={busy} onClick={async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await newVersionAction(props);
      if (result.ok) router.push(`/procedures/${props.procedureId}/builder?version=${result.versionId}`);
      else { setReason(result.reason); if (!result.unknownOutcome) { busyRef.current = false; setBusy(false); } }
    } catch { setReason('The result could not be confirmed. Reload the page before creating another version.'); }
  }}>New version</button>{reason && <p role="alert">{reason}</p>}</div>;
}
