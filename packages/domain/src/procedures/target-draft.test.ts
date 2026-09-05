import { describe, expect, it } from 'vitest';

import { findProcedureTemplate } from './templates.js';
import { registrationDigest } from '../registrations/target-system.js';
import {
  defaultTargetsFor,
  isDraftTargetFields,
  isProcedureTargetSnapshot,
  scopeWideningWarnings,
  snapshotFromRegistration,
  targetBlockersFor,
  validateDraftTargetEdit,
  validateInstructionSelection,
  TARGET_DRAFT_LIMITS,
  TARGET_DRAFT_MESSAGES,
  type RegistrationSixFields,
  type ScopeCheckSystem,
} from './target-draft.js';

/**
 * The Target System snapshot, the completeness diagnostics, and the scope-widening check
 * (FR-7, FR-8). The fixture-driven proof that the three seeded SW instructions each raise
 * a named warning lives in `tests/unit/scope-widening.test.ts`, which can read the golden
 * file off disk; this package has no `@types/node` and reads nothing.
 */

function registration(fields: Omit<RegistrationSixFields, 'digest'>): RegistrationSixFields {
  return { ...fields, digest: registrationDigest(fields) };
}

const LOANCORE = registration({
  registrationId: '018f0000-0000-7000-8000-0000000000a1',
  displayName: 'LoanCore',
  kind: 'web',
  allowedOrigins: ['http://localhost:4300/loancore'],
  applicationIdentity: '',
  credentialRef: 'vault://audit/loancore',
  permittedActions: ['navigate', 'search', 'read-attribute'],
  attributeLabelPatterns: ['Status', 'Username', 'Roles'],
  secondaryKey: 'Full name',
});

const LEDGERDESK = registration({
  registrationId: '018f0000-0000-7000-8000-0000000000a2',
  displayName: 'LedgerDesk',
  kind: 'desktop',
  allowedOrigins: [],
  applicationIdentity: 'com.northstar.ledgerdesk',
  credentialRef: 'vault://audit/ledgerdesk',
  permittedActions: ['navigate', 'read-attribute'],
  attributeLabelPatterns: ['Status'],
  secondaryKey: '',
});

const loancoreSystem: ScopeCheckSystem = {
  displayName: 'LoanCore',
  kind: 'web',
  allowedOrigins: ['http://localhost:4300/loancore'],
};

describe('the frozen Target System snapshot', () => {
  it('freezes the six-field contract and validates its own digest, web and desktop', () => {
    for (const record of [LOANCORE, LEDGERDESK]) {
      const snapshot = snapshotFromRegistration(record);
      expect(isProcedureTargetSnapshot(snapshot)).toBe(true);
      expect(snapshot.registrationId).toBe(record.registrationId);
      expect(snapshot.contract.credential_ref).toBe(record.credentialRef);
    }
    // The desktop application identity occupies the allowed_origins slot.
    expect(snapshotFromRegistration(LEDGERDESK).contract.allowed_origins).toEqual([
      'com.northstar.ledgerdesk',
    ]);
  });

  it('refuses a snapshot whose stored digest was copied from elsewhere', () => {
    const snapshot = snapshotFromRegistration(LOANCORE);
    expect(isProcedureTargetSnapshot({ ...snapshot, digest: '0'.repeat(64) })).toBe(false);
    // A tampered contract no longer hashes to the stored digest.
    expect(
      isProcedureTargetSnapshot({
        ...snapshot,
        contract: { ...snapshot.contract, credential_ref: 'vault://audit/other' },
      }),
    ).toBe(false);
  });

  it('preserves a stored digest instead of silently repairing an inconsistent registration', () => {
    const snapshot = snapshotFromRegistration({ ...LOANCORE, digest: '0'.repeat(64) });
    expect(snapshot.digest).toBe('0'.repeat(64));
    expect(isProcedureTargetSnapshot(snapshot)).toBe(false);
  });

  it('refuses a digest-consistent contract with an invalid read action or no locator', () => {
    for (const fields of [
      { ...LOANCORE, permittedActions: ['delete'] },
      { ...LOANCORE, allowedOrigins: [] },
      { ...LOANCORE, credentialRef: '' },
    ]) {
      const unsafe = registration(fields as Omit<RegistrationSixFields, 'digest'>);
      expect(isProcedureTargetSnapshot(snapshotFromRegistration(unsafe))).toBe(false);
    }
  });
});

