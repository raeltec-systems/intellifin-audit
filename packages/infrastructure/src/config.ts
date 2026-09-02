import { z } from 'zod';

/**
 * AD-11: runtime configuration is read only here, in infrastructure, and only on
 * behalf of a composition root (`apps/web/src/bootstrap.ts`, `apps/worker/src/main.ts`).
 * No `domain` or `application` code may read `process.env`.
 */

/** Names of the two deployable processes. */
export const SERVICE_NAMES = ['web', 'worker'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const configSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
    SERVICE_NAME: z.enum(SERVICE_NAMES),
    SCHEMA_RANGE_MIN: z.coerce.number().int().min(0),
    SCHEMA_RANGE_MAX: z.coerce.number().int().min(0),
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
