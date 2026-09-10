import { describe, expect, it } from 'vitest';

import { defaultTargetsFor, PROCEDURE_TEMPLATES } from '@intellifin/domain';

import { suggestedTargetNote, suggestedTargets } from './labels';

/**
 * What the Builder says about a Template's suggested systems.
 *
 * The defect this exists for: P-1 suggests LedgerDesk, no deployment registers a desktop
 * system because this release cannot execute one, and the caption named it beside systems
 * that ARE registered with nothing distinguishing the two. An auditor looking for
 * LedgerDesk in a list that does not contain it reads that as the Procedure being
 * unbuildable — which it is not, and which nothing on the surface said.
 */
describe('suggestedTargets', () => {
  const registrations = [
    { displayName: 'LoanCore', kind: 'web' as const },
    { displayName: 'AccessGate', kind: 'api' as const },
  ];

  it('matches a registration by display name and kind, ignoring case and padding', () => {
    expect(
      suggestedTargets([{ name: 'loancore', kind: 'web' }], [{ displayName: '  LoanCore ', kind: 'web' }]),
    ).toEqual([{ name: 'loancore', kind: 'web', registered: true }]);
  });

  it('does NOT match a registration of another kind under the same name', () => {
    expect(
      suggestedTargets([{ name: 'LoanCore', kind: 'desktop' }], registrations)[0]?.registered,
    ).toBe(false);
  });

  it('reports P-1 against a deployment that registers no desktop system', () => {
    const marked = suggestedTargets(defaultTargetsFor('P-1'), registrations);
    expect(marked).toEqual([
      { name: 'LoanCore', kind: 'web', registered: true },
      { name: 'LedgerDesk', kind: 'desktop', registered: false },
    ]);
  });

  it('gives every shipped Template a note for every system it suggests', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      for (const target of suggestedTargets(defaultTargetsFor(template.id), registrations)) {
        expect(suggestedTargetNote(target), `${template.id} ${target.name}`).not.toBe('');
      }
    }
  });
});

describe('suggestedTargetNote', () => {
  it('says a registered system is ready to add', () => {
    expect(suggestedTargetNote({ name: 'AccessGate', kind: 'api', registered: true }))
      .toBe('ready to add below.');
  });

  it('names who can add an unregistered one, and does not claim it does not exist', () => {
    const note = suggestedTargetNote({ name: 'AccessGate', kind: 'api', registered: false });
    expect(note).toContain('no system with this name is set up here');
    expect(note).toContain('PoC Administrator');
  });

  it('says a desktop system cannot be run by this release, registered or not', () => {
    for (const registered of [true, false]) {
      expect(suggestedTargetNote({ name: 'LedgerDesk', kind: 'desktop', registered }))
        .toContain('cannot run a desktop system');
    }
  });
});
