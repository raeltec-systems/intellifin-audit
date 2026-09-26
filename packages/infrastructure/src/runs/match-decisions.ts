import { and, asc, count, eq, inArray, or, sql, type SQL } from 'drizzle-orm';

import { ESCALATION_OPTION_IDS } from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { runObservation, runWait } from '../db/schema.js';

/**
 * The decision behind a human-selected match (Story 10.6, legacy 4.7).
 *
 * A record a person matched is stored with `match_origin = 'human-matched'`, and the
 * Result, the record review and the Exceptions list did not show it, so a reader could not
 * tell a human-selected match from a platform match. Since this story a human-matched
 * record is registered WITH the answered choose-candidate wait that matched it, written
 * into the `execution.observations-registered` event in the transaction that stores the
 * row. This read follows exactly that link and nothing else:
 *
 * - `linked` — the registration event names ONE wait for the Observation, and that wait is
 *   this Run's choose-candidate question, closed by an ANSWER that chose a candidate. The
 *   answer, who gave it and when are read off the wait row.
 * - `not-linked` — the Observation was registered before the link existed, or the link does
 *   not establish the decision exactly (no wait, more than one, or a wait that is not an
 *   answered candidate choice). The surface says the decision is not linked; it never lines
 *   a wait up with a record by time.
 *
 * A platform-matched Observation is absent from the answer: it has no decision to show.
 */
export type RunMatchDecision =
  | {
      readonly state: 'linked';
      readonly waitId: string;
      /** The chosen candidate's 1-based position among the candidates the question offered. */
      readonly candidate: number;
      /** How many candidates the question offered (the platform's own options excluded). */
      readonly candidates: number;
      /** The candidate's label as the question offered it: AGENT-GENERATED, rendered inert. */
      readonly candidateLabel: string;
      /** The person who answered, as a user id (a name is resolved by the surface). */
      readonly decidedBy: string;
      readonly decidedAt: string;
    }
  | { readonly state: 'not-linked' };

export interface RunHumanMatch {
  readonly observationId: string;
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  readonly decision: RunMatchDecision;
}

/** Which Observations to answer for: by id, or by the record a Result names. */
export type RunHumanMatchSelector =
  | { readonly observationIds: readonly string[] }
  | { readonly records: readonly { readonly targetSystem: string; readonly populationRecordKey: string }[] };

/**
 * The most selector entries one read accepts.
 *
 * A limit belongs to the cardinality of the READ: the callers pass what one page renders —
 * a record review page (at most 50 rows, each with at most one Observation per selected
 * Target System, so 50 × 32), an Exceptions page (a Run Detail page of 50) and the records a
 * Result names (two bounded samples). `match-decisions` test pins it against those
 * constants. A caller that passes more is a programming error, refused loudly — never
 * truncated, because a dropped entry would render a human-selected match as a platform one.
 */
export const MATCH_DECISION_SELECTOR_LIMIT = 2_000;

/** How many human-matched records the Result lists by name; the total beside it is exact. */
export const HUMAN_MATCH_LIST_LIMIT = 100;

/** The platform's own option ids, which are never a candidate a person chose. */
const PLATFORM_OPTION_IDS: ReadonlySet<string> = new Set(Object.values(ESCALATION_OPTION_IDS));

interface Option { readonly id: string; readonly label: string }

function options(value: unknown): readonly Option[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: Option[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const id: unknown = (entry as Record<string, unknown>)['id'];
    const label: unknown = (entry as Record<string, unknown>)['label'];
    if (typeof id !== 'string' || typeof label !== 'string') return null;
    parsed.push({ id, label });
  }
  return parsed;
}

interface HumanRow { readonly observationId: string; readonly targetSystem: string; readonly populationRecordKey: string }

