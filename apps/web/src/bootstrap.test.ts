import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SUPPORTED_SCHEMA_MAX,
  SUPPORTED_SCHEMA_RANGE,
  UnsupportedSchemaError,
} from '@intellifin/infrastructure';

import { getRuntime, resetRuntimeForTests } from './bootstrap';

// `vi.mock` is hoisted above every import, so the doubles it closes over must be
// hoisted with it -- a plain `const` above would still be in its temporal dead zone.
const { loadConfig, createSqlClient } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  createSqlClient: vi.fn(),
}));

// Only the two edges that touch the outside world are faked. The AD-11 and AD-15
// asserts and the error classes stay real, so the test proves the actual guards.
vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return { ...actual, loadConfig, createSqlClient };
});

interface FakeSqlOptions {
  serverVersion?: string;
  schemaVersion?: number | null;
  failWith?: Error;
}

/** A postgres.js stand-in: a tagged template plus the `end()` bootstrap calls on failure. */
function fakeSql(options: FakeSqlOptions = {}) {
  const serverVersion = options.serverVersion ?? '18.6';
  const schemaVersion = options.schemaVersion === undefined ? 1 : options.schemaVersion;

  const sql = (strings: TemplateStringsArray): Promise<unknown[]> => {
    if (options.failWith) return Promise.reject(options.failWith);
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

  return Object.assign(sql, { end: vi.fn().mockResolvedValue(undefined) });
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    SERVICE_NAME: 'web',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    ...overrides,
  };
}

describe('web bootstrap', () => {
  beforeEach(() => {
    loadConfig.mockReset();
    createSqlClient.mockReset();
    resetRuntimeForTests();
  });

  it('resolves with the applied schema version when both guards pass', async () => {
    loadConfig.mockReturnValue(config());
    createSqlClient.mockReturnValue(fakeSql({ schemaVersion: SUPPORTED_SCHEMA_MAX }));

    const runtime = await getRuntime();

    expect(runtime.schemaVersion).toBe(SUPPORTED_SCHEMA_MAX);
    expect(runtime.postgresMajor).toBe(18);
    expect(runtime.supportedSchemaRange).toBe(SUPPORTED_SCHEMA_RANGE);
  });

  it('rejects with UnsupportedSchemaError and closes the connection when out of range', async () => {
    const sql = fakeSql({ schemaVersion: SUPPORTED_SCHEMA_MAX + 1 });
    loadConfig.mockReturnValue(config());
    createSqlClient.mockReturnValue(sql);

    await expect(getRuntime()).rejects.toBeInstanceOf(UnsupportedSchemaError);
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  it('caches a permanent refusal instead of reopening a connection per request', async () => {
    loadConfig.mockReturnValue(config());
    createSqlClient.mockReturnValue(fakeSql({ schemaVersion: SUPPORTED_SCHEMA_MAX + 1 }));

    await expect(getRuntime()).rejects.toBeInstanceOf(UnsupportedSchemaError);
    await expect(getRuntime()).rejects.toBeInstanceOf(UnsupportedSchemaError);
    expect(createSqlClient).toHaveBeenCalledTimes(1);
  });

  it('refuses at boot when the web process has no Better Auth secret', async () => {
    loadConfig.mockReturnValue(config({ BETTER_AUTH_SECRET: undefined }));
    createSqlClient.mockReturnValue(fakeSql());

    await expect(getRuntime()).rejects.toThrow(/BETTER_AUTH_SECRET/);
    expect(createSqlClient).not.toHaveBeenCalled();
  });

  it('refuses at boot when the web process has no Better Auth base URL', async () => {
    loadConfig.mockReturnValue(config({ BETTER_AUTH_URL: undefined }));
    createSqlClient.mockReturnValue(fakeSql());

    await expect(getRuntime()).rejects.toThrow(/BETTER_AUTH_URL/);
    expect(createSqlClient).not.toHaveBeenCalled();
  });

  it('refuses when SERVICE_NAME is not web', async () => {
    loadConfig.mockReturnValue(config({ SERVICE_NAME: 'worker' }));
    createSqlClient.mockReturnValue(fakeSql());

    await expect(getRuntime()).rejects.toThrow(/SERVICE_NAME/);
    expect(createSqlClient).not.toHaveBeenCalled();
  });

  it('does not cache a transient failure: the next call starts over and can succeed', async () => {
    loadConfig.mockReturnValue(config());
    createSqlClient
      .mockReturnValueOnce(fakeSql({ failWith: new Error('ECONNREFUSED 127.0.0.1:5432') }))
      .mockReturnValueOnce(fakeSql({ schemaVersion: 1 }));

    await expect(getRuntime()).rejects.toThrow(/ECONNREFUSED/);
    expect(createSqlClient).toHaveBeenCalledTimes(1);

    const runtime = await getRuntime();
    expect(runtime.schemaVersion).toBe(1);
    expect(createSqlClient).toHaveBeenCalledTimes(2);
  });
});
