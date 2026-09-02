import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CORRELATION_HEADER, SAFE_ID_PATTERN, correlationIdFrom } from './correlation.js';

/**
 * `correlation.ts` re-declares the audit vocabulary's identifier pattern, because it
 * runs where importing the domain package for one regular expression is not worth it.
 * That duplication is only safe with a guard, which is what the first test is.
 */
describe('the identifier pattern', () => {
  it('matches the one packages/domain enforces on a correlationId', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../packages/domain/src/audit-event.ts', import.meta.url)),
      'utf8',
    );
    const match = /const SAFE_ID_PATTERN = (\/.*\/);/.exec(source);
    expect(match?.[1], 'SAFE_ID_PATTERN was not found in audit-event.ts').toBeDefined();
    expect(SAFE_ID_PATTERN.toString()).toBe(match?.[1]);
  });
});

const request = (value?: string) =>
  new Request('https://audit.example.com/api/procedures', {
    headers: value === undefined ? {} : { [CORRELATION_HEADER]: value },
  });

describe('correlationIdFrom', () => {
  it.each(['corr_abc-123', 'a', 'run:2437/step.4', 'A1'])(
    'keeps the well-formed header %s',
    (value) => {
      expect(correlationIdFrom(request(value))).toBe(value);
    },
  );

  it.each([
    'someone@example.com',
    '-leading-hyphen',
    '.leading-dot',
    'has space',
    'x'.repeat(256),
    '',
  ])('replaces the unusable header %s rather than sanitizing it', (value) => {
    // A header is attacker-controlled. A "cleaned" version of a hostile value is
    // still their value, so it is discarded outright.
    const id = correlationIdFrom(request(value));
    expect(id).not.toBe(value);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates one when no header is supplied', () => {
    expect(correlationIdFrom(request())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('always produces something the audit vocabulary accepts', () => {
    for (const value of ['ok-1', 'bad@value', undefined]) {
      expect(SAFE_ID_PATTERN.test(correlationIdFrom(request(value)))).toBe(true);
    }
  });
});
