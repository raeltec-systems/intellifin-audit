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
