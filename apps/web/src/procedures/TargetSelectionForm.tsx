'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  defaultTargetsFor,
  isAgentDrivenKind,
  type TargetSystemKind,
} from '@intellifin/domain';
import type {
  ProcedureVersionView,
  TargetSystemRegistration,
  DraftTargetEdit,
  UpdateTargetDraftResult,
} from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { Digest } from '../design/Digest';
import { UnavailableActions } from '../design/UnavailableActions';
import { TARGET_SELECTION_MISSING, targetCoverageMissing, kindLabel } from './labels';

/**
 * The Target System selection editor (FR-7, FR-8, scoped to this story).
 *
 * The Template offers its default systems by name; a registration is never minted from
 * one, so the auditor selects explicitly from what a PoC Administrator registered. Each
 * selected system shows its kind, its credential reference and its expected field labels,
 * and the frozen registration digest — the six-field contract the version freezes. The
 * completeness diagnostics (missing selection, missing P-1 web/desktop coverage) are shown
 * live and distinct from the advisory scope warnings on the Audit Instructions.
 *
 * The row-version token is shared with every other Builder editor: this form is rendered
 * with the token the server computed for this load and adopts the token the command
 * returns, so a save from a stale tab loses.
 */

export interface TargetSelectionFormProps {
  readonly draft: ProcedureVersionView;
  readonly registrations: readonly TargetSystemRegistration[];
  readonly rowVersion: string;
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: DraftTargetEdit },
  ) => Promise<UpdateTargetDraftResult>;
}

interface SelectedTarget {
  readonly registrationId: string;
  readonly mode: 'bind' | 'retain';
  readonly displayName: string;
  readonly kind: TargetSystemKind;
  readonly digest: string;
  readonly credentialRef: string;
  readonly allowedOrigins: readonly string[];
  readonly applicationIdentity: string;
  readonly permittedActions: readonly string[];
  readonly labels: readonly string[];
  readonly secondaryKey: string;
  readonly expectedDigest: string;
}

function fromSnapshot(draft: ProcedureVersionView): readonly SelectedTarget[] {
  return draft.targets.map((target) => ({
    registrationId: target.registrationId,
    mode: 'retain',
    displayName: target.displayName,
    kind: target.contract.kind,
    digest: target.digest,
    credentialRef: target.contract.credential_ref,
    allowedOrigins: target.contract.kind === 'desktop' ? [] : target.contract.allowed_origins,
    applicationIdentity: target.contract.kind === 'desktop' ? (target.contract.allowed_origins[0] ?? '') : '',
    permittedActions: target.contract.permitted_actions,
    labels: target.contract.attribute_label_patterns,
    secondaryKey: target.contract.secondary_key ?? '',
    expectedDigest: target.digest,
  }));
}

