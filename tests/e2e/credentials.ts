import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

/**
 * The token the worker presents for the read-only reference (Story 3.3).
 *
 * A synthetic value with no meaning to anything: every Northstar system is read-only at
 * the system level and ignores the header. It is here so the browser run can assert the
 * containment claim positively — this exact string must appear in NOTHING the Run stores.
 */
export const READ_ONLY_TOKEN = 'synthetic-e2e-adapter-token-4f21-never-store-me';

/**
 * LoanCore's reference and its synthetic credential, read from the FIXTURE (Story 4.2).
 *
 * Read rather than retyped: `fixtures/northstar/datasets/systems.json` is the one place
 * the value is declared, the synthetic system checks it from there, and a copy typed into
 * this file would agree with it right up until somebody changed one of them. It is
 * synthetic and it authenticates nothing outside this repository.
 */
const LOANCORE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/northstar/datasets/systems.json', import.meta.url)),
    'utf8',
  ),
) as { target_systems: { id: string; credential_ref?: string; credential_token?: string }[] };

const loancore = LOANCORE.target_systems.find((entry) => entry.id === 'loancore');

/**
 * A missing declaration falls back rather than throwing, and the guard lives elsewhere.
 *
 * `playwright.config.ts` imports this module to build the server environment, so a
 * module-level throw would make the whole config unloadable — the rule this file has
 * carried since Story 1.6. The fixture actually declaring a credential is asserted by
 * `apps/northstar/src/authentication.test.ts`, which runs in the unit suite, and the
 * synthetic system itself refuses to serve LoanCore without one. The fallbacks are
 * non-empty so the manifest still parses; they authenticate nothing, which is what makes
 * a run against a broken fixture fail visibly at the sign-in rather than silently pass.
 */
export const LOANCORE_CREDENTIAL = loancore?.credential_ref ?? 'cred://synthetic/loancore-undeclared';
export const LOANCORE_TOKEN =
  loancore?.credential_token ?? 'loancore-credential-not-declared-in-the-fixture';

/** What `CREDENTIAL_TOKENS` is set to for the WORKER the population spec starts. */
export const CREDENTIAL_TOKENS = JSON.stringify({
  [READ_ONLY_CREDENTIAL]: READ_ONLY_TOKEN,
  [LOANCORE_CREDENTIAL]: LOANCORE_TOKEN,
});

/**
 * The Exception fingerprint key and its id, for the same worker (Story 3.7).
 *
 * Without a key the adapter stage refuses to start at all — an Exception is a permanent
 * row and must carry a keyed fingerprint — so the browser run supplies one. It is
 * synthetic and signs nothing outside this suite.
 */
export const EXCEPTION_FINGERPRINT_KEY = 'synthetic-e2e-exception-fingerprint-key';
export const EXCEPTION_FINGERPRINT_KEY_ID = 'e2e';

/** What `CREDENTIAL_CAPABILITIES` is set to for the server the specs drive. */
export const CREDENTIAL_CAPABILITIES = JSON.stringify({
  [READ_ONLY_CREDENTIAL]: 'read-only',
  [LOANCORE_CREDENTIAL]: 'read-only',
  [WRITE_CAPABLE_CREDENTIAL]: 'write-capable',
});
