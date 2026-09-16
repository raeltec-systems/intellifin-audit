'use client';

import { useId, useRef, useState } from 'react';

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
import {
  DESKTOP_DEFAULT_LEFT_OUT,
  DESKTOP_SELECTION_COMPLETE_WITHOUT_DESKTOP,
  TARGET_SELECTION_MISSING,
  targetCoverageMissing,
  kindLabel,
  suggestedTargetNote,
  suggestedTargets,
} from './labels';
import { useSection, useSectionSubmissionStatus } from './use-section';
import { SectionConflict } from './SectionConflict';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';
import { usePreparationChoices, type PreparationActionResult } from './PreparationActions';

/**
 * The Target System selection editor (FR-7, FR-8, scoped to this story).
 *
 * The Template offers its default systems by name; a registration is never minted from
 * one, so the auditor selects explicitly from what a PoC Administrator registered. Each
 * selected system shows its kind, its credential reference and its expected field labels,
 * and the frozen registration digest — the six-field contract the version freezes. The
 * completeness diagnostics (missing selection, and a Template's WEB default not yet
 * selected) are shown live and distinct from the advisory scope warnings on the Audit
 * Instructions. A Template's desktop default is not one of them: this release cannot
 * execute a desktop system, so the panel says the selection is complete without it.
 *
 * The row-version token is shared with every other Builder editor: this form is rendered
 * with the token the server computed for this load and adopts the token the command
 * returns, so a save from a stale tab loses.
 */

