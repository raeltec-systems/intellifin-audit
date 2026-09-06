import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_SCHEMA_MAX,
  SUPPORTED_SCHEMA_RANGE,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { adapterExtraction, createHeartbeatLoop, populationExecution, runStartupChecks, type Logger } from './startup.js';
import { readFileSync } from 'node:fs';
import type { AppConfig } from '@intellifin/infrastructure';

interface LogLine {
  level: 'info' | 'error';
  message: string;
  extra: Record<string, unknown>;
}

function captureLog() {
  const lines: LogLine[] = [];
  const log: Logger = {
    info(message, extra = {}) {
      lines.push({ level: 'info', message, extra: extra as Record<string, unknown> });
    },
    error(message, extra = {}) {
      lines.push({ level: 'error', message, extra: extra as Record<string, unknown> });
    },
    captureError(message, error, extra = {}) {
      lines.push({
        level: 'error',
        message,
        extra: {
          ...(extra as Record<string, unknown>),
          errorKind: error instanceof Error ? error.name : 'UnknownFailure',
        },
      });
    },
  };
  return { lines, log };
}

/**
 * A stand-in for postgres.js: a tagged-template function that answers the three
 * queries the startup guards issue, so the guards run for real with no database.
 */
function fakeSql(options: { serverVersion?: string; schemaVersion?: number | null }): Sql {
  const serverVersion = options.serverVersion ?? '18.6 (Debian 18.6-1.pgdg13+2)';
  const schemaVersion = options.schemaVersion === undefined ? 1 : options.schemaVersion;

  const sql = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join(' ');
    if (text.includes('server_version')) {
      return Promise.resolve([{ server_version: serverVersion }]);
    }
    if (text.includes('to_regclass')) {
      return Promise.resolve([{ exists: schemaVersion !== null }]);
    }
    if (text.includes('max(version)')) {
      return Promise.resolve([{ version: schemaVersion }]);
    }
    return Promise.resolve([]);
  };

  return sql as unknown as Sql;
}

describe('runStartupChecks', () => {
  it('passes and logs the versions when PostgreSQL 18 has an in-range schema', async () => {
    const { lines, log } = captureLog();
    const result = await runStartupChecks(
      fakeSql({ schemaVersion: SUPPORTED_SCHEMA_MAX }),
      log,
    );

    expect(result).toEqual({ postgresMajor: 18, schemaVersion: SUPPORTED_SCHEMA_MAX });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.message).toBe('Startup checks passed');
  });

  it('throws UnsupportedSchemaError and logs the range and the found version', async () => {
    const { lines, log } = captureLog();
    const ahead = SUPPORTED_SCHEMA_MAX + 1;

    await expect(
      runStartupChecks(fakeSql({ schemaVersion: ahead }), log),
    ).rejects.toBeInstanceOf(UnsupportedSchemaError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal).toBeDefined();
    expect(refusal?.level).toBe('error');
    expect(refusal?.extra['supportedSchemaRange']).toBe(SUPPORTED_SCHEMA_RANGE);
    expect(refusal?.extra['foundSchemaVersion']).toBe(ahead);
    expect(refusal?.extra['errorKind']).toBe('UnsupportedSchemaError');
  });

  it('throws UnsupportedSchemaError with a null found version on an unmigrated database', async () => {
    const { lines, log } = captureLog();

    await expect(
      runStartupChecks(fakeSql({ schemaVersion: null }), log),
    ).rejects.toBeInstanceOf(UnsupportedSchemaError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal?.extra['foundSchemaVersion']).toBeNull();
    expect(refusal?.extra['supportedSchemaRange']).toBe(SUPPORTED_SCHEMA_RANGE);
  });

  it('throws UnsupportedDatabaseError and logs the range when the major is wrong', async () => {
    const { lines, log } = captureLog();

    await expect(
      runStartupChecks(fakeSql({ serverVersion: '17.4' }), log),
    ).rejects.toBeInstanceOf(UnsupportedDatabaseError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal?.extra['supportedSchemaRange']).toBe(SUPPORTED_SCHEMA_RANGE);
    expect(refusal?.extra['errorKind']).toBe('UnsupportedDatabaseError');
  });
});

/** A drizzle stand-in whose upsert resolves or rejects on demand. */
function fakeDb(behaviour: () => Promise<void>): { db: Database; calls: () => number } {
  let calls = 0;
  const db = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => {
          calls += 1;
          return behaviour();
        },
      }),
    }),
  };
  return { db: db as unknown as Database, calls: () => calls };
}

