import { VersionDiff } from '../../../../../src/procedures/VersionDiff';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorizeAction } from '@intellifin/domain';
import { procedureVersionRowVersion } from '@intellifin/application';
import { DrizzleActorNameReader, DrizzleProcedureRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../../src/bootstrap';
import { currentIdentity, requireServerAction } from '../../../../../src/server-session';
import { Banner } from '../../../../../src/design/Banner';
import { AUTHOR_CANNOT_APPROVE_SENTENCE, BUILDER_DESKTOP_ONLY_SENTENCE } from '../../../../../src/design/copy';
import { AgentSummary } from '../../../../../src/procedures/AgentSummary';
import { DetailTrail } from '../../../../../src/procedures/DetailTrail';
import { EditVersionPanel } from '../../../../../src/procedures/EditVersionPanel';
import { ExecutablePlanPreview } from '../../../../../src/procedures/ExecutablePlanPreview';
import { VersionActions } from '../../../../../src/procedures/VersionActions';
import { VersionStatus } from '../../../../../src/procedures/VersionStatus';
import { ProcedureStateBadge } from '../../../../../src/procedures/ProcedureStateBadge';
import { BACK_TO_PROCEDURE_LABEL, decisionWord, versionCrumb } from '../../../../../src/procedures/version-review-words';
// The one place a user id becomes a person's name, and the one renderer for what to
// show when no name is known. The Run surfaces learned this first; a decision history is
// the same fact — the person accountable for an audit decision — on another surface.
import { ActorName } from '../../../../../src/runs/ActorName';
import { utcStamp } from '../../../../../src/runs/labels';

export const dynamic = 'force-dynamic';
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
  // Every actor of every saved decision, in one bounded statement. A decision history
  // that prints ids names nobody accountable, which is the whole point of the section.
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(decisions.map(decision => decision.actorId));
  const controlName = snapshot?.definition.inputs.controlName ?? row.controlName;

  const baseline = snapshot?.baseline ?? null;
  const diff = snapshot?.diff ?? [];
  const approval = authorizeAction(identity.role, 'procedure.version.approve', { actorId: identity.session.userId, authorId: row.authorship?.responsibleAuthorId, humanAuthorIds: row.authorship?.humanAuthorIds });
  const rejection = authorizeAction(identity.role, 'procedure.version.reject');
  const own = row.authorship?.humanAuthorIds.includes(identity.session.userId) || row.authorship?.responsibleAuthorId === identity.session.userId;
  const latest = decisions.at(-1);
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
    <header className="ls-page-header">
      <h1>Version review · {controlName} · v{row.versionNumber}</h1>
      <p><Link href={`/procedures/${id}`}>{BACK_TO_PROCEDURE_LABEL}</Link></p>
    </header>
    <ProcedureStateBadge state={row.state} />
    <p className="ls-desktop-only" role="note">{BUILDER_DESKTOP_ONLY_SENTENCE}</p>
    <div className="ls-builder-authoring ls-stack">
      <VersionStatus version={row} successorNumber={successors.get(row.versionId) ?? null} />
      <EditVersionPanel version={row} headingId="version-editing" />
      {latest ? <section><h2>Saved decision</h2><p>{decisionWord(latest.decision)} · <ActorName id={latest.actorId} names={names} /> · <time dateTime={latest.occurredAt}>{utcStamp(latest.occurredAt)}</time></p></section> : null}
      {decisions.length > 0 ? <section aria-label="Decision history"><h2>Decision history</h2><ol>{decisions.map((decision,index) => <li key={`${decision.aggregateRevision}:${index}`}><p>{decisionWord(decision.decision)} · <ActorName id={decision.actorId} names={names} /> · <time dateTime={decision.occurredAt}>{utcStamp(decision.occurredAt)}</time></p>{decision.rationale ? <p>Rationale: {decision.rationale}</p> : null}</li>)}</ol></section> : null}
      <p>{baseline ? `Compared with version ${baseline.versionNumber} (${baseline.versionId}).` : 'First version: every section is expanded for review.'}</p>
      <VersionDiff diff={diff} first={baseline === null} />
      <AgentSummary draft={snapshot ? { ...row, compiledPlan: snapshot.definition.compiledPlan, derivationModel: snapshot.definition.modelConfiguration, planAttempts: [], planDerivable: true, planStatus: 'succeeded' } : row} headingId="version-agent-summary" />
      <ExecutablePlanPreview draft={snapshot ? { ...row, compiledPlan: snapshot.definition.compiledPlan, derivationModel: snapshot.definition.modelConfiguration, planAttempts: [], planDerivable: true, planStatus: 'succeeded' } : row} modelConfiguration={snapshot?.definition.modelConfiguration} />
      <VersionActions procedureId={id} versionId={versionId} rowVersion={procedureVersionRowVersion(row)} subject={{ controlName, versionNumber: row.versionNumber, firstVersion: row.versionNumber === 1 }} actions={row.state === 'SUBMITTED' ? [{ decision: 'approve', label: 'Approve', reason: own ? AUTHOR_CANNOT_APPROVE_SENTENCE : approval.allowed ? null : approval.reason }, { decision: 'reject', label: 'Reject', reason: rejection.allowed ? null : rejection.reason }] : row.state === 'REJECTED' ? [{ decision: 'edit', label: 'Edit', reason: null }] : []} />
    </div>
  </div>;
}
