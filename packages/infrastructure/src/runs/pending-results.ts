import { ACTIVE_RUN_STATES } from '@intellifin/domain';
import { sql } from 'drizzle-orm';

import type { Database, Transaction } from '../db/client.js';

/**
 * The Runs whose Result is waiting for a person (UI cleanup 2026-09-22, UX-01, UX-35).
 *
 * The owner's walkthrough found the Overview's "Needs attention" list naming Escalations,
 * flags, submitted versions and stopped Runs — and saying, in a footnote, that a Result
 * awaiting confirmation "is not listed here in this release". It was not true: Story 4.9
 * holds an Agent-Judged Result open at `PENDING_CONFIRMATION` until a person confirms or
 * rejects each machine proposal, and the Run Detail Result tab has carried that review
 * since. A finished test whose conclusion is waiting on the reader is the single most
 * actionable thing the platform can show them, and it was the one thing the list left out.
 *
 * `run_result_sealed` (generation 25) is `sealed = (outcome <> 'PENDING_CONFIRMATION')`,
 * so "unsealed" and "Pending Confirmation" are the same set by construction — the
 * predicate reads `sealed` and the outcome is returned beside it, rather than two
 * conditions that could drift apart.
 *
 * It is NOT a filter over a page of {@link DrizzleRunListRepository.listRuns}: that read
 * is a keyset page over every Run newest first, so filtering one page of it answers "the
 * pending Results among the newest 25", and a summary that said nothing needs attention
 * because three of them fell off the end of a page is exactly the defect the Overview was
 * repaired for once already (RUN-04). The state filter and the exact count belong in SQL.
 */

/** How many pending Results one surface names at once. The count beside them is exact. */
export const PENDING_RESULT_LIMIT = 10;

/**
 * Who sees a Run's pending Result.
 *
 * The inbox's own rule, one surface along: the person who started the Run, or any Audit
 * Manager, and only a role that supervises audits at all. It is written out here rather
 * than imported from the notification repository because that predicate is about an OPEN
 * WAIT and this one is about a RESULT — sharing a function would make a later change to
 * one silently change the other. What must not drift is the SHAPE, and the integration
 * test asserts both halves of it (a stranger sees nothing; a manager sees another
 * person's Run).
 */
function pendingResultAccess(session: PendingResultReader): ReturnType<typeof sql> {
  return sql`EXISTS (
      SELECT 1 FROM user_role access_role
      WHERE access_role.user_id = ${session.userId} AND access_role.role IN ('auditor','audit-manager')
    )
    AND (
      r.initiator_id = ${session.userId}
      OR EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = ${session.userId} AND ur.role = 'audit-manager')
    )`;
}

/** Who is asking. Only the user id: a role is read per request and never cached (AD-7). */
export interface PendingResultReader {
  readonly userId: string;
}

/** One Run whose conclusion is waiting for the reader's confirmation. */
export interface PendingResultRow {
  readonly runId: string;
  readonly procedureId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly period: { readonly from: string; readonly to: string };
  readonly initiatorId: string;
  readonly initiatedAt: string;
  /** When the unsealed Result was written. A `PENDING_CONFIRMATION` Result is not final. */
  readonly resultAt: string;
  /**
   * How many conditions still need a decision, counting the human decisions already made.
   *
   * `run_evaluation_review` is an append-only ledger over the immutable machine rows, so
   * the effective confirmation is the review's when one exists and the machine row's
   * otherwise — the same `CASE` `readPendingEvaluationCount` applies on Run Detail, so the
   * attention item and the Result tab cannot disagree about how much is left.
   */
  readonly pendingEvaluations: number;
}

export interface PendingResultPage {
  readonly rows: readonly PendingResultRow[];
  /** Every pending Result this reader may see, counted, not only the ones on this page. */
  readonly total: number;
}

