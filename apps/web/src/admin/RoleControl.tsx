'use client';

import { useId, useRef, useState } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { ROLE_OPTIONS, roleLabelOfValue } from './roles';
import type { AdministrationActionResult, SetRoleFields } from '../../app/administration/actions';

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
 * Two changes are refused outright, because either one can lock the deployment out of
 * itself: changing your OWN role, and removing the last PoC Administrator. There is no
 * sign-up endpoint and no user deletion, so recovering from either needs shell access and
 * the seed script. The command refuses both — that is the control — and this component
 * states the reason on a disabled button, so nobody discovers it by being refused.
 *
 * The control is per row, so its label names the person: "Role for Dana Okoro" rather
 * than four selects all called "Role".
 */

export interface RoleControlProps {
  readonly userId: string;
  readonly userName: string;
  /** The role the row was rendered with. `null` is "No role". */
  readonly currentRole: string | null;
  /** True when this row is the signed-in administrator. Their own role is not theirs to change. */
  readonly isSelf: boolean;
  /** How many PoC Administrators the rendered list holds. One is the floor. */
  readonly administratorCount: number;
  readonly onSubmit: (fields: SetRoleFields) => Promise<AdministrationActionResult>;
  readonly onResult: (result: AdministrationActionResult) => void;
  /** Called before the action runs, so the surface can clear a stale banner. */
  readonly onStart: () => void;
}

const ADMINISTRATOR = 'poc-administrator';

/** Said when the command would refuse. The command still refuses; this is not the control. */
export const SELF_CHANGE_REASON =
  'You cannot change your own role. Ask another PoC Administrator to change it.';
export const LAST_ADMINISTRATOR_REASON =
  'This would leave no PoC Administrator. Give another user that role first.';

export function RoleControl({
  userId,
  userName,
  currentRole,
  isSelf,
  administratorCount,
  onSubmit,
  onResult,
  onStart,
}: RoleControlProps): React.JSX.Element {
  const selectId = useId();
  const rendered = currentRole ?? '';
  const [choice, setChoice] = useState<string>(rendered);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const unchanged = choice === rendered;
  const wouldRemoveLastAdministrator =
    currentRole === ADMINISTRATOR && choice !== ADMINISTRATOR && administratorCount <= 1;

  async function onConfirm(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    onStart();
    try {
      onResult(await onSubmit({ userId, role: choice, expectedRole: rendered }));
    } catch {
      // A rejected Server Action — a network drop, a deploy mid-request, a framework
      // error — must not end as a stopped spinner and no message. Silence after an
      // action reads as success, which is the exact defect the sign-out control was
      // shipped with; the person is told plainly that nothing changed.
      onResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  /** Why the control is unavailable, in the order the command applies its refusals. */
  const unavailableReason = isSelf
    ? SELF_CHANGE_REASON
    : wouldRemoveLastAdministrator
      ? LAST_ADMINISTRATOR_REASON
      : unchanged
        ? currentRole === null
          ? `${userName} holds no role, so there is nothing to change.`
          : `${userName} already holds this role.`
        : undefined;

  const consequence =
    choice === ''
      ? `${userName} keeps their account and their current session, and holds no action from their next request onward. Every refusal is audited.`
      : `${userName} is authorized as ${roleLabelOfValue(choice)} from their next request onward. Their current session is not ended.`;

  return (
    <div className="ls-role-control">
      <label className="ls-visually-hidden" htmlFor={selectId}>
        Role for {userName}
      </label>
      <select
        className="ls-select"
        id={selectId}
        value={choice}
        disabled={isSelf}
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
        disabledReason={unavailableReason}
      >
        {busy ? 'Saving…' : 'Change role'}
      </Button>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title={choice === '' ? 'Remove this role?' : 'Change this role?'}
        consequence={
          currentRole === ADMINISTRATOR
            ? `${consequence} One PoC Administrator must always remain: a change that would leave none is refused.`
            : consequence
        }
        confirmLabel={choice === '' ? 'Remove role' : 'Change role'}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
