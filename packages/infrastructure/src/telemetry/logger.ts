import pino, { type DestinationStream } from 'pino';

import {
  classifyTelemetryError,
  sanitizeTelemetryFields,
  type TelemetryFields,
} from './sanitize.js';
import {
  initializeSentry,
  type SentrySink,
  type TelemetryMessage,
} from './sentry.js';

export const STATIC_PINO_REDACTION_PATHS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'credential',
  'evidence',
  'provider',
  'tool',
  'snapshot',
  'signedUrl',
  'prompt',
  'aiInput',
  'aiOutput',
  '*.password',
  '*.token',
  '*.credential',
  '*.evidence',
  '*.prompt',
  '*.*.password',
  '*.*.token',
] as const;

export type TelemetryLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Telemetry {
/**
 * `TelemetryFields`, never `unknown`.
 *
 * `sanitizeTelemetryFields` drops a key that is not in `TELEMETRY_FIELD_KEYS` SILENTLY —
 * which is the right runtime behaviour, because a field nobody documented must not reach
 * a log. But with `fields?: unknown` nothing stops the next caller writing one:
 * `telemetry.info('...', { workerGeneration: 7 })` typechecks, and the line is emitted
 * with the number gone. That has already happened twice — the probe sweep logged its
 * completion with every count removed, and the migrator's refusal lost the reason that
 * said why. The allowlist is the runtime guard; this is the compile-time one.
 */
  info(message: TelemetryMessage, fields?: TelemetryFields): void;
  warn(message: TelemetryMessage, fields?: TelemetryFields): void;
  error(message: TelemetryMessage, fields?: TelemetryFields): void;
  captureError(message: TelemetryMessage, error: unknown, fields?: TelemetryFields): void;
  configureLevel(level: TelemetryLogLevel): void;
  configureSentry(options: {
    readonly dsn?: string;
    readonly environment: string;
    readonly tracesSampleRate: number;
  }): void;
}

export interface TelemetryOptions {
  readonly serviceName: 'web' | 'worker';
  readonly level?: TelemetryLogLevel;
  readonly sentryDsn?: string;
  readonly sentryEnvironment?: string;
  readonly sentryTracesSampleRate?: number;
  /** Test seam; production uses Pino's stdout destination. */
  readonly destination?: DestinationStream;
  /** Test seam; production initializes the optional Sentry SDK. */
  readonly sentrySink?: SentrySink;
}

/** One sink-safe telemetry facade shared by web and worker composition roots. */
export function createTelemetry(options: TelemetryOptions): Telemetry {
  const destination =
    options.destination ??
    pino.multistream(
      [
        { level: 'trace', stream: { write: (message) => process.stdout.write(message) } },
        { level: 'error', stream: { write: (message) => process.stderr.write(message) } },
      ],
      { dedupe: true },
    );
  const logger = pino(
    {
      level: options.level ?? 'info',
      messageKey: 'message',
      base: { service: options.serviceName },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...STATIC_PINO_REDACTION_PATHS], remove: true },
    },
    destination,
  );
  let sentry =
    options.sentrySink ??
    initializeSentry({
      dsn: options.sentryDsn,
      environment: options.sentryEnvironment ?? 'development',
      serviceName: options.serviceName,
      tracesSampleRate: options.sentryTracesSampleRate ?? 0,
    });

  const write = (level: 'info' | 'warn' | 'error', message: TelemetryMessage, fields: unknown) => {
    try {
      logger[level](sanitizeTelemetryFields(fields), message);
    } catch {
      // Operational telemetry must never break product work.
    }
  };

  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    captureError(message, error, fields) {
      // A hostile object can throw from a property getter while it is read. That is
      // still only telemetry, so it must not escape into the product code path.
      let safeFields: TelemetryFields;
      try {
        safeFields = { ...sanitizeTelemetryFields(fields), ...classifyTelemetryError(error) };
      } catch {
        safeFields = { errorKind: 'UnknownFailure' };
      }
      write('error', message, safeFields);
      try {
        sentry?.capture(message, safeFields);
      } catch {
        // A failed remote sink cannot change the product transaction outcome.
      }
    },
    configureLevel(level) {
      logger.level = level;
    },
    configureSentry(sentryOptions) {
      if (sentry) return;
      try {
        sentry = initializeSentry({
          dsn: sentryOptions.dsn,
          environment: sentryOptions.environment,
          serviceName: options.serviceName,
          tracesSampleRate: sentryOptions.tracesSampleRate,
        });
      } catch {
        // Invalid/unavailable observability must not stop the product process.
      }
    },
  };
}
