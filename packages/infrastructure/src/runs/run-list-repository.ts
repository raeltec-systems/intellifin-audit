import { inArray, sql } from 'drizzle-orm';
import {
  ACTIVE_RUN_STATES,
  RUN_STOP_STATES,
  type RunKind,
  type RunState,
  type RunStopState,
  type SystemOutcome,
} from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { runException } from '../db/schema.js';

/**
 * The Runs LIST read (Story 3.11).
 *
 * Its own query, because a surface must not borrow another read's shape and a background
 * job must not borrow a surface's (Story 1.8, `listActiveProbeTargets`). `findRun` answers
 * one Run in full; this answers many Runs in exactly the ten columns EXPERIENCE.md's Runs
 * table names — Run, Procedure, Effective period, Lifecycle, Result outcome, Gate, Review,
 * Initiator, Elapsed, Change — and nothing else. No plan, no publication document, no
 * Evidence, no per-record anything: a hundred Runs on one page must not carry a hundred
 * sealed Results through the render.
 *
 * The order is `initiated_at DESC, run_id DESC`. `run_id` is a UUIDv7 and so already
 * time-ordered, which makes it a deterministic tiebreak rather than an arbitrary one — and
 * a keyset page needs a TOTAL order or a row can appear on two pages, or on none.
 */

/** How many rows one page of the Runs table holds. Pagination, never infinite scroll. */
export const RUN_LIST_PAGE_SIZE = 25;

/**
 * The active states, as a SQL list.
 *
 * Interpolated rather than bound, because a bound JS array becomes a record — `($1,$2,…)`
 * — which PostgreSQL will not cast to `text[]`. It is safe to interpolate because these
 * are a frozen domain constant and not request input, and the assertion below is what
 * keeps that true: a state carrying anything but `A-Z` and `_` refuses to build the query
 * at module load rather than reaching the database.
 */
const ACTIVE = [...ACTIVE_RUN_STATES];
for (const state of ACTIVE) {
  if (!/^[A-Z_]+$/.test(state)) throw new Error(`Unsafe Run state constant: ${state}`);
}
const ACTIVE_LIST = sql.raw(ACTIVE.map((state) => `'${state}'`).join(', '));

/**
 * How this Run's findings compare with the previous terminal Run of the same Procedure.
 *
 * Story 3.7 gives every Exception an HMAC fingerprint over five keys with the RUN
 * DELIBERATELY ABSENT, precisely so the same finding recurring in a later Run is
 * recognisable as the same finding. That is what makes this column computable now.
 *
 * `incomparable` is the state EXPERIENCE.md's rail card names: the comparison is only
 * valid across compatible versions, and two different Procedure Versions are two
 * different definitions of the control — a finding that "disappeared" may simply be a
 * condition the newer version no longer states.
 */
export type RunListChange =
  | { readonly kind: 'absent' }
  | { readonly kind: 'incomparable' }
  | { readonly kind: 'compared'; readonly added: number; readonly resolved: number };

export interface RunListRow {
  readonly runId: string;
  readonly procedureId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly period: { readonly from: string; readonly to: string };
  readonly state: RunState;
  readonly kind: RunKind;
  /** `null` while no Result has been published — which is not the same as no conclusion. */
  readonly outcome: SystemOutcome | null;
  readonly resultSealed: boolean | null;
  /** §H rows written for this Run, and how many of them failed. Zero means never run. */
  readonly gateChecks: number;
  readonly gateFailed: number;
  readonly initiatorId: string;
  readonly initiatedAt: string;
  /** When the Run concluded, from the sealed Result. `null` while it has not. */
  readonly endedAt: string | null;
  readonly change: RunListChange;
}

export interface RunListPage {
  readonly rows: readonly RunListRow[];
  /** The `run_id` to pass as `after` for the next page, or `null` at the end. */
  readonly next: string | null;
}

