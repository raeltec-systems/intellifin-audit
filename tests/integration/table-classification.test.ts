import { afterAll, beforeAll, describe, it } from 'vitest';

import { createSqlClient, type Sql } from '@intellifin/infrastructure';

import { PROTECTED_CLASS_BOUNDARIES, none, readTenancyContract } from '../fixtures/tenancy-contract.js';

/**
 * The unclassified-table test (Story 11.1, `docs/contracts/tenancy-v1.md` §6).
 *
 * The truth about which relations exist is the migrated database, not the Drizzle schema:
 * the release migrator also installs pg-boss's tables, keeps its own migration record, and a
 * migration can create a relation no schema object declares. So this lists every relation in
 * every non-system schema and requires §3 of the contract to classify exactly that set, in
 * both directions.
 *
 * A partition has no row of its own. pg-boss keeps `job_common` as a partition of `job` and
 * adds a `queue_stats` partition per day, so those names are not stable; each takes its
 * root's class, and the root is what must be classified. A sequence owned by a table (an
 * identity or `serial` column) follows that table the same way; an unowned one needs a row.
 */

const databaseUrl = process.env['DATABASE_URL'];

interface Relation {
  readonly relation: string;
  readonly kind: string;
  readonly partition: boolean;
  /** The table that owns this sequence, or null. */
  readonly owner: string | null;
  /** The partition root, the owning table (resolved to its own root), or the relation itself. */
  readonly root: string;
}

/** A partition or an owned sequence: a relation that takes another relation's row. */
const dependent = (relation: Relation): boolean => relation.partition || relation.owner !== null;

/**
 * Tables, partitioned tables, foreign tables, views, materialized views and sequences
 * outside the system schemas. A view is here on purpose: an unclassified view is an
 * unreviewed path around the row policies of whatever it selects from. `pg_partition_root`
 * is null for a relation outside any partition tree, so such a relation is its own root.
 */
const listRelations = (handle: Sql): Promise<Relation[]> =>
  handle<Relation[]>`
    SELECT n.nspname || '.' || c.relname AS relation,
           c.relkind::text AS kind,
           c.relispartition AS partition,
           CASE WHEN o.refobjid IS NULL THEN NULL ELSE own_n.nspname || '.' || own.relname END AS owner,
           rn.nspname || '.' || r.relname AS root
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL (
      SELECT d.refobjid FROM pg_depend d
      WHERE c.relkind = 'S' AND d.classid = 'pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
      LIMIT 1
    ) o ON true
    LEFT JOIN pg_class own ON own.oid = o.refobjid
    LEFT JOIN pg_namespace own_n ON own_n.oid = own.relnamespace
    JOIN pg_class r ON r.oid = coalesce(pg_partition_root(o.refobjid), o.refobjid, pg_partition_root(c.oid), c.oid)
    JOIN pg_namespace rn ON rn.oid = r.relnamespace
    WHERE c.relkind IN ('r', 'p', 'f', 'm', 'v', 'S')
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
    ORDER BY (n.nspname || '.' || c.relname) COLLATE "C"
  `;

/** Every foreign key, both ends resolved to their partition roots. */
const listForeignKeys = (handle: Sql): Promise<{ readonly child: string; readonly parent: string }[]> =>
  handle<{ child: string; parent: string }[]>`
    SELECT DISTINCT cn.nspname || '.' || c.relname AS child, pn.nspname || '.' || p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = coalesce(pg_partition_root(k.conrelid), k.conrelid)
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_class p ON p.oid = coalesce(pg_partition_root(k.confrelid), k.confrelid)
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE k.contype = 'f' AND cn.nspname <> 'information_schema' AND cn.nspname !~ '^pg_'
    ORDER BY 1, 2
  `;

const classification = (): Map<string, string> =>
  new Map(readTenancyContract().classification.map((row) => [row.relation, row.tableClass]));
const isProtected = (tableClass: string | undefined): boolean =>
  tableClass !== undefined && Object.hasOwn(PROTECTED_CLASS_BOUNDARIES, tableClass);

/** Relations the database holds, outside any partition or owning table, that §3 does not classify. */
const unclassifiedIn = async (handle: Sql): Promise<string[]> => {
  const known = classification();
  return (await listRelations(handle))
    .filter((relation) => !dependent(relation) && !known.has(relation.relation))
    .map((relation) => relation.relation)
    .sort();
};

class RollBack extends Error {}

