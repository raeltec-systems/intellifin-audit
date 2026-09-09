import {
  SUPPORTED_SCHEMA_RANGE,
  UnsupportedSchemaError,
  assertPostgres18,
  assertSchemaSupported,
  upsertHeartbeat,
  type Database,
  type Sql,
  type Telemetry,
} from '@intellifin/infrastructure';
import { createExceptionFingerprinter, credentialTokenManifest, evidenceS3Config, type AppConfig, type EvidenceS3Config } from '@intellifin/infrastructure';
import type { ExceptionFingerprinter } from '@intellifin/application';
// Not from the barrel: the Agent Workspace implementation drives a real browser and holds
// the provider API key. See packages/infrastructure/src/index.ts.
import type { BrowserConnection } from '@intellifin/infrastructure/browser';
import { AGENT_PROMPT_VERSION, createAgentModelGateway, DEFAULT_AGENT_ANTHROPIC_MODEL, DEFAULT_AGENT_OPENAI_MODEL } from '@intellifin/infrastructure/agent-model';
import type { AgentModelGateway } from '@intellifin/application';

/** No network request here. An absent provider disables this stage, never substitutes a script. */
export function agentModel(config: AppConfig): AgentModelGateway | null {
  const common = {
    // Agent execution has its own checked-in system prompt and phase contract. The
    // procedure derivation prompt version remains a separate global configuration and
    // must not be copied into this identity.
    promptVersion: AGENT_PROMPT_VERSION,
    buildVersion: config.RAILWAY_GIT_COMMIT_SHA ?? 'unidentified-build',
    maxOutputTokens: config.MODEL_MAX_OUTPUT_TOKENS,
  };
  const anthropic = config.ANTHROPIC_API_KEY === undefined ? null : {
    ...common, provider: 'anthropic' as const, apiKey: config.ANTHROPIC_API_KEY,
    modelId: config.AGENT_ANTHROPIC_MODEL ?? DEFAULT_AGENT_ANTHROPIC_MODEL,
  };
  const openai = config.OPENAI_API_KEY === undefined ? null : {
    ...common, provider: 'openai' as const, apiKey: config.OPENAI_API_KEY,
    modelId: config.AGENT_OPENAI_MODEL ?? DEFAULT_AGENT_OPENAI_MODEL,
  };
  const primary = anthropic ?? openai;
  return primary === null ? null : createAgentModelGateway({ primary, fallback: anthropic === null ? null : openai });
}

/**
 * The worker's startup and loop mechanics, separated from `main.ts` so both can be
 * driven by a fake `sql`/`db` and a captured logger in a unit test. `main.ts` stays
 * a thin composition root: read config, wire, install signal handlers, exit.
 */

export type Logger = Pick<Telemetry, 'info' | 'error' | 'captureError'>;

export interface StartupResult {
  readonly postgresMajor: number;
  readonly schemaVersion: number;
}

/**
 * AD-11 (`server_version` is 18) and AD-15 (the applied schema is inside this
 * build's declared range). Logs the refusal with the declared range and the version
 * actually found, then rethrows so the caller decides how to die. Never migrates.
 */
export async function runStartupChecks(sql: Sql, telemetry: Logger): Promise<StartupResult> {
  const supportedSchemaRange = SUPPORTED_SCHEMA_RANGE;
  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(sql);
    telemetry.info('Startup checks passed', { postgresMajor, schemaVersion, supportedSchemaRange });
    return { postgresMajor, schemaVersion };
  } catch (error) {
    telemetry.captureError('Refusing to start', error, {
      supportedSchemaRange,
      foundSchemaVersion: error instanceof UnsupportedSchemaError ? error.found : null,
    });
    throw error;
  }
}

/**
 * Whether this worker can execute populations, and why not when it cannot.
 *
 * Population execution needs private object storage, which a deployment provisions
 * separately. Refusing to BOOT without it would be the wrong trade: the check runs after
 * plan derivation and recovery have started and before the heartbeat, so an unset
 * variable would stop derivation, notification delivery and the liveness row as well —
 * every Epic 2 duty this worker already performs — for a feature that cannot run yet
 * anyway. The same shape as the SUPPORTED_SCHEMA_MIN incident: a startup guard that
 * refuses the deployment its own release created. So the worker starts, says once and by
 * name that population execution is off, and keeps every other duty running.
 */
export function populationExecution(
  config: AppConfig,
): { readonly enabled: true; readonly config: EvidenceS3Config } | { readonly enabled: false; readonly reason: string } {
  const evidence = evidenceS3Config(config);
  return evidence
    ? { enabled: true, config: evidence }
    : { enabled: false, reason: 'EVIDENCE_S3_ENDPOINT is not configured' };
}

/**
 * Whether this worker can run adapter extraction, and why not when it cannot.
 *
 * Same trade as `populationExecution`, one stage along. Extraction needs a declared
 * credential manifest, which a deployment supplies separately; refusing to BOOT without
 * it would stop plan derivation, notification delivery and the liveness row as well —
 * every duty this worker already performs — for a stage that could not run anyway. So
 * the worker starts, says once and by name that extraction is off, and keeps going.
 *
 * An empty manifest is not silently accepted as "extraction with no credentials": every
 * Work Item would fail closed with `credential-unresolved`, which reads as a Target
 * System problem and is not one.
 */
