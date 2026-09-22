'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { PROCEDURE_TEMPLATES } from '@intellifin/domain';
import { PROCEDURE_REFUSALS } from '@intellifin/application';

import Link from 'next/link';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { NEW_PROCEDURE_PREPARING, NEW_PROCEDURE_REQUIRES_JAVASCRIPT, UNKNOWN_CREATE_OUTCOME } from './new-procedure-words';
export { UNKNOWN_CREATE_OUTCOME } from './new-procedure-words';
import type { NewProcedureActionResult, NewProcedureFormFields } from '../../app/procedures/new/actions';

/**
 * The New-procedure form: pick a Template, name the Procedure (FR-4).
 *
 * **There is no default Template.** Story 1.7 shipped a form defaulting to
 * `OPTIONS[0]`, which made every fresh form open as the most restricted kind — showing
 * a restriction to somebody who had chosen nothing, and two browser assertions true
 * before the selection they tested. A choice with a default is a choice the form made.
 * The select therefore opens on a disabled placeholder option, and the submit handler
 * refuses an unchosen Template before the request is sent.
 *
 * **Creating a Draft is ONE action (UX-07).** It used to stand behind a focus-trapping
 * confirmation dialog restating what the click already said; the owner's confirmation
 * table reserves that weight for decisions a person cannot take back from THIS page —
 * submit, approve, reject, activation, scope expansion, cancel, rerun — and creating a
 * harmless Draft is not one of them. A click creates it at once, and the success is a
 * Banner naming the new Draft on the Builder it lands on
 * (`DRAFT_CREATED_TEMPLATE` in `new-procedure-words.ts`), which is what the dialog used
 * to restate after the fact instead of before it. The hydration guard and the
 * lost-response recovery are unchanged.
 */

export interface NewProcedureFormProps {
  readonly onCreate: (fields: NewProcedureFormFields) => Promise<NewProcedureActionResult>;
}

const TEMPLATE_OPTIONS = PROCEDURE_TEMPLATES.map((template) => ({
  value: template.id,
  // UX-06 (2026-09-22): no Template is recommended over another. "(recommended)" beside
  // the hero was a universal opinion on a choice that depends on what is being audited;
  // each Template is described by its own risk, control and objective once chosen.
  label: template.name,
}));

const UNCHOSEN = '';
export { NEW_PROCEDURE_PREPARING, NEW_PROCEDURE_REQUIRES_JAVASCRIPT } from './new-procedure-words';

