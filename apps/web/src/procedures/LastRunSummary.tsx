import Link from 'next/link';

import type { ProcedureLastRun, RunStopFacts } from '@intellifin/infrastructure';

import { StatusBadge } from '../design/StatusBadge';
import { StopReasonNote } from '../runs/StopReason';
import { resultOutcomeWord, runLifecycleWord, utcStamp } from '../runs/labels';
import { LAST_RUN_NOT_VISIBLE, NO_RUN_YET, OPEN_LAST_RUN, lastRunTiming } from './last-run-words';

/**
 * The Last outcome cell of a Procedure card (owner finding RUN-05).
 *
 * Three states, and they are three different statements:
 *
 * - No Run at all — "No Run has been started." Nothing has been executed.
 * - A Run that concluded — its Result outcome badge.
 * - A Run that issued no conclusion — "No conclusion issued", which is what
 *   `resultOutcomeWord(null)` says for a Run with no Result and what §E.1's three
 *   "(Run state)" outcomes say for one that stopped. The lifecycle word beside it says
 *   WHICH of them happened, and the stop reason underneath says why, in the auditor's
 *   words, from the same `stopReason` the Runs list and the Run header read.
 *
 * The old card could tell none of them apart: every Procedure got "No outcome" beside "No
 * Runs yet", so a Run Failed Run and a Procedure nobody had ever run looked identical.
 */
export function LastRunSummary({
  run,
  facts,
  visible,
}: {
  /** The Procedure's latest Run, or `null` when it has never had one. */
  readonly run: ProcedureLastRun | null;
  /** Why that Run stopped, when it stopped (`DrizzleRunStopReader`). */
  readonly facts: RunStopFacts | null;
  /**
   * Whether this role may see Runs at all.
   *
   * `false` is NOT the same as no Run: the page reads nothing for such a role, so
   * answering "No Run has been started." would be a claim it has no basis for.
   */
  readonly visible: boolean;
}): React.JSX.Element {
  if (!visible) return <>{LAST_RUN_NOT_VISIBLE}</>;
  if (run === null) return <>{NO_RUN_YET}</>;

  // `StatusBadge` THROWS on a state its family does not hold, and on a server-rendered
  // list of Procedures that is a 500 for the whole page. A value this build cannot name
  // is written in words instead.
  const outcome = resultOutcomeWord(run.outcome);
  const lifecycle = runLifecycleWord(run.state);
  const timing = lastRunTiming(run);

  // A `<div>`, not a `<span>`: `StopReasonNote` renders a `<p>`, which a `<span>` may not
  // contain — the browser would break the paragraph out of it and the grid with it. A
  // `<dd>` takes flow content, so this is valid where it is used.
  return (
    <div className="ls-last-run">
      <div>
        {outcome === null ? <>{run.outcome}</> : <StatusBadge family="result-outcome" state={outcome} />}
      </div>
      <p className="ls-caption">
        {timing.word} <time dateTime={timing.at}>{utcStamp(timing.at)}</time> ·{' '}
        {lifecycle === null ? <>{run.state}</> : <StatusBadge family="run-lifecycle" state={lifecycle} />}
      </p>
      {facts === null ? null : <StopReasonNote facts={facts} />}
      <div>
        <Link href={`/runs/${run.runId}`}>{OPEN_LAST_RUN}</Link>
      </div>
    </div>
  );
}
