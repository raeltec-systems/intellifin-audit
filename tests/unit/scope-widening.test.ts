import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scopeWideningWarnings, type ScopeCheckSystem, type ScopeWarningKind } from '@intellifin/domain';

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
