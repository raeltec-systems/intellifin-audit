import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DECISION_WORD_KEYS, decisionConsequence, decisionTitle, decisionWord } from './version-review-words';

/**
 * UX-11 and UX-17: the review surface printed a stored decision value and an opaque id,
 * and its approval dialog said "Approve?" over a consequence that named neither the
 * Procedure nor what approval actually does.
 */
describe('a saved decision reads as a word', () => {
  it('writes a word for every decision the domain has, and for nothing else', () => {
    // Read from the domain's own type, not from a copy of the table under test: the
    // `Record<VersionDecision, string>` typing already refuses a MISSING decision at
    // compile time, and this is the other direction.
    const source = readFileSync(
      fileURLToPath(new URL('../../../../packages/domain/src/procedures/version-decision.ts', import.meta.url)),
      'utf8',
    );
    const declared = /export type VersionDecision =([^;]+);/.exec(source)?.[1] ?? '';
    const parsed = [...declared.matchAll(/'([a-z-]+)'/g)].map(match => match[1]);
    expect([...DECISION_WORD_KEYS].sort()).toEqual([...parsed].sort());
  });

  it.each(DECISION_WORD_KEYS)('writes %s in words, never as the stored value', decision => {
    const word = decisionWord(decision);
    expect(word).not.toBe(decision);
    // A word, not a code: capitalised prose with no hyphenated identifier in it.
    expect(word).toMatch(/^[A-Z][A-Za-z ]+$/);
  });

  it('keeps a value outside the vocabulary rather than showing a blank', () => {
    // The decision arrives from a stored `jsonb` payload. Honest about what the row
    // holds beats an empty cell a reader takes for "nothing happened".
    expect(decisionWord('rescinded')).toBe('rescinded');
  });

  it('does not answer an inherited property with a function', () => {
    // `Object.hasOwn`, the standing rule for a lookup keyed by stored data.
    expect(decisionWord('constructor')).toBe('constructor');
    expect(decisionWord('toString')).toBe('toString');
  });
});

describe('a decision confirmation names the Procedure and the version', () => {
  const subject = { controlName: 'Terminated user access', versionNumber: 3, firstVersion: false };

  it('names both in the title, where a bare "Approve?" said neither', () => {
    expect(decisionTitle('approve', 'Approve', subject)).toBe(
      'Approve version 3 of Terminated user access?',
    );
  });

  it('keeps the Builder and Procedure page wording when no subject is supplied', () => {
    // Those two surfaces name their Draft on the page around the control, and neither
    // was part of this finding; a change there would be one nobody asked for.
    expect(decisionTitle('submit', 'Submit for approval', null)).toBe('Submit for approval?');
    expect(decisionConsequence('approve', null)).toBe(
      'This freezes the reviewed Procedure Version and records your approval.',
    );
    expect(decisionConsequence('reject', null)).toBe(
      'This records your rationale and returns the Procedure Version to its author.',
    );
    expect(decisionConsequence('edit', null)).toBe(
      'This changes the Procedure Version state and records the decision against your name.',
    );
  });
});

/**
 * The approval consequence is a claim about what `transitionVersion` does. A dialog that
 * describes a consequence the command does not have is worse than one that describes
 * none, so the two branches are checked against the command's own source.
 */