export function NewProcedureForm({ onCreate }: NewProcedureFormProps): React.JSX.Element {
  const router = useRouter();
  const templateId = useId();
  const controlNameId = useId();
  // The server can display the form before its controlled inputs have handlers.
  // Keep native controls unavailable until hydration, rather than discarding an
  // auditor's early Template choice when React attaches its initial empty state.
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);

  const [template, setTemplate] = useState(UNCHOSEN);
  const [controlName, setControlName] = useState('');
  const selectedTemplate = PROCEDURE_TEMPLATES.find(candidate => candidate.id === template);
  const [result, setResult] = useState<NewProcedureActionResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `BindingForm`. */
  const submittingRef = useRef(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);

  async function submit(): Promise<void> {
    if (!clientReady || submittingRef.current || unknownOutcome) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const outcome = await onCreate({ templateId: template, controlName });
      setResult(outcome);
      setAnnouncement((count) => count + 1);
      if (outcome.ok) {
        // The Draft exists. The Builder is where the pre-filled sections are read, and
        // `created=1` is what tells it to name the new Draft in a Banner (UX-07) — the
        // one place a person actually sees the confirmation, since this page is about
        // to navigate away from under them.
        router.push(`/procedures/${outcome.procedureId}/builder?created=1`);
      }
    } catch {
      // A rejected Server Action — a network drop, a deploy mid-request — must not end
      // as a stopped spinner and no message, and must NOT claim nothing was created.
      // The request may have committed and lost its response on the way back; the only
      // honest answer is to say so and send the person to the list to look, exactly as
      // the Builder's `UnknownSaveOutcome` does for a Draft section save. A second
      // attempt is blocked, because creation carries no idempotency token: a retry after
      // a lost response would make a SECOND Procedure (named as a follow-up in the
      // hero-UX report).
      setUnknownOutcome(true);
      setResult(null);
      setAnnouncement((count) => count + 1);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function onRequestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!clientReady || submittingRef.current || unknownOutcome) return;
    if (template === UNCHOSEN) {
      // The refusal the spec asks for: no sentence, no stored row — and a refusal the
      // person can act on, stated where the choice is. Read from the command's own
      // constant, never retyped: a client copy of a refusal drifts from the server's.
      setResult({ ok: false, reason: PROCEDURE_REFUSALS.TEMPLATE_REQUIRED });
      setAnnouncement((count) => count + 1);
      return;
    }
    // UX-07: creating a harmless Draft is ONE action. It writes two rows and an
    // immutable audit event, but nothing that EXISTS changes and nothing can be lost —
    // the owner's confirmation table reserves the focus-trapping dialog for decisions a
    // person cannot take back from this page, and this is not one of them.
    void submit();
  }

  return (
    <div className="ls-stack">
      {unknownOutcome ? (
        <div className="ls-stack" data-create-unknown>
          <Banner key={announcement} tone="warning" title={UNKNOWN_CREATE_OUTCOME} />
          <p>
            <Link className="ls-button ls-button--secondary ls-button--md" href="/procedures">
              Open Procedures
            </Link>
          </p>
        </div>
      ) : null}
      {result === null || unknownOutcome ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? 'Procedure created.' : result.reason}
        />
      )}

      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: with no method a form submits as a GET, putting every field in the
        URL. See `apps/web/src/form-method.test.ts`.
      */}
      <form method="post" onSubmit={onRequestSubmit} className="ls-admin__form" data-new-procedure-ready={clientReady} aria-busy={!clientReady}>
        <h2>Start a new procedure</h2>
        {!clientReady ? <p role="status">{NEW_PROCEDURE_PREPARING}</p> : null}
        {!clientReady ? <p>{NEW_PROCEDURE_REQUIRES_JAVASCRIPT}</p> : null}
        {/* Native disabling also works BEFORE handlers exist. The reason stays
            outside the fieldset, readable while the fields cannot receive input. */}
        <fieldset disabled={!clientReady} className="ls-stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="ls-visually-hidden">Procedure details</legend>
        <div className="ls-admin__fields">
          <div className="ls-dialog__field">
            <label htmlFor={templateId}>Template</label>
            <select
              className="ls-select"
              id={templateId}
              name="templateId"
              value={template}
              onChange={(event) => {
                const next = PROCEDURE_TEMPLATES.find(candidate => candidate.id === event.target.value);
                // A name follows the explicit Template choice until the auditor adapts it.
                if (!controlName.trim() || controlName === selectedTemplate?.name) setControlName(next?.name ?? '');
                setTemplate(event.target.value);
                if (result !== null && !result.ok && result.reason === PROCEDURE_REFUSALS.TEMPLATE_REQUIRED) {
                  setResult(null);
                }
              }}
              aria-describedby={`${templateId}-hint`}
              required
            >
              {/* Not an option with a value: an unchosen Template must reach the action
                  as something the vocabulary check refuses, never as P-1. */}
              <option value="" disabled>
                Choose what you are testing…
              </option>
              {TEMPLATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {/*
              UX-06: no universal recommendation. Each Template is described by its own
              purpose — read from the Template record, never a fixed opinion about
              which one to pick — in the panel below once one is chosen.
            */}
            <p className="ls-caption" id={`${templateId}-hint`}>
              Choosing a Template shows its risk, control and objective below.
            </p>
          </div>

          {selectedTemplate ? <section className="ls-card ls-stack" aria-label="Selected Template context" data-template-preview>
            <h3>{selectedTemplate.name}</h3>
            <dl className="ls-stack">
              <div><dt>Risk</dt><dd>{selectedTemplate.risk ?? 'Not supplied'}</dd></div>
              <div><dt>Control in place</dt><dd>{selectedTemplate.controlStatement ?? 'Not supplied — clarify this control before preparing the test.'}</dd></div>
              <div><dt>Audit objective</dt><dd>{selectedTemplate.objective}</dd></div>
              <div><dt>Criterion reference</dt><dd>{selectedTemplate.criterionReference ?? 'Not supplied. No institutional policy is assumed.'}</dd></div>
            </dl>
            <p className="ls-caption">This context will be copied into your Draft. You can adapt it there without changing the Template.</p>
          </section> : null}
          <div className="ls-dialog__field">
            <label htmlFor={controlNameId}>Procedure name</label>
            <input
              className="ls-input"
              id={controlNameId}
              name="controlName"
              type="text"
              autoComplete="off"
              required
              maxLength={200}
              value={controlName}
              onChange={(event) => setControlName(event.target.value)}
            />
            <p className="ls-caption">
              What you call this procedure. It appears everywhere it is listed, and in
              the audit record. Up to 200 characters. The Template&rsquo;s control
              statement, shown above, is separate and stays as the Template wrote it.
            </p>
          </div>
        </div>

        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy} disabledReason={unknownOutcome ? UNKNOWN_CREATE_OUTCOME : undefined}>
            {busy ? 'Creating…' : 'Create Procedure'}
          </Button>
        </div>
        </fieldset>
      </form>
    </div>
  );
}
