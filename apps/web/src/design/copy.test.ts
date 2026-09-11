import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REGISTRATION_REFUSALS } from '@intellifin/application';

import {
  BUILDER_CONTROL_NAME_EDITABLE_SENTENCE,
  BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE,
  CAPTURE_TIME_UNRECORDED,
  EXECUTION_FAILURE_HEADING,
  GATE_NOT_EVALUATED,
  MASKED_BY_BINDING,
  MASKED_VALUE,
  MISSED_SCHEDULED_START_TEMPLATE,
  NOT_COMPARABLE_SENTENCE,
  NO_EVIDENCE_HEADLINE,
  RUNS_EMPTY_STATE,
  RUN_TAB_EMPTY,
  SAFE_NEXT_ACTION_HEADING,
  STALE_DATA_ACTION,
  STALE_DATA_TEMPLATE,
  SUBMIT_UNAVAILABLE,
  UNTRUSTED_CONTENT_CLAUSE,
  UNTRUSTED_CONTENT_SENTENCE,
  gateCount,
  runChangeSummary,
  updatedAtTitle,
  BUILDER_DESKTOP_ONLY_SENTENCE,
  AUTHOR_CANNOT_APPROVE_SENTENCE,
  DECLARED_COUNT_MISSING_SENTENCE,
  MANUAL_UPLOAD_SENTENCE,
  EMPTY_STATES,
  ENVIRONMENT_RIBBON_SENTENCE,
  FULLY_QUOTED_EMPTY_STATES,
  PROCEDURE_CARD_ABSENT,
  REGISTRATION_CHANGE_WARNING_TEMPLATE,
  RUN_CANCELED_BY_TEMPLATE,
  RUN_UNCHANGED_SENTENCE,
  registrationChangeWarning,
  runCanceledBy,
  ESCALATION_PANEL_COPY,
  LIVE_VIEW_DESKTOP_ONLY_SENTENCE,
  LIVE_VIEW_QUEUED_SENTENCE,
  SESSION_ISOLATION_NOTE,
  PAUSE_COPY,
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
    ];
    for (const surface of surfaces) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).toContain('EMPTY_STATES');
    }
  });
  it('pins the self-approval refusal to EXPERIENCE.md', () => {
    expect(experience).toContain(AUTHOR_CANNOT_APPROVE_SENTENCE);
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

/**
 * Every `.ts` and `.tsx` under `apps/web`, so a claim refused here is refused wherever a
 * later surface might retype it — the `form-method.test.ts` walk, one file along. A
 * broken symlink is skipped rather than allowed to fail the suite.
 */
function webSourceFiles(dir = fileURLToPath(new URL('../../', import.meta.url))): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      found.push(...webSourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

describe('the Builder read-only sentences', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../procedures/BuilderSections.tsx', import.meta.url)),
    'utf8',
  );

  it('says the section comes from the Template, and is rendered from this module', () => {
    expect(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE).toContain('pre-filled from the Template');
    expect(source).toContain('BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE');
    expect(source).not.toContain(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE);
  });

  it('names where the Control name is edited, rather than claiming it cannot be', () => {
    expect(BUILDER_CONTROL_NAME_EDITABLE_SENTENCE).toContain('Control name');
    expect(source).toContain('BUILDER_CONTROL_NAME_EDITABLE_SENTENCE');
    expect(source).not.toContain(BUILDER_CONTROL_NAME_EDITABLE_SENTENCE);
  });

  /**
   * The claim that was stale: every authored section is editable now, and the Control
   * NAME is editable from the very page that carried the sentence. Refused anywhere in
   * `apps/web`, not only in the component it was written for, so a later surface cannot
   * revive it by retyping it somewhere else.
   *
   * Comments are stripped first — `copy.ts` records WHY the sentence was revised, and a
   * note to the next reader is not a claim to the person using the product, exactly as
   * `stylesheet.test.ts` strips comments before looking for a token read. This file is
   * skipped because it has to name the phrase it forbids.
   */
  it('nowhere claims a Builder section is not editable yet', () => {
    const self = fileURLToPath(import.meta.url);
    const offenders = webSourceFiles()
      .filter((file) => file !== self)
      .filter((file) =>
        readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '')
          .includes('not editable yet'),
      );
    expect(offenders).toEqual([]);
  });
});

