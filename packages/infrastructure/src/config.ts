import { z } from 'zod';

/**
 * AD-11: runtime configuration is read only here, in infrastructure, and only on
 * behalf of a composition root (`apps/web/src/bootstrap.ts`, `apps/worker/src/main.ts`).
 * No `domain` or `application` code may read `process.env`.
 */

/** Names of the two deployable processes. */
export const SERVICE_NAMES = ['web', 'worker'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

/**
 * The supported schema range is deliberately NOT configuration. It is a property of
 * the build and lives in `db/compat.ts` as `SUPPORTED_SCHEMA_MIN`/`SUPPORTED_SCHEMA_MAX`.
 * As an environment variable it drifted: a release migrated production to generation 2
 * while the deployment still declared `1..1`, and every process refused to start.
 * Any `SCHEMA_RANGE_MIN`/`SCHEMA_RANGE_MAX` left in an environment is ignored here.
 */

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().optional(),
);

const sampleRate = z
  .string()
  .regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/, 'must be a decimal from 0 through 1')
  .default('0')
  .transform(Number);

/**
 * The capability a credential reference may be DECLARED to have (FR-8).
 *
 * Two values, and `unknown` is deliberately not one of them: unknown is the absence of a
 * declaration, and `ManifestCredentialProvider` returns it for any reference the manifest
 * does not mention. Letting an environment declare `unknown` would be a way of writing
 * down "I do not know", which is what saying nothing already means.
 */
export const CREDENTIAL_CAPABILITY_VALUES = ['read-only', 'write-capable'] as const;
export type DeclaredCredentialCapability = (typeof CREDENTIAL_CAPABILITY_VALUES)[number];

/**
 * Parse `CREDENTIAL_CAPABILITIES`: a JSON object mapping an opaque credential reference
 * to what the issuer says it can do. `null` means the value is not that shape.
 *
 * This is a DECLARATION, not a probe, and it holds no secret — a reference and a verdict,
 * which is exactly what `CredentialCapabilityReport` can carry. A real capability service
 * replaces the provider that reads it; the port above it does not change.
 *
 * An absent or empty variable is an empty manifest, which refuses every registration
 * rather than accepting every one — the fail-closed direction.
 */
export function parseCredentialCapabilities(
  raw: string,
): Map<string, DeclaredCredentialCapability> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const manifest = new Map<string, DeclaredCredentialCapability>();
  // `Object.entries`, so inherited keys are not read; and every value is checked against
  // the vocabulary, so a typo declares nothing rather than declaring something wrong.
  for (const [reference, capability] of Object.entries(parsed)) {
    const key = reference.trim();
    if (key === '') return null;
    if (capability !== 'read-only' && capability !== 'write-capable') return null;
    // Two keys that trim to the SAME reference are a refusal, not a last-one-wins.
    //
    // `{"prod": "write-capable", " prod": "read-only"}` used to yield
    // `prod -> read-only`: the later `set` silently replaced an explicit write-capable
    // declaration, and registration input is trimmed too, so `prod` was then accepted
    // as proven read-only. That is a fail-OPEN in the one guarantee this manifest
    // exists to provide, and it is invisible — the two keys look different in the JSON.
    //
    // The whole manifest is rejected rather than the duplicate entry, and a rejected
    // manifest is empty, which refuses every registration. A deployment whose
    // declaration is ambiguous has not declared anything.
    if (manifest.has(key)) return null;
    manifest.set(key, capability);
  }
  return manifest;
}

