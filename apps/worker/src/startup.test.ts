import { describe, expect, it } from 'vitest';

import {
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  type AppConfig,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { createHeartbeatLoop, runStartupChecks, type LogLevel } from './startup.js';

interface LogLine {
  level: LogLevel;
  message: string;
  extra: Record<string, unknown>;
}

function captureLog() {
  const lines: LogLine[] = [];
  const log = (level: LogLevel, message: string, extra: Record<string, unknown> = {}) => {
    lines.push({ level, message, extra });
  };
  return { lines, log };
}

function config(min: number, max: number): AppConfig {
  return {
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    SERVICE_NAME: 'worker',
    SCHEMA_RANGE_MIN: min,
    SCHEMA_RANGE_MAX: max,
  };
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
    const result = await runStartupChecks(config(1, 1), fakeSql({ schemaVersion: 1 }), log);

    expect(result).toEqual({ postgresMajor: 18, schemaVersion: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.message).toBe('Startup checks passed');
  });

  it('throws UnsupportedSchemaError and logs the range and the found version', async () => {
    const { lines, log } = captureLog();

    await expect(
      runStartupChecks(config(7, 9), fakeSql({ schemaVersion: 1 }), log),
    ).rejects.toBeInstanceOf(UnsupportedSchemaError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal).toBeDefined();
    expect(refusal?.level).toBe('error');
    expect(refusal?.extra['supportedSchemaRange']).toBe('7..9');
    expect(refusal?.extra['foundSchemaVersion']).toBe(1);
    expect(String(refusal?.extra['reason'])).toContain('found 1, this build supports 7..9');
  });

  it('throws UnsupportedSchemaError with a null found version on an unmigrated database', async () => {
    const { lines, log } = captureLog();

    await expect(
      runStartupChecks(config(1, 1), fakeSql({ schemaVersion: null }), log),
    ).rejects.toBeInstanceOf(UnsupportedSchemaError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal?.extra['foundSchemaVersion']).toBeNull();
    expect(refusal?.extra['supportedSchemaRange']).toBe('1..1');
  });

  it('throws UnsupportedDatabaseError and logs the range when the major is wrong', async () => {
    const { lines, log } = captureLog();

    await expect(
      runStartupChecks(config(1, 1), fakeSql({ serverVersion: '17.4' }), log),
    ).rejects.toBeInstanceOf(UnsupportedDatabaseError);

    const refusal = lines.find((line) => line.message === 'Refusing to start');
    expect(refusal?.extra['supportedSchemaRange']).toBe('1..1');
    expect(String(refusal?.extra['reason'])).toContain('found 17');
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
    expect(String(failure?.extra['reason'])).toContain('connection reset');

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
    expect(lines.some((line) => line.message.startsWith('Heartbeat skipped'))).toBe(true);

    release?.();
    await first;

    await loop.beat();
    expect(calls()).toBe(2);
  });
});