function sameSelection(left: readonly SelectedTarget[], right: readonly SelectedTarget[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((target, index) => {
    const other = right[index];
    return other !== undefined
      && target.registrationId === other.registrationId
      && target.displayName === other.displayName
      && target.digest === other.digest;
  });
}

export function TargetSelectionForm({
  draft,
  registrations,
  rowVersion,
  onSave,
}: TargetSelectionFormProps): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const initialSelection = fromSnapshot(draft);
  const [selected, setSelected] = useState<readonly SelectedTarget[]>(() => initialSelection);
  const selectedRef = useRef<readonly SelectedTarget[]>(initialSelection);
  /** Keep edits made in this form while another Builder section causes an RSC refresh. */
  const selectionDirtyRef = useRef(false);
  useEffect(() => {
    const serverSelection = fromSnapshot(draft);
    // A matching server selection confirms our local save. Otherwise the server is
    // refreshing another section (or a concurrent update), so a local unsaved choice wins
    // visually until the guarded save either succeeds or is explicitly retried.
    if (!selectionDirtyRef.current || sameSelection(selectedRef.current, serverSelection)) {
      selectionDirtyRef.current = false;
      selectedRef.current = serverSelection;
      setSelected(serverSelection);
    }
  }, [draft]);
  const [pick, setPick] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateTargetDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const selectedIds = new Set(selected.map((target) => target.registrationId));
  const available = registrations.filter((registration) => !selectedIds.has(registration.registrationId));
  const nameCounts = new Map<string, number>();
  for (const registration of registrations) {
    const key = `${registration.kind}:${registration.displayName.toLowerCase()}`;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  // Completeness diagnostics, live from the current selection (distinct from scope warnings).
  const requiredKinds = new Set(
    defaultTargetsFor(draft.templateId).map((target) => target.kind).filter(isAgentDrivenKind),
  );
  const selectedKinds = new Set(selected.map((target) => target.kind));
  const diagnostics: string[] = [];
  if (selected.length === 0) diagnostics.push(TARGET_SELECTION_MISSING);
  for (const kind of ['web', 'desktop'] as const) {
    if (requiredKinds.has(kind) && !selectedKinds.has(kind)) diagnostics.push(targetCoverageMissing(kind));
  }

  function add(): void {
    const registration = registrations.find((candidate) => candidate.registrationId === pick);
    if (registration === undefined) return;
    setSelected((current) => {
      if (current.some((target) => target.registrationId === registration.registrationId)) return current;
      const next = [
        ...current,
        {
          registrationId: registration.registrationId,
          mode: 'bind' as const,
          displayName: registration.displayName,
          kind: registration.kind,
          digest: registration.digest,
          credentialRef: registration.credentialRef,
          allowedOrigins: registration.allowedOrigins,
          applicationIdentity: registration.applicationIdentity,
          permittedActions: registration.permittedActions,
          labels: registration.attributeLabelPatterns,
          secondaryKey: registration.secondaryKey,
          expectedDigest: registration.digest,
        },
      ];
      selectedRef.current = next;
      selectionDirtyRef.current = true;
      return next;
    });
    setPick('');
    setResult(null);
  }

  function remove(registrationId: string): void {
    setSelected((current) => {
      const next = current.filter((entry) => entry.registrationId !== registrationId);
      selectedRef.current = next;
      selectionDirtyRef.current = true;
      return next;
    });
    setResult(null);
  }

  async function save(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    const edit: DraftTargetEdit = {
      section: 'target-systems',
      selections: selectedRef.current.map((target) =>
        target.mode === 'retain'
          ? { mode: 'retain', registrationId: target.registrationId }
          : { mode: 'bind', registrationId: target.registrationId, expectedDigest: target.expectedDigest },
      ),
    };
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: token, edit });
      setResult(outcome);
      if (outcome.ok) setToken(outcome.rowVersion);
    } catch {
      setResult({ ok: false, reason: 'The change could not be saved. Nothing was changed.' });
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
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
                ? 'Saved. The Target System selection is recorded in the audit chain.'
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}

      <p className="ls-caption">
        This Template suggests:{' '}
        {defaultTargetsFor(draft.templateId).map((target, index) => (
          <span key={target.name}>
            {index > 0 ? ', ' : ''}
            {target.name} ({kindLabel(target.kind)})
          </span>
        ))}
        . Select the registered systems that match.
      </p>

      {selected.length === 0 ? (
        <p>No Target System is selected yet.</p>
      ) : (
        <ul className="ls-plain-list ls-stack">
          {selected.map((target) => (
            <li key={target.registrationId} className="ls-card">
              <div className="ls-stack">
                <p className="ls-card__title">
                  {target.displayName} · {kindLabel(target.kind)}
                </p>
                <dl className="ls-definition">
                  <div>
                    <dt>Credential reference</dt>
                    <dd className="ls-mono">{target.credentialRef}</dd>
                  </div>
                  <div>
                    <dt>{target.kind === 'desktop' ? 'Application identity' : 'Allowed origins'}</dt>
                    <dd>{target.kind === 'desktop' ? (target.applicationIdentity || 'None declared') : (target.allowedOrigins.length === 0 ? 'None declared' : target.allowedOrigins.join(', '))}</dd>
                  </div>
                  <div>
                    <dt>Permitted read actions</dt>
                    <dd>{target.permittedActions.length === 0 ? 'None declared' : target.permittedActions.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Expected field labels</dt>
                    <dd>{target.labels.length === 0 ? 'None declared' : target.labels.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Secondary key</dt>
                    <dd>{target.secondaryKey || 'None declared'}</dd>
                  </div>
                  <div>
                    <dt>Registration digest</dt>
                    <Digest value={target.digest} label="Registration" as="dd" />
                  </div>
                </dl>
                <Button type="button" onClick={() => remove(target.registrationId)}>
                  Remove {target.displayName}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div id={`${id}-diagnostics`} aria-live="polite" className="ls-stack">
        {diagnostics.map((diagnostic) => (
          <Banner key={diagnostic} tone="warning" title={diagnostic} />
        ))}
      </div>

      <UnavailableActions
        headingLevel={3}
        actions={[
          ...(pick === '' ? [{ id: `${id}-unavailable-add`, label: 'Add Target System', reason: 'Choose a Target System to add.' }] : []),
          ...(selected.length === 0 && draft.targets.length === 0
            ? [{ id: `${id}-unavailable-save`, label: 'Save Target Systems', reason: TARGET_SELECTION_MISSING }]
            : []),
        ]}
      />

      <form
        method="post"
        className="ls-admin__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current) return;
          if (selected.length === 0 && draft.targets.length === 0) return;
          setResult(null);
          setConfirming(true);
        }}
      >
        <div className="ls-dialog__field">
          <label htmlFor={`${id}-add`}>Add a Target System</label>
          <select className="ls-input" id={`${id}-add`} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Choose a registered Target System</option>
            {available.map((registration) => (
              <option key={registration.registrationId} value={registration.registrationId}>
                {registration.displayName} ({kindLabel(registration.kind)})
                {(nameCounts.get(`${registration.kind}:${registration.displayName.toLowerCase()}`) ?? 0) > 1
                  ? ` · ${registration.registrationId}` : ''}
              </option>
            ))}
          </select>
        </div>
        {available.length === 0 && registrations.length === 0 ? (
          <p>No active Target Systems are registered. Ask a PoC Administrator to register one.</p>
        ) : null}
        <div className="ls-admin__actions">
          <Button
            type="button"
            disabledReason={pick === '' ? 'Choose a Target System to add.' : undefined}
            disabledReasonId={pick === '' ? `${id}-unavailable-add` : undefined}
            onClick={add}
          >
            Add Target System
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            busy={busy}
            disabledReason={selected.length === 0 && draft.targets.length === 0 ? TARGET_SELECTION_MISSING : undefined}
            disabledReasonId={selected.length === 0 && draft.targets.length === 0 ? `${id}-unavailable-save` : undefined}
          >
            {busy ? 'Saving…' : 'Save Target Systems'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Save the Target System selection?"
        consequence={`This sets the Target Systems for Draft version ${draft.versionNumber} of ${draft.controlName}. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Target Systems"
        onConfirm={() => {
          void save();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
