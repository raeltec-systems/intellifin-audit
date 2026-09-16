import Link from 'next/link';

import { formatNotificationTimeRemaining, type OpenNotification } from '@intellifin/application';
import type { RunStopFacts, StoppedRunRow, SubmittedVersionRow } from '@intellifin/infrastructure';

import { Identifier } from '../design/Identifier';
import { StatusBadge } from '../design/StatusBadge';
import { ActorName } from '../runs/ActorName';
import { StopReasonNote } from '../runs/StopReason';
import { periodText, runLifecycleWord, utcStamp } from '../runs/labels';
import {
  ATTENTION_GROUPS,
  ATTENTION_NOT_YET_LISTED,
  AUTHORED_BY,
  AUTHOR_UNKNOWN,
  FLAGGED_BY,
  STARTED_BY,
  SUBMITTED_AT_UNKNOWN,
  SUBMITTED_BY,
  TIME_REMAINING,
  escalationQuestion,
  overviewBounded,
} from './overview-words';

/**
 * The Overview's attention list.
 *
 * Four groups, rendered in EXPERIENCE.md's own order, each row naming the Run or the
 * Procedure, its state, the person accountable, and ONE way onward — which is the
 * contract's rule for this list ("Each row names the Run, Procedure, state, and one
 * action").
 *
 * Nothing here decides why a Run stopped: `StopReasonNote` renders `stopReason`'s
 * sentence, the same function the Runs list and the Run header read, so the Overview
 * cannot say one thing about a Run while the register says another. Nothing here decides
 * who a person is either — `ActorName` prints the name `ActorNameReader` answered and the
 * id in monospace only when no name is known.
 *
 * The totals are EXACT and come from the reads rather than from the rows rendered here, so
 * a bounded group says how many it did not show. The page decides between this list and
 * the contract's empty state from those same totals, never from `rows.length`: a summary
 * that said "nothing needs attention" because three stopped Runs fell off a page is the
 * defect (RUN-04).
 */
export interface AttentionCounts {
  readonly open: number;
  readonly versions: number;
  readonly stopped: number;
}

export interface AttentionListProps {
  /** Open Escalations and flags the signed-in person can see, already bounded and ordered. */
  readonly open: readonly OpenNotification[];
  /** Procedure Versions in `SUBMITTED`. Empty for a role that may not approve one. */
  readonly versions: readonly SubmittedVersionRow[];
  /** Runs that stopped without issuing a conclusion, newest first. */
  readonly stopped: readonly StoppedRunRow[];
  /** Why each stopped Run stopped, keyed by Run id (`DrizzleRunStopReader`). */
  readonly stops: ReadonlyMap<string, RunStopFacts>;
  /** User id to person's name (`ActorNameReader`). An id with no name is shown as the id. */
  readonly names: ReadonlyMap<string, string>;
  /** The exact number in each group, which a bounded list may not reach. */
  readonly counts: AttentionCounts;
  /** The instant the page was read. Every countdown here is measured to it. */
  readonly readAt: Date;
}

/** Every item the page counted, whatever it could show. Zero is the only empty. */
export function attentionTotal(counts: AttentionCounts): number {
  return counts.open + counts.versions + counts.stopped;
}

