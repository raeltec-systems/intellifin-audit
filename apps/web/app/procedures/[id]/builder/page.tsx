import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  procedureVersionRowVersion,
  PROCEDURE_AUTHOR_ACTION,
} from '@intellifin/application';
import { PREPARATION_SECTIONS, sectionReview } from '@intellifin/domain';
import { DrizzleActorNameReader, DrizzleProcedureRepository, DrizzleBindingRepository, DrizzleRegistrationRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { PageHeader } from '../../../../src/design/PageHeader';
import { DraftBuilder } from '../../../../src/procedures/DraftBuilder';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { ProcedureStateBadge } from '../../../../src/procedures/ProcedureStateBadge';
import { templateLabel } from '../../../../src/procedures/labels';
import { DRAFT_CREATED_BODY, draftCreatedBanner } from '../../../../src/procedures/new-procedure-words';
import { requireServerAction } from '../../../../src/server-session';
import { generateAuthoringSuggestionAction, acceptAuthoringSuggestionAction, rejectAuthoringSuggestionAction, reviewSectionAction, updateContextDraftAction, retryPlanDerivationAction, renameProcedureDraftAction, updatePopulationDraftAction, updateTargetDraftAction, updateComplianceDraftAction, updateEvidenceDraftAction } from './actions';

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
 * Procedure name (the domain's `controlName`) — carries the full-row version token.
 * Stories 2.2-2.5 make the sections editable; this story proves the draft-scoped write
 * path once, here.
 *
 * Authorization comes first, before the id in the URL is used for anything: the refusal
 * branch renders before the lookup, so a refused caller cannot learn whether a
 * procedure id exists by watching this page answer differently.
 */
export default async function BuilderPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; created?: string }>;
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
  const query = await searchParams;
  const selectedVersion = query.version;
  const draft = selectedVersion ? await repository.findVersion(selectedVersion) : await repository.latestDraft(id);
  if (draft === null || draft.procedureId !== id || draft.state !== 'DRAFT') notFound();
  const sources = await new DrizzleBindingRepository(runtime.db).listActiveBindings();
  const registrations = await new DrizzleRegistrationRepository(runtime.db).listActiveRegistrations();
  // Every auditor a section review record names, plus the signed-in person — whose own
  // review, acknowledged while this page is open, is rendered from the refreshed Draft
  // without another server read. `ActorNameReader` is the one place an id becomes a name.
  const actorNames = Object.fromEntries(await new DrizzleActorNameReader(runtime.db).namesFor([
    decision.session.userId,
    ...PREPARATION_SECTIONS.flatMap((section) => { const review = sectionReview(draft, section); return review === null ? [] : [review.actorId]; }),
  ]));

  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/procedures', label: 'Procedures', mono: false },
          { href: `/procedures/${procedure.procedureId}`, label: procedure.controlName },
          { href: `/procedures/${procedure.procedureId}/builder`, label: 'Builder' },
        ]}
      />
      {/*
        UX-08: one compact header row — title, state badge, one meta line — rather than
        a title, a paragraph and a badge each on their own row. Reads the DRAFT's own
        Procedure name, not the Procedure row's: `renameProcedureDraft` is scoped to the
        version on purpose (`create-procedure.test.ts` asserts the Procedure row stays
        untouched), and `procedure.controlName` here once showed the name a rename had
        already replaced — the audit chain recorded the change, the banner said the new
        name, and this heading kept the old one.
      */}
      <PageHeader
        title={draft.controlName}
        badge={<ProcedureStateBadge state={draft.state} />}
        meta={`Template ${procedure.templateId} · ${templateLabel(procedure.templateId)} · Version ${draft.versionNumber}`}
      />
      {query.created === '1' ? (
        <Banner tone="success" variant="line" title={draftCreatedBanner(draft.controlName)}>
          <p>{DRAFT_CREATED_BODY}</p>
        </Banner>
      ) : null}

      <div className="ls-guided-authoring">
        <DraftBuilder
          draft={draft}
          actorNames={actorNames}
          sources={sources}
          registrations={registrations}
          rowVersion={procedureVersionRowVersion(draft)}
          onSave={updatePopulationDraftAction}
          onSaveContext={updateContextDraftAction}
          onReview={reviewSectionAction}
          onWriting={{ generate: generateAuthoringSuggestionAction, accept: acceptAuthoringSuggestionAction, reject: rejectAuthoringSuggestionAction }}
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
