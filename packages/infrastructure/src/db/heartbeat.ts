import type { Database } from './client.js';
import { workerHeartbeat } from './schema.js';

/**
 * AD-8: table access lives in infrastructure. The worker composition root asks for
 * a heartbeat; it does not know the table, the column names, or the upsert dialect.
 *
 * One row per hostname; `seen_at` is the only thing later beats change.
 */
export async function upsertHeartbeat(
  db: Database,
  hostname: string,
  seenAt: Date,
): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ hostname, seenAt })
    .onConflictDoUpdate({ target: workerHeartbeat.hostname, set: { seenAt } });
}
