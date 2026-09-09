'use client';

import { useId, useRef, useState } from 'react';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { PROCEDURE_REFUSALS } from '@intellifin/application';

import { ConfirmDialog } from '../design/ConfirmDialog';
import type { RenameActionResult } from '../../app/procedures/[id]/builder/actions';
import { useSection, useSectionSubmissionStatus } from './use-section';
import { SectionConflict } from './SectionConflict';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';

/**
 * The Draft's Control name (FR-7).
 *
 * `[REVISED 2026-09-08]` This doc used to say the Control name was "the only thing this
 * story lets a person change", which stopped being true at Story 2.2 and has been read
 * as a statement about the product ever since. Every authored section of the Builder is
 * editable; this is the editor for one of them.
 *
 * It carries a full-row optimistic-concurrency token: the form is rendered with the row
 * version the server computed for THIS page load, sends it back as `expectedRowVersion`,
 * and adopts the token the command returns so the next save guards against the row as it
 * now is. A save from a stale tab is refused rather than allowed to blind-overwrite.
 *
 * There is no confirmation dialog. The owner revised EXPERIENCE.md's confirmation table
 * on 2026-09-08: an ordinary Draft section save is a direct save with a visible saved,
 * unsaved and error state, and the focus-trapping confirmation is kept for the decisions
 * a person cannot take back from this page — submit, approve, reject, activation, scope
 * expansion, cancellation and rerun. Renaming a Draft is none of those, and the rename
 * is still recorded in the audit chain against the person's name.
 */

export interface RenameDraftFormProps {
  /** The ids the action needs, supplied once by the page that read the row. */
  readonly procedureId: string;
  readonly versionId: string;
  /** Computed on the server by `procedureVersionRowVersion`. See the doc above. */
  readonly rowVersion: string;
  readonly savedControlName: string;
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
  savedControlName,
  onRename,
}: RenameDraftFormProps): React.JSX.Element {
  const controlNameId = useId();

  const section = useSection({ savedControlName, controlName: '' }, rowVersion);
  const controlName = section.value.controlName;
  const setControlName = (value: string) => section.edit({ ...section.current.current.value, controlName: value });
  const [result, setResult] = useState<RenameActionResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  useSectionSubmissionStatus('Control name', section, busy, unknownOutcome);
  /** Written and read in the same tick; `busy` is a render behind. See `BindingForm`. */
  const submittingRef = useRef(false);

  async function doRename(): Promise<void> {
    if (submittingRef.current || unknownOutcome || section.current.current.conflict) return;
    submittingRef.current = true;
    setConfirming(false);
    setBusy(true);
    section.begin({ savedControlName: controlName.trim(), controlName: '' });
    try {
      const outcome = await onRename({
        procedureId,
        versionId,
        controlName: controlName.trim(),
        expectedRowVersion: section.current.current.token,
      });
      setResult(outcome);
      setAnnouncement((count) => count + 1);
      section.finish(outcome.ok ? outcome.rowVersion : undefined);
    } catch {
      section.finish();
      // A rejected Server Action must not end as a stopped spinner and no message.
      setUnknownOutcome(true); setResult(null);
      setAnnouncement((count) => count + 1);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function onRequestSubmit(): void {
    if (submittingRef.current || unknownOutcome || section.current.current.conflict) return;
    if (controlName.trim() === '') {
      setResult({ ok: false, reason: PROCEDURE_REFUSALS.NAME_REQUIRED });
      setAnnouncement((count) => count + 1);
      return;
    }
    setConfirming(true);
  }

  return (
    <div className="ls-stack">
      <SectionConflict dirty={section.status().dirty} conflict={section.conflict} name="Control name" reset={() => section.reset()} />
      <UnknownSaveOutcome visible={unknownOutcome} />
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
          <Button type="submit" disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : undefined} variant="primary" size="md" busy={busy}>
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