describe('createHeartbeatLoop', () => {
  it('upserts once per beat', async () => {
    const { lines, log } = captureLog();
    const { db, calls } = fakeDb(() => Promise.resolve());
    const loop = createHeartbeatLoop(db, 'host-a', log);

    await loop.beat();
    await loop.beat();

    expect(calls()).toBe(2);
    expect(lines).toHaveLength(0);
  });

  it('logs a failed upsert and keeps beating', async () => {
    const { lines, log } = captureLog();
    let shouldFail = true;
    const { db, calls } = fakeDb(() =>
      shouldFail ? Promise.reject(new Error('connection reset')) : Promise.resolve(),
    );
    const loop = createHeartbeatLoop(db, 'host-a', log);

    await expect(loop.beat()).resolves.toBeUndefined();
    const failure = lines.find((line) => line.message === 'Heartbeat upsert failed');
    expect(failure?.level).toBe('error');
    expect(failure?.extra['errorKind']).toBe('Error');

    shouldFail = false;
    await loop.beat();
    expect(calls()).toBe(2);
  });

  it('skips a tick rather than overlapping a beat that is still in flight', async () => {
    const { lines, log } = captureLog();
    let release: (() => void) | undefined;
    let blocking = true;
    const { db, calls } = fakeDb(() => {
      // Only the first beat hangs. Later beats resolve, so the test can prove the
      // loop recovers once the slow one finishes.
      if (!blocking) return Promise.resolve();
      return new Promise<void>((resolve) => {
        release = () => {
          blocking = false;
          resolve();
        };
      });
    });
    const loop = createHeartbeatLoop(db, 'host-a', log);

    const first = loop.beat();
    await loop.beat();

    expect(loop.skippedBeats()).toBe(1);
    expect(calls()).toBe(1);
    expect(lines.some((line) => line.message === 'Heartbeat skipped')).toBe(true);

    release?.();
    await first;

    await loop.beat();
    expect(calls()).toBe(2);
  });
});

