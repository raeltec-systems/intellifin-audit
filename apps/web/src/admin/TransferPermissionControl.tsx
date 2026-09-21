'use client';

import { useRef, useState } from 'react';
import type { AdministrationActionResult, SetTransferGrantFields } from '../../app/administration/actions';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';

type Props = {
  readonly userId: string; readonly userName: string; readonly role: string | null;
  readonly grant: { readonly granted: boolean; readonly revision: number };
  readonly onSubmit: (input: SetTransferGrantFields) => Promise<AdministrationActionResult>;
  readonly onResult: (result: AdministrationActionResult) => void; readonly onStart: () => void;
};
export function TransferPermissionControl({ userId, userName, role, grant, onSubmit, onResult, onStart }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function confirm(): Promise<void> {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); onStart();
    try { onResult(await onSubmit({ userId, granted: !grant.granted, expectedGrantRevision: grant.revision })); }
    catch { onResult({ ok: false, reason: 'The permission change could not be confirmed. Refresh the user list before trying again.' }); }
    finally { submitting.current = false; setBusy(false); setOpen(false); }
  }
  if (role !== 'audit-manager' && !grant.granted) return <span>Unavailable for this role</span>;
  return <div className="ls-stack">
    <span>{grant.granted ? 'Granted' : 'Not granted'}</span>
    <Button variant="secondary" busy={busy} onClick={() => setOpen(true)}>{grant.granted ? 'Revoke transfer permission' : 'Grant transfer permission'}</Button>
    <ConfirmDialog open={open} busy={busy} weight="routine" title={grant.granted ? 'Revoke Run control transfer?' : 'Grant Run control transfer?'}
      consequence={grant.granted ? `${userName} will no longer be allowed to transfer another auditor’s live Run control.` : `${userName} may take another auditor’s live Run control after providing a reason and confirming the transfer. This grants no additional answer, approval or review permissions.`}
      confirmLabel={grant.granted ? 'Revoke permission' : 'Grant permission'} onCancel={() => { if (!busy) setOpen(false); }} onConfirm={() => { void confirm(); }} />
  </div>;
}
