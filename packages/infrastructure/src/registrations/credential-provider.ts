import type {
  CredentialCapability,
  CredentialCapabilityReport,
  CredentialProvider,
} from '@intellifin/application';

/**
 * The credential capability adapter (FR-8, AD-2).
 *
 * **It cannot return a secret, and that is the type's doing.** `describe` answers a
 * {@link CredentialCapabilityReport}, which has exactly two fields — the reference it
 * was asked about and a verdict. There is no field a secret could travel in, so no
 * response body, log line or audit payload downstream can carry one by accident.
 *
 * The verdicts come from a manifest supplied to the composition root, NOT from the
 * shape of the reference. Reading a capability out of a string — "it ends in
 * `-readonly`, so it is read-only" — would make the guarantee a naming convention that
 * anybody registering a system can satisfy by typing. The manifest is the out-of-band
 * declaration by whoever issued the credential; a real capability service replaces this
 * class and nothing else changes, because the port is what the command depends on.
 *
 * A reference the manifest does not mention is `unknown`, and the command refuses
 * `unknown` with the same sentence as `write-capable`. That is deliberate: an empty
 * manifest refuses every registration rather than accepting every one.
 */
export class ManifestCredentialProvider implements CredentialProvider {
  private readonly manifest: ReadonlyMap<string, CredentialCapability>;

  constructor(manifest: ReadonlyMap<string, CredentialCapability> | undefined) {
    this.manifest = manifest ?? new Map();
  }

  async describe(credentialRef: string): Promise<CredentialCapabilityReport> {
    const reference = credentialRef.trim();
    // `Map.get`, not a plain object lookup: an object indexed by request input answers
    // `constructor` and `toString` with something truthy from `Object.prototype`, and a
    // truthy answer here is a credential treated as proven. This is the fifth appearance
    // of that class of bug in this repository, which is why it is a rule in CLAUDE.md.
    return { credentialRef: reference, capability: this.manifest.get(reference) ?? 'unknown' };
  }
}
