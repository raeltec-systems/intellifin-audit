export const TELEMETRY_FIELD_KEYS = [
  'action',
  'aggregateId',
  'configKeys',
  'correlationId',
  'durationMs',
  'environment',
  'errorCode',
  'errorKind',
  'eventId',
  'eventType',
  'foundPostgresMajor',
  'foundSchemaVersion',
  'hostname',
  'intervalMs',
  'method',
  /**
   * Which browser an Agent Workspace runs in — `solari` or `local` (Story 4.1).
   *
   * Two values, both build constants, and neither says anything about what was read. It is
   * logged because the two modes are not the same guarantee and an operator reading this
   * stream must be able to tell which one a deployment is running.
   */
  'mode',
  'operation',
  'outcome',
  'postgresMajor',
  // The Target System probe sweep's summary (Story 1.8). Four counts and nothing about
  // what was read: a response body, a header or an error string from a customer's system
  // is exactly what NFR-6 keeps out of this product's data.
  'probed',
  'probeReachable',
  'probeUnreachable',
  'probeSkipped',
  /**
   * Why a pipeline entry point refused to run.
   *
   * The migrator and the probe both logged one, and both were dropped here — so
   * "Refusing to migrate" reached the release log with the reason removed, which is the
   * one thing that message exists to carry. Every value passed is a constant in this
   * repository, and `safeScalar` caps it at 256 characters.
   */
  'reason',
  /**
   * Whether an Agent Workspace session is created with PROVIDER recording (Story 4.1).
   *
   * A build-constant boolean that says nothing about what was read, so it clears the same
   * NFR-6 bar `mode` does — and it is logged for a stronger reason. It is not whether
   * Replay works (Replay is whole from the platform-owned asset set); it is whether the
   * provider is capturing input values, which a sign-in types a credential into. It can
   * only be set at `sessions.create()`, so nothing else in this stream says which one a
   * deployment is running.
   */
  'recording',
  'role',
  'route',
  /**
   * How a handled Run ended (2026-09-16). The Run id, its terminal state, the stage that
   * stopped it and that stage's closed diagnostic — every value a build constant or an
   * identifier, nothing a Target System said. Two production Runs failed with the worker's
   * log stream holding nothing at all about them, so the only record of WHY was a checkpoint
   * column no surface read; this is the line an operator reads first.
   */
  'runId',
  'stage',
  'state',
  'diagnostic',
  'schemaVersion',
  'sessionId',
  'signal',
  'skippedBeats',
  'statusCode',
  'supportedSchemaRange',
  'userId',
] as const;

export type TelemetryFieldKey = (typeof TELEMETRY_FIELD_KEYS)[number];
export type TelemetryScalar = string | number | boolean | null;
export type TelemetryFields = Partial<Record<TelemetryFieldKey, TelemetryScalar>>;

const ALLOWED_FIELDS = new Set<string>(TELEMETRY_FIELD_KEYS);
const MAX_SCALAR_LENGTH = 256;

/** Key shapes that must be removed recursively before any telemetry sink. */
export const HOSTILE_TELEMETRY_KEY_PATTERN =
  /password|passwd|secret|token|authorization|cookie|credential|evidence|provider|tool|snapshot|signedurl|prompt|aiinput|aioutput|requestbody|responsebody/i;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '');
}

function safeScalar(value: unknown): TelemetryScalar | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, MAX_SCALAR_LENGTH);
  return undefined;
}

/**
 * Recursively remove hostile key shapes. This is the first defense for Sentry's
 * nested event, span, and breadcrumb structures.
 */
export function stripHostileTelemetry(value: unknown, seen = new Set<object>()): unknown {
  const scalar = safeScalar(value);
  if (scalar !== undefined || value === null) return scalar;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map((item) => stripHostileTelemetry(item, seen))
        .filter((item) => item !== undefined);
    }
    const clean: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (HOSTILE_TELEMETRY_KEY_PATTERN.test(normalizeKey(key))) continue;
      const cleaned = stripHostileTelemetry(child, seen);
      if (cleaned !== undefined) clean[key] = cleaned;
    }
    return clean;
  } finally {
    seen.delete(value);
  }
}

/** Return only documented top-level scalar fields. Unknown/nested values are dropped. */
export function sanitizeTelemetryFields(input: unknown): TelemetryFields {
  const recursivelyCleaned = stripHostileTelemetry(input);
  if (!recursivelyCleaned || typeof recursivelyCleaned !== 'object' || Array.isArray(recursivelyCleaned)) {
    return {};
  }
  const output: TelemetryFields = {};
  for (const [key, value] of Object.entries(recursivelyCleaned)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const scalar = safeScalar(value);
    if (scalar !== undefined) output[key as TelemetryFieldKey] = scalar;
  }
  return output;
}

/** Never exposes unknown error messages, stacks, object properties, or toString output. */
export function classifyTelemetryError(error: unknown): TelemetryFields {
  if (!(error instanceof Error)) return { errorKind: 'UnknownFailure' };
  const errorKind = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : 'Error';
  const candidateCode = (error as NodeJS.ErrnoException).code;
  const errorCode =
    typeof candidateCode === 'string' && /^[A-Z0-9_-]{1,32}$/.test(candidateCode)
      ? candidateCode
      : undefined;
  return errorCode ? { errorKind, errorCode } : { errorKind };
}
