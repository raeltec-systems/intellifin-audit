import { getRuntime } from '../../../src/bootstrap';

/** Never cached: the health route reports live process and database state. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * `GET /api/health`
 *
 * 200 `{"status":"ok","schema":<n>}` once the AD-11 PostgreSQL-major check and the
 * AD-15 schema-range check have both passed and the database answers.
 * 503 `{"status":"unavailable","reason":"..."}` otherwise. The reason names the
 * failing check and never echoes configuration values.
 */
export async function GET(): Promise<Response> {
  try {
    const runtime = await getRuntime();
    await runtime.sql`SELECT 1`;
    return Response.json(
      { status: 'ok', schema: runtime.schemaVersion },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown startup failure';
    return Response.json(
      { status: 'unavailable', reason },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
