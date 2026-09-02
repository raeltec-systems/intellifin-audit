'use client';

import { useId, useRef, useState, type FormEvent } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { DECLARED_COUNT_MISSING_SENTENCE, registrationChangeWarning } from '../design/copy';
import {
  BINDING_KIND_OPTIONS,
  BINDING_STATUS_OPTIONS,
  MECHANISM_OPTIONS,
  UPLOAD_ONLY_SENTENCE,
  declaresNoCount,
  linesToList,
  listToLines,
} from './bindings';
import type {
  BindingActionResult,
  BindingFormFields,
  ChangeBindingFormFields,
} from '../../app/administration/sources/actions';

/**
 * The Population Source binding form, used to register and to change (FR-6, FR-41).
 *
 * Three things it deliberately does not do.
 *
 * It has NO FILE INPUT, for any kind, including `manual-upload`. This surface registers a
 * BINDING: where a population comes from and what shape it is declared to have. The file
 * itself arrives with a Run, is parsed by a platform Adapter, and is captured as Evidence
 * — none of which exists yet and none of which belongs to the web process.
 *
 * It collects no credential. A `read-only-api` binding names a location and nothing else;
 * the credential a Run uses comes from the Target System registration, which already
 * proved it read-only. A credential field here would be a second place a reference lives
 * and a second place that proof would have to be repeated.
 *
 * It does not decide anything. The kind decides whether a location field is shown and the
 * `<select>`s offer only known values, but neither is the control: the Server Action
 * authorizes, re-validates every vocabulary and re-applies the sensitive-field rule on
 * the server, whatever this form sends.
 *
 * The confirmation names the consequence that matters, and — once Procedures exist — how
 * many of them a change would mint a platform-authored draft for. That count comes from a
 * port and is 0 in this release, so the sentence does not render: "a draft for 0
 * Procedures" is a sentence that cannot be true.
 */

export interface BindingFormProps {
  /** `null` registers a new binding; a binding edits that one. */
  readonly binding: PopulationSourceBinding | null;
  /**
   * The version of the row this form is editing, computed on the SERVER by
   * `bindingRowVersion`. Empty when creating.
   *
   * It is a prop rather than something this component derives, so the browser never needs
   * the hashing code and there is exactly one implementation of the token — the command
   * compares against the same function.
   */
  readonly rowVersion: string;
  /** How many Procedure Versions reference it. 0 until Epic 2 exists. */
  readonly referencingProcedures: number;
  readonly onCreate?: (fields: BindingFormFields) => Promise<BindingActionResult>;
  readonly onChange?: (fields: ChangeBindingFormFields) => Promise<BindingActionResult>;
  readonly onResult: (result: BindingActionResult) => void;
  /** Called before the action runs, so the surface can clear a stale banner. */
  readonly onStart: () => void;
}

const FIRST_KIND = BINDING_KIND_OPTIONS[0]?.value ?? 'manual-upload';
const FIRST_MECHANISM = MECHANISM_OPTIONS[0]?.value ?? 'cover-sheet';

