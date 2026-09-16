import type { Metadata } from 'next';
import Link from 'next/link';

import { PROCEDURE_AUTHOR_ACTION, type ProcedureSummary } from '@intellifin/application';
import { authorizeAction } from '@intellifin/domain';
import {
  DrizzleProcedureRepository,
  DrizzleRunOverviewRepository,
  DrizzleRunStopReader,
  type ProcedureLastRun,
  type RunStopFacts,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { PROCEDURE_CARD_ABSENT } from '../../src/design/copy';
import { EmptyState } from '../../src/design/EmptyState';
import { currentIdentity } from '../../src/server-session';
import { LastRunSummary } from '../../src/procedures/LastRunSummary';
import { NEXT_RUN_MANUAL } from '../../src/procedures/last-run-words';
import { ProcedureStateBadge } from '../../src/procedures/ProcedureStateBadge';
import { templateLabel } from '../../src/procedures/labels';
import { isStoppedState } from '../../src/runs/stop-reason';

export const metadata: Metadata = { title: 'Procedures · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Procedures (UX-DR7).
 *
 * Reading is not gated by an action: every signed-in role may see the list, so this
 * page does not ask `requireServerAction` anything. What IS gated is authoring — the
 * "New procedure" action is rendered only for a role the domain policy says may author,
 * and `/procedures/new` refuses the rest on the server. Hiding a control is never the
 * control; it is why the New-procedure surface exists apart from this page.
 *
 * The four cells of a card are UX-DR7's — Active version, Schedule, next Run, last
 * outcome. Each says IN WORDS what it holds or why it holds nothing: a dash or an empty
 * cell is something a reader takes for "fine", and Story 1.6's "Never probed" is the
 * precedent for saying what is not there.
 *
 * `[REPAIRED 2026-09-16, owner finding RUN-05]` Two of the four were written when no Run
 * could exist and had stopped being true: a Procedure with a Run on the register still
 * read "No Runs yet · No outcome". They read facts now. The Run facts are gated on
 * `run.initiate` — the action the Runs register itself is gated on — and are not READ at
 * all for a role that does not hold it.
 */
export default async function ProceduresPage(): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  const mayAuthor = role !== null && authorizeAction(role, PROCEDURE_AUTHOR_ACTION).allowed;
  // The Runs register is gated on `run.initiate`, so the Run facts this card now carries
  // are gated on the same action and read only for a role that holds it. A PoC
  // Administrator may read this list — nothing here is Run data to them — and adding the
  // last Run's outcome to a card without asking would have handed that role exactly what
  // `/runs` refuses it. Hiding a cell is presentation; NOT READING is the control.
  const mayReadRuns = role !== null && authorizeAction(role, 'run.initiate').allowed;

  const runtime = await getRuntime();
  const procedures = await new DrizzleProcedureRepository(runtime.db).listProcedures();
  // The last Run of every Procedure on this page, in ONE statement — a lateral read per
  // card would be a page of Procedures costing a page of round trips. A Procedure with no
  // Run is simply absent from the map, which is a different statement from a Procedure
  // whose Run issued no conclusion (owner finding RUN-05).
  const lastRuns = mayReadRuns
    ? await new DrizzleRunOverviewRepository(runtime.db).latestRunPerProcedure(
        procedures.map((entry) => entry.procedureId),
      )
    : new Map<string, ProcedureLastRun>();
  // Why each of those Runs stopped, read through the SAME statement the Runs list and the
  // Run header use, so a card cannot say one thing about a Run while the register says
  // another.
  const stops = await new DrizzleRunStopReader(runtime.db).readStops(
    [...lastRuns.values()].filter((run) => isStoppedState(run.state)).map((run) => run.runId),
  );

  const newProcedureLink = mayAuthor ? (
    <Link className="ls-button ls-button--primary ls-button--md" href="/procedures/new">
      New procedure
    </Link>
  ) : null;

  if (procedures.length === 0) {
    // The EmptyState's ONLY action is "New procedure" — no other link, no handler; the
    // component's type cannot carry a mutating call to action at all. For a role that
    // may not author, even the link is absent rather than shown and refused.
    return (
      <div className="ls-stack">
        <header className="ls-page-header">
          <h1>Procedures</h1>
          <p>Procedures with their Active version, Schedule, next Run, and last outcome.</p>
        </header>
        <EmptyState
          icon="file-text"
          headline="No Procedures yet."
          sentence="A Procedure and its versions would be listed here, each created from a Template. An empty list does not mean a control passed; it means nothing can be approved, scheduled, or run."
          link={mayAuthor ? { href: '/procedures/new', label: 'New procedure' } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Procedures</h1>
        <p>Procedures with their Active version, Schedule, next Run, and last outcome.</p>
        {newProcedureLink}
      </header>
      <ul className="ls-stack">
        {procedures.map((procedure) => {
          const lastRun = lastRuns.get(procedure.procedureId) ?? null;
          return (
            <ProcedureCard
              key={procedure.procedureId}
              procedure={procedure}
              lastRun={lastRun}
              stop={lastRun === null ? null : stops.get(lastRun.runId) ?? null}
              runsVisible={mayReadRuns}
            />
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The words STATUS_VOCABULARY spells the states with are chosen in `labels.ts`, once,
 * beside the badge that renders them.
 *
 * `[REPAIRED 2026-09-16, owner finding RUN-05]` Two of the four UX-DR7 cells had nothing
 * behind them and said so with sentences that had stopped being true. "No Runs yet" under
 * Next Run answered a question about the FUTURE with a claim about HISTORY, on a card
 * whose Procedure had a Run on the register; and "No outcome" under Last outcome reported
 * a Run that issued no conclusion as though no Run had ever happened. Both cells read
 * facts now. The other two are genuinely absent in this release and keep the contract's
 * own sentences from `copy.ts`.
 */
function ProcedureCard({
  procedure,
  lastRun,
  stop,
  runsVisible,
}: {
  readonly procedure: ProcedureSummary;
  /** The Procedure's latest Run, or `null` when it has never had one. */
  readonly lastRun: ProcedureLastRun | null;
  /** Why that Run stopped, when it stopped. */
  readonly stop: RunStopFacts | null;
  /** Whether this role may see Runs at all. `false` reads nothing and says so. */
  readonly runsVisible: boolean;
}): React.JSX.Element {
  const version =
    procedure.activeVersionState === null ? null : (
      <ProcedureStateBadge state={procedure.activeVersionState} />
    );

  return (
    <li className="ls-card">
      <h2 className="ls-card__title">
        {/* The Control name, linked to the Detail — the row's way onward (UX-DR7). */}
        <Link href={`/procedures/${procedure.procedureId}`}>{procedure.controlName}</Link>
      </h2>
      <p className="ls-caption">
        Template {procedure.templateId} · {templateLabel(procedure.templateId)}
      </p>
      <dl className="ls-card__cells">
        <div>
          <dt>Active version</dt>
          <dd>{version ?? PROCEDURE_CARD_ABSENT.activeVersion}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>{PROCEDURE_CARD_ABSENT.schedule}</dd>
        </div>
        <div>
          <dt>Next Run</dt>
          {/* Not "No Runs yet": there is no scheduler in this release (Epic 8), and
              Initiate Run has been on the Procedure page since Story 3.1. What is true is
              that a person starts a Run and nothing else does. */}
          <dd>{NEXT_RUN_MANUAL}</dd>
        </div>
        <div>
          <dt>Last outcome</dt>
          <dd>
            <LastRunSummary run={lastRun} facts={stop} visible={runsVisible} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