describe('population execution', () => {
  const storage = {
    EVIDENCE_S3_ENDPOINT: 'https://objects.example.test',
    EVIDENCE_S3_REGION: 'auto',
    EVIDENCE_S3_BUCKET: 'evidence',
    EVIDENCE_S3_ACCESS_KEY_ID: 'key',
    EVIDENCE_S3_SECRET_ACCESS_KEY: 'secret',
    EVIDENCE_S3_FORCE_PATH_STYLE: true,
  } as unknown as AppConfig;

  it('is disabled, with a named reason, when no object storage is configured', () => {
    expect(populationExecution({} as AppConfig)).toEqual({
      enabled: false,
      reason: 'EVIDENCE_S3_ENDPOINT is not configured',
    });
  });

  it('is enabled with the deployment settings when storage is configured', () => {
    const decision = populationExecution(storage);
    expect(decision.enabled).toBe(true);
    if (!decision.enabled) throw new Error('unreachable');
    expect(decision.config).toMatchObject({ endpoint: 'https://objects.example.test', bucket: 'evidence' });
  });

  it('never lets missing storage stop the rest of the worker', () => {
    // The composition root runs this check after plan derivation and recovery have
    // started and before the heartbeat. A throw there would take derivation,
    // notification delivery and the liveness row down with it, on a deployment whose
    // bucket is simply not provisioned yet. The behaviour above is only half the
    // guarantee: this asserts the composition root actually branches on it.
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('const evidence = populationExecution(config);');
    expect(main).toContain('if (evidence.enabled) {');
    expect(main).toMatch(/Population execution disabled/);
    // No unconditional refusal on the storage settings.
    expect(main).not.toMatch(/throw new ConfigError\(\[[^\]]*EVIDENCE_S3/);
    // The worker still beats: the heartbeat wiring is outside the branch.
    expect(main).toContain('createHeartbeatLoop(db, host, telemetry)');
  });

  it('gives the post-Run Evidence integrity check a production caller', () => {
    // `verifySealedPackage` shipped with tests and NOTHING in the product calling it, so
    // an object deleted or altered after a Run terminated was never detected — while the
    // Run page went on printing "Sealed. Every artifact this Run required is registered and
    // verified" in the present tense about storage nothing re-checked. The sweep's own
    // behaviour is proved in `evidence-integrity-sweep.test.ts`; what is proved here is
    // that the composition root starts it, and stops it.
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('startEvidenceIntegritySweep(');
    expect(main).toContain('verifySealedPackage({ repository: sealed, store, clock, ids }, runId)');
    // Inside the storage branch: it reads every registered artifact out of object storage,
    // so a deployment with no bucket has nothing for it to read.
    const storageBranch = main.slice(main.indexOf('if (evidence.enabled) {'), main.indexOf('} else {'));
    expect(storageBranch).toContain('startEvidenceIntegritySweep(');
    // And stopped on shutdown, so a SIGTERM does not kill an in-flight verification.
    expect(main).toContain('await stopIntegritySweep?.();');
  });
});

describe('adapterExtraction', () => {
  it('is disabled, with a named reason, when no audit credential is declared', () => {
    // An empty manifest is not "extraction with no credentials": every Work Item would
    // fail closed with `credential-unresolved`, which reads as a Target System problem
    // and is not one. Say so once, at boot, where an operator can act on it.
    expect(adapterExtraction({ CREDENTIAL_TOKENS: '{}' } as unknown as AppConfig)).toEqual({
      enabled: false,
      reason: 'CREDENTIAL_TOKENS declares no audit credential',
    });
  });

  it('is disabled, with a named reason, when no Exception fingerprint key is configured', () => {
    // Extraction registers Observations, registration evaluates them, and an EXCEPTION
    // evaluation writes a PERMANENT row that must carry a keyed fingerprint. Without a key
    // there is no honest fingerprint, so the stage is off rather than the row being
    // written with a value nobody can later check.
    expect(
      adapterExtraction({
        CREDENTIAL_TOKENS: '{"cred://a":"token"}',
        EXCEPTION_FINGERPRINT_KEY_ID: 'k1',
      } as unknown as AppConfig),
    ).toEqual({ enabled: false, reason: 'EXCEPTION_FINGERPRINT_KEY is not configured' });
  });

  it('is enabled with the declared manifest and a fingerprint key', () => {
    const decision = adapterExtraction({
      CREDENTIAL_TOKENS: '{"cred://a":"token"}',
      EXCEPTION_FINGERPRINT_KEY: 'exception-fingerprint-key-at-least-32',
      EXCEPTION_FINGERPRINT_KEY_ID: 'k1',
    } as unknown as AppConfig);
    expect(decision.enabled).toBe(true);
    if (!decision.enabled) throw new Error('unreachable');
    expect(decision.credentials.get('cred://a')).toBe('token');
    expect(decision.exceptions.keyId).toBe('k1');
    // The key has nowhere to live: the port carries the id and a function, and nothing
    // else, so no checkpoint, payload, log line or error message can pick the value up.
    expect(JSON.stringify(decision.exceptions)).toBe('{"keyId":"k1"}');
  });

  it('never lets a missing manifest stop the rest of the worker', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('const credentials = adapterExtraction(config);');
    expect(main).toMatch(/Adapter extraction disabled/);
    // Composed only where it is used, and never unconditionally refused.
    expect(main).toContain('new ManifestCredentialResolver(credentials.credentials)');
    expect(main).toContain('exceptions:credentials.exceptions');
    expect(main).not.toMatch(/throw new ConfigError\(\[[^\]]*CREDENTIAL_TOKENS/);
    expect(main).toContain('createHeartbeatLoop(db, host, telemetry)');
  });
});

/**
 * A capability disabled by name must also stop the work that depends on it.
 *
 * The PR 23 repair was right to let the worker start without object storage, and it opened
 * this: with the whole Run block inside `if (evidence.enabled)`, NO consumer was registered
 * for the `runs` queue while the web's Initiate Run action stayed enabled and went on
 * enqueueing, so every Run sat QUEUED for ever with no worker, no diagnostic and no Result.
 * One stage along it was worse: with storage configured but no credential manifest, the
 * handler acknowledged the job after acquisition, leaving the Run RUNNING at
 * POPULATION_READY with its Evidence frozen and neither sweep able to select it again.
 *
 * The BEHAVIOUR is proved in `stop-unexecutable-run.test.ts` and against PostgreSQL. What is
 * proved here is that the composition root actually branches that way — a regression would
 * be a wiring change, and behaviour alone would not catch a consumer quietly moved back
 * inside the branch.
 */
describe('a Run this deployment cannot execute', () => {
  const main = (): string => readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('consumes the runs queue even when population execution is off', () => {
    const source = main();
    const disabled = source.slice(source.indexOf('} else {'));
    expect(disabled).toContain('startPopulationWorker(queue,');
    expect(disabled).toContain("stopUnexecutableRun(stoppable, job, 'evidence-store-unconfigured')");
    // And it still says so once, by name, where an operator can act on it.
    expect(source).toMatch(/Population execution disabled/);
  });

  it('stops a Run instead of acknowledging a job it cannot finish, when extraction is off', () => {
    const source = main();
    // The old line was `if (acquired.retry || adapter === null) return acquired;` — the
    // second half of which acknowledged the job and stranded the Run.
    expect(source).not.toMatch(/adapter === null\) return acquired/);
    expect(source).toContain("if (adapter === null) return stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured');");
  });

  it('sweeps for Runs an earlier claim left at POPULATION_READY, whether or not extraction is on', () => {
    // The population sweep stops selecting a Run once its population is ready, so a Run
    // left mid-flight by a process that has since restarted is found by this read alone.
    const source = main();
    const recovery = source.slice(source.indexOf('const recover = adapter === null'));
    expect(recovery).toContain("stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured')");
    expect(recovery).toContain('executeAdapterSteps(adapter, job)');
    expect(recovery).toContain('startPopulationRecovery(db,adapterRepository,recover,');
  });
});
