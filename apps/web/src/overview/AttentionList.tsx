import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatNotificationTimeRemaining, type OpenNotification } from '@intellifin/application';
import type {
  PendingResultRow,
  RunStopFacts,
  StoppedRunRow,
  SubmittedVersionRow,
} from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { StatusBadge } from '../design/StatusBadge';
import { Timestamp } from '../design/Timestamp';
import { pendingAssessmentSentence } from '../design/status-words';
import { readablePeriod } from '../design/time';
import { ActorName } from '../runs/ActorName';
import { StopReasonNote } from '../runs/StopReason';
import { runLifecycleWord } from '../runs/labels';
import { OPEN_RESULT, resultTabHref } from '../review/review-words';
import {
  ATTENTION_GROUPS,
  ATTENTION_GROUP_ORDER,
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
  type AttentionGroup,
} from './overview-words';

/**
 * The Overview's attention list.
 *
 * Five groups, each row naming the Run or the Procedure, its state, the person
 * accountable, and ONE way onward — which is the contract's rule for this list ("Each row
 * names the Run, Procedure, state, and one action").
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
 *
 * `order` exists for the role landing (UI cleanup 2026-09-22). Its default is
 * EXPERIENCE.md's own attention order — Awaiting Auditor, Pending Confirmation, Submitted
 * for review, then the stopped Runs — and the ONE role that reorders it is the Audit
 * Manager, whose landing the same contract leads with "Procedure Versions awaiting
 * approval". It moves a group; it never adds, hides or duplicates one, and the stopped
 * group is last in every order this product uses, because historic stopped Runs must never
 * displace current work.
 */
export interface AttentionCounts {
  readonly open: number;
  /** Finished tests whose assessments are waiting for this reader (UX-01). */
  readonly pending: number;
  readonly versions: number;
  readonly stopped: number;
}

export interface AttentionListProps {
  /** Open Escalations and flags the signed-in person can see, already bounded and ordered. */
  readonly open: readonly OpenNotification[];
  /**
   * Runs whose Result is unsealed and waiting for this reader (UX-01).
   *
   * `[ADDED 2026-09-22]` The list used to exclude these and say so in a footnote claiming
   * a Result awaiting confirmation could not exist in this release. It can, and a finished
   * test whose conclusion is waiting on the reader is the most actionable thing this
   * platform has to show them.
   */
  readonly pending: readonly PendingResultRow[];
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
  /** Which group leads. Defaults to the contract's order; see the note above. */
  readonly order?: readonly AttentionGroup[];
}

/** Every item the page counted, whatever it could show. Zero is the only empty. */
export function attentionTotal(counts: AttentionCounts): number {
  return counts.open + counts.pending + counts.versions + counts.stopped;
}

export function AttentionList({
  open,
  pending,
  versions,
  stopped,
  stops,
  names,
  counts,
  readAt,
  order = ATTENTION_GROUP_ORDER,
}: AttentionListProps): React.JSX.Element {
  const escalations = open.filter((item) => item.kind === 'escalation');
  const flags = open.filter((item) => item.kind === 'flag');

  const groups: Readonly<Record<AttentionGroup, readonly ReactNode[]>> = {
    escalation: escalations.map((item) => (
      <li className="ls-attention__item" key={item.waitId}>
        <p className="ls-attention__head">
          <StatusBadge family="run-lifecycle" state="Awaiting Auditor" />
          <Link href={`/runs/${item.runId}`}>
            {item.procedureName} · v{item.versionNumber} · {ATTENTION_GROUPS.escalation}
          </Link>
          <Reference kind="Run" value={item.runId} />
        </p>
        <p>{escalationQuestion(item.escalationKind)}</p>
        <p className="ls-caption">
          {TIME_REMAINING} {formatNotificationTimeRemaining(item.deadline, readAt)}
        </p>
      </li>
    )),

    flag: flags.map((item) => (
      <li className="ls-attention__item" key={item.flagId}>
        <p className="ls-attention__head">
          <Link href={`/runs/${item.runId}/live`}>
            {item.procedureName} · v{item.versionNumber} · {ATTENTION_GROUPS.flag}
          </Link>
          <Reference kind="Run" value={item.runId} />
        </p>
        <p className="ls-caption">
          {FLAGGED_BY} <ActorName id={item.flaggedBy} names={names} /> ·{' '}
          <Timestamp value={item.flaggedAt} precision="minute" />
        </p>
      </li>
    )),

    /* A finished test whose conclusion is waiting on this reader. It leads with the
       Procedure and links straight to the Run's Result tab, which is where the confirming
       happens — "one action" is the contract's rule for this list. */
    pending: pending.map((row) => (
      <li className="ls-attention__item" key={row.runId}>
        <p className="ls-attention__head">
          <StatusBadge family="result-outcome" state="Pending Confirmation" />
          <Link href={resultTabHref(row.runId)}>
            {row.procedureName} · v{row.versionNumber} · {ATTENTION_GROUPS.pending}
          </Link>
          <Reference kind="Run" value={row.runId} />
        </p>
        <p>{pendingAssessmentSentence(row.pendingEvaluations)}</p>
        <p className="ls-caption">
          {readablePeriod(row.period)} · {STARTED_BY}{' '}
          <ActorName id={row.initiatorId} names={names} /> ·{' '}
          <Link href={resultTabHref(row.runId)}>{OPEN_RESULT}</Link>
        </p>
      </li>
    )),

    version: versions.map((version) => (
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
              · <Timestamp value={version.submittedAt} precision="minute" />
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
    )),

    stopped: stopped.map((run) => {
      const word = runLifecycleWord(run.state);
      const facts = stops.get(run.runId) ?? null;
      return (
        <li className="ls-attention__item" key={run.runId}>
          <p className="ls-attention__head">
            {word === null ? <>{run.state}</> : <StatusBadge family="run-lifecycle" state={word} />}
            <Link href={`/runs/${run.runId}`}>
              {run.procedureName} · v{run.versionNumber} · {ATTENTION_GROUPS.stopped}
            </Link>
            <Reference kind="Run" value={run.runId} />
          </p>
          {/* The reason, in the auditor's words, from the stage checkpoint that ended the
              Run. A stopped Run whose facts could not be read says nothing here rather
              than something wrong — the Runs table's own rule. */}
          {facts === null ? null : <StopReasonNote facts={facts} />}
          <p className="ls-caption">
            {STARTED_BY} <ActorName id={run.initiatorId} names={names} /> ·{' '}
            <Timestamp value={run.initiatedAt} precision="minute" /> ·{' '}
            {readablePeriod(run.period)}
          </p>
        </li>
      );
    }),
  };

  return (
    <div className="ls-stack">
      <ul className="ls-attention">
        {/* `Object.hasOwn` is not needed here — `order` is a closed domain-free vocabulary
            this module owns — but an unknown member is dropped rather than indexed, so a
            hand-built order cannot render `undefined` rows. */}
        {order.flatMap((group) => (Object.hasOwn(groups, group) ? groups[group] : []))}
      </ul>

      {counts.open > open.length ? (
        <p role="status">{overviewBounded(open.length, counts.open)}</p>
      ) : null}
      {counts.pending > pending.length ? (
        <p role="status">{overviewBounded(pending.length, counts.pending)}</p>
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
