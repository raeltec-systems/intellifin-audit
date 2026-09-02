import { describe, expect, it } from 'vitest';

import {
  MUTATING_VERBS,
  PERMITTED_READ_ACTIONS,
  TARGET_SYSTEM_KINDS,
  isPermittedReadAction,
  isTargetSystemKind,
  registrationCanonicalText,
  registrationDigest,
  registrationDigestEnvelope,
  type PermittedReadAction,
  type RegistrationDigestInput,
} from './target-system.js';

/**
 * The AD-2 digest contract: the six keys, the set semantics, and the read-only
 * vocabulary.
 *
 * The comparison against independently produced vectors is `tests/unit/
 * registration-digest.test.ts` — this package has no `@types/node` and cannot read a
 * fixture off disk, exactly as `packages/domain` cannot read `process.env`.
 */

/** The exact six keys AD-2 names, in the order canonical JSON puts them. */
const SIX_KEYS = [
  'allowed_origins',
  'attribute_label_patterns',
  'credential_ref',
  'kind',
  'permitted_actions',
  'secondary_key',
];

const BASE: RegistrationDigestInput = {
  kind: 'web',
  allowedOrigins: ['https://northstar.synthetic.invalid'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/northstar-readonly',
  permittedActions: ['navigate', 'read-attribute'],
  attributeLabelPatterns: ['Invoice *'],
  secondaryKey: '',
};

describe('the registration digest envelope', () => {
  it('gives every kind the same six keys, whether or not a value is empty', () => {
    for (const kind of TARGET_SYSTEM_KINDS) {
      const envelope = registrationDigestEnvelope({
        ...BASE,
        kind,
        allowedOrigins: [],
        applicationIdentity: '',
        attributeLabelPatterns: [],
        permittedActions: [],
        secondaryKey: '',
      });
      expect(Object.keys(envelope).sort()).toEqual(SIX_KEYS);
      expect(envelope.secondary_key).toBeNull();
    }
  });

  it('puts a desktop application identity in the origins slot', () => {
    const envelope = registrationDigestEnvelope({
      ...BASE,
      kind: 'desktop',
      allowedOrigins: ['https://ignored.synthetic.invalid'],
      applicationIdentity: 'com.synthetic.northstar.ledger',
    });
    expect(envelope.allowed_origins).toEqual(['com.synthetic.northstar.ledger']);
    expect(Object.keys(envelope).sort()).toEqual(SIX_KEYS);
  });

  it('carries no key the six do not name, however the input grows', () => {
    // A registration also has an id, a display name, a note and timestamps. A spread
    // would put every one of them in the hash and move a digest that must not move.
    const envelope = registrationDigestEnvelope({
      ...BASE,
      displayName: 'Northstar',
      note: 'a note',
      id: '018f0000-0000-7000-8000-000000000001',
    } as RegistrationDigestInput & Record<string, unknown>);
    expect(Object.keys(envelope).sort()).toEqual(SIX_KEYS);
    expect(registrationDigest(BASE)).toBe(
      registrationDigest({ ...BASE, displayName: 'Something else' } as RegistrationDigestInput),
    );
  });

  it('treats origins, patterns and actions as sets, not as lists', () => {
    const digest = registrationDigest(BASE);
    expect(
      registrationDigest({
        ...BASE,
        allowedOrigins: [
          '  https://northstar.synthetic.invalid  ',
          'https://northstar.synthetic.invalid',
          '',
        ],
        permittedActions: ['read-attribute', 'navigate', 'navigate'],
      }),
    ).toBe(digest);
  });

  it('moves when any one of the six changes', () => {
    const base = registrationDigest(BASE);
    const variants: readonly RegistrationDigestInput[] = [
      { ...BASE, kind: 'api' },
      { ...BASE, allowedOrigins: ['https://other.synthetic.invalid'] },
      { ...BASE, credentialRef: 'cred://synthetic/other' },
      { ...BASE, permittedActions: ['navigate'] },
      { ...BASE, attributeLabelPatterns: ['Something else'] },
      { ...BASE, secondaryKey: 'branch-042' },
    ];
    for (const variant of variants) {
      expect(registrationDigest(variant)).not.toBe(base);
    }
    expect(new Set(variants.map(registrationDigest)).size).toBe(variants.length);
  });

  it('is 64 lower-case hex characters', () => {
    expect(registrationDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the permitted-action vocabulary', () => {
  it('rejects a write action at the type level, not only at runtime', () => {
    // @ts-expect-error a write action is not a PermittedReadAction, so a registration
    // that permits one does not compile. This assertion IS the test: remove the union
    // and the `@ts-expect-error` becomes an unused-directive error.
    const writeAction: PermittedReadAction = 'create-record';
    expect(isPermittedReadAction(writeAction)).toBe(false);
  });

  it('rejects a write action arriving as request input, where the type is a comment', () => {
    for (const verb of MUTATING_VERBS) {
      expect(isPermittedReadAction(verb)).toBe(false);
      expect(isPermittedReadAction(`${verb}-record`)).toBe(false);
    }
    expect(isPermittedReadAction('constructor')).toBe(false);
    expect(isPermittedReadAction('toString')).toBe(false);
    expect(isPermittedReadAction(null)).toBe(false);
  });

  it('contains no mutating verb, so the list cannot grow a write action later', () => {
    for (const action of PERMITTED_READ_ACTIONS) {
      for (const verb of MUTATING_VERBS) {
        expect(action, `"${action}" contains the mutating verb "${verb}"`).not.toContain(verb);
      }
    }
  });

  it('recognizes the four kinds and nothing else', () => {
    for (const kind of TARGET_SYSTEM_KINDS) expect(isTargetSystemKind(kind)).toBe(true);
    expect(isTargetSystemKind('database')).toBe(false);
    expect(isTargetSystemKind('constructor')).toBe(false);
    expect(isTargetSystemKind(undefined)).toBe(false);
  });
});
