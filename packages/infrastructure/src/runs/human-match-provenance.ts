import { DrizzleActorNameReader } from '../identity/role-repository.js';
import { sql } from 'drizzle-orm';
import type { HumanMatchDecision } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';

/** Join only the explicit registration link, its Observation digest, and the answered
 * wait in the same Run. Historical and contradictory links remain unknown. */
export async function readHumanMatchDecisions(db: Database | Transaction, runId: string,
  observationIds: readonly string[]): Promise<ReadonlyMap<string, HumanMatchDecision>> {
  const found = new Map<string, HumanMatchDecision>();
  const uniqueIds = [...new Set(observationIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 500) {
    const ids = uniqueIds.slice(offset, offset + 500);
    // Count every explicit link before checking validity: one valid link cannot hide
    // a conflicting link with a foreign wait or digest.
    const rows = await db.execute<{ observation_id: string; wait_id: string; answer_option_id: string; answer_label: string; actor: string; closed_at: Date | string }>(sql`
      WITH registered_links AS (
        SELECT o.observation_id, o.run_id, o.digest, link,
          count(*) OVER (PARTITION BY o.observation_id) AS link_count
        FROM run_observation o
        JOIN audit_events e ON e.aggregate_id=o.run_id::text AND e.event_type='execution.observations-registered'
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload->'matchingDecisions')='array'
          THEN e.payload->'matchingDecisions' ELSE '[]'::jsonb END) link
        WHERE o.run_id=${runId}::uuid AND o.observation_id::text IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
          AND o.match_origin='human-matched' AND link->>'observationId'=o.observation_id::text
      )
      SELECT o.observation_id, w.wait_id, w.answer_option_id, option->>'label' AS answer_label, w.actor, w.closed_at
      FROM registered_links o
      JOIN run_wait w ON w.wait_id::text=o.link->>'waitId' AND w.run_id=o.run_id
      CROSS JOIN LATERAL jsonb_array_elements(w.options) option
      WHERE o.link_count=1 AND o.link->>'digest'=o.digest
        AND w.kind='choose-candidate' AND w.closure_kind='answer'
        AND option->>'id'=w.answer_option_id AND w.answer_option_id IS NOT NULL AND w.actor IS NOT NULL AND w.closed_at IS NOT NULL`);
    const duplicates = new Set<string>();
    for (const row of rows) {
      if (found.has(row.observation_id)) { duplicates.add(row.observation_id); continue; }
      found.set(row.observation_id, { waitId: row.wait_id, answerOptionId: row.answer_option_id, answerLabel: row.answer_label,
        actorId: row.actor, decidedAt: new Date(row.closed_at).toISOString() });
    }
    for (const id of duplicates) found.delete(id);
  }
  const actors = [...new Set([...found.values()].map(value => value.actorId))];
  for (let offset = 0; offset < actors.length; offset += 200) {
    const names = await new DrizzleActorNameReader(db).namesFor(actors.slice(offset, offset + 200));
    for (const [id, value] of found) { const name = names.get(value.actorId); if (name !== undefined) found.set(id, { ...value, actorName: name }); }
  }
  return found;
}