describe('the approval consequence says what approval actually does', () => {
  const command = readFileSync(
    fileURLToPath(new URL('../../../../packages/application/src/procedures/decide-version.ts', import.meta.url)),
    'utf8',
  );

  it('states both outcomes the command can reach for a later version', () => {
    const words = decisionConsequence('approve', {
      controlName: 'Terminated user access',
      versionNumber: 3,
      firstVersion: false,
    });
    expect(words).toContain('version 3 becomes Active');
    expect(words).toContain('Runs can be started against it');
    expect(words).toContain('stays Approved until a Regression Run');
    // And the command really has both arms: `ACTIVE` when nothing that matters changed,
    // `APPROVED` pending regression when something did.
    expect(command).toContain("state = requirement.requiresRegression ? 'APPROVED' : 'ACTIVE'");
  });

  it('states the single outcome version 1 can reach, because no Active version exists', () => {
    const words = decisionConsequence('approve', {
      controlName: 'Terminated user access',
      versionNumber: 1,
      firstVersion: true,
    });
    expect(words).toContain('version 1 becomes Active as soon as you approve it');
    // Never the conditional half: with no predecessor, `regressionRequirement` answers
    // `first-version` and no Regression Run is ever required.
    expect(words).not.toContain('Regression Run');
    expect(command).toContain('regressionRequirement(versionConfigurationTuple(before), previous ? versionConfigurationTuple(previous) : null)');
  });

  it('names the four things the configuration comparison actually covers', () => {
    const words = decisionConsequence('approve', {
      controlName: 'Terminated user access',
      versionNumber: 2,
      firstVersion: false,
    });
    for (const named of ['model', 'tools', 'Target Systems', 'Population Source']) {
      expect(words, named).toContain(named);
    }
    // `versionConfigurationTuple` is model + tool contract + every Target System
    // registration digest + the Population Source binding digest. Nothing else.
    const tuple = readFileSync(
      fileURLToPath(new URL('../../../../packages/application/src/procedures/decide-version.ts', import.meta.url)),
      'utf8',
    );
    expect(tuple).toContain('return { model: definition.modelConfiguration, toolConfiguration: definition.toolConfiguration,');
    expect(tuple).toContain("kind: 'target' as const, id: target.registrationId, digest: target.digest");
    expect(tuple).toContain("kind: 'source' as const, id: row.sourceSnapshot.bindingId, digest: row.sourceSnapshot.digest");
  });

  it('records the approval against a person on every arm', () => {
    for (const firstVersion of [true, false]) {
      expect(decisionConsequence('approve', { controlName: 'X', versionNumber: 2, firstVersion }))
        .toContain('recorded against your name');
    }
    expect(command).toContain('actorId: input.session.userId');
  });
});

/**
 * The approve command takes no rationale, so the dialog offers no note field.
 *
 * `transitionVersion` validates a rationale for `reject` alone and hard-codes `null` for
 * every other decision, so an optional approval note would be typed by a manager,
 * accepted by the form, and silently discarded before it reached the immutable record.
 * A field whose value is thrown away is worse than no field. Pinned here so a later
 * change to the command is what moves this decision, rather than somebody re-deciding it
 * from the surface.
 */
describe('approval carries no rationale', () => {
  it('is the command that refuses one, not the surface that forgot to offer it', () => {
    const command = readFileSync(
      fileURLToPath(new URL('../../../../packages/application/src/procedures/decide-version.ts', import.meta.url)),
      'utf8',
    );
    expect(command).toContain("const rationale = decision === 'reject' ? rejectionRationale(input.rationale) : { ok: true as const, value: null };");
  });
});

/**
 * These words are only the fix if the dialog actually reads them.
 *
 * `ConfirmDialog` portals into a container set in an effect, so under
 * `renderToStaticMarkup` it renders nothing and no SSR test can see its title. A module
 * that is correct and unused is the `.ls-actions` shape — right everywhere it is
 * spelled, painting nothing — so the component is read instead.
 */
describe('the confirmation dialog reads these words', () => {
  const component = readFileSync(
    fileURLToPath(new URL('./VersionActions.tsx', import.meta.url)),
    'utf8',
  );

  it('takes its title and its consequence from here', () => {
    expect(component).toContain('title={decisionTitle(');
    expect(component).toContain('consequence={decisionConsequence(');
  });

  it('keeps no retyped copy of the sentences it replaced', () => {
    // A second spelling drifts on the first change nobody makes in both places.
    expect(component).not.toContain('This freezes the reviewed Procedure Version');
    expect(component).not.toContain('This records your rationale and returns');
    expect(component).not.toMatch(/title=\{`\$\{/);
  });
});
