'use client';

import { useId, useRef, useState } from 'react';
import { CONTEXT_TEXT_LIMIT, draftContext, type DraftContextEdit } from '@intellifin/domain';
import type { ProcedureVersionView, UpdateContextDraftResult } from '@intellifin/application';
import type { ContextDraftFields } from '../../app/procedures/[id]/builder/actions';
import { BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE, BUILDER_CONTROL_NAME_EDITABLE_SENTENCE } from '../design/copy';
import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { useSection, useSectionSubmissionStatus } from './use-section';
import { SectionConflict } from './SectionConflict';
import { UnknownSaveOutcome, UNKNOWN_SAVE_OUTCOME } from './UnknownSaveOutcome';

const fields = [
  ['risk', 'Risk', 'What could go wrong? Replace synthetic example wording when you adapt the procedure.'],
  ['control', 'Control statement', 'What mitigates this risk? Leave blank if no statement has been supplied.'],
  ['objective', 'Objective', 'What should this audit procedure establish?'],
  ['criterionReference', 'Criterion reference', 'Name the approved policy, standard or requirement, if supplied. Set the actual test in Assessment criteria. A reference alone does not create a test rule.'],
] as const;

export function TemplateContextForm({ draft, rowVersion, onSave }: {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onSave: (fields: ContextDraftFields) => Promise<UpdateContextDraftResult>;
}): React.JSX.Element {
  const id = useId();
  const section = useSection(draftContext(draft.sections), rowVersion);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [result, setResult] = useState<UpdateContextDraftResult | null>(null);
  const saving = useRef(false);
  useSectionSubmissionStatus('Risk, control and objective', section, busy, unknown);
  async function save(): Promise<void> {
    if (saving.current || unknown || section.current.current.conflict) return;
    saving.current = true; setBusy(true); setResult(null);
    const edit: DraftContextEdit = section.current.current.value;
    section.begin(edit);
    try {
      const outcome = await onSave({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: section.current.current.token, edit });
      section.finish(outcome.ok ? outcome.rowVersion : undefined); setResult(outcome);
    } catch { section.finish(); setUnknown(true); }
    finally { saving.current = false; setBusy(false); }
  }
  return <form method="post" className="ls-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="ls-caption">{BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE}</p>
    <p className="ls-caption">{BUILDER_CONTROL_NAME_EDITABLE_SENTENCE}</p>
    <SectionConflict dirty={section.status().dirty} conflict={section.conflict} name="Risk, control and objective" reset={() => section.reset()} />
    <UnknownSaveOutcome visible={unknown} />
    {fields.map(([key, label, help]) => <div className="ls-dialog__field ls-template-fact" key={key}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <textarea className="ls-input" id={`${id}-${key}`} value={section.value[key] ?? ''} maxLength={CONTEXT_TEXT_LIMIT} required={key === 'objective'} aria-describedby={`${id}-${key}-help`}
        onChange={event => section.edit({ ...section.current.current.value, [key]: key === 'objective' ? event.target.value : event.target.value === '' ? null : event.target.value })} />
      <p className="ls-caption" id={`${id}-${key}-help`}>{help}</p>
    </div>)}
    {result === null ? null : <Banner tone={result.ok ? 'success' : 'danger'} title={result.ok ? 'Saved. Context changes apply to this procedure only.' : result.reason} />}
    <Button type="submit" variant="primary" busy={busy} disabledReason={unknown ? UNKNOWN_SAVE_OUTCOME : undefined}>Save context</Button>
  </form>;
}