/** The decision for each human-matched row, read from the link its registration recorded. */
async function withDecisions(
  db: Database | Transaction,
  runId: string,
  human: readonly HumanRow[],
): Promise<readonly RunHumanMatch[]> {
  if (human.length === 0) return [];
  const wanted = [...new Set(human.map((row) => row.observationId))];
  // Every link this Run's registrations recorded for these Observations. One event per
  // registered batch, and only an event whose batch held a human-selected match carries
  // the key at all, so an event written before this story contributes nothing.
  const linkRows = await db.execute<{ observation_id: string | null; wait_id: string | null }>(sql`
    SELECT link->>'observationId' AS observation_id, link->>'waitId' AS wait_id
    FROM audit_events event
    CROSS JOIN LATERAL jsonb_array_elements(event.payload->'humanMatchDecisions') AS link
    WHERE event.aggregate_id = ${runId}
      AND event.event_type = 'execution.observations-registered'
      AND jsonb_typeof(event.payload->'humanMatchDecisions') = 'array'
      AND jsonb_typeof(link) = 'object'
      AND link->>'observationId' IN (${sql.join(wanted.map((id) => sql`${id}`), sql`, `)})`);
  const links = new Map<string, Set<string>>();
  for (const row of linkRows) {
    if (row.observation_id === null || row.wait_id === null) continue;
    const named = links.get(row.observation_id) ?? new Set<string>();
    named.add(row.wait_id);
    links.set(row.observation_id, named);
  }
  const waitIds = [...new Set([...links.values()].flatMap((named) => [...named]))].filter(isUuidText);
  const waits = waitIds.length === 0 ? [] : await db
    .select()
    .from(runWait)
    .where(and(eq(runWait.runId, runId), inArray(runWait.waitId, waitIds)));
  const waitById = new Map(waits.map((wait) => [wait.waitId, wait]));

  const decisionFor = (observationId: string): RunMatchDecision => {
    const named = links.get(observationId);
    // No link, or more than one: neither establishes the decision exactly.
    if (named === undefined || named.size !== 1) return { state: 'not-linked' };
    const waitId = [...named][0]!;
    // A wait of ANOTHER Run is not read at all (the query is bound to this Run), so a link
    // naming one falls through here as unknown rather than borrowing its answer.
    const wait = waitById.get(waitId);
    if (wait === undefined || wait.kind !== 'choose-candidate' || wait.closureKind !== 'answer' ||
        wait.answerOptionId === null || PLATFORM_OPTION_IDS.has(wait.answerOptionId) ||
        wait.actor === null || wait.closedAt === null) return { state: 'not-linked' };
    const offered = options(wait.options);
    if (offered === null) return { state: 'not-linked' };
    const candidates = offered.filter((option) => !PLATFORM_OPTION_IDS.has(option.id));
    const position = candidates.findIndex((option) => option.id === wait.answerOptionId);
    if (position < 0) return { state: 'not-linked' };
    return {
      state: 'linked',
      waitId,
      candidate: position + 1,
      candidates: candidates.length,
      candidateLabel: candidates[position]!.label,
      decidedBy: wait.actor,
      decidedAt: wait.closedAt.toISOString(),
    };
  };

  return human.map((row) => ({
    observationId: row.observationId,
    targetSystem: row.targetSystem,
    populationRecordKey: row.populationRecordKey,
    decision: decisionFor(row.observationId),
  }));
}

const HUMAN_COLUMNS = {
  observationId: runObservation.observationId,
  targetSystem: runObservation.targetSystem,
  populationRecordKey: runObservation.populationRecordKey,
};

const HUMAN_ORDER = [
  asc(runObservation.targetSystem),
  asc(runObservation.populationRecordKey),
  asc(runObservation.observationId),
] as const;

/**
 * The human-matched Observations among those selected, each with its decision.
 *
 * Three statements, none of which reads a timestamp to pair anything: the Observations, the
 * links this Run's registration events recorded, and the waits those links name. The answer
 * is bounded by the selection itself — an Observation id names at most one row, and the
 * selection is refused above `MATCH_DECISION_SELECTOR_LIMIT` rather than cut.
 */
export async function readHumanMatches(
  db: Database | Transaction,
  runId: string,
  selector: RunHumanMatchSelector,
): Promise<readonly RunHumanMatch[]> {
  const size = 'observationIds' in selector ? selector.observationIds.length : selector.records.length;
  if (size > MATCH_DECISION_SELECTOR_LIMIT) {
    throw new RangeError(`A human-match read takes at most ${MATCH_DECISION_SELECTOR_LIMIT} entries.`);
  }
  if (!isUuidText(runId)) return [];
  let bySelector: SQL | undefined;
  if ('observationIds' in selector) {
    const ids = [...new Set(selector.observationIds.filter(isUuidText))];
    if (ids.length === 0) return [];
    bySelector = inArray(runObservation.observationId, ids);
  } else {
    if (selector.records.length === 0) return [];
    bySelector = or(...selector.records.map((record) => and(
      eq(runObservation.targetSystem, record.targetSystem),
      eq(runObservation.populationRecordKey, record.populationRecordKey),
    )));
  }
  const human = await db
    .select(HUMAN_COLUMNS)
    .from(runObservation)
    .where(and(eq(runObservation.runId, runId), eq(runObservation.matchOrigin, 'human-matched'), bySelector))
    .orderBy(...HUMAN_ORDER);
  return withDecisions(db, runId, human);
}

/**
 * Every human-matched Observation of a Run: the exact total, and the first
 * `HUMAN_MATCH_LIST_LIMIT` of them with their decisions, in record order.
 *
 * The Result names only the records that were Exceptions or were left Unevaluated, so a
 * record a person matched and that then passed would appear nowhere on it. This is the read
 * behind the Result's own list of the records a person matched.
 */
export async function readRunHumanMatches(
  db: Database | Transaction,
  runId: string,
  limit = HUMAN_MATCH_LIST_LIMIT,
): Promise<{ readonly total: number; readonly rows: readonly RunHumanMatch[] }> {
  if (!isUuidText(runId)) return { total: 0, rows: [] };
  const bound = Math.max(0, Math.min(Math.trunc(limit), HUMAN_MATCH_LIST_LIMIT));
  const where = and(eq(runObservation.runId, runId), eq(runObservation.matchOrigin, 'human-matched'));
  const [counted] = await db.select({ total: count() }).from(runObservation).where(where);
  const total = Number(counted?.total ?? 0);
  if (total === 0 || bound === 0) return { total, rows: [] };
  const human = await db.select(HUMAN_COLUMNS).from(runObservation).where(where).orderBy(...HUMAN_ORDER).limit(bound);
  return { total, rows: await withDecisions(db, runId, human) };
}
