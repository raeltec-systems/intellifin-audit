import { sql } from 'drizzle-orm';
import { isOutcomeRowId, type OutcomeRowId, type RunState } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { RUN_LIST_PAGE_SIZE } from './run-list-repository.js';

/**
 * Why a Run stopped, read from the checkpoints the stages left behind.
 *
 * A Run that ends before its Evidence Quality Gate — the population snapshot was stale,
 * the workspace provider refused, a Reference Source could not be reached — records WHY
 * in exactly one place: the stage's own durable checkpoint, as a closed diagnostic. Until
 * now the only surface that read it was the Execution Timeline, which printed the code
 * word in monospace (`freshness`) under a row nobody opened, and the Runs list and the Run
 * header said only "Inconclusive" and "No conclusion issued". The owner read a page of
 * such Runs as "all the runs failed" and could not say why from anything on it.
 *
 * This read collects the stop facts for a SET of Runs in one statement so the list can
 * say the reason on every row, and the same statement answers for one Run so the header
 * cannot disagree with the list. It reads and derives nothing: the stage, its diagnostic,
 * the snapshot's declared generation time, the §H tally and the Result's own §E.1 row are
 * all stored columns. Putting the words on them is the web's job (`stop-reason.ts`).
 */

/**
 * The stages that can end a Run before the Gate, in the order the Run reaches them.
 *
 * Two of these are not stage checkpoints at all. `wait` is a pause or an Escalation whose
 * deadline passed: `wakeEscalation` closes the `run_wait` row with `closure_kind =
 * 'timeout'` and ends the Run `INCONCLUSIVE` through `completeRun`, and NO checkpoint
 * turns terminal and no §H row is written — so without reading the wait row such a Run
 * reads as one nothing recorded anything about (Codex, PR 39). `unexecutable` is the
 * other: `stopUnexecutableRun` writes NO checkpoint, deliberately, and records its reason
 * only in the chain (`lifecycle.run-unexecutable`), so it is read from there.
 */
export const RUN_STOP_STAGES = ['population', 'workspace', 'access', 'extraction', 'work', 'wait', 'unexecutable'] as const;
export type RunStopStage = (typeof RUN_STOP_STAGES)[number];

/** The two diagnostics the `wait` stage produces, named after the events the wake appends. */
export const WAIT_TIMEOUT_DIAGNOSTICS = ['pause-timeout', 'escalation-timeout'] as const;
export type WaitTimeoutDiagnostic = (typeof WAIT_TIMEOUT_DIAGNOSTICS)[number];

export interface RunStop {
  readonly stage: RunStopStage;
  /** The closed diagnostic the stage recorded. Never free text and never a value. */
  readonly diagnostic: string;
}

export interface RunStopFacts {
  readonly runId: string;
  readonly state: RunState;
  readonly initiatedAt: string;
  readonly period: { readonly from: string; readonly to: string };
  /** The first stage whose checkpoint ended the Run, or `null` when none did. */
  readonly stop: RunStop | null;
  /**
   * The wait whose deadline passed, when the Run was ended by one: its stored kind
   * (`pause`, or an Escalation kind) and its deadline, so the sentence can say which
   * question went unanswered and by when.
   */
  readonly timedOutWait: { readonly kind: string; readonly deadline: string } | null;
  /**
   * The population snapshot's declared generation time, verbatim as stored, or `null`.
   *
   * Read so the `freshness` sentence can say WHICH way the snapshot was unfit — before the
   * period ended, after the Run started, or undeclared — the three answers generation 24
   * added the column to be able to give.
   */
  readonly snapshotGeneratedAt: string | null;
  /** §H rows written for this Run, and how many failed. Zero rows means the Gate never ran. */
  readonly gateChecks: number;
  readonly gateFailed: number;
  /** The §E.1 row the Result recorded, when a Result exists and names one this build knows. */
  readonly outcomeRow: OutcomeRowId | null;
}

