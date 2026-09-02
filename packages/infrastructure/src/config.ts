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
