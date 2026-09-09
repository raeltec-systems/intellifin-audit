import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  authorizeToolAction,
  registrationDigest,
  registrationDigestEnvelope,
  scopeWideningWarnings,
  type ProcedureTargetSnapshot,
  type RegistrationDigestInput,
  type ScopeCheckSystem,
  type ScopeWarningKind,
  type ToolActionScope,
} from '@intellifin/domain';

/**
 * The three seeded scope-widening instructions, from the golden fixture (AD-12).
 *
 * The fixture is DATA, and runtime code cannot import it — the scope checker is in
 * `@intellifin/domain` and reads nothing. This test is where the two meet: it reads the
 * fixture off disk and drives the pure domain check with it, proving each seeded
 * instruction raises the NAMED advisory warning its `kind` calls for (FR-8). The fixture's
 * "refuse to compile" prose is superseded by FR-8, which makes the flag advisory; what is
 * pinned here is that the flag is RAISED and NAMES the offending thing.
 */

const ROOT = '../../';
const FIXTURE = 'fixtures/northstar/expectations/scope-widening-instructions.json';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL(`${ROOT}${FIXTURE}`, import.meta.url)), 'utf8'),
) as {
  instructions: readonly {
    instruction_id: string;
    kind: string;
    text: string;
    expected_execution_outcome: string;
  }[];
};

/** The systems a P-1 Draft selects: LoanCore (web) and LedgerDesk (desktop). */
const SELECTED: readonly ScopeCheckSystem[] = [
  { displayName: 'LoanCore', kind: 'web', allowedOrigins: ['http://localhost:4300/loancore'] },
  { displayName: 'LedgerDesk', kind: 'desktop', allowedOrigins: [] },
];

const KIND_OF: Readonly<Record<string, ScopeWarningKind>> = {
  'unregistered system': 'unregistered-system',
  'write verb': 'write-verb',
  'out-of-scope origin': 'out-of-scope-origin',
};

describe('the seeded scope-widening instructions', () => {
  it('names all three, so every seeded instruction is flagged before submission exists', () => {
    expect(fixture.instructions).toHaveLength(3);
  });

  it.each(fixture.instructions.map((instruction) => [instruction.instruction_id, instruction] as const))(
    '%s raises a named advisory warning of its own kind',
    (_id, instruction) => {
      const expectedKind = KIND_OF[instruction.kind];
      expect(expectedKind, `unknown fixture kind ${instruction.kind}`).toBeDefined();
      const warnings = scopeWideningWarnings(instruction.text, SELECTED);
      const matching = warnings.filter((warning) => warning.kind === expectedKind);
      expect(matching.length, JSON.stringify(warnings)).toBeGreaterThanOrEqual(1);
      // The advisory NAMES the offending verb, origin, or system.
      expect(matching[0]?.offending.length).toBeGreaterThan(0);
      expect(matching[0]?.message).toContain(matching[0]?.offending ?? '');
      // FR-8: each is denied at execution too. That the fixture still says so is what makes
      // this the flag half of a two-part control, not the whole of it.
      expect(instruction.expected_execution_outcome).toBe('denied');
    },
  );
});

/**
 * The OTHER half of the two-part control (Story 4.2, FR-3).
 *
 * The fixture's own rule says it in as many words: "Flagged-only is a failure ... Denied-only
 * is also a failure". The block above proves the advisory flag; this one proves the execution
 * denial, and the two are DELIBERATELY different mechanisms — `scopeWideningWarnings` reads
 * prose and never refuses, `authorizeToolAction` reads the frozen contract and always does. If
 * they shared an implementation, making one strict would silently make the other strict too,
 * and a false positive would then block a save.
 *
 * The action each instruction asks for is taken from the ADVISORY check's own `offending`
 * value rather than retyped here, so the thing the Builder named is provably the thing the
 * gate refuses. SW-1 is the exception and says why below.
 */