interface RawRow extends Record<string, unknown> {
  run_id: string;
  procedure_id: string;
  procedure_name: string;
  version_number: number;
  period_from: string;
  period_to: string;
  state: string;
  kind: string;
  initiator_id: string;
  initiated_at: Date | string;
  outcome: string | null;
  result_sealed: boolean | null;
  ended_at: Date | string | null;
  gate_checks: number;
  gate_failed: number;
  previous_run_id: string | null;
  previous_version_id: string | null;
  version_id: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class DrizzleRunListRepository {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * One page of Runs, newest first.
   *
   * `after` is the `run_id` of the last row of the previous page. A cursor naming a Run
   * that is not there is treated as no cursor at all rather than as an error: it comes
   * from the query string, and a person who edits a URL should meet the first page, not a
   * 500. `isUuidText` guards it before PostgreSQL is asked to compare a `uuid` column
   * against text that is not one (`22P02`).
   */
  async listRuns(after?: string | null, limit = RUN_LIST_PAGE_SIZE): Promise<RunListPage> {
    const requested = typeof after === 'string' && isUuidText(after) ? after : null;
    const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, RUN_LIST_PAGE_SIZE) : RUN_LIST_PAGE_SIZE;
    // The cursor is RESOLVED to the pair it names, and a cursor naming no Run is treated as
    // no cursor at all. It used to be compared against a scalar subquery inline, so a
    // syntactically valid UUID that names nothing made `(initiated_at, run_id) < NULL` — NULL
    // for every row — and the page came back EMPTY. An empty page is neither the first page
    // nor an error: it says this deployment has no Runs, to somebody who edited a URL.
    //
    // `initiated_at` comes back as TEXT and goes back as `::timestamptz`, so the pair is
    // exact: `timestamptz` keeps microseconds and a JavaScript `Date` keeps milliseconds, so
    // a round trip through one would truncate the cursor DOWNWARD and silently skip every
    // Run sharing that millisecond — a row on no page at all, which is the failure the total
    // order above exists to prevent.
    const cursor =
      requested === null
        ? null
        : ((
            await this.db.execute<{ initiated_at: string; run_id: string }>(
              sql`SELECT c.initiated_at::text AS initiated_at, c.run_id::text AS run_id
                  FROM audit_run c WHERE c.run_id = ${requested}::uuid`,
            )
          )[0] ?? null);
    const rows = await this.db.execute<RawRow>(sql`
      SELECT r.run_id::text AS run_id, r.procedure_id::text AS procedure_id, r.procedure_name,
             r.version_id::text AS version_id, r.version_number,
             r.period_from::text AS period_from, r.period_to::text AS period_to,
             r.state, r.kind, r.initiator_id, r.initiated_at,
             res.outcome, res.sealed AS result_sealed, res.sealed_at AS ended_at,
             coalesce(gate.checks, 0)::int AS gate_checks,
             coalesce(gate.failed, 0)::int AS gate_failed,
             prev.run_id::text AS previous_run_id, prev.version_id::text AS previous_version_id
      FROM audit_run r
      LEFT JOIN run_result res ON res.run_id = r.run_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS checks,
               count(*) FILTER (WHERE g.outcome = 'FAIL')::int AS failed
        FROM run_gate_check g WHERE g.run_id = r.run_id
      ) gate ON true
      LEFT JOIN LATERAL (
        SELECT q.run_id, q.version_id FROM audit_run q
        WHERE q.procedure_id = r.procedure_id
          AND q.state NOT IN (${ACTIVE_LIST})
          AND (q.initiated_at, q.run_id) < (r.initiated_at, r.run_id)
        ORDER BY q.initiated_at DESC, q.run_id DESC LIMIT 1
      ) prev ON true
      ${cursor === null
        ? sql``
        : sql`WHERE (r.initiated_at, r.run_id) <
                (${cursor.initiated_at}::timestamptz, ${cursor.run_id}::uuid)`}
      ORDER BY r.initiated_at DESC, r.run_id DESC
      LIMIT ${size + 1}`);

    const page = rows.slice(0, size);
    // Every fingerprint this page's Runs and their predecessors raised, in ONE statement.
    // A query per row would be a page of Runs costing a page of round trips.
    const ids = [
      ...new Set(
        page.flatMap((row) => [row.run_id, row.previous_run_id]).filter((id): id is string => id !== null),
      ),
    ];
    const fingerprints = new Map<string, Set<string>>();
    if (ids.length > 0) {
      // Through the query builder, not raw SQL: a bound JS array becomes a record —
      // `($1,$2,…)` — which PostgreSQL will not cast to `uuid[]`.
      const found = await this.db
        .select({ runId: runException.runId, fingerprint: runException.fingerprint })
        .from(runException)
        .where(inArray(runException.runId, ids));
      for (const entry of found) {
        const set = fingerprints.get(entry.runId) ?? new Set<string>();
        set.add(entry.fingerprint);
        fingerprints.set(entry.runId, set);
      }
    }

    return {
      rows: page.map((row): RunListRow => ({
        runId: row.run_id,
        procedureId: row.procedure_id,
        procedureName: row.procedure_name,
        versionNumber: row.version_number,
        period: { from: row.period_from, to: row.period_to },
        state: row.state as RunState,
        kind: row.kind as RunKind,
        outcome: (row.outcome as SystemOutcome | null) ?? null,
        resultSealed: row.result_sealed,
        gateChecks: Number(row.gate_checks),
        gateFailed: Number(row.gate_failed),
        initiatorId: row.initiator_id,
        initiatedAt: iso(row.initiated_at),
        endedAt: row.ended_at === null ? null : iso(row.ended_at),
        change: changeFor(row, fingerprints),
      })),
      next: rows.length > size ? (page.at(-1)?.run_id ?? null) : null,
    };
  }
}

