import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REGISTRATION_REFUSALS } from '@intellifin/application';

import {
  BUILDER_SECTION_NOT_EDITABLE_SENTENCE,
  BUILDER_DESKTOP_ONLY_SENTENCE,
  DECLARED_COUNT_MISSING_SENTENCE,
  MANUAL_UPLOAD_SENTENCE,
  EMPTY_STATES,
  ENVIRONMENT_RIBBON_SENTENCE,
  FULLY_QUOTED_EMPTY_STATES,
  PROCEDURE_CARD_ABSENT,
  REGISTRATION_CHANGE_WARNING_TEMPLATE,
  registrationChangeWarning,
} from './copy';

/**
 * Verbatim copy, checked against the UX handoff on disk.
 *
 * Every string in `copy.ts` claims to be a quotation. On its own that claim is pinned
 * against nothing — a component and a test can be retyped in the same commit and agree
 * with each other while both disagree with the contract. This reads the two artifacts
 * and requires each string to appear in one of them, character for character.
 *
 * The planning-artifact folder name contains a space, so each path is one string
 * resolved relative to this file rather than assembled from segments.
 */

const UX = '../../../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01';

const design = readFileSync(fileURLToPath(new URL(`${UX}/DESIGN.md`, import.meta.url)), 'utf8');
const experience = readFileSync(
  fileURLToPath(new URL(`${UX}/EXPERIENCE.md`, import.meta.url)),
  'utf8',
);

describe('copy quoted from the UX contract', () => {
  it('finds the two artifacts it is quoting', () => {
    expect(design).toContain('# Layout & Spacing');
    expect(experience).toContain('### Per-surface states');
  });

  it('reproduces the environment ribbon sentence from DESIGN.md', () => {
    expect(design).toContain(ENVIRONMENT_RIBBON_SENTENCE);
  });

  it('ships the ribbon sentence the ribbon actually renders', () => {
    // The component imports the constant rather than repeating the sentence, so the
    // artifact, the constant and the rendered markup are one string.
    const ribbon = readFileSync(
      fileURLToPath(new URL('./EnvironmentRibbon.tsx', import.meta.url)),
      'utf8',
    );
    expect(ribbon).toContain('ENVIRONMENT_RIBBON_SENTENCE');
    expect(ribbon).not.toContain('Synthetic PoC environment —');
  });

  it.each(FULLY_QUOTED_EMPTY_STATES)(
    'reproduces the %s empty state from EXPERIENCE.md, headline and sentence',
    (key) => {
      const { headline, sentence } = EMPTY_STATES[key];
      expect(experience).toContain(`${headline} ${sentence}`);
    },
  );

  it.each(Object.entries(EMPTY_STATES))(
    'reproduces the %s headline from EXPERIENCE.md',
    (_key, state) => {
      expect(experience).toContain(state.headline);
    },
  );

  it('gives every empty state a sentence that refuses the passed-control inference', () => {
    // EXPERIENCE.md → Component Patterns: "Headline + one sentence that names what would
    // appear and refuses to imply a passed control." The two sentences that are ours
    // rather than the contract's must still obey the rule.
    for (const [key, state] of Object.entries(EMPTY_STATES)) {
      expect(state.sentence.length, key).toBeGreaterThan(40);
      expect(state.sentence.trim().endsWith('.'), key).toBe(true);
    }
  });

  it('renders every shipped empty state from this module and not from inline copy', () => {
    const surfaces = [
      '../../app/page.tsx',
      '../../app/review/page.tsx',
      '../shell/NotificationBell.tsx',
    ];
    for (const surface of surfaces) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).toContain('EMPTY_STATES');
    }
  });
});

describe('the registration-change warning', () => {
  it('is EXPERIENCE.md\'s sentence, character for character', () => {
    // Read off disk, not compared with a copy of itself. The first version of this
    // sentence was typed inline in the component and differed from the contract in two
    // places; nothing caught it, because the branch that renders it is unreachable
    // until Epic 2 and no test could reach the string.
    expect(experience).toContain(REGISTRATION_CHANGE_WARNING_TEMPLATE);
  });

  it('substitutes the count into the contract sentence rather than retyping it', () => {
    expect(registrationChangeWarning(3)).toBe(
      REGISTRATION_CHANGE_WARNING_TEMPLATE.replace('{n}', '3'),
    );
    expect(registrationChangeWarning(3)).toContain('3 Procedures');
    expect(registrationChangeWarning(3)).not.toContain('{n}');
  });
});

