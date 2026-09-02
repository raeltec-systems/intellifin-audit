import {
  ConfigError,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';

/** Never cached: the health route reports live process and database state. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A wedged connection must not wedge the health check with it. */
export const HEALTH_QUERY_TIMEOUT_MS = 5_000;

class HealthQueryTimeoutError extends Error {
  override readonly name = 'HealthQueryTimeoutError';
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new HealthQueryTimeoutError('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The health route is a public, unauthenticated endpoint. Our own refusals are safe
 * to state exactly — they name a version or a range, nothing more. A raw driver
 * error is not: it can carry the host, port, user, or database name it failed on.
 * Anything we did not raise ourselves collapses to one opaque reason.
 */
function reasonFor(error: unknown): string {
  if (
    error instanceof ConfigError ||
    error instanceof UnsupportedDatabaseError ||
    error instanceof UnsupportedSchemaError
  ) {
    return error.message;
  }
  return 'Database unavailable';
}

/**
 * `GET /api/health`
 *
 * 200 `{"status":"ok","schema":<n>}` once the AD-11 PostgreSQL-major check and the
 * AD-15 schema-range check have both passed and the database answers.
 * 503 `{"status":"unavailable","reason":"..."}` otherwise.
 */
export async function GET(): Promise<Response> {
  try {
    const runtime = await getRuntime();
    await withTimeout(Promise.resolve(runtime.sql`SELECT 1`), HEALTH_QUERY_TIMEOUT_MS);
    return Response.json(
      { status: 'ok', schema: runtime.schemaVersion },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { status: 'unavailable', reason: reasonFor(error) },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