/**
 * The Change cell for one row.
 *
 * A Run that has not concluded has no findings to compare, so it reports absence rather
 * than a diff against a set that is still being written. A Run whose predecessor ran a
 * DIFFERENT Procedure Version reports `incomparable`: the same fingerprint set can move
 * because the control's definition moved, and calling that "resolved" would be a claim
 * nobody checked.
 */
function changeFor(row: RawRow, fingerprints: ReadonlyMap<string, ReadonlySet<string>>): RunListChange {
  if ((ACTIVE as readonly string[]).includes(row.state)) return { kind: 'absent' };
  if (row.previous_run_id === null) return { kind: 'absent' };
  if (row.previous_version_id !== row.version_id) return { kind: 'incomparable' };
  const now = fingerprints.get(row.run_id) ?? new Set<string>();
  const before = fingerprints.get(row.previous_run_id) ?? new Set<string>();
  let added = 0;
  for (const value of now) if (!before.has(value)) added += 1;
  let resolved = 0;
  for (const value of before) if (!now.has(value)) resolved += 1;
  return { kind: 'compared', added, resolved };
}

/* --------------------------------------------- the Overview's two extra reads --- */

/**
 * How many stopped Runs the Overview names at once, and how many Procedures one page of
 * the Procedures list may ask about.
 *
 * Both are bounds on a SURFACE's read rather than on the table: the counts beside them are
 * EXACT, so a list that cannot show everything says how many there are instead of leaving
 * the reader to infer a total from the rows it happened to fit (`run_gate_check`'s
 * total-beside-a-sample shape, and the inbox's "Showing the first N of M").
 */
export const RUN_ATTENTION_LIMIT = 10;
export const PROCEDURE_LAST_RUN_LIMIT = 200;

/**
 * The two states that mean a Run stopped without issuing a conclusion, as a SQL list.
 *
 * Interpolated rather than bound, for the reason `ACTIVE_LIST` above is: a bound JS array
 * becomes a record — `($1,$2,…)` — which PostgreSQL will not cast to `text[]`. The
 * assertion is what keeps the interpolation safe, and the vocabulary is the domain's own
 * `RUN_STOP_STATES` rather than two literals typed here, so a state added there reaches
 * this read instead of silently falling out of the Overview.
 */