describe.skipIf(!databaseUrl)('tenancy-v1: every relation has a class', () => {
  let sql: Sql;

  beforeAll(() => {
    // The probe below runs DDL (in a transaction that always rolls back): refuse any
    // database that is not an isolated local or CI test database before touching it.
    const target = new URL(databaseUrl as string);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('The unclassified-table test requires an isolated local or CI test database');
    }
    sql = createSqlClient(databaseUrl as string, { max: 2 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('classifies every relation the database holds', async () => {
    none(await unclassifiedIn(sql));
  });

  it('classifies nothing the database does not hold', async () => {
    // A row with no relation behind it is a decision about something that no longer
    // exists; left in place it would make the next relation of that name look decided.
    const roots = new Set((await listRelations(sql)).filter((r) => !dependent(r)).map((r) => r.relation));
    none([...classification().keys()].filter((relation) => !roots.has(relation)).sort());
  });

  it('gives no partition a row of its own, and classifies every partition root', async () => {
    const known = classification();
    const partitions = (await listRelations(sql)).filter((relation) => relation.partition);
    // pg-boss creates partitions during migration, so this branch is exercised by the real
    // schema rather than by a fixture.
    none(partitions.length > 0 ? [] : ['no partition in the database: pg-boss should have created some']);
    none(partitions.filter((p) => known.has(p.relation)).map((p) => p.relation));
    none(partitions.filter((p) => !known.has(p.root)).map((p) => `${p.relation} → ${p.root}`));
  });

  it('gives no owned sequence a row of its own, and classifies every owning table', async () => {
    const known = classification();
    const owned = (await listRelations(sql)).filter((relation) => relation.kind === 'S' && relation.owner !== null);
    none(owned.filter((s) => known.has(s.relation)).map((s) => s.relation));
    none(owned.filter((s) => !known.has(s.root)).map((s) => `${s.relation} → ${s.root}`));
  });

  it('lets no protected table own a sequence', async () => {
    // `nextval` and `last_value` are not row-level: a sequence shared by a protected table
    // would count every tenant's rows for anyone who can read it.
    const known = classification();
    none((await listRelations(sql))
      .filter((relation) => relation.kind === 'S' && relation.owner !== null && isProtected(known.get(relation.root)))
      .map((relation) => `${relation.relation} → ${relation.root}`));
  });

  it('protects every table that references a protected table', async () => {
    // Protected, not client/engagement-owned: `run_initiation_request` is user-owned and
    // references `audit_run`. An unprotected child of a protected parent would be a policy-free
    // path to the parent's identities.
    const known = classification();
    none((await listForeignKeys(sql))
      .filter(({ child, parent }) => isProtected(known.get(parent)) && !isProtected(known.get(child)))
      .map(({ child, parent }) => `${child} → ${parent}`));
  });

  it('names a table, a view, a materialized view, a partitioned table, a sequence and a foreign table a migration adds without classifying them', async () => {
    // The check proven against real relations rather than asserted: each kind a migration
    // could add, in a transaction that always rolls back, so nothing survives for another
    // file to see. The partition and the identity column's sequence are created too, and must
    // NOT be named: each takes its root's row. The foreign-data wrapper has no handler, so the
    // foreign table can be declared and never read; creating the wrapper needs a superuser,
    // and a role that cannot makes this test fail naming the privilege, never skip.
    const name = `unclassified_probe_${Date.now()}`;
    let seen: string[] = [];
    let resolved: Relation[] = [];
    await sql
      .begin(async (tx) => {
        await tx.unsafe(`CREATE TABLE public."${name}" (id integer GENERATED ALWAYS AS IDENTITY)`);
        await tx.unsafe(`CREATE VIEW public."${name}_view" AS SELECT id FROM public."${name}"`);
        await tx.unsafe(`CREATE MATERIALIZED VIEW public."${name}_matview" AS SELECT id FROM public."${name}"`);
        await tx.unsafe(`CREATE TABLE public."${name}_parted" (id integer) PARTITION BY RANGE (id)`);
        await tx.unsafe(
          `CREATE TABLE public."${name}_parted_1" PARTITION OF public."${name}_parted" FOR VALUES FROM (0) TO (10)`,
        );
        await tx.unsafe(`CREATE SEQUENCE public."${name}_seq"`);
        await tx.unsafe(`CREATE FOREIGN DATA WRAPPER "${name}_fdw"`);
        await tx.unsafe(`CREATE SERVER "${name}_server" FOREIGN DATA WRAPPER "${name}_fdw"`);
        await tx.unsafe(`CREATE FOREIGN TABLE public."${name}_foreign" (id integer) SERVER "${name}_server"`);
        const handle = tx as unknown as Sql;
        seen = await unclassifiedIn(handle);
        resolved = (await listRelations(handle)).filter((relation) => relation.relation.startsWith(`public.${name}`));
        throw new RollBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollBack)) throw error;
      });
    const expected = ['', '_foreign', '_matview', '_parted', '_seq', '_view'].map((suffix) => `public.${name}${suffix}`).sort();
    none([
      ...expected.filter((relation) => !seen.includes(relation)).map((relation) => `not named: ${relation}`),
      ...seen.filter((relation) => !expected.includes(relation)).map((relation) => `named: ${relation}`),
    ]);
    const resolvesTo = (relation: string, expected: string): string[] => {
      const actual = resolved.find((r) => r.relation === relation)?.root;
      return actual === expected ? [] : [`${relation} resolves to ${actual ?? '(not listed)'}, not ${expected}`];
    };
    none([
      ...resolvesTo(`public.${name}_parted_1`, `public.${name}_parted`),
      ...resolvesTo(`public.${name}_id_seq`, `public.${name}`),
    ]);
    none(await unclassifiedIn(sql));
  });
});
