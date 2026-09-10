'use client';
import {
  registrationDigest,
  type PermittedReadAction,
  type TargetSystemKind,
} from '@intellifin/domain';

import { useId, useRef, useState, type FormEvent } from 'react';

import type { TargetSystemRegistration } from '@intellifin/application';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { registrationChangeWarning } from '../design/copy';
import { FINGERPRINT_WORD, TARGET_KIND_WORDS } from '../design/plain-words';
import {
  ACTION_OPTIONS,
  KIND_OPTIONS,
  STATUS_OPTIONS,
  UNKNOWN_LABEL,
  linesToList,
  listToLines,
} from './registrations';
import type {
  ChangeRegistrationFormFields,
  RegistrationActionResult,
  RegistrationFormFields,
} from '../../app/administration/registrations/actions';

/**
 * The target system form, used to add a system and to change one (FR-8).
 *
 * **It is written for somebody who has never read this codebase.** The domain calls this
 * a Target System registration with allowed origins, permitted actions, attribute label
 * patterns and a registration digest; a person setting one up is answering four questions
 * — what is this system, where does the agent go, what may it do there, and which
 * credential does it use. The words come from `../design/plain-words`, and the long
 * explanation lives in a disclosure rather than above the controls where it has to be
 * read past.
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
 */

/**
 * The plain words for a stored kind.
 *
 * Typed against the DOMAIN vocabulary, so a kind added there fails to compile here rather
 * than reaching a reader as its own identifier. The lookup is `Object.hasOwn`-guarded
 * because the value arrives from a `<select>` or from a row somebody else wrote, and a
 * plain index would return `Object.prototype.toString` for the key `toString`.
 */
export function targetKindWord(kind: string): string {
  return Object.hasOwn(TARGET_KIND_WORDS, kind)
    ? TARGET_KIND_WORDS[kind as TargetSystemKind]
    : UNKNOWN_LABEL;
}

/**
 * `2026-09-10T09:15:04.123Z` → `2026-09-10 09:15 UTC`.
 *
 * String slicing rather than `Date` arithmetic: the value is the ISO 8601 UTC string the
 * database produced, and a value that is not that shape degrades to a short prefix rather
 * than throwing on a page that is already rendering. Minutes are enough for "when did
 * somebody last touch this"; the `<time dateTime>` around it keeps the exact value.
 */
export function changedStamp(value: string): string {
  return `${value.replace('T', ' ').slice(0, 16)} UTC`;
}

/** How the agent reaches a system, and where the agent may go. Two labels, one for each kind. */
export const WEB_ADDRESSES_LABEL = 'Web addresses the agent may open';
export const APPLICATION_IDENTITY_LABEL = 'Application identity';

/** What retiring a system does, said plainly. Nothing is ever deleted. */
export const RETIRE_SYSTEM_SENTENCE =
  'Retiring stops new procedures using this system. Nothing is deleted, and past Runs stay readable.';

/** Why the credential field is safe to fill in. Stated wherever the field appears. */
export const CREDENTIAL_REFERENCE_SENTENCE =
  'The name of a credential kept outside this application, never the password itself.';

export interface RegistrationFormProps {
  /** `null` adds a new system; a registration edits that one. */
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
  /** How many Procedure Versions reference it. */
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
  const authenticationDestinationId = useId();
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
  const [authenticationDestination, setAuthenticationDestination] = useState(
    registration?.authenticationDestination ?? '',
  );
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