export function BindingForm({
  binding,
  rowVersion,
  referencingProcedures,
  onCreate,
  onChange,
  onResult,
  onStart,
}: BindingFormProps): React.JSX.Element {
  const editing = binding !== null;

  const nameId = useId();
  const kindId = useId();
  const locationId = useId();
  const schemaId = useId();
  const mechanismId = useId();
  const sensitiveId = useId();
  const noteId = useId();
  const statusId = useId();

  const [displayName, setDisplayName] = useState(binding?.displayName ?? '');
  const [kind, setKind] = useState<string>(binding?.kind ?? FIRST_KIND);
  const [location, setLocation] = useState(binding?.location ?? '');
  const [schema, setSchema] = useState(listToLines(binding?.declaredSchema ?? []));
  const [mechanism, setMechanism] = useState<string>(
    binding?.declaredCountMechanism ?? FIRST_MECHANISM,
  );
  const [sensitive, setSensitive] = useState(listToLines(binding?.sensitiveFields ?? []));
  const [note, setNote] = useState(binding?.note ?? '');
  const [status, setStatus] = useState<string>(binding?.status ?? 'active');

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `sign-in-form.tsx`. */
  const submittingRef = useRef(false);

  function onRequestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;
    setConfirming(true);
  }

  function fields(): BindingFormFields {
    return {
      displayName,
      kind,
      // A manual upload names nowhere: the file arrives with the Run. Sending a location
      // typed before the kind was switched would put a value the person can no longer see
      // into the row — and the digest deliberately drops it, so the two would disagree.
      location: kind === 'manual-upload' ? '' : location,
      declaredSchema: linesToList(schema),
      declaredCountMechanism: mechanism,
      sensitiveFields: linesToList(sensitive),
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
              bindingId: binding.bindingId,
              expectedRowVersion: rowVersion,
            })
          : onCreate
            ? await onCreate(fields())
            : { ok: false as const, reason: 'This form is not wired to an action.' };
      onResult(result);
      if (result.ok && !editing) {
        setDisplayName('');
        setLocation('');
        setSchema('');
        setSensitive('');
        setNote('');
        setKind(FIRST_KIND);
        setMechanism(FIRST_MECHANISM);
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

  // The dialog names the binding it is about. A confirmation that says only "this
  // binding" is one a person cannot check against what they meant to change, which is
  // most of what a confirmation is for.
  const subject = displayName.trim() === '' ? 'this Population Source' : displayName.trim();
  const consequence = editing
    ? `${subject} keeps its binding, changed. A change to the kind, the location, the declared schema, the declared-count mechanism or the sensitive fields recomputes the binding digest and is recorded in the audit chain against your name.`
    : `${subject} becomes a Population Source a Procedure can bind to. A Run acquires the population from it and reconciles the rows it read against the declared count. Registering it is recorded in the audit chain against your name.`;

  /**
   * Rendered only above zero. No Procedure exists in this release, so it does not appear;
   * the moment one does, this sentence is already here.
   */
  const referencesWarning =
    referencingProcedures > 0 ? ` ${registrationChangeWarning(referencingProcedures)}` : '';

  const missingCount = declaresNoCount(mechanism);
  const uploadOnly = kind === 'manual-upload';

  return (
    <>
      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: a `<form>` with no method submits as a GET, so a submission that beats
        hydration would put every field in the URL, in browser history and in every access
        log between here and the server. See `apps/web/src/form-method.test.ts`.
      */}
      <form className="ls-admin__form" method="post" onSubmit={onRequestSubmit}>
        <h2>{editing ? 'Change this binding' : 'Register a Population Source binding'}</h2>
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
            <label htmlFor={kindId}>Binding kind</label>
            <select
              className="ls-select"
              id={kindId}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {BINDING_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {uploadOnly ? null : (
            <div className="ls-dialog__field">
              <label htmlFor={locationId}>Location</label>
              <input
                className="ls-input"
                id={locationId}
                name="location"
                type="text"
                autoComplete="off"
                required
                aria-describedby={`${locationId}-hint`}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
              <p className="ls-caption" id={`${locationId}-hint`}>
                Where the population is found — a versioned file path or a read-only API
                endpoint. This page never reads it; a Run acquires it through a platform
                Adapter.
              </p>
            </div>
          )}

          <div className="ls-dialog__field">
            <label htmlFor={schemaId}>Declared schema</label>
            <textarea
              className="ls-textarea"
              id={schemaId}
              name="declaredSchema"
              rows={4}
              required
              aria-describedby={`${schemaId}-hint`}
              value={schema}
              onChange={(event) => setSchema(event.target.value)}
            />
            <p className="ls-caption" id={`${schemaId}-hint`}>
              One field name per line, in the order the source declares them. The order is
              part of the binding: reordering these lines changes the digest.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={mechanismId}>Declared-count mechanism</label>
            <select
              className="ls-select"
              id={mechanismId}
              name="declaredCountMechanism"
              value={mechanism}
              onChange={(event) => setMechanism(event.target.value)}
              aria-describedby={`${mechanismId}-hint`}
            >
              {MECHANISM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="ls-caption" id={`${mechanismId}-hint`}>
              How the expected record count is declared independently of this platform, so
              a Run can prove it read every record it should have.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={sensitiveId}>Sensitive fields (optional)</label>
            <textarea
              className="ls-textarea"
              id={sensitiveId}
              name="sensitiveFields"
              rows={3}
              aria-describedby={`${sensitiveId}-hint`}
              value={sensitive}
              onChange={(event) => setSensitive(event.target.value)}
            />
            <p className="ls-caption" id={`${sensitiveId}-hint`}>
              One per line, and each one must appear in the declared schema above. These
              values are masked in list views. A name that is not in the schema is refused:
              a mask over a field that does not exist hides nothing.
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
                {BINDING_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="ls-caption" id={`${statusId}-hint`}>
                Retiring keeps the binding and its digest resolvable. There is no deletion:
                a Run that froze this digest must still be able to read it.
              </p>
            </div>
          ) : null}
        </div>

        {/*
          Both warnings are about a binding that is perfectly saveable and still limited,
          so they are Banners on the form rather than refusals. `missingCount` is the more
          serious of the two — it stops every Procedure bound to this source — and its
          sentence is EXPERIENCE.md's, imported rather than retyped.
        */}
        {missingCount ? (
          <Banner tone="warning" title={DECLARED_COUNT_MISSING_SENTENCE}>
            This binding can be saved. No Procedure Version can be submitted against it
            until the count is declared, because a Run would have nothing to reconcile the
            rows it acquired against.
          </Banner>
        ) : null}

        {uploadOnly ? <Banner tone="info" title={UPLOAD_ONLY_SENTENCE} /> : null}

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
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Register binding'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title={editing ? 'Save this binding?' : 'Register this Population Source?'}
        consequence={`${consequence}${referencesWarning}`}
        confirmLabel={editing ? 'Save changes' : 'Register binding'}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
