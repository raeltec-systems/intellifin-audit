import type { ExecutablePlan, RunRecord } from '@intellifin/domain';
import type { RunWait } from '@intellifin/application';
import {
  DrizzleActorNameReader,
  DrizzleFrozenExecutionReader,
  readPauseEntry,
  readPauseHistory,
  readRecordNames,
  type Database,
  type RunPauseHistory,
  type Transaction,
} from '@intellifin/infrastructure';

import { pauseHoldRead, pauseStepNamer, pauseSubjectKeys, type PauseHoldRead } from './pause-words';

type ReadHandle = Database | Transaction;

/**
 * The server reads behind the pause surfaces (Story 10.6, legacy 5.4): the Timeline's
 * history and the Paused banner's hold.
 *
 * Kept apart from `PauseHistory.tsx` so a component, which unit tests render with no
 * database, never imports the database at runtime — the `human-match-read.ts` split. The
 * callers have already authorized the Run through `openRun`.
 */
export interface PauseHistoryView {
  readonly history: RunPauseHistory;
  readonly plan: ExecutablePlan | null;
  readonly recordNames: ReadonlyMap<string, string>;
  readonly actorNames: ReadonlyMap<string, string>;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

async function frozenPlan(db: ReadHandle, run: RunRecord, plan: ExecutablePlan | null | undefined): Promise<ExecutablePlan | null> {
  return plan === undefined
    ? new DrizzleFrozenExecutionReader(db).readFrozenExecution(run.versionId, run.procedureId)
    : plan;
}

async function recordNamesFor(db: ReadHandle, run: RunRecord, plan: ExecutablePlan | null, keys: readonly string[]): Promise<ReadonlyMap<string, string>> {
  return plan === null || keys.length === 0 ? NO_NAMES : readRecordNames(db, run.runId, plan, keys);
}

/** Every pause of a Run, with what its sentences need to name steps, records and people. */
export async function readPauseHistoryView(db: ReadHandle, run: RunRecord, plan?: ExecutablePlan | null): Promise<PauseHistoryView> {
  const history = await readPauseHistory(db, run.runId);
  if (history.total === 0) return { history, plan: null, recordNames: NO_NAMES, actorNames: NO_NAMES };
  const frozen = await frozenPlan(db, run, plan);
  const people = [...new Set(history.entries.flatMap((entry) => [
    ...(entry.pausedBy === null ? [] : [entry.pausedBy]),
    ...(entry.closure.kind === 'resumed' && entry.closure.resumedBy !== null ? [entry.closure.resumedBy] : []),
  ]))];
  // One after the other: a caller may pass a transaction, and one connection runs one
  // statement at a time anyway.
  const recordNames = await recordNamesFor(db, run, frozen, pauseSubjectKeys(history.entries));
  const actorNames = people.length === 0 ? NO_NAMES : await new DrizzleActorNameReader(db).namesFor(people);
  return { history, plan: frozen, recordNames, actorNames };
}

/**
 * Where the pause holding a PAUSED Run holds it, for the Paused banner.
 *
 * A read that fails is `unreadable`, which the banner says in words: the banner is shown
 * for a Run that IS paused, and a hold it could not read must never look like no hold.
 */
export async function readPauseHold(
  db: ReadHandle,
  run: RunRecord,
  pause: RunWait | null,
  plan?: ExecutablePlan | null,
): Promise<PauseHoldRead> {
  if (run.state !== 'PAUSED' || pause === null) return { kind: 'none' };
  try {
    const entry = await readPauseEntry(db, run.runId, pause.waitId);
    if (entry === null) return { kind: 'unreadable' };
    const frozen = await frozenPlan(db, run, plan);
    const recordNames = await recordNamesFor(db, run, frozen, pauseSubjectKeys([entry]));
    return pauseHoldRead(entry, pauseStepNamer(frozen, recordNames));
  } catch {
    return { kind: 'unreadable' };
  }
}
