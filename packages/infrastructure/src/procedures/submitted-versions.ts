import { sql } from 'drizzle-orm';

import type { Database, Transaction } from '../db/client.js';

/**
 * The Procedure Versions waiting for an Audit Manager's decision.
 *
 * EXPERIENCE.md's Overview attention list names "Submitted for review" as one of its
 * ordered rows, and `SUBMITTED` already means "the auditor approved this and sent it for
 * manager review" (2026-09-11) — so the row is readable today and nothing on the Overview
 * was reading it. `listVersions` answers one Procedure in full and the review page answers
 * one version; neither can say what is waiting ACROSS Procedures, which is the only
 * question this surface asks.
 *
 * It reads and derives nothing. The state is a stored column, the submission instant and
 * the actor come from the version's own immutable decision record (`decisions`), and the
 * responsible author comes from `authorship`. Whether THIS manager may approve a given
 * version is not decided here: `authorizeAction` applies the "cannot approve a version
 * they authored" rule where the decision is taken, and a read that pre-judged it would be
 * a second copy of that rule.
 */

/** How many waiting versions the Overview names at once. The count beside them is exact. */
export const SUBMITTED_VERSION_LIMIT = 10;

export interface SubmittedVersionRow {
  readonly versionId: string;
  readonly procedureId: string;
  readonly controlName: string;
  readonly versionNumber: number;
  /**
   * When it was submitted, from the last `submit` decision on the row.
   *
   * `null` when the row records none — a version an older build wrote, or one whose
   * decisions payload this build cannot read. The surface says so rather than showing the
   * update time, which moves for operational reasons (a derivation attempt lands on the
   * row seconds later) and would date the submission wrongly.
   */
  readonly submittedAt: string | null;
  /** Who submitted it, from that same decision record. `null` when it records none. */
  readonly submittedBy: string | null;
  /** The person accountable for the definition. `null` when the row records no authorship. */
  readonly authorId: string | null;
}

export interface SubmittedVersionPage {
  readonly rows: readonly SubmittedVersionRow[];
  /** Every version awaiting a decision, counted, not only the ones this page holds. */
  readonly total: number;
}

interface RawSubmittedRow extends Record<string, unknown> {
  version_id: string;
  procedure_id: string;
  control_name: string;
  version_number: number;
  submitted_at: string | null;
  submitted_by: string | null;
  author_id: string | null;
}

export class DrizzleSubmittedVersionReader {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * The versions in `SUBMITTED`, newest submission first, bounded — and how many there are.
   *
   * Newest first is the Runs register's own order, which is the order the reader is
   * comparing this surface against; the exact total beside it is what stops a bounded list
   * reading as a complete one.
   */
  async listSubmitted(limit = SUBMITTED_VERSION_LIMIT): Promise<SubmittedVersionPage> {
    const size =
      Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, SUBMITTED_VERSION_LIMIT)
        : SUBMITTED_VERSION_LIMIT;
    const rows = await this.db.execute<RawSubmittedRow>(sql`
      SELECT v.version_id::text AS version_id, v.procedure_id::text AS procedure_id,
             v.control_name, v.version_number,
             submitted.occurred_at AS submitted_at, submitted.actor_id AS submitted_by,
             v.authorship->>'responsibleAuthorId' AS author_id
      FROM procedure_version v
      LEFT JOIN LATERAL (
        SELECT d->>'occurredAt' AS occurred_at, d->>'actorId' AS actor_id
        FROM jsonb_array_elements(v.decisions) d
        WHERE d->>'decision' = 'submit'
        ORDER BY d->>'occurredAt' DESC
        LIMIT 1
      ) submitted ON true
      WHERE v.state = 'SUBMITTED'
      ORDER BY submitted.occurred_at DESC NULLS LAST, v.version_id DESC
      LIMIT ${size}`);
    // Its own statement: `rows.length` after a `LIMIT` is the bound, never a count.
    const counted = await this.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM procedure_version v WHERE v.state = 'SUBMITTED'`,
    );
    return {
      rows: rows.map((row): SubmittedVersionRow => ({
        versionId: row.version_id,
        procedureId: row.procedure_id,
        controlName: row.control_name,
        versionNumber: Number(row.version_number),
        submittedAt: row.submitted_at,
        submittedBy: row.submitted_by,
        authorId: row.author_id,
      })),
      total: Number(counted[0]?.total ?? 0),
    };
  }
}
