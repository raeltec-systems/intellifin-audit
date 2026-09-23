import {
  PROCEDURE_VERSION_STATES,
  isProcedureVersionState,
  type TemplateId,
  type ProcedureVersionState,
} from '@intellifin/domain';
import { sql } from 'drizzle-orm';

import type { Database, Transaction } from '../db/client.js';

/**
 * The Procedures LIST read (UI cleanup 2026-09-22, UX-03, UX-04, and the Auditor's home).
 *
 * The owner met a Procedures page 6,497 pixels tall with no search, no filter and no
 * pagination — every Procedure the deployment holds, as a card, in one scroll. A list a
 * person cannot narrow is a list they stop reading, and the search a surface needs is a
 * predicate in SQL: filtering a page of {@link DrizzleProcedureRepository.listProcedures}
 * in TypeScript would search only the first two hundred rows and report a total that is
 * the bound rather than a count.
 *
 * It is a SECOND read beside `listProcedures`, not a change to it. That method answers
 * "every Procedure, for a surface with no filter" and four callers depend on its shape;
 * this answers one page of a filtered, counted list and carries the two facts a card has
 * never been able to say — the state of the NEWEST version, whatever it is, and the
 * planned frequency the ACTIVE version's Schedule names.
 *
 * Two different version states, deliberately, because they answer two different questions:
 *
 * - `activeVersionState` is `ACTIVE` or nothing, and it is the UX-DR7 "Active version"
 *   cell. Story 2.1 shipped it as "the newest version whatever its state", so a Procedure
 *   whose only version was a Draft rendered "Active version: Draft" — a cell stating a
 *   fact that was not true. It keeps the repaired meaning here, and the succession rule
 *   with it: a version whose successor has activated is not current.
 * - `latestVersionState` is the newest version's own state. It is what a person means by
 *   "show me my drafts" and what the status filter filters on. Naming it separately is
 *   what stops the two ever being read as one again.
 */

/** How many Procedures one page of the list holds. Pagination, never infinite scroll. */
export const PROCEDURE_PAGE_SIZE = 20;

/** The most rows one request may skip, so a hand-typed `page` cannot ask for a table scan. */
export const PROCEDURE_MAX_OFFSET = 5_000;

/**
 * The version-state vocabulary, as a SQL list, for the status filter's guard.
 *
 * Interpolated behind an assertion rather than bound, for the reason every list in this
 * package is: a bound JS array becomes a RECORD in a `sql` template, which PostgreSQL will
 * not cast to `text[]`. The vocabulary is the DOMAIN's, so a state added there becomes
 * filterable here rather than being silently rejected as unknown.
 */
const VERSION_STATES = [...PROCEDURE_VERSION_STATES];
for (const state of VERSION_STATES) {
  if (!/^[A-Z_]+$/.test(state)) throw new Error(`Unsafe Procedure version state constant: ${state}`);
}

/**
 * The states a reader may filter by, in the domain's own order.
 *
 * The guard is the DOMAIN's `isProcedureVersionState`, not a copy of it: a second
 * membership test would agree on every value anybody tried and diverge on the first state
 * a later story adds.
 */
export const PROCEDURE_FILTER_STATES: readonly ProcedureVersionState[] = VERSION_STATES;

/**
 * What the reader typed, narrowed to what a filter may do.
 *
 * Every field is optional and an absent field filters nothing. The values come from a
 * `<form method="get">` — the ONE exception to this product's POST rule, because a filter
 * mutates nothing and a GET form works with no JavaScript, is bookmarkable and is what the
 * browser's own back button restores.
 */
export interface ProcedureListQuery {
  /** Matched against the Control name and the Template, case-insensitively. */
  readonly search?: string | null;
  /** The newest version's state. An empty list filters nothing. */
  readonly states?: readonly ProcedureVersionState[];
  /** The person accountable for the newest version (`authorship.responsibleAuthorId`). */
  readonly ownerId?: string | null;
  /** Rows to skip. Bounded, so a hand-typed page number cannot ask for a table scan. */
  readonly offset?: number;
  readonly limit?: number;
}