export function adapterExtraction(
  config: AppConfig,
):
  | {
      readonly enabled: true;
      readonly credentials: ReadonlyMap<string, string>;
      readonly exceptions: ExceptionFingerprinter;
    }
  | { readonly enabled: false; readonly reason: string } {
  const credentials = credentialTokenManifest(config);
  if (credentials.size === 0) {
    return { enabled: false, reason: 'CREDENTIAL_TOKENS declares no audit credential' };
  }
  // Story 3.7. Extraction registers Observations, registration evaluates them, and an
  // `EXCEPTION` evaluation writes a permanent Exception that must carry a keyed
  // fingerprint. Without a key there is no honest fingerprint, so the STAGE is off rather
  // than the row being written unfingerprinted — the same trade `CREDENTIAL_TOKENS` makes
  // one line up, and the fail-closed direction: no evaluation happens at all.
  if (config.EXCEPTION_FINGERPRINT_KEY === undefined) {
    return { enabled: false, reason: 'EXCEPTION_FINGERPRINT_KEY is not configured' };
  }
  return {
    enabled: true,
    credentials,
    exceptions: createExceptionFingerprinter({
      keyId: config.EXCEPTION_FINGERPRINT_KEY_ID,
      key: config.EXCEPTION_FINGERPRINT_KEY,
    }),
  };
}

/**
 * Whether this worker can run the agent execution phase, and the capabilities it may
 * hand to that phase.
 *
 * Agent execution and adapter extraction share the resolver and the Exception
 * fingerprinter, but they do not share their availability rule. An adapter Target System
 * needs a declared credential; P-4's public Target System deliberately does not. Keep the
 * adapter guard above strict, and let the agent phase receive an empty manifest when the
 * only eligible frozen plan is that credential-free public path. A credential-requiring
 * frozen Target still fails closed when its resolver lookup is attempted.
 */
export function agentExecution(
  config: AppConfig,
):
  | {
      readonly enabled: true;
      /** Empty is meaningful: it is the credential-free P-4 public capability. */
      readonly credentials: ReadonlyMap<string, string>;
      readonly exceptions: ExceptionFingerprinter;
    }
  | { readonly enabled: false; readonly reason: string } {
  const credentials = credentialTokenManifest(config);
  if (config.EXCEPTION_FINGERPRINT_KEY === undefined) {
    return { enabled: false, reason: 'EXCEPTION_FINGERPRINT_KEY is not configured' };
  }
  return {
    enabled: true,
    credentials,
    exceptions: createExceptionFingerprinter({
      keyId: config.EXCEPTION_FINGERPRINT_KEY_ID,
      key: config.EXCEPTION_FINGERPRINT_KEY,
    }),
  };
}

/**
 * Which browser this worker provisions an Agent Workspace with, and why.
 *
 * Never disabled. A workspace is not an optional duty the way population execution and
 * adapter extraction are: without object storage there is nothing to write Evidence to,
 * and without a credential manifest every Work Item fails closed — but a browser is always
 * available, because the local mode is the same code path against a locally launched
 * Chromium. So the question is never "can this worker provision one", only WHICH
 * guarantee it provides, and that is recorded on every workspace row it writes.
 *
 * The two are NOT equivalent and the weaker one is named at boot rather than assumed:
 * `local` isolates browser state per Run and does not isolate the worker process at all.
 */
export function agentWorkspace(config: AppConfig): {
  readonly connection: BrowserConnection;
  readonly reason: string;
} {
  return config.SOLARI_API_KEY === undefined
    ? {
        connection: { mode: 'local' },
        reason:
          'SOLARI_API_KEY is not configured; a local browser isolates state per Run but not the worker process',
      }
    : {
        connection: {
          mode: 'solari',
          apiKey: config.SOLARI_API_KEY,
          region: config.SOLARI_REGION,
          baseUrl: config.SOLARI_BASE_URL,
          // Cannot be enabled after the session exists (Epic 5 constraint, honoured here).
          recording: config.SOLARI_RECORDING,
        },
        reason: 'SOLARI_API_KEY is configured',
      };
}

export interface HeartbeatLoop {
  /** Run one beat. Never throws; a failure is logged and the loop continues. */
  beat: () => Promise<void>;
  /** Beats skipped because the previous one was still running. Test/diagnostic seam. */
  skippedBeats: () => number;
}

/**
 * The liveness loop. A beat that outlives its tick must not overlap the next one:
 * a slow or wedged database would otherwise pile up connections until the pool is
 * exhausted, and a heartbeat that cannot finish is not made truer by starting again.
 */
export function createHeartbeatLoop(db: Database, host: string, telemetry: Logger): HeartbeatLoop {
  let inFlight = false;
  let skipped = 0;

  const beat = async (): Promise<void> => {
    if (inFlight) {
      skipped += 1;
      telemetry.info('Heartbeat skipped', {
        hostname: host,
        skippedBeats: skipped,
      });
      return;
    }

    inFlight = true;
    try {
      await upsertHeartbeat(db, host, new Date());
    } catch (error) {
      // A failed beat is logged and retried on the next tick; it never stops the loop.
      telemetry.captureError('Heartbeat upsert failed', error, {
        hostname: host,
      });
    } finally {
      inFlight = false;
    }
  };

  return { beat, skippedBeats: () => skipped };
}
