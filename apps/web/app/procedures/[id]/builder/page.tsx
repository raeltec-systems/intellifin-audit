import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  procedureVersionRowVersion,
  PROCEDURE_AUTHOR_ACTION,
} from '@intellifin/application';
import { DrizzleProcedureRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { BuilderSections } from '../../../../src/procedures/BuilderSections';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { RenameDraftForm } from '../../../../src/procedures/RenameDraftForm';
import { templateLabel } from '../../../../src/procedures/labels';
import { requireServerAction } from '../../../../src/server-session';
import { renameProcedureDraftAction } from './actions';

export const metadata: Metadata = {
  title: 'Builder · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * The Builder shell (UX-DR8, scoped to this story).
 *
 * The section headings sit in the domain's order, each showing its pre-filled value
 * READ-ONLY under the pinned sentence saying so, and the one editable field — the
 * Control name — carries the full-row version token. Stories 2.2-2.5 make the sections
 * editable; this story proves the draft-scoped write path once, here.
 *
 * Authorization comes first, before the id in the URL is used for anything: the refusal
 * branch renders before the lookup, so a refused caller cannot learn whether a
 * procedure id exists by watching this page answer differently.
 */
export default async function BuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Builder</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const { id } = await params;
  const runtime = await getRuntime();
  const repository = new DrizzleProcedureRepository(runtime.db);
  const procedure = await repository.findProcedure(id);
  if (procedure === null) notFound();

  const versions = await repository.listVersions(id);
  // The Draft is the version this story can edit. Later stories add Submit and the
  // state machine's other arrows; until then the newest version is the Draft or there
  // is nothing editable on this surface at all.
  const draft = versions.find((version) => version.state === 'DRAFT') ?? null;
  if (draft === null) notFound();

  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/procedures', label: 'Procedures', mono: false },
          { href: `/procedures/${procedure.procedureId}`, label: procedure.controlName },
          { href: `/procedures/${procedure.procedureId}/builder`, label: 'Builder' },
        ]}
      />
      <header className="ls-page-header">
        <h1>{procedure.controlName}</h1>
        <p>
          Template {procedure.templateId} · {templateLabel(procedure.templateId)} · Version{' '}
          {draft.versionNumber} · Draft
        </p>
      </header>

      <BuilderSections sections={draft.sections} />

      <RenameDraftForm
        procedureId={procedure.procedureId}
        versionId={draft.versionId}
        rowVersion={procedureVersionRowVersion({
          versionId: draft.versionId,
          procedureId: draft.procedureId,
          versionNumber: draft.versionNumber,
          state: draft.state,
          controlName: draft.controlName,
          templateId: draft.templateId,
          sections: draft.sections,
        })}
        onRename={renameProcedureDraftAction}
      />
    </div>
  );
}