describe('the target fields validator', () => {
  const web = snapshotFromRegistration(LOANCORE);
  const desktop = snapshotFromRegistration(LEDGERDESK);
  const api = snapshotFromRegistration(registration({ ...LOANCORE, registrationId: '018f0000-0000-7000-8000-0000000000a3', kind: 'api', displayName: 'AccessGate' }));

  it('accepts an ordered unique selection with instructions for agent systems only', () => {
    expect(
      isDraftTargetFields({
        targets: [web, desktop],
        instructions: [{ registrationId: web.registrationId, text: 'Read the status.' }],
      }),
    ).toBe(true);
  });

  it('rejects a duplicate selection', () => {
    expect(isDraftTargetFields({ targets: [web, web], instructions: [] })).toBe(false);
  });

  it('rejects an instruction for an unselected or non-agent system', () => {
    // Orphan: the system is not selected.
    expect(isDraftTargetFields({ targets: [web], instructions: [{ registrationId: desktop.registrationId, text: 'x' }] })).toBe(false);
    // An API system is selectable but takes no agent instructions.
    expect(isDraftTargetFields({ targets: [api], instructions: [{ registrationId: api.registrationId, text: 'x' }] })).toBe(false);
  });
});

describe('untrusted Target System edits', () => {
  it.each([null, undefined, 3, [], {}, { section: 'unknown' },
    { section: 'target-systems', selections: [{ mode: 'bind', registrationId: 'not-a-uuid', expectedDigest: LOANCORE.digest }] },
    { section: 'target-systems', selections: [{ mode: 'bind', registrationId: LOANCORE.registrationId, expectedDigest: 'wrong' }] },
    { section: 'target-systems', selections: Array(33).fill({ mode: 'retain', registrationId: LOANCORE.registrationId }) },
  ])('refuses malformed or oversized selection %j', (edit) => {
    expect(validateDraftTargetEdit(edit)).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.SELECTION });
  });

  it('bounds and checks blank instructions before treating them as a clear', () => {
    const edit = (text: string) => ({ section: 'audit-instructions', instructions: [{ registrationId: LOANCORE.registrationId, text }] });
    expect(validateDraftTargetEdit(edit(' '.repeat(TARGET_DRAFT_LIMITS.instruction + 1)))).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.INSTRUCTION_TOO_LONG });
    expect(validateDraftTargetEdit(edit('\ud800'))).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.NOT_STORABLE });
    const duplicated = { section: 'audit-instructions', instructions: [
      { registrationId: LOANCORE.registrationId, text: '' },
      { registrationId: LOANCORE.registrationId, text: 'Read the status.' },
    ] };
    expect(validateDraftTargetEdit(duplicated)).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION });
    expect(validateDraftTargetEdit({ section: 'audit-instructions', instructions: Array(33).fill({ registrationId: LOANCORE.registrationId, text: '' }) })).toEqual({ ok: false, reason: TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION });
    expect(validateInstructionSelection([snapshotFromRegistration(LOANCORE)], [{ registrationId: LEDGERDESK.registrationId, text: '' }])).toBe(TARGET_DRAFT_MESSAGES.ORPHAN_INSTRUCTION);
  });
});