  /**
   * The rare fields start OPEN when changing an existing system and CLOSED when adding
   * one.
   *
   * Adding is a path to follow, so the short path is the whole form. Changing is a
   * review of what is already set up, and hiding half of it behind a control makes a
   * person check less than they came to check.
   */
  const [moreOpen, setMoreOpen] = useState(editing);

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
      ...(kind === 'web' && authenticationDestination.trim() !== ''
        ? { authenticationDestination }
        : {}),
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
              expectedAffectedProcedures: referencingProcedures,
            })
          : onCreate
            ? await onCreate(fields())
            : { ok: false as const, reason: 'This form is not wired to an action.' };
      onResult(result);
      if (result.ok && !editing) {
        setDisplayName('');
        setOrigins('');
        setAuthenticationDestination('');
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

  // The dialog names the system it is about. A confirmation that says only "this system"
  // is one a person cannot check against what they meant to change, which is most of what
  // a confirmation is for.
  const subject = displayName.trim() === '' ? 'This system' : displayName.trim();
  const consequence = editing
    ? `${subject} is changed. Changing where the agent may go, what it may do, which credential it uses, the field labels or the confirming field gives it a new ${FINGERPRINT_WORD.toLowerCase()}. The change is recorded against your name.`
    : `${subject} becomes a system the agent may read. The agent may only do what you ticked, and only at the addresses you listed, using a credential that must be read-only. Adding it is recorded against your name.`;

  /**
   * Rendered only above zero: "a draft for 0 Procedures" is a sentence that cannot be
   * true.
   */
  let changesConfiguration = false;
  try {
    changesConfiguration = registration !== null && registrationDigest({
      kind: kind as TargetSystemKind,
      allowedOrigins: linesToList(origins),
      applicationIdentity,
      credentialRef,
      permittedActions: actions as PermittedReadAction[],
      attributeLabelPatterns: linesToList(patterns),
      secondaryKey,
      ...(kind === 'web' && authenticationDestination.trim() !== ''
        ? { authenticationDestination }
        : {}),
    }) !== registration.digest;
  } catch { /* invalid fields are refused by the command */ }
  const referencesWarning =
    changesConfiguration && referencingProcedures > 0 ? ` ${registrationChangeWarning(referencingProcedures)}` : '';

  return (
    <>
      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: a `<form>` with no method submits as a GET, so a submission that
        beats hydration would put every field in the URL, in browser history and in
        every access log between here and the server. See `apps/web/src/form-method.test.ts`.
      */}
      <form className="ls-admin__form" method="post" onSubmit={onRequestSubmit}>
        <h2>{editing ? 'Change this system' : 'Add a target system'}</h2>
        <p className="ls-caption">
          A target system is somewhere the agent looks for evidence. It may only read, and
          only what you allow here.
        </p>

        <div className="ls-field-column">
          <div className="ls-dialog__field">
            <label htmlFor={nameId}>Display name</label>
            <input
              className="ls-input"
              id={nameId}
              name="displayName"
              type="text"
              autoComplete="off"
              required
              aria-describedby={`${nameId}-hint`}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <p className="ls-caption" id={`${nameId}-hint`}>
              What you will call this system when you pick it in a procedure.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={kindId}>What kind of system is it</label>
            <select
              className="ls-select"
              id={kindId}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              aria-describedby={`${kindId}-hint`}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {targetKindWord(option.value)}
                </option>
              ))}
            </select>
            <p className="ls-caption" id={`${kindId}-hint`}>
              How the agent reaches it. This decides what you have to give below.
            </p>
          </div>

          {kind === 'desktop' ? (
            <div className="ls-dialog__field">
              <label htmlFor={identityId}>{APPLICATION_IDENTITY_LABEL}</label>
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
                The one application the agent may drive, for example
                <span className="ls-mono"> com.example.ledger</span>.
              </p>
            </div>
          ) : (
            <div className="ls-dialog__field">
              <label htmlFor={originsId}>{WEB_ADDRESSES_LABEL}</label>
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
                One per line. The agent cannot open anything that is not on this list.
              </p>
            </div>
          )}

          {kind === 'web' ? (
            <div className="ls-dialog__field">
              <label htmlFor={authenticationDestinationId}>
                Exact address of the sign-in form (optional)
              </label>
              <input
                className="ls-input"
                id={authenticationDestinationId}
                name="authenticationDestination"
                type="url"
                autoComplete="off"
                aria-describedby={`${authenticationDestinationId}-hint`}
                value={authenticationDestination}
                onChange={(event) => setAuthenticationDestination(event.target.value)}
              />
              <p className="ls-caption" id={`${authenticationDestinationId}-hint`}>
                The exact address the sign-in form sends to. It must be inside the list
                above and carry no query string. Leave it empty if the agent never signs in
                here: it then refuses to enter a credential at all.
              </p>
            </div>
          ) : null}

          <div className="ls-dialog__field">
            <label htmlFor={credentialId}>Which stored credential to use</label>
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
              {CREDENTIAL_REFERENCE_SENTENCE} Never type a password here. A credential that
              cannot be shown to be read-only is refused.
            </p>
          </div>

          <fieldset className="ls-admin__fieldset">
            <legend id={actionsId}>What the agent may do here</legend>
            <p className="ls-caption">
              Tick everything the agent needs. Every choice here only reads: there is no
              option that changes anything in that system.
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
                {RETIRE_SYSTEM_SENTENCE}
              </p>
            </div>
          ) : null}
        </div>

        <details
          className="ls-disclosure"
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
        >
          <summary>More options</summary>
          <div className="ls-disclosure__body">
            <div className="ls-dialog__field">
              <label htmlFor={secondaryId}>A second field that confirms the record</label>
              <input
                className="ls-input"
                id={secondaryId}
                name="secondaryKey"
                type="text"
                autoComplete="off"
                aria-describedby={`${secondaryId}-hint`}
                value={secondaryKey}
                onChange={(event) => setSecondaryKey(event.target.value)}
              />
              <p className="ls-caption" id={`${secondaryId}-hint`}>
                The agent checks this beside the main identifier, to be sure it opened the
                right record. A full name beside an employee number, for example. It never
                replaces the main identifier.
              </p>
            </div>

            <div className="ls-dialog__field">
              <label htmlFor={patternsId}>Field labels the agent should look for</label>
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
                One per line, spelled as they appear on the screen. Leave it empty if you do
                not know them.
              </p>
            </div>

            <div className="ls-dialog__field">
              <label htmlFor={noteId}>Note for other operators</label>
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
                A reminder for whoever looks at this next. Changing it alone affects no
                procedure.
              </p>
            </div>
          </div>
        </details>

        <details className="ls-disclosure">
          <summary>Why this matters</summary>
          <div className="ls-disclosure__body">
            <p className="ls-caption">
              A procedure that uses this system keeps a copy of the settings above, so
              every Run can prove which setup it tested against. Change any of them and
              this system gets a new {FINGERPRINT_WORD.toLowerCase()}, which is how that
              copy can be told apart from the setup as it is today.
            </p>
            <p className="ls-caption">
              The addresses and the ticked actions are a wall, not a suggestion. During a
              Run the agent is refused anything outside them, and the refusal is recorded.
            </p>
            <p className="ls-caption">
              The credential is a name, not a secret. The secret itself is kept outside this
              application and is never shown here, never stored here, and never written into
              the audit trail. {RETIRE_SYSTEM_SENTENCE}
            </p>
          </div>
        </details>

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
        title={editing ? 'Save this system?' : 'Add this system?'}
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
