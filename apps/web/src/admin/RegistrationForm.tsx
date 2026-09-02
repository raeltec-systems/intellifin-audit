'use client';

import { useId, useRef, useState, type FormEvent } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { registrationChangeWarning } from '../design/copy';
import {
  ACTION_OPTIONS,
  KIND_OPTIONS,
  STATUS_OPTIONS,
  linesToList,
  listToLines,
} from './registrations';
import type {
  ChangeRegistrationFormFields,
  RegistrationActionResult,
  RegistrationFormFields,
} from '../../app/administration/registrations/actions';

/**
 * The Target System registration form, used to register and to change (FR-8).
 *
 * Two things it deliberately does not do.
 *
 * It does not collect a secret. The credential field holds an opaque REFERENCE — the
 * name of a credential somebody else issued — and the capability check that decides
 * whether it may be used happens on the server through a port that cannot return a
 * secret. There is no password field here and there must never be one: a secret typed
 * into this browser would be a secret in the web process, which FR-8 forbids outright.
 *
 * It does not decide anything. The kind decides which locator field is shown, and the
 * checkboxes offer only read actions, but neither is the control: the Server Action
 * authorizes, re-validates the vocabulary and refuses a write-capable credential on the
 * server, whatever this form sends.
 *
 * The confirmation names the consequence that matters, and — once Procedures exist —
 * how many of them a change would mint a platform-authored draft for. That count comes
 * from a port and is 0 in this release, so the sentence does not render: "a draft for 0
 * Procedures" is a sentence that cannot be true.
 */

export interface RegistrationFormProps {
  /** `null` registers a new system; a registration edits that one. */
  readonly registration: TargetSystemRegistration | null;
  /**
   * The version of the row this form is editing, computed on the SERVER by
   * `registrationRowVersion`. Empty when creating.
   *
   * It is a prop rather than something this component derives, so the browser never
   * needs the hashing code and there is exactly one implementation of the token — the
   * command compares against the same function.
   */
  readonly rowVersion: string;
  /** How many Procedure Versions reference it. 0 until Epic 2 exists. */
  readonly referencingProcedures: number;
  readonly onCreate?: (fields: RegistrationFormFields) => Promise<RegistrationActionResult>;
  readonly onChange?: (
    fields: ChangeRegistrationFormFields,
  ) => Promise<RegistrationActionResult>;
  readonly onResult: (result: RegistrationActionResult) => void;
  /** Called before the action runs, so the surface can clear a stale banner. */
  readonly onStart: () => void;
}

const FIRST_KIND = KIND_OPTIONS[0]?.value ?? 'web';

