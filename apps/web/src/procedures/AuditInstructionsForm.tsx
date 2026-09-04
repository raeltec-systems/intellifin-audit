'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  isAgentDrivenKind,
  scopeWideningWarnings,
  TARGET_DRAFT_LIMITS,
  type ScopeCheckSystem,
} from '@intellifin/domain';
import type {
  ProcedureVersionView,
  DraftTargetEdit,
  TargetSystemRegistration,
  UpdateTargetDraftResult,
} from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { AUDIT_INSTRUCTIONS_NO_AGENT } from './labels';

/**
 * The per-system Audit Instructions editor (FR-7, FR-8, scoped to this story).
 *
 * One textarea per selected agent-driven system, stored verbatim; API and file systems are
 * selectable without instructions and get no textarea. On blur the instruction is checked
 * against the selected systems' allowlists for scope-widening — an unregistered system, a
 * write verb, an out-of-scope origin — and each is named inline in warning colour. That
 * flag is ADVISORY (FR-8): it never blocks the save. Correcting or clearing the text and
 * re-checking clears the warning, because the check runs on the current text.
 */

export interface AuditInstructionsFormProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  /** Active registrations, used to name known-but-unselected systems in SW-1 warnings. */
  readonly registrations?: readonly Pick<TargetSystemRegistration, 'displayName'>[];
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: DraftTargetEdit },
  ) => Promise<UpdateTargetDraftResult>;
}

function initialTexts(draft: ProcedureVersionView): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const instruction of draft.instructions) texts[instruction.registrationId] = instruction.text;
  return texts;
}

function agentRegistrationIds(draft: ProcedureVersionView): readonly string[] {
  return draft.targets
    .filter((target) => isAgentDrivenKind(target.contract.kind))
    .map((target) => target.registrationId);
}

export function AuditInstructionsForm({
  draft,
  rowVersion,
  registrations = [],
  onSave,
}: AuditInstructionsFormProps): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const initial = initialTexts(draft);
  const [texts, setTexts] = useState<Record<string, string>>(() => initial);
  const textsRef = useRef(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /**
   * A Server Action re-renders the whole Builder, including this form. Keep a local value
   * while it is dirty; replace only fields whose server value has caught up. Without this
   * per-field merge, saving a different Builder section silently discarded typed prose.
   */
  const dirtyRef = useRef(new Set<string>());
  useEffect(() => {
    const serverTexts = initialTexts(draft);
    const next: Record<string, string> = {};
    const nextDirty = new Set<string>();
    for (const registrationId of agentRegistrationIds(draft)) {
      const serverText = serverTexts[registrationId] ?? '';
      const localText = textsRef.current[registrationId] ?? '';
      if (dirtyRef.current.has(registrationId) && localText !== serverText) {
        next[registrationId] = localText;
        nextDirty.add(registrationId);
      } else {
        next[registrationId] = serverText;
      }
    }
    dirtyRef.current = nextDirty;
    textsRef.current = next;
    setTexts(next);
    setTouched((current) => {
      const retained: Record<string, boolean> = {};
      for (const registrationId of agentRegistrationIds(draft)) {
        if (current[registrationId] === true) retained[registrationId] = true;
      }
      return retained;
    });
  }, [draft]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateTargetDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const agentTargets = draft.targets.filter((target) => isAgentDrivenKind(target.contract.kind));
  const templateInstructions = draft.sections.find((section) => section.heading === 'Audit Instructions')?.content ?? null;
  const templateInstructionsId = `${id}-template-instructions`;
  const scopeSystems: readonly ScopeCheckSystem[] = draft.targets.map((target) => ({
    displayName: target.displayName,
    kind: target.contract.kind,
    allowedOrigins: target.contract.kind === 'desktop' ? [] : target.contract.allowed_origins,
  }));

  function setText(registrationId: string, text: string): void {
    dirtyRef.current.add(registrationId);
    setTexts((current) => {
      const next = { ...current, [registrationId]: text };
      textsRef.current = next;
      return next;
    });
  }

  async function save(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    const edit: DraftTargetEdit = {
      section: 'audit-instructions',
      instructions: agentTargets.map((target) => ({
        registrationId: target.registrationId,
        text: textsRef.current[target.registrationId] ?? '',
      })),
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
      {templateInstructions === null ? null : (
        <div className="ls-card">
          <p className="ls-card__title">Template default Audit Instructions (read-only)</p>
          <p className="ls-whitespace" id={templateInstructionsId}>{templateInstructions}</p>
          <p className="ls-caption">
            These are the Template&apos;s pinned instructions. Use them for a selected agent-driven Target System only when they fit its registered contract.
          </p>
        </div>
      )}

      {agentTargets.length === 0 ? <p>{AUDIT_INSTRUCTIONS_NO_AGENT}</p> : null}

      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={
            result.ok
              ? result.changed
                ? 'Saved. The Audit Instructions are recorded in the audit chain.'
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}

      {agentTargets.length === 0 ? null : (
        <form
          method="post"
          className="ls-admin__form ls-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving.current) return;
            setResult(null);
            setConfirming(true);
          }}
        >
          {agentTargets.map((target) => {
            const text = texts[target.registrationId] ?? '';
            const warnings = (touched[target.registrationId] ?? false)
              ? scopeWideningWarnings(text, scopeSystems, registrations)
              : [];
            const fieldId = `${id}-${target.registrationId}`;
            const scopeId = `${fieldId}-scope`;
            const describedBy = templateInstructions === null
              ? scopeId
              : `${templateInstructionsId} ${scopeId}`;
            return (
              <div key={target.registrationId} className="ls-dialog__field">
                <label htmlFor={fieldId}>Audit Instructions for {target.displayName}</label>
                {templateInstructions === null ? null : (
                  <Button type="button" onClick={() => setText(target.registrationId, templateInstructions)}>
                    Use Template instructions for {target.displayName}
                  </Button>
                )}
                <textarea
                  className="ls-input"
                  id={fieldId}
                  value={text}
                  maxLength={TARGET_DRAFT_LIMITS.instruction}
                  aria-describedby={describedBy}
                  onChange={(event) => setText(target.registrationId, event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, [target.registrationId]: true }))}
                />
                <div id={scopeId} aria-live="polite" className="ls-stack">
                  {warnings.map((warning) => (
                    <Banner key={`${warning.kind}:${warning.offending}`} tone="warning" title={warning.message} />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="ls-admin__actions">
            <Button type="submit" variant="primary" size="md" busy={busy}>
              {busy ? 'Saving…' : 'Save Audit Instructions'}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        weight="routine"
        title="Save the Audit Instructions?"
        consequence={`This sets the Audit Instructions for Draft version ${draft.versionNumber} of ${draft.controlName}. A scope-widening warning is advisory and does not block this save. The change is recorded in the audit chain against your name.`}
        confirmLabel="Save Audit Instructions"
        onConfirm={() => {
          void save();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
