import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorizeAction, type FrozenPlanInputs } from '@intellifin/domain';
import { procedureVersionRowVersion } from '@intellifin/application';
import { DrizzleActorNameReader, DrizzleProcedureRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../../src/bootstrap';
import { currentIdentity, requireServerAction } from '../../../../../src/server-session';
import { Banner } from '../../../../../src/design/Banner';
import { PageHeader } from '../../../../../src/design/PageHeader';
import { TechnicalDetails } from '../../../../../src/design/TechnicalDetails';
import { Timestamp } from '../../../../../src/design/Timestamp';
import { AUTHOR_CANNOT_APPROVE_SENTENCE, BUILDER_DESKTOP_ONLY_SENTENCE } from '../../../../../src/design/copy';
import { AgentSummary } from '../../../../../src/procedures/AgentSummary';
import { DetailTrail } from '../../../../../src/procedures/DetailTrail';
import { EditVersionPanel } from '../../../../../src/procedures/EditVersionPanel';
import { ExecutablePlanPreview } from '../../../../../src/procedures/ExecutablePlanPreview';
import { VersionActions } from '../../../../../src/procedures/VersionActions';
import { VersionDiff } from '../../../../../src/procedures/VersionDiff';
import { VersionStatus } from '../../../../../src/procedures/VersionStatus';
import { ProcedureStateBadge } from '../../../../../src/procedures/ProcedureStateBadge';
import { BACK_TO_PROCEDURE_LABEL, versionCrumb } from '../../../../../src/procedures/version-review-words';
import { DecisionBar } from '../../../../../src/procedures/review/DecisionBar';
import { DecisionHistory } from '../../../../../src/procedures/review/DecisionHistory';
import { DecisionSummary } from '../../../../../src/procedures/review/DecisionSummary';
import { WhatChanged } from '../../../../../src/procedures/review/WhatChanged';
import {
  FROZEN_CONTRACT_SENTENCE,
  FROZEN_CONTRACT_SUMMARY,
  TECHNICAL_LABELS,
} from '../../../../../src/procedures/review/review-words';

export const dynamic = 'force-dynamic';

/**
 * The surface an Audit Manager approves a Procedure Version from
 * (UI cleanup 2026-09-22, UX-33 and UX-34).
 *
 * It used to be 13,887px of nested frozen structures, with every first-version section
 * labelled "Changed", the executable plan rendered twice and the Approve / Reject
 * controls at the very bottom. It now reads in the order a decision is taken: the
 * decision itself, sticky, at the top; what is being tested, over which records, in
 * which systems, against what criteria, with what proof and how often; what changed
 * since the previous version, in words; and then — under ONE disclosure — the frozen
 * contract the whole summary is read from.
 *
 * Nothing about the decision itself moved. The same Server Action, the same revision
 * token, the same author and role guards, the same confirmation dialog, and the same
 * lost-response handling: this is where they are rendered, not what they do.
 */
export default async function VersionReviewPage({ params }: { params: Promise<{ id: string; versionId: string }> }): Promise<React.JSX.Element> {
  const access = await requireServerAction('procedure.author');
  if (!access.allowed) return <><h1>Version review</h1><Banner tone="danger" title={access.reason} /></>;
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return <Banner tone="danger" title="Sign in to continue." />;
  const { id, versionId } = await params;
  const runtime = await getRuntime();
  const repository = new DrizzleProcedureRepository(runtime.db);
  const row = await repository.findVersion(versionId);
  if (!row || row.procedureId !== id) notFound();
  const successors = await repository.activatedSuccessors(id);
  const snapshot = row.frozenReview ?? row.submittedReview;

  const decisions = row.decisions ?? [];
  // Every actor of every saved decision, plus the responsible author, in one bounded
  // statement. A decision surface that prints ids names nobody accountable.
  const actorIds = [...new Set([...decisions.map(decision => decision.actorId), ...(row.authorship ? [row.authorship.responsibleAuthorId] : [])])];
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(actorIds);
  const controlName = snapshot?.definition.inputs.controlName ?? row.controlName;

  const baseline = snapshot?.baseline ?? null;
  const diff = snapshot?.diff ?? [];
  // The summary reads the version's OWN frozen inputs where it has some, and its Draft
  // row where it has none. `ProcedureVersionView` carries exactly the nineteen keys
  // `frozenPlanInputs` projects, so both are the same shape and neither is recompiled.
  const inputs: FrozenPlanInputs = snapshot?.definition.inputs ?? row;
  const approval = authorizeAction(identity.role, 'procedure.version.approve', { actorId: identity.session.userId, authorId: row.authorship?.responsibleAuthorId, humanAuthorIds: row.authorship?.humanAuthorIds });
  const rejection = authorizeAction(identity.role, 'procedure.version.reject');
  const own = row.authorship?.humanAuthorIds.includes(identity.session.userId) || row.authorship?.responsibleAuthorId === identity.session.userId;
  const latest = decisions.at(-1) ?? null;
  // Who sent this version for approval, and when. The last `submit` decision is that
  // act; a version that was rejected and resubmitted is answered by its latest one.
  const submission = [...decisions].reverse().find(decision => decision.decision === 'submit') ?? null;
  const planned = snapshot ? { ...row, compiledPlan: snapshot.definition.compiledPlan, derivationModel: snapshot.definition.modelConfiguration, planAttempts: [], planDerivable: true, planStatus: 'succeeded' as const } : row;
  return <div className="ls-stack">
    {/* The page trails itself: `rendersOwnTrail` already stands the shell's trail down
        for `/procedures/**`, so without this the surface a manager approves from had no
        breadcrumb at all — and the shell's could only ever have said two UUIDs. Never
        two `<nav aria-label="Breadcrumb">` on one page. */}
    <DetailTrail trail={[
      { href: '/procedures', label: 'Procedures' },
      { href: `/procedures/${id}`, label: controlName },
      { href: `/procedures/${id}/versions/${versionId}`, label: versionCrumb(row.versionNumber) },
    ]} />
    <PageHeader
      title={controlName}
      badge={<ProcedureStateBadge state={row.state} />}
      meta={<>{versionCrumb(row.versionNumber)} · <Link href={`/procedures/${id}`}>{BACK_TO_PROCEDURE_LABEL}</Link></>}
    />
    <p className="ls-desktop-only" role="note">{BUILDER_DESKTOP_ONLY_SENTENCE}</p>
    <div className="ls-builder-authoring ls-stack">
      <DecisionBar
        versionNumber={row.versionNumber}
        controlName={controlName}
        state={row.state}
        authorId={row.authorship?.responsibleAuthorId ?? null}
        submission={submission}
        latest={latest}
        names={names}
        headingId="version-decision"
        status={<VersionStatus version={row} successorNumber={successors.get(row.versionId) ?? null} />}
        actions={<VersionActions procedureId={id} versionId={versionId} rowVersion={procedureVersionRowVersion(row)} subject={{ controlName, versionNumber: row.versionNumber, firstVersion: row.versionNumber === 1 }} actions={row.state === 'SUBMITTED' ? [{ decision: 'approve', label: 'Approve', reason: own ? AUTHOR_CANNOT_APPROVE_SENTENCE : approval.allowed ? null : approval.reason }, { decision: 'reject', label: 'Reject', reason: rejection.allowed ? null : rejection.reason }] : row.state === 'REJECTED' ? [{ decision: 'edit', label: 'Edit', reason: null }] : []} />}
      />
      <DecisionSummary inputs={inputs} headingId="version-summary" />
      <WhatChanged diff={diff} baseline={baseline} templateId={inputs.templateId} headingId="version-changed" submitted={snapshot !== null} />
      <DecisionHistory decisions={decisions} names={names} />
      <EditVersionPanel version={row} headingId="version-editing" />
      {/* The decision-level view of the plan, and the ONLY one on the ordinary reading
          of this page. The contract — canonical step text, compiled applicability,
          model and tool configuration — is the same plan inside the disclosure below,
          which is why it is rendered once here and once there and never twice over. */}
      <AgentSummary draft={planned} headingId="version-agent-summary" />
      <TechnicalDetails
        summary={FROZEN_CONTRACT_SUMMARY}
        items={[
          { label: TECHNICAL_LABELS.versionId, value: row.versionId, mono: true },
          { label: TECHNICAL_LABELS.procedureId, value: row.procedureId, mono: true },
          { label: TECHNICAL_LABELS.templateId, value: inputs.templateId, mono: true },
          ...(baseline === null ? [] : [{ label: TECHNICAL_LABELS.baselineId, value: baseline.versionId, mono: true }]),
          ...(submission === null ? [] : [{ label: TECHNICAL_LABELS.submittedAt, value: <Timestamp value={submission.occurredAt} /> }]),
          ...(latest === null ? [] : [{ label: TECHNICAL_LABELS.revision, value: latest.aggregateRevision, mono: true }]),
        ]}
      >
        <p>{FROZEN_CONTRACT_SENTENCE}</p>
        <ExecutablePlanPreview draft={planned} modelConfiguration={snapshot?.definition.modelConfiguration} />
        <VersionDiff diff={diff} first={baseline === null} headingId="version-frozen-diff" />
      </TechnicalDetails>
    </div>
  </div>;
}
