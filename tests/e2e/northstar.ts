/**
 * Where the synthetic Northstar systems are served during a browser run, and how the
 * probe entry point is started against them.
 *
 * This module has NO side effects. `playwright.config.ts` imports it to build the server
 * list, and a module-level throw here would make the whole config unloadable — the same
 * rule `credentials.ts` follows.
 */

/** Default 4300, the same default `apps/northstar/src/main.ts` uses. */
export function northstarPort(): number {
  const raw = process.env['NORTHSTAR_PORT'];
  if (raw === undefined || raw === '') return 4300;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`NORTHSTAR_PORT must be a port number, found "${raw}"`);
  }
  return parsed;
}

export const NORTHSTAR_PORT = northstarPort();

/**
 * `localhost`, for the same reason the product's base URL uses it: the two spellings are
 * not one host to a browser, and a registration probed at one and fetched at the other
 * would be two different origins.
 */
export const NORTHSTAR_BASE_URL = `http://localhost:${String(NORTHSTAR_PORT)}`;

/**
 * A port nothing listens on, for the registration that must come back Unreachable.
 *
 * It is derived from the Northstar port rather than fixed, so a run that moved Northstar
 * out of the way of something else does not move it onto whatever is on the fixed port.
 */
export const UNREACHABLE_BASE_URL = `http://localhost:${String(NORTHSTAR_PORT + 1)}`;

/** The verbatim rule the read-only denial names. Held to the character by the specs. */
export const READ_ONLY_RULE =
  'FR-3: an audit credential may not write. Every Northstar synthetic system is read-only ' +
  'at the system level and refuses any method other than GET or HEAD.';