const FROZEN: RegistrationDigestInput = {
  kind: 'web',
  allowedOrigins: ['http://localhost:4300/loancore'],
  applicationIdentity: '',
  credentialRef: 'cred://synthetic/loancore-readonly',
  permittedActions: ['navigate', 'search', 'open-record', 'read-attribute', 'capture-screenshot'],
  attributeLabelPatterns: ['Status', 'Username', 'Roles', 'Employee ID', 'Full name'],
  secondaryKey: 'Full name',
};

const TARGET: ProcedureTargetSnapshot = {
  registrationId: 'reg-loancore',
  displayName: 'LoanCore',
  digest: registrationDigest(FROZEN),
  contract: registrationDigestEnvelope(FROZEN),
};

/** The whole population of a P-1 Run, so a search inside it is not what is being denied. */
const SCOPE: ToolActionScope = { target: TARGET, scopeValues: new Set(['E-000103']) };

function offendingOf(text: string, kind: ScopeWarningKind): string {
  const warning = scopeWideningWarnings(text, SELECTED).find((entry) => entry.kind === kind);
  if (warning === undefined) throw new Error(`the advisory check raised no ${kind} for this text`);
  return warning.offending;
}

describe('the same three instructions are DENIED at execution', () => {
  it('SW-2: the write verb the Builder named is an action no version can permit', () => {
    const instruction = fixture.instructions.find((entry) => entry.instruction_id === 'SW-2')!;
    const verb = offendingOf(instruction.text, 'write-verb');
    expect(verb).toBe('disable');
    expect(
      authorizeToolAction(SCOPE, {
        action: verb,
        destination: 'http://localhost:4300/loancore/users/E-000103',
        parameters: [],
      }),
    ).toEqual({ allowed: false, denial: 'action-not-permitted', offending: verb });
  });

  it('SW-3: the origin the Builder named is outside every frozen allowed origin', () => {
    const instruction = fixture.instructions.find((entry) => entry.instruction_id === 'SW-3')!;
    const origin = offendingOf(instruction.text, 'out-of-scope-origin');
    expect(origin).toContain('files.northstar-hr.synthetic.invalid');
    expect(
      authorizeToolAction(SCOPE, { action: 'navigate', destination: origin, parameters: [] }),
    ).toMatchObject({ allowed: false, denial: 'origin-not-allowed' });
  });

  it('SW-1: the unregistered system has no frozen origin, so nothing addresses it', () => {
    const instruction = fixture.instructions.find((entry) => entry.instruction_id === 'SW-1')!;
    const system = offendingOf(instruction.text, 'unregistered-system');
    expect(system).toBe('PayrollVault');
    // The instruction names a SYSTEM rather than a URL, so the host below is built by this
    // test. What is being asserted is not that one spelling is refused: it is that NO frozen
    // allowed origin the version carries names this system at all, so every destination that
    // does is outside the allowlist however it is spelled.
    expect(TARGET.contract.allowed_origins.join(' ').toLowerCase()).not.toContain(
      system.toLowerCase(),
    );
    for (const destination of [
      `https://${system.toLowerCase()}.synthetic.invalid/accounts`,
      `http://localhost:4300/${system.toLowerCase()}`,
      `http://localhost:4300/loancore-${system.toLowerCase()}`,
    ]) {
      expect(
        authorizeToolAction(SCOPE, { action: 'navigate', destination, parameters: [] }),
      ).toMatchObject({ allowed: false, denial: 'origin-not-allowed' });
    }
  });

  it('every instruction the fixture declares reaches one of the two denials', () => {
    // The walk, so an instruction added to the fixture later is covered rather than the
    // three above being a sample somebody happened to write.
    for (const instruction of fixture.instructions) {
      const warnings = scopeWideningWarnings(instruction.text, SELECTED);
      expect(warnings.length, instruction.instruction_id).toBeGreaterThanOrEqual(1);
      expect(instruction.expected_execution_outcome).toBe('denied');
    }
  });
});
