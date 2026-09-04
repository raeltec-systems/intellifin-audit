'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  isAgentDrivenKind,
  scopeWideningWarnings,
  TARGET_DRAFT_LIMITS,
  type ScopeCheckSystem,
} from '@intellifin/domain';
import type { ProcedureVersionView, DraftTargetEdit, UpdateTargetDraftResult } from '@intellifin/application';

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
  readonly onSave: (
    fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string; readonly edit: DraftTargetEdit },
  ) => Promise<UpdateTargetDraftResult>;
}

function initialTexts(draft: ProcedureVersionView): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const instruction of draft.instructions) texts[instruction.registrationId] = instruction.text;
  return texts;
}

export function AuditInstructionsForm({ draft, rowVersion, onSave }: AuditInstructionsFormProps): React.JSX.Element {
  const id = useId();
  const [token, setToken] = useState(rowVersion);
  useEffect(() => setToken(rowVersion), [rowVersion]);
  const [texts, setTexts] = useState<Record<string, string>>(() => initialTexts(draft));
  useEffect(() => setTexts(initialTexts(draft)), [draft]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpdateTargetDraftResult | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const agentTargets = draft.targets.filter((target) => isAgentDrivenKind(target.contract.kind));
  const scopeSystems: readonly ScopeCheckSystem[] = draft.targets.map((target) => ({
    displayName: target.displayName,
    kind: target.contract.kind,
    allowedOrigins: target.contract.kind === 'desktop' ? [] : target.contract.allowed_origins,
  }));

  async function save(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setConfirming(false);
    setBusy(true);
    const edit: DraftTargetEdit = {
      section: 'audit-instructions',
      instructions: agentTargets.map((target) => ({
        registrationId: target.registrationId,
        text: texts[target.registrationId] ?? '',
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

  if (agentTargets.length === 0) {
    return <p>{AUDIT_INSTRUCTIONS_NO_AGENT}</p>;
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
                ? 'Saved. The Audit Instructions are recorded in the audit chain.'
                : 'Saved. Nothing changed, so nothing was recorded.'
              : result.reason
          }
        />
      )}

      <form
        method="post"
        className="ls-admin__form ls-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setResult(null);
          setConfirming(true);
        }}
      >
        {agentTargets.map((target) => {
          const text = texts[target.registrationId] ?? '';
          const warnings = (touched[target.registrationId] ?? false) ? scopeWideningWarnings(text, scopeSystems) : [];
          const fieldId = `${id}-${target.registrationId}`;
          return (
            <div key={target.registrationId} className="ls-dialog__field">
              <label htmlFor={fieldId}>Audit Instructions for {target.displayName}</label>
              <textarea
                className="ls-input"
                id={fieldId}
                value={text}
                maxLength={TARGET_DRAFT_LIMITS.instruction}
                aria-describedby={`${fieldId}-scope`}
                onChange={(event) =>
                  setTexts((current) => ({ ...current, [target.registrationId]: event.target.value }))
                }
                onBlur={() => setTouched((current) => ({ ...current, [target.registrationId]: true }))}
              />
              <div id={`${fieldId}-scope`} aria-live="polite" className="ls-stack">
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
