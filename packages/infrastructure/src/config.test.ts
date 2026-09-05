import { describe, expect, it } from 'vitest';

import { ConfigError, credentialCapabilityManifest, evidenceS3Config, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/intellifin',
  SERVICE_NAME: 'web',
};

describe('model deployment policy', () => {
  it('lets web freeze model identity without possessing the worker API key', () => {
    expect(loadConfig({ ...validEnv, MODEL_PROVIDER: 'openai', MODEL_ID: 'synthetic-model' }).MODEL_API_KEY).toBeUndefined();
    expect(() => loadConfig({ ...validEnv, SERVICE_NAME: 'worker', MODEL_PROVIDER: 'openai', MODEL_ID: 'synthetic-model' })).toThrow(/MODEL_API_KEY/);
  });
  it('rejects unsupported prompt labels and invalid output budgets', () => {
    expect(() => loadConfig({ ...validEnv, MODEL_PROMPT_VERSION: 'arbitrary-version' })).toThrow(/MODEL_PROMPT_VERSION/);
    for (const budget of ['0', '1023', '262145', '1.5', 'NaN']) expect(() => loadConfig({ ...validEnv, MODEL_MAX_OUTPUT_TOKENS: budget })).toThrow(/MODEL_MAX_OUTPUT_TOKENS/);
    expect(loadConfig({ ...validEnv, MODEL_MAX_OUTPUT_TOKENS: '32768' }).MODEL_MAX_OUTPUT_TOKENS).toBe(32768);
  });
});

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

describe('CREDENTIAL_CAPABILITIES', () => {
  const base = {
    DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
    SERVICE_NAME: 'web',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
  } as const;

  it('is an empty manifest when absent, which refuses every registration', () => {
    const config = loadConfig({ ...base });
    expect(credentialCapabilityManifest(config).size).toBe(0);
  });

  it('reads a declared reference', () => {
    const config = loadConfig({
      ...base,
      CREDENTIAL_CAPABILITIES: '{"cred://a":"read-only","cred://b":"write-capable"}',
    });
    const manifest = credentialCapabilityManifest(config);
    expect(manifest.get('cred://a')).toBe('read-only');
    expect(manifest.get('cred://b')).toBe('write-capable');
  });

  it.each([
    ['not json', 'nonsense'],
    ['an array', '["cred://a"]'],
    ['a scalar', '"read-only"'],
    ['a capability outside the vocabulary', '{"cred://a":"admin"}'],
    ['a capability that is not a string', '{"cred://a":true}'],
    ['an empty reference', '{"   ":"read-only"}'],
    ['two keys that trim to one reference', '{"cred://a":"write-capable"," cred://a":"read-only"}'],
    ['two keys that trim to one reference, both read-only', '{"cred://a":"read-only","cred://a ":"read-only"}'],
  ])('refuses %s at boot rather than at the first registration', (_label, raw) => {
    expect(() => loadConfig({ ...base, CREDENTIAL_CAPABILITIES: raw })).toThrow(ConfigError);
  });

  it('never lets a later duplicate overwrite a write-capable declaration', () => {
    // The fail-OPEN direction, stated as its own case because it is the one that
    // matters. `{"prod":"write-capable"," prod":"read-only"}` used to yield
    // `prod -> read-only`: the later `set` silently replaced the write-capable verdict,
    // and registration input is trimmed too, so `prod` was then accepted as PROVEN
    // read-only. The two keys look different in the JSON, so nothing looked wrong.
    //
    // A deployment whose declaration is ambiguous has declared nothing, so the whole
    // manifest is refused and the process does not start.
    expect(() =>
      loadConfig({
        ...base,
        CREDENTIAL_CAPABILITIES: '{"prod":"write-capable"," prod":"read-only"}',
      }),
    ).toThrow(ConfigError);
  });

  it('names the offending key and never the value', () => {
    try {
      loadConfig({ ...base, CREDENTIAL_CAPABILITIES: '{"cred://a":"admin"}' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).keys).toContain('CREDENTIAL_CAPABILITIES');
      expect((error as ConfigError).message).not.toContain('cred://a');
    }
  });
});

describe('private Evidence S3 configuration', () => {
  const storage = {
    EVIDENCE_S3_ENDPOINT: 'https://objects.example.test',
    EVIDENCE_S3_REGION: 'us-east-1',
    EVIDENCE_S3_BUCKET: 'audit-evidence',
    EVIDENCE_S3_ACCESS_KEY_ID: 'synthetic-access-key',
    EVIDENCE_S3_SECRET_ACCESS_KEY: 'synthetic-secret-value',
  } as const;

  it('is absent until the production backend is configured', () => {
    expect(evidenceS3Config(loadConfig(validEnv))).toBeNull();
  });

  it('returns the complete private backend configuration without changing its values', () => {
    const config = loadConfig({ ...validEnv, ...storage, EVIDENCE_S3_FORCE_PATH_STYLE: 'false' });
    expect(evidenceS3Config(config)).toEqual({
      endpoint: storage.EVIDENCE_S3_ENDPOINT,
      region: storage.EVIDENCE_S3_REGION,
      bucket: storage.EVIDENCE_S3_BUCKET,
      accessKeyId: storage.EVIDENCE_S3_ACCESS_KEY_ID,
      secretAccessKey: storage.EVIDENCE_S3_SECRET_ACCESS_KEY,
      forcePathStyle: false,
    });
  });

  it('refuses partial backend configuration without echoing a secret', () => {
    try {
      loadConfig({ ...validEnv, EVIDENCE_S3_ENDPOINT: storage.EVIDENCE_S3_ENDPOINT, EVIDENCE_S3_SECRET_ACCESS_KEY: storage.EVIDENCE_S3_SECRET_ACCESS_KEY });
      expect.unreachable('expected partial Evidence S3 configuration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).toContain('EVIDENCE_S3_REGION');
      expect(String(error)).not.toContain(storage.EVIDENCE_S3_SECRET_ACCESS_KEY);
    }
  });
});
