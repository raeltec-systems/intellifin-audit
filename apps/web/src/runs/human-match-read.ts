import {
  DrizzleActorNameReader,
  readHumanMatches,
  readRunHumanMatches,
  type Database,
  type RunHumanMatch,
  type RunHumanMatchSelector,
  type Transaction,
} from '@intellifin/infrastructure';

import type { HumanMatchIndex } from './HumanMatch';

type ReadHandle = Database | Transaction;

/**
 * The server read behind every surface that shows a human-selected match (Story 10.6,
 * legacy 4.7): the decisions, and the names of the people who made them.
 *
 * Kept apart from `HumanMatch.tsx` so a component, which unit tests render with no
 * database, never imports the database at runtime. The handle is the caller's: a surface
 * that reads its rows inside one transaction passes that transaction, so the match cannot
 * be paired with a different snapshot of the record it describes.
 */
async function withNames(db: ReadHandle, matches: readonly RunHumanMatch[]): Promise<HumanMatchIndex> {
  const people = matches.flatMap((match) => match.decision.state === 'linked' ? [match.decision.decidedBy] : []);
  const names = people.length === 0 ? new Map<string, string>() : await new DrizzleActorNameReader(db).namesFor(people);
  return { matches, names };
}

/** The human matches among the Observations or records a surface shows. */
export async function readHumanMatchIndex(
  db: ReadHandle,
  runId: string,
  selector: RunHumanMatchSelector,
): Promise<HumanMatchIndex> {
  return withNames(db, await readHumanMatches(db, runId, selector));
}

/** Every human match of a Run: the exact total, and a bounded list with its names. */
export async function readRunHumanMatchList(
  db: ReadHandle,
  runId: string,
): Promise<HumanMatchIndex & { readonly total: number }> {
  const read = await readRunHumanMatches(db, runId);
  return { ...(await withNames(db, read.rows)), total: read.total };
}
