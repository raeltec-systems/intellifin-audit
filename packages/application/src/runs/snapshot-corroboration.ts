import {
  corroborateObservation,
  readStructuralSnapshot,
  type ObservationRecord,
  type ParsedSnapshot,
  type StoredSnapshot,
} from '@intellifin/domain';
import type {
  ObservationCorroborationPort,
  ObservationCorroborationVerdict,
} from './execution-ports.js';

/**
 * Story 3.6's seam, filled: corroboration against the stored Structural Snapshot.
 *
 * The judging is entirely `packages/domain/src/runs/structural-snapshot.ts` — one
 * deterministic extractor, bytes in and verdict out. This file is the adapter between that
 * function and the port `registerObservations` calls: it holds the snapshots the producer
 * already froze, parses each one ONCE for a whole batch, and maps the domain's result onto
 * the port's shape.
 *
 * **It performs no I/O, and that is structural rather than remembered.** The only thing it
 * can reach is the `Uint8Array` it was constructed with, so there is no store, no fetch and
 * no clock it could use even by accident. That matters twice: corroboration runs INSIDE the
 * registration transaction, where a network call would hold PostgreSQL open across it; and
 * it runs BEFORE the digest, so a value that could differ between two reads would make a
 * redelivered batch produce a different digest and read as an integrity failure.
 *
 * The caller supplies the bytes it just verified. In the adapter stage those are the bytes
 * `freezeArtifact` read back out of the object store and proved equal, byte for byte, to
 * what was uploaded — so "the stored Structural Snapshot" is not a hopeful description of
 * them, it is what the freeze already established.
 */

/**
 * Build the corroboration port over a fixed set of stored snapshots.
 *
 * A grounding naming Evidence that is not in this set is reported unavailable, never
 * matched: "nothing could read it" and "it read the same" are different answers and only
 * one of them is a corroboration.
 */
export function snapshotCorroboration(
  snapshots: readonly StoredSnapshot[],
): ObservationCorroborationPort {
  // Parsed once per batch, not once per attribute: one Work Item registers an Observation
  // per included population record and each carries several groundings into the SAME
  // artifact, so parsing per grounding would re-parse one extraction thousands of times.
  const parsed = new Map<string, ParsedSnapshot>();
  for (const snapshot of snapshots) {
    if (!parsed.has(snapshot.evidenceId)) {
      parsed.set(snapshot.evidenceId, readStructuralSnapshot(snapshot));
    }
  }
  return {
    corroborate: (subjects: readonly ObservationRecord[]) =>
      Promise.resolve(
        subjects.map((record): ObservationCorroborationVerdict => {
          const result = corroborateObservation(record, parsed);
          return {
            observationId: result.observationId,
            outcome: result.outcome,
            diagnostic: result.diagnostic,
            // The identity is carried apart from the declared attributes: §B.1 lets a
            // declared attribute share the identity's name, and one list keyed by name
            // would silently give one of them the other's verdict.
            identity: result.identity?.corroboration ?? null,
            attributes: result.attributes.flatMap((entry) =>
              entry.corroboration === null
                ? []
                : [{ name: entry.name, corroboration: entry.corroboration }],
            ),
          };
        }),
      ),
  };
}
