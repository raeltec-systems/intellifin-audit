import { describe, expect, it } from 'vitest';
import {
  diffReviewedDefinitions,
  registrationDigest,
  snapshotFromRegistration,
  type ReviewedDefinition,
  type VersionSectionDiff,
} from '@intellifin/domain';

import { executablePlanInputs } from '../../../../../tests/fixtures/executable-plan';
import {
  NOT_IN_PREVIOUS,
  TECHNICAL_DIFF_SECTIONS,
  factChanges,
  sectionFacts,
  sectionTitle,
  systemNames,
  versionChanges,
} from './changed-sections';
import { SUMMARY_LABELS } from './review-words';

/**
 * What somebody changed since the previous version, in words.
 *
 * The stored diff carries two whole frozen structures per section and a `changed` flag,
 * and a first version's flag is `true` on EVERY section — `isConsistentVersionReview`
 * requires that of a review with no baseline. So the thing to prove is that the words a
 * manager reads come from a real comparison, and that nothing changed is ever dropped in
 * silence.
 */

const INPUTS = executablePlanInputs();

function definition(overrides: Partial<typeof INPUTS> = {}): ReviewedDefinition {
  return {
    schemaVersion: 1,
    inputs: { ...INPUTS, ...overrides },
    compiledPlan: null,
    modelConfiguration: null,
    toolConfiguration: {
      interpreterContract: 'executable-plan-v1',
      identityMatching: 'opaque-exact-strings',
      accessPolicy: 'frozen-registered-read-actions',
      actions: ['create-workspace'],
    },
  };
}

function diffOf(before: ReviewedDefinition, after: ReviewedDefinition): readonly VersionSectionDiff[] {
  return diffReviewedDefinitions(before, after);
}

describe('a changed section is reported by the facts that really differ', () => {
  it('reports one changed fact when one authored value moved', () => {
    const changes = versionChanges(
      diffOf(definition({ scope: 'The predecessor scope.' }), definition()),
      'P-4',
    );
    const facts = changes.sections.flatMap((section) => section.facts);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.label).toBe(SUMMARY_LABELS.scope);
    expect(facts[0]!.before).toBe('The predecessor scope.');
    expect(facts[0]!.after).toBe(INPUTS.scope);
  });

  it('reports nothing when the two definitions are identical', () => {
    const changes = versionChanges(diffOf(definition(), definition()), 'P-4');
    expect(changes.sections).toHaveLength(0);
    expect(changes.technicalChanged).toBe(0);
  });

  it('names a fact the previous version did not have, rather than leaving it blank', () => {
    const registration = {
      registrationId: '018f0000-0000-7000-8000-0000000000c1',
      displayName: 'LedgerDesk',
      kind: 'web' as const,
      allowedOrigins: ['https://synthetic.invalid/ledgerdesk'],
      applicationIdentity: '',
      credentialRef: 'vault://synthetic/ledgerdesk',
      permittedActions: ['read-attribute'] as const,
      attributeLabelPatterns: ['Parameter'],
      secondaryKey: '',
    };
    const added = snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) });
    const changes = versionChanges(
      diffOf(definition(), definition({ targets: [...INPUTS.targets, added] })),
      'P-4',
    );
    const fact = changes.sections.flatMap((section) => section.facts).find((entry) => entry.label === 'LedgerDesk');
    expect(fact?.before).toBe(NOT_IN_PREVIOUS);
    expect(fact?.after).toContain('read a field');
  });

  it('counts a section that changed only in its frozen contract, never dropping it', () => {
    // A section whose only difference is a compiler or schema version has nothing to say
    // in words. Dropping it would report "nothing changed" over a section that did.
    const changed: readonly VersionSectionDiff[] = [
      { section: 'Compliance Rule', before: { compilerVersion: '0' }, after: { compilerVersion: '1' }, changed: true },
    ];
    const changes = versionChanges(changed, 'P-4');
    expect(changes.sections).toHaveLength(0);
    expect(changes.technicalChanged).toBe(1);
  });

  it('counts the three sections that are a consequence, not an authored choice', () => {
    const changed: readonly VersionSectionDiff[] = TECHNICAL_DIFF_SECTIONS.map((section) => ({
      section,
      before: null,
      after: { anything: true },
      changed: true,
    }));
    expect(versionChanges(changed, 'P-4').technicalChanged).toBe(TECHNICAL_DIFF_SECTIONS.length);
    expect(versionChanges(changed, 'P-4').sections).toHaveLength(0);
  });
});

describe('a stored section name never resolves to an inherited function', () => {
  it('keeps a name this build does not recognise, rather than rendering a function', () => {
    // The section name arrives from a stored frozen review, so a plain index would answer
    // `'constructor'` with `Object.prototype.constructor`.
    expect(sectionTitle('constructor')).toBe('constructor');
    expect(sectionTitle('toString')).toBe('toString');
    expect(sectionTitle('Nothing this build knows')).toBe('Nothing this build knows');
  });

  it('gives each known section the Builder’s own title where it has one', () => {
    expect(sectionTitle('Target Systems')).not.toBe('Target Systems');
    expect(sectionTitle('Executable plan')).toBe('The step-by-step plan');
  });
});

describe('a side this build cannot read falls back rather than half-reading it', () => {
  it('says Not set for a Population Source binding that carries no source', () => {
    const facts = sectionFacts('Population Source binding', { source: 'nonsense' }, 'P-4', new Map());
    expect(facts.find((fact) => fact.label === SUMMARY_LABELS.source)?.value).toBe('Not set');
  });

  it('answers the section name for an unrecognised shape, never an empty list', () => {
    expect(sectionFacts('Target Systems', 'not an array', 'P-4', new Map())).toHaveLength(1);
    expect(sectionFacts('Evidence Requirements', null, 'P-4', new Map())).toHaveLength(1);
  });

  it('names a system by the display name whichever side of the diff carries it', () => {
    const names = systemNames(diffOf(definition(), definition()));
    expect(names.get(INPUTS.targets[0]!.registrationId)).toBe(INPUTS.targets[0]!.displayName);
  });

  it('compares one section without touching the rest of the diff', () => {
    const facts = factChanges(
      'Objective',
      'The previous objective.',
      'The submitted objective.',
      'P-4',
      new Map(),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.before).toBe('The previous objective.');
    expect(facts[0]!.after).toBe('The submitted objective.');
  });
});
