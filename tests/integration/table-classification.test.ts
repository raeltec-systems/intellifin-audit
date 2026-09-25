import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSqlClient, type Sql } from '@intellifin/infrastructure';

import { readTenancyContract } from '../fixtures/tenancy-contract.js';

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
 * root's class, and the root is what must be classified.
 */

const databaseUrl = process.env['DATABASE_URL'];

interface Relation {
  readonly relation: string;
  readonly root: string;
  readonly partition: boolean;
}

/**
 * Tables, partitioned tables, foreign tables, views and materialized views outside the
 * system schemas. A view is here on purpose: an unclassified view is an unreviewed path
 * around the row policies of whatever it selects from. `pg_partition_root` is null for a
 * relation outside any partition tree, so such a relation is its own root.
 */
const listRelations = (handle: Sql): Promise<Relation[]> =>
  handle<Relation[]>`
    SELECT n.nspname || '.' || c.relname AS relation,
           rn.nspname || '.' || r.relname AS root,
           c.relispartition AS partition
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class r ON r.oid = coalesce(pg_partition_root(c.oid), c.oid)
    JOIN pg_namespace rn ON rn.oid = r.relnamespace
    WHERE c.relkind IN ('r', 'p', 'f', 'm', 'v')
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
    ORDER BY (n.nspname || '.' || c.relname) COLLATE "C"
  `;

const classified = (): Set<string> =>
  new Set(readTenancyContract().classification.map((row) => row.relation));

/** Relations the database holds, outside any partition, that the contract does not classify. */
const unclassifiedIn = async (handle: Sql): Promise<string[]> => {
  const known = classified();
  return (await listRelations(handle))
    .filter((relation) => !relation.partition && !known.has(relation.relation))
    .map((relation) => relation.relation)
    .sort();
};

/**
 * Fails naming every offender in full. Vitest shortens an array in its assertion message
 * (`[ 'public.a', …(2) ]`) and only its default reporter prints the diff that lists the rest,
 * so the names go into the message itself: a failure names everything that broke the rule,
 * whichever reporter shows it.
 */
const none = (offenders: readonly string[]): void => {
  expect(offenders, `offending: ${offenders.join(', ')}`).toEqual([]);
};

class RollBack extends Error {}

describe.skipIf(!databaseUrl)('tenancy-v1: every relation has a class', () => {
  let sql: Sql;

  beforeAll(() => {
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
    const roots = new Set((await listRelations(sql)).filter((r) => !r.partition).map((r) => r.relation));
    none([...classified()].filter((relation) => !roots.has(relation)).sort());
  });

  it('gives no partition a row of its own, and classifies every partition root', async () => {
    const known = classified();
    const partitions = (await listRelations(sql)).filter((relation) => relation.partition);
    // pg-boss creates partitions during migration, so this branch is exercised by the real
    // schema rather than by a fixture.
    expect(partitions.length).toBeGreaterThan(0);
    none(partitions.filter((p) => known.has(p.relation)).map((p) => p.relation));
    none(partitions.filter((p) => !known.has(p.root)).map((p) => p.root));
  });

  it('names a table, a view, a materialized view and a partitioned table a migration adds without classifying them', async () => {
    // The check proven against real relations rather than asserted: each kind a migration
    // could add, in a transaction that always rolls back, so nothing survives for another
    // file to see. The partition is created too, and must NOT be named: it takes its root's
    // class. Foreign tables are in the query but not here, because creating one needs a
    // foreign-data wrapper.
    const name = `unclassified_probe_${Date.now()}`;
    let seen: string[] = [];
    let partition: Relation | undefined;
    await sql
      .begin(async (tx) => {
        await tx.unsafe(`CREATE TABLE public."${name}" (id integer)`);
        await tx.unsafe(`CREATE VIEW public."${name}_view" AS SELECT id FROM public."${name}"`);
        await tx.unsafe(`CREATE MATERIALIZED VIEW public."${name}_matview" AS SELECT id FROM public."${name}"`);
        await tx.unsafe(`CREATE TABLE public."${name}_parted" (id integer) PARTITION BY RANGE (id)`);
        await tx.unsafe(
          `CREATE TABLE public."${name}_parted_1" PARTITION OF public."${name}_parted" FOR VALUES FROM (0) TO (10)`,
        );
        const handle = tx as unknown as Sql;
        seen = await unclassifiedIn(handle);
        partition = (await listRelations(handle)).find((relation) => relation.relation === `public.${name}_parted_1`);
        throw new RollBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollBack)) throw error;
      });
    expect(seen).toEqual(
      [`public.${name}`, `public.${name}_matview`, `public.${name}_parted`, `public.${name}_view`].sort(),
    );
    expect(partition).toEqual({ relation: `public.${name}_parted_1`, root: `public.${name}_parted`, partition: true });
    none(await unclassifiedIn(sql));
  });
});
