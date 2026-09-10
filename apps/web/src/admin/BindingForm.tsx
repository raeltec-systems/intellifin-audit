'use client';
import {
  bindingDigest,
  type DeclaredCountMechanism,
  type PopulationSourceKind,
} from '@intellifin/domain';

import { useId, useRef, useState, type FormEvent } from 'react';

import type { PopulationSourceBinding } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import {
  DECLARED_COUNT_MISSING_SENTENCE,
  MANUAL_UPLOAD_SENTENCE,
  registrationChangeWarning,
} from '../design/copy';
import {
  COUNT_MECHANISM_WORDS,
  FINGERPRINT_WORD,
  SOURCE_KIND_WORDS,
} from '../design/plain-words';
import {
  BINDING_KIND_OPTIONS,
  BINDING_STATUS_OPTIONS,
  MECHANISM_OPTIONS,
  UNKNOWN_LABEL,
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
 * The population source form, used to add a source and to change one (FR-6, FR-41).
 *
 * **It is written for somebody who has never read this codebase.** The domain calls this
 * a Population Source binding with a declared schema, a declared-count mechanism and a
 * binding digest; a person setting one up is answering four questions — what do I call
 * it, how do the records arrive, where are they, and what fields does it have. The words
 * come from `../design/plain-words`, so the same thing is not called two names on two
 * screens, and the long explanation lives in a disclosure rather than above the controls
 * where it has to be read past.
 *
 * Three things it deliberately does not do.
 *
 * It has NO FILE INPUT, for any kind, including `manual-upload`. This surface registers a
 * BINDING: where a population comes from and what shape it is declared to have. The file
 * itself arrives with a Run and is captured as Evidence, which does not belong to the web
 * process.
 *
 * It collects no credential. A `read-only-api` source names a location and nothing else;
 * the credential a Run uses comes from the target system registration, which already
 * proved it read-only. A credential field here would be a second place a reference lives
 * and a second place that proof would have to be repeated.
 *
 * It does not decide anything. The kind decides whether a location field is shown and the
 * `<select>`s offer only known values, but neither is the control: the Server Action
 * authorizes, re-validates every vocabulary and re-applies the hidden-field rule on the
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
export function sourceKindWords(kind: string): { readonly label: string; readonly detail: string } {
  return Object.hasOwn(SOURCE_KIND_WORDS, kind)
    ? SOURCE_KIND_WORDS[kind as PopulationSourceKind]
    : { label: UNKNOWN_LABEL, detail: '' };
}

/** The plain words for a stored count mechanism. Same rule, same guard. */
export function countMechanismWords(
  mechanism: string,
): { readonly label: string; readonly detail: string } {
  return Object.hasOwn(COUNT_MECHANISM_WORDS, mechanism)
    ? COUNT_MECHANISM_WORDS[mechanism as DeclaredCountMechanism]
    : { label: UNKNOWN_LABEL, detail: '' };
}

/** What the location field is called and what it wants, for the kind that is chosen. */
export function locationWords(kind: string): { readonly label: string; readonly hint: string } {
  if (kind === 'read-only-api') {
    return {
      label: 'Where to find it',
      hint: 'The web address the platform reads the records from.',
    };
  }
  return {
    label: 'Where to find it',
    hint: 'The full path of the published file, for example s3://hr/leavers-2026-08.csv.',
  };
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

/** What retiring a source does, said plainly. Nothing is ever deleted. */
export const RETIRE_SOURCE_SENTENCE =
  'Retiring stops new procedures using this source. Nothing is deleted, and past Runs stay readable.';

export interface BindingFormProps {
  /** `null` adds a new source; a binding edits that one. */
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
  /** How many Procedure Versions reference it. */
  readonly referencingProcedures: number;
  readonly onCreate?: (fields: BindingFormFields) => Promise<BindingActionResult>;
  readonly onChange?: (fields: ChangeBindingFormFields) => Promise<BindingActionResult>;
  readonly onResult: (result: BindingActionResult) => void;
  /** Called before the action runs, so the surface can clear a stale banner. */
  readonly onStart: () => void;
}

/**
 * What an empty create form starts as.
 *
 * NOT the first option. The vocabulary is ordered `manual-upload, versioned-file,
 * read-only-api`, so `[0]` made every fresh form open as the most restricted kind —
 * showing the `once`-Schedule banner to somebody who has not chosen anything, which
 * teaches people to read past it. A published file is also the ordinary case.
 */
const DEFAULT_KIND = 'versioned-file';
const FIRST_KIND = BINDING_KIND_OPTIONS.some((option) => option.value === DEFAULT_KIND)
  ? DEFAULT_KIND
  : (BINDING_KIND_OPTIONS[0]?.value ?? 'manual-upload');
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

  /**
   * The rare fields start OPEN when changing an existing source and CLOSED when adding
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
              expectedAffectedProcedures: referencingProcedures,
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

  // The dialog names the source it is about. A confirmation that says only "this source"
  // is one a person cannot check against what they meant to change, which is most of what
  // a confirmation is for.
  const subject = displayName.trim() === '' ? 'This source' : displayName.trim();
  const consequence = editing
    ? `${subject} is changed. Changing how the records arrive, where to find them, the fields it provides, how its count is confirmed or the fields hidden in lists gives it a new ${FINGERPRINT_WORD.toLowerCase()}. The change is recorded against your name.`
    : `${subject} becomes a source a procedure can use. Every Run reads the records from it and checks the count it was given. Adding it is recorded against your name.`;

  /**
   * Rendered only above zero: "a draft for 0 Procedures" is a sentence that cannot be
   * true.
   */
  let changesConfiguration = false;
  try { changesConfiguration = binding !== null && bindingDigest({ kind: kind as PopulationSourceKind, location, declaredSchema: linesToList(schema), declaredCountMechanism: mechanism as DeclaredCountMechanism, sensitiveFields: linesToList(sensitive) }) !== binding.digest; } catch { /* invalid fields are refused by the command */ }
  const referencesWarning =
    changesConfiguration && referencingProcedures > 0 ? ` ${registrationChangeWarning(referencingProcedures)}` : '';

  const missingCount = declaresNoCount(mechanism);
  const uploadOnly = kind === 'manual-upload';
  const kindWords = sourceKindWords(kind);
  const mechanismWords = countMechanismWords(mechanism);
  const whereWords = locationWords(kind);

  return (
    <>
      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: a `<form>` with no method submits as a GET, so a submission that beats
        hydration would put every field in the URL, in browser history and in every access
        log between here and the server. See `apps/web/src/form-method.test.ts`.
      */}
      <form className="ls-admin__form" method="post" onSubmit={onRequestSubmit}>
        <h2>{editing ? 'Change this source' : 'Add a population source'}</h2>
        <p className="ls-caption">
          A population source is the list of records a procedure tests, and where that list
          comes from.
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
              What you will call this source when you pick it in a procedure.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={kindId}>How the records arrive</label>
            <select
              className="ls-select"
              id={kindId}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              aria-describedby={`${kindId}-hint`}
            >
              {BINDING_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {sourceKindWords(option.value).label}
                </option>
              ))}
            </select>
            <p className="ls-caption" id={`${kindId}-hint`}>
              {kindWords.detail}
            </p>
          </div>

          {/*
            The restriction is stated where it can still be acted on: the person choosing
            an upload is the one who can go and find a published file instead. The sentence
            is EXPERIENCE.md's, imported rather than retyped, so nobody meets two wordings
            of one rule.
          */}
          {uploadOnly ? <Banner tone="info" title={MANUAL_UPLOAD_SENTENCE} /> : null}

          {uploadOnly ? null : (
            <div className="ls-dialog__field">
              <label htmlFor={locationId}>{whereWords.label}</label>
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
                {whereWords.hint} This page never opens it.
              </p>
            </div>
          )}

          <div className="ls-dialog__field">
            <label htmlFor={schemaId}>Fields this source provides</label>
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
              One field name per line, in the order the file has them. The order is part of
              the {FINGERPRINT_WORD.toLowerCase()}.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={mechanismId}>How the record count is confirmed</label>
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
                  {countMechanismWords(option.value).label}
                </option>
              ))}
            </select>
            <p className="ls-caption" id={`${mechanismId}-hint`}>
              {mechanismWords.detail}
            </p>
          </div>

          {/*
            Saveable and still limited, so a Banner on the form rather than a refusal: the
            absence has to be visible somewhere a person can close it, and a source that
            does not exist shows nobody anything. The title is EXPERIENCE.md's sentence.
          */}
          {missingCount ? (
            <Banner tone="warning" title={DECLARED_COUNT_MISSING_SENTENCE}>
              You can still save this. No procedure can be submitted against it until a
              count is confirmed, because a Run would have nothing to check what it read
              against.
            </Banner>
          ) : null}

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
                {RETIRE_SOURCE_SENTENCE}
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
              <label htmlFor={sensitiveId}>Fields to hide in lists</label>
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
                One per line. Each name must also be in the list of fields above.
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
              A procedure that uses this source keeps a copy of the settings above, so
              every Run can prove which setup it tested against. Change any of them and
              this source gets a new {FINGERPRINT_WORD.toLowerCase()}, which is how that
              copy can be told apart from the setup as it is today.
            </p>
            <p className="ls-caption">
              The count matters because it is the only way a Run can tell &ldquo;we read
              every record&rdquo; from &ldquo;we read the records we happened to be
              given&rdquo;. A short file with nothing to check it against looks exactly like
              a complete one.
            </p>
            <p className="ls-caption">
              The order of the fields matters because a reader told the wrong order reads
              the wrong column. {RETIRE_SOURCE_SENTENCE}
            </p>
          </div>
        </details>

        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Register source'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title={editing ? 'Save this source?' : 'Add this source?'}
        consequence={`${consequence}${referencesWarning}`}
        confirmLabel={editing ? 'Save changes' : 'Register source'}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
