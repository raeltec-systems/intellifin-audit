import {
  PopulationAcquisitionError,
  type CredentialHeaderSink,
  type CredentialResolver,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  SecretTooShortError,
} from '@intellifin/domain';

export { credentialTokenManifest, parseCredentialTokens } from '../config.js';

/**
 * The just-in-time credential seam, and the only place in this codebase that holds an
 * audit credential's VALUE.
 *
 * Deliberately outside the barrel (`./credentials`), like `./acquisition`, `./evidence`
 * and `./probe`: `apps/web` imports the barrel, and the web process must never be able
 * to reach a token at all. `no-credential-resolver-in-web` fails the build on any import
 * of this module from `apps/web`, in both the `src` and the `dist` spelling.
 *
 * `CredentialProvider.describe` (Story 1.6) is a DIFFERENT port and stays as it is: it
 * proves a reference read-only at registration time and has exactly two fields for that
 * reason. Widening it to return a token would put a secret inside a report the web reads.
 *
 * What leaves this file is a `ResolvedCredential`, which has no field holding the value:
 * the token lives in the closure `authorize` captures, so `JSON.stringify` of the object
 * yields its reference alone and there is nowhere for a checkpoint, an audit payload, a
 * queue job or a log field to pick it up from.
 */

/** The header an adapter presents the credential in. Bearer, and nothing else. */
const AUTHORIZATION_HEADER = 'authorization';

/**
 * A credential the caller may present exactly once, on the wire.
 *
 * The factory is the containment: `token` is a parameter, never a property. Every method
 * below closes over it and none of them returns it, so `JSON.stringify` of the result is
 * `{"reference":"..."}` and there is nowhere for a checkpoint, an audit payload, a
 * Timeline event, a queue job, a log field or an error message to pick a value up from.
 *
 * `redact` and `discloses` are Story 4.3's, and neither widens what a holder can learn:
 * `authorize` already writes the value into any sink it is handed, so a method that
 * REMOVES the value from text and a method that ANSWERS whether bytes contain it add no
 * capability. What they add is the ability to keep a credential out of an artifact this
 * platform is about to keep forever, without anything having to hold the value to do it.
 *
 * The forms are compiled ONCE, here, inside the closure: an artifact is not re-encoded per
 * scan, and a value this build cannot scan for is REFUSED rather than quietly given a
 * scanner that never matches (`compileSecret` throws below {@link MIN_SCANNED_SECRET}).
 */
export function resolvedCredential(reference: string, token: string): ResolvedCredential {
  const secret = compileSecret(token);
  return {
    reference,
    authorize(headers: CredentialHeaderSink): void {
      headers.set(AUTHORIZATION_HEADER, `Bearer ${token}`);
    },
    redact(text: string): string {
      return redactCompiled(text, secret);
    },
    discloses(bytes: Uint8Array): boolean {
      return bytesDiscloseCompiled(bytes, secret);
    },
  };
}

/**
 * Resolve a reference against a declared manifest.
 *
 * A reference the manifest does not name resolves to nothing — the fail-closed
 * direction, exactly as an undeclared capability refuses a registration rather than
 * accepting it. The thrown error carries the code and no other information: not the
 * reference, not the manifest's size, and certainly not a token.
 */
export class ManifestCredentialResolver implements CredentialResolver {
  private readonly manifest: ReadonlyMap<string, string>;

  constructor(manifest: ReadonlyMap<string, string>) {
    this.manifest = manifest;
  }

  resolve(reference: string, timeoutMs: number): Promise<ResolvedCredential> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new PopulationAcquisitionError('contract'));
    }
    if (typeof reference !== 'string' || reference.trim() !== reference || reference === '') {
      return Promise.reject(new PopulationAcquisitionError('contract'));
    }
    const token = this.manifest.get(reference);
    if (token === undefined) return Promise.reject(new PopulationAcquisitionError('contract'));
    // The echoed reference is the one that was ASKED for. A caller compares them, so a
    // service that batched, cached by a normalized key or resolved an alias could not
    // quietly answer about a different credential.
    try {
      return Promise.resolve(resolvedCredential(reference, token));
    } catch (error) {
      // A token this build cannot scan an artifact for is a credential whose containment it
      // cannot honour, so it is not resolved at all — the fail-closed direction, and the
      // one that keeps the guarantee true rather than nearly true. It is reported as
      // `contract` like every other unusable declaration, which the stages already map to
      // `credential-unresolved`: terminal on the first attempt, because a manifest entry
      // does not get longer by being asked for again. The error carries no value, no
      // length and no reference.
      if (error instanceof SecretTooShortError) {
        return Promise.reject(new PopulationAcquisitionError('contract'));
      }
      return Promise.reject(error instanceof Error ? error : new PopulationAcquisitionError('contract'));
    }
  }
}