describe('the missing declared-count warning', () => {
  it("is EXPERIENCE.md's sentence, character for character", () => {
    // Read off disk, exactly like the registration warning above. EXPERIENCE.md writes it
    // in quotation marks as the Flow 1 failure line, so the quotes are part of the match:
    // a paraphrase elsewhere in the document would not satisfy it.
    expect(experience).toContain(`"${DECLARED_COUNT_MISSING_SENTENCE}"`);
  });

  it('is rendered from this module and not retyped in the surface', () => {
    // The registration warning shipped first as an inline sentence that differed from the
    // contract in two places, and nothing noticed. This is the same guard one story on.
    // Every surface that shows it, not two of the three: BindingEditor.tsx paraphrased
    // it while these two quoted it, which is how one product says a rule two ways.
    for (const surface of [
      '../admin/BindingsPanel.tsx',
      '../admin/BindingForm.tsx',
      '../admin/BindingEditor.tsx',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).toContain('DECLARED_COUNT_MISSING_SENTENCE');
      expect(source, surface).not.toContain('must declare an expected record count');
    }
  });
});

describe('the read-only credential refusal', () => {
  it('is the sentence EXPERIENCE.md fixes, character for character', () => {
    // Three independent literals carried this string — the command, the browser spec's
    // helper and the surface — and each was only ever checked against another of them.
    // This one reads the contract off disk, the way `denial-strings.test.ts` does.
    expect(experience).toContain(`"${REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY}"`);
  });
});

describe('the Procedure card absent-cells', () => {
  it('are the four UX-DR7 sentences, in words, never a dash', () => {
    // UX-DR7 (epics.md): the card shows Active version, Schedule, next Run, last
    // outcome. The spec fixes these four sentences because an empty cell reads as
    // "fine". Each is pinned here as a worded sentence: one that ends in a dash, an
    // empty string, or a bare "—" fails this test.
    expect(PROCEDURE_CARD_ABSENT.activeVersion).toBe('No active version');
    expect(PROCEDURE_CARD_ABSENT.schedule).toBe('Not scheduled');
    expect(PROCEDURE_CARD_ABSENT.nextRun).toBe('No Runs yet');
    expect(PROCEDURE_CARD_ABSENT.lastOutcome).toBe('No outcome');
    for (const sentence of Object.values(PROCEDURE_CARD_ABSENT)) {
      expect(sentence.length).toBeGreaterThan(3);
      expect(sentence).not.toMatch(/^[-—\s]*$/);
    }
  });

  it('are rendered from this module by the Procedures list, not retyped', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../app/procedures/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('PROCEDURE_CARD_ABSENT');
    expect(source).not.toContain('No active version');
  });
});

describe('the Builder read-only sentence', () => {
  it('states that the section is not editable yet, and is rendered from this module', () => {
    expect(BUILDER_SECTION_NOT_EDITABLE_SENTENCE).toContain('not editable yet');
    const source = readFileSync(
      fileURLToPath(new URL('../procedures/BuilderSections.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('BUILDER_SECTION_NOT_EDITABLE_SENTENCE');
    expect(source).not.toContain('not editable yet. A later release');
  });
});

describe('the Builder desktop-only floor', () => {
  it("is EXPERIENCE.md's responsive-floor sentence, character for character", () => {
    // Quoted verbatim from the "< 900px" row, read off disk — not compared with a copy of
    // itself.
    expect(experience).toContain(`"${BUILDER_DESKTOP_ONLY_SENTENCE}"`);
  });

  it('is rendered from this module by the Builder page, not retyped', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../app/procedures/[id]/builder/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('BUILDER_DESKTOP_ONLY_SENTENCE');
    expect(source).not.toContain('Open on a desktop browser to author');
  });
});

describe('the manual-upload restriction', () => {
  it("is EXPERIENCE.md's blocker sentence, character for character", () => {
    // It shipped as an invented sentence under a comment claiming the contract was
    // silent about the restriction. The contract states it, in the Builder row, and a
    // surface that words a rule one way while the Builder words it another teaches an
    // administrator a sentence they will never see again.
    expect(experience).toContain(`"${MANUAL_UPLOAD_SENTENCE}"`);
  });

  it('is rendered from this module by every surface that states it', () => {
    for (const surface of [
      '../admin/BindingsPanel.tsx',
      '../admin/BindingForm.tsx',
      '../admin/BindingEditor.tsx',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).toContain('MANUAL_UPLOAD_SENTENCE');
      expect(source, surface).not.toContain('Upload-only.');
    }
  });
});
