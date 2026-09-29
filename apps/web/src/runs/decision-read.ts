import type { ExecutablePlan, RunRecord } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleFrozenExecutionReader,
  readEscalationAnswers,
  readPauseRequests,
  readRecordNames,
  type Database,
  type RunEscalationAnswerHistory,
  type RunPauseRequestHistory,
  type Transaction,
} from '@intellifin/infrastructure';

import { decisionSubjectKeys } from './decision-words';

type ReadHandle = Database | Transaction;

/**
 * The server reads behind the Timeline's decision entries (Story 10.10): every answered
 * Escalation, and every pause request the Run never honoured.
 *
 * Kept apart from the components so a component, which unit tests render with no
 * database, never imports the database at runtime — the `pause-read.ts` split. The caller
 * has already authorized the Run through `openRun`.
 */
export interface EscalationAnswersView {
  readonly answers: RunEscalationAnswerHistory;
  /** The Run's frozen plan, which names each step; `null` names none and the entry says so. */
  readonly plan: ExecutablePlan | null;
  /** Record key to name, from `readRecordNames`, for the records the entries name. */
  readonly recordNames: ReadonlyMap<string, string>;
  /** User id to person's name, from `ActorNameReader`. An id with no name is shown as the id. */
  readonly actorNames: ReadonlyMap<string, string>;
}

export interface PauseRequestsView {
  readonly requests: RunPauseRequestHistory;
  readonly plan: ExecutablePlan | null;
  readonly recordNames: ReadonlyMap<string, string>;
  readonly actorNames: ReadonlyMap<string, string>;
}

export interface DecisionHistoryView {
  readonly escalations: EscalationAnswersView;
  readonly requests: PauseRequestsView;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * Both lists, with what their sentences need to name steps, records and people.
 *
 * `plan` is the frozen plan when the caller already read it; left out, it is read here and
 * only when there is an entry to name a step for.
 */
export async function readDecisionHistoryView(
  db: ReadHandle,
  run: RunRecord,
  plan?: ExecutablePlan | null,
): Promise<DecisionHistoryView> {
  // One after the other: a caller may pass a transaction, and one connection runs one
  // statement at a time anyway.
  const answers = await readEscalationAnswers(db, run.runId);
  const requests = await readPauseRequests(db, run.runId);
  if (answers.total === 0 && requests.total === 0) {
    return {
      escalations: { answers, plan: null, recordNames: NO_NAMES, actorNames: NO_NAMES },
      requests: { requests, plan: null, recordNames: NO_NAMES, actorNames: NO_NAMES },
    };
  }
  const frozen = plan === undefined
    ? await new DrizzleFrozenExecutionReader(db).readFrozenExecution(run.versionId, run.procedureId)
    : plan;
  const keys = decisionSubjectKeys(answers.entries, requests.entries);
  const recordNames = frozen === null || keys.length === 0 ? NO_NAMES : await readRecordNames(db, run.runId, frozen, keys);
  const people = [...new Set([
    ...answers.entries.map((entry) => entry.answeredBy),
    ...requests.entries.flatMap((entry) => (entry.requestedBy === null ? [] : [entry.requestedBy])),
  ])];
  const actorNames = people.length === 0 ? NO_NAMES : await new DrizzleActorNameReader(db).namesFor(people);
  return {
    escalations: { answers, plan: frozen, recordNames, actorNames },
    requests: { requests, plan: frozen, recordNames, actorNames },
  };
}
