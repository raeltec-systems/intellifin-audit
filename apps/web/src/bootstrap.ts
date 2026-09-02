import {
  ConfigError,
  ManifestCredentialProvider,
  TimerDeadline,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  SUPPORTED_SCHEMA_RANGE,
  assertPostgres18,
  assertSchemaSupported,
  createAuth,
  createDb,
  createSqlClient,
  credentialCapabilityManifest,
  loadConfig,
  type AppConfig,
  type Auth,
  type AuthConfig,
  type Database,
  type Sql,
  type Telemetry,
} from '@intellifin/infrastructure';

import type { CredentialProvider, DeadlinePort } from '@intellifin/application';

import { telemetry } from './telemetry';

/**
 * The web composition root (AD-1, AD-11).
 *
 * This is the only place in `apps/web` that reads configuration or opens a database
 * connection. It runs the AD-11 PostgreSQL-major check and the AD-15 schema-range
 * check, and it never migrates. `instrumentation.ts` drives it at boot so the
 * process refuses to come up misconfigured rather than discovering it on a request.
 */

export interface WebRuntime {
  readonly config: AppConfig;
  readonly sql: Sql;
  /**
   * The Drizzle handle over the SAME pool as `sql`, built on first use. Route
   * handlers append audit events through it; opening a second pool per route would
   * multiply connections and put the event outside the transaction that produced it.
   */
  readonly db: Database;
  /** The shared telemetry facade, already configured by `instrumentation.ts`. */
  readonly telemetry: Telemetry;
  /** Better Auth, built on first use. Identity and session only — never roles (AD-7). */
  readonly auth: Auth;
  /**
   * The validated secret and origin behind `auth`.
   *
   * Exposed for ONE caller: `PostgresIdentityUnitOfWork`, which builds a privileged,
   * transaction-scoped Better Auth instance so an administrator's create-user command
   * can write the account inside the same transaction as its audit event. Nothing mounts
   * that instance on a route; the mounted one is `auth` above, where sign-up is disabled.
   */
  readonly authConfig: AuthConfig;
  /**
   * Answers what a credential reference may do, and never returns the credential.
   *
   * Built here because the declared manifest is configuration, and AD-11 says
   * configuration is read at a composition root. Its return type has two fields and
   * neither of them can hold a secret, so nothing downstream — a response body, a log
   * line, an audit payload — has anything credential-shaped to leak.
   */
  readonly credentials: CredentialProvider;
  /** Bounds every outward call the registration commands make. */
  readonly deadlines: DeadlinePort;
  /**
   * How many credential references this deployment has been told about.
   *
   * A COUNT, never the manifest: nothing outside the provider needs to know which
   * references exist, and a boot log that named them would put deployment topology in
   * the log stream for no gain.
   */
  readonly credentialCapabilityCount: number;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  /** The range this build accepts, for logging. Fixed by the build, never by the environment. */
  readonly supportedSchemaRange: string;
}

let runtimePromise: Promise<WebRuntime> | undefined;

/**
 * A refusal this build will give identically forever: the environment is wrong, the
 * server is the wrong major, or the schema is outside the supported range. Retrying
 * cannot change any of them, so the answer is cached.
 *
 * Everything else — a connection reset, a database still starting, a network blip —
 * is transient and must NOT be cached, or one unlucky first request would wedge the
 * process into permanent 503s.
 */
export function isPermanentRefusal(error: unknown): boolean {
  return (
    error instanceof ConfigError ||
    error instanceof UnsupportedDatabaseError ||
    error instanceof UnsupportedSchemaError
  );
}

/**
 * `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are optional in the shared schema
 * because the worker has no identity surface. This process does, and a web image
 * without them can serve a sign-in page that cannot sign anybody in — so it refuses
 * to start instead, at boot, with the offending keys named and no value echoed.
 */
function requireAuthConfig(config: AppConfig): AuthConfig {
  const issues: string[] = [];
  if (!config.BETTER_AUTH_SECRET) {
    issues.push('BETTER_AUTH_SECRET: is required for the web process');
  }
  if (!config.BETTER_AUTH_URL) {
    issues.push('BETTER_AUTH_URL: is required for the web process');
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return {
    secret: config.BETTER_AUTH_SECRET as string,
    baseUrl: config.BETTER_AUTH_URL as string,
  };
}

async function start(): Promise<WebRuntime> {
  const config = loadConfig();

  // This image is the web service. Started with the worker's environment it would
  // serve health checks for a process that is not the one being checked.
  if (config.SERVICE_NAME !== 'web') {
    throw new ConfigError([
      `SERVICE_NAME: must be "web" for this process, found "${config.SERVICE_NAME}"`,
    ]);
  }

  const authConfig = requireAuthConfig(config);
  const sql = createSqlClient(config.DATABASE_URL);

  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(sql);
    // Both are built on first use and then kept. Boot is a database check; a Drizzle
    // handle and a Better Auth instance are only needed once a request arrives, and
    // constructing them here would make the startup guards depend on two more things
    // that cannot fail in a way boot could report.
    let db: Database | undefined;
    let auth: Auth | undefined;
    const database = (): Database => (db ??= createDb(sql));
    // The manifest is parsed once, here, and the provider is a plain object over it.
    const manifest = credentialCapabilityManifest(config);
    const credentials = new ManifestCredentialProvider(manifest);

    return {
      config,
      sql,
      get db(): Database {
        return database();
      },
      telemetry,
      get auth(): Auth {
        auth ??= createAuth(database(), authConfig);
        return auth;
      },
      authConfig,
      credentials,
      deadlines: new TimerDeadline(),
      credentialCapabilityCount: manifest.size,
      schemaVersion,
      postgresMajor,
      supportedSchemaRange: SUPPORTED_SCHEMA_RANGE,
    };
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}

/**
 * Resolve the started runtime. A success and a permanent refusal are both cached;
 * a transient failure is forgotten so the next request tries again.
 */
export function getRuntime(): Promise<WebRuntime> {
  if (runtimePromise) return runtimePromise;

  const attempt: Promise<WebRuntime> = start().catch((error: unknown) => {
    if (!isPermanentRefusal(error) && runtimePromise === attempt) {
      runtimePromise = undefined;
    }
    throw error;
  });

  runtimePromise = attempt;
  return attempt;
}

/** Test seam: forget the cached runtime so the next call re-runs the asserts. */
export function resetRuntimeForTests(): void {
  runtimePromise = undefined;
}
