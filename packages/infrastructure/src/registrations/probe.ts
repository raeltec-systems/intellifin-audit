import { sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { targetSystemProbe, targetSystemRegistration } from '../db/schema.js';

/**
 * The Target System connectivity probe writer — the WORKER's side of AD-10.
 *
 * AD-10 fixes the direction: the worker observes and writes, the web reads. This module
 * is the write half, and it is deliberately unreachable from `apps/`:
 *
 *   - it is not exported from `registrations/index.js` or from the package barrel;
 *   - it has its own `@intellifin/infrastructure/probe` subpath; and
 *   - `.dependency-cruiser.cjs` fails the build on any import of it from `apps/`,
 *     including a transitive one, exactly as it does for the release migrator.
 *
 * A convention would not survive: "the web must not probe" is one refactor away from
 * being false, and the failure mode is a web request making an outbound call to a
 * customer's system. So it is a build failure instead.
 *
 * Nothing here probes yet. Story 1.8 brings the synthetic Northstar systems and the loop
 * that calls this; there is nothing to reach until then, and a probing loop against
 * systems that do not exist would write "unreachable" for every registration and mean
 * nothing by it. This delivers the write path and the boundary that protects it.
 */

export type ProbeState = 'reachable' | 'unreachable';

export interface ProbeObservation {
  readonly registrationId: string;
  readonly state: ProbeState;
  readonly observedAt: Date;
  /**
   * The worker that made the observation — a hostname, as `worker_heartbeat` uses.
   *
   * There is deliberately no field for what the probe SAW. A response body, a header, a
   * redirect target or an error string from a Target System is exactly the tool/provider
   * payload NFR-6 keeps out of this product's data, and a "detail" column is where it
   * would end up.
   */
  readonly observedBy: string;
}

/**
 * Record one observation, replacing whatever the previous one said.
 *
 * One row per registration, not a history: the surface answers "is it reachable now",
 * and an unbounded observation log is a table that grows forever to answer a question
 * about the present. A probe for a registration that has been removed is discarded
 * rather than failing, because the registration disappearing between the probe and the
 * write is normal, not an error.
 */
export async function recordProbe(db: Database, observation: ProbeObservation): Promise<boolean> {
  // ONE statement. It was a SELECT to check the registration exists, then an INSERT —
  // two statements, and under `db` they are not even guaranteed one connection, so the
  // registration could vanish in between and the INSERT would raise the foreign-key
  // error the check existed to prevent. `INSERT ... SELECT ... WHERE EXISTS` evaluates
  // the check and the write together, and `RETURNING` says which happened.
  // The timestamp is sent as ISO text with an explicit cast: in a raw statement there
  // is no column type for the driver to infer from, and it refuses a `Date`.
  const written = await db.execute(sql`
    INSERT INTO ${targetSystemProbe} (registration_id, state, observed_at, observed_by)
    SELECT ${observation.registrationId}, ${observation.state},
           ${observation.observedAt.toISOString()}::timestamptz, ${observation.observedBy}
    WHERE EXISTS (
      SELECT 1 FROM ${targetSystemRegistration}
      WHERE ${targetSystemRegistration.registrationId} = ${observation.registrationId}
    )
    ON CONFLICT (registration_id) DO UPDATE
      SET state = excluded.state,
          observed_at = excluded.observed_at,
          observed_by = excluded.observed_by
    RETURNING registration_id
  `);
  // postgres.js returns the rows themselves; drizzle may wrap them in `{ rows }`.
  const rows = (written as { rows?: unknown[] }).rows ?? (written as unknown[]);
  return Array.isArray(rows) && rows.length > 0;
}