describe('the historical Builder desktop-only floor', () => {
  it("is EXPERIENCE.md's responsive-floor sentence, character for character", () => {
    // Quoted verbatim from the "< 900px" row, read off disk — not compared with a copy of
    // itself.
    expect(experience).toContain(`"${BUILDER_DESKTOP_ONLY_SENTENCE}"`);
  });

  it('is superseded by the adopted responsive guided Builder', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../app/procedures/[id]/builder/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).not.toContain('BUILDER_DESKTOP_ONLY_SENTENCE');
    expect(source).toContain('ls-guided-authoring');
    expect(experience).toContain('Guided preparation is editable below 900px');
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

describe('the Run surfaces copy (Story 3.11)', () => {
  it("is EXPERIENCE.md's stale-data banner, character for character", () => {
    // The contract writes it in quotation marks in the "Any / Stale data" row, so the
    // quotes are part of the match: a paraphrase elsewhere would not satisfy it.
    expect(experience).toContain(`"${STALE_DATA_TEMPLATE}"`);
    expect(STALE_DATA_TEMPLATE.endsWith(STALE_DATA_ACTION)).toBe(true);
    expect(updatedAtTitle('2026-09-06T09:00:00.000Z')).toBe('Updated 2026-09-06T09:00:00.000Z.');
    expect(updatedAtTitle('x')).not.toContain('{');
    expect(updatedAtTitle('x')).not.toContain(STALE_DATA_ACTION);
  });

  it("is EXPERIENCE.md's Evidence empty-state headline", () => {
    expect(experience).toContain(`"${NO_EVIDENCE_HEADLINE}"`);
    expect(RUN_TAB_EMPTY.evidence.headline).toBe(NO_EVIDENCE_HEADLINE);
  });

  it("is EXPERIENCE.md's incomparable-change sentence", () => {
    expect(experience).toContain(`"${NOT_COMPARABLE_SENTENCE}"`);
  });

  it("is EXPERIENCE.md's missed-start row, transcribed for the story that grows a Schedule", () => {
    // Transcribed and deliberately NOT rendered: Epic 3 initiates every Run by hand, so
    // nothing could truthfully fill `{time}`. Quoting it now is what stops the Schedule
    // story retyping it — the fourth-retyping lesson from the denial strings.
    expect(experience).toContain(`"${MISSED_SCHEDULED_START_TEMPLATE}"`);
    for (const surface of ['../../app/runs/page.tsx', '../runs/RunsTable.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(surface, import.meta.url)), 'utf8');
      expect(source, surface).not.toContain('Missed');
    }
  });

  it("is EXPERIENCE.md's two disabled-Submit sentences, transcribed for Story 6.3", () => {
    expect(experience).toContain(`"${SUBMIT_UNAVAILABLE.unsealed}"`);
    expect(experience).toContain(`"${SUBMIT_UNAVAILABLE.inconclusive}"`);
  });

  it("derives the Gate header count from DESIGN.md's own example", () => {
    expect(design).toContain(`"${gateCount(18, 20)}"`);
    expect(gateCount(18, 20)).toBe('18 of 20 checks passed');
    expect(gateCount(0, 20)).not.toContain('{');
  });

  it("builds the untrusted-content sentence from DESIGN.md's own clause", () => {
    expect(design).toContain(UNTRUSTED_CONTENT_CLAUSE);
    expect(UNTRUSTED_CONTENT_SENTENCE).toBe('Source content cannot change the Run objective, tool scope, or evaluation.');
    // Comments stripped first: the component's own doc comment QUOTES the rule it
    // implements, and a scan that matched prose would fail on the explanation.
    const source = readFileSync(fileURLToPath(new URL('../runs/UntrustedText.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('UNTRUSTED_CONTENT_SENTENCE');
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('cannot change the Run objective, tool scope');
  });

  it("is EXPERIENCE.md's masking marker and sentence", () => {
    expect(experience).toContain(MASKED_VALUE);
    expect(experience).toContain(`"${MASKED_BY_BINDING}"`);
  });

  it('names the two panels DESIGN.md names, and renders them from this module', () => {
    expect(experience).toContain(SAFE_NEXT_ACTION_HEADING);
    expect(design).toContain(`${EXECUTION_FAILURE_HEADING.toLowerCase()} panel`);
    const source = readFileSync(fileURLToPath(new URL('../runs/ResultSections.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('SAFE_NEXT_ACTION_HEADING');
    expect(source).toContain('EXECUTION_FAILURE_HEADING');
  });

  it('gives every empty state and absent sentence of ours the EmptyState rule', () => {
    // OURS, not quoted — EXPERIENCE.md gives these surfaces no verbatim sentence, and
    // pinning one against a file that does not contain it is a test that cannot pass.
    // They must still name what would appear and refuse to imply a passed control.
    const ours = [RUNS_EMPTY_STATE, ...Object.values(RUN_TAB_EMPTY)];
    for (const state of ours) {
      expect(state.sentence.length).toBeGreaterThan(40);
      expect(state.sentence.trim().endsWith('.')).toBe(true);
      expect(state.sentence).toMatch(/does not mean a control passed|not mean a control passed/);
    }
    for (const sentence of Object.values(GATE_NOT_EVALUATED)) {
      expect(sentence).toContain('not the same as a check that passed');
    }
  });

  it('renders the Runs empty state from this module, not from inline copy', () => {
    const source = readFileSync(fileURLToPath(new URL('../runs/RunsTable.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('RUNS_EMPTY_STATE');
    expect(source).not.toContain('An empty list does not mean');
  });

  it('says "No change" rather than leaving the Change cell blank', () => {
    expect(runChangeSummary(0, 0)).toBe('No change');
    expect(runChangeSummary(2, 1)).toBe('2 new, 1 resolved');
    expect(runChangeSummary(2, 1)).not.toContain('{');
  });

  it('states what an Evidence item could not record, in words', () => {
    expect(CAPTURE_TIME_UNRECORDED).toBe('Capture time was not recorded.');
    expect(CAPTURE_TIME_UNRECORDED).not.toMatch(/^[-—\s]*$/);
  });
});

describe('the Run lifecycle copy', () => {
  it("is EXPERIENCE.md's corrective-action sentence, character for character", () => {
    expect(experience).toContain(RUN_UNCHANGED_SENTENCE);
  });

  it("is EXPERIENCE.md's Canceled Run Detail sentence, substituted rather than retyped", () => {
    expect(experience).toContain(RUN_CANCELED_BY_TEMPLATE);
    expect(runCanceledBy('dana', '2026-09-06 09:00:00 UTC')).toBe(
      'Canceled by dana at 2026-09-06 09:00:00 UTC',
    );
    expect(runCanceledBy('dana', 'x')).not.toContain('{');
  });

  it('renders both from the constants rather than repeating them', () => {
    const actions = readFileSync(
      fileURLToPath(new URL('../runs/RunLifecycleActions.tsx', import.meta.url)),
      'utf8',
    );
    expect(actions).toContain('RUN_UNCHANGED_SENTENCE');
    expect(actions).not.toContain('This Run remains unchanged.');
    // Story 3.11 moved the cancellation banners into the shared Run Detail frame, so
    // every one of the five tabs states them from the one constant.
    const detail = readFileSync(
      fileURLToPath(new URL('../runs/detail.tsx', import.meta.url)),
      'utf8',
    );
    expect(detail).toContain('runCanceledBy(');
    expect(detail).not.toContain('Canceled by ${');
  });
});

describe('the Escalation panel copy', () => {
  it("keeps the contract's pause, note and timeout wording verbatim", () => {
    expect(experience).toContain(ESCALATION_PANEL_COPY.answerNoteLabel);
    expect(experience).toContain(ESCALATION_PANEL_COPY.pauseUnavailable);
    expect(experience).toContain(ESCALATION_PANEL_COPY.timeoutTemplate);
  });

  it('names the skip link the Accessibility rules name (Story 5.6)', () => {
    // `Escalation panels are reachable by a skip link ("Go to open Escalation") when
    // present.` It read `Skip to open Escalation` for two epics, because it was typed
    // inline in the component and pinned against nothing.
    expect(experience).toContain(`("${ESCALATION_PANEL_COPY.skipLink}")`);
    const panel = readFileSync(fileURLToPath(new URL('../runs/EscalationPanel.tsx', import.meta.url)), 'utf8');
    expect(panel).toContain('ESCALATION_PANEL_COPY.skipLink');
    expect(panel).not.toContain('Skip to open Escalation');
  });

  it('renders the paused action reason from the shared copy module', () => {
    // The control moved to `RunPauseControls` in Story 5.4, because Live View carries the
    // same two buttons. Both files are scanned, so re-inlining the sentence in either — the
    // defect this test exists for — fails rather than moving quietly to the other one.
    const sources = ['../runs/RunPauseControls.tsx', '../runs/RunLifecycleActions.tsx'].map((path) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
    );
    expect(sources[0]).toContain('ESCALATION_PANEL_COPY.pauseUnavailable');
    for (const source of sources) {
      expect(source).not.toContain('A Run waiting on an answer cannot be paused.');
    }
  });
});

describe('the Paused Run copy (Story 5.4)', () => {
  /**
   * EXPERIENCE.md's Run Detail / Paused row, character for character.
   *
   * The template carries `{actor}` and two DIFFERENT instant placeholders where the
   * artifact writes one example name and `{time}` twice; substituting the artifact's own
   * example back is what makes this a comparison with the contract rather than with a copy
   * of the template.
   */
  it('states the contract sentence verbatim once its placeholders are filled', () => {
    const asWritten = PAUSE_COPY.banner
      .replace('{actor}', 'Daniel Okonjo')
      .replace('{ends}', '{time}');
    expect(experience).toContain(asWritten);
  });

  it('never retypes that sentence outside the copy module', () => {
    for (const path of ['../runs/detail.tsx', '../runs/RunPauseControls.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      expect(source).not.toContain('Resumes on your action;');
    }
  });
});

describe('the Live View copy', () => {
  it("is EXPERIENCE.md's responsive floor for Live View, character for character", () => {
    // The "Live View | Below 1024px" row. Read off disk, and deliberately a DIFFERENT
    // sentence from the Builder's 900px floor above: one is about supervising a Run,
    // the other about authoring a Draft, and a surface that says the wrong one teaches
    // a sentence nobody will meet again.
    expect(experience).toContain(`"${LIVE_VIEW_DESKTOP_ONLY_SENTENCE}"`);
    expect(LIVE_VIEW_DESKTOP_ONLY_SENTENCE).not.toBe(BUILDER_DESKTOP_ONLY_SENTENCE);
  });

  it("is EXPERIENCE.md's Queued Watch reason, character for character", () => {
    expect(experience).toContain(`"${LIVE_VIEW_QUEUED_SENTENCE}"`);
  });

  it("is DESIGN.md's session-viewer isolation note, character for character", () => {
    // The interpunct and its spacing are the contract's own; retyping them is how a
    // hyphen or a bullet gets substituted and nothing notices.
    expect(design).toContain(`"${SESSION_ISOLATION_NOTE}"`);
  });

  it('is rendered from this module by the session viewer, not retyped', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../runs/LiveViewer.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('LIVE_VIEW_DESKTOP_ONLY_SENTENCE');
    expect(source).toContain('SESSION_ISOLATION_NOTE');
    expect(source).not.toContain('Open on a desktop browser to supervise');
    expect(source).not.toContain('isolated credentials\'');
  });
});
