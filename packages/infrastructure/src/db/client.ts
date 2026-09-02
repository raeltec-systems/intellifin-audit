import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options, type Sql } from 'postgres';

import * as schema from './schema.js';

/**
 * postgres.js connection factory. Only a composition root supplies the URL —
 * it comes from `loadConfig()` and is never read from `process.env` here.
 */
export function createSqlClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Sql {
  return postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
    ...options,
  });
}

export function createDb(sql: Sql) {
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;

/**
 * The handle Drizzle passes to a `db.transaction` callback.
 *
 * Every writer that must join a unit of work takes THIS type rather than `Database`, so
 * "this write is inside the transaction" is checked by the compiler instead of trusted.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type { Sql };
