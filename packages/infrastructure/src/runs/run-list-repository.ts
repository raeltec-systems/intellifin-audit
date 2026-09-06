import { inArray, sql } from 'drizzle-orm';
import { ACTIVE_RUN_STATES, type RunKind, type RunState, type SystemOutcome } from '@intellifin/domain';
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
    const cursor = typeof after === 'string' && isUuidText(after) ? after : null;
    const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, RUN_LIST_PAGE_SIZE) : RUN_LIST_PAGE_SIZE;
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
                (SELECT c.initiated_at, c.run_id FROM audit_run c WHERE c.run_id = ${cursor}::uuid)`}
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
