import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AuditEventValidationError,
  ZERO_HASH,
  canonicalizeAuditEvent,
  createCanonicalAuditEvent,
  type AuditEventDraft,
  type CanonicalAuditEvent,
} from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  computeAuditEventHash,
} from '@intellifin/infrastructure';

interface GoldenFixture {
  genesisHash: string;
  events: Array<{
    canonical: CanonicalAuditEvent;
    canonicalText: string;
    previousHash: string;
    eventHash: string;
  }>;
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/audit-chain-golden.json', import.meta.url)),
    'utf8',
  ),
) as GoldenFixture;

const baseDraft: AuditEventDraft = {
  actor: { type: 'system', id: 'platform' },
  eventType: 'security.login',
  source: 'web',
  outcome: 'success',
  sessionId: 'session-0001',
  correlationId: 'corr-0001',
  payload: {},
};

describe('audit-event canonical contract', () => {
  it('matches independently produced RFC 8785 text and SHA-256 chain hashes', () => {
    expect(golden.genesisHash).toBe(ZERO_HASH);
    for (const vector of golden.events) {
      expect(canonicalizeAuditEvent(vector.canonical)).toBe(vector.canonicalText);
      expect(computeAuditEventHash(vector.previousHash, vector.canonical)).toBe(vector.eventHash);
    }
  });

  it('ignores the record hash columns, so a record hashes like its envelope', () => {
    for (const vector of golden.events) {
      const record = {
        ...vector.canonical,
        previousHash: vector.previousHash,
        eventHash: vector.eventHash,
      };
      expect(canonicalizeAuditEvent(record)).toBe(vector.canonicalText);
      expect(computeAuditEventHash(record.previousHash, record)).toBe(vector.eventHash);
    }
  });

  it('uses platform when a system event has no natural aggregate', () => {
    const event = createCanonicalAuditEvent(baseDraft, {
      eventId: '018f0000-0000-7000-8000-000000000001',
      occurredAt: '2026-09-02T12:34:56.789Z',
      sequence: 1,
    });
    expect(event.aggregateId).toBe('platform');
  });

  it('rejects missing attribution, correlation, unsupported event families, and invalid UUID versions', () => {
    expect(() =>
      createCanonicalAuditEvent({ ...baseDraft, correlationId: '' }, {
        eventId: '018f0000-0000-7000-8000-000000000001',
        occurredAt: '2026-09-02T12:34:56.789Z',
        sequence: 1,
      }),
    ).toThrow(AuditEventValidationError);
    expect(() =>
      createCanonicalAuditEvent({ ...baseDraft, eventType: 'unknown.action' as never }, {
        eventId: '018f0000-0000-7000-8000-000000000001',
        occurredAt: '2026-09-02T12:34:56.789Z',
        sequence: 1,
      }),
    ).toThrow(/eventType/);
    expect(() =>
      createCanonicalAuditEvent(baseDraft, {
        eventId: '018f0000-0000-4000-8000-000000000001',
        occurredAt: '2026-09-02T12:34:56.789Z',
        sequence: 1,
      }),
    ).toThrow(/UUIDv7/);
  });

  it.each(['password', 'api_token', 'Evidence', 'provider', 'providerPayload', 'tool', 'toolPayload', 'snapshot', 'signed_url', 'prompt', 'aiInput', 'ai_output'])(
    'rejects sensitive payload key %s at any nesting depth',
    (key) => {
      expect(() =>
        createCanonicalAuditEvent(
          { ...baseDraft, payload: { safe: { [key]: 'must-not-enter-event' } } },
          {
            eventId: '018f0000-0000-7000-8000-000000000001',
            occurredAt: '2026-09-02T12:34:56.789Z',
            sequence: 1,
          },
        ),
      ).toThrow(/sensitive payload keys/);
    },
  );

  it('rejects non-canonical JSON values', () => {
    expect(() =>
      createCanonicalAuditEvent(
        { ...baseDraft, payload: { value: Number.NaN } },
        {
          eventId: '018f0000-0000-7000-8000-000000000001',
          occurredAt: '2026-09-02T12:34:56.789Z',
          sequence: 1,
        },
      ),
    ).toThrow(/finite/);
  });
});

describe('UUIDv7 generator', () => {
  it('sets the UUID version and RFC variant bits', () => {
    expect(new CryptoUuidV7Generator().next()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