interface RawPendingRow extends Record<string, unknown> {
  run_id: string;
  procedure_id: string;
  procedure_name: string;
  version_number: number;
  period_from: string;
  period_to: string;
  initiator_id: string;
  initiated_at: Date | string;
  result_at: Date | string;
  pending_evaluations: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The ACTIVE Run states as a SQL list, for {@link DrizzleActiveRunCounter}.
 *
 * Interpolated rather than bound, for the reason every list in this package is: a bound JS
 * array becomes a RECORD — `($1,$2,…)` — which PostgreSQL will not cast to `text[]`. The
 * assertion is what keeps the interpolation safe, and the vocabulary is the domain's own,
 * so a state added there reaches this count instead of silently falling out of it.
 */
const ACTIVE = [...ACTIVE_RUN_STATES];
for (const state of ACTIVE) {
  if (!/^[A-Z_]+$/.test(state)) throw new Error(`Unsafe Run state constant: ${state}`);
}
const ACTIVE_LIST = sql.raw(ACTIVE.map((state) => `'${state}'`).join(', '));

export class DrizzlePendingResultReader {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * The Runs waiting for this person's confirmation, oldest first, bounded — and how many
   * there are.
   *
   * Oldest first, unlike every other list on these surfaces: this is a QUEUE of work, and
   * the Run that has been waiting longest is the one to do next. The Runs register stays
   * newest-first, because that is a register and not a queue.
   */
  async listPendingResults(
    session: PendingResultReader,
    limit = PENDING_RESULT_LIMIT,
  ): Promise<PendingResultPage> {
    const size =
      Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, PENDING_RESULT_LIMIT) : PENDING_RESULT_LIMIT;
    const rows = await this.db.execute<RawPendingRow>(sql`
      SELECT r.run_id::text AS run_id, r.procedure_id::text AS procedure_id, r.procedure_name,
             r.version_number, r.period_from::text AS period_from, r.period_to::text AS period_to,
             r.initiator_id, r.initiated_at, res.sealed_at AS result_at,
             coalesce(pending.total, 0)::int AS pending_evaluations
      FROM audit_run r
      INNER JOIN run_result res ON res.run_id = r.run_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS total
        FROM run_observation_evaluation e
        LEFT JOIN run_evaluation_review h
          ON h.run_id = e.run_id AND h.observation_id = e.observation_id
         AND h.condition_id = e.condition_id
        WHERE e.run_id = r.run_id
          AND (CASE WHEN h.decision_id IS NULL THEN e.confirmation ELSE h.effective_confirmation END) = 'pending'
      ) pending ON true
      WHERE res.sealed = false AND ${pendingResultAccess(session)}
      ORDER BY res.sealed_at ASC, r.run_id ASC
      LIMIT ${size}`);
    // Its own statement: `rows.length` after a `LIMIT` is the bound, never a count.
    const counted = await this.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM audit_run r INNER JOIN run_result res ON res.run_id = r.run_id
      WHERE res.sealed = false AND ${pendingResultAccess(session)}`);
    return {
      rows: rows.map((row): PendingResultRow => ({
        runId: row.run_id,
        procedureId: row.procedure_id,
        procedureName: row.procedure_name,
        versionNumber: Number(row.version_number),
        period: { from: row.period_from, to: row.period_to },
        initiatorId: row.initiator_id,
        initiatedAt: iso(row.initiated_at),
        resultAt: iso(row.result_at),
        pendingEvaluations: Number(row.pending_evaluations),
      })),
      total: Number(counted[0]?.total ?? 0),
    };
  }

  /**
   * How many pending Results this reader has, and nothing else.
   *
   * The Reviews sidebar count adds this to the submitted-version count, and a count is a
   * different question from a page — the inbox learned that once already, where a bounded
   * list and an unbounded count disagreed with nothing on the page explaining the gap.
   */
  async countPendingResults(session: PendingResultReader): Promise<number> {
    const counted = await this.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM audit_run r INNER JOIN run_result res ON res.run_id = r.run_id
      WHERE res.sealed = false AND ${pendingResultAccess(session)}`);
    const total = Number(counted[0]?.total ?? 0);
    // A count that could not be read is not zero. `countOpenFor` throws for the same
    // reason: the sidebar shows no count at all when it does not know one, and a
    // fabricated zero would say every Run has been dealt with.
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error('Pending Result count could not be read');
    }
    return total;
  }
}

/**
 * How many Runs are in flight, for the sidebar's Runs count.
 *
 * EXPERIENCE.md → Information Architecture puts a count of ACTIVE Runs on the Runs item
 * and one of items awaiting review on Reviews, and nothing had ever supplied either — the
 * `SidebarCounts` doc comment said as much ("Nothing supplies these yet"). An exact count
 * over the whole table, never `rows.length` of the first page of the register.
 *
 * It counts every active Run in the deployment rather than the reader's own, because that
 * is what the Runs register itself lists: the count on a nav item has to be the number of
 * rows the item leads to, or the item lies about where it goes.
 */
export class DrizzleActiveRunCounter {
  constructor(private readonly db: Database | Transaction) {}

  async countActiveRuns(): Promise<number> {
    const counted = await this.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM audit_run r WHERE r.state IN (${ACTIVE_LIST})`,
    );
    const total = Number(counted[0]?.total ?? 0);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error('Active Run count could not be read');
    }
    return total;
  }
}
