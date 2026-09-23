import type { ProcedureVersionView } from '@intellifin/application';
import Link from 'next/link';
import { initiateRunHref, NO_AUTOMATIC_RUNS_SENTENCE, plannedFrequencyLine, RUN_STARTS_ON_CONFIRM_SENTENCE, SCHEDULE_NOT_SAVED_LINE, START_RUN_LINK_LABEL } from '../design/run-start-words';
import { Timestamp } from '../design/Timestamp';
import { readablePeriod } from '../design/time';

export function VersionStatus({ version, successorNumber }: { version: ProcedureVersionView; successorNumber?: number | null }): React.JSX.Element {
  const lastRejection = [...version.decisions ?? []].reverse().find(decision => decision.decision === 'reject');
  return <div className="ls-stack">
    {version.platformOrigin && ['DRAFT','SUBMITTED'].includes(version.state) && <p>Created by the platform after a {version.platformOrigin.description}; requires approval.</p>}
    {version.state === 'DRAFT' && <p>Draft; review the executable plan and Submit for approval.</p>}
    {version.state === 'SUBMITTED' && <p>Approval pending. An Audit Manager who did not author this version can approve it.</p>}
    {version.state === 'REJECTED' && <p>Rejected: {lastRejection?.rationale ?? 'See the saved decision.'} Edit returns this version to Draft.</p>}
    {version.state === 'APPROVED' && <p>{version.lifecycle?.requiresRegression ? 'Approved; a Regression Run is required before activation. No handover date has been set.' : 'Approved; activation has not been recorded.'}</p>}
    {version.state === 'ACTIVE' && <>
      {version.schedule?.frequency === 'once'
        ? <p>Active. No automatic Schedule boundary: a one-time Procedure runs when you start it.{version.period ? ` The saved dates are ${readablePeriod(version.period)}.` : ''}</p>
        : <>
          {/* A frequency is a plan in this release (UI cleanup UX-14): nothing starts a Run by
              itself, so the saved frequency is said as one and the time as the intended one. */}
          <p>Active. {version.schedule ? <>{plannedFrequencyLine(version.schedule.frequency)}. Intended start time: {version.schedule.startTime} UTC.</> : SCHEDULE_NOT_SAVED_LINE}</p>
          <p>First period start after activation: {version.lifecycle?.handoverAt ? <Timestamp value={version.lifecycle.handoverAt} /> : 'Not recorded'}.</p>
        </>}
      {/* A one-time version carries its saved dates, so the Initiate Run box opens filled in
          and the auditor only confirms; a scheduled one chooses the period it wants to test. */}
      <p><Link href={initiateRunHref(version.procedureId, version.schedule?.frequency === 'once' ? version.period ?? undefined : undefined)}>{START_RUN_LINK_LABEL}</Link>. {RUN_STARTS_ON_CONFIRM_SENTENCE} {NO_AUTOMATIC_RUNS_SENTENCE}</p>
    </>}
    {version.state === 'RETIRED' && <p>Retired; this version is read-only.{successorNumber === undefined ? ' Successor history has not been loaded.' : successorNumber === null ? ' No successor is recorded.' : ` Superseded by v${successorNumber}.`}</p>}
  </div>;
}
