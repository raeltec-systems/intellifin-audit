import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/intellifin',
  SERVICE_NAME: 'web',
  SCHEMA_RANGE_MIN: '1',
  SCHEMA_RANGE_MAX: '1',
};

describe('loadConfig', () => {
  it('accepts a complete environment and coerces the schema range to numbers', () => {
    const config = loadConfig(validEnv);
    expect(config.SERVICE_NAME).toBe('web');
    expect(config.SCHEMA_RANGE_MIN).toBe(1);
    expect(config.SCHEMA_RANGE_MAX).toBe(1);
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

  it('rejects an inverted schema range', () => {
    expect(() =>
      loadConfig({ ...validEnv, SCHEMA_RANGE_MIN: '3', SCHEMA_RANGE_MAX: '2' }),
    ).toThrow(/SCHEMA_RANGE_MIN must be less than or equal to SCHEMA_RANGE_MAX/);
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
