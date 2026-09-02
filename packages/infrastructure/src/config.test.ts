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