describe('the completeness diagnostics', () => {
  const web = snapshotFromRegistration(LOANCORE);
  const desktop = snapshotFromRegistration(LEDGERDESK);

  it('offers P-1 its web and desktop defaults by name', () => {
    expect(defaultTargetsFor('P-1')).toEqual([
      { name: 'LoanCore', kind: 'web' },
      { name: 'LedgerDesk', kind: 'desktop' },
    ]);
  });

  it('flags a missing selection, then missing P-1 web/desktop coverage', () => {
    expect(targetBlockersFor('P-1', [])).toEqual([
      'targets-missing',
      'web-coverage-missing',
      'desktop-coverage-missing',
    ]);
    expect(targetBlockersFor('P-1', [web])).toEqual(['desktop-coverage-missing']);
    expect(targetBlockersFor('P-1', [web, desktop])).toEqual([]);
  });

  it('requires no agent coverage for an adapter-only Template', () => {
    // P-2 names an API system; selecting nothing is only "targets-missing", no coverage gap.
    expect(targetBlockersFor('P-2', [])).toEqual(['targets-missing']);
  });
});

describe('the scope-widening check', () => {
  it('names a write verb (SW-2) and not a read-only status label', () => {
    const write = scopeWideningWarnings('Where you find an active account, disable it.', [loancoreSystem]);
    expect(write).toHaveLength(1);
    expect(write[0]).toMatchObject({ kind: 'write-verb', offending: 'disable' });

    // The permitted Template instruction, checked: read-only status labels raise nothing.
    const template = findProcedureTemplate('P-1').auditInstructions ?? '';
    expect(template).toContain('status');
    expect(scopeWideningWarnings(template, [loancoreSystem])).toEqual([]);
  });

  it('names an out-of-scope origin (SW-3) and respects path boundaries', () => {
    const out = scopeWideningWarnings(
      'Open the shared drive at https://files.northstar-hr.synthetic.invalid/leavers and read it.',
      [loancoreSystem],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'out-of-scope-origin' });

    // A path under the allowlisted origin is in scope; a sibling path is not.
    expect(scopeWideningWarnings('Read http://localhost:4300/loancore/accounts/42', [loancoreSystem])).toEqual([]);
    expect(scopeWideningWarnings('Read http://localhost:4300/loancore-other/x', [loancoreSystem])).toHaveLength(1);
  });

  it('names an unregistered system (SW-1) and not a selected one', () => {
    const unregistered = scopeWideningWarnings(
      'If the employee is not in LoanCore, sign in to PayrollVault and check.',
      [loancoreSystem],
    );
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0]).toMatchObject({ kind: 'unregistered-system', offending: 'PayrollVault' });
  });

  it('normalizes dot segments and default ports before comparing origins', () => {
    const selected = [{ displayName: 'LoanCore', kind: 'web' as const, allowedOrigins: ['https://loancore.synthetic.invalid/loancore'] }];
    expect(scopeWideningWarnings('Read https://loancore.synthetic.invalid:443/loancore/account', selected)).toEqual([]);
    for (const path of ['/loancore/../payroll', '/loancore/%2E%2e/payroll']) {
      expect(scopeWideningWarnings(`Read https://loancore.synthetic.invalid${path}`, selected)).toEqual([
        expect.objectContaining({ kind: 'out-of-scope-origin' }),
      ]);
    }
  });

  it('names an unselected registered system with spaces and does not accept a name prefix', () => {
    expect(scopeWideningWarnings('Open the payroll vault and read the account.', [loancoreSystem], [{ displayName: 'Payroll Vault' }])).toEqual([
      expect.objectContaining({ kind: 'unregistered-system', offending: 'Payroll Vault' }),
    ]);
    expect(scopeWideningWarnings('Open LoanCore.', [{ ...loancoreSystem, displayName: 'LoanCoreArchive' }])).toEqual([
      expect.objectContaining({ kind: 'unregistered-system', offending: 'LoanCore' }),
    ]);
  });

  it('is empty for a plainly in-scope instruction', () => {
    expect(scopeWideningWarnings('Sign in and read the account status and roles.', [loancoreSystem])).toEqual([]);
  });
});
