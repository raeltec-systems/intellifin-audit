import { createTelemetry } from '@intellifin/infrastructure';

/**
 * The web process's single telemetry facade (AD-10).
 *
 * One instance, shared by `instrumentation.ts` (which configures its level and Sentry
 * once the runtime starts) and by every route handler through `WebRuntime.telemetry`.
 * A second instance would mean a second unconfigured logger writing at the default
 * level with no Sentry sink.
 */
export const telemetry = createTelemetry({ serviceName: 'web' });
