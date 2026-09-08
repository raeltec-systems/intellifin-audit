/**
 * The version of the checked-in Agent model system prompt and its phase contract.
 *
 * This is intentionally separate from the Procedure derivation prompt version. Agent
 * turns consume frozen plan data at execution time, while Procedure derivation persists
 * its own model provenance on the version; one deployment may therefore support both
 * prompt identities without making historical plans appear to have changed.
 */
export const AGENT_PROMPT_VERSION = '4' as const;
