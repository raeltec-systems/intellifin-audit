import { describe, expect, it } from 'vitest';

import { defaultTargetsFor, PROCEDURE_TEMPLATES } from '@intellifin/domain';

import {
  DESKTOP_DEFAULT_LEFT_OUT,
  suggestedTargetNote,
  suggestedTargets,
  targetCoverageMissing,
} from './labels';

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

/**
 * The two sentences an auditor meets about a Template's desktop default, and the defect
 * they used to form together.
 *
 * On ONE panel, while choosing Target Systems for P-1: the suggestion caption said
 * LedgerDesk cannot be run by this release and to leave it out, and a warning Banner a
 * few elements below said "This Template names a desktop Target System, and none is
 * selected. Add the registered desktop system." The owner read both and could not tell
 * which was true. The caption is the one that agrees with what this release executes and
 * with the domain — `targetBlockersFor` has raised `targets-missing` alone since the
 * owner's 2026-09-07 decision — so the completeness sentence is narrowed to `'web'` and
 * a new one says what leaving the desktop system out actually means.
 */
describe('a Template default this release cannot run', () => {
  const note = suggestedTargetNote({ name: 'LedgerDesk', kind: 'desktop', registered: false });

  it('never asks for a desktop system to be added, in either sentence', () => {
    for (const sentence of [note, DESKTOP_DEFAULT_LEFT_OUT]) {
      expect(sentence.toLowerCase()).not.toContain('add the registered');
      expect(sentence.toLowerCase()).not.toContain('add a desktop');
    }
  });

  it('says leaving it out still leaves a complete selection', () => {
    expect(note).toContain('Leave it out.');
    expect(DESKTOP_DEFAULT_LEFT_OUT).toContain('left out');
    expect(DESKTOP_DEFAULT_LEFT_OUT).toContain('complete without it');
    // And it names what this release does run, so "complete" is checkable rather than
    // something the reader has to take on trust.
    expect(DESKTOP_DEFAULT_LEFT_OUT).toContain('web, API and file systems');
  });

  it('keeps the completeness diagnostic to a kind this release runs', () => {
    expect(targetCoverageMissing('web')).toContain('web Target System');
    expect(targetCoverageMissing('web')).not.toContain('desktop');
    // The mechanism, not just the wording: the desktop sentence cannot be produced at
    // all, so the Builder's old `for (const kind of ['web', 'desktop'])` no longer
    // compiles. `pnpm --filter @intellifin/web typecheck` covers this file, so the
    // expectation below fails the build if the parameter is ever widened again.
    // @ts-expect-error a desktop coverage sentence is not expressible
    expect(() => targetCoverageMissing('desktop')).toBeDefined();
  });
});
