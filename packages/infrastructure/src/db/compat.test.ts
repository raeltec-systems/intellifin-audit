import { describe, expect, it } from 'vitest';

import {
  REQUIRED_POSTGRES_MAJOR,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  assertPostgresMajorSupported,
  assertSchemaVersionInRange,
  parsePostgresMajor,
} from './compat.js';

describe('parsePostgresMajor', () => {
  it('reads the major from a full server_version string', () => {
    expect(parsePostgresMajor('18.6 (Debian 18.6-1.pgdg13+1)')).toBe(18);
  });

  it('refuses an unparseable server_version', () => {
    expect(() => parsePostgresMajor('unknown')).toThrow(UnsupportedDatabaseError);
  });
});

describe('assertPostgresMajorSupported', () => {
  it('accepts PostgreSQL 18', () => {
    expect(assertPostgresMajorSupported('18.6')).toBe(REQUIRED_POSTGRES_MAJOR);
  });

  it('refuses another major and names the found version', () => {
    expect(() => assertPostgresMajorSupported('17.4')).toThrow(/found 17/);
  });
});

describe('assertSchemaVersionInRange', () => {
  it('accepts a version inside the range', () => {
    expect(assertSchemaVersionInRange(1, 1, 1)).toBe(1);
  });

  it('refuses an unmigrated database', () => {
    expect(() => assertSchemaVersionInRange(null, 1, 1)).toThrow(UnsupportedSchemaError);
  });

  it('refuses a version above the range and names both the range and the version', () => {
    expect(() => assertSchemaVersionInRange(4, 1, 2)).toThrow(/found 4, this build supports 1..2/);
  });

  it('refuses a version below the range', () => {
    expect(() => assertSchemaVersionInRange(0, 1, 2)).toThrow(UnsupportedSchemaError);
  });
});
