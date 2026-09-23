import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureListRow } from '@intellifin/infrastructure';

import { AdministratorOverview } from './AdministratorOverview';
import { MyDrafts } from './MyDrafts';
import {
  ADMIN_ENVIRONMENT_FACTS,
  ADMIN_LINKS,
  ADMIN_OVERVIEW_SCOPE,
  ALL_PROCEDURES_LINK,
  MY_DRAFTS_EMPTY,
  MY_DRAFTS_HEADING,
  OVERVIEW_LEDE,
  OVERVIEW_NOT_YOUR_SUMMARY,
  overviewBounded,
} from './overview-words';

/**
 * The two role-landing sections (UI cleanup 2026-09-22, UX-37 and the role landing).
 *
 * Rendered for real, server-side: the properties under test are properties of the MARKUP
 * — which links a PoC Administrator is offered, whether an Auditor's own Draft is named,
 * and whether either section can be read as a refusal.
 */

const DRAFT: ProcedureListRow = {
  procedureId: '019823ab-0000-7000-8000-0000000000f1',
  controlName: 'Terminated Users Retaining Access',
  templateId: 'P-1',
  activeVersionState: null,
  activeVersionNumber: null,
  latestVersionState: 'DRAFT',
  latestVersionNumber: 2,
  plannedFrequency: null,
  ownerId: 'auditor-1',
  updatedAt: '2026-09-20T08:30:00.000Z',
};

describe("the PoC Administrator's landing", () => {
  const html = renderToStaticMarkup(React.createElement(AdministratorOverview));

  it('offers the three things they set up, as real links', () => {
    // EXPERIENCE.md's role-landing decision: "a PoC Administrator lands on an
    // administration summary, not on a refusal."
    for (const entry of ADMIN_LINKS) {
      expect(html).toContain(`href="${entry.href}"`);
      expect(html).toContain(entry.label);
      expect(html).toContain(entry.detail);
    }
  });

  it('points only at routes that exist in this build', () => {
    // `/administration` IS the Users surface here; a landing page linking to
    // `/administration/users` would send an administrator to a 404.
    expect(html).not.toContain('/administration/users');
  });

  it('states the standing facts, and never as a refusal', () => {
    for (const fact of ADMIN_ENVIRONMENT_FACTS) expect(html).toContain(fact);
    expect(html).toContain(ADMIN_OVERVIEW_SCOPE);
    // The Banner it replaced told somebody the summary was for other people.
    expect(html).not.toContain(OVERVIEW_NOT_YOUR_SUMMARY);
    expect(html).not.toContain('does not permit');
  });

  it('shows no count it cannot take exactly', () => {
    // Every administration repository answers a BOUNDED page, and `rows.length` of one is
    // the bound rather than a total — the one number this product's rules forbid a
    // surface to report as one. So the links carry no numbers at all.
    expect(html).not.toMatch(/>\s*\d+\s*</);
  });
});

describe("the Auditor's own drafts", () => {
  it('names the Draft, its Template and when it was last touched', () => {
    const html = renderToStaticMarkup(
      React.createElement(MyDrafts, { rows: [DRAFT], total: 1 }),
    );
    expect(html).toContain(MY_DRAFTS_HEADING);
    expect(html).toContain('Terminated Users Retaining Access');
    expect(html).toContain('href="/procedures/019823ab-0000-7000-8000-0000000000f1"');
    expect(html).toContain('Draft');
    expect(html).toContain('v2');
    // Readable, with the exact instant still in the markup.
    expect(html).toContain('20 Sep 2026, 08:30 UTC');
    expect(html).toContain('dateTime="2026-09-20T08:30:00.000Z"');
    expect(html).toContain(ALL_PROCEDURES_LINK);
  });

  it('refuses to present an empty list as anything but an empty list', () => {
    const html = renderToStaticMarkup(React.createElement(MyDrafts, { rows: [], total: 0 }));
    expect(html).toContain(MY_DRAFTS_EMPTY.headline);
    expect(html).toContain(MY_DRAFTS_EMPTY.sentence);
    expect(MY_DRAFTS_EMPTY.sentence).toContain('does not mean a control passed');
  });

  it('says how many it did not show, from the exact total', () => {
    const html = renderToStaticMarkup(React.createElement(MyDrafts, { rows: [DRAFT], total: 9 }));
    expect(html).toContain(overviewBounded(1, 9));
    // A group that fits says nothing: a note claiming "1 of 1" is noise.
    expect(renderToStaticMarkup(React.createElement(MyDrafts, { rows: [DRAFT], total: 1 })))
      .not.toContain('Showing the first');
  });
});

describe("the Overview's lede", () => {
  it("is the cleanup plan's own sentence about the reader's work", () => {
    // It read "What ran, what needs attention, and whether Evidence is trustworthy" —
    // three nouns about the platform.
    expect(OVERVIEW_LEDE).toBe('Your audit work and the items that need your attention.');
  });
});