const STOPPED = [...RUN_STOP_STATES];
for (const state of STOPPED) {
  if (!/^[A-Z_]+$/.test(state)) throw new Error(`Unsafe Run stop state constant: ${state}`);
}
const STOPPED_LIST = sql.raw(STOPPED.map((state) => `'${state}'`).join(', '));

/**
 * The contract's order WITHIN the stopped group, as a SQL rank.
 *
 * EXPERIENCE.md orders the Overview's attention items "… Inconclusive · Run Failed …", and
 * `RUN_STOP_STATES` is already in that order, so the rank is built from the array's own
 * index rather than from two literals typed here. Ordering by time alone interleaved the
 * two states and then applied the ten-row bound to the mixture, so ten recent failures
 * could hide every Inconclusive Run — a Run that produced Evidence and could not conclude
 * is the one an auditor acts on first, and it is the one that fell off. Found by Codex on
 * PR 40.
 */
const STOPPED_RANK = sql.raw(
  `CASE r.state ${STOPPED.map((state, index) => `WHEN '${state}' THEN ${index}`).join(' ')} ELSE ${STOPPED.length} END`,
);

/** One Run that stopped before it concluded, as the Overview's attention list names it. */
export interface StoppedRunRow {
  readonly runId: string;
  readonly procedureId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly period: { readonly from: string; readonly to: string };
  readonly state: RunStopState;
  readonly initiatorId: string;
  readonly initiatedAt: string;
  /** When the Run concluded, from the sealed Result. `null` while it has not. */
  readonly endedAt: string | null;
}

export interface StoppedRunPage {
  readonly rows: readonly StoppedRunRow[];
  /** Every stopped Run, counted, not only the ones this page holds. */
  readonly total: number;
}

/** The last Run of one Procedure, whatever state it is in. */
export interface ProcedureLastRun {
  readonly procedureId: string;
  readonly runId: string;
  readonly state: RunState;
  readonly kind: RunKind;
  readonly initiatedAt: string;
  readonly endedAt: string | null;
  /** `null` while no Result has been published — which is not the same as no conclusion. */
  readonly outcome: SystemOutcome | null;
  /** §H rows written for this Run, and how many of them failed. Zero means never run. */
  readonly gateChecks: number;
  readonly gateFailed: number;
}

interface RawStoppedRow extends Record<string, unknown> {
  run_id: string;
  procedure_id: string;
  procedure_name: string;
  version_number: number;
  period_from: string;
  period_to: string;
  state: string;
  initiator_id: string;
  initiated_at: Date | string;
  ended_at: Date | string | null;
}

interface RawLastRunRow extends Record<string, unknown> {
  procedure_id: string;
  run_id: string;
  state: string;
  kind: string;
  initiated_at: Date | string;
  ended_at: Date | string | null;
  outcome: string | null;
  gate_checks: number;
  gate_failed: number;
}

/**
 * The two reads the Overview and the Procedures list need, which no existing read answers.
 *
 * Neither is a filter applied to a page of {@link DrizzleRunListRepository.listRuns}. That
 * read is a keyset page over EVERY Run newest first, so filtering one page of it for
 * stopped Runs answers "the stopped Runs among the newest 25" — and a summary that says
 * "nothing needs attention" because three Run Failed Runs fell off the end of a page is
 * exactly the defect the owner found (RUN-04). The state filter and the count belong in
 * SQL, and the same rule sends the per-Procedure last Run here rather than into a query
 * per card.
 */