export interface TargetSelectionFormProps {
  readonly conversationActive?: boolean;
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

export function TargetSelectionForm({
  draft,
  registrations,
  rowVersion,
  onSave,
  conversationActive = false,
}: TargetSelectionFormProps): React.JSX.Element {
  const id = useId();
  const section = useSection(fromSnapshot(draft), rowVersion);
  const selected = section.value;
  const selectedRef = { get current() { return section.current.current.value; } };
  function setSelected(update: (current: readonly SelectedTarget[]) => readonly SelectedTarget[]): void {
    section.edit(update(selectedRef.current));
  }
  const [pick, setPick] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateTargetDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  useSectionSubmissionStatus('Target Systems', section, busy, unknownOutcome);
  const saving = useRef(false);
  const conversationConfirmation = useRef<((result: PreparationActionResult) => void) | null>(null);

  const selectedIds = new Set(selected.map((target) => target.registrationId));
  const available = registrations.filter((registration) => !selectedIds.has(registration.registrationId));
  const nameCounts = new Map<string, number>();
  for (const registration of registrations) {
    const key = `${registration.kind}:${registration.displayName.trim().toLocaleLowerCase('en-GB')}`;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  function targetLabel(target: Pick<SelectedTarget, 'registrationId' | 'displayName' | 'kind'>): string {
    const duplicate = (nameCounts.get(`${target.kind}:${target.displayName.trim().toLocaleLowerCase('en-GB')}`) ?? 0) > 1;
    return `${target.displayName} (${kindLabel(target.kind)})${duplicate ? ` · ${target.registrationId}` : ''}`;
  }

  // What the Template offers, said against what a PoC Administrator actually registered.
  const suggestions = suggestedTargets(defaultTargetsFor(draft.templateId), registrations);

  // Completeness diagnostics, live from the current selection (distinct from scope warnings).
  const requiredKinds = new Set(
    defaultTargetsFor(draft.templateId).map((target) => target.kind).filter(isAgentDrivenKind),
  );
  const selectedKinds = new Set(selected.map((target) => target.kind));
  const added = addedSystems(selected);
  const diagnostics: string[] = [];
  if (selected.length === 0) diagnostics.push(TARGET_SELECTION_MISSING);
  // WEB only. A Template's desktop default is a suggestion this release cannot execute,
  // so asking for it here contradicted the caption above that says to leave it out.
  // `DESKTOP_DEFAULT_LEFT_OUT` answers the same question — "is my selection complete?" —
  // in the direction that is true, and it is a caption rather than a warning because
  // leaving it out is the correct outcome and not a gap.
  if (requiredKinds.has('web') && !selectedKinds.has('web')) diagnostics.push(targetCoverageMissing('web'));
  // Only while the desktop default really is left out. Once one is selected the sentence
  // would be false, and `procedureReadiness` names the selected system as unsupported.
  const desktopLeftOut = suggestions.some((suggestion) => suggestion.kind === 'desktop') && !selectedKinds.has('desktop');

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
      return next;
    });
    setPick('');
    setResult(null);
  }

  function remove(registrationId: string): void {
    setSelected((current) => {
      const next = current.filter((entry) => entry.registrationId !== registrationId);
      return next;
    });
    setResult(null);
  }

  usePreparationChoices({
    step: 'evidence', surface: 'evidence:systems', active: conversationActive, basis: `${draft.versionId}:${draft.sectionPreparation?.revision ?? 0}`,
    choices: registrations.map(registration => ({ id: registration.registrationId,
      label: targetLabel(registration),
      aliases: [registration.displayName], description: `${selectedIds.has(registration.registrationId) ? 'Already selected.' : 'Adding this system expands the audited scope and requires confirmation.'} Existing systems are kept.`,
    })),
    async select(registrationId) {
      if (draft.state !== 'DRAFT' || saving.current || unknownOutcome || section.current.current.conflict || confirming) return { ok: false, message: 'The target selection is not ready to change. Review the current saved values first.' };
      const registration = registrations.find(item => item.registrationId === registrationId);
      if (!registration) return { ok: false, message: 'That system is no longer available. Refresh the registered choices.' };
      if (selectedRef.current.some(item => item.registrationId === registrationId)) return { ok: true, message: `${targetLabel(registration)} is already selected. No duplicate was added.` };
      setSelected(current => [...current, { registrationId, mode: 'bind', displayName: registration.displayName,
        kind: registration.kind, digest: registration.digest, credentialRef: registration.credentialRef,
        allowedOrigins: registration.allowedOrigins, applicationIdentity: registration.applicationIdentity,
        permittedActions: registration.permittedActions, labels: registration.attributeLabelPatterns,
        secondaryKey: registration.secondaryKey, expectedDigest: registration.digest }]);
      setResult(null); setConfirming(true);
      return new Promise(resolve => { conversationConfirmation.current = resolve; });
    },
  });

  /**
   * The systems this save would ADD to the frozen scope, with the same identity
   * labels used by the choice catalogue and picker.
   *
   * Owner decision (2026-09-08): an ordinary Draft section save is a direct save, and
   * the focus-trapping confirmation is kept for the decisions a person cannot take back
   * from this page — including SCOPE EXPANSION. Adding a Target System is the one edit
   * on this form that widens what a Run may read, so it keeps its dialog; removing one,
   * reordering, or re-saving an unchanged selection does not.
   *
   * Compared against `draft.targets`, the SAVED selection, not against whatever this
   * form last rendered: the question is what the Version would freeze, and a system
   * added and removed again before saving expands nothing.
   */
  function addedSystems(next: readonly SelectedTarget[]): readonly string[] {
    const saved = new Set(draft.targets.map((target) => target.registrationId));
    return next.filter((target) => !saved.has(target.registrationId)).map(targetLabel);
  }

  async function save(): Promise<PreparationActionResult> {
    if (saving.current || unknownOutcome || section.current.current.conflict) return { ok: false, message: unknownOutcome ? UNKNOWN_SAVE_OUTCOME : 'Resolve the target selection or wait for its current save.' };
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    const sentTargets = selectedRef.current;
    const edit: DraftTargetEdit = {
      section: 'target-systems',
      selections: sentTargets.map((target) =>
        target.mode === 'retain'
          ? { mode: 'retain', registrationId: target.registrationId }
          : { mode: 'bind', registrationId: target.registrationId, expectedDigest: target.expectedDigest },
      ),
    };
    section.begin(sentTargets.map((target) => ({ ...target, mode: 'retain' as const })));
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: section.current.current.token, edit });
      setResult(outcome);
      section.finish(outcome.ok ? outcome.rowVersion : undefined);
      return { ok: outcome.ok, message: outcome.ok ? `Target systems saved: ${sentTargets.map(targetLabel).join(', ')}.` : outcome.reason };
    } catch {
      section.finish();
      setUnknownOutcome(true); setResult(null);
      return { ok: false, message: UNKNOWN_SAVE_OUTCOME };
    } finally {
      setAnnouncement((count) => count + 1);
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="ls-stack">
      <SectionConflict dirty={section.status().dirty} conflict={section.conflict} name="Target Systems" reset={() => section.reset()} />
      <UnknownSaveOutcome visible={unknownOutcome} />
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

      <div className="ls-stack">
        <p className="ls-caption">
          This Template suggests these systems. Add the ones this deployment has — the
          selection is yours, and a suggestion is never added for you.
        </p>
        <ul className="ls-plain-list" data-suggested-targets>
          {suggestions.map((target) => (
            <li key={`${target.kind}:${target.name}`} className="ls-caption" data-suggested-target={target.name}>
              <strong>{target.name}</strong> ({kindLabel(target.kind)}) — {suggestedTargetNote(target)}
            </li>
          ))}
        </ul>
        {desktopLeftOut ? (
          <p className="ls-caption" data-desktop-default-note>
            {DESKTOP_DEFAULT_LEFT_OUT}
            {/* Only once nothing else is outstanding. Saying the selection is complete
                beside "No Target System is selected yet" answers the auditor's question
                with the opposite of the truth (Codex, PR 40). */}
            {diagnostics.length === 0 ? ` ${DESKTOP_SELECTION_COMPLETE_WITHOUT_DESKTOP}` : ''}
          </p>
        ) : null}
      </div>

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
                <details className="ls-disclosure">
                  <summary>Registered access details</summary>
                  <dl className="ls-definition">
                  <div>
                    <dt>Sign-in credential</dt>
                    <dd className="ls-mono">{target.credentialRef}</dd>
                  </div>
                  <div>
                    <dt>{target.kind === 'desktop' ? 'Application identity' : 'Web addresses the agent may open'}</dt>
                    <dd>{target.kind === 'desktop' ? (target.applicationIdentity || 'None declared') : (target.allowedOrigins.length === 0 ? 'None declared' : target.allowedOrigins.join(', '))}</dd>
                  </div>
                  <div>
                    <dt>What the agent may do here</dt>
                    <dd>{target.permittedActions.length === 0 ? 'None declared' : target.permittedActions.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Field labels to look for</dt>
                    <dd>{target.labels.length === 0 ? 'None declared' : target.labels.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Second way to identify a record</dt>
                    <dd>{target.secondaryKey || 'None declared'}</dd>
                  </div>
                  <div>
                    <dt>Fingerprint</dt>
                    <Digest value={target.digest} label="Registration" as="dd" />
                  </div>
                  </dl>
                </details>
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
          ...(pick === '' ? [{ id: `${id}-unavailable-add`, label: 'Add Target System', reason: 'Choose a system in the list above first.' }] : []),
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
          if (saving.current || unknownOutcome || section.current.current.conflict) return;
          if (selected.length === 0 && draft.targets.length === 0) return;
          setResult(null);
          // Scope expansion keeps its confirmation; every other save is direct.
          if (added.length > 0) setConfirming(true);
          else void save();
        }}
      >
        <div className="ls-dialog__field">
          <label htmlFor={`${id}-add`}>Add a system</label>
          <select className="ls-input" id={`${id}-add`} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Choose a system</option>
            {available.map((registration) => (
              <option key={registration.registrationId} value={registration.registrationId}>
                {targetLabel(registration)}
              </option>
            ))}
          </select>
        </div>
        {available.length === 0 && registrations.length === 0 ? (
          <p>No systems are set up yet. Ask a PoC Administrator to add one under Administration.</p>
        ) : null}
        <div className="ls-admin__actions">
          <Button
            type="button"
            disabledReason={pick === '' ? 'Choose a system in the list above first.' : undefined}
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
            disabledReason={unknownOutcome ? UNKNOWN_SAVE_OUTCOME : selected.length === 0 && draft.targets.length === 0 ? TARGET_SELECTION_MISSING : undefined}
            disabledReasonId={!unknownOutcome && selected.length === 0 && draft.targets.length === 0 ? `${id}-unavailable-save` : undefined}
          >
            {busy ? 'Saving…' : 'Save Target Systems'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Add to the audited scope?"
        consequence={`This adds ${added.join(', ')} to the Target Systems a Run of Draft version ${draft.versionNumber} of ${draft.controlName} may read. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Target Systems"
        onConfirm={() => {
          const respond = conversationConfirmation.current;
          conversationConfirmation.current = null;
          void save().then(result => respond?.(result));
        }}
        onCancel={() => {
          setConfirming(false);
          const respond = conversationConfirmation.current;
          conversationConfirmation.current = null;
          if (respond) { section.reset(); respond({ ok: false, message: 'Selection cancelled. The saved target systems were not changed.' }); }
        }}
      />
    </div>
  );
}
