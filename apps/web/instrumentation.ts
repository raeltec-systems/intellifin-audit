/**
 * AD-11 and AD-15 run at boot, not lazily on the first request.
 *
 * Next.js calls `register()` once per server process. A permanent refusal — bad
 * configuration, the wrong PostgreSQL major, a schema outside this build's range —
 * exits the process non-zero so the platform sees a failed deploy instead of a
 * container that starts, answers 503, and looks healthy enough to keep. A transient
 * failure (the database is still coming up) is logged and tolerated: the process
 * serves, `/api/health` answers 503, and the next request retries.
 *
 * The work itself is in `src/boot.ts` and is imported dynamically. Next compiles this
 * file for the edge runtime as well, because `middleware.ts` runs there, and the edge
 * has no `process.exit`, no `process.stdout` and no postgres.js. Keeping the import
 * inside the Node.js branch keeps all of that out of the edge bundle.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { runStartupChecks } = await import('./src/boot');
  await runStartupChecks();
}
