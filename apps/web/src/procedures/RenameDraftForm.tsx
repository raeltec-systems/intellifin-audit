'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { PROCEDURE_REFUSALS } from '@intellifin/application';

import { ConfirmDialog } from '../design/ConfirmDialog';
import type { RenameActionResult } from '../../app/procedures/[id]/builder/actions';

/**
 * The Builder's one editable field (FR-7, scoped to this story).
 *
 * The Control name is the only thing this story lets a person change, and it carries a
 * full-row optimistic-concurrency token: the form is rendered with the row version the
 * server computed for THIS page load, sends it back as `expectedRowVersion`, and adopts
 * the token the command returns so the next save guards against the row as it now is.
 * A save from a stale tab is refused rather than allowed to blind-overwrite.
 *
 * The confirmation is `weight="routine"` — renaming a Draft is recorded in the audit
 * chain against the person's name, and the dialog names the exact object being changed,
 * because a confirmation that says only "this Procedure" is one a person cannot check
 * against what they meant to change.
 */

export interface RenameDraftFormProps {
  /** The ids the action needs, supplied once by the page that read the row. */
  readonly procedureId: string;
  readonly versionId: string;
  /** Computed on the server by `procedureVersionRowVersion`. See the doc above. */
  readonly rowVersion: string;
  readonly onRename: (
    fields: {
      readonly procedureId: string;
      readonly versionId: string;
      readonly controlName: string;
      readonly expectedRowVersion: string;
    },
  ) => Promise<RenameActionResult>;
}

export function RenameDraftForm({
  procedureId,
  versionId,
  rowVersion,
  onRename,
}: RenameDraftFormProps): React.JSX.Element {
  const controlNameId = useId();

  const [controlName, setControlName] = useState('');
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const [result, setResult] = useState<RenameActionResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Written and read in the same tick; `busy` is a render behind. See `BindingForm`. */
  const submittingRef = useRef(false);

  async function doRename(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    try {
      const outcome = await onRename({
        procedureId,
        versionId,
        controlName: controlName.trim(),
        expectedRowVersion: token,
      });
      setResult(outcome);
      setAnnouncement((count) => count + 1);
      if (outcome.ok) {
        // The next save guards against the row as the command left it.
        setToken(outcome.rowVersion);
        setControlName('');
      }
    } catch {
      // A rejected Server Action must not end as a stopped spinner and no message.
      setResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
      setAnnouncement((count) => count + 1);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function onRequestSubmit(): void {
    if (submittingRef.current) return;
    if (controlName.trim() === '') {
      setResult({ ok: false, reason: PROCEDURE_REFUSALS.NAME_REQUIRED });
      setAnnouncement((count) => count + 1);
      return;
    }
    setConfirming(true);
  }

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={
            result.ok
              ? result.changed
                ? `Saved. The Control name is now ${result.controlName}. The change is recorded in the audit chain.`
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}

      {/*
        `method="post"` even though the submit handler always prevents the native
        submission: with no method a form submits as a GET. See
        `apps/web/src/form-method.test.ts`.
      */}
      <form
        className="ls-admin__form"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          onRequestSubmit();
        }}
      >
        <h2>Control name</h2>
        <div className="ls-dialog__field">
          <label htmlFor={controlNameId}>New Control name</label>
          <input
            className="ls-input"
            id={controlNameId}
            name="controlName"
            type="text"
            autoComplete="off"
            maxLength={200}
            value={controlName}
            onChange={(event) => setControlName(event.target.value)}
          />
          <p className="ls-caption">
            The Control name is saved on this Draft.
          </p>
        </div>
        <div className="ls-admin__actions">
          <Button type="submit" variant="primary" size="md" busy={busy}>
            {busy ? 'Saving…' : 'Save Control name'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Change the Control name?"
        consequence={`The Draft's Control name becomes ${controlName.trim() || 'the submitted value'}. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Control name"
        onConfirm={() => {
          void doRename();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
