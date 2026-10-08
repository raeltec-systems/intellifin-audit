/** Build one atomic restoration, including any appended disposable-data cleanup. */
export function fixtureRestoration(actors: readonly string[], statement: string): (following?: string) => string {
  const actorSql = actors.map(actor => `'${actor.replaceAll("'", "''")}'`).join(',');
  return (following = '') => `
BEGIN;
-- Match API lock order before owner SQL acquires an identity row. Include every
-- membership of these identities, even when its roles, activity or expiry differ.
DO $fixture_restore$
DECLARE target_org text;
BEGIN
  FOR target_org IN
    SELECT DISTINCT organisation_id FROM public.organisation_memberships
    WHERE actor_id IN (${actorSql}) ORDER BY organisation_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org,205));
  END LOOP;
END
$fixture_restore$;
${statement}
${following}
COMMIT;`;
}

/** Restoration may fail precisely when resource cleanup matters most. */
export async function restoreAndClose(
  runtime: { restoreDatabase: () => void; sqlAsync: (statement: string) => Promise<void>; close: () => Promise<void> },
  statement: string,
): Promise<void> {
  try {
    runtime.restoreDatabase();
    await runtime.sqlAsync(statement);
  } finally {
    await runtime.close();
  }
}
