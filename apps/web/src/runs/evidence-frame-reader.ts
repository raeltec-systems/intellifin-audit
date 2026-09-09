import { FRAME_LOCATOR, FRAME_MEDIA_TYPE, type EvidenceReadGrantRepository } from '@intellifin/application';

import {
  contentTypeBase,
  downloadWithGrant,
  type EvidenceGrantDownloadFailure,
  type GrantDownloadEnvironment,
  type GrantDownloadInput,
} from './evidence-grant-download';

/** Why a server-side frame read did not yield an image. Values are platform vocabulary. */
export type EvidenceFrameReadFailure = EvidenceGrantDownloadFailure | 'frame-locator-mismatch';

/** One verified frame: the registered PNG bytes and the digest they were checked against. */
export interface EvidenceFrame {
  readonly bytes: Uint8Array;
  readonly mediaType: typeof FRAME_MEDIA_TYPE;
  readonly digest: string;
  readonly size: number;
}

export type EvidenceFrameReadResult =
  | { readonly frame: EvidenceFrame; readonly failure: null }
  | { readonly frame: null; readonly failure: EvidenceFrameReadFailure };

/**
 * Consume one FRAME capability on the web server and return the verified image bytes
 * (Story 5.3, AD-17: "a live frame is a Replay asset the moment it is registered").
 *
 * The download, the size and digest verification and the access record are
 * `downloadWithGrant`'s, shared with the Structural Snapshot cell inspector. What this
 * adds is the frame's own scope: the locator must be the frame sentinel — a cell locator
 * is a different kind of read and is refused here before any I/O — and the capability the
 * worker issued must name a PNG, which the worker already requires and this checks again,
 * because a structural type does not contain anything.
 */
export async function readFrameWithGrant(
  repository: Pick<EvidenceReadGrantRepository, 'readForActor' | 'recordAccess'>,
  input: GrantDownloadInput,
  environment: GrantDownloadEnvironment = {},
): Promise<EvidenceFrameReadResult> {
  if (input.locator !== FRAME_LOCATOR) return { frame: null, failure: 'frame-locator-mismatch' };
  const downloaded = await downloadWithGrant(repository, input, environment);
  if (downloaded.failure !== null) return { frame: null, failure: downloaded.failure };
  if (contentTypeBase(downloaded.capability.mediaType) !== FRAME_MEDIA_TYPE) return { frame: null, failure: 'download-media-type-mismatch' };
  return {
    frame: {
      bytes: downloaded.bytes,
      mediaType: FRAME_MEDIA_TYPE,
      digest: downloaded.capability.digest,
      size: downloaded.bytes.byteLength,
    },
    failure: null,
  };
}
