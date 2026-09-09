import {
  ABSENCE_SNAPSHOT_LOCATOR,
  type EvidenceReadGrantRepository,
} from '@intellifin/application';
import {
  parseSnapshotLocator,
  readSnapshotCell,
  readStructuralSnapshot,
  snapshotSubstrateForMediaType,
  type SnapshotCell,
} from '@intellifin/domain';

import {
  downloadWithGrant,
  type EvidenceGrantDownloadFailure,
  type GrantDownloadEnvironment,
  type GrantDownloadInput,
} from './evidence-grant-download';

export { EVIDENCE_READ_MAX_BYTES } from './evidence-grant-download';

/** Why a server-side snapshot read did not yield a cell. Values are platform vocabulary. */
export type EvidenceSnapshotReadFailure =
  | EvidenceGrantDownloadFailure
  | 'snapshot-unreadable'
  | 'locator-malformed'
  | 'locator-unresolved';

export type EvidenceSnapshotReadResult =
  | { readonly cell: SnapshotCell; readonly failure: null }
  | { readonly cell: null; readonly failure: EvidenceSnapshotReadFailure };

export type ReadSnapshotCellInput = GrantDownloadInput;

export type SnapshotReadEnvironment = GrantDownloadEnvironment;

/**
 * Consume one capability entirely on the web server and return only the domain cell.
 * `EvidenceReadGrantRepository` is an application port; the signed URL is never returned
 * by this function, rendered by React, placed in a link, or sent to telemetry. The
 * download, the verification and the access record are `downloadWithGrant`'s — the one
 * implementation the Live View frame reader shares (Story 5.3).
 */
export async function readSnapshotCellWithGrant(
  repository: Pick<EvidenceReadGrantRepository, 'readForActor' | 'recordAccess'>,
  input: ReadSnapshotCellInput,
  environment: SnapshotReadEnvironment = {},
): Promise<EvidenceSnapshotReadResult> {
  const downloaded = await downloadWithGrant(repository, input, environment);
  if (downloaded.failure !== null) return { cell: null, failure: downloaded.failure };
  const { bytes, capability } = downloaded;
  const substrate = snapshotSubstrateForMediaType(capability.mediaType);
  if (substrate === null) return { cell: null, failure: 'snapshot-unreadable' };
  const parsed = readStructuralSnapshot({ evidenceId: input.evidenceId, substrate, bytes });
  if (!parsed.ok) return { cell: null, failure: 'snapshot-unreadable' };
  if (input.locator === ABSENCE_SNAPSHOT_LOCATOR) {
    if (parsed.substrate !== 'web_tree') return { cell: null, failure: 'snapshot-unreadable' };
    // The entire bounded document is shown as inert JSON. It is a view of the captured
    // empty-result page, not an invented matched-row cell or a second absence judge.
    return { cell: { value: JSON.parse(JSON.stringify(parsed.document)), label: 'Captured empty-result page' }, failure: null };
  }
  const locator = parseSnapshotLocator(input.locator);
  if (locator === null) return { cell: null, failure: 'locator-malformed' };
  const cell = readSnapshotCell(parsed, locator);
  return cell === null ? { cell: null, failure: 'locator-unresolved' } : { cell, failure: null };
}