/** One Procedure, as the list's card names it. */
export interface ProcedureListRow {
  readonly procedureId: string;
  readonly controlName: string;
  readonly templateId: TemplateId;
  /** `ACTIVE` when a current Active version exists, else `null`. Never "the newest state". */
  readonly activeVersionState: 'ACTIVE' | null;
  readonly activeVersionNumber: number | null;
  /** The newest version's own state and number, whatever they are. Never `null`: a
   *  Procedure always has at least the Draft it was created with. */
  readonly latestVersionState: ProcedureVersionState | null;
  readonly latestVersionNumber: number | null;
  /**
   * The frequency the ACTIVE version's Schedule names, or `null` where none is frozen.
   *
   * A PLANNED frequency and nothing more: no scheduler exists in this release (Epic 8),
   * so saving a frequency never implies automatic execution (EXPERIENCE.md → "Frequency is
   * a planned frequency until a scheduler exists"). The list says that once, for the whole
   * list; the card says which frequency, or that none is set.
   */
  readonly plannedFrequency: string | null;
  /** Who is accountable for the newest version. `null` when the row records no authorship. */
  readonly ownerId: string | null;
  readonly updatedAt: string;
}

export interface ProcedureListPage {
  readonly rows: readonly ProcedureListRow[];
  /** Every Procedure MATCHING the filter, counted — never `rows.length` of this page. */
  readonly total: number;
  /** Every Procedure in the deployment, counted, so the list can say a filter is narrowing. */
  readonly unfilteredTotal: number;
  readonly offset: number;
  readonly limit: number;
}

/** One person who owns at least one Procedure, for the owner filter's options. */
export interface ProcedureOwner {
  readonly userId: string;
  readonly procedures: number;
}

interface RawListRow extends Record<string, unknown> {
  procedure_id: string;
  control_name: string;
  template_id: string;
  active_state: string | null;
  active_number: number | null;
  latest_state: string | null;
  latest_number: number | null;
  planned_frequency: string | null;
  owner_id: string | null;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * A `LIKE` pattern for what the reader typed.
 *
 * `%`, `_` and the escape character itself are escaped, so a search for `100%` finds the
 * Procedure called `100% of leavers` rather than every row in the table. Bounded, because
 * the value comes from a query string and an unbounded pattern is unbounded work bought
 * with one request.
 */
function searchPattern(value: string): string {
  return `%${value.slice(0, 200).replace(/([\\%_])/g, '\\$1')}%`;
}

/**
 * The latest version of each Procedure, and the current Active one, in one subquery each.
 *
 * `DISTINCT ON` over the same order the repository's own `activeSummaries` uses, including
 * the succession rule — a version whose successor has activated is not current, or a card
 * would name a definition the platform would refuse to run.
 */
const LATEST = sql`(
  SELECT DISTINCT ON (lv.procedure_id)
         lv.procedure_id, lv.state, lv.version_number,
         lv.authorship->>'responsibleAuthorId' AS owner_id
  FROM procedure_version lv
  ORDER BY lv.procedure_id, lv.version_number DESC, lv.version_id DESC
)`;

const CURRENT_ACTIVE = sql`(
  SELECT DISTINCT ON (av.procedure_id)
         av.procedure_id, av.state, av.version_number, av.schedule->>'frequency' AS planned_frequency
  FROM procedure_version av
  WHERE av.state = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM procedure_succession s
      WHERE s.predecessor_id = av.version_id AND s.activated_at IS NOT NULL
    )
  ORDER BY av.procedure_id, av.version_number DESC, av.version_id DESC
)`;

export class DrizzleProcedureListReader {
  constructor(private readonly db: Database | Transaction) {}