export function AttentionList({
  open,
  versions,
  stopped,
  stops,
  names,
  counts,
  readAt,
}: AttentionListProps): React.JSX.Element {
  const escalations = open.filter((item) => item.kind === 'escalation');
  const flags = open.filter((item) => item.kind === 'flag');
  return (
    <div className="ls-stack">
      <ul className="ls-attention">
        {escalations.map((item) => (
          <li className="ls-attention__item" key={item.waitId}>
            <p className="ls-attention__head">
              <StatusBadge family="run-lifecycle" state="Awaiting Auditor" />
              <Link href={`/runs/${item.runId}`}>
                {item.procedureName} · v{item.versionNumber} · {ATTENTION_GROUPS.escalation}
              </Link>
            </p>
            <p>{escalationQuestion(item.escalationKind)}</p>
            <p className="ls-caption">
              {TIME_REMAINING} {formatNotificationTimeRemaining(item.deadline, readAt)}
            </p>
            <p className="ls-caption ls-mono">
              <Identifier value={item.runId} />
            </p>
          </li>
        ))}

        {flags.map((item) => (
          <li className="ls-attention__item" key={item.flagId}>
            <p className="ls-attention__head">
              <Link href={`/runs/${item.runId}/live`}>
                {item.procedureName} · v{item.versionNumber} · {ATTENTION_GROUPS.flag}
              </Link>
            </p>
            <p className="ls-caption">
              {FLAGGED_BY} <ActorName id={item.flaggedBy} names={names} /> at{' '}
              <time dateTime={item.flaggedAt}>{utcStamp(item.flaggedAt)}</time>
            </p>
            <p className="ls-caption ls-mono">
              <Identifier value={item.runId} />
            </p>
          </li>
        ))}

        {versions.map((version) => (
          <li className="ls-attention__item" key={version.versionId}>
            <p className="ls-attention__head">
              <StatusBadge family="procedure-version" state="Submitted" />
              <Link href={`/procedures/${version.procedureId}/versions/${version.versionId}`}>
                {version.controlName} · v{version.versionNumber} · {ATTENTION_GROUPS.version}
              </Link>
            </p>
            <p className="ls-caption">
              {version.submittedAt === null ? (
                SUBMITTED_AT_UNKNOWN
              ) : (
                <>
                  {SUBMITTED_BY}{' '}
                  {version.submittedBy === null ? (
                    AUTHOR_UNKNOWN
                  ) : (
                    <ActorName id={version.submittedBy} names={names} />
                  )}{' '}
                  at <time dateTime={version.submittedAt}>{utcStamp(version.submittedAt)}</time>
                </>
              )}
            </p>
            <p className="ls-caption">
              {version.authorId === null ? (
                AUTHOR_UNKNOWN
              ) : (
                <>
                  {AUTHORED_BY} <ActorName id={version.authorId} names={names} />
                </>
              )}
            </p>
          </li>
        ))}

        {stopped.map((run) => {
          const word = runLifecycleWord(run.state);
          const facts = stops.get(run.runId) ?? null;
          return (
            <li className="ls-attention__item" key={run.runId}>
              <p className="ls-attention__head">
                {word === null ? (
                  <>{run.state}</>
                ) : (
                  <StatusBadge family="run-lifecycle" state={word} />
                )}
                <Link href={`/runs/${run.runId}`}>
                  {run.procedureName} · v{run.versionNumber} · {ATTENTION_GROUPS.stopped}
                </Link>
              </p>
              {/* The reason, in the auditor's words, from the stage checkpoint that ended
                  the Run. A stopped Run whose facts could not be read says nothing here
                  rather than something wrong — the Runs table's own rule. */}
              {facts === null ? null : <StopReasonNote facts={facts} />}
              <p className="ls-caption">
                {STARTED_BY} <ActorName id={run.initiatorId} names={names} /> at{' '}
                <time dateTime={run.initiatedAt}>{utcStamp(run.initiatedAt)}</time> ·{' '}
                <span className="ls-mono ls-nowrap">{periodText(run.period)}</span>
              </p>
              <p className="ls-caption ls-mono">
                <Identifier value={run.runId} />
              </p>
            </li>
          );
        })}
      </ul>

      {counts.open > open.length ? (
        <p role="status">{overviewBounded(open.length, counts.open)}</p>
      ) : null}
      {counts.versions > versions.length ? (
        <p role="status">{overviewBounded(versions.length, counts.versions)}</p>
      ) : null}
      {counts.stopped > stopped.length ? (
        <p role="status">{overviewBounded(stopped.length, counts.stopped)}</p>
      ) : null}
      <p className="ls-caption">{ATTENTION_NOT_YET_LISTED}</p>
    </div>
  );
}
