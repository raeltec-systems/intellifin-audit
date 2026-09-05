import { exceptionFingerprint, utf8Bytes, type ExceptionFingerprintEnvelope } from '@intellifin/domain';
import type { ExceptionFingerprinter } from '@intellifin/application';

/**
 * The deployment's Exception fingerprint key, as a port the evaluator can use (Story 3.7).
 *
 * There is deliberately NO field holding the key. `keyId` names it and `fingerprint` is the
 * only way it is used, so the value lives in this closure and nowhere else:
 * `JSON.stringify` of the returned object yields `{"keyId":"…"}` and no checkpoint, audit
 * payload, Timeline event, queue job, log field or error message has anywhere to pick the
 * secret up from. Containment by shape, not by discipline — the `ResolvedCredential`
 * lesson (Story 3.3), one story along.
 *
 * The key is encoded ONCE, here. Re-encoding it per Exception would mean a batch at the cap
 * re-derives the same bytes a hundred thousand times for nothing.
 */
export function createExceptionFingerprinter(input: {
  readonly keyId: string;
  readonly key: string;
}): ExceptionFingerprinter {
  const key = utf8Bytes(input.key);
  return {
    keyId: input.keyId,
    fingerprint: (envelope: ExceptionFingerprintEnvelope): string =>
      exceptionFingerprint(key, envelope),
  };
}