export class DrizzleRunOverviewRepository {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * The Runs that stopped without a conclusion, newest first, bounded — and the exact
   * number of them.
   *
   * The caller reads the REASON each one stopped through `DrizzleRunStopReader`, which is
   * the same statement the Runs list uses, so the Overview and the register cannot say
   * different things about one Run.
   */
  async listStoppedRuns(limit = RUN_ATTENTION_LIMIT): Promise<StoppedRunPage> {
    const size =
      Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, RUN_ATTENTION_LIMIT) : RUN_ATTENTION_LIMIT;
    const rows = await this.db.execute<RawStoppedRow>(sql`
      SELECT r.run_id::text AS run_id, r.procedure_id::text AS procedure_id, r.procedure_name,
             r.version_number, r.period_from::text AS period_from, r.period_to::text AS period_to,
             r.state, r.initiator_id, r.initiated_at, res.sealed_at AS ended_at
      FROM audit_run r
      LEFT JOIN run_result res ON res.run_id = r.run_id
      WHERE r.state IN (${STOPPED_LIST})
      ORDER BY ${STOPPED_RANK}, r.initiated_at DESC, r.run_id DESC
      LIMIT ${size}`);
    // A separate statement, because a `LIMIT`ed read cannot also answer how many there
    // are: `rows.length` after a bound is the bound, not a count.
    const counted = await this.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM audit_run r WHERE r.state IN (${STOPPED_LIST})`);
    return {
      rows: rows.map((row): StoppedRunRow => ({
        runId: row.run_id,
        procedureId: row.procedure_id,
        procedureName: row.procedure_name,
        versionNumber: row.version_number,
        period: { from: row.period_from, to: row.period_to },
        state: row.state as RunStopState,
        initiatorId: row.initiator_id,
        initiatedAt: iso(row.initiated_at),
        endedAt: row.ended_at === null ? null : iso(row.ended_at),
      })),
      total: Number(counted[0]?.total ?? 0),
    };
  }

  /**
   * The latest Run of each named Procedure, keyed by Procedure id, in ONE statement.
   *
   * `DISTINCT ON` over the same total order the Runs list pages by, so "the latest" means
   * the same Run on both surfaces. A Procedure with no Run is simply absent from the map —
   * the card then says so in words, which is a different statement from a Procedure whose
   * Run issued no conclusion, and telling those two apart is the whole of RUN-05.
   *
   * ACTIVE as well as terminal: a Run that is still running is the last thing that
   * happened to that Procedure, and hiding it would make the card claim a Procedure has
   * never run while its Run is on the register.
   */
  async latestRunPerProcedure(
    procedureIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProcedureLastRun>> {
    const ids = [...new Set(procedureIds.filter((id) => isUuidText(id)))].slice(0, PROCEDURE_LAST_RUN_LIMIT);
    if (ids.length === 0) return new Map();
    // `sql.join`, not a bound array: a bound JS array becomes a record — `($1,$2,…)` —
    // which PostgreSQL will not cast to `uuid[]`.
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await this.db.execute<RawLastRunRow>(sql`
      SELECT DISTINCT ON (r.procedure_id)
             r.procedure_id::text AS procedure_id, r.run_id::text AS run_id,
             r.state, r.kind, r.initiated_at,
             res.outcome, res.sealed_at AS ended_at,
             coalesce(gate.checks, 0)::int AS gate_checks,
             coalesce(gate.failed, 0)::int AS gate_failed
      FROM audit_run r
      LEFT JOIN run_result res ON res.run_id = r.run_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS checks,
               count(*) FILTER (WHERE g.outcome = 'FAIL')::int AS failed
        FROM run_gate_check g WHERE g.run_id = r.run_id
      ) gate ON true
      WHERE r.procedure_id IN (${idList})
      ORDER BY r.procedure_id, r.initiated_at DESC, r.run_id DESC`);
    return new Map(
      rows.map((row): [string, ProcedureLastRun] => [
        row.procedure_id,
        {
          procedureId: row.procedure_id,
          runId: row.run_id,
          state: row.state as RunState,
          kind: row.kind as RunKind,
          initiatedAt: iso(row.initiated_at),
          endedAt: row.ended_at === null ? null : iso(row.ended_at),
          outcome: (row.outcome as SystemOutcome | null) ?? null,
          gateChecks: Number(row.gate_checks),
          gateFailed: Number(row.gate_failed),
        },
      ]),
    );
  }
}