  /**
   * One page of Procedures, with the exact number the filter matched.
   *
   * Offset paging rather than a keyset cursor, because this list is SORTED BY NAME and
   * filtered: a reader narrows it, reads a page, and goes back — which is what page links
   * do and what a cursor cannot. The offset is bounded, so a hand-typed `page=900000`
   * cannot ask PostgreSQL to skip a table.
   */
  async listProcedures(query: ProcedureListQuery = {}): Promise<ProcedureListPage> {
    const limit =
      Number.isSafeInteger(query.limit) && (query.limit as number) > 0
        ? Math.min(query.limit as number, PROCEDURE_PAGE_SIZE)
        : PROCEDURE_PAGE_SIZE;
    const offset =
      Number.isSafeInteger(query.offset) && (query.offset as number) > 0
        ? Math.min(query.offset as number, PROCEDURE_MAX_OFFSET)
        : 0;
    const search = typeof query.search === 'string' && query.search.trim() !== '' ? query.search.trim() : null;
    // Only states this build knows reach the query. A value the vocabulary does not hold
    // is dropped rather than matched, so a hand-typed one narrows to nothing visible
    // instead of reaching PostgreSQL as an unrecognised literal.
    const states = (query.states ?? []).filter((state) => isProcedureVersionState(state));
    const ownerId = typeof query.ownerId === 'string' && query.ownerId.trim() !== '' ? query.ownerId.trim() : null;

    const predicates = [sql`true`];
    if (search !== null) {
      // The Template is matched by its identifier (`P-1`), which is what the card prints
      // beside its purpose; the purpose itself is a build constant the domain owns and is
      // matched on the surface, not here.
      predicates.push(
        sql`(p.control_name ILIKE ${searchPattern(search)} ESCAPE '\\'
             OR p.template_id ILIKE ${searchPattern(search)} ESCAPE '\\')`,
      );
    }
    if (states.length > 0) {
      predicates.push(sql`latest.state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)})`);
    }
    if (ownerId !== null) predicates.push(sql`latest.owner_id = ${ownerId}`);
    const where = sql.join(predicates, sql` AND `);

    const rows = await this.db.execute<RawListRow>(sql`
      SELECT p.procedure_id::text AS procedure_id, p.control_name, p.template_id, p.updated_at,
             active.state AS active_state, active.version_number AS active_number,
             active.planned_frequency,
             latest.state AS latest_state, latest.version_number AS latest_number,
             latest.owner_id
      FROM procedure p
      LEFT JOIN ${LATEST} latest ON latest.procedure_id = p.procedure_id
      LEFT JOIN ${CURRENT_ACTIVE} active ON active.procedure_id = p.procedure_id
      WHERE ${where}
      ORDER BY p.control_name ASC, p.procedure_id ASC
      LIMIT ${limit} OFFSET ${offset}`);

    // Two counts, each its own statement: what the filter matched, and how many there are
    // altogether. `rows.length` after a `LIMIT` is the bound, never a count — and without
    // the second number a filtered list cannot say it is hiding anything.
    const [matched, everything] = await Promise.all([
      this.db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM procedure p
        LEFT JOIN ${LATEST} latest ON latest.procedure_id = p.procedure_id
        WHERE ${where}`),
      this.db.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM procedure`),
    ]);

    return {
      rows: rows.map(toListRow),
      total: Number(matched[0]?.total ?? 0),
      unfilteredTotal: Number(everything[0]?.total ?? 0),
      offset,
      limit,
    };
  }

  /**
   * The people who own at least one Procedure, for the owner filter's options.
   *
   * Names are NOT read here: `ActorNameReader` is the one port that turns a user id into a
   * person's name, and a second one would be a second answer. This returns ids and counts;
   * the surface asks that reader for the names.
   */
  async listOwners(limit = 100): Promise<readonly ProcedureOwner[]> {
    const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
    const rows = await this.db.execute<{ owner_id: string; total: number }>(sql`
      SELECT latest.owner_id, count(*)::int AS total
      FROM procedure p
      INNER JOIN ${LATEST} latest ON latest.procedure_id = p.procedure_id
      WHERE latest.owner_id IS NOT NULL
      GROUP BY latest.owner_id
      ORDER BY count(*) DESC, latest.owner_id ASC
      LIMIT ${size}`);
    return rows.map((row) => ({ userId: row.owner_id, procedures: Number(row.total) }));
  }

  /**
   * The Procedures whose NEWEST version is a Draft this person is accountable for.
   *
   * The Auditor's home leads with them: "my drafts" is the work they have started and can
   * finish, and it is the one thing a landing page can show an Auditor that nobody else
   * needs to see. Newest first, because a draft somebody is in the middle of is the one
   * they came back for.
   *
   * It composes the list read rather than repeating it, so "the newest version's state"
   * means the same thing on the home page and in the list's status filter.
   */
  async listAuthoredDrafts(userId: string, limit = 5): Promise<ProcedureListPage> {
    if (typeof userId !== 'string' || userId === '') {
      return { rows: [], total: 0, unfilteredTotal: 0, offset: 0, limit: 0 };
    }
    const page = await this.listProcedures({ states: ['DRAFT'], ownerId: userId, limit });
    // Newest work first, which is the opposite of the list's alphabetical order: this is a
    // "carry on where you left off" list, not a register.
    return { ...page, rows: [...page.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }
}

function toListRow(row: RawListRow): ProcedureListRow {
  return {
    procedureId: row.procedure_id,
    controlName: row.control_name,
    templateId: row.template_id as TemplateId,
    activeVersionState: row.active_state === 'ACTIVE' ? 'ACTIVE' : null,
    activeVersionNumber: row.active_number === null ? null : Number(row.active_number),
    latestVersionState:
      row.latest_state !== null && isProcedureVersionState(row.latest_state)
        ? (row.latest_state as ProcedureVersionState)
        : null,
    latestVersionNumber: row.latest_number === null ? null : Number(row.latest_number),
    plannedFrequency: row.planned_frequency,
    ownerId: row.owner_id,
    updatedAt: iso(row.updated_at),
  };
}
