import type { CredentialResolver, ResolvedCredential } from './execution-ports.js';

/**
 * What a stage knows about the credentials it has presented, and nothing else (Story 4.3).
 *
 * A `ResolvedCredential` has no field holding its value, so nothing can hold a list of
 * secrets — and nothing here does. What this holds is a list of RESOLVED CREDENTIALS, each
 * of which can answer two questions about text and bytes without giving the value up:
 * remove it, and say whether it is there. `JSON.stringify` of a guard yields an array of
 * objects each carrying a `reference` and two methods, exactly as it did before.
 *
 * **Why a guard rather than a parameter each producer passes.** `freezeArtifact` is where
 * every artifact this platform keeps is verified and registered, and the check belongs
 * where nothing can register without passing it rather than at each producer's call site.
 * It takes a `CredentialGuard` as a REQUIRED argument, so a call site that has one must
 * decide what to pass, and `NO_CREDENTIALS` is the explicit "this stage has presented
 * none" — the shape `NO_CORROBORATION` and `NO_EVALUATION` already have, and for the same
 * reason: an optional seam defaulted inside the function would let a composition root
 * register every artifact unscanned forever with nothing saying so.
 */
export interface CredentialGuard {
  /**
   * Every whole-value spelling of every held credential, removed.
   *
   * For an artifact this PLATFORM produced, before it is registered — and for the
   * platform's own record of where it went. Never for bytes a Target System served: those
   * are Evidence, and an artifact that carries a credential must FAIL registration rather
   * than be rewritten into something acceptable.
   */
  redact(text: string): string;
  /** Whether these bytes disclose any held credential, in any form this build recognises. */
  discloses(bytes: Uint8Array): boolean;
  /** How many credentials this guard holds. A fact about the guard, never about a value. */
  readonly held: number;
}

/**
 * A stage that has presented no credential.
 *
 * Explicit, and named at every call site that uses it, so "nothing was scanned for" is a
 * decision somebody wrote down rather than the default that happens when an argument is
 * omitted.
 */
export const NO_CREDENTIALS: CredentialGuard = {
  redact: (text) => text,
  discloses: () => false,
  held: 0,
};

/**
 * Wrap a resolver so that every credential it hands out is held by a guard.
 *
 * The stage calls `credentials.resolve` exactly where it did before and passes `guard` to
 * `freezeArtifact`; there is no separate "remember this one" step for a branch to skip.
 * A credential resolved through the ORIGINAL resolver would not be held, which is why the
 * stages wrap once at the top and never keep the unwrapped one.
 */
export function guardedCredentials(resolver: CredentialResolver): {
  readonly credentials: CredentialResolver;
  readonly guard: CredentialGuard;
} {
  const held: ResolvedCredential[] = [];
  const guard: CredentialGuard = {
    redact(text: string): string {
      let out = text;
      for (const credential of held) out = credential.redact(out);
      return out;
    },
    discloses(bytes: Uint8Array): boolean {
      for (const credential of held) if (credential.discloses(bytes)) return true;
      return false;
    },
    get held(): number {
      return held.length;
    },
  };
  return {
    credentials: {
      async resolve(reference: string, timeoutMs: number): Promise<ResolvedCredential> {
        const credential = await resolver.resolve(reference, timeoutMs);
        // Held before it is returned, so there is no window in which a caller has a
        // credential the guard does not know about. A duplicate resolution of the same
        // reference is held twice and costs one extra scan, which is cheaper than a
        // deduplication keyed by a reference a resolver is free to spell differently.
        held.push(credential);
        return credential;
      },
    },
    guard,
  };
}
