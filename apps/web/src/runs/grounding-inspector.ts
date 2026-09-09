import {
  parseSnapshotLocator,
  readSnapshotCell,
  readStructuralSnapshot,
  type JsonValue,
  type ObservationAttribute,
  type SnapshotSubstrate,
  type StoredSnapshot,
} from '@intellifin/domain';

/** Why a stored artifact could not be opened at a grounding locator. */
export type GroundingInspectionFailure =
  | 'substrate-unavailable'
  | 'snapshot-unavailable'
  | 'snapshot-evidence-mismatch'
  | 'snapshot-substrate-mismatch'
  | 'snapshot-unsupported'
  | 'snapshot-unreadable'
  | 'locator-malformed'
  | 'locator-unresolved';

/** The cell the domain re-read from a stored artifact, when one was available. */
export interface GroundingInspection {
  readonly cell: { readonly value: JsonValue; readonly label: string } | null;
  readonly failure: GroundingInspectionFailure | null;
}

/**
 * Re-read one grounding from the exact stored artifact named by its Evidence id.
 *
 * The web surface never imports an EvidenceStore. Its route supplies a stored artifact
 * through this narrow resolver, and this helper delegates parsing and locator resolution
 * to the domain's one snapshot reader. A missing, mismatched or unreadable artifact is
 * described to the caller rather than treated as a successful read.
 */
export function inspectStoredGrounding(
  attribute: ObservationAttribute,
  substrate: SnapshotSubstrate | null,
  snapshot: StoredSnapshot | null,
): GroundingInspection {
  const grounding = attribute.grounding;
  if (grounding === null) return { cell: null, failure: null };
  if (substrate === null) return { cell: null, failure: 'substrate-unavailable' };
  if (snapshot === null) return { cell: null, failure: 'snapshot-unavailable' };
  if (snapshot.evidenceId !== grounding.evidenceId) {
    return { cell: null, failure: 'snapshot-evidence-mismatch' };
  }
  if (snapshot.substrate !== substrate) {
    return { cell: null, failure: 'snapshot-substrate-mismatch' };
  }

  const parsed = readStructuralSnapshot(snapshot);
  if (!parsed.ok) {
    return {
      cell: null,
      failure: parsed.failure === 'substrate-unsupported' ? 'snapshot-unsupported' : 'snapshot-unreadable',
    };
  }
  const locator = parseSnapshotLocator(grounding.locator);
  if (locator === null) return { cell: null, failure: 'locator-malformed' };
  const cell = readSnapshotCell(parsed, locator);
  return cell === null
    ? { cell: null, failure: 'locator-unresolved' }
    : { cell, failure: null };
}

/** Serialize a JSON value without allowing a malformed legacy row to break the page. */
export function groundingValueText(value: JsonValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unreadable JSON value]';
  }
}

/** A closed, platform-owned explanation for the corroboration badge. */
export function corroborationReason(
  value: string | null,
  diagnostic: string | null,
): string {
  if (value === 'matched') return 'The stored snapshot value and field label matched the Observation.';
  if (value === 'model-read') return 'The value was read by the model under the frozen Procedure Version.';
  if (value === 'contradictory') {
    switch (diagnostic) {
      case 'corroboration-label-drift':
        return 'The stored snapshot field label differs from the recorded label.';
      case 'identity-mismatch':
        return 'The stored snapshot identity differs from the population record key.';
      case 'corroboration-unavailable':
        return 'The stored snapshot could not be read for corroboration.';
      case 'corroboration-unsupported':
        return 'This snapshot substrate is not supported by the corroborator.';
      case 'identity-grounding-split':
        return 'The identity and value groundings name different Structural Snapshots.';
      default:
        return 'The stored snapshot disagrees with the recorded Observation.';
    }
  }
  return 'This attribute has not been corroborated.';
}

/** Explain why a snapshot cell was not shown; all branches are platform vocabulary. */
export function groundingInspectionReason(failure: GroundingInspectionFailure): string {
  switch (failure) {
    case 'substrate-unavailable':
      return 'The registered Evidence media type does not identify a readable snapshot.';
    case 'snapshot-unavailable':
      return 'The stored snapshot is unavailable to this page.';
    case 'snapshot-evidence-mismatch':
      return 'The supplied artifact does not match the Evidence id in this grounding.';
    case 'snapshot-substrate-mismatch':
      return 'The supplied artifact substrate does not match the registered media type.';
    case 'snapshot-unsupported':
      return 'This snapshot substrate is not readable by the domain extractor.';
    case 'snapshot-unreadable':
      return 'The stored snapshot is unreadable.';
    case 'locator-malformed':
      return 'The grounding locator is malformed.';
    case 'locator-unresolved':
      return 'The grounding locator does not resolve in the stored snapshot.';
  }
}