interface RawStop extends Record<string, unknown> {
  run_id: string;
  state: string;
  initiated_at: Date | string;
  period_from: string;
  period_to: string;
  population_status: string | null;
  population_diagnostic: string | null;
  generated_at: Date | string | null;
  workspace_status: string | null;
  workspace_diagnostic: string | null;
  access_status: string | null;
  access_diagnostic: string | null;
  extraction_status: string | null;
  extraction_diagnostic: string | null;
  work_status: string | null;
  work_diagnostic: string | null;
  outcome_row: string | null;
  gate_checks: number;
  gate_failed: number;
  wait_kind: string | null;
  wait_deadline: Date | string | null;
  unexecutable: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The stage that stopped the Run, from its row.
 *
 * In the order the Run executes them, and the FIRST terminal checkpoint wins: a Run stops
 * once, so at most one stage holds a stop diagnostic, but a cancellation observed at a
 * later boundary can leave `canceled` on a second checkpoint. `canceled` is skipped
 * everywhere — the cancellation banner already names the person and the time, and on a
 * Run that outran its cancellation the Timeline's `cancellation-superseded` event is the
 * record. A non-terminal status is not a stop, whatever its diagnostic says: `RETRY`
 * carries the reason for the NEXT attempt, and a Run in that state is still running.
 */
function stopOf(row: RawStop): RunStop | null {
  const candidates: readonly [RunStopStage, string | null, string | null, string][] = [
    ['population', row.population_status, row.population_diagnostic, 'TERMINAL'],
    ['workspace', row.workspace_status, row.workspace_diagnostic, 'FAILED'],
    ['access', row.access_status, row.access_diagnostic, 'TERMINAL'],
    ['extraction', row.extraction_status, row.extraction_diagnostic, 'TERMINAL'],
    ['work', row.work_status, row.work_diagnostic, 'TERMINAL'],
  ];
  for (const [stage, status, diagnostic, terminal] of candidates) {
    if (status !== terminal || diagnostic === null || diagnostic === '' || diagnostic === 'canceled') continue;
    return { stage, diagnostic };
  }
  // A wait that timed out is a stop the wake recorded on the WAIT row, not on a stage.
  if (row.wait_kind !== null && row.wait_kind !== '') {
    return { stage: 'wait', diagnostic: row.wait_kind === 'pause' ? 'pause-timeout' : 'escalation-timeout' };
  }
  if (row.unexecutable !== null && row.unexecutable !== '') {
    return { stage: 'unexecutable', diagnostic: row.unexecutable };
  }
  return null;
}

export class DrizzleRunStopReader {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * The stop facts for up to one page of Runs, keyed by Run id.
   *
   * One statement whatever the count, because a page of Runs must not cost a page of
   * round trips. Ids that are not UUID text are dropped before PostgreSQL is asked to
   * compare a `uuid` column against them (`22P02`), and a Run that is not there is simply
   * absent from the map — a caller that asks about a Run it did not read has nothing to
   * say about it either way.
   */
  async readStops(runIds: readonly string[]): Promise<ReadonlyMap<string, RunStopFacts>> {
    const ids = [...new Set(runIds.filter((id) => isUuidText(id)))].slice(0, RUN_LIST_PAGE_SIZE + 1);
    if (ids.length === 0) return new Map();
    // `sql.join`, not a bound array: a bound JS array becomes a record — `($1,$2,…)` —
    // which PostgreSQL will not cast to `uuid[]` (the Runs list learned this first).
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await this.db.execute<RawStop>(sql`
      SELECT r.run_id::text AS run_id, r.state, r.initiated_at,
             r.period_from::text AS period_from, r.period_to::text AS period_to,
             pe.status AS population_status, pe.diagnostic AS population_diagnostic,
             ps.generated_at,
             rw.status AS workspace_status, rw.diagnostic AS workspace_diagnostic,
             ra.status AS access_status, ra.diagnostic AS access_diagnostic,
             re.status AS extraction_status, re.diagnostic AS extraction_diagnostic,
             aw.status AS work_status, aw.diagnostic AS work_diagnostic,
             res.outcome_row,
             coalesce(gate.checks, 0)::int AS gate_checks,
             coalesce(gate.failed, 0)::int AS gate_failed,
             wait.kind AS wait_kind, wait.deadline AS wait_deadline,
             unex.diagnostic AS unexecutable
      FROM audit_run r
      LEFT JOIN population_execution pe ON pe.run_id = r.run_id
      LEFT JOIN population_snapshot ps ON ps.run_id = r.run_id
      LEFT JOIN run_workspace rw ON rw.run_id = r.run_id
      LEFT JOIN run_agent_execution ra ON ra.run_id = r.run_id
      LEFT JOIN run_execution re ON re.run_id = r.run_id
      LEFT JOIN run_agent_work aw ON aw.run_id = r.run_id
      LEFT JOIN run_result res ON res.run_id = r.run_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS checks,
               count(*) FILTER (WHERE g.outcome = 'FAIL')::int AS failed
        FROM run_gate_check g WHERE g.run_id = r.run_id
      ) gate ON true
      LEFT JOIN LATERAL (
        SELECT w.kind, w.deadline
        FROM run_wait w
        WHERE w.run_id = r.run_id AND w.closure_kind = 'timeout'
        ORDER BY w.closed_at DESC LIMIT 1
      ) wait ON true
      LEFT JOIN LATERAL (
        SELECT e.payload->>'diagnostic' AS diagnostic
        FROM audit_events e
        WHERE e.aggregate_id = r.run_id::text AND e.event_type = 'lifecycle.run-unexecutable'
        ORDER BY e.sequence DESC LIMIT 1
      ) unex ON true
      WHERE r.run_id IN (${idList})`);
    return new Map(
      rows.map((row): [string, RunStopFacts] => [
        row.run_id,
        {
          runId: row.run_id,
          state: row.state as RunState,
          initiatedAt: iso(row.initiated_at),
          period: { from: row.period_from, to: row.period_to },
          stop: stopOf(row),
          timedOutWait:
            row.wait_kind === null || row.wait_kind === '' || row.wait_deadline === null
              ? null
              : { kind: row.wait_kind, deadline: iso(row.wait_deadline) },
          snapshotGeneratedAt: row.generated_at === null ? null : iso(row.generated_at),
          gateChecks: Number(row.gate_checks),
          gateFailed: Number(row.gate_failed),
          outcomeRow: isOutcomeRowId(row.outcome_row) ? row.outcome_row : null,
        },
      ]),
    );
  }

  /** The stop facts for one Run, or `null` when it is not there. */
  async readStop(runId: string): Promise<RunStopFacts | null> {
    return (await this.readStops([runId])).get(runId) ?? null;
  }
}
