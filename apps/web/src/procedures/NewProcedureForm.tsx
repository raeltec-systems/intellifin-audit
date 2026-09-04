'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { heroProcedureTemplate, PROCEDURE_TEMPLATES, type TemplateId } from '@intellifin/domain';
import { PROCEDURE_REFUSALS } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import type { NewProcedureActionResult, NewProcedureFormFields } from '../../app/procedures/new/actions';

/**
 * The New-procedure form: pick a Template, name the Control (FR-4).
 *
 * **There is no default Template.** Story 1.7 shipped a form defaulting to
 * `OPTIONS[0]`, which made every fresh form open as the most restricted kind — showing
 * a restriction to somebody who had chosen nothing, and two browser assertions true
 * before the selection they tested. A choice with a default is a choice the form made.
 * The select therefore opens on a disabled placeholder option, and the submit handler
 * refuses an unchosen Template before the dialog opens.
 *
 * The dialog is `weight="routine"`: creating a Draft changes nothing that exists and
 * is recorded in the audit chain, but it is still the moment the person confirms what
 * they are about to make.
 */

export interface NewProcedureFormProps {
  readonly onCreate: (fields: NewProcedureFormFields) => Promise<NewProcedureActionResult>;
}

const TEMPLATE_OPTIONS = PROCEDURE_TEMPLATES.map((template) => ({
  value: template.id,
  // §C marks P-1 the hero; the flag is data, so the picker orders it first from the
  // record and no surface hard-codes the id.
  label: template.hero
    ? `${template.name} (recommended)`
    : template.name,
}));

const UNCHOSEN = '';

export function NewProcedureForm({ onCreate }: NewProcedureFormProps): React.JSX.Element {
  const router = useRouter();
  const templateId = useId();
  const controlNameId = useId();

  const [template, setTemplate] = useState(UNCHOSEN);
  const [controlName, setControlName] = useState('');
  const [result, setResult] = useState<NewProcedureActionResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `BindingForm`. */
  const submittingRef = useRef(false);

  async function submit(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    try {
      const outcome = await onCreate({ templateId: template, controlName });
      setResult(outcome);
      setAnnouncement((count) => count + 1);
      if (outcome.ok) {
        // The Draft exists. The Builder is where the pre-filled sections are read.
        router.push(`/procedures/${outcome.procedureId}/builder`);
      }
    } catch {
      // A rejected Server Action — a network drop, a deploy mid-request — must not end
      // as a stopped spinner and no message.
      setResult({ ok: false, reason: 'The Procedure could not be created. Nothing was changed.' });
      setAnnouncement((count) => count + 1);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function onRequestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submittingRef.current) return;
    if (template === UNCHOSEN) {
      // The refusal the spec asks for: no sentence, no stored row — and a refusal the
      // person can act on, stated where the choice is. Read from the command's own
      // constant, never retyped: a client copy of a refusal drifts from the server's.
      setResult({ ok: false, reason: PROCEDURE_REFUSALS.TEMPLATE_REQUIRED });
      setAnnouncement((count) => count + 1);
      return;
    }
    // EXPERIENCE.md requires a confirmation dialog on every mutating action. Creating a
    // Draft is a mutation: it writes two rows and an immutable audit event.
    setConfirming(true);
  }

  return (
    <div className="ls-stack">
      {result === null ? null : (
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
      <form method="post" onSubmit={onRequestSubmit} className="ls-admin__form">
        <h2>Create a Procedure from a Template</h2>
        <p className="ls-caption">
          A Template pre-fills every section of the Builder from the addendum. The choice
          is yours to make: nothing here selects one for you.
        </p>
        <div className="ls-admin__fields">
          <div className="ls-dialog__field">
            <label htmlFor={templateId}>Template</label>
            <select
              className="ls-select"
              id={templateId}
              name="templateId"
              value={template}
              onChange={(event) => {
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
                Choose a Template…
              </option>
              {TEMPLATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="ls-caption" id={`${templateId}-hint`}>
              {heroProcedureTemplate().name} is the starting point for most audits.
            </p>
          </div>

          <div className="ls-dialog__field">
            <label htmlFor={controlNameId}>Control name</label>
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
              What this control is called everywhere it is listed — on the card, on the
              Detail, in the audit chain. Up to 200 characters.
            </p>
          </div>
        </div>

        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy}>
            {busy ? 'Creating…' : 'Create Procedure'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Create this Procedure?"
        consequence={`A Draft Procedure Version is created from ${chosenTemplateName(template)}, pre-filled from the Template. Nothing runs, and the creation is recorded in the audit chain against your name.`}
        confirmLabel="Create Procedure"
        onConfirm={() => {
          void submit();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** The chosen Template's name, for the dialog's consequence sentence. */
function chosenTemplateName(templateId: string): string {
  const template = PROCEDURE_TEMPLATES.find((candidate) => candidate.id === templateId);
  return template === undefined ? 'the chosen Template' : template.name;
}
