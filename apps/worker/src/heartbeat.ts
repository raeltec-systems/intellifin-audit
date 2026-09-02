import { workerHeartbeat, type Database } from '@intellifin/infrastructure';

/** How often the liveness row is refreshed. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Upsert this host's liveness row. One row per hostname; `seen_at` is the only
 * thing that changes on later beats.
 */
export async function upsertHeartbeat(db: Database, hostname: string, seenAt: Date): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ hostname, seenAt })
    .onConflictDoUpdate({ target: workerHeartbeat.hostname, set: { seenAt } });
}
