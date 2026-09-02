'use client';

import { useId, useRef, useState } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { NO_ROLE_LABEL, ROLE_LABELS, ROLE_OPTIONS } from './roles';
import type { AdministrationActionResult } from '../../app/administration/actions';

/**
 * One user's role, changed in place (FR-2, AD-7).
 *
 * The select holds the three roles and "No role", which is the revocation: removing the
 * role is how access is taken away, because deleting the account would orphan every audit
 * event that names it.
 *
 * The confirmation states the two consequences that are easy to get wrong — the change
 * applies on the subject's NEXT request, and their current session is not ended. Both are
 * AD-7 behaviour and both surprise people who expect a role change to sign somebody out.
 *
 * The control is per row, so its label names the person: "Role for Dana Okoro" rather
 * than four selects all called "Role".
 */

export interface RoleControlProps {
  readonly userId: string;
  readonly userName: string;
  /** The role the row was rendered with. `null` is "No role". */
  readonly currentRole: string | null;
  readonly onSubmit: (fields: {
    userId: string;
    role: string;
  }) => Promise<AdministrationActionResult>;
  readonly onResult: (result: AdministrationActionResult) => void;
}

function labelFor(value: string): string {
  return value === '' ? NO_ROLE_LABEL : (ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value);
}

export function RoleControl({
  userId,
  userName,
  currentRole,
  onSubmit,
  onResult,
}: RoleControlProps): React.JSX.Element {
  const selectId = useId();
  const [choice, setChoice] = useState<string>(currentRole ?? '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const unchanged = choice === (currentRole ?? '');

  async function onConfirm(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    try {
      const result = await onSubmit({ userId, role: choice });
      onResult(result);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const consequence =
    choice === ''
      ? `${userName} keeps their account and their current session, and holds no action from their next request onward. Every refusal is audited.`
      : `${userName} is authorized as ${labelFor(choice)} from their next request onward. Their current session is not ended.`;

  return (
    <div className="ls-role-control">
      <label className="ls-visually-hidden" htmlFor={selectId}>
        Role for {userName}
      </label>
      <select
        className="ls-select"
        id={selectId}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
      >
        {ROLE_OPTIONS.map((option) => (
          <option key={option.value === '' ? 'none' : option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button
        onClick={() => setConfirming(true)}
        busy={busy}
        // Disabled with its reason stated, never silently: DESIGN.md's rule is that an
        // unavailable action keeps its position and says why.
        disabledReason={unchanged ? `${userName} already holds this role.` : undefined}
      >
        {busy ? 'Saving…' : 'Change role'}
      </Button>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title={choice === '' ? 'Remove this role?' : 'Change this role?'}
        consequence={consequence}
        confirmLabel={choice === '' ? 'Remove role' : 'Change role'}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
