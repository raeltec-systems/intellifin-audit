'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { newVersionAction } from '../../app/procedures/version-actions';
import { Button } from '../design/Button';

/**
 * Start a new Draft from an ACTIVE Procedure Version.
 *
 * The Active version is frozen: this never edits it. `newProcedureVersion` copies its
 * definition into a fresh Draft and leaves the Active row untouched, which is why the
 * label says "new version" and the surrounding panel says what happens — an affordance
 * whose consequence a person has to guess is one they do not use.
 *
 * `aria-disabled`, never `disabled`, through the design `Button`: a `disabled` element
 * cannot be focused, so its reason is unreachable by keyboard.
 */
export function NewVersionButton(props: { procedureId: string; versionId: string; expectedRowVersion: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState('');
  const router = useRouter();
  return <div className="ls-stack"><Button variant="secondary" size="md" busy={busy} onClick={async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await newVersionAction(props);
      if (result.ok) router.push(`/procedures/${props.procedureId}/builder?version=${result.versionId}`);
      else { setReason(result.reason); if (!result.unknownOutcome) { busyRef.current = false; setBusy(false); } }
    } catch { setReason('The result could not be confirmed. Reload the page before creating another version.'); }
  }}>New version</Button>{reason && <p role="alert">{reason}</p>}</div>;
}
