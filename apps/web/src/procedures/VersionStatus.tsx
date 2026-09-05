import type { ProcedureVersionView } from '@intellifin/application';

export function VersionStatus({ version, successorNumber }: { version: ProcedureVersionView; successorNumber?: number | null }): React.JSX.Element {
  const lastRejection = [...version.decisions ?? []].reverse().find(decision => decision.decision === 'reject');
  return <div className="ls-stack">
    {version.platformOrigin && ['DRAFT','SUBMITTED'].includes(version.state) && <p>Created by the platform after a {version.platformOrigin.description}; requires approval.</p>}
    {version.state === 'DRAFT' && <p>Draft; review the executable plan and Submit for approval.</p>}
    {version.state === 'SUBMITTED' && <p>Approval pending. An Audit Manager who did not author this version can approve it.</p>}
    {version.state === 'REJECTED' && <p>Rejected: {lastRejection?.rationale ?? 'See the saved decision.'} Edit returns this version to Draft.</p>}
    {version.state === 'APPROVED' && <p>{version.lifecycle?.requiresRegression ? 'Approved; a Regression Run is required before activation. No handover date has been set.' : 'Approved; activation has not been recorded.'}</p>}
    {version.state === 'ACTIVE' && <>
      <p>Active. Saved Schedule: {version.schedule?.frequency} at {version.schedule?.startTime} UTC.</p>
      {version.schedule?.frequency === 'once' ? <p>No automatic Schedule boundary. The authored Period {version.period?.from} to {version.period?.to} is preserved for later manual initiation.</p> : <p>First period start after activation: {version.lifecycle?.handoverAt ?? 'Not recorded'}.</p>}
      <button disabled aria-describedby={`run-unavailable-${version.versionId}`}>Initiate Run</button>
      <p id={`run-unavailable-${version.versionId}`}>Unavailable actions: Run execution is not available yet. No next Run is scheduled.</p>
    </>}
    {version.state === 'RETIRED' && <p>Retired; this version is read-only.{successorNumber === undefined ? ' Successor history has not been loaded.' : successorNumber === null ? ' No successor is recorded.' : ` Superseded by v${successorNumber}.`}</p>}
  </div>;
}
