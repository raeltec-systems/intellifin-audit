import type { Sql } from 'postgres';

/**
 * AD-11 and AD-15 startup guards.
 *
 * AD-11: verify the server really is PostgreSQL 18 at bootstrap.
 * AD-15: the release pipeline alone applies migrations; each process checks the
 * applied schema version against its declared support range and refuses to run
 * outside it. Neither guard ever migrates.
 */

/**
 * The schema generations this build can run against (AD-15).
 *
 * This is a property of the BUILD, not of the deployment: an image ships a fixed set
 * of migrations and a fixed set of queries, so it alone knows which generations it can
 * serve. It was once read from `SCHEMA_RANGE_MIN`/`SCHEMA_RANGE_MAX` in the process
 * environment, and that drifted: the release migrated production to generation 2 while
 * the deployment still declared `1..1`, so every process refused to start against a
 * database its own image had just migrated. An environment cannot be allowed to claim
 * a range its image does not have, so it no longer gets a say.
 *
 * `MAX` must equal the highest generation seeded by `packages/infrastructure/drizzle`;
 * `schema-range.test.ts` reads the migrations and fails when the two disagree.
 *
 * **`MIN` equals `MAX`, and that is not laziness.** It read `1`, which claimed this
 * image could serve a generation-1 database. It cannot: every generation since has
 * added a table this build queries unconditionally, so against a generation-5 database
 * a generation-6 image passes this guard and then fails with `relation
 * "population_source_binding" does not exist` — a 500 per request instead of the clean
 * refusal AD-15 exists to give. A range wider than the truth turns a startup guard into
 * a delayed crash.
 *
 * The narrow range is also exactly right for how this product deploys: the release
 * pipeline migrates and THEN deploys, so the database is always at the image's own
 * generation. The cost is that a rollback to an older image now refuses to start
 * against a newer database instead of half-working — which is the direction a
 * fail-closed guard is supposed to fail.
 */
export const SUPPORTED_SCHEMA_MIN = 13;
export const SUPPORTED_SCHEMA_MAX = 13;

/** The supported range as it is logged and reported: `min..max`. */
export const SUPPORTED_SCHEMA_RANGE = `${SUPPORTED_SCHEMA_MIN}..${SUPPORTED_SCHEMA_MAX}`;

/** The only PostgreSQL major this release supports (AD-11). */
export const REQUIRED_POSTGRES_MAJOR = 18;

export class UnsupportedDatabaseError extends Error {
  override readonly name = 'UnsupportedDatabaseError';
  /** The major the server reported, or `null` when it could not be read. */
  readonly found: number | null;

  constructor(message: string, found: number | null = null) {
    super(message);
    this.found = found;
  }
}

export class UnsupportedSchemaError extends Error {
  override readonly name = 'UnsupportedSchemaError';
  /** The applied schema generation, or `null` when the database is unmigrated. */
  readonly found: number | null;
  /** The range this build declares support for, as `min..max`. */
  readonly supportedSchemaRange: string;

  constructor(message: string, found: number | null, min: number, max: number) {
    super(message);
    this.found = found;
    this.supportedSchemaRange = `${min}..${max}`;
  }
}

/** Read the leading major out of a `server_version` string such as `18.6 (Debian ...)`. */
export function parsePostgresMajor(serverVersion: string): number {
  const match = /^\s*(\d+)/.exec(serverVersion);
  if (!match?.[1]) {
    throw new UnsupportedDatabaseError(
      `Could not read a PostgreSQL major version from server_version "${serverVersion}".`,
    );
  }
  return Number.parseInt(match[1], 10);
}

/** Pure form of the AD-11 guard, so the refusal path is unit-testable. */
export function assertPostgresMajorSupported(serverVersion: string): number {
  const major = parsePostgresMajor(serverVersion);
  if (major !== REQUIRED_POSTGRES_MAJOR) {
    throw new UnsupportedDatabaseError(
      `Unsupported PostgreSQL major: found ${major} (server_version "${serverVersion}"), ` +
        `this build requires ${REQUIRED_POSTGRES_MAJOR}.`,
      major,
    );
  }
  return major;
}

/** AD-11: refuse to run against anything but PostgreSQL 18. */
export async function assertPostgres18(sql: Sql): Promise<number> {
  const rows = await sql<{ server_version: string }[]>`
    SELECT current_setting('server_version') AS server_version
  `;
  const serverVersion = rows[0]?.server_version;
  if (!serverVersion) {
    throw new UnsupportedDatabaseError('The database did not report a server_version.');
  }
  return assertPostgresMajorSupported(serverVersion);
}

/**
 * Read the applied schema generation. Returns `null` when `schema_meta` is absent
 * or empty — that is an unmigrated database, not a supported state.
 */
export async function readSchemaVersion(sql: Sql): Promise<number | null> {
  const present = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.schema_meta') IS NOT NULL AS exists
  `;
  if (!present[0]?.exists) {
    return null;
  }
  const rows = await sql<{ version: number | null }[]>`
    SELECT max(version)::int AS version FROM schema_meta
  `;
  const version = rows[0]?.version;
  return version === null || version === undefined ? null : Number(version);
}

/** Pure form of the AD-15 guard, so the refusal path is unit-testable. */
export function assertSchemaVersionInRange(
  found: number | null,
  min: number,
  max: number,
): number {
  if (found === null) {
    throw new UnsupportedSchemaError(
      `No applied schema found (schema_meta is missing or empty); ` +
        `this build supports schema versions ${min}..${max}. ` +
        `Run the release pipeline migration job — processes never migrate at startup.`,
      null,
      min,
      max,
    );
  }
  if (found < min || found > max) {
    throw new UnsupportedSchemaError(
      `Unsupported schema version: found ${found}, this build supports ${min}..${max}.`,
      found,
      min,
      max,
    );
  }
  return found;
}

/** AD-15: refuse to serve or poll outside the declared schema range. */
export async function assertSchemaSupported(
  sql: Sql,
  min: number = SUPPORTED_SCHEMA_MIN,
  max: number = SUPPORTED_SCHEMA_MAX,
): Promise<number> {
  const found = await readSchemaVersion(sql);
  return assertSchemaVersionInRange(found, min, max);
}
