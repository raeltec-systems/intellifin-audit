import { VersionDiff } from '../../../../../src/procedures/VersionDiff';
import { notFound } from 'next/navigation';
import { authorizeAction } from '@intellifin/domain';
import { procedureVersionRowVersion } from '@intellifin/application';
import { DrizzleProcedureRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../../src/bootstrap';
import { currentIdentity, requireServerAction } from '../../../../../src/server-session';
import { Banner } from '../../../../../src/design/Banner';
import { AUTHOR_CANNOT_APPROVE_SENTENCE, BUILDER_DESKTOP_ONLY_SENTENCE } from '../../../../../src/design/copy';
import { ExecutablePlanPreview } from '../../../../../src/procedures/ExecutablePlanPreview';
import { VersionActions } from '../../../../../src/procedures/VersionActions';
import { ProcedureStateBadge } from '../../../../../src/procedures/ProcedureStateBadge';

export const dynamic = 'force-dynamic';
export default async function VersionReviewPage({ params }: { params: Promise<{ id: string; versionId: string }> }): Promise<React.JSX.Element> {
  const access = await requireServerAction('procedure.author');
  if (!access.allowed) return <><h1>Version review</h1><Banner tone="danger" title={access.reason} /></>;
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return <Banner tone="danger" title="Sign in to continue." />;
  const { id, versionId } = await params;
  const repository = new DrizzleProcedureRepository((await getRuntime()).db);
  const row = await repository.findVersion(versionId);
  if (!row || row.procedureId !== id) notFound();
  const snapshot = row.frozenReview ?? row.submittedReview;


  const baseline = snapshot?.baseline ?? null;
  const diff = snapshot?.diff ?? [];
  const approval = authorizeAction(identity.role, 'procedure.version.approve', { actorId: identity.session.userId, authorId: row.authorship?.responsibleAuthorId, humanAuthorIds: row.authorship?.humanAuthorIds });
  const rejection = authorizeAction(identity.role, 'procedure.version.reject');
  const own = row.authorship?.humanAuthorIds.includes(identity.session.userId) || row.authorship?.responsibleAuthorId === identity.session.userId;
  const latest = row.decisions?.at(-1);
  return <div className="ls-stack">
    <h1>Version review · {snapshot?.definition.inputs.controlName ?? row.controlName} · v{row.versionNumber}</h1>
    <ProcedureStateBadge state={row.state} />
    <p className="ls-desktop-only" role="note">{BUILDER_DESKTOP_ONLY_SENTENCE}</p>
    <div className="ls-builder-authoring ls-stack">
      {row.state === 'SUBMITTED' ? <Banner tone="info" title="Approval pending. An Audit Manager who did not author this version can approve it." /> : null}
      {latest ? <section><h2>Saved decision</h2><p>{latest.decision} · {latest.actorId} · {latest.occurredAt}</p></section> : null}
      {(row.decisions?.length ?? 0) > 0 ? <section aria-label="Decision history"><h2>Decision history</h2><ol>{row.decisions!.map((decision,index) => <li key={`${decision.aggregateRevision}:${index}`}><p>{decision.decision} · {decision.actorId} · <time dateTime={decision.occurredAt}>{decision.occurredAt}</time></p>{decision.rationale ? <p>Rationale: {decision.rationale}</p> : null}</li>)}</ol></section> : null}
      <p>{baseline ? `Compared with version ${baseline.versionNumber} (${baseline.versionId}).` : 'First version: every section is expanded for review.'}</p>
      <VersionDiff diff={diff} first={baseline === null} />
      <ExecutablePlanPreview draft={snapshot ? { ...row, compiledPlan: snapshot.definition.compiledPlan, derivationModel: snapshot.definition.modelConfiguration, planAttempts: [], planDerivable: true, planStatus: 'succeeded' } : row} modelConfiguration={snapshot?.definition.modelConfiguration} />
      <VersionActions procedureId={id} versionId={versionId} rowVersion={procedureVersionRowVersion(row)} actions={row.state === 'SUBMITTED' ? [{ decision: 'approve', label: 'Approve', reason: own ? AUTHOR_CANNOT_APPROVE_SENTENCE : approval.allowed ? null : approval.reason }, { decision: 'reject', label: 'Reject', reason: rejection.allowed ? null : rejection.reason }] : row.state === 'REJECTED' ? [{ decision: 'edit', label: 'Edit', reason: null }] : []} />
    </div>
  </div>;
}
