import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/intellifin',
  SERVICE_NAME: 'web',
};

describe('loadConfig', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig(validEnv);
    expect(config.SERVICE_NAME).toBe('web');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SENTRY_DSN).toBeUndefined();
    expect(config.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
  });

  it('accepts the postgresql:// scheme', () => {
    const config = loadConfig({ ...validEnv, DATABASE_URL: 'postgresql://u:p@h:5432/d' });
    expect(config.DATABASE_URL).toContain('postgresql://');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: undefined })).toThrow(ConfigError);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://u:p@h/d' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unknown SERVICE_NAME', () => {
    expect(() => loadConfig({ ...validEnv, SERVICE_NAME: 'scheduler' })).toThrow(ConfigError);
  });

  it('ignores a stale SCHEMA_RANGE_MIN/MAX left in the environment', () => {
    // The supported range is a property of the build (SUPPORTED_SCHEMA_MIN/MAX).
    // A deployment that still carries the old variables must not be able to move it.
    const config = loadConfig({
      ...validEnv,
      SCHEMA_RANGE_MIN: '1',
      SCHEMA_RANGE_MAX: '1',
    });
    expect(config).not.toHaveProperty('SCHEMA_RANGE_MIN');
    expect(config).not.toHaveProperty('SCHEMA_RANGE_MAX');
  });

  it('validates optional telemetry configuration', () => {
    expect(
      loadConfig({
        ...validEnv,
        LOG_LEVEL: 'debug',
        SENTRY_DSN: 'https://public@example.invalid/1',
        SENTRY_ENVIRONMENT: 'test',
        SENTRY_TRACES_SAMPLE_RATE: '0.25',
      }),
    ).toMatchObject({ LOG_LEVEL: 'debug', SENTRY_TRACES_SAMPLE_RATE: 0.25 });
    expect(() => loadConfig({ ...validEnv, SENTRY_TRACES_SAMPLE_RATE: '1.1' })).toThrow(
      /SENTRY_TRACES_SAMPLE_RATE/,
    );
  });

  it('never puts the DATABASE_URL value into the error message', () => {
    const secret = 'postgres://user:sup3rsecret@db/app';
    try {
      loadConfig({ ...validEnv, DATABASE_URL: secret, SERVICE_NAME: 'nope' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain('sup3rsecret');
    }
  });
});

/**
 * The two identity keys. They are optional in the shared schema — the worker has no
 * identity surface — but a value that IS supplied has to be usable, and in production
 * it has to be safe.
 */
describe('loadConfig and the Better Auth keys', () => {
  const secret = 'x'.repeat(32);

  it('accepts a well-formed secret and https origin', () => {
    const config = loadConfig({
      ...validEnv,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://audit.example.com',
    });
    expect(config.BETTER_AUTH_SECRET).toBe(secret);
    expect(config.BETTER_AUTH_URL).toBe('https://audit.example.com');
  });

  it('rejects a secret shorter than 32 characters, naming the key', () => {
    expect(() =>
      loadConfig({ ...validEnv, BETTER_AUTH_SECRET: 'x'.repeat(31) }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig({ ...validEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(ConfigError);
  });

  it('never echoes the secret in the error it throws', () => {
    const secretish = 'super-secret-value-nobody-should-see-here';
    try {
      loadConfig({ ...validEnv, BETTER_AUTH_URL: 'ftp://x', BETTER_AUTH_SECRET: secretish });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretish);
    }
  });

  it.each(['audit.example.com', 'ftp://audit.example.com', '//audit.example.com', 'ws://x'])(
    'rejects the base URL %s, which is not http(s)',
    (value) => {
      expect(() => loadConfig({ ...validEnv, BETTER_AUTH_URL: value })).toThrow(
        /BETTER_AUTH_URL/,
      );
    },
  );

  it('allows http in development, where there is no transport to protect', () => {
    const config = loadConfig({
      ...validEnv,
      BETTER_AUTH_URL: 'http://localhost:3000',
      NODE_ENV: 'development',
    });
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:3000');
  });

  it('rejects http in production, because the session cookie would not be Secure', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://audit.example.com',
        NODE_ENV: 'production',
      }),
    ).toThrow(/BETTER_AUTH_URL.*https/s);
  });

  it('accepts https in production', () => {
    const config = loadConfig({
      ...validEnv,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://audit.example.com',
      NODE_ENV: 'production',
    });
    expect(config.BETTER_AUTH_URL).toBe('https://audit.example.com');
  });

  it('treats an empty string as absent, so the worker starts without either key', () => {
    const config = loadConfig({
      ...validEnv,
      SERVICE_NAME: 'worker',
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_URL: '',
    });
    expect(config.SERVICE_NAME).toBe('worker');
    expect(config.BETTER_AUTH_SECRET).toBeUndefined();
    expect(config.BETTER_AUTH_URL).toBeUndefined();
  });

  it('lets the worker start with neither key set at all', () => {
    const config = loadConfig({ ...validEnv, SERVICE_NAME: 'worker' });
    expect(config.BETTER_AUTH_SECRET).toBeUndefined();
    expect(config.BETTER_AUTH_URL).toBeUndefined();
  });
});

describe('ConfigError.keys', () => {
  it('names every failing variable, once, without any value', () => {
    const error = new ConfigError([
      'BETTER_AUTH_SECRET: is required for the web process',
      'BETTER_AUTH_URL: is required for the web process',
      'BETTER_AUTH_SECRET: must be at least 32 characters',
    ]);

    expect(error.keys).toBe('BETTER_AUTH_SECRET,BETTER_AUTH_URL');
  });

  it('never carries a value, even when one appears in the issue text', () => {
    // The issues are ours to write, but a future one could interpolate a value.
    // Only the text before the first colon is ever exposed.
    const error = new ConfigError(['DATABASE_URL: rejected postgres://u:hunter2@h/d']);

    expect(error.keys).toBe('DATABASE_URL');
    expect(error.keys).not.toContain('hunter2');
  });

  it('is empty rather than malformed when an issue names nothing', () => {
    expect(new ConfigError(['']).keys).toBe('');
  });
});
