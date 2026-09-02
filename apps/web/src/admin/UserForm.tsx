'use client';

import { useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { ASSIGNABLE_ROLE_OPTIONS, roleLabelOfValue } from './roles';
import type { AdministrationActionResult, CreateUserFields } from '../../app/administration/actions';

/**
 * Create a user (FR-2, FR-7).
 *
 * The form collects an address, a name, a password and a role, and confirms through the
 * routine dialog before it submits — EXPERIENCE.md makes every mutating action a
 * confirmation, and this one states the consequence that matters: the account can sign
 * in immediately and holds the role from its first request.
 *
 * The password is typed here and posted once. It is never put in a URL, never written to
 * a query string, never echoed back, and the field is cleared on success. The form does
 * NOT restate it in the confirmation dialog, which would put a credential on screen a
 * second time for no gain.
 *
 * Reporting is the caller's job: `onResult` hands the outcome to the surface, which shows
 * one Banner. Two independent banners on one surface is two live regions competing to
 * announce.
 */

export interface UserFormProps {
  /** The Server Action. It authorizes on the server before it reads any of this. */
  readonly onSubmit: (fields: CreateUserFields) => Promise<AdministrationActionResult>;
  readonly onResult: (result: AdministrationActionResult) => void;
  /** Called before the action runs, so the surface can clear a stale banner. */
  readonly onStart: () => void;
}

const FIRST_ROLE = ASSIGNABLE_ROLE_OPTIONS[0]?.value ?? 'auditor';

export function UserForm({ onSubmit, onResult, onStart }: UserFormProps): React.JSX.Element {
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const roleId = useId();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>(FIRST_ROLE);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `sign-in-form.tsx`. */
  const submittingRef = useRef(false);

  function onRequestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;
    setConfirming(true);
  }

  async function onConfirm(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    onStart();
    try {
      const result = await onSubmit({ email, name, password, role });
      onResult(result);
      if (result.ok) {
        setEmail('');
        setName('');
        // Cleared first, and always: a credential must not sit in a form field after it
        // has been used, where the next person at a shared workstation can reveal it.
        setPassword('');
        setRole(FIRST_ROLE);
      }
    } catch {
      // A rejected Server Action — a network drop, a deploy mid-request, a framework
      // error — must not end as a stopped spinner and no message. Silence after a
      // mutating action reads as success, which is the defect the sign-out control was
      // shipped with. The password field is deliberately NOT cleared here: nothing was
      // created, so the person can confirm again without retyping a credential.
      onResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const roleName = roleLabelOfValue(role);

  return (
    <>
      {/*
        `method="post"` matters even though the submit handler always prevents the native
        submission. A `<form>` with no method submits as a GET, so a submission that
        happens BEFORE this component hydrates — a click, or Enter in any field — would
        put the initial password in the URL, in browser history, and in every server
        access log. This story's own constraint is that no password is ever placed in a
        URL. A POST to `/administration` has no handler and answers 405, which changes
        nothing and discloses nothing. `sign-in-form.tsx` carries the same guard for the
        same reason.

        This control cannot be made to work without JavaScript: EXPERIENCE.md requires a
        focus-trapping confirmation dialog on every administration mutation, and a dialog
        is script. So the requirement here is the weaker one — that a pre-hydration
        submission be SAFE and visibly do nothing, rather than quietly leak a credential.
      */}
      <form className="ls-admin__form" method="post" onSubmit={onRequestSubmit}>
        <h2>Add a user</h2>
        <div className="ls-admin__fields">
          <div className="ls-dialog__field">
            <label htmlFor={emailId}>Email address</label>
            <input
              className="ls-input"
              id={emailId}
              name="email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={nameId}>Full name</label>
            <input
              className="ls-input"
              id={nameId}
              name="name"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={passwordId}>Initial password</label>
            <input
              className="ls-input"
              id={passwordId}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              aria-describedby={`${passwordId}-hint`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="ls-caption" id={`${passwordId}-hint`}>
              At least 12 characters. Give it to the person directly; this deployment
              sends no email.
            </p>
          </div>
          <div className="ls-dialog__field">
            <label htmlFor={roleId}>Role</label>
            <select
              className="ls-select"
              id={roleId}
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Create this user?"
        consequence={`The account can sign in immediately and holds the ${roleName} role from its first request. Creating it is recorded in the audit chain against your name.`}
        confirmLabel="Create user"
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
