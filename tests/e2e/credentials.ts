/**
 * The credential references the browser specs use, and the capabilities the running
 * application is told they have.
 *
 * These are REFERENCES and verdicts, not credentials: there is no secret here and there
 * cannot be one, because the whole point of Story 1.6 is that a secret never reaches the
 * web process. The manifest is passed to the dev server through
 * `CREDENTIAL_CAPABILITIES`, which is how a deployment declares what an issuer said
 * about a reference until a real capability service exists.
 *
 * This module has NO side effects on purpose. `playwright.config.ts` imports it to build
 * the server environment, and a module-level throw here (as `accounts.ts` deliberately
 * has for the password) would make the whole config unloadable.
 */

/** Declared read-only. A registration using it can be saved. */
export const READ_ONLY_CREDENTIAL = 'cred://synthetic/e2e-northstar-readonly';

/** Declared write-capable. A registration using it must be refused, verbatim. */
export const WRITE_CAPABLE_CREDENTIAL = 'cred://synthetic/e2e-northstar-writer';

/**
 * Declared by nothing. It must be refused with the SAME sentence as the write-capable
 * one: a credential that cannot be proven read-only is not a credential proven
 * read-only.
 */
export const UNDECLARED_CREDENTIAL = 'cred://synthetic/e2e-nobody-vouched-for-this';

/** The verbatim refusal. FR-8 fixes this string; the specs hold it to the character. */
export const READ_ONLY_REFUSAL = 'Audit credentials must be read-only.';

/** What `CREDENTIAL_CAPABILITIES` is set to for the server the specs drive. */
export const CREDENTIAL_CAPABILITIES = JSON.stringify({
  [READ_ONLY_CREDENTIAL]: 'read-only',
  [WRITE_CAPABLE_CREDENTIAL]: 'write-capable',
});
