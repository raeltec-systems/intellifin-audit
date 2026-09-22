import Link from 'next/link';

import type { ProcedureLastRun, ProcedureListRow, RunStopFacts } from '@intellifin/infrastructure';

import { StatusBadge } from '../../design/StatusBadge';
import { Timestamp } from '../../design/Timestamp';
import { ActorName } from '../../runs/ActorName';
import { StopReasonNote } from '../../runs/StopReason';
import { resultOutcomeWord, runLifecycleWord } from '../../runs/labels';
import { ProcedureStateBadge } from '../ProcedureStateBadge';
import { templateLabel } from '../labels';
import {
  LAST_RUN_NOT_VISIBLE,
  NO_RUN_YET,
  OPEN_LAST_RUN,
  lastRunTiming,
} from '../last-run-words';
import {
  CARD_ACTIVE_VERSION,
  CARD_LAST_OUTCOME,
  CARD_NEWEST_VERSION,
  CARD_OWNER,
  CARD_SCHEDULE,
  plannedFrequencySentence,
} from './procedures-list-words';

/**
 * One Procedure, compact (UI cleanup 2026-09-22, UX-03 and UX-04).
 *
 * The old card was four `<dl>` cells of which two repeated the same absent sentences on
 * every row, so twenty Procedures were 6,497 pixels tall and said nothing twice as often
 * as they said anything. This is one line of facts under a name: what a Run would use,
 * what the Active version PLANS, who is accountable, and how the last Run ended.
 *
 * `Active version` keeps its repaired Story 2.1 meaning — `ACTIVE` or nothing, never "the
 * newest version whatever its state", which printed "Active version: Draft" for every
 * Procedure in the product. The newest version's own state is a SECOND fact, shown beside
 * it, because that is what "show me my drafts" and the status filter mean and reading one
 * as the other is the defect that cell was repaired for.
 */
export function ProcedureCard({
  row,
  lastRun,
  stop,
  runsVisible,
  absent,
  names,
}: {
  readonly row: ProcedureListRow;
  /** The Procedure's latest Run, or `null` when it has never had one. */
  readonly lastRun: ProcedureLastRun | null;
  /** Why that Run stopped, when it stopped (`DrizzleRunStopReader`). */
  readonly stop: RunStopFacts | null;
  /** Whether this role may see Runs at all. `false` reads nothing and says so. */
  readonly runsVisible: boolean;
  /**
   * `PROCEDURE_CARD_ABSENT`, supplied by the page.
   *
   * The two cells that really are absent keep the CONTRACT's own sentences, which live in
   * `copy.ts` and are pinned against EXPERIENCE.md on disk; `copy.test.ts` additionally
   * requires the Procedures page itself to render them from that module rather than
   * retyping either. Passing them in is what keeps both true at once.
   */
  readonly absent: { readonly activeVersion: string; readonly schedule: string };
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    /* `ls-card` rides alongside the compact treatment on purpose: it is the generic
       card primitive every other Builder-entry test in `procedures.spec.ts` locates a
       Procedure by (`page.locator('.ls-card').filter({ hasText: ... })`), written before
       this list existed. `.ls-procedure-card`'s own rules are declared LATER in
       `globals.css`, so they win on every property the two share (padding, gap, radius)
       and this card stays exactly as compact as it would with `ls-card` left off — the
       token is free precisely because nothing it sets is the last word. */
    <li className="ls-procedure-card ls-card">
      <p className="ls-procedure-card__title">
        <Link href={`/procedures/${row.procedureId}`}>{row.controlName}</Link>
        {row.activeVersionState === null ? null : (
          <ProcedureStateBadge state="ACTIVE" />
        )}
      </p>
      <p className="ls-caption">
        {row.templateId} · {templateLabel(row.templateId)}
      </p>

      <dl className="ls-procedure-card__facts">
        <div>
          <dt>{CARD_ACTIVE_VERSION}</dt>
          {/* Never "the newest version whatever its state": the absent sentence is the
              contract's and comes from `copy.ts` through the page. */}
          <dd>
            {row.activeVersionState === null || row.activeVersionNumber === null
              ? absent.activeVersion
              : `v${row.activeVersionNumber}`}
          </dd>
        </div>
        <div>
          <dt>{CARD_NEWEST_VERSION}</dt>
          <dd>
            {row.latestVersionState === null ? (
              NEWEST_VERSION_UNKNOWN
            ) : (
              <>
                <ProcedureStateBadge state={row.latestVersionState} />
                {row.latestVersionNumber === null ? null : ` v${row.latestVersionNumber}`}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{CARD_SCHEDULE}</dt>
          {/* A frozen frequency is a PLAN. The list says once, above every card, that
              nothing here runs on its own; this says WHICH frequency was frozen. */}
          <dd>
            {row.plannedFrequency === null
              ? absent.schedule
              : plannedFrequencySentence(row.plannedFrequency)}
          </dd>
        </div>
        <div>
          <dt>{CARD_OWNER}</dt>
          <dd>
            {row.ownerId === null ? (
              OWNER_UNRECORDED
            ) : (
              <ActorName id={row.ownerId} names={names} />
            )}
          </dd>
        </div>
        <div>
          <dt>{CARD_LAST_OUTCOME}</dt>
          <dd>
            <LastRunCell run={lastRun} facts={stop} visible={runsVisible} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** What a card says when no version at all could be read, and when nobody is recorded. */
const NEWEST_VERSION_UNKNOWN = 'No version is readable on this Procedure.';
const OWNER_UNRECORDED = 'No author is recorded on the newest version.';

/**
 * The last Run, in the list's own words and through `<Timestamp>`.
 *
 * It is the `LastRunSummary` decision — three different statements, never one — rendered
 * for this surface: the shared component prints the raw ISO instant through `utcStamp`,
 * which the revised Formats row makes a defect on an ordinary screen. The DECISION is not
 * copied: `lastRunTiming` is imported, so "started" against "ended" is answered in one
 * place and both surfaces agree about which instant a card is showing.
 */
function LastRunCell({
  run,
  facts,
  visible,
}: {
  readonly run: ProcedureLastRun | null;
  readonly facts: RunStopFacts | null;
  readonly visible: boolean;
}): React.JSX.Element {
  if (!visible) return <>{LAST_RUN_NOT_VISIBLE}</>;
  if (run === null) return <>{NO_RUN_YET}</>;

  // `StatusBadge` THROWS on a state its family does not hold, and on a server-rendered
  // list of Procedures that is a 500 for the whole page.
  const outcome = resultOutcomeWord(run.outcome);
  const lifecycle = runLifecycleWord(run.state);
  const timing = lastRunTiming(run);

  return (
    <div className="ls-last-run">
      <div>
        {outcome === null ? <>{run.outcome}</> : <StatusBadge family="result-outcome" state={outcome} />}
        {lifecycle === null ? <>{run.state}</> : <StatusBadge family="run-lifecycle" state={lifecycle} />}
      </div>
      <p className="ls-caption">
        {timing.word} <Timestamp value={timing.at} precision="minute" /> ·{' '}
        <Link href={`/runs/${run.runId}`}>{OPEN_LAST_RUN}</Link>
      </p>
      {facts === null ? null : <StopReasonNote facts={facts} />}
    </div>
  );
}
