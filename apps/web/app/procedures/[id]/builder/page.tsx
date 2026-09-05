import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  procedureVersionRowVersion,
  PROCEDURE_AUTHOR_ACTION,
} from '@intellifin/application';
import { DrizzleProcedureRepository, DrizzleBindingRepository, DrizzleRegistrationRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { BUILDER_DESKTOP_ONLY_SENTENCE } from '../../../../src/design/copy';
import { DraftBuilder } from '../../../../src/procedures/DraftBuilder';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { templateLabel } from '../../../../src/procedures/labels';
import { requireServerAction } from '../../../../src/server-session';
import { retryPlanDerivationAction, renameProcedureDraftAction, updatePopulationDraftAction, updateTargetDraftAction, updateComplianceDraftAction, updateEvidenceDraftAction } from './actions';

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
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
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

  // The Draft is the version this story can edit. Later stories add Submit and the
  // state machine's other arrows; until then the newest version is the Draft or there
  // is nothing editable on this surface at all.
  const selectedVersion = (await searchParams).version;
  const draft = selectedVersion ? await repository.findVersion(selectedVersion) : await repository.latestDraft(id);
  if (draft === null || draft.procedureId !== id || draft.state !== 'DRAFT') notFound();
  const sources = await new DrizzleBindingRepository(runtime.db).listActiveBindings();
  const registrations = await new DrizzleRegistrationRepository(runtime.db).listActiveRegistrations();

  return (
    <div className="ls-stack">
      {/* NFR-11: below 900px the desktop note replaces the authoring controls. */}
      <p className="ls-desktop-only" role="note">
        {BUILDER_DESKTOP_ONLY_SENTENCE}
      </p>
      <DetailTrail
        trail={[
          { href: '/procedures', label: 'Procedures', mono: false },
          { href: `/procedures/${procedure.procedureId}`, label: procedure.controlName },
          { href: `/procedures/${procedure.procedureId}/builder`, label: 'Builder' },
        ]}
      />
      <header className="ls-page-header">
        {/*
          The DRAFT's Control name, not the Procedure's.

          `renameProcedureDraft` is scoped to the version on purpose — the Procedure row
          is deliberately untouched, which `create-procedure.test.ts` asserts by name.
          Reading `procedure.controlName` here therefore showed the name the Draft used
          to have: the rename committed, the audit chain recorded it and the banner said
          "The Control name is now …", while this heading, directly above the field that
          had just changed it, still said the old one.
        */}
        <h1>{draft.controlName}</h1>
        <p>
          Template {procedure.templateId} · {templateLabel(procedure.templateId)} · Version{' '}
          {draft.versionNumber} · Draft
        </p>
      </header>

      <div className="ls-builder-authoring">
        <DraftBuilder
          draft={draft}
          sources={sources}
          registrations={registrations}
          rowVersion={procedureVersionRowVersion(draft)}
          onSave={updatePopulationDraftAction}
          onSaveTargets={updateTargetDraftAction}
          onSaveCompliance={updateComplianceDraftAction}
          onSaveEvidence={updateEvidenceDraftAction}
          onRename={renameProcedureDraftAction}
          onRetryPlan={retryPlanDerivationAction}
        />
      </div>
    </div>
  );
}
