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
 * A schema generation bound.
 *
 * Parsed from a strict `^\d+$` string rather than with `z.coerce.number()`, which
 * silently turns an empty string into 0. An unset-but-present variable
 * (`SCHEMA_RANGE_MIN=`) is a configuration mistake and must be refused, not read
 * as generation 0. Generations start at 1, so 0 is never valid either.
 */
const schemaGeneration = z
  .string()
  .regex(/^\d+$/, 'must be a whole number of digits, with no sign, spaces, or decimal point')
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => value >= 1, 'must be at least 1; schema generations start at 1');

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
    SCHEMA_RANGE_MIN: schemaGeneration,
    SCHEMA_RANGE_MAX: schemaGeneration,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SENTRY_DSN: optionalUrl,
    SENTRY_ENVIRONMENT: z.string().min(1).max(64).default('development'),
    SENTRY_TRACES_SAMPLE_RATE: sampleRate,
  })
  .refine((c) => c.SCHEMA_RANGE_MIN <= c.SCHEMA_RANGE_MAX, {
    message: 'SCHEMA_RANGE_MIN must be less than or equal to SCHEMA_RANGE_MAX',
    path: ['SCHEMA_RANGE_MIN'],
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
    SCHEMA_RANGE_MIN: env['SCHEMA_RANGE_MIN'],
    SCHEMA_RANGE_MAX: env['SCHEMA_RANGE_MAX'],
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