export function RegistrationForm({
  registration,
  rowVersion,
  referencingProcedures,
  onCreate,
  onChange,
  onResult,
  onStart,
}: RegistrationFormProps): React.JSX.Element {
  const editing = registration !== null;

  const nameId = useId();
  const kindId = useId();
  const originsId = useId();
  const identityId = useId();
  const credentialId = useId();
  const actionsId = useId();
  const patternsId = useId();
  const secondaryId = useId();
  const noteId = useId();
  const statusId = useId();

  const [displayName, setDisplayName] = useState(registration?.displayName ?? '');
  const [kind, setKind] = useState<string>(registration?.kind ?? FIRST_KIND);
  const [origins, setOrigins] = useState(listToLines(registration?.allowedOrigins ?? []));
  const [applicationIdentity, setApplicationIdentity] = useState(
    registration?.applicationIdentity ?? '',
  );
  const [credentialRef, setCredentialRef] = useState(registration?.credentialRef ?? '');
  const [actions, setActions] = useState<readonly string[]>(registration?.permittedActions ?? []);
  const [patterns, setPatterns] = useState(
    listToLines(registration?.attributeLabelPatterns ?? []),
  );
  const [secondaryKey, setSecondaryKey] = useState(registration?.secondaryKey ?? '');
  const [note, setNote] = useState(registration?.note ?? '');
  const [status, setStatus] = useState<string>(registration?.status ?? 'active');

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `sign-in-form.tsx`. */
  const submittingRef = useRef(false);

  function toggleAction(value: string, checked: boolean): void {
    setActions((current) =>
      checked ? [...new Set([...current, value])] : current.filter((entry) => entry !== value),
    );
  }

  function onRequestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;
    setConfirming(true);
  }

  function fields(): RegistrationFormFields {
    return {
      displayName,
      kind,
      // A desktop system has an application identity and no origins; every other kind is
      // the other way round. Sending both would put a value the person cannot see on this
      // form into the digest.
      allowedOrigins: kind === 'desktop' ? [] : linesToList(origins),
      applicationIdentity: kind === 'desktop' ? applicationIdentity : '',
      credentialRef,
      permittedActions: actions,
      attributeLabelPatterns: linesToList(patterns),
      secondaryKey,
      note,
      status,
    };
  }

  async function onConfirm(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    onStart();
    try {
      const result =
        editing && onChange
          ? await onChange({
              ...fields(),
              registrationId: registration.registrationId,
              expectedRowVersion: rowVersion,
            })
          : onCreate
            ? await onCreate(fields())
            : { ok: false as const, reason: 'This form is not wired to an action.' };
      onResult(result);
      if (result.ok && !editing) {
        setDisplayName('');
        setOrigins('');
        setApplicationIdentity('');
        setCredentialRef('');
        setActions([]);
        setPatterns('');
        setSecondaryKey('');
        setNote('');
        setKind(FIRST_KIND);
      }
    } catch {
      // A rejected Server Action — a network drop, a deploy mid-request, a framework
      // error — must not end as a stopped spinner and no message. Silence after a
      // mutating action reads as success, which is the defect the sign-out control was
      // shipped with.
      onResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  // The dialog names the system it is about. A confirmation that says only "this
  // registration" is one a person cannot check against what they meant to change,
  // which is most of what a confirmation is for.
  const subject = displayName.trim() === '' ? 'this Target System' : displayName.trim();
  const consequence = editing
    ? `${subject} keeps its registration, changed. The agent may then read only what this registration allows. A change to the origin, application identity, credential reference, permitted actions, label patterns or secondary key recomputes the digest and is recorded in the audit chain against your name.`
    : `${subject} becomes a Target System the agent may reach. The agent may read only what this registration allows, using a credential that must be read-only. Registering it is recorded in the audit chain against your name.`;

  /**
   * Rendered only above zero. No Procedure exists in this release, so it does not
   * appear; the moment one does, this sentence is already here.
   */
  const referencesWarning =
    referencingProcedures > 0 ? ` ${registrationChangeWarning(referencingProcedures)}` : '';

  return (
    <>
      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: a `<form>` with no method submits as a GET, so a submission that
        beats hydration would put every field in the URL, in browser history and in
        every access log between here and the server. See `apps/web/src/form-method.test.ts`.
      */}
      <form className="ls-admin__form" method="post" onSubmit={onRequestSubmit}>
        <h2>{editing ? 'Change this registration' : 'Register a Target System'}</h2>
        <div className="ls-admin__fields">
          <div className="ls-dialog__field">
            <label htmlFor={nameId}>Display name</label>
            <input
              className="ls-input"
              id={nameId}
              name="displayName"
              type="text"
              autoComplete="off"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={kindId}>System kind</label>
            <select
              className="ls-select"
              id={kindId}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {kind === 'desktop' ? (
            <div className="ls-dialog__field">
              <label htmlFor={identityId}>Application identity</label>
              <input
                className="ls-input"
                id={identityId}
                name="applicationIdentity"
                type="text"
                autoComplete="off"
                required
                aria-describedby={`${identityId}-hint`}
                value={applicationIdentity}
                onChange={(event) => setApplicationIdentity(event.target.value)}
              />
              <p className="ls-caption" id={`${identityId}-hint`}>
                The application the agent may drive, for example
                <span className="ls-mono"> com.example.ledger</span>.
              </p>
            </div>
          ) : (
            <div className="ls-dialog__field">
              <label htmlFor={originsId}>Allowed origins</label>
              <textarea
                className="ls-textarea"
                id={originsId}
                name="allowedOrigins"
                rows={3}
                required
                aria-describedby={`${originsId}-hint`}
                value={origins}
                onChange={(event) => setOrigins(event.target.value)}
              />
              <p className="ls-caption" id={`${originsId}-hint`}>
                One per line. The agent may reach nothing outside this list.
              </p>
            </div>
          )}

          <div className="ls-dialog__field">
            <label htmlFor={credentialId}>Credential reference</label>
            <input
              className="ls-input"
              id={credentialId}
              name="credentialRef"
              type="text"
              autoComplete="off"
              required
              aria-describedby={`${credentialId}-hint`}
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
            />
            <p className="ls-caption" id={`${credentialId}-hint`}>
              A reference, never a secret. The secret stays outside this application and
              is never entered here. A reference whose capability check does not prove it
              read-only is refused.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={secondaryId}>Secondary key (optional)</label>
            <input
              className="ls-input"
              id={secondaryId}
              name="secondaryKey"
              type="text"
              autoComplete="off"
              value={secondaryKey}
              onChange={(event) => setSecondaryKey(event.target.value)}
            />
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={patternsId}>Expected attribute labels or locator patterns</label>
            <textarea
              className="ls-textarea"
              id={patternsId}
              name="attributeLabelPatterns"
              rows={3}
              aria-describedby={`${patternsId}-hint`}
              value={patterns}
              onChange={(event) => setPatterns(event.target.value)}
            />
            <p className="ls-caption" id={`${patternsId}-hint`}>
              One per line. Leave empty if none are expected.
            </p>
          </div>

          {editing ? (
            <div className="ls-dialog__field">
              <label htmlFor={statusId}>Status</label>
              <select
                className="ls-select"
                id={statusId}
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-describedby={`${statusId}-hint`}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="ls-caption" id={`${statusId}-hint`}>
                Retiring keeps the registration and its digest resolvable. There is no
                deletion: a Run that froze this digest must still be able to read it.
              </p>
            </div>
          ) : null}
        </div>

        <fieldset className="ls-admin__fieldset">
          <legend id={actionsId}>Permitted read actions</legend>
          <p className="ls-caption">
            Only read actions exist. There is no write action to choose, for any kind of
            system.
          </p>
          <div className="ls-checkbox-grid" role="group" aria-labelledby={actionsId}>
            {ACTION_OPTIONS.map((option) => (
              <label className="ls-checkbox" key={option.value}>
                <input
                  type="checkbox"
                  name="permittedActions"
                  value={option.value}
                  checked={actions.includes(option.value)}
                  onChange={(event) => toggleAction(option.value, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="ls-dialog__field">
          <label htmlFor={noteId}>Operator note (optional)</label>
          <textarea
            className="ls-textarea"
            id={noteId}
            name="note"
            rows={2}
            aria-describedby={`${noteId}-hint`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="ls-caption" id={`${noteId}-hint`}>
            Not part of the digest. Changing it alone affects no Procedure.
          </p>
        </div>

        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy}>
            {busy
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Register system'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title={editing ? 'Save this registration?' : 'Register this Target System?'}
        consequence={`${consequence}${referencesWarning}`}
        confirmLabel={editing ? 'Save changes' : 'Register system'}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
