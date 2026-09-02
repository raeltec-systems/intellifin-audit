import * as Sentry from '@sentry/node';
import type { Breadcrumb, Event, NodeOptions } from '@sentry/node';

import {
  sanitizeTelemetryFields,
  type TelemetryFields,
} from './sanitize.js';

export const TELEMETRY_MESSAGES = [
  'Startup checks passed',
  'Refusing to start',
  'Startup checks deferred',
  'Shutting down',
  'Heartbeat skipped',
  'Heartbeat upsert failed',
  'Heartbeat loop started',
  'Fatal worker error',
  'Captured failure',
  'Sign-in recorded',
  'Sign-in refused',
  // Distinct from a refusal on purpose. A refusal is a person getting their password
  // wrong; these three are availability incidents on the one public credential
  // endpoint, and an operator must be able to tell them apart in the log stream.
  'Sign-in audit failed',
  'Sign-in could not be attributed',
  'Sign-in session revoke failed',
  'Authorization denied',
  // The shell could not learn who is asking: the database is unreachable, the runtime
  // refused to start, or the identity provider threw. Every page then renders with no
  // role at all, so this must be visible in the log stream rather than inferred from a
  // screenshot of a nav bar with nothing in it.
  'Identity could not be resolved',
  // No credential reference has been declared to this deployment, so EVERY Target
  // System registration will be refused with "Audit credentials must be read-only." —
  // a sentence about the credential, given to somebody whose actual problem is an
  // unconfigured deployment. Said once at boot, where an operator can act on it.
  'No credential capabilities declared',
  // Administration mutations (Story 1.5). A refusal is not logged here — it is an audit
  // event, appended by `authorizeCommand` — so these two mean the command FAILED and
  // nothing was written; the person was told only that nothing changed.
  'Create user failed',
  'Set user role failed',
  // Target System registrations (Story 1.6). Same reading: a refusal — including the
  // read-only credential refusal — is an audit event, not a log line, so these two mean
  // the command FAILED and nothing was written.
  'Register Target System failed',
  'Change Target System failed',
  // Population Source bindings (Story 1.7). Same reading again: a refusal — an
  // undeclared sensitive field, a stale row — is an audit event or a returned sentence,
  // not a log line, so these two mean the command FAILED and nothing was written.
  'Register Population Source failed',
  'Change Population Source failed',
  // Sign-out. The failure matters as much as the success: it means the session is still
  // live because its event could not be appended, so the person is still signed in.
  'Sign-out recorded',
  'Sign-out failed',
] as const;
export type TelemetryMessage = (typeof TELEMETRY_MESSAGES)[number];

const SAFE_MESSAGES = new Set<string>(TELEMETRY_MESSAGES);

function safeMessage(message: unknown): TelemetryMessage {
  return typeof message === 'string' && SAFE_MESSAGES.has(message)
    ? (message as TelemetryMessage)
    : 'Captured failure';
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    type: breadcrumb.type,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    message: breadcrumb.message === undefined ? undefined : safeMessage(breadcrumb.message),
    data: sanitizeTelemetryFields(breadcrumb.data),
  };
}

/** Rebuild, rather than mutate, so no unknown nested Sentry field can bypass the allowlist. */
export function sanitizeSentryEvent<TEvent extends Event>(event: TEvent): TEvent {
  const exceptionType = event.exception?.values?.[0]?.type;
  const errorKind =
    typeof exceptionType === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(exceptionType)
      ? exceptionType
      : 'Error';
  const fields = {
    ...sanitizeTelemetryFields(event.tags),
    ...sanitizeTelemetryFields(event.extra),
  };
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    start_timestamp: event.start_timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    type: event.type,
    message: safeMessage(event.message),
    tags: fields,
    extra: fields,
    breadcrumbs: event.breadcrumbs?.map(sanitizeSentryBreadcrumb),
    exception: event.exception
      ? { values: [{ type: errorKind, value: 'Captured failure' }] }
      : undefined,
    spans: event.spans?.map(sanitizeSentrySpan),
  } as TEvent;
}

type SentrySpan = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0];

export function sanitizeSentrySpan(span: SentrySpan): SentrySpan {
  const fields = sanitizeTelemetryFields(span.data);
  const data = Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null),
  );
  return {
    data,
    parent_span_id: span.parent_span_id,
    span_id: span.span_id,
    start_timestamp: span.start_timestamp,
    status: span.status,
    timestamp: span.timestamp,
    trace_id: span.trace_id,
    exclusive_time: span.exclusive_time,
    is_segment: span.is_segment,
    segment_id: span.segment_id,
  };
}

export interface SentryTelemetryOptions {
  readonly dsn?: string;
  readonly environment: string;
  readonly serviceName: 'web' | 'worker';
  readonly tracesSampleRate: number;
}

export interface SentrySink {
  capture(message: TelemetryMessage, fields: TelemetryFields): void;
}

/** Optional Sentry sink with every implicit PII/AI/request-data path disabled. */
export function initializeSentry(options: SentryTelemetryOptions): SentrySink | undefined {
  if (!options.dsn) return undefined;
  Sentry.initWithoutDefaultIntegrations({
    dsn: options.dsn,
    environment: options.environment,
    serverName: options.serviceName,
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    tracesSampleRate: options.tracesSampleRate,
    beforeSend: (event) => sanitizeSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb),
    beforeSendSpan: (span) => sanitizeSentrySpan(span),
  });
  return {
    capture(message, fields) {
      Sentry.captureMessage(message, { level: 'error', tags: fields, extra: fields });
    },
  };
}
