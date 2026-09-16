import { describe, expect, it } from 'vitest';

import {
  STATIC_PINO_REDACTION_PATHS,
  createTelemetry,
} from './logger.js';
import {
  sanitizeTelemetryFields,
  stripHostileTelemetry,
} from './sanitize.js';
import { sanitizeSentryEvent, type SentrySink } from './sentry.js';

const hostile = {
  correlationId: 'corr-safe-001',
  password: 'hunter2',
  token: 'tok-secret',
  Evidence: { contents: 'evidence-secret' },
  nested: {
    safe: 'not-promoted',
    credential: 'credential-secret',
    deeper: { prompt: 'prompt-secret', signed_url: 'https://bad/?sig=secret' },
  },
  providerPayload: { response: 'provider-secret' },
  tool: { output: 'tool-secret' },
  snapshot: 'snapshot-secret',
  aiOutput: 'ai-secret',
  rawError: new Error('raw-error-secret'),
};

describe('telemetry sanitizer', () => {

  it('keeps workspace stage and closed database diagnostics without exposing the exception', () => {
    const chunks: string[] = [];
    const captures: unknown[] = [];
    const telemetry = createTelemetry({ serviceName: 'worker', destination: { write: (chunk: string) => chunks.push(chunk) }, sentrySink: { capture: (message, fields) => { captures.push({ message, fields }); } } });
    telemetry.captureError('Run stage failed', new Error('password-and-provider-secret'), { runId: '019823ab-0000-7000-8000-000000000001', stage: 'workspace', diagnostic: 'workspace-persistence-failed', errorCode: '23514' });
    for (const output of [chunks.join(''), JSON.stringify(captures)]) {
      expect(output).toContain('Run stage failed');
      expect(output).toContain('workspace-persistence-failed');
      expect(output).toContain('23514');
      expect(output).not.toContain('password-and-provider-secret');
    }
  });

  it('recursively removes hostile keys and keeps only documented top-level scalars', () => {
    const recursivelyCleaned = JSON.stringify(stripHostileTelemetry(hostile));
    expect(recursivelyCleaned).not.toMatch(/hunter2|tok-secret|evidence-secret|credential-secret/);
    expect(recursivelyCleaned).not.toMatch(/prompt-secret|provider-secret|tool-secret|snapshot-secret|ai-secret/);
    expect(sanitizeTelemetryFields(hostile)).toEqual({ correlationId: 'corr-safe-001' });
  });

  it('keeps the fields the pipeline entry points actually log', () => {
    /**
     * An undocumented key is dropped SILENTLY, which turns a summary line into a bare
     * message. The probe sweep shipped that way for one run: "Probe sweep complete" with
     * every count removed. The migrator's refusal had the same shape — "Refusing to
     * migrate" with the reason gone, which is the one thing that message exists to carry.
     */
    expect(
      sanitizeTelemetryFields({
        probed: 9,
        probeReachable: 7,
        probeUnreachable: 2,
        probeSkipped: 1,
        reason: 'DATABASE_URL is required',
      }),
    ).toEqual({
      probed: 9,
      probeReachable: 7,
      probeUnreachable: 2,
      probeSkipped: 1,
      reason: 'DATABASE_URL is required',
    });
  });

  it('keeps the four fields a Run-ended line carries', () => {
    // A dropped key is dropped SILENTLY, and these are the only record in the log stream
    // of why a Run ended (2026-09-16: two production Runs failed with the stream empty).
    expect(
      sanitizeTelemetryFields({
        runId: '019823ab-0000-7000-8000-000000000001',
        state: 'RUN_FAILED',
        stage: 'access',
        diagnostic: 'workspace-missing',
      }),
    ).toEqual({
      runId: '019823ab-0000-7000-8000-000000000001',
      state: 'RUN_FAILED',
      stage: 'access',
      diagnostic: 'workspace-missing',
    });
  });

  it('keeps the Agent Workspace guarantee fields, including a FALSE recording flag', () => {
    /**
     * `mode` and `recording` are the two facts that say what guarantee a deployment is
     * running under, and `recording` is the one that cannot be corrected: it is fixed at
     * `sessions.create()`, and a session recorded with a credential typed into it cannot
     * be un-recorded. Dropped here, the line would say Solari and be silent about that.
     *
     * The value under test is `false` deliberately, and not only for symmetry: `false` is
     * the SAFE state, so a sanitizer that filtered on truthiness rather than on the key
     * would keep `mode`, lose exactly this, and leave the stream unable to show the one
     * value an operator needs to confirm.
     */
    expect(sanitizeTelemetryFields({ mode: 'solari', reason: 'x', recording: false })).toEqual({
      mode: 'solari',
      reason: 'x',
      recording: false,
    });
    expect(sanitizeTelemetryFields({ mode: 'solari', recording: true })).toEqual({
      mode: 'solari',
      recording: true,
    });
  });

  it('writes only safe Pino fields and sends only safe fields to the Sentry sink', () => {
    const chunks: string[] = [];
    const captures: Array<{ message: string; fields: unknown }> = [];
    const sink: SentrySink = {
      capture(message, fields) {
        captures.push({ message, fields });
      },
    };
    const telemetry = createTelemetry({
      serviceName: 'worker',
      destination: { write: (chunk: string) => chunks.push(chunk) },
      sentrySink: sink,
    });

    telemetry.captureError(
      'Fatal worker error',
      new Error('raw-error-secret'),
      hostile,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('corr-safe-001');
    expect(chunks[0]).toContain('"errorKind":"Error"');
    expect(chunks[0]).not.toMatch(/raw-error-secret|hunter2|tok-secret|evidence-secret|prompt-secret/);
    expect(JSON.stringify(captures)).toContain('corr-safe-001');
    expect(JSON.stringify(captures)).not.toMatch(/raw-error-secret|hunter2|tok-secret|evidence-secret|prompt-secret/);
  });

  it('rebuilds a hostile Sentry envelope without PII, payloads, raw errors, or URLs', () => {
    const clean = sanitizeSentryEvent({
      message: 'raw-error-secret',
      request: { url: 'https://signed.invalid/?token=tok-secret' },
      user: { email: 'person@example.invalid' },
      tags: {
        correlationId: hostile.correlationId,
        password: hostile.password,
        token: hostile.token,
      },
      extra: hostile,
      breadcrumbs: [{ message: 'prompt-secret', data: hostile }],
      exception: { values: [{ type: 'Error', value: 'raw-error-secret' }] },
    });
    const envelope = JSON.stringify(clean);

    expect(envelope).toContain('corr-safe-001');
    expect(envelope).toContain('Captured failure');
    expect(envelope).not.toMatch(/raw-error-secret|person@example|signed\.invalid|tok-secret|hunter2/);
    expect(envelope).not.toMatch(/evidence-secret|prompt-secret|provider-secret|tool-secret/);
  });

  it('does not let a failed telemetry sink break product work', () => {
    const telemetry = createTelemetry({
      serviceName: 'web',
      destination: { write: () => undefined },
      sentrySink: { capture: () => { throw new Error('sink unavailable'); } },
    });
    expect(() => telemetry.captureError('Captured failure', new Error('product error'))).not.toThrow();
  });

  it('does not let a hostile field object break product work', () => {
    const chunks: string[] = [];
    const telemetry = createTelemetry({
      serviceName: 'worker',
      destination: { write: (chunk: string) => chunks.push(chunk) },
      sentrySink: { capture: () => undefined },
    });
    const hostileGetter = {
      correlationId: 'corr-safe-002',
      get sessionId(): string {
        throw new Error('getter-secret');
      },
    };

    expect(() =>
      telemetry.captureError('Fatal worker error', new Error('boom'), hostileGetter),
    ).not.toThrow();
    expect(chunks.join('')).not.toContain('getter-secret');
  });

  it('keeps static Pino redaction as defense in depth', () => {
    expect(STATIC_PINO_REDACTION_PATHS).toEqual(
      expect.arrayContaining(['password', 'token', 'credential', 'evidence', 'prompt']),
    );
  });
});
