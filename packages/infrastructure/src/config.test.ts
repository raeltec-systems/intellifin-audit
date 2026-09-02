import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/intellifin',
  SERVICE_NAME: 'web',
  SCHEMA_RANGE_MIN: '1',
  SCHEMA_RANGE_MAX: '2',
};

describe('loadConfig', () => {
  it('accepts a complete environment and coerces the schema range to numbers', () => {
    const config = loadConfig(validEnv);
    expect(config.SERVICE_NAME).toBe('web');
    expect(config.SCHEMA_RANGE_MIN).toBe(1);
    expect(config.SCHEMA_RANGE_MAX).toBe(2);
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

  it('rejects a non-numeric schema range bound', () => {
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MAX: 'latest' })).toThrow(ConfigError);
  });

  it('rejects an empty schema range bound instead of reading it as generation 0', () => {
    // z.coerce.number() would turn '' into 0 and start the process against a range
    // nobody wrote. An unset-but-present variable is a mistake, not a value.
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MIN: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MAX: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MIN: '   ' })).toThrow(ConfigError);
  });

  it('rejects generation 0 and negative or fractional bounds', () => {
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MIN: '0' })).toThrow(/at least 1/);
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MAX: '-1' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv, SCHEMA_RANGE_MAX: '1.5' })).toThrow(ConfigError);
  });

  it('rejects an inverted schema range', () => {
    expect(() =>
      loadConfig({ ...validEnv, SCHEMA_RANGE_MIN: '3', SCHEMA_RANGE_MAX: '2' }),
    ).toThrow(/SCHEMA_RANGE_MIN must be less than or equal to SCHEMA_RANGE_MAX/);
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
