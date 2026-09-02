import type { Sql } from 'postgres';

/**
 * AD-11 and AD-15 startup guards.
 *
 * AD-11: verify the server really is PostgreSQL 18 at bootstrap.
 * AD-15: the release pipeline alone applies migrations; each process checks the
 * applied schema version against its declared support range and refuses to run
 * outside it. Neither guard ever migrates.
 */

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
  min: number,
  max: number,
): Promise<number> {
  const found = await readSchemaVersion(sql);
  return assertSchemaVersionInRange(found, min, max);
}
