import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_SECTION_HEADINGS,
  PROCEDURE_READINESS_CODES,
  completenessReason,
  type DraftSectionHeading,
  type ProcedureReadinessItem,
} from '@intellifin/domain';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { SECTION_WORDS } from '../design/plain-words';
import { preparationPanelHref } from './preparation-anchors';
import { ReadinessPanel } from './ReadinessPanel';
import { SECTION_STEP, draftGapWords, readinessLine } from './readiness-words';

/**
 * UX-15: every readiness and blocker sentence the Builder renders names its section by the
 * title the Builder shows, links to the step, and never prints the domain's stored heading.
 */

/** The stored headings whose Builder title is different — the words that must not appear. */
const RAW_HEADINGS = DRAFT_SECTION_HEADINGS.filter((heading) => SECTION_WORDS[heading].title !== heading);

const SECTIONS: Readonly<Record<(typeof PROCEDURE_READINESS_CODES)[number], DraftSectionHeading>> = {
  'targets-missing': 'Target System selection',
  'unsupported-target-selected': 'Target System selection',
  'source-not-bound': 'Population Source binding',
  'agent-judged-without-policy': 'Compliance Rule conditions',
  'termination-time-precision-missing': 'Compliance Rule conditions',
  'disablement-capture-missing': 'Evidence Requirements',
  'model-read-attribute': 'Evidence Requirements',
};

function item(code: (typeof PROCEDURE_READINESS_CODES)[number]): ProcedureReadinessItem {
  const subject = code === 'targets-missing' || code === 'source-not-bound' ? null
    : code === 'unsupported-target-selected' ? 'LedgerDesk'
    : code.startsWith('agent') || code.startsWith('termination') ? 'C2' : 'disabled_time';
  return { code, section: SECTIONS[code], subject, sentence: 'domain sentence' };
}

describe('readiness in the Builder’s words (UX-15)', () => {
  it.each(PROCEDURE_READINESS_CODES)('%s names its section by the Builder title, and no stored heading', (code) => {
    const line = readinessLine(item(code));
    expect(line.sentence).toContain(SECTION_WORDS[SECTIONS[code]].title);
    expect(line.sectionTitle).toBe(SECTION_WORDS[SECTIONS[code]].title);
    expect(line.step).toBe(SECTION_STEP[SECTIONS[code]]);
    for (const heading of RAW_HEADINGS) expect(line.sentence).not.toContain(heading);
    // A condition id is said as a numbered condition, a field name in words.
    expect(line.sentence).not.toMatch(/\bC2\b/u);
    expect(line.sentence).not.toContain('disabled_time');
  });

  it('maps every stored section to a guided step', () => {
    for (const heading of DRAFT_SECTION_HEADINGS) expect(SECTION_STEP[heading]).toBeDefined();
  });

  it('links each finding to the exact step on the Builder, and names no stored heading as rendered text', () => {
    const inputs = { ...executablePlanInputs(), sourceSnapshot: null, targets: [] };
    const html = renderToStaticMarkup(React.createElement(ReadinessPanel, { inputs, headingId: 'r', stepHref: preparationPanelHref }));
    expect(html).toContain('data-readiness-item="source-not-bound"');
    expect(html).toContain(`href="${preparationPanelHref('evidence')}"`);
    expect(html).toContain(`Go to ${SECTION_WORDS['Population Source binding'].title}`);
    const text = html.replace(/<[^>]*>/gu, ' ');
    for (const heading of RAW_HEADINGS) expect(text).not.toContain(heading);
  });

  it('names the section without a link where the page has no editor to open', () => {
    const inputs = { ...executablePlanInputs(), sourceSnapshot: null };
    const html = renderToStaticMarkup(React.createElement(ReadinessPanel, { inputs, headingId: 'r' }));
    expect(html).toContain(SECTION_WORDS['Population Source binding'].title);
    expect(html).not.toContain('data-readiness-link');
  });
});

describe('submission blockers in the Builder’s words (UX-15, UX-16)', () => {
  /** Drive the REAL domain function through each branch, so a reworded domain sentence fails here. */
  const base = executablePlanInputs();
  const cases: readonly [string, Parameters<typeof completenessReason>[0], DraftSectionHeading][] = [
    ['no source', { ...base, sourceSnapshot: null }, 'Population Source binding'],
    ['lookup columns missing', { ...base, sourceSnapshot: { ...base.sourceSnapshot!, contract: { ...base.sourceSnapshot!.contract, declared_schema: ['other_column'] } } }, 'Population Source binding'],
    ['no scope', { ...base, scope: '' }, 'Period and scope'],
    ['no schedule', { ...base, schedule: null }, 'Schedule'],
    ['no period', { ...base, period: null }, 'Period and scope'],
    ['no condition', { ...base, complianceConditions: [] }, 'Compliance Rule conditions'],
  ];

  it.each(cases)('%s: says what is missing and names the section title', (_name, inputs, section) => {
    const reason = completenessReason(inputs);
    expect(reason).not.toBeNull();
    const words = draftGapWords(reason);
    expect(words).not.toBe(reason);
    expect(words).toContain(SECTION_WORDS[section].title);
    for (const heading of RAW_HEADINGS) expect(words).not.toContain(heading);
  });

  it('tells a draft gap from a platform failure', () => {
    expect(draftGapWords('The test plan could not be prepared: Choose a Population Source.')).toMatch(/^Something is missing in your draft\. /u);
    expect(draftGapWords('The test plan could not be prepared: The frozen derivation model configuration is unavailable.'))
      .toMatch(/^The platform could not prepare the test plan\. Try preparing it again/u);
  });

  it('returns an unknown sentence as it came rather than a blank or a guess', () => {
    expect(draftGapWords('An entirely new domain sentence.')).toBe('An entirely new domain sentence.');
    expect(draftGapWords(null)).toBeNull();
  });
});