export const configSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
    SERVICE_NAME: z.enum(SERVICE_NAMES),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SENTRY_DSN: optionalUrl,
    SENTRY_ENVIRONMENT: z.string().min(1).max(64).default('development'),
    SENTRY_TRACES_SAMPLE_RATE: sampleRate,
    /**
     * Better Auth signs session cookies with this. It is a secret: never logged,
     * never echoed in an error, and never sent to telemetry.
     *
     * Optional HERE and required by `apps/web`. The worker has no identity surface,
     * so demanding an authentication secret from it would make the worker refuse to
     * start over a value it will never use. The web composition root checks for it.
     */
    BETTER_AUTH_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32, 'must be at least 32 characters').optional(),
    ),
    /** The public origin the browser reaches. Web-only, for the same reason. */
    BETTER_AUTH_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^https?:\/\//, 'must start with http:// or https://')
        .optional(),
    ),
    /**
     * Declared capabilities of credential references, as JSON (FR-8).
     *
     * Optional, and an absent value means an empty manifest: every credential reference
     * is then unproven and every Target System registration is refused. That is the
     * fail-closed direction — a deployment that has declared nothing must not be able to
     * register a system with a credential nobody has vouched for.
     *
     * It carries no secret. See {@link parseCredentialCapabilities}.
     */
    CREDENTIAL_CAPABILITIES: z.preprocess(
      (value) => (value === '' || value === undefined ? '{}' : value),
      z
        .string()
        .refine(
          (raw) => parseCredentialCapabilities(raw) !== null,
          'must be a JSON object mapping a credential reference to "read-only" or "write-capable"',
        ),
    ),
    /**
     * Read only to decide whether `http://` is acceptable for BETTER_AUTH_URL. It is
     * not otherwise application configuration: what the build supports is a property
     * of the build (see `db/compat.ts`), not of the environment.
     */
    NODE_ENV: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    // Better Auth marks the session cookie `Secure` only for an https base URL. Over
    // http in production the cookie travels in clear text and any network hop can
    // replay it, so a plain-http production origin is refused rather than warned about.
    if (
      config.NODE_ENV === 'production' &&
      config.BETTER_AUTH_URL !== undefined &&
      !config.BETTER_AUTH_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message:
          'must use https:// when NODE_ENV is production; an http origin yields a session cookie with no Secure attribute',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

/** Thrown when the process environment does not satisfy {@link configSchema}. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid runtime configuration: ${issues.join('; ')}`);
    this.issues = issues;
  }

  /**
   * The names of the variables that failed, comma-separated, for telemetry.
   *
   * Sanitized telemetry deliberately drops `error.message`, so a refusal used to log
   * `errorKind: "ConfigError"` and nothing else -- true, and useless: it cost a whole
   * release cycle to learn which variable was missing. Each issue is written
   * `KEY: reason`, so the key name is everything before the first colon. Only names
   * are exposed; a value never reaches a log through here.
   */
  get keys(): string {
    const names = this.issues.map((issue) => issue.split(':', 1)[0]?.trim() ?? '');
    return [...new Set(names.filter(Boolean))].join(',');
  }
}

type EnvSource = Record<string, string | undefined>;

/**
 * Validate and return runtime configuration. Call this only from a composition root.
 * Never logs or echoes `DATABASE_URL`; failures name the offending keys only.
 */
export function loadConfig(env: EnvSource = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    DATABASE_URL: env['DATABASE_URL'],
    SERVICE_NAME: env['SERVICE_NAME'],
    LOG_LEVEL: env['LOG_LEVEL'],
    SENTRY_DSN: env['SENTRY_DSN'],
    SENTRY_ENVIRONMENT: env['SENTRY_ENVIRONMENT'],
    SENTRY_TRACES_SAMPLE_RATE: env['SENTRY_TRACES_SAMPLE_RATE'],
    BETTER_AUTH_SECRET: env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: env['BETTER_AUTH_URL'],
    CREDENTIAL_CAPABILITIES: env['CREDENTIAL_CAPABILITIES'],
    NODE_ENV: env['NODE_ENV'],
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  return parsed.data;
}

/**
 * The declared manifest, as the provider needs it.
 *
 * `loadConfig` has already refused anything that is not the right shape, so this cannot
 * fail; the fallback is an empty manifest, which refuses every registration.
 */
export function credentialCapabilityManifest(
  config: AppConfig,
): ReadonlyMap<string, DeclaredCredentialCapability> {
  return parseCredentialCapabilities(config.CREDENTIAL_CAPABILITIES) ?? new Map();
}
